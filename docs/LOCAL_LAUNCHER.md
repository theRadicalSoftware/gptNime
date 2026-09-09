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

The dev server includes the WCO preparation connector; there is no separate service to start. With WCO selected, click **Watch**, an episode or a title in the cinema lineup. gptNime finds its WCO page, prepares a source and starts the video automatically. Next/Previous works the same way. Choose Subbed/Dubbed as desired; ambiguous matches are selectable inside the cinema. No WCO URL needs to be pasted.

A dedicated session uses the installed Brave when the viewer is Brave, and Chrome otherwise. With the hidden-preparation runtime below, the provider browser runs on a private virtual display and cannot place windows on your desktop. It remembers cookies between episodes. **Show WCO window** explicitly opens the same saved profile on the desktop for verification or sign-in; preparation continues there, and successful completion returns future work to the hidden display. The cinema waits separately for verification instead of expiring its media timer. Premium-only episodes show an access message and **Open WCO session** for existing-account sign-in. **Source options** provides an optional title search and explicit page override; pasting an episode page updates its episode/language selection automatically.

The connector uses Chrome at `/usr/bin/google-chrome` or Brave at `/usr/bin/brave-browser`; override `CHROME_PATH` or `BRAVE_PATH` before starting Vite if needed. It requires Xvfb or a desktop display; manually showing the session requires the desktop. Preparation is available only through the local loopback address, even if Vite is exposed to a LAN. No browser extension, media proxy or changes to the user's regular browser profile are required. Its separate profiles live at `${XDG_DATA_HOME:-~/.local/share}/gptnime/wco-browser` for Chrome and `wco-browser-brave` alongside it for Brave, with owner-only directory permissions. Source handoffs between different browsers may fail; each browser therefore prepares its own source without identity overrides. Provider preparation stays muted; ordinary cinema playback has sound. Visible automated test viewers are muted by their test launch flag.


### Hidden preparation runtime

Ubuntu/Debian installations can provide `xvfb` and `xauth` through their package manager. The connector checks `GPTNIME_XVFB_RUN`, the app-local `~/.local/share/gptnime/runtime/usr/bin/xvfb-run`, and `/usr/bin/xvfb-run`. The runner needs its matching `Xvfb` executable and `xauth` on PATH; the connector adds the runner directory automatically. This workstation uses the official Ubuntu package extracted into that app-local runtime. Runtime binaries are outside git. `GET /api/wco/status` reports `hiddenPreparation: true` when the runner is available.

The runner creates a private authenticated display with TCP disabled and cleans it up when its browser exits. The existing installed Chrome/Brave runs normally inside it. Without this dependency, playback retains the previous background/minimized behavior, which can still flash a window. To run session tests without showing their explicit window-handoff checks on your desktop:

```bash
PATH="$HOME/.local/share/gptnime/runtime/usr/bin:$PATH" xvfb-run -a npm run test:wco-session
```

Startup now skips an extra WCO homepage load. Recently prepared sources can be reused for 90 seconds, with eight entries per browser, in memory only. This helps quick returns and version switches; new episodes still follow WCO’s own player preparation. Reload/Retry always requests fresh preparation. See [measured live results](WCO-PLAYBACK.md#hidden-preparation-and-startup-time--september-8-2026).
