import { expect, test } from "bun:test";
import { captionEvents, buildAss } from "./captions.ts";
import { buildRenderArgs } from "./render.ts";
import type { Word } from "../types.ts";

const words: Word[] = [
  { text: "This", start: 100, end: 230 },
  { text: "is", start: 240, end: 340 },
  { text: "a", start: 350, end: 390 },
  { text: "caption.", start: 400, end: 800 },
  { text: "Next", start: 1100, end: 1400 },
];

test("caption events clip to the selection and break on sentence boundaries", () => {
  expect(captionEvents(words, 200, 1200)).toEqual([
    {
      start: 0,
      end: 600,
      words: [
        { text: "This", start: 0, end: 30 },
        { text: "is", start: 40, end: 140 },
        { text: "a", start: 150, end: 190 },
        { text: "caption.", start: 200, end: 600 },
      ],
    },
    { start: 900, end: 1000, words: [{ text: "Next", start: 900, end: 1000 }] },
  ]);
});

test("ASS subtitles have per-word karaoke highlighting and clip-relative timestamps", () => {
  const ass = buildAss([
    { text: "A", start: 0, end: 250 },
    { text: "{safe}", start: 250, end: 750 },
  ], 0, 800);
  expect(ass).toContain("PlayResX: 1080");
  expect(ass).toContain("&H0000FFFF");
  expect(ass).toContain("Style: Default,Arial,66,&H00FFFFFF,&H0000FFFF,&H00101010,&H80000000,-1,0,1,4,1,5,70,70,0,1");
  expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:00.75");
  expect(ass).toContain("{\\k25}A {\\k50}\\{safe\\}");
});

test("FFmpeg arguments crop, scale, subtitle, normalize, and encode the clip", () => {
  expect(buildRenderArgs("C:\\video.mp4", "clips/clip-01.mp4", "captions/clip-01.ass", 110, 30_640)).toEqual([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
    "-ss", "0.110", "-i", "C:\\video.mp4", "-t", "30.530",
    "-vf", "crop=w='ih*9/16':h=ih:x='(iw-ow)/2':y=0,scale=1080:1920,subtitles=filename='captions/clip-01.ass'",
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "1",
    "-movflags", "+faststart", "clips/clip-01.mp4",
  ]);
});

test("face crop arguments interpolate the smoothed crop path and clamp it to the frame", () => {
  const args = buildRenderArgs("video.mp4", "clips/clip.mp4", "captions/clip.ass", 0, 30_000, [
    { time: 2.5, centerX: 340 },
    { time: 7.5, centerX: 400 },
  ]);
  expect(args[args.indexOf("-vf") + 1]).toContain("if(lt(t\\,2.50)");
  expect(args[args.indexOf("-vf") + 1]).toContain("iw-ow");
});
