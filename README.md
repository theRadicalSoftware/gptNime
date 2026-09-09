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
- GPTNime Cinema with Watch actions on cards, details, episode lists, and Continue Watching; a full-library lineup, movie support, docked playback, and pop-out / pop-in windows.
- Local video files and direct MP4 / WebM URLs, VTT subtitles, playback speed, per-source resume points, and progress marking after 90% actual playback.
- Automatic WCO title/episode lookup and native playback through the local connector. Click Watch or an episode; optional page links update the episode and language automatically. Dedicated Chrome and Brave sessions preserve provider verification between attempts and prepare sources for the viewer’s browser on a private virtual display when Xvfb is available. Direct search, brief source reuse, preparation while browsing Watch actions, and next-episode preparation near the end reduce the wait after Play; Show WCO window remains an explicit action. The cinema distinguishes verification from premium-only access. Provider availability still applies. See [`docs/CINEMA.md`](docs/CINEMA.md).
- Subtle easter eggs and ambient touches documented in [`docs/EASTER_EGGS.md`](docs/EASTER_EGGS.md).
- Project-level UI conventions documented in [`docs/DESIGN_NOTES.md`](docs/DESIGN_NOTES.md).
- Local launcher setup documented in [`docs/LOCAL_LAUNCHER.md`](docs/LOCAL_LAUNCHER.md).
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

To install the searchable local launcher:

```bash
./scripts/install-local-launcher.sh
```

## Build And Check

```bash
npm run build
npm run lint
npm run test:cinema
npm run test:wco
npm run test:wco-session # requires a desktop display
```

Browser checks use installed Chrome (`/usr/bin/google-chrome`; override with `CHROME_PATH`). Run `CINEMA_HEADED=1 npm run test:cinema` on a desktop to also test native Document Picture-in-Picture. Tests start an isolated Vite server on port 5197, use fixture library data, and save screenshots under `output/cinema/`.

## Data Storage

GPTNime is local-first. No app backend is required.

- Library data is stored in browser `localStorage` under `gptnime-tracker-library-v1`.
- Per-title profile fields such as `favorite`, `rewatchWorthy`, `priority`, score, notes, episode memory, and progress are stored with each library entry in that same browser key.
- Notification preferences are stored in browser `localStorage` under `gptnime-notification-prefs-v1`.
- Sage mode is stored under `gptnime-sage-mode-v1`.
- Focus layout preference is stored under `gptnime-focus-layout-v1`.
- Cinema preferences, WCO page links, and up to 200 resume points are stored under `gptnime-cinema-v1`. Video URLs and file contents are never persisted. Cinema settings are separate from the library JSON export/import.
- Use the download and upload buttons in the top bar to export/import JSON backups.

## Project Structure

```text
src/
  App.tsx        Main application state, data mapping, views, and feature logic.
  App.css        Application styling and responsive layouts.
  main.tsx       React entry point.
  index.css      Global base styles.
  watch/         Cinema UI, window lifecycle, provider routes, and resume storage.
public/
  art/           App artwork used by the dashboard, library, and channel surfaces.
  brand/         Generated launcher icon and logo lockup assets.
docs/
  EASTER_EGGS.md Subtle easter eggs and quiet UX touches.
  DESIGN_NOTES.md Project-level UI conventions.
  LOCAL_LAUNCHER.md Desktop launcher setup and asset notes.
  WORKFLOW.md     Commit and GitHub push expectations.
  CINEMA.md       Watch flow, WCO limitations, artwork provenance, and browser checks.
tests/
  cinema.browser.mjs  Real-media browser regression checks.
  fixtures/      Generated, silent video test pattern.
```

## External APIs

The app uses the public AniList GraphQL API for anime metadata, covers, genres, episode counts, recommendations, and next-airing data. It uses Jikan for episode-list enrichment when MAL IDs are available.

## Notes

- `node_modules`, `dist`, generated scratch output, coverage, and local env files are ignored by git.
- The included artwork lives in `public/art` so the app can run without external image hosting.
