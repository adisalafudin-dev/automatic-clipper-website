import path from "node:path";
import { createHash } from "node:crypto";
import type * as Ort from "onnxruntime-node";
import type { FacecamRect } from "../modes.ts";

export type FaceCenterSample = { time: number; centerX: number };
export type FaceDetectionSample = FaceCenterSample & { centerY: number; width: number; height: number; score: number };
export type VideoDimensions = { width: number; height: number };

const MODEL_FILE = "face_detection_yunet_2023mar.onnx";
const MODEL_URL = "https://github.com/opencv/opencv_zoo/raw/refs/heads/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx";
const MODEL_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
const INPUT_SIZE = 640;
const SAMPLE_SECONDS = 5;
const MIN_SCORE = 0.55;
let sessionPromise: Promise<Ort.InferenceSession> | undefined;

export function smoothFaceCenters(samples: FaceCenterSample[], alpha = 0.35): FaceCenterSample[] {
  if (!samples.length) return [];
  const despiked = samples.map((sample, index) => {
    const previous = samples[index - 1];
    const next = samples[index + 1];
    if (previous && next) {
      const neighborMean = (previous.centerX + next.centerX) / 2;
      if (
        Math.abs(sample.centerX - previous.centerX) > 160 &&
        Math.abs(sample.centerX - next.centerX) > 160 &&
        Math.abs(previous.centerX - next.centerX) <= 160
      ) return { ...sample, centerX: neighborMean };
    }
    return sample;
  });
  const smoothed: FaceCenterSample[] = [];
  for (const sample of despiked) {
    const previous = smoothed.at(-1);
    smoothed.push({
      time: sample.time,
      centerX: previous ? previous.centerX * (1 - alpha) + sample.centerX * alpha : sample.centerX,
    });
  }
  return smoothed;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function inferFacecamRect(samples: FaceDetectionSample[], dimensions: VideoDimensions): FacecamRect | null {
  if (samples.length < 2 || dimensions.width <= 0 || dimensions.height <= 0) return null;
  const valid = samples.filter((sample) =>
    Number.isFinite(sample.centerX) && Number.isFinite(sample.centerY) && Number.isFinite(sample.width) &&
    Number.isFinite(sample.height) && sample.width > 0 && sample.height > 0,
  );
  let cluster: FaceDetectionSample[] = [];
  for (const candidate of valid) {
    const nearby = valid.filter((sample) => Math.hypot(
      (sample.centerX - candidate.centerX) / dimensions.width,
      (sample.centerY - candidate.centerY) / dimensions.height,
    ) <= 0.12);
    if (nearby.length > cluster.length || (nearby.length === cluster.length && nearby.reduce((sum, sample) => sum + sample.score, 0) > cluster.reduce((sum, sample) => sum + sample.score, 0))) cluster = nearby;
  }
  if (cluster.length < Math.max(2, Math.ceil(samples.length * 0.4))) return null;

  const centerX = median(cluster.map((sample) => sample.centerX)) / dimensions.width;
  const centerY = median(cluster.map((sample) => sample.centerY)) / dimensions.height;
  const faceWidth = median(cluster.map((sample) => sample.width)) / dimensions.width;
  const faceHeight = median(cluster.map((sample) => sample.height)) / dimensions.height;
  const w = Math.min(0.42, Math.max(0.18, faceWidth * 5));
  const h = Math.min(0.35, Math.max(0.16, faceHeight * 2.5));
  const x = Math.min(1 - w, Math.max(0, centerX - w / 2));
  const y = Math.min(1 - h, Math.max(0, centerY - h / 2));
  return { x, y, w, h };
}

async function getSession(): Promise<Ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import("onnxruntime-node");
      const modelPath = process.env.FACE_MODEL_PATH ?? path.join("data", "models", MODEL_FILE);
      if (!(await Bun.file(modelPath).exists())) {
        throw new Error(`YuNet face model missing at ${modelPath}; run bun run download-face-model`);
      }
      const bytes = new Uint8Array(await Bun.file(modelPath).arrayBuffer());
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (hash.toLowerCase() !== MODEL_SHA256) throw new Error("YuNet face model checksum mismatch");
      return ort.InferenceSession.create(modelPath, { executionProviders: ["cpu"] });
    })();
  }
  return sessionPromise;
}

