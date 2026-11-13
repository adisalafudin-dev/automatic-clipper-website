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
- **Queue (UI phase):** in-process, one render at a time
.

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

**Phase 8: Dockerize.** Dockerfile (Bun base image, Linux ffmpeg, a Linux whisper.cpp `whisper-cli` build), `.dockerignore`, `docker-compose.yml`, run notes in `README.md`.
Rules:
- Target is Linux containers on Docker Desktop (Windows). The Windows-only rules in section 10 apply to running on the host, not inside the container.
- Do not bake secrets, `.env`, Whisper models, or videos into the image. Pass `.env` at runtime and mount models and `data/` as volumes.
- 9Router runs on my phone on termux with the IP of 192.168.1.19 and port 5678 .
- Whisper binary and model paths are configurable by env, with Linux defaults in the container.
- One container for API + UI + worker. Keep render concurrency at 1.
Exit check: `docker compose up` on a clean checkout processes a sample video end to end, the clips match a non-Docker run, `data/` persists across restarts, and the image contains no secrets.

**Phase 9: Content modes (gaming streamer first)**

Goal: one pipeline, several content modes. A mode is a `ModeProfile` object in
`src/modes.ts` (decision: 2026-11-13, see DECISIONS.md). The pipeline reads the
profile only and never branches on the mode name. Adding a mode = adding one
object. Modes: `default` (= current behavior, must not change), `gaming`, `podcast`.

Rules for this phase:
- Do the steps in order. Each step: implement, add tests for the pure logic,
  run all tests, update docs/PROGRESS.md, add one line to docs/DECISIONS.md for
  any real decision, then commit. Continue to the next step without waiting.
- Add a ModeProfile field only in the step that uses it.
- `default` mode output must stay identical to before this phase.
- If a decision has tradeoffs, pick the recommended option, record it in
  DECISIONS.md, and continue. Stop and ask only if it would contradict an
  existing DECISIONS.md entry or needs a new dependency.
- Keep the Windows rules: Bun.spawn with arg arrays, path.join, FFmpeg run in
  the job folder with short relative names for subtitle files.
- Verify FFmpeg flags and API fields against docs or a real run. Do not guess.
- If the Dockerfile needs new files (e.g. glossaries), update it in the same step.

### Steps
- 9.1 modes.ts: ModeProfile type (name, description), MODES, getMode, listModes.
  (may already exist; check). Tests: default fallback, unknown name throws,
  inherited names like "toString" rejected.
- 9.2 CLI: `--mode <name>` flag (default: `default`). Validate with getMode, fail
  with a clear message listing valid modes. Save `mode` in the job metadata and in
  clips.json. Re-running from a later stage reuses the saved mode unless overridden.
- 9.3 API + UI: `GET /modes` returns listModes(). Job creation accepts `mode`
  (validated, stored per job in SQLite). In web/ add a "Mode" dropdown filled from
  /modes. Re-render and retry use the job's stored mode.
- 9.4 Split-screen layout (gaming): add `layout: "center-crop" | "split"` to the
  profile. Split = facecam region on top, main content below, stacked into 1080x1920
  (crop + scale + vstack in filter_complex). Facecam rectangle is configurable
  (normalized x, y, w, h) via profile default and per-job override (CLI flag and
  UI field). No auto-detection yet. Captions sit near the seam or lower third.
  Tests: pure function that builds the filter graph string (snapshot-style).
  Keep the FFmpeg command commented.
- 9.5 Audio energy scoring: compute loudness per sentence window with FFmpeg,
  cache to audio_energy.json in the job folder, normalize across the video
  (percentile or z-score, document the choice). In Pass 2 combine:
  final = (1 - w) * llmScore + w * energyScore(0-10), with `audioWeight` w in
  the profile (gaming higher, podcast low, default 0 = unchanged behavior).
  Tests: normalization, combination, weight 0 equals the LLM score.
- 9.6 Transcript glossary: per-mode `glossaries/<mode>.json` mapping wrong -> right
  (Indonesian slang, streamer and game names). Case-insensitive whole-word
  replacement applied after transcription and before chunking/captions, keeping
  word timestamps (a multi-word phrase maps onto its time span). Missing file = no-op.
  Tests: single word, multi-word, case, no match.
- 9.7 Metadata generator: per clip, one LLM call through generateJson with schema
  {title, description, hashtags[]}, language Indonesian, input = that clip's
  transcript only. Sequential calls, retry once on invalid JSON, then log and skip.
  Write into clips.json. Log the model name returned. Tests: schema validation
  and the retry/skip path with a fake LLM client.
- 9.8 Caption presets: `captionPreset` in the profile selects ASS style presets
  (font, size, colors, highlight color, position). Tests: preset -> ASS style
  line builder.
- 9.9 Hook title overlay: show the clip's hook/title for the first ~2-3 s, styled
  by the preset. Tests: overlay timing and text escaping.
- 9.10 Zoom punch-in (optional, experimental): benchmarked on the local CPU and
  dropped after a matched short fixture rose from 0.35s to 0.55s (+55%); see
  DECISIONS.md. Do not add it back without a new user request.
- 9.11 Wrap-up: update README/AGENTS.md usage for modes, rebuild the Docker image,
  run one end-to-end job per mode on a short fixture video.

### Current profile values and use
- CLI: `bun run src/cli.ts video.mp4 --mode gaming --facecam-rect 0.68,0.04,0.28,0.28`.
- The UI loads Default, Gaming, and Podcast from `GET /modes`; saved jobs reuse their mode for rerenders.
- gaming: split facecam layout, audioWeight 0.3, gaming glossary, Bold captions.
- podcast: center-crop layout, audioWeight 0.1, Clean captions.
- default: current center-crop behavior, Classic captions, audioWeight 0.
- Audio energy blends percentile-normalized RMS loudness with the LLM score; weight 0 leaves ranking unchanged.



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
