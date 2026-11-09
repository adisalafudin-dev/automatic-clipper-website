# video-clipper

Run `bun install`, then set `LLM_API_KEY` and optionally `LLM_BASE_URL` in `.env`. The default model is `hermes-main`.

```bash
bun run check
bun run start
```

Open `http://127.0.0.1:3000` for the local UI. Upload a video to create a job, watch stage progress, preview clips, edit their trim and captions, then rerender. Set `HOST` or `PORT` to change the listener.

The API remains available at the same origin: `GET /health`, `POST /jobs`, and `GET /jobs/:id` report readiness, submit jobs, and return queued/running/completed/failed status, per-stage progress, and the final manifest.

The CLI caches audio, transcript, and candidate outputs under `data/jobs/<video-name>`. It writes rendered vertical clips and `clips.json` under that job folder. Pass `--force` after the video path to rerun cached stages.

Compare the Phase 4 aliases with `bun run src/compare.ts --models hermes-main,hermes-gemini,hermes-nvidia-ollama`. Defaults exclude the sensitive `Lets Talk.mp4`, use the other four raw videos plus the cached `your-video` transcript, and write per-model results under `data/jobs/<video-name>/comparisons`. Use `--prepare` to only extract and transcribe.
