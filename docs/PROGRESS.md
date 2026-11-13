# Progress

Phase: TRANSCRIPTION FIX | Branch: main

## Done

- Enabled Silero VAD, non-speech suppression, no-fallback decoding, and disabled text context; VAD model is checksum-verified.
- Mapped VAD-compressed token offsets back to source-audio time and filtered empty/invalid tokens.
- Reprocessed `potongan_3_1`: valid Indonesian transcript grew from 157 to 2,819 words; “Kau bisa?” repeats fell from 78 to 0.
- Timestamps are monotonic and within the 1,799.99-second audio; preserved original cache under ignored `data/vad-check/`.
- `bun run check`: 83 tests pass, 300 assertions.

## Next

- Retry clip selection in the local UI with the corrected cached transcript; 9Router retry awaits approval.

## Known bugs / open questions

- Whisper can still repeat words over music or speech-like audio; no generic repeat removal was added.
- Docker daemon was unavailable to this session; the entrypoint VAD download/checksum path was not container-tested.

## Run

- `bun run check`
- `bun run start`
- `docker compose up --build`
