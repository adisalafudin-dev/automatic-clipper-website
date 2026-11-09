# AGENTS.md: Local Video Clipper

Read this at the start of every session. Goal: a **working app**, built efficiently, with tests. I do not need explanations or teaching.

## 1. Project

A CLI tool (web UI later) that takes one long video (30-60 min) and produces 5-10 short vertical clips (30-90 s) with burned-in captions, plus `clips.json`. It runs **locally on my Windows PC**. Not published, but it may be later, so avoid choices that make that painful.

Out of scope for now: accounts, billing, cloud deployment, YouTube link downloading.

## 2. How to work (token-efficient)

**Autonomy:** work through a whole phase on your own. Do not stop after each step. Stop only at the **phase gate**, or when blocked by something only I can decide or do.

**Output rules (strict):**

- No announcements, plans, or explanations of what you are about to do. No teaching, no concept explanations, no recaps of code you wrote.
- Do not paste full files or long command output into chat. Show only failures and the key lines of evidence.
- Status messages: **5 lines max** (done, tests, next, blockers).
- Do not re-read files you already know. Use targeted search and partial reads.
- No extra docs beyond `docs/PROGRESS.md`, `docs/DECISIONS.md`, and a short `README.md` (how to run). No comments that restate code.
- Do not research at length. If the answer is in the official docs or `--help` output, check that once, then act.

**Decide, don't ask,** when the choice is reversible and low-impact. Pick the simpler option, write one line in `docs/DECISIONS.md`, and continue.

**Ask me first only for:**

- Destructive actions (deleting my files, `git reset --hard`, history rewrites, force push).
- Anything that needs Python, CUDA/ROCm, a paid service, or a large download (over about 500 MB).
- Sending transcripts of videos that look sensitive to the upstream LLM provider.
- Real design tradeoffs that change architecture or are costly to reverse. Give 2-3 options and a recommendation in a few lines.
- Contradicting `docs/DECISIONS.md`.

**Dependencies:** prefer Bun built-ins and the standard library. Add a well-known package when it clearly saves effort, and log it in `DECISIONS.md` with a one-line reason. Do not add frameworks the pipeline does not need.

**When stuck:** after two failed attempts at the same problem, stop and report the exact error and your best hypothesis in a few lines. Never weaken or delete a test just to get green. Do not invent library APIs or CLI flags: check `--help` or the docs.

## 3. Session start and end

**Start:** read `docs/PROGRESS.md` and `docs/DECISIONS.md`, run `git status`. Then continue the current phase. Only message me if something is wrong.

**End of each work chunk:** overwrite `docs/PROGRESS.md` (keep it under 30 lines: current phase, done, next, known bugs, run commands). Add a line to `docs/DECISIONS.md` for every decision: `YYYY-MM-DD | decision | reason`.

## 4. Testing

Every feature ships with tests in the same commit. Use `bun test`.

| Level       | What                                                                                                                                                    | Rules                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Pure logic: chunking, sentence IDs, ID-to-time mapping, overlap removal, length enforcement, caption builder, JSON validation, FFmpeg argument builders | Fast, no disk, no network, no real FFmpeg. Assert the argument array for FFmpeg builders.                                                                                        |
| Integration | Real FFmpeg/ffprobe on a tiny generated fixture                                                                                                         | Generate with FFmpeg `lavfi` sources (`testsrc`, `sine`), under 5 s. Verify with `ffprobe` (sample rate, channels, dimensions, duration). Commit a fixture only if under 500 KB. |
| Live smoke  | Real Whisper on a 10-30 s sample, real 9Router call                                                                                                     | Opt-in via `RUN_LIVE=1`. Never part of `bun run check`.                                                                                                                          |
| Phase e2e   | Whole pipeline so far on a real 5-10 min sample video                                                                                                   | Run at each phase gate.                                                                                                                                                          |

Rules:

- Fake the LLM in tests with a client implementing the same `generateJson` interface. Cover valid JSON, invalid JSON (retry once, then skip chunk and log), schema failure, and sentence IDs out of range.
- Never run real Whisper in unit tests. Build Whisper fixtures from a **real run's output**, not from a guess about the format.
- Bug found: add a failing test, then fix.
- Test behavior, not implementation. Deterministic tests, temp folders, clean up.
- Scripts (create early): `bun run test`, `bun run typecheck` (strict, no emit), `bun run check` (typecheck + test). **`bun run check` must be green at every commit.**

## 5. Code standards

- Bun + TypeScript strict. No `any` (use `unknown` and narrow).
- Pure logic separate from I/O. Spawning processes and disk access live at the edges.
- Clear, actionable error messages on every failure. No silent failures.
- Log stage timings.
- Machine output (JSON files) is separate from human logs.

## 6. Git

- `git init` at the start, commit `.gitignore` first (`data/`, `.env`, `node_modules/`, models, binaries).
- One branch per phase (`phase-1-transcription`), one commit per feature, message like `phase-1: extract audio to 16 kHz mono WAV`.
- Merge to `main` only after the phase gate and my "go".
- Never commit secrets, `.env`, videos, audio, models, or `data/`. Commit `.env.example` with placeholders.
- Never print or log API keys. Never touch files outside this repo.

## 7. Architecture

- Each stage writes its output to disk. A stage that finds its output skips unless forced. Stages are idempotent. Transcription is the slow part, so always cache it.
- Job layout: `data/jobs/<jobId>/{input, audio, transcript.json, candidates.json, clips/}`.
- Fixed, deterministic pipeline. No agent framework.
- Keep the API separate from the UI (later) so publishing stays possible.

