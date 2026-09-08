# GPTNime Local Launcher

GPTNime has a local desktop launcher so it can be found from the operating system app search.

## Launcher Assets

- `public/brand/gptnime-launcher-source.png`: generated source artwork.
- `public/brand/gptnime-launcher-icon.png`: 512px app-menu launcher icon.
- `public/brand/gptnime-launcher-icon-256.png`: 256px launcher icon.
- `public/brand/gptnime-launcher-icon-128.png`: 128px launcher icon.
- `public/brand/gptnime-logo-lockup.png`: transparent logo lockup with readable text.
- `public/brand/gptnime-logo-card.png`: dark preview card for sharing or docs.

The artwork is original warm hand-painted anime-fantasy branding: forest twilight, retro TV lantern, watch ledger, teal glow, gold accents, and no copied characters or studio marks.

## Install Or Refresh

```bash
./scripts/install-local-launcher.sh
```

This writes `~/.local/share/applications/gptnime.desktop`. After installation, search for `GPTNime` from the desktop app launcher.

## Launch Behavior

- Runs `npm install` once if `node_modules` is missing.
- Starts Vite on `http://127.0.0.1:5190/` if it is not already running.
- Opens the app in the default browser.
- Writes logs to `~/.local/state/gptnime/gptnime-dev.log`.

## Local WCO Playback

The dev server includes the WCO preparation connector; there is no separate service to start. Open a title's cinema, select its episode and Subbed/Dubbed language, paste an exact `wco.tv` episode or series link, and choose **Play here**. Chrome opens temporarily for provider preparation and closes when the source is ready. Any human verification must be completed in that window. The actual episode then plays in gptNime.

The connector uses the installed Chrome at `/usr/bin/google-chrome`; override `CHROME_PATH` before starting Vite if needed. It requires a desktop display. Preparation is available only through the local loopback address, even if Vite is exposed to a LAN. No browser extension, media proxy or changes to the user's regular browser profile are required.
