# Progress

Phase: TRANSCRIPTION FIX | Branch: main

## Done

- Phase FIX restored automatic clip generation, language detection, and clear failure states.
- Gaming split layout and face tracking were corrected; local project clips were rerendered and Docker is healthy.
- Added a transcription-fix plan to AGENTS.md; implementation is next.
- `bun run check`: 77 tests pass, 294 assertions.

## Next

- Inspect Whisper hallucinations during silence, evaluate VAD, add pure-logic tests, and rerun a problematic transcript.

## Known bugs / open questions

- Whisper `base` can repeat hallucinated phrases during silence; VAD mitigation is not implemented yet.
- The local whisper.cpp checkout and `.vscode/` files are untracked local data and excluded from commits.

## Run

- `bun run check`
- `bun run start`
- `bun run dev`
- `docker compose up --build`
