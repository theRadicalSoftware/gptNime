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
