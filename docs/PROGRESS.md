# Progress

Phase: CLIP CADENCE FIX | Branch: main

## Done

- Diagnosed clip-10: six speech-gap cuts removed 5.92 seconds and made motion jump between moments.
- Rendered clip-10 with its natural pauses preserved; output is 42.73 seconds at constant 30 fps.
- Verification: FFmpeg integration confirms captions retain source timing and pauses; renderer tests pass.
- Enabled automatic ASS line wrapping and set every caption preset to white text with a black outline, without colored karaoke highlighting or shadow.
- Added an upload checkbox to omit subtitles while retaining layout and face tracking; saved the preference per job and exposed CLI `--no-subtitles`.
- Subtitles remain enabled by default; rerenders reuse the job setting and subtitle-free manifests omit the captions file path.
- `bun run check`: typecheck passes; 86 tests pass with 324 assertions, including a no-subtitles FFmpeg render.
- Removed the local clip rating panel from the job editor.
- Added a YouTube page with manual section download and AI Clip Finder: captions/chat/heatmap parsing, focused 30-second activity windows for 9Router scoring, selected-section download, local Whisper timestamp refinement, and standard project rendering. Docker image includes yt-dlp and Deno.
- `bun run check`: typecheck passes; 99 tests pass with 358 assertions. No live YouTube download run was performed.
- Added per-project Delete controls, a DELETE endpoint, queue cancellation before removal, and cleanup tests for uploaded versus externally selected source videos.
- `bun run check`: typecheck passes; 91 tests pass with 340 assertions.
- Reworked upload UI into a responsive file picker, grouped settings, option cards, and a clearer primary action.
- Improved job editor hierarchy, clip cards, transcript readability, trim tool grouping, and tablet/mobile reflow; TypeScript typecheck passes.
- Added byte-based upload progress and a project-row retry action for failed jobs; retry reruns selection or stale rendering based on saved results.
- Browser uploads stream the original file with XHR byte progress; `bun run typecheck` passes.
- Added local 9Router endpoint, model, and secret settings with server-side connectivity test; UI never reads back the API key. Moved settings to the main navigation, set Docker's host default to `host.docker.internal:20128`, and added per-project rerender settings for mode, face tracking, and subtitles.

## Next

- Rebuild/restart Docker when Docker Desktop is available; the daemon is currently inaccessible from this session.
- Windows YouTube downloads need `yt-dlp.exe` and Deno available on `PATH`.

## Known bugs / open questions

- Docker rebuild remains unverified because Docker Desktop is unavailable.
- Caption wrapping fix and pause-preserving render are in source.

## Run

- `bun run check`
- `bun run start`
- `docker compose up --build`
