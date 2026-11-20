# Video Clipper

Video Clipper is a local Web app that turns a long spoken video into short, vertical clips. It transcribes speech, asks a model for moments worth clipping, then renders 9:16 videos with word-timed captions. The web app lets you upload videos, follow jobs, preview clips, adjust trims and captions, and rerender.

The local app can analyze YouTube captions, livestream chat replay, chapters, and replay heatmap without downloading the full video. The AI ranks likely moments; only selected sections are downloaded, joined locally, and rendered into project clips. If captions are unavailable, the app can fall back to an audio-only download capped at 500 MB and local Whisper transcription. The app can also manually download a chosen YouTube section as an MP4. Docker runs the API, UI, worker, FFmpeg, yt-dlp, Deno, and CPU whisper.cpp in one container.

## What you need

- Windows and [Bun](https://bun.sh/).
- `ffmpeg` and `ffprobe` available on `PATH`.
- For Windows runs, the whisper.cpp executable at `tools/whisper/Release/whisper-cli.exe` and a model at `tools/whisper/models/ggml-base.bin`.
- For Windows YouTube downloads, [download the official `yt-dlp.exe`](https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe) into the project root or add it to `PATH`, and install Deno (`winget install DenoLand.Deno`).
- A running 9Router instance. Set its API key in **9Router settings** inside the app. Use `http://host.docker.internal:20128/v1` when the app runs in Docker and 9Router runs on Windows; use `http://127.0.0.1:20128/v1` when both run directly on Windows.

Whisper runs locally on the CPU. Transcription can take several minutes for a long video; the progress display reports pipeline stages, so it can remain on “Transcription” while Whisper is working. 9Router receives transcript text for clip selection, not video frames. Use only videos you own or have permission to process.

## Install and run

```powershell
bun install
Copy-Item .env.example .env
# Optional: set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL in .env instead of the app settings
bun run check
bun run start
```

Open <http://127.0.0.1:3000>. The server binds to localhost by default. Choose a video (its filename is used as the project name), optionally choose a content mode or face tracking, and click **Upload and create clips**. Whisper detects the spoken language automatically; the app transcribes, finds, and renders clips without manual selection. Videos up to 2 GB are accepted. Cancel a queued or running job from its row under **Recent projects**. Select a project to preview and download its clips. If clip generation fails or returns no usable clips, the project shows the reason and offers **Retry clip generation**, reusing the saved transcript. **Render all stale** appears only when clips already exist. Clip edits, caption presets, layouts, and content modes remain available in the editor and pipeline.

Subtitles are enabled by default and can be switched off in the upload form. This setting is saved with each project, so rerenders keep the same choice. Gaming mode defaults to a bottom-right facecam crop; adjust its normalized `x,y,w,h` rectangle in the upload form if the camera is elsewhere. Face tracking follows detected faces inside that crop. For Docker, install its small YuNet model once with `docker compose exec clipper bun run download-face-model`.

Open **YouTube download** and use **AI Clip Finder** with a completed video or livestream replay. The app fetches captions/chat/metadata, ranks moments through 9Router using compact transcript and activity context, then lets you choose clips and render them as a project. The full video is not downloaded. When captions are unavailable, audio-only fallback is capped at 500 MB and transcribed locally. Live chat and replay heatmap are optional because YouTube may not provide them. Active live streams are not supported. The same page retains a manual section downloader; enter start/end in `HH:MM:SS`, then **Choose save location…**. Use only videos you own or have permission to process. On Windows, yt-dlp and Deno must be available; Docker downloads its Linux yt-dlp and Deno binaries during image build.

Default retains center crop, Classic captions, and LLM-only ranking. Gaming uses the split facecam layout, Bold captions, glossary corrections, and a 0.3 audio-energy ranking weight. Podcast uses center crop, Clean captions, and a 0.1 audio-energy weight. Audio energy combines normalized FFmpeg RMS loudness (bounded by the 10th and 90th percentiles) with the model score.

To change the address, set `HOST` or `PORT` before running `bun run start`. Restart the server after updating code or configuration.

## Command-line use

```powershell
bun run src/cli.ts path\to\video.mp4
bun run src/cli.ts path\to\video.mp4 --force --mode gaming --facecam-rect 0.68,0.04,0.28,0.28
bun run src/cli.ts path\to\video.mp4 --no-subtitles --face-track
```

Audio, Whisper output, transcript, candidates, captions, clips, and `clips.json` are cached under `data/jobs/<video-name>`. `--force` reruns cached stages. For optional face tracking, first run `bun run download-face-model`, then add `--face-track`. Face tracking samples every five seconds on the CPU; center crop remains the default and is used as a fallback.

## API

The API and static UI share the local server, but API handlers live separately in `src/api.ts`.

| Request | Purpose |
| --- | --- |
| `GET /health` | Check server readiness |
| `POST /jobs` | Upload a video or submit a local `videoPath` |
| `POST /jobs/:id/cancel` | Cancel a queued or running job and stop its active subprocess |
| `POST /jobs/:id/retry` | Retry clip selection or rerender stale clips after a failed job |
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
- `WHISPER_LANG`: CLI language override; web uploads always use automatic language detection.
- `WHISPER_VAD`: enables Silero voice activity detection by default; set `false` to disable.
- `WHISPER_VAD_MODEL_PATH`: optional path to the Silero VAD model. Use `bun run download-vad-model` locally; Docker fetches it on first start.
- `WHISPER_BIN`: optional path to `whisper-cli`; defaults to the Windows tool path locally and `/usr/local/bin/whisper-cli` in Docker.
- `WHISPER_MODELS_DIR`: optional model directory; defaults to the Windows tool model directory locally and `/models` in Docker.
- `WHISPER_MODEL_PATH`: optional explicit model file path.
- `FACE_MODEL_PATH`: optional custom path to the YuNet ONNX face model.

The face model is only needed when face tracking is enabled. It is downloaded by `bun run download-face-model` and kept under `data/` by default. The sub-1 MB Silero VAD model is downloaded and checksum-verified with `bun run download-vad-model` for local Windows runs.

## Docker

Install Docker Desktop with Compose, then run:

```powershell
Copy-Item .env.example .env
# Set LLM_API_KEY in .env
docker compose up --build
```

Open <http://127.0.0.1:3000>. On first start, Compose downloads the default `base` Whisper model (about 142 MiB) and the Silero VAD model (under 1 MB) into `models/`; uploaded videos and generated files in `data/` and models persist on the host. Docker keeps the SQLite job database in its own persistent volume so Linux SQLite can use reliable file locking on Windows. Set `WHISPER_MODEL=small` to use a locally downloaded small model. When 9Router runs on the Windows host, Docker defaults to `http://host.docker.internal:20128/v1`. Set the endpoint, key, and model in the app's **9Router settings** panel or in `.env`; app-entered settings are stored in `data/llm-settings.json`. The web port binds to localhost only. Set `WHISPER_VAD=false` to disable VAD. `docker compose down` stops the app and keeps all data volumes.

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
