# Video Clipper

Video Clipper is a local Web app that turns a long spoken video into short, vertical clips. It transcribes speech, asks a model for moments worth clipping, then renders 9:16 videos with word-timed captions. The web app lets you upload videos, follow jobs, preview clips, adjust trims and captions, and rerender.

The Phase 7 pipeline and UI are complete. Docker runs the API, UI, worker, FFmpeg, and CPU whisper.cpp in one container.

## What you need

- Windows and [Bun](https://bun.sh/).
- `ffmpeg` and `ffprobe` available on `PATH`.
- For Windows runs, the whisper.cpp executable at `tools/whisper/Release/whisper-cli.exe` and a model at `tools/whisper/models/ggml-base.bin`.
- A running 9Router instance and its API key. The default address is `http://192.168.1.13:20128/v1`.

Whisper runs locally on the CPU. Transcription can take several minutes for a long video; the progress display reports pipeline stages, so it can remain on “Transcription” while Whisper is working. 9Router receives transcript text for clip selection, not video frames. Use only videos you own or have permission to process.

## Install and run

```powershell
bun install
Copy-Item .env.example .env
# Edit .env and set LLM_API_KEY
bun run check
bun run start
```

Open <http://127.0.0.1:3000>. The server binds to localhost by default. Upload a video up to 2 GB, wait for its job to finish, then select it under **Recent projects** to preview clips. Adjust a clip’s start/end or captions, then choose **Render changes**. Caption presets are Classic, Bold, and Clean; layouts include center crop, blurred background, and stacked panels. The hook-title overlay is optional.

To change the address, set `HOST` or `PORT` before running `bun run start`. Restart the server after updating code or configuration.

## Command-line use

```powershell
bun run src/cli.ts path\to\video.mp4
bun run src/cli.ts path\to\video.mp4 --force
```

Audio, Whisper output, transcript, candidates, captions, clips, and `clips.json` are cached under `data/jobs/<video-name>`. `--force` reruns cached stages. For optional face tracking, first run `bun run download-face-model`, then add `--face-track`. Face tracking samples every five seconds on the CPU; center crop remains the default and is used as a fallback.

## API

The API and static UI share the local server, but API handlers live separately in `src/api.ts`.

| Request | Purpose |
| --- | --- |
| `GET /health` | Check server readiness |
| `POST /jobs` | Upload a video or submit a local `videoPath` |
| `GET /jobs` | List recent jobs |
| `GET /jobs/:id` | Read job state, per-stage progress, and the clip manifest |
| `GET /jobs/:id/clips/:clipId` | Preview a rendered clip |
| `PATCH /jobs/:id/clips/:clipId` | Save trim, caption, style, or title-overlay edits |
| `POST /jobs/:id/render` | Queue a rerender using saved edits |

Job state is stored in `data/jobs.sqlite`. Jobs run through an in-process queue with one job at a time. Uploaded videos and generated output stay under `data/`.

## Models and settings

`.env.example` lists the supported environment settings:

- `LLM_BASE_URL`: 9Router API URL.
- `LLM_API_KEY`: key from your 9Router dashboard; keep it private.
- `LLM_MODEL`: defaults to `hermes-main`.
- `WHISPER_MODEL`: defaults to `base`; `small` is also supported if installed.
- `WHISPER_LANG`: defaults to `en`.
- `WHISPER_BIN`: optional path to `whisper-cli`; defaults to the Windows tool path locally and `/usr/local/bin/whisper-cli` in Docker.
- `WHISPER_MODELS_DIR`: optional model directory; defaults to the Windows tool model directory locally and `/models` in Docker.
- `WHISPER_MODEL_PATH`: optional explicit model file path.
- `FACE_MODEL_PATH`: optional custom path to the YuNet ONNX face model.

The face model is only needed when face tracking is enabled. It is downloaded by `bun run download-face-model` and kept under `data/` by default.

## Docker

Install Docker Desktop with Compose, then run:

```powershell
Copy-Item .env.example .env
# Set LLM_API_KEY in .env
docker compose up --build
```

Open <http://127.0.0.1:3000>. On first start, Compose downloads the default `base` Whisper model (about 142 MiB) into `models/`; uploaded videos and generated files in `data/` and models persist on the host. Docker keeps the SQLite job database in its own persistent volume so Linux SQLite can use reliable file locking on Windows. Set `WHISPER_MODEL=small` to use a locally downloaded small model. The default container LLM URL is `http://192.168.1.13:20128/v1`; override `LLM_BASE_URL` in `.env` for another reachable 9Router address. `docker compose down` stops the app and keeps all data volumes.

## For contributors and coding agents

- Read `AGENTS.md`, `docs/PROGRESS.md`, and `docs/DECISIONS.md` before changing the project. `AGENTS.md` is the source of truth for phase gates.
- Use Bun and strict TypeScript. Run `bun run check` before handing off changes. Tests use fakes for LLM calls; do not add live Whisper or 9Router calls to the normal check.
- Keep the UI in `web/`, its serving adapter in `src/ui.ts`, API routes in `src/api.ts`, and pipeline work in `src/pipeline/`. Keep API behavior independent of the UI.
- Preserve stage caches and the one-job queue. Keep Whisper and rendering local, use argument arrays for spawned tools, and do not add Python, CUDA, or ROCm dependencies.
- Send model calls only through 9Router. Chunk transcript text; never send video frames or a whole long transcript in one request. Do not send sensitive transcripts upstream without user approval.
- Keep `.env`, models, media, and generated jobs out of Git. Record architecture decisions in `docs/DECISIONS.md` and keep `docs/PROGRESS.md` under 30 lines.

## Useful commands

```powershell
bun run check
bun run typecheck
bun run test
bun run start
bun run download-face-model
```
