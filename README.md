# GPTNime Watch Ledger

GPTNime is a local-first anime watch ledger for tracking what you are watching, what you have completed, what you plan to watch next, and what deserves a rewatch. It is built as a Vite + React app with AniList-powered discovery and browser-local persistence.

## Features

- AniList search with one-click add to Planning, Watching, Completed, or Rewatch.
- Cover-forward library with grouped franchise runs and active-season switching.
- Status, progress, score, priority, favorite, rewatch-worthy, notes, and per-title episode memory.
- Browser-local data storage with JSON export/import backups.
- Upcoming episode queue from AniList `nextAiringEpisode` metadata.
- Smart shelves for short finishes, high-priority stalled titles, comfort rewatches, movies under two hours, studio spotlights, long runners, and fresh recommendations.
- `Recommended for you` shelf seeded by ratings, favorites, rewatches, and completed titles while excluding already tracked anime.
- Anime-fan stats: completion rate, month heatmap, top genres/studios, average score by genre, movie/series mix, episodes watched this month, longest pause, and rewatch count.
- Notification drawer with stale threshold, snooze, dismiss, mute title, watching-only, and high-priority-only controls.
- Anime-channel view with local video file playback, VTT subtitles, playback speed, Picture-in-Picture, mini-player mode, next-episode queue, and 90% auto mark-watched.
- Subtle easter eggs and ambient touches documented in [`docs/EASTER_EGGS.md`](docs/EASTER_EGGS.md).
- Project-level UI conventions documented in [`docs/DESIGN_NOTES.md`](docs/DESIGN_NOTES.md).
- Project workflow reminders documented in [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

## Tech Stack

- React 19
- TypeScript
- Vite
- Framer Motion
- Lucide React
- AniList GraphQL API
- Jikan API for episode lists

## Run Locally

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5190
```

Open `http://127.0.0.1:5190/`.

## Build And Check

```bash
npm run build
npm run lint
```

## Data Storage

GPTNime is local-first. No app backend is required.

- Library data is stored in browser `localStorage` under `gptnime-tracker-library-v1`.
- Per-title profile fields such as `favorite`, `rewatchWorthy`, `priority`, score, notes, episode memory, and progress are stored with each library entry in that same browser key.
- Notification preferences are stored in browser `localStorage` under `gptnime-notification-prefs-v1`.
- Sage mode is stored under `gptnime-sage-mode-v1`.
- Focus layout preference is stored under `gptnime-focus-layout-v1`.
- Use the download and upload buttons in the top bar to export/import JSON backups.

## Project Structure

```text
src/
  App.tsx        Main application state, data mapping, views, and feature logic.
  App.css        Application styling and responsive layouts.
  main.tsx       React entry point.
  index.css      Global base styles.
public/
  art/           App artwork used by the dashboard, library, and channel surfaces.
docs/
  EASTER_EGGS.md Subtle easter eggs and quiet UX touches.
  DESIGN_NOTES.md Project-level UI conventions.
  WORKFLOW.md     Commit and GitHub push expectations.
```

## External APIs

The app uses the public AniList GraphQL API for anime metadata, covers, genres, episode counts, recommendations, and next-airing data. It uses Jikan for episode-list enrichment when MAL IDs are available.

## Notes

- `node_modules`, `dist`, generated scratch output, coverage, and local env files are ignored by git.
- The included artwork lives in `public/art` so the app can run without external image hosting.