async function findBestFace(frame: Uint8Array, dimensions: VideoDimensions): Promise<Omit<FaceDetectionSample, "time"> | null> {
  const ort = await import("onnxruntime-node");
  const session = await getSession();
  const scale = Math.min(INPUT_SIZE / dimensions.width, INPUT_SIZE / dimensions.height);
  const resizedWidth = dimensions.width * scale;
  const resizedHeight = dimensions.height * scale;
  const padX = (INPUT_SIZE - resizedWidth) / 2;
  const padY = (INPUT_SIZE - resizedHeight) / 2;
  const tensorData = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const planeSize = INPUT_SIZE * INPUT_SIZE;
  for (let pixel = 0; pixel < planeSize; pixel++) {
    tensorData[pixel] = frame[pixel * 3]!;
    tensorData[planeSize + pixel] = frame[pixel * 3 + 1]!;
    tensorData[planeSize * 2 + pixel] = frame[pixel * 3 + 2]!;
  }
  const outputs = await session.run({
    [session.inputNames[0]!]: new ort.Tensor("float32", tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]),
  });
  let bestScore = MIN_SCORE;
  let bestFace: Omit<FaceDetectionSample, "time"> | null = null;
  for (const stride of [8, 16, 32]) {
    const cls = outputs[`cls_${stride}`]?.data as Float32Array | undefined;
    const obj = outputs[`obj_${stride}`]?.data as Float32Array | undefined;
    const boxes = outputs[`bbox_${stride}`]?.data as Float32Array | undefined;
    if (!cls || !obj || !boxes) continue;
    const columns = INPUT_SIZE / stride;
    for (let index = 0; index < cls.length; index++) {
      const score = cls[index]! * obj[index]!;
      if (score <= bestScore) continue;
      const centerX = (index % columns + boxes[index * 4]!) * stride;
      const centerY = (Math.floor(index / columns) + boxes[index * 4 + 1]!) * stride;
      const width = Math.exp(boxes[index * 4 + 2]!) * stride;
      const height = Math.exp(boxes[index * 4 + 3]!) * stride;
      if (width <= 0 || height <= 0 || centerY + height / 2 < padY || centerY - height / 2 > padY + resizedHeight) continue;
      bestScore = score;
      bestFace = {
        centerX: Math.max(0, Math.min(dimensions.width, (centerX - padX) / scale)),
        centerY: Math.max(0, Math.min(dimensions.height, (centerY - padY) / scale)),
        width: width / scale,
        height: height / scale,
        score,
      };
    }
  }
  return bestFace;
}

export async function probeVideoDimensions(videoPath: string): Promise<VideoDimensions> {
  const proc = Bun.spawn([
    "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
    "-of", "json", videoPath,
  ], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  if (code !== 0) throw new Error(`ffprobe face dimensions failed: ${stderr.trim()}`);
  const data = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> };
  const width = data.streams?.[0]?.width;
  const height = data.streams?.[0]?.height;
  if (!width || !height) throw new Error("Could not read video dimensions for face tracking");
  return { width, height };
}

export async function sampleFaceDetections(
  videoPath: string,
  clipStart: number,
  clipEnd: number,
  dimensions?: VideoDimensions,
  signal?: AbortSignal,
): Promise<FaceDetectionSample[]> {
  const video = dimensions ?? await probeVideoDimensions(videoPath);
  const proc = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", (clipStart / 1000).toFixed(3),
    "-t", ((clipEnd - clipStart) / 1000).toFixed(3), "-i", videoPath,
    "-vf", `fps=1/${SAMPLE_SECONDS},scale=${INPUT_SIZE}:${INPUT_SIZE}:force_original_aspect_ratio=decrease,pad=${INPUT_SIZE}:${INPUT_SIZE}:(ow-iw)/2:(oh-ih)/2,format=rgb24`,
    "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
  ], { stdout: "pipe", stderr: "pipe", signal });
  const [buffer, stderr, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(), new Response(proc.stderr).text(), proc.exited,
  ]);
  if (code !== 0) throw new Error(`FFmpeg face sampling failed: ${stderr.trim()}`);
  const frameBytes = INPUT_SIZE * INPUT_SIZE * 3;
  const bytes = new Uint8Array(buffer);
  if (bytes.length % frameBytes !== 0) throw new Error("FFmpeg returned an incomplete face sample frame");
  const samples: FaceDetectionSample[] = [];
  for (let offset = 0, index = 0; offset < bytes.length; offset += frameBytes, index++) {
    if (signal?.aborted) throw new Error("Face tracking cancelled");
    const face = await findBestFace(bytes.subarray(offset, offset + frameBytes), video);
    if (face !== null) samples.push({ time: index * SAMPLE_SECONDS, ...face });
  }
  return samples;
}

export const YUNET_MODEL_URL = MODEL_URL;
export const YUNET_MODEL_FILE = MODEL_FILE;
