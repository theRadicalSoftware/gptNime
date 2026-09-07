# GPTNime Cinema

Implemented September 7, 2026. The former file-only anime channel is replaced by a reusable watch surface inspired by Pythia's minimize/expand/close flow.

## Watching

Open the floating TV or use **Watch** on a library card, Continue Watching row, focused title, or episode row. Title details also have **Open in cinema** / **Watch movie**. Episode rows now open the selected episode; progress editing remains available through the existing controls and the cinema's Mark watched action.

The lineup includes the whole library, with active watching titles first. Completed titles remain available for replay. Movies use one feature-film slot. For a fresh rewatch tally, start the existing Rewatch action in title details; opening a completed title does not reset its history.

- **WCO** searches for the selected episode or whole series. Language selects subbed/dubbed search terms and saved-link scope. Paste an exact title or episode page to save it for later.
- **Your files** loads a browser-supported local video without uploading it. MP4 and WebM are the usual choices; support for other containers/codecs depends on the browser.
- **Video URL** accepts direct HTTPS video sources or HTTP loopback sources. It uses native browser decoding, not a website embed. MP4/WebM are supported where their codecs are available. There is no HLS/DASH compatibility library in this change.
- Subtitles accept WebVTT. Playback speed ranges from 0.75× to 2×. Native video controls provide volume, seeking, fullscreen and browser-supported video PiP.

**Dock** keeps the player at the bottom right while the rest of the app is usable. **Pop out** uses Document Picture-in-Picture when available, otherwise an app-owned browser popup. **Pop in**, or closing the separate window, returns the same video element. Cross-document adoption can reload media, so the implementation restores its timestamp, speed and play/pause state. A browser that rejects resumed playback receives a visible “Press play” message. Closing the cinema stops and releases its media.

## Progress and resume

The selected episode is independent of ledger progress. Marking watched never silently switches the current source to another episode. Next/Previous/selecting another title unloads the previous source and subtitles. The next file or URL must be chosen explicitly.

Automatic marking is enabled by default and applies only to the next unwatched episode (`selectedEpisode === progress + 1`). It unions the browser's played ranges, including across window transfers, and requires 90% coverage. Seeking forward and replaying the same section cannot inflate coverage. Later episodes can be marked manually with the explicit **Mark through ep N** label. Replay does not decrease progress or duplicate a completed episode's history. Completion inside cinema avoids spawning the ledger's separate end-card modal.

Resume points are scoped by AniList ID, selected episode and source fingerprint. Local file identity uses name, size and last-modified time; URL identity uses a compact hash. A matching video resumes only when its duration matches and the saved point is before the final five seconds. Loading media never autoplays. Restart resets the timestamp. Browser storage keeps at most 200 recent resume entries.

Storage key: `gptnime-cinema-v1`. It contains source-tab preference, language, auto-mark preference, saved WCO pages and resume points. Raw media URLs, signed resolver tokens, video files and subtitles are not persisted. Cinema settings are not part of the ledger's existing JSON export/import. They remain separate so this addition does not alter the library schema or existing backups.

## WCO integration boundary

The earlier DevTools investigation observed these public navigation routes:

| Purpose | Route / behavior |
| --- | --- |
| Search | `POST https://www.wco.tv/search` with `catara` and `konuara=series\|episodes` |
| Subbed catalogue | `https://www.wco.tv/subbed-anime-list` |
| Dubbed catalogue | `https://www.wco.tv/dubbed-anime-list` |
| Movies | `https://www.wco.tv/movie-list` |
| Series / episode | An exact provider-issued page URL; saved by title or episode and language |

The app submits WCO's normal search form in a top-level provider window. It severs `window.opener` before external navigation. Saved URLs require HTTPS on a known WCO catalogue hostname and reject credential-bearing URLs, media resolver URLs, embedded player paths and transient player parameters. It does not manufacture episode slugs from AniList titles: numbering, seasons, specials and provider titles can differ. Search text and scope are editable for this reason. Opening a provider pauses any video currently playing inside gptNime.

WCO's observed embedded player uses `frame-ancestors` permitting its own sites, excluding `127.0.0.1` and `localhost`. The catalogue page also has frame-busting behavior. This prevents a supported inline WCO iframe inside gptNime. Its normal provider flow includes announcements/verification, and sampled movie pages had a premium gate. The observed resolver chain returned MP4 references but the sampled CDN request returned 404; **successful WCO media playback was not verified**. No proxy, CSP stripping, ad verification spoofing, login bypass, or extraction service was added. WCO remains responsible for its own sign-in, availability and playback. Its window does not expose trustworthy progress events to gptNime, so progress there is manual.

