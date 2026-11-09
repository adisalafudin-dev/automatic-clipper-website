# Phase 4 model comparison

Compared the same tuned baseline prompt on five inputs: Gordon Ramsay, `sample.mp4`, Suni Lee, Randy Orton, and the cached transcript from the earlier `your-video.mp4` gate. The song sample returned no valid clips for any alias and is excluded from speech latency averages.

| 9Router alias | Clips (Gordon / song / Suni / Randy / prior speech) | Mean speech latency | Mean model self-score | Actual response model(s) |
| --- | ---: | ---: | ---: | --- |
| `hermes-main` | 8 / 0 / 4 / 4 / 3 (19 total) | 39.2 s | 8.26 | `nvidia/nemotron-3-ultra-550b-a55b`, `openai/gpt-oss-120b` |
| `hermes-gemini` | 8 / 0 / 3 / 6 / 4 (21 total) | 115.7 s | 8.38 | `gemini-3-flash-preview` |
| `hermes-nvidia-ollama` | 8 / 0 / 3 / 3 / 4 (18 total) | 61.1 s | 8.43 | `nvidia/nemotron-3-ultra-550b-a55b` |

All 15 runs completed. Every saved candidate passed the 30–90 second and non-overlap filters. Scores are assigned by the proposing model, not an independent quality measure. `hermes-main` was fastest on the four speech inputs, with candidate counts and self-scores close to the other aliases, so it is the default. Its actual response model can vary through 9Router fallbacks.

## Prompt tuning

The comparison baseline already requested varied non-overlapping options, excluded sponsor reads, and asked for at least five final clips where possible. After reviewing results, the live prompt was tightened to require fact-grounded concise hooks, prioritize accuracy, avoid sensational claims, and avoid exposing private third-party crisis, health, or financial details. This final prompt was not re-run against the comparison set.

## Excluded input

At user direction, the `Lets Talk.mp4` comparison is excluded. Its transcript had already been sent to the three aliases before sensitive material was recognized; no further calls used it. The cached output is not included here.
