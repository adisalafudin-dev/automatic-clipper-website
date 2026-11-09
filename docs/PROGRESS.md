# Progress

Phase: 7 | Branch: phase-7-polish | Gate: passed

## Done

- Added Classic, Bold, and Clean caption presets and optional hook-title overlays.
- Captions are center-aligned in the 9:16 safe area to avoid account and channel UI near the bottom.
- Added opt-in YuNet face tracking through CPU ONNX Runtime; center crop stays default.
- Sparse five-second samples, smoothed crop path, center fallback, and configurable model path.
- Added CLI/UI/API opt-in, SQLite migration, model checksum download, and fallback tests.
- Real smoke: detected face centers locally and rendered one 30.53 s 9:16 tracked clip from cached pipeline artifacts.
- `bun run check`: typecheck passed; 28 tests passed, including dynamic-crop, edited-caption, 129 MiB streaming, and multipart-compatibility coverage.
- Production smoke: UI and `/health` returned 200; existing SQLite schema migration passed.
- Rerendered the latest four-clip job with centered captions; ffprobe confirms 1080x1920.

## Next

- Await user go before Phase 8.

## Known bugs / open questions

- `assets/raw/sample.mp4` is a song and yielded no candidates.
- Face tracking quality depends on face size and visibility in the five-second samples.

## Run

- `bun run check`
- `bun run download-face-model` (opt-in face tracking only)
- `bun run start`
- `bun run src/cli.ts video.mp4 --face-track`
