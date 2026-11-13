# Decisions

Format: `date | decision | reason`

2026-11-05 | All LLM calls go through 9Router (local gateway, OpenAI-compatible API at http://localhost:20128/v1) | No model inference on this PC, and the backend stays swappable behind one `generateJson` interface

2026-11-05 | Transcription with whisper.cpp prebuilt Windows binary (whisper-cli.exe), called via Bun.spawn | Single binary, no Python, CPU-only friendly; faster-whisper stays the fallback if word timestamps or speed disappoint (decided in Step 1.6)

2026-11-05 | Word timestamps come from whisper-cli `-ojf` token offsets (ms), grouped into words by leading space; special tokens ([_BEG_], [_TT_*]) dropped | `-ojf` output verified on sample: every token has offsets in ms; no need for `-ml 1 -sow`

2026-11-07 | Default Whisper model: base (configurable; small optional) | On a 180 s speech clip: base 29.5 s vs small 82.3 s (4 threads, CPU); accuracy close, with a few small errors each. base is ~6x real time, small ~2.2x

2026-11-09 | Cache transcript.json unless CLI is run with --force | Whisper is the slow stage; existing stage outputs should make reruns idempotent

2026-11-09 | Phase 2 defaults to hermes-main and requests non-streaming JSON responses | Verified response_format and stream=false against 9Router; answering model reported as openai/gpt-oss-120b

2026-11-09 | Pass 2 maximizes the count of valid non-overlapping clips up to ten, then score | This preserves the 5–10 clip gate when high-scoring longer options overlap multiple shorter ones

2026-11-09 | Phase 3 renders center-cropped 1080x1920 H.264, mono AAC with loudnorm, and ASS karaoke captions | CPU encoding is portable; per-word karaoke tags provide the requested highlight and relative captions use Whisper word times

2026-11-09 | Phase 4 compares aliases sequentially with per-video/model caches and adds factuality/privacy guidance to the selection prompt | Sequential calls avoid overlapping gateway load and reruns; grounded hooks reduce unsupported or sensitive third-party framing

2026-11-09 | Phase 4 default: hermes-main | It was fastest on the four speech inputs (39.2 s average) with comparable candidate count and model self-score; 9Router may route to different responding models

2026-11-09 | Phase 5 uses Bun.serve, SQLite job history, and an in-process serial queue | Keeps the API local and state durable while preserving concurrency one for CPU-heavy stages

2026-11-09 | Phase 6 uses a static same-origin UI and the existing API module | Avoids a frontend framework while keeping API routes independent of presentation; local upload and clip edits stay in data/

2026-11-09 | Phase 7 uses onnxruntime-node CPU with OpenCV Zoo YuNet for opt-in face tracking | Windows x64 CPU and Bun Node-API work; the verified model is 232589 bytes, no Python is needed, and detection failures retain center crop

2026-11-09 | Phase 7 samples faces every five seconds, smooths crop centers, and leaves center crop as default | Sparse inference limits CPU use and the opt-in keeps existing renders deterministic

2026-11-09 | Phase 7 renders classic/bold/clean caption presets and hook-title overlays in ASS | Keeps caption and title appearance editable without adding another render dependency

2026-11-09 | Caption presets use vertical and horizontal center alignment | Keeps subtitles in the center safe area, away from short-video account labels and controls near the bottom
2026-11-10 | Pause trim drops inter-word gaps over 600 ms, leaving 120 ms of breath on each side, and trims leading and trailing silence to that pad | Word timestamps are already cached, so dead air can be cut without a second silence detector. Source start and end stay on the clip so manual trims still edit the original range.
2026-11-11 | Phase 7 layout presets are center crop, blurred background with a fitted foreground, and two stacked fitted panels | Offers common vertical treatments through the existing per-clip edit and rerender flow, with crop remaining the default.
2026-11-11 | The FFmpeg render integration test has a 20-second per-test timeout | It runs several real 1080x1920 renders and exceeded Bun's generic 5-second test timeout on this Windows host; all output assertions remain active.
2026-11-11 | Continue with UI-spec.md after Phase 7 and before Phase 8 | The user explicitly requested the UI specification work and Dockerization without pausing at phase gates.
2026-11-11 | Keep UI API routes under the existing `/jobs` prefix and add the missing source, transcript, clip, and range behavior there | Preserves existing browser and CLI compatibility while satisfying the UI flows.
2026-11-11 | Typecheck and test project files only; `bun run test` targets `src` and TypeScript excludes the untracked `whisper.cpp` tree | Keeps this repository's checks isolated from a separate source tree present in the workspace.
2026-11-11 | UI uses React 19 and React DOM with TypeScript, plain CSS, and Bun HTML imports | Implements UI-spec while keeping the same-origin Bun server and avoiding a separate frontend server or state/router packages.
2026-11-11 | Trim edits retain original millisecond bounds and allow any positive in-source interval, with a UI warning outside 30–90 seconds | Supports non-destructive reset and follows UI-spec's warning-only duration behavior while validating source bounds on the server.
2026-11-11 | Caption text overrides are stored by transcript word index and retain the original word timestamps | Trim changes can rederive the visible words while preserving edits for all transcript words that remain in range.
2026-11-11 | Per-clip render state lives in the existing edits.json; the queue merges per-clip and stale-only results into the stored manifest | Keeps durable UI status in the current job layout and prevents one clip render from replacing other clip results.
2026-11-11 | Transcript selection uses a clicked anchor and shift-click to extend the sentence range | Allows deterministic range selection without adding a timeline or selection library.
2026-11-11 | Docker builds whisper.cpp for CPU in a Linux build stage and keeps the base model in a persistent host-mounted volume | Keeps compiler and model out of the runtime image while supporting first-run transcription.
2026-11-11 | Docker Compose runs the UI, API, and worker in one container and mounts `data/` and `models/` | Matches the local single-queue architecture and keeps generated media and model files persistent and out of the image.
2026-11-11 | Container 9Router defaults to `http://192.168.1.19:5678/v1` and remains configurable through environment variables | Matches the configured phone endpoint while allowing other network setups.
2026-11-12 | Docker stores SQLite in a named Linux volume, separate from the Windows bind-mounted media directory | Prevents SQLite WAL and locking from depending on Windows bind-mount file semantics while keeping uploads and renders host-visible.
2026-11-12 | Use `http://192.168.1.13:20128/v1` as the current 9Router endpoint | The user corrected the earlier phone address; the models endpoint returned HTTP 200 from both Windows and Docker.
2026-11-12 | Add English and Bahasa Indonesia as per-upload language choices | The choice is saved on each job so Whisper and candidate metadata use the same selected language without changing existing English defaults.
2026-11-13 | Phase 9.1 defines immutable `default`, `gaming`, and `podcast` profiles; missing mode resolves to `default`, invalid modes throw | Centralizes the supported names and preserves current behavior as the compatibility default.
2026-11-13 | CLI mode precedence is explicit `--mode`, saved `job.json` mode, then `default` | Reruns reuse the original profile by default while allowing an intentional override.
2026-11-13 | Phase 9.3 stores each job's mode in SQLite and returns mode profiles as a JSON array from `GET /modes` | The UI can load the supported choices from the API, while the saved mode remains authoritative for rerenders.
2026-11-13 | Gaming uses a normalized `x,y,w,h` facecam crop above a centered 16:9 gameplay crop; captions render on the final stacked frame | Manual coordinates avoid auto-detection and keep the filter graph deterministic.
2026-11-13 | Normalize sentence RMS loudness between interpolated 10th and 90th percentile bounds before combining it with LLM scores | Percentile bounds limit isolated loudness outliers; default mode uses weight zero and remains unchanged.
2026-11-13 | Apply mode glossary replacements after transcription and distribute multi-word replacement timing proportionally across the matched phrase span | Corrected words reach selection and captions without moving the phrase outside its original audio interval.
2026-11-13 | Store generated per-clip Indonesian social metadata under `metadata` in `clips.json` and reuse it on reruns and preserve it through rerenders | Keeps the existing title/hook fields stable and avoids repeated model calls for completed clips.
2026-11-13 | Use the existing Classic, Bold, and Clean ASS definitions as the default, gaming, and podcast profile presets | Reuses tested caption styling and keeps the default rendering appearance unchanged.
2026-11-13 | Render an enabled hook/title overlay for 2.5 seconds and style it from the selected ASS preset | Gives viewers the clip context at the opening while keeping the existing opt-in behavior.
2026-11-13 | Drop experimental word-emphasis zoom after the short CPU fixture render rose from 0.35s to 0.55s (+55%) | The slowdown was large for a sub-second clip, so the optional effect is not worth adding to the render path.
2026-11-13 | Phase 9 mode e2e uses generated 3-second FFmpeg video with cached transcript, candidates, and metadata inside the rebuilt Docker image | Exercises each profile's glossary, captions, layout, manifest, and render path without requiring Whisper model downloads or a live 9Router key.
2026-11-13 | Cancelled jobs use a persisted `cancelled` status and propagate an AbortSignal through pipeline child processes | The UI can report cancellation distinctly and stop queued work or active media/model subprocesses.
2026-11-13 | Uploaded jobs store an editable project name, defaulting to the source filename without its extension | Recent projects are readable while the randomly generated storage filename remains unchanged.
