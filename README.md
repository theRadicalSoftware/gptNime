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
- GPTNime Cinema with Watch actions on cards, details, episode lists, and Continue Watching; a full-library lineup, movie support, docked playback that can float on top of other tabs and windows, pop-out / pop-in windows, autoplay into the next episode, and **Skip opening / Skip ending** buttons from AniSkip's community times (also in fullscreen, or press S).
- Local video files and direct MP4 / WebM URLs, VTT subtitles, playback speed, per-source resume points, and progress marking after 90% actual playback.
- Automatic WCO title/episode lookup and native playback through the local connector. Click Watch or an episode; optional page links update the episode and language automatically. Dedicated Chrome and Brave sessions preserve provider verification between attempts and prepare sources for the viewer’s browser on a private virtual display when Xvfb is available. Direct search, ten-minute reuse of prepared sources, preparation while browsing Watch actions, and next-episode preparation near the end reduce the wait after Play; Show WCO window remains an explicit action. The cinema distinguishes verification from premium-only access. Provider availability still applies. See [`docs/CINEMA.md`](docs/CINEMA.md).
- **This season**: the season's 100 most popular shows from AniList, with new seasons of shows you watch first, then the rest ordered by fit with what you rate, finish and rewatch. One click adds a show to Planning; season switcher; option to hide tracked shows.
- **Next in the story**: finishing a season or movie (in the cinema or on the end card) offers its sequel. When that sequel is a movie or OVA, it also names the season the series continues in, plus optional side stories. One click adds it to Watching and starts it; an unaired sequel goes to Planning.
- **Import from MyAnimeList** (`.xml` / `.xml.gz` export) **or a public AniList username**: new titles are added; titles you already track only move forward (progress, finished status, or a missing score or note).
- **Home copy and daily backups**: with the launcher, the library is also saved on this computer, so cleared site data, other browsers and the phone all share it, merged title by title. A dated backup is kept for each of the last 30 days. The app asks the browser to keep its storage. See [`docs/PHONE.md`](docs/PHONE.md).
- **Watch on your phone** over an SSH tunnel through Tailscale; nothing listens beyond `127.0.0.1`. See [`docs/PHONE.md`](docs/PHONE.md).
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
npm run test:storage
npm run test:platform
npm run test:wco-session # requires a desktop display
```

Browser checks use installed Chrome (`/usr/bin/google-chrome`; override with `CHROME_PATH`). Run `CINEMA_HEADED=1 npm run test:cinema` on a desktop (or under `xvfb-run`) to also test native Document Picture-in-Picture and the fullscreen Skip hand-over. If another project holds a suite's port, set `WCO_TEST_PORT` or `VERSION_TEST_PORT`. Tests start an isolated Vite server on port 5197, use fixture library data, and save screenshots under `output/cinema/`.

## Data Storage

GPTNime is local-first. No app backend is required. Started from the launcher, the local server also keeps a home copy of the library and 30 daily backups on this computer ([`docs/PHONE.md`](docs/PHONE.md#home-copy-and-daily-backups)); each browser remembers what it last agreed with that copy under `gptnime-home-copy-v1`.

- Library data is stored in browser `localStorage` under `gptnime-tracker-library-v1`.
- Per-title profile fields such as `favorite`, `rewatchWorthy`, `priority`, score, notes, episode memory, and progress are stored with each library entry in that same browser key.
- Notification preferences are stored in browser `localStorage` under `gptnime-notification-prefs-v1`.
- Sage mode is stored under `gptnime-sage-mode-v1`.
- Focus layout preference is stored under `gptnime-focus-layout-v1`.
- Cinema preferences, WCO page links, and up to 200 resume points are stored under `gptnime-cinema-v1`. Video URLs and file contents are never persisted. Cinema settings are separate from the library JSON export/import.
- Use the download and upload buttons in the top bar to export/import JSON backups.
- If the saved library cannot be read (corrupted text, or individual titles/history events that fail validation), GPTNime first keeps the exact original text under `gptnime-tracker-library-v1-recovery-<timestamp>` and shows a notice with **Download copy**. Readable titles keep working. If there is no room for that copy, saving pauses so the original is never overwritten; download it, then choose **Resume saving**. Up to three copies are kept, and dismissed copies make room first.
- If the browser refuses a save (for example, storage is full), the app keeps running and shows **Export backup** and **Try again**. The notice clears after the next successful save.

## Project Structure

```text
src/
  App.tsx        Main application state, data mapping, views, and feature logic.
  App.css        Application styling and responsive layouts.
  main.tsx       React entry point.
  index.css      Global base styles.
  watch/         Cinema UI, window lifecycle, provider routes, and resume storage.
  library/       Ledger types, AniList client, home copy sync, list import, This season, next in the story.
server/
  wco*.ts        Local WCO connector and the phone media relay.
  library.ts     Home copy, daily backups and the loopback-only connection guard.
public/
  art/           App artwork used by the dashboard, library, and channel surfaces.
  brand/         Generated launcher icon and logo lockup assets.
docs/
  EASTER_EGGS.md Subtle easter eggs and quiet UX touches.
  DESIGN_NOTES.md Project-level UI conventions.
  LOCAL_LAUNCHER.md Desktop launcher setup and asset notes.
  WORKFLOW.md     Commit and GitHub push expectations.
  CINEMA.md       Watch flow, WCO limitations, artwork provenance, and browser checks.
  PHONE.md        Watching on the phone, privacy, home copy and backups.
tests/
  cinema.browser.mjs  Real-media browser regression checks.
  platform.browser.mjs Home copy, backups, imports, This season, next in the story, phone relay.
  fixtures/      Generated, silent video test pattern.
```

## External APIs

The app uses the public AniList GraphQL API for anime metadata, covers, genres, episode counts, recommendations, and next-airing data. It uses Jikan for episode-list enrichment when MAL IDs are available.

## Notes

- `node_modules`, `dist`, generated scratch output, coverage, and local env files are ignored by git.
- The included artwork lives in `public/art` so the app can run without external image hosting.
