# Progress

Phase: LOCAL CLIP FEEDBACK | Branch: main

## Done

- Added editor buttons to mark clips “Layak diposting” or “Lewati”, with optional skip reasons.
- Feedback is validated and saved per job to local `feedback.json`; it never calls 9Router.
- Clip deletion also removes its saved feedback.
- Rebuilt the Docker app and confirmed health plus the local feedback field.
- API tests cover both decisions, local persistence, invalid reasons, and cleanup; `bun run check`: 83 tests pass, 308 assertions.

## Next

- Label real generated clips locally to start measuring the acceptance rate.

## Known bugs / open questions

- Whisper can still repeat words over music or speech-like audio; no generic repeat removal was added.

## Run

- `bun run check`
- `bun run start`
- `docker compose up --build`
