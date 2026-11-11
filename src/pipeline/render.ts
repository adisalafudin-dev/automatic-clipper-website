import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Transcript, Word } from "../types.ts";
import type { ClipCandidate } from "./candidates.ts";
import { buildAss, type CaptionStyle } from "./captions.ts";
import { keepSpans, outputOffsetMs, spanDuration, wordsOnOutputTimeline, type SourceSpan } from "./pauses.ts";
import { sampleFaceCenters, type FaceCenterSample } from "../vision/faces.ts";

export type ClipRenderEdit = { caption?: string; style?: CaptionStyle; titleOverlay?: boolean };

export type RenderedClip = {
  id: string;
  file: string;
  captions: string;
  start: number;
  end: number;
  duration: number;
  startSentenceId: number;
  endSentenceId: number;
  title: string;
  hook: string;
  score: number;
  reason: string;
};

export type ClipsManifest = { source: string; clips: RenderedClip[] };

function slashPath(filePath: string): string {
  return filePath.replaceAll(path.sep, "/");
}

function cropXExpression(faceCenters: FaceCenterSample[]): string {
  if (!faceCenters.length) return "(iw-ow)/2";
  let expression = faceCenters.at(-1)!.centerX.toFixed(2);
  for (let index = faceCenters.length - 2; index >= 0; index--) {
    const current = faceCenters[index]!;
    const next = faceCenters[index + 1]!;
    const span = Math.max(0.001, next.time - current.time);
    const linear = `${current.centerX.toFixed(2)}+(${(next.centerX - current.centerX).toFixed(2)})*((t-${current.time.toFixed(2)})/${span.toFixed(2)})`;
    expression = `if(lt(t\\,${next.time.toFixed(2)})\\,${linear}\\,${expression})`;
  }
  if (faceCenters.length > 1) {
    return `min(max(if(lt(t\\,${faceCenters[0]!.time.toFixed(2)})\\,${faceCenters[0]!.centerX.toFixed(2)}\\,${expression})-ow/2\\,0)\\,iw-ow)`;
  }
  return `min(max(${expression}-ow/2\\,0)\\,iw-ow)`;
}

function pictureFilters(cropX: string, assRelative: string): string {
  return [
    `crop=w='ih*9/16':h=ih:x='${cropX}':y=0`,
    "scale=1080:1920",
    `subtitles=filename='${slashPath(assRelative)}'`,
  ].join(",");
}

export function buildRenderArgs(
  input: string,
  output: string,
  assRelative: string,
  start: number,
  end: number,
  faceCenters: FaceCenterSample[] = [],
  pauses: SourceSpan[] = [],
): string[] {
  const seconds = (ms: number) => (ms / 1000).toFixed(3);
  const cropX = cropXExpression(faceCenters);
  const encode = [
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "1",
    "-movflags", "+faststart", output,
  ];
  if (pauses.length > 1) {
    const chains: string[] = [];
    const inputs: string[] = [];
    pauses.forEach((span, index) => {
      const from = seconds(span.start - start);
      const to = seconds(span.end - start);
      chains.push(`[0:v]trim=start=${from}:end=${to},setpts=PTS-STARTPTS[v${index}]`);
      chains.push(`[0:a]atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS[a${index}]`);
      inputs.push(`[v${index}][a${index}]`);
    });
    chains.push(`${inputs.join("")}concat=n=${pauses.length}:v=1:a=1[vcat][acat]`);
    chains.push(`[vcat]${pictureFilters(cropX, assRelative)}[vout]`);
    chains.push("[acat]loudnorm=I=-16:TP=-1.5:LRA=11[aout]");
    return [
      "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
      "-ss", seconds(start), "-i", input, "-t", seconds(end - start),
      "-filter_complex", chains.join(";"),
      "-map", "[vout]", "-map", "[aout]",
      ...encode,
    ];
  }
  return [
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
    "-ss", seconds(start), "-i", input, "-t", seconds(end - start),
    "-vf", pictureFilters(cropX, assRelative),
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    ...encode,
  ];
}

function spreadCaptionWords(caption: string, duration: number): Word[] {
  const overrideWords = caption.split(/\s+/).filter(Boolean);
  const totalCharacters = overrideWords.reduce((total, word) => total + word.length, 0);
  if (!totalCharacters || duration <= 0) return [];
  return overrideWords.map((text, wordIndex) => {
    const before = overrideWords.slice(0, wordIndex).reduce((total, word) => total + word.length, 0);
    const start = Math.floor(duration * before / totalCharacters);
    const end = Math.max(start + 1, Math.floor(duration * (before + text.length) / totalCharacters));
    return { text, start, end };
  });
}

