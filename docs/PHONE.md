# Watching on your phone

GPTNime runs on the computer and listens only on `127.0.0.1`, so nothing on the network or internet can reach it. A phone gets in the same way you would sit at the computer: through an SSH tunnel over Tailscale that ends on the computer itself.

```text
phone browser → 127.0.0.1:5190 on the phone → SSH (inside Tailscale) → 127.0.0.1:5190 on the computer
```

## What you need

- Tailscale running on the computer and the phone, both signed in to your tailnet.
- The SSH access you already use from the phone. The firewall allows SSH only from that phone's Tailscale address (see the remote-desktop handoff); nothing changes there.
- GPTNime started from its launcher on the computer, which also turns on the home copy below.

## Set up the tunnel once

In your SSH app, add a **local port forward** to your existing computer connection:

| Setting | Value |
| --- | --- |
| Local (phone) port | `5190` |
| Bind address | `127.0.0.1` |
| Destination host | `127.0.0.1` |
| Destination port | `5190` |

- **Termius**: open the host → **Port Forwarding** → **Local** with the values above, then start the forward.
- **JuiceSSH**: **Connections** → **Port Forwards** → add a local forward through the computer's connection.
- **Termux**: `ssh -N -L 127.0.0.1:5190:127.0.0.1:5190 <you>@<computer's 100.x address>`. Termux uses its own DNS, so Tailscale names such as the computer's MagicDNS name do not resolve there; use the address from `tailscale ip -4` on the computer. The Tailscale app must be connected on the phone. After the password, `-N` prints nothing: that is the tunnel running. Leave Termux open (its notification's **Acquire wakelock** keeps it alive in the background).

Then open **`http://127.0.0.1:5190`** in the phone's browser. Keep using that exact address, so the phone always reopens the same saved settings. Adding it to the home screen makes it feel like an app.

## What works on the phone

- **The same library.** Browsers, and the phone, share the *home copy* saved on the computer. A change on one device appears on another when that page is reopened or returns to the foreground, and at least every 45 seconds while it stays open. Changes merge title by title, so watching on the phone while the laptop is open does not undo either one.
- **WCO playback.** WCO's video links are issued to the computer's own browser session, so the phone cannot use them directly. The phone plays them through the computer instead. The computer fetches just the prepared episode, using the same browser identity that prepared it, with no cookies or referrer. It sends that stream back through the tunnel. The connector prepares in the profile the computer last used, so an already-trusted session does the work. If WCO asks for verification, finish it on the computer (**Show WCO window**).
- **Autoplay, Skip opening/ending, next in the story, resume points.** These all work the same. Resume points are kept per browser; the library progress is shared.
- Pop-out windows are a desktop feature. On Android, Chrome's own picture-in-picture still works from the video controls.

## Why this stays private

- The server accepts only connections that start on the computer. If it were ever started with a public `--host` by mistake, connections from other machines are dropped before any request is read. The launcher refuses non-loopback hosts entirely.
- The home copy, backups and WCO connector also check the `Host` header, so other websites cannot reach them through DNS tricks. Saving also requires the app's own `Origin`, a JSON body and a custom header. Video relays answer only same-origin requests, for random, short-lived playback IDs of episodes the connector itself prepared.
- Pages carry `X-Robots-Tag: noindex`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`.
- Tailscale encrypts the path between devices, and SSH encrypts it again. There is no Tailscale Serve or Funnel, router forward or public port.

If the phone is lost, remove it from the tailnet from another device and replace its firewall rule (see the remote-desktop handoff). The library itself is not stored anywhere the phone could expose: it is in that phone's browser storage and on the computer.

## Home copy and daily backups

When GPTNime is started from its launcher, `GPTNIME_LIBRARY_DIR` (default `~/.local/share/gptnime/library`) holds:

- `library.json`, the current home copy;
- `backups/gptnime-YYYY-MM-DD.json`: one per day, holding the library as it stood **before that day's first change**, so a bad save can never overwrite the copy that undoes it. The last 30 days are kept.

The directories are `0700` and the files `0600`, written atomically. Backups use the normal export format: restore one from **Library and backups** (it opens the usual import preview, set to Replace), or import the file with the top-bar upload button. Without `GPTNIME_LIBRARY_DIR` (tests, scratch servers, plain `npm run dev`), the home copy is off and each browser keeps its own library as before.
