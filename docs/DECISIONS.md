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