The iframe restriction does **not** establish that every direct media response from WCO's CDN is unusable. The Video URL field initially rejected `wcostream.com` and all its subdomains; that blanket check was removed after review. It now allows direct HTTPS CDN URLs to be attempted normally, while continuing to reject known WCO catalogue pages. It does not change request headers, remove response policies, supply credentials, or make an expired/gated stream usable. A valid provider-issued source must still be tested from the app's origin. The regression test intercepts a CDN-shaped URL with a generated video fixture and proves only that our own validator and player accept such a media URL, not that the live provider supports it.

Primary references: [WCO episode page](https://www.wco.tv/one-piece-episode-1177-english-subbed), [movie catalogue](https://www.wco.tv/movie-list), [provider status](https://www.wcostatus.com/), [MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors). The local detailed trace is in ignored `output/research/wco-2026-09-07/README.md`; transient player credentials are not committed.

Window behavior follows [Chrome's Document Picture-in-Picture documentation](https://developer.chrome.com/docs/web-platform/document-picture-in-picture) and [MDN window.open](https://developer.mozilla.org/en-US/docs/Web/API/Window/open).

## Artwork

- Project asset: `public/art/cinema-rooftop.png`, 1536×1024 PNG, about 1.8 MB.
- Generated with the built-in imagegen tool, September 7, 2026; no CLI/API fallback.
- Original output: `/home/rory/.codex/generated_images/01a07d56-0506-7b71-9a08-bb649d351ba5/exec-b4a633b6-d4cd-41f2-b3b0-e5ae5b9fa3ed.png`. Copied intact and visually inspected.
- The responsive border, layout and controls are CSS; the illustration appears only when video is absent.

Generation prompt:

> Create one refined widescreen background illustration for a dark anime watch-player UI named GPTNime. Landscape 1536x1024 or wider. Original anime cinematic environmental painting, no existing characters or franchise imagery. A quiet Japanese rooftop cinema at blue hour: distant layered city skyline, a small crescent moon, subtle paper lantern warmth at the far right edge, fine clouds and atmospheric perspective, elegant hand-painted backgrounds with restrained crisp architectural linework. Palette near-black charcoal #100f10, muted blue-teal #3096a6, desaturated warm champagne gold #e5c17c, tiny warm red highlights. Composition: detail clustered toward bottom and side edges; large DARK calm negative space across the center and upper left for UI overlay. Low contrast, peaceful, premium and understated rather than flashy, almost no glowing neon. No people, no text, no logos, no border, no UI mockup, no screens, no watermark. The intended asset appears subtly behind source-selection controls and never over actual video. Return a finished beautiful background image.

## Verification

```bash
npm run build
npm run lint
npm run test:cinema
CINEMA_HEADED=1 npm run test:cinema
```

The browser suite starts Vite on `127.0.0.1:5197` and uses an isolated Playwright context with fixture data. Override `CHROME_PATH` for another installed Chromium binary, or `CINEMA_URL` to test an already running server. Headed testing requires a desktop display and a browser with Document PiP.

Coverage includes search POST fields and detached opener; WCO URL validation and per-episode/language persistence; real decoded video; seek-vs-watch completion; duplicate history prevention; source/subtitle cleanup; resume without autoplay; URL playback without URL persistence; movie completion; Escape/focus/inert behavior and focused-modal handoff; pop-out/pop-in timestamps; mobile layout; empty library; and browser runtime errors. Headed mode also verifies native Document PiP both paused and playing, including rate preservation and browser-window close.

WCO requests in the automated suite are intercepted contract fixtures, not proof of live WCO availability. Media is a silent 12-second generated color pattern in `tests/fixtures/cinema-test.webm`, made with:

```bash
ffmpeg -f lavfi -i testsrc2=size=640x360:rate=24 -t 12 -an -c:v libvpx-vp9 -b:v 220k tests/fixtures/cinema-test.webm
```

Screenshots and results are written to ignored `output/cinema/`. A separate read-only copy of the real 44-title library was used to inspect title density and capture `06-real-library-cinema.png`; original browser storage and progress were not modified. Temporary profile copies were removed after inspection.
