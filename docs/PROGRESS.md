# Progress

Phase: CLIP QUALITY TUNING | Branch: main

## Done

- Reviewed local feedback: 3 clips skipped, all for weak payoff.
- Tightened selection to require an explicit transcript payoff and score at least 7.
- Low-scoring proposals get one retry, then are excluded instead of filling the clip list with weak choices.
- `bun run check`: 84 tests pass, 313 assertions.

## Next

- Rebuild the app, then retry selection to review the stricter results.

## Known bugs / open questions

- Retrying selection sends transcript text to 9Router; local ratings remain private.
- The score is a model estimate, not a guarantee of platform performance.

## Run

- `bun run check`
- `bun run start`
- `docker compose up --build`
