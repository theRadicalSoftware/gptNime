# WCO playback investigation — September 7, 2026

## Resolved: native playback inside gptNime

The delivery issue is resolved for the tested episodes. Cowboy Bebop 25 played inside the actual gptNime cinema after adding the browser's standard `no-referrer` policy. The new local connector then prepared episode 25 from its exact page and episode 26 from the user's series link. Episode 26 played in the cinema, sought past five minutes, and continued through pop-out, pop-in and docking.

The decisive controlled comparison used the same source and browser with cache disabled:

| Local browser request | Result |
| --- | --- |
| Default policy, `Referer: http://127.0.0.1:5190` | 404 HTML; media failed |
| `no-referrer`, no Referer header | 206 MP4; decoded with `readyState === 4` |

A plain Node fetch, and a Node fetch carrying the observed referring player URL, both returned 404. Neither is used by the implementation. Delivery uses Chrome's ordinary video request with no referrer, with no media proxy or provider-header impersonation. The server's complete decision logic remains unknown; the working browser comparison is the implementation evidence.

`index.html` sets the policy before resources load, and pop-out documents preserve it. [MDN documents the no-referrer policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy). The local `server/wco.ts` connector obtains a fresh source through a temporary visible Chrome session, using the site's enabled Close/Play controls. It leaves human and premium checks to the provider. The frontend saves only stable episode/series/neighbor page links, keeping media URLs in memory.

New local evidence is under ignored `output/research/delivery-2026-09-07/`: `01-live-wco-in-gptnime.png`, `02-live-wco-docked.png`, `live-cinema-proof.json`, `window-proof.json`, and `network.json`. Episode 26 decoded at 644 × 480 with a duration of 1450.955 seconds. This establishes successful playback for these samples, not all shows, movies, qualities or future provider changes.

A final clean-browser run selected episode 25 from the series link using the finished connector. `03-final-live-cinema.png` and `final-live-proof.json` record real playback, seeking to six minutes, preserved transfer time, fresh cache-disabled MP4 delivery in both Document PiP and the regular popup, continued dock playback, and unchanged fixture ledger progress. The final `network.json` contains sanitized observations from this run. Automated checks include `npm run test:wco` and `CINEMA_HEADED=1 npm run test:cinema`, in addition to build and lint.

## Initial result before the delivery fix

Cowboy Bebop episode 25 played successfully in WCO's normal player in headed Chrome. The same provider-issued video URL initially failed inside the actual gptNime cinema at `http://127.0.0.1:5190`. WCO's alternate Chromecast player also decoded the episode, but its issued media route initially failed from gptNime as well. The remaining sections preserve that earlier investigation; the resolved result above supersedes its implementation status.

This supersedes the earlier result that live WCO playback itself was unverified. It does not establish that every WCO episode, quality, server or browser behaves identically.

## User-provided navigation

- Series: <https://www.wco.tv/anime/cowboy-bebop/?season=all>
- Episode: <https://www.wco.tv/cowboy-bebop-episode-25-english-dubbed-2>

The exact episode URL can be opened directly without visiting the series page first. It returns an HTML page, not the video bytes. The series page is useful for discovering provider-issued episode links. Its slug suffix (`-2` here), seasons, language and episode numbering should not be inferred from an AniList ID or by string substitution.

## Observed normal player flow

The exact episode page returned HTTP 200 in a fresh assistant-owned Chrome context. No human challenge appeared in this run. The announcement's normal enabled **Close** control was used, followed by **Play Video**. The browser was muted throughout testing.