## 8. Pipeline and LLM rules

1. Extract audio: FFmpeg to 16 kHz mono WAV.
2. Transcribe: Whisper with **word-level timestamps**, stored as JSON.
3. Chunk: overlapping chunks of about 4-8K tokens, cut at sentence boundaries. Every sentence has a stable integer ID.
4. Pass 1 (per chunk): LLM proposes candidate clips as JSON.
5. Pass 2 (global): rank, remove overlaps, keep top 5-10, snap to sentence boundaries, enforce 30-90 s.
6. Reframe: center crop to 9:16 first. Face tracking is a later improvement.
7. Render: FFmpeg cut + crop + burned-in captions (ASS with word highlighting) + `loudnorm`.

LLM rules:

- The LLM sees only the transcript, never the video.
- It returns **sentence IDs**, never timestamps. Code maps IDs to times.
- Output is strict JSON validated against a schema. Invalid: retry once, then log and skip the chunk.
- Never send a whole 1-hour transcript in one call. Always chunk.
- Candidate shape: `{ startSentenceId, endSentenceId, hook, title, score (0-10), reason }`.

**Access goes through 9Router** (dashboard `http://localhost:20128/dashboard`), OpenAI-compatible at `http://localhost:20128/v1` (`POST /v1/chat/completions`).

- `.env` (never committed): `LLM_BASE_URL`, `LLM_API_KEY` (from the dashboard), `LLM_MODEL` (alias or combo name from the dashboard; ask me once which one).
- Client behind one interface `generateJson(prompt, schema)` so the backend can be swapped.
- Verify with a real test call before relying on request fields like JSON mode or `response_format`.
- The answering model may vary because of fallbacks: log the model name from each response.
- Retry with backoff on rate limits. Keep chunk calls sequential.

## 9. Decisions already made

Also in `docs/DECISIONS.md`. If they differ, `DECISIONS.md` wins and you tell me.

- **Transcription:** whisper.cpp prebuilt Windows binary (no Python) via `Bun.spawn`. Default model `base` (configurable, `small` optional). Word timestamps from the whisper-cli JSON token offsets. Check the real output shape before writing the parser.
- **LLM:** all calls through 9Router.
- **Runtime:** Bun + TypeScript strict. SQLite via `bun:sqlite` when state is needed. No Postgres or Redis.
- **Rendering:** CPU `libx264` by default.
- **Queue (UI phase):** in-process, one render at a time.

## 10. Machine and Windows rules

- Windows, Ryzen 5 3550H (4 cores / 8 threads), 16 GB RAM, Radeon RX 560X 4 GB. **Plan for CPU only**: nothing that needs CUDA or ROCm.
- Whisper is the heavy CPU job. Do not run it at the same time as rendering. Log real speed.
- `Bun.spawn` with an **argument array**, never one shell string.
- FFmpeg `subtitles` filter breaks on `C:\...` paths: run FFmpeg with the **working directory set to the job folder** and use a short relative subtitle filename.
- Use `path.join`, never hard-coded `/` or `\`.
- At startup check `ffmpeg` and `ffprobe` are on PATH, fail with a clear message if not.

## 11. Phases and exit checks

Work through each phase fully, then stop at its gate. Phase 0 is done silently at the start of Phase 1 (docs, `git init`, `.gitignore`, scripts).

**Gate report (10 lines max):** what works, the command to run it, evidence from the exit check, open issues. Then wait for my "go".

**Phase 1: Transcription.** Bun project and strict config, ffmpeg/ffprobe check, audio extraction, whisper.cpp config and run, parse output into a `Transcript` type with word timestamps, cached `transcript.json`, CLI command.
Exit check: on a real 5-10 min video, `transcript.json` is valid, word timestamps are monotonic and within audio length, a second run hits the cache, `bun run check` is green.

**Phase 2: Clip selection.** Sentence splitting with IDs, chunking with overlap, LLM client interface with fake, 9Router backend (verify JSON mode), schema validation with retry, pass 1 and pass 2, `candidates.json`, CLI command.
Exit check: on the real video, `candidates.json` has 5-10 clips, valid times, 30-90 s each, no overlaps, and the hooks read sensibly.

**Phase 3: Rendering.** FFmpeg cut, 9:16 center crop, ASS captions with word highlighting (Windows path rule), `loudnorm`, `clips.json`, one CLI command end to end.
Exit check: one command turns `video.mp4` into N clips plus `clips.json`. `ffprobe` confirms 9:16 and durations, and I can watch the clips with captions aligned.

**Phase 4: Model comparison and prompt tuning.** Compare 2-3 models or combos through 9Router on the same 5 videos, tune the prompt, pick a default. Exit check: short comparison note in `docs/` and a chosen default.

**Phase 5: API and job state.** `Bun.serve` API, SQLite, in-process queue (concurrency 1), progress per stage. Tests use in-memory SQLite and `fetch` against a test server.

**Phase 6: Local web UI.** Upload, progress, preview, trim, caption edit, re-render. UI separate from the API.

**Phase 7: Polish.** Face-tracked reframing, caption styles, hook-title overlay.

Do not start the next phase until I say "go".

## 12. Legal

Only process videos I own or have permission to use. No bulk-downloading of other people's content.

## 13. `docs/PROGRESS.md` template

```markdown
# Progress

Phase: 1 | Branch: phase-1-transcription

## Done

-

## Next

-

## Known bugs / open questions

-

## Run

- `bun run check`
```
