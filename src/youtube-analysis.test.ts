import { expect, test } from "bun:test";
import { buildActivityWindows, captionsToTranscript, extractHeatmap, parseCaptionCues, parseLiveChatJsonl, selectSpikeRanges } from "./youtube-analysis.ts";

test("parses WebVTT and SRT cues into ordered millisecond timestamps", () => {
  expect(parseCaptionCues("WEBVTT\n\n00:00:01.000 --> 00:00:02.250 align:start\n<c>Hello &amp; welcome</c>\n\n1\n00:00:03,000 --> 00:00:04,000\nNext line.")).toEqual([
    { start: 1_000, end: 2_250, text: "Hello & welcome" },
    { start: 3_000, end: 4_000, text: "Next line." },
  ]);
});

test("maps caption text to approximate word timestamps while preserving phrase duration", () => {
  const transcript = captionsToTranscript([{ start: 1_000, end: 2_000, text: "Hi there." }], "en");
  expect(transcript.model).toBe("youtube-captions");
  expect(transcript.words.map((word) => word.text)).toEqual(["Hi", "there."]);
  expect(transcript.words[0]!.start).toBe(1_000);
  expect(transcript.words.at(-1)!.end).toBe(2_000);
});

test("parses live chat JSONL, deduplicates repeated text for spike scoring, and samples messages", () => {
  const event = (offset: number, message: string) => JSON.stringify({
    replayChatItemAction: {
      videoOffsetTimeMsec: String(offset),
      actions: [{
        addChatItemAction: {
          item: { liveChatTextMessageRenderer: { message: { runs: [{ text: message }] } } },
        },
      }],
    },
  });
  expect(parseLiveChatJsonl([event(1_000, "LOL"), event(2_000, "LOL"), event(35_000, "W")].join("\n"))).toEqual([
    { start: 0, end: 30_000, count: 2, uniqueCount: 1, samples: ["LOL"] },
    { start: 30_000, end: 60_000, count: 1, uniqueCount: 1, samples: ["W"] },
  ]);
});

test("normalizes optional heatmap and chat activity into 30-second windows", () => {
  const heatmap = extractHeatmap([
    { start_time: 0, end_time: 20, value: 0.2 },
    { start_time: 30, end_time: 60, value: 0.9 },
    { start_time: -1, end_time: 3, value: 0.5 },
  ]);
  expect(heatmap).toHaveLength(2);
  const signals = buildActivityWindows(60_000, [
    { start: 0, end: 30_000, count: 1, uniqueCount: 1, samples: ["hello"] },
    { start: 30_000, end: 60_000, count: 8, uniqueCount: 8, samples: ["W"] },
  ], heatmap, [{ start: 0, end: 60_000, title: "Start" }]);
  expect(signals.windows[1]!.chatScore).toBe(10);
  expect(signals.windows[1]!.heatmapScore).toBe(10);
  expect(signals.chapters[0]!.title).toBe("Start");
});

test("selects the strongest activity windows and merges nearby transcript search ranges", () => {
  const windows = [
    { start: 0, end: 30_000, chatScore: 10, heatmapScore: 0, chatCount: 5, samples: [] },
    { start: 30_000, end: 60_000, chatScore: 0, heatmapScore: 8, chatCount: 0, samples: [] },
    { start: 420_000, end: 450_000, chatScore: 5, heatmapScore: 0, chatCount: 2, samples: [] },
  ];
  expect(selectSpikeRanges(windows, 600_000)).toEqual([
    { start: 0, end: 180_000, activityScore: 6 },
    { start: 300_000, end: 570_000, activityScore: 3 },
  ]);
});
