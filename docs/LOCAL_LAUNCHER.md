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

The dev server includes the WCO preparation connector; there is no separate service to start. With WCO selected, click **Watch**, an episode or a title in the cinema lineup. gptNime finds its WCO page, resolves a fresh source and starts the video automatically. Next/Previous works the same way. Choose Subbed/Dubbed as desired; ambiguous matches are selectable inside the cinema. No WCO URL needs to be pasted.

A dedicated Chrome session opens for provider preparation, remembers its cookies between episodes and minimizes when the source is ready. Any human verification must be completed in that window; **Show WCO window** brings it forward. The cinema waits separately for verification instead of expiring its media timer. Premium-only episodes show an access message and **Open WCO session** for existing-account sign-in. **Source options** provides an optional title search and explicit page override; pasting an episode page updates its episode/language selection automatically.

The connector uses the installed Chrome at `/usr/bin/google-chrome`; override `CHROME_PATH` before starting Vite if needed. It requires a desktop display. Preparation is available only through the local loopback address, even if Vite is exposed to a LAN. No browser extension, media proxy or changes to the user's regular browser profile are required. Its separate profile lives at `${XDG_DATA_HOME:-~/.local/share}/gptnime/wco-browser` with owner-only directory permissions. Provider preparation stays muted; ordinary cinema playback has sound. Visible automated test viewers are muted by their test launch flag.
