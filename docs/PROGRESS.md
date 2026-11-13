# Progress

Phase: 9 | Branch: phase-9-content-modes

## Done

- Phase 7 polish, caption/layout presets, title overlays, face tracking, and pause trimming are complete.
- UI-spec Phase 6 API and browser editor features are complete.
- Phase 8 Docker setup is complete; English and Bahasa Indonesia upload options are supported.
- Phase 9.1–9.11 complete: Default/Gaming/Podcast profiles, split layout, energy scoring, glossaries, metadata, caption presets, and Docker mode e2e.
- Experimental zoom was dropped after a measured 55% slowdown on a short CPU fixture.
- Follow-up: UI/API cancellation stops queued jobs and aborts active child processes.
- `bun run check` covers unit and FFmpeg integration tests.

## Next

- Phase 9 gate complete; wait for approval before Phase 10.

## Known bugs / open questions

- Live Whisper/9Router and full Docker pipeline e2e remain unverified without a sample video and configured model/key; Docker SQLite uses its named volume and face tracking depends on visibility.
- The staged `whisper.cpp` gitlink is user data and excluded from project commits.

## Run

- `bun run check`
- `bun run start`
- `bun run dev`
- `docker compose up --build`
