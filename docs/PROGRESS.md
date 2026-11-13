# Progress

Phase: 9 | Branch: phase-9-content-modes

## Done

- Phase 7 complete: caption presets, centered safe-area captions, hook-title overlays, opt-in YuNet face tracking, crop/blurred/stacked layout presets, and pause trimming.
- UI-spec 6.0 API routes are tested for source/transcript reads, byte ranges, selection clip creation, deletion, and per-clip rendering.
- UI-spec 6.1: React + TypeScript page is bundled by Bun and lists persisted jobs.
- UI-spec 6.2: upload form, 2-second polling during active jobs, stage progress, and visible errors; browser smoke verified the page and persisted job list.
- UI-spec 6.3: three-column editor, clip list, source video playback bounded to the selected clip, loop toggle, and transcript preview overlay.
- UI-spec 6.4: millisecond trim controls, two-handle source window, word snapping, reset, playhead/nudge/jump controls, keyboard shortcuts, debounced save, and duration warnings.
- UI-spec 6.5: transcript words seek the source, highlight with playback, and support text-only edits or removal; overrides persist by transcript word index across trim changes.
- UI-spec 6.6: per-clip and render-all-stale queue actions, queued/rendering/done/failed badges, errors, inline result player, and download link.
- UI-spec 6.7: shift-select sentence ranges, create clips from the selection, delete clips, and show shortcut help and empty/error states.
- Pause trim: gaps over 600 ms between words are cut to a 120 ms breath on each side. Leading and trailing silence uses the same pad.
- Captions are retimed onto the concatenated timeline. Manifest `duration` is the rendered length; `start` and `end` stay the source window.
- `bun run check` covers the span math, FFmpeg concat args, and a real trimmed fixture.
- Phase 8: Dockerfile builds CPU whisper.cpp; Compose runs API/UI/worker with FFmpeg and persistent media/model volumes plus a Linux SQLite volume.
- Whisper binary and model paths are configurable; the default model downloads to the mounted models directory at first start.
- Phase 8 follow-up: upload language can be English or Bahasa Indonesia; the choice is persisted per job, passed to Whisper, and used for hook/title/reason language.
- Phase 9.1: added immutable default, gaming, and podcast profiles with default lookup, ordered listing, and explicit invalid-name errors.
- Phase 9.2: added `--mode`, persisted the selected mode in `job.json` and `clips.json`, and reused the saved mode unless explicitly overridden.
- Phase 9.3: added `GET /modes`, per-job SQLite mode selection, upload UI dropdown, and mode propagation through rerenders.

## Next

- Phase 9.4: add the gaming split layout and configurable facecam rectangle through FFmpeg filter graph, CLI, and UI.

## Known bugs / open questions

- Full Docker pipeline e2e and matching output comparison are unverified because no sample video or `.env` key is available.
- The Docker SQLite database is isolated in a named volume; the pre-existing `data/jobs.sqlite` remains untouched on the host.
- Face tracking quality depends on face size and visibility in the five-second samples.
- Cached clips keep the old cut until a rerender with `--force` or the UI render button.
- The untracked `whisper.cpp/` source tree is excluded from project typecheck and test discovery; it is not included in project commits.
- A staged `whisper.cpp` gitlink is user data and is excluded from Phase 9 commits.

## Run

- `bun run check`
- `bun run start`
- `bun run src/cli.ts video.mp4 --force`
- `bun run dev`
- `docker compose up --build`