| Stage | Host and path | Observed result |
| --- | --- | --- |
| Episode HTML | `www.wco.tv/cowboy-bebop-episode-25-english-dubbed-2` | 200 |
| Initial embedded player | `embed.wcostream.com/inc/embed/index.php` | 200; provider-only frame ancestors |
| Normal player initialization | `embed.wcostream.com/ad-verify` | 204 from the provider's own browser flow |
| Video.js player | `embed.wcostream.com/inc/embed/video-js.php` | 200; provider-only frame ancestors |
| Source lookup | `embed.wcostream.com/inc/embed/getvidlink.php` | 200; query keys `v`, `embed`, `hd` |
| Delivery lookup | `ndisk.wcostream.com/getvid` | 200; query keys `evid`, `json` |
| Actual video | `undisk4.wcostream.com/getvid` | 206, `video/mp4`; query key `evid` |

Chrome decoded a 644 × 480 video with a duration of 1482.4 seconds (24:42). Playback time advanced with `readyState === 4` and no media error. Only this delivered quality was verified; catalogue quality badges are not evidence of the stream's decoded dimensions.

After the failed gptNime attempt, reloading the same media in the WCO player with browser cache disabled again returned 206 and decoded successfully. The source had not simply stopped working everywhere.

## Tests from gptNime

The direct source was transferred only in test-process memory into the real cinema's **Video URL** input. No network fixture substituted for WCO in these live tests. The gptNime test used an isolated Cowboy Bebop fixture library, not the user's stored library.

| Request context | Result |
| --- | --- |
| WCO's normal embedded player | 206 MP4; decoded and played |
| gptNime cinema in a separate clean browser context | 404 `text/html`; Chrome `net::ERR_BLOCKED_BY_ORB`; media error code 4 |
| A local video element in the same browser context already playing WCO | 404 `text/html`; Chrome `net::ERR_BLOCKED_BY_ORB`; media failed to load |
| WCO's alternate Chromecast player | 206 MP4; decoded and played |
| gptNime cinema using the alternate player's issued source | Dispatcher 302 followed by 404 `text/html` and `net::ERR_BLOCKED_BY_ORB` |

The 404 HTML response precedes the browser's media failure. A generic video format error is therefore not evidence that this episode's codec is unsupported: Chrome decoded it in WCO's player. The exact server-side condition causing the different response was not isolated. Do not claim that it is definitively a Referer check, cookie requirement, IP binding or expiration.

## Alternate player

Following the normal **Chromecast Player (2. Player)** link inside WCO loaded `embed.wcostream.com/inc/embed/embed.php` with HTTP 200. It used `/inc/embed/getvidlink-nginx.php`, then the media URL `ndisk.wcostream.com/getvid` redirected to `undisk1.wcostream.com/getvid`, which served a 206 MP4 response. Its embedding policy still excluded localhost. The exact issued dispatcher URL also failed in gptNime, as shown above.

Opening the alternate player link independently as a top-level page returned 403. That result alone would have been misleading: normal navigation from WCO subsequently worked. Both observations are retained to distinguish navigation contexts.

## Integration implications

Before the delivery fix, the app supported saving an exact episode page and opening it directly. It also permitted direct HTTPS media URLs to be attempted using the normal browser video element. Those capabilities alone did not make the tested WCO video routes work from the app's origin.

An inline integration needs both a supported way to resolve an episode to a source and delivery that works from gptNime. The provider's `frame-ancestors` restriction and its media delivery behavior are separate issues. No automatic resolver should be described as complete based only on receiving a source URL or a successful fixture test.

This investigation did not alter request origins/referrers, copy the user's cookies, bypass a human or premium check, modify provider policies, or add a media proxy. Transient source URLs and query values were not added to app storage or committed files.

## Local evidence

Ignored artifacts under `output/research/bebop-2026-09-07/`:

- `01-wco-verified-playback.png`: decoded episode in WCO's player.
- `02-gptnime-source-rejected.png`: the actual cinema's failed direct-source attempt, using a fixture library.
- `network.json`: sanitized host/path/query-key/status/response-policy observations.
- `playback-proof.json`: provider playback metrics and local browser diagnostics.
- `local-source-diagnostics.json`: initial Chrome network failure and HTTP 404 HTML evidence.

The existing automated cinema suite uses intercepted WCO fixtures and remains a separate verification of app behavior. It does not prove live provider playback.
