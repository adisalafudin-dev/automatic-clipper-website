# Progress

Phase: PHASE FIX | Branch: phase-9-content-modes

## Done

- Upload keeps automatic clipping and language detection, with optional content mode and face tracking controls.
- No-speech and no-valid-candidate outcomes fail with a clear reason instead of completing with zero clips.
- Empty-result projects can retry selection using cached audio and transcript; stale rendering appears only when clips exist.
- Clip metadata follows the language detected in the transcript.
- Docker startup fixed by preserving LF line endings; rebuilt container is healthy at `/health`.
- Phase 7–9 editing, layouts, content modes, cancellation, and editable project names remain available.
- `bun run check` covers unit tests and short FFmpeg end-to-end/integration fixtures.

## Next

- Retry existing empty projects; verify a 30-minute Indonesian upload when available.

## Known bugs / open questions

- Real 30–60 minute Whisper/9Router processing remains unverified without the user's source video, configured model, and 9Router key.
- The staged `whisper.cpp` gitlink is user data and excluded from project commits.

## Run

- `bun run check`
- `bun run start`
- `bun run dev`
- `docker compose up --build`
