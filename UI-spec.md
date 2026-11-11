# UI-SPEC.md — Phase 6: Local web UI (upload, progress, preview, trim, caption edit, re-render)

Read this together with `AGENTS.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md`. Do not contradict `DECISIONS.md` without asking.
Work one step at a time (6.0 → 6.7). After each step: run tests, update `docs/PROGRESS.md`, commit, stop and report in 3-5 lines.
Be token-efficient: no tutorials, no restating this spec, no unrequested refactors or dependencies.

## Preconditions

- Phase 5 is done: local API + SQLite + per-stage job status work, and the CLI pipeline works end to end.
- If an endpoint below is missing, add it in Step 6.0, not scattered across later steps.
- The API stays separate from the UI. The UI talks to the API only over HTTP + JSON. No imports from `src/pipeline` in the UI code.

## Stack decisions (record these in DECISIONS.md in Step 6.1)

- React + TypeScript (strict) for the UI, in `web/`. Replace the current plain `index.html/app.js/styles.css` in that step.
- Only `react` and `react-dom` as runtime deps. No router, no state library, no CSS framework, no component library. Plain CSS.
- Serve and bundle with Bun (`Bun.serve` + HTML import / Bun bundler). **Verify the exact API in the docs of the installed Bun version before writing code; do not assume.** If it does not work cleanly, stop and ask me; fallback is Vite as a separate dev server.
- Two views only, switched by state: `JobList` and `JobEditor`. No router until a real need appears.
- Progress updates: polling every 2 s first. SSE is a later upgrade, not now.
- Data fetching: small hand-written `api.ts` client with typed functions. No fetching library.

## API contract the UI needs

All JSON unless stated. Names can be adapted to what already exists; keep types in one shared file (`src/types.ts`) and import them into the UI as types only.

