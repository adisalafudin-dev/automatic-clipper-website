# Progress

Phase: 6 | Branch: phase-6-local-ui | Gate: passed

## Done

- Added local video upload, recent jobs, and per-stage progress UI.
- Added rendered clip previews, trim controls, custom caption edits, and queued rerender.
- Kept UI static and same-origin; API remains in its own module.
- `bun run check`: typecheck passed; 22 tests passed, including edited-caption FFmpeg integration.
- Production server smoke: UI, JS, CSS, and `/health` all returned 200.

## Next

- Await user go before the next phase.

## Known bugs / open questions

- `assets/raw/sample.mp4` is a song and yielded no candidates.
- 9Router aliases may resolve to different response models; hermes-main remains selected.

## Run

- `bun run check`
- `bun run start` then open `http://127.0.0.1:3000`
