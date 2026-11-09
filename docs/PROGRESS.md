# Progress

## Current position

- Phase: 4 (Model comparison) | Branch: phase-4-model-comparison | Gate: passed

## Done

- Comparison runner caches per-input/model results and runs aliases sequentially.
- Compared hermes-main, hermes-gemini, and hermes-nvidia-ollama on the four raw speech/test inputs plus the prior your-video transcript.
- Excluded Lets Talk.mp4 and replaced it at user direction; no further calls used its transcript.
- Summary and default selection: docs/PHASE4_MODEL_COMPARISON.md; selected hermes-main.
- Tuned prompt for factual concise hooks and privacy; comparison still reflects the baseline prompt.
- `bun run check`: typecheck passed; 17 tests passed.

## Next

- Await user go before Phase 5.

## Known bugs / open questions

- `assets/raw/sample.mp4` is a song and yielded no candidates.
- 9Router aliases may resolve to different response models; prompt v2 awaits evaluation.

## Run

- `bun run check`
- `bun run src/compare.ts --models hermes-main,hermes-gemini,hermes-nvidia-ollama`