async function runFfmpeg(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(args, { cwd, stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg render failed (exit code ${code}):\n${stderr.trim()}`);
}

export async function renderClips(
  videoPath: string,
  jobDir: string,
  transcript: Transcript,
  candidates: ClipCandidate[],
  force = false,
  edits: Record<string, ClipRenderEdit> = {},
  faceTracking = false,
): Promise<ClipsManifest> {
  const absoluteJobDir = path.resolve(jobDir);
  const absoluteVideo = path.resolve(videoPath);
  const clipsDir = path.join(absoluteJobDir, "clips");
  const captionsDir = path.join(absoluteJobDir, "captions");
  await mkdir(clipsDir, { recursive: true });
  await mkdir(captionsDir, { recursive: true });

  const clips: RenderedClip[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const id = `clip-${String(index + 1).padStart(2, "0")}`;
    const filename = `${id}.mp4`;
    const captionsFilename = `${id}.ass`;
    const outputRelative = slashPath(path.join("clips", filename));
    const captionsRelative = slashPath(path.join("captions", captionsFilename));
    const outputPath = path.join(clipsDir, filename);
    const captionsPath = path.join(captionsDir, captionsFilename);

    const edit = edits[id];
    const pauses = keepSpans(transcript.words, candidate.start, candidate.end);
    if (!pauses.length) throw new Error(`Clip ${id} has no time range to render`);
    const outputDuration = spanDuration(pauses);
    const removed = candidate.end - candidate.start - outputDuration;
    if (removed > 0) console.log(`Pause trim ${id}: removed ${(removed / 1000).toFixed(2)}s`);
    const multiple = pauses.length > 1;
    const renderStart = multiple ? candidate.start : pauses[0]!.start;
    const renderEnd = multiple ? candidate.end : pauses[0]!.end;
    let faceCenters: FaceCenterSample[] = [];
    if (faceTracking) {
      const trackingStarted = performance.now();
      try {
        faceCenters = await sampleFaceCenters(absoluteVideo, renderStart, renderEnd);
        if (multiple) {
          faceCenters = faceCenters.flatMap((sample) => {
            const offset = outputOffsetMs(renderStart + sample.time * 1000, pauses);
            return offset === null ? [] : [{ time: offset / 1000, centerX: sample.centerX }];
          });
        }
        console.log(`Face tracking ${id}: ${faceCenters.length} sparse samples in ${((performance.now() - trackingStarted) / 1000).toFixed(2)}s`);
        if (!faceCenters.length) console.warn(`No face found for ${id}; using center crop`);
      } catch (error) {
        console.warn(`Face tracking failed for ${id}; using center crop: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const override = edit?.caption?.trim();
    const captionWords = override
      ? spreadCaptionWords(override, outputDuration)
      : multiple
        ? wordsOnOutputTimeline(transcript.words, pauses)
        : transcript.words;
    const captionStart = override || multiple ? 0 : renderStart;
    const captionEnd = override || multiple ? outputDuration : renderEnd;
    await Bun.write(captionsPath, buildAss(
      captionWords,
      captionStart,
      captionEnd,
      { style: edit?.style, title: edit?.titleOverlay ? candidate.title : undefined },
    ));
    if (!force && !faceTracking && (await Bun.file(outputPath).exists())) {
      console.log(`Using cached render: ${outputRelative}`);
    } else {
      const args = buildRenderArgs(
        absoluteVideo,
        outputRelative,
        captionsRelative,
        renderStart,
        renderEnd,
        faceCenters,
        multiple ? pauses : [],
      );
      try {
        await runFfmpeg(args, absoluteJobDir);
      } catch (error) {
        if (!faceTracking || !faceCenters.length) throw error;
        console.warn(`Tracked crop render failed for ${id}; retrying center crop: ${error instanceof Error ? error.message : String(error)}`);
        await runFfmpeg(
          buildRenderArgs(absoluteVideo, outputRelative, captionsRelative, renderStart, renderEnd, [], multiple ? pauses : []),
          absoluteJobDir,
        );
      }
    }

    clips.push({
      id,
      file: outputRelative,
      captions: captionsRelative,
      start: candidate.start,
      end: candidate.end,
      duration: outputDuration,
      startSentenceId: candidate.startSentenceId,
      endSentenceId: candidate.endSentenceId,
      title: candidate.title,
      hook: candidate.hook,
      score: candidate.score,
      reason: candidate.reason,
    });
  }

  const manifest = { source: videoPath, clips };
  await Bun.write(path.join(absoluteJobDir, "clips.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
