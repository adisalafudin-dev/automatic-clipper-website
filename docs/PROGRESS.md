# Progress

Phase: 7 | Branch: phase-7-rubric

## Done

- Caption presets, centered safe-area captions, hook-title overlays, and opt-in YuNet face tracking.
- Pause trim: gaps over 600 ms between words are cut to a 120 ms breath on each side. Leading and trailing silence uses the same pad.
- Captions are retimed onto the concatenated timeline. Manifest `duration` is the rendered length; `start` and `end` stay the source window.
- `bun run check` covers the span math, FFmpeg concat args, and a real trimmed fixture.

## Next

- Layout presets (blurred background, stacked).

## Known bugs / open questions

- `assets/raw/sample.mp4` is a song and yielded no candidates.
- Face tracking quality depends on face size and visibility in the five-second samples.
- Cached clips keep the old cut until a rerender with `--force` or the UI render button.

## Run

- `bun run check`
- `bun run start`
- `bun run src/cli.ts video.mp4 --force`
