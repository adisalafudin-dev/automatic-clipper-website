# Progress

Phase: PHASE FIX | Branch: phase-9-content-modes

## Done

- Upload keeps automatic clipping and language detection, with optional content mode and face tracking controls.
- Gaming now crops the bottom-right facecam by default, accepts a custom crop, and tracks faces within that window while excluding the camera overlay from gameplay.
- Missing face-tracking model now reports an actionable error; YuNet is installed in the local Docker volume.
- Re-rendered both clips of the user's Gaming project; project is completed and both clip files were refreshed.
- No-speech and no-valid-candidate outcomes fail clearly; empty projects can retry selection with cached transcript.
- Docker startup is healthy; phase 7–9 editing, layouts, content modes, cancellation, and named projects remain available.
- `bun run check`: 77 tests pass, 294 assertions.

## Next

- Improve Indonesian recognition only with reviewable caption edits or an explicitly chosen larger Whisper model; `base` still mishears some words.

## Known bugs / open questions

- Indonesian Whisper `base` output contains occasional word errors; this fix changes framing, not recognition quality.
- Real 30–60 minute Whisper/9Router processing remains unverified. The staged `whisper.cpp` gitlink is user data and excluded from project commits.

## Run

- `bun run check`
- `bun run start`
- `bun run dev`
- `docker compose up --build`
