# Progress

Phase: 6 | Branch: phase-6-ui-spec

## Done

- Phase 7 complete: caption presets, centered safe-area captions, hook-title overlays, opt-in YuNet face tracking, crop/blurred/stacked layout presets, and pause trimming.
- UI-spec 6.0 API routes are tested for source/transcript reads, byte ranges, selection clip creation, deletion, and per-clip rendering.
- UI-spec 6.1: React + TypeScript page is bundled by Bun and lists persisted jobs.
- UI-spec 6.2: upload form, 2-second polling during active jobs, stage progress, and visible errors; browser smoke verified the page and persisted job list.
- UI-spec 6.3: three-column editor, clip list, source video playback bounded to the selected clip, loop toggle, and transcript preview overlay.
- UI-spec 6.4: millisecond trim controls, two-handle source window, word snapping, reset, playhead/nudge/jump controls, keyboard shortcuts, debounced save, and duration warnings.
- Pause trim: gaps over 600 ms between words are cut to a 120 ms breath on each side. Leading and trailing silence uses the same pad.
- Captions are retimed onto the concatenated timeline. Manifest `duration` is the rendered length; `start` and `end` stay the source window.
- `bun run check` covers the span math, FFmpeg concat args, and a real trimmed fixture.

## Next

- UI-spec 6.5: per-word text editing, current-word highlight, and preserving text edits across trims.

## Known bugs / open questions

- `assets/raw/sample.mp4` is a song and yielded no candidates.
- Face tracking quality depends on face size and visibility in the five-second samples.
- Cached clips keep the old cut until a rerender with `--force` or the UI render button.
- The untracked `whisper.cpp/` source tree is excluded from project typecheck and test discovery; it is not included in project commits.

## Run

- `bun run check`
- `bun run start`
- `bun run src/cli.ts video.mp4 --force`
- `bun run dev`