| Method + path                             | Purpose                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/jobs` (multipart)              | upload video, returns `{ jobId }`                                                                                                                |
| `GET /api/jobs`                           | list jobs: id, filename, status, createdAt                                                                                                       |
| `GET /api/jobs/:id`                       | `{ status, stage, progress, error?, clips[] }`                                                                                                   |
| `GET /api/jobs/:id/source`                | source video, **must support HTTP Range** so seeking in `<video>` works. Verify whether Bun's file response handles Range; if not, implement it. |
| `GET /api/jobs/:id/transcript`            | sentences with ids, start/end ms, and words with start/end ms                                                                                    |
| `PATCH /api/jobs/:id/clips/:clipId`       | update `startMs`, `endMs`, `title`, edited caption words                                                                                         |
| `POST /api/jobs/:id/clips`                | create clip from `{ startMs, endMs }` (used by "clip from selection")                                                                            |
| `DELETE /api/jobs/:id/clips/:clipId`      | remove clip                                                                                                                                      |
| `POST /api/jobs/:id/clips/:clipId/render` | enqueue render, returns immediately                                                                                                              |
| `GET /api/jobs/:id/clips/:clipId/file`    | rendered mp4 (Range supported)                                                                                                                   |

Rules:

- Clip edits are stored as **milliseconds** (`startMs`, `endMs`) plus edited caption words. Sentence IDs are only for the LLM stage.
- Keep the original LLM-proposed `origStartMs/origEndMs` so "Reset" works.
- Clip fields: `id, jobId, title, hook, score, startMs, endMs, origStartMs, origEndMs, renderStatus (none|queued|rendering|done|failed), renderError?, renderedAt?, captionWords[]`.
- Render queue: in-process, concurrency 1. A re-render after an edit marks the old file stale (`renderStatus` back to `none` on edit).
- Validate on the server too: `0 <= startMs < endMs <= videoDuration`, reject otherwise with a clear 400 message.

## UI behavior

### Job list

- Upload button (file input, `.mp4` etc.), list of jobs with stage + progress, click opens `JobEditor`.
- Failed jobs show the error message and a "Retry from stage" action only if the pipeline already supports it.

### JobEditor layout

- Left: clip list (title, duration, score, render status badge).
- Center: video player + trim controls for the selected clip.
- Right: transcript and caption editor.

### Preview (non-destructive)

- Play the **source** video, not a rendered file. Clip preview = seek to `startMs`, play, pause at `endMs`. Loop toggle.
- Preview captions are a plain text overlay for the current word group. Burned-in ASS output is the source of truth and will look different. Show a small note: "Preview only, final look is rendered".

### Trim

- Two number inputs (start, end, `mm:ss.mmm`) plus a simple two-handle range bar over a window of the source around the clip (clip ± 30 s). No canvas timeline, no waveform in this phase.
- Buttons: set start = current time, set end = current time, nudge ±100 ms, jump to start, jump to end.
- Toggle "snap to word boundaries" (default on): start snaps to the nearest word start, end to the nearest word end.
- Show duration live. Warn (not block) when outside 30-90 s.
- Keyboard: `Space` play/pause, `[` set start, `]` set end, `←/→` ±100 ms (shift = ±1 s), `L` toggle loop. Ignore shortcuts while typing in an input.
- Reset button restores `origStartMs/origEndMs`.

### Caption editor

- Show the words inside the clip range, grouped in lines. Click a word to seek to it. The currently playing word is highlighted.
- Edit **text only** in v1 (fix misheard words). Word timings are not editable in v1. Deleting a word removes it from captions; inserting is not supported in v1.
- Edits are stored per clip; changing trim re-derives the words from the transcript but keeps text edits for words that still exist (match by word index in the transcript).

### Clip from selection

- In the transcript panel, select a range of sentences, press "Create clip from selection" → `POST` clip with that sentence range's start/end.

### Render

- "Render" button per clip, "Render all stale" for the job. Show status badges; poll while any clip is `queued`/`rendering`.
- When `done`: inline player of the rendered file + download link. On failure show `renderError`.

## Steps

**6.0 API gap check.** List which endpoints above exist. Add the missing ones with tests (validation, Range support). No UI code yet.
Done when: `bun test` passes and a short `curl` script in `docs/` exercises each endpoint.

**6.1 React scaffold served by Bun.** Replace `web/` plain files with React + TS. Show the job list fetched from `GET /api/jobs`. Record stack decisions.
Done when: `bun run dev` serves the UI and the list renders real jobs.

**6.2 Upload + progress.** Upload, polling of `GET /api/jobs/:id`, stage/progress display, error display.
Done when: a real upload runs through the pipeline and the UI shows stages until done.

**6.3 Clip list + source preview.** `JobEditor` shell, clip list, player that plays the selected clip range from the source and pauses at the end.
Done when: selecting a clip seeks and plays exactly that range; seeking works (Range OK).

**6.4 Trim editor.** Number inputs, range bar, set-from-playhead, nudge, snap, reset, keyboard, `PATCH` on change (debounced 500 ms, save indicator).
Pure logic in `web/lib/trim.ts` with `bun test`: clamp, snap-to-word, duration validation, ms ↔ `mm:ss.mmm`.
Done when: trimmed values persist after reload and the rendered clip (Step 6.6) uses them.

**6.5 Caption editor.** Word list, click-to-seek, current-word highlight, text edit, store edits, preserve edits across trims.
Pure logic tested: derive words for range, merge edits after trim change.
Done when: an edited word appears in the next render's ASS file.

**6.6 Re-render + status.** Render per clip and "render all stale", status badges, inline result player, download.
Done when: edit → render → new mp4 reflects both the trim and the caption edit; only one render runs at a time.

**6.7 Clip from selection + delete + polish.** Create from transcript selection, delete clip, empty/error states, keyboard shortcut help.
Done when: all flows above work on a real 30-60 min job without console errors.

## Tests and quality

- Pure logic gets `bun test` unit tests in the step that introduces it. UI components get no snapshot tests; instead each step ends with a short manual checklist in `docs/PROGRESS.md`.
- No silent failures: every failed request shows a visible error with the server message.
- Never block the UI thread with heavy work. No transcript re-parsing on every render; parse once, memoize.
- Keep components small (one file each, under ~200 lines). If a file grows beyond that, split it and say so in the report.
- Windows: use `path.join`, no hard-coded separators in server code.

## Recommended features and priority

**Must (this phase):** trim with snap, caption text edit, re-render, reset, delete, clip from transcript selection, render status.

**Should (small follow-ups, only after 6.7 works):**

- Hook/title text edit (stored now, overlay is Phase 7).
- Undo/redo for trim (simple history stack per clip).
- Export all rendered clips as a zip.
- Per-clip notes field.
- Search in transcript.

**Later (Phase 7 or beyond, do not start without asking):**

- Waveform under the range bar (needs peaks extraction, heavier).
- Word timing editing.
- Caption style presets and live-styled preview.
- Face-tracked reframing preview.
- SSE instead of polling.
- Auth / multi-user (only if the app is ever published; keep API stateless-friendly until then).

## Out of scope for Phase 6

Accounts, billing, cloud storage, YouTube link import, Docker (final phase), mobile layout.
