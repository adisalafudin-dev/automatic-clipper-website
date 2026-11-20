# Progress

Phase: FACE CAM AUTO-DETECTION | Branch: main

## Done

- Added automatic per-clip Gaming facecam location detection from repeated YuNet detections. Gaming gameplay now stays as centered as possible while keeping the facecam outside the crop.
- Added manual rectangle override on upload, YouTube project creation, single-clip rerender, and project rerender settings. Rendered preview cache-busts on every completed render.
- Legacy Gaming projects using the old bottom-right default now auto-detect when rerendered; custom rectangles remain manual. Face tracking follows the selected region.
- Detection falls back to the Gaming bottom-right default if the model finds no stable face.
- `bun run check`: typecheck passes; 103 tests pass with 381 assertions.
- YouTube subtitle HTTP 429 now falls back to audio-only local Whisper, subject to the existing 500 MB limit.
- Audio fallback now selects up to 64 kbps (or the lowest available bitrate) and estimates the 500 MB cap against that smaller format.

## Next

- Rebuild/restart Docker when Docker Desktop is available.
- Windows YouTube downloads need `yt-dlp.exe` and Deno on `PATH`.
- Visually verify auto-detection on a real Gaming clip; no video was run for this change.

## Known bugs / open questions

- A static game character may be mistaken for the facecam; use the manual rectangle override if this happens.
- Docker rebuild remains unverified because Docker Desktop is unavailable.

## Run

- `bun run check`
- `bun run start`
- `docker compose up --build`
