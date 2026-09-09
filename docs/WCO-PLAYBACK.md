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

## Automatic discovery — September 8, 2026

Watch and episode selections now send title aliases, the episode number and language to the local connector without requiring a WCO link. It searches WCO’s public episode results first, compares the complete show/season prefix and exact episode number, and follows the provider-issued page. Series search and All Seasons episode lists provide a fallback; movie searches exclude numbered TV episodes. Duplicate editions and uncertain title matches appear as choices inside the cinema. Next/Previous resolves a fresh source from a remembered stable page or repeats discovery.

The live DevTools run started from an isolated library with no saved WCO pages. Clicking Watch for Cowboy Bebop episode 25 automatically found `https://www.wco.tv/cowboy-bebop-episode-25-english-dubbed-2`, the exact link supplied by the user. WCO then held that page at “Performing security verification.” The series pages for Cowboy Bebop and Samurai Champloo were held at the same check. No verification controls were automated. This verifies live page discovery, but does not establish fresh live autoplay on September 8. The September 7 native-delivery evidence above remains separate.

The browser regression suite reproduces episode 1/Subbed with the supplied episode 25/Dubbed link: the cinema updates to episode 25/Dubbed and autoplays real decoded fixture media. It also verifies lookup without saved URLs, strict title/season matching, language fallback, in-cinema choices, cancellation, stale-response protection and a busy resolver retry. The general headed cinema suite continues to cover native PiP, regular pop-out, docking, playback/resume and watch-history integrity. No real ledger data is modified by these tests.

## Persistent session and live autoplay — September 8, later verification

The repeated verification investigation found that the connector launched a fresh automation browser/profile for every attempt and discarded it after a two-minute timeout. The implementation now starts ordinary installed Chrome with its own persistent, owner-only profile and attaches via local DevTools. It retains cookies, preserves unfinished verification on timeout, reports verification as a separate phase, and lets the user bring that same window forward. No human check was clicked or automated; no browser fingerprints, security policies, proxies or personal profiles were altered.

This later live run supersedes the earlier autoplay limitation for the tested Cowboy Bebop episodes. From an isolated fixture library with no saved WCO pages, Watch automatically found episode 25, loaded a 644 × 480 MP4 (1482.4 seconds), and played past 30 seconds. Next automatically prepared episode 26 in the same dedicated browser, received HTTP 206 MP4, and played a 1450.955-second video. Seeking to 360 seconds and native pop-out/pop-in preserved active playback. Fixture progress stayed at 24 and no raw source URL entered cinema storage.

One Piece episode 755 loaded past verification but displayed **This Video Is for Premium Users** on both the checked subbed and dubbed pages. The connector now reports that specific access restriction promptly, retains the same provider session for sign-in by an existing account holder, and does not start a trial or attempt to bypass access. Provider sign-in popups remain available after an access error, and Retry reloads the episode to pick up any accepted account session. That recovery path is covered by an intercepted fixture; live premium-account playback was not tested.

The user then noticed silence in the visible test viewer. That viewer was intentionally launched with `--mute-audio`. Reopening a separate viewer without the flag restored decoded, unmuted audio at volume 0.5, and the user confirmed sound was working. Provider preparation remains muted so only the cinema should be heard. User-visible playback was resumed near the 36-second position shown in their screenshot; system audio and microphone settings were left alone.

Ignored evidence: `output/research/session-2026-09-08/01-bebop-25-playing.png`, `02-bebop-26-next.png`, `04-audible-cinema.png`, `playback-proof.json`, and `audio-proof.json`. Session regression tests use only localhost cookies and intercepted provider fixtures, including simulated verification and account states; real provider cookie values and media query values are not logged or exported.

## Brave delivery and background preparation — September 8, Sentenced to Be a Hero

The reported failure was reproduced in Brave for **Sentenced to Be a Hero episode 1, English Subbed**. The existing connector always prepared media in Chrome. The resulting source returned HTTP 206 MP4 to Chrome but 404 HTML to Brave; Brave reported `net::ERR_BLOCKED_BY_ORB` and media error 4. Preparing a fresh source in ordinary Brave reversed the result: Brave decoded and played it, while Chrome failed on that same source. This demonstrates a browser-dependent handoff; the provider’s exact token-validation rules remain unknown. No browser identity or request-security settings were overridden.

The client now identifies Brave through its browser API and sends an allowlisted `X-WCO-Browser` selection with status, preparation and focus requests. The local connector uses the corresponding installed browser and separate dedicated profile. It does not copy personal profiles, share cookies across browsers, spoof a user agent or proxy media. Chrome remains the default for other clients; browsers beyond installed Chrome and Brave have not been verified.

Routine preparation no longer calls `show()` or `bringToFront()`. Startup suppresses the initial foreground window, requests minimized startup, and creates background tabs. The user explicitly chooses **Show WCO window** when verification or sign-in is needed. During this investigation Rory reported that test windows were disrupting work; visible test windows were closed, and subsequent headed checks ran on an isolated virtual X display. Future desktop investigations should use a virtual display or background checks instead of moving focus away from the user.

A full live test started from an isolated Brave library with no saved WCO URLs. Clicking the title automatically searched for episode 1, prepared its source in Brave and played inside the actual cinema. DevTools recorded HTTP 206 `video/mp4`, 853 × 480 decoding, duration 3480.16 seconds, and playback advancing beyond 45 seconds. Seeking to 300 seconds continued playback. Fixture progress remained zero, and no signed media URL entered cinema storage. Native media errors now offer **Retry episode** directly; failed player initialization reloads on retry, while unfinished human verification retains its page.

Build, lint, the WCO browser suite, session regressions and the general headed cinema suite passed. Browser tests cover the selected-browser header on every provider operation, actual media failure followed by same-episode retry, and absence of automatic focus calls. Ignored evidence is in `output/research/hero-2026-09-08/`: `02-brave-automatic-playback.png`, `comparison-proof.json`, `automatic-proof.json`, and `final-network.json`. Provider URLs remain only in memory; saved network records omit query values.

## Hidden preparation and startup time — September 8, 2026

Minimized/background windows could still appear briefly on the desktop. When Xvfb is available, the dedicated ordinary browser now runs on a private authenticated virtual display with TCP disabled. Only an explicit **Show WCO window** transfers the same saved profile to the desktop for human interaction. A pending resolver survives that handoff; successful preparation closes the explicitly shown browser and returns future preparation to the private display. The local workstation runtime is enabled, and `/api/wco/status` reports `hiddenPreparation: true`.

Automatic discovery submits WCO’s public search form directly, skipping an extra homepage load. A bounded cache holds up to eight already prepared sources per browser for at most 90 seconds in server memory. Sources are scoped by stable episode page, episode number, delivered language and movie flag. No signed source is saved to app storage or a cache file. Explicit Reload/Retry invalidates a recent source. Reselecting a source already buffered in the cinema resumes the existing video element, preserving time and avoiding a second load event.

Live measurements used ordinary Brave, an isolated fixture ledger and **Sentenced to Be a Hero episode 1, English Subbed**, without intercepting provider or media traffic:

| Measurement | Observed time |
| --- | --- |
| Previous resolver, fresh session with homepage lookup | 24.262 seconds to source ready |
| Hidden resolver with direct search, fresh session | 21.039 seconds to source ready |
| Fresh preparation from its remembered episode page | 15.716 seconds to source ready |
| Immediate server-side reuse of that prepared source | 3 milliseconds |
| Separate complete gptNime viewer run, first selection | 30.563 seconds to advancing playback; API response at 29.311 seconds |
| Reselecting that episode in the same viewer | 130 milliseconds to resumed playback; API response at 99 milliseconds |

These are individual observations, not a consistent percentage improvement or guaranteed latency. WCO’s normal announcement/player stage still took around 11 seconds in the timed traces; provider/network response time varied between runs. New episodes retain that preparation. A 90-second recent-source hit is a quick-return optimization, not advance preparation of every episode.

The final viewer run decoded 853 × 480 video, duration 3480.16 seconds, advancing video time and decoded audio bytes, with no media or browser runtime errors. The test viewer was muted and did not change system audio. Fixture progress remained zero. Screenshots and sanitized timings are under ignored `output/research/startup-2026-09-08/`: `baseline.json`, `optimized.json`, `repeat.json`, `live-viewer.json`, `hidden-preparation.png`, and `live-playback.png`. No query values are recorded in those artifacts.

Session fixtures check the actual desktop window tree: the hidden provider window is absent, explicit Show makes it visible while retaining its cookie and URL, and completion restores hidden preparation. Fixtures also cover direct POST lookup, cache/refresh behavior, expiry, size limits, episode/version isolation and resuming the same buffered element. All headed tests, including explicit Show and native PiP, run inside an additional private display so testing cannot interrupt the user’s desktop.

## Preparing before Play — September 8, 2026

A fresh timing trace still spent 20.346 seconds preparing Sentenced to Be a Hero episode 1 Subbed, including roughly 11 seconds in WCO’s normal announcement/player stage. The recent-source cache did not help the first selection of a different episode. The connector now starts bounded preparation while a person reads title details, browses the cinema chooser, or hovers/focuses a Watch action. During WCO playback, it prepares the next episode in the last 60 seconds of playback time. It uses the normal provider flow and the existing private display; it does not shorten the provider’s controls or verification requirements.

The new coordinator keeps a single provider job. Foreground clicks adopt matching work instead of restarting it, and preempt unrelated background work after cancellation cleanup. Background work has a 60-second limit and stops quietly on human verification or access requirements. It cannot interrupt a foreground request. A completed source retains the existing 90-second expiry. Leaving a hover or unmounting the previous episode does not cancel work that the new foreground request is adopting. Shared foreground viewers have independent cancellation signals.

A separate live run used the real local API, ordinary Brave and an isolated fixture ledger, without provider/media interception:

| Action | Background preparation | Wait after clicking to advancing playback |
| --- | --- | --- |
| Episode 1, prepared in the chooser | 23.685 seconds before the click | 3.283 seconds; resolver response at 71 ms |
| Episode 2, prepared while episode 1 was playing near its end | 15.110 seconds before the click | 2.188 seconds; resolver response at 153 ms |

Episode 1 decoded at 853 × 480 with duration 3480.16 seconds and advancing audio bytes. Episode 2 decoded at width 853 with duration 1514.985 seconds. Neither had a media error; browser runtime errors were absent and fixture progress stayed at zero. Measurements include native buffering, event/screenshot overhead and at least half a second of advancing playback. These are prepared starts, not a promise that an immediate cold click will start in two seconds. Clicking before preparation completes waits for the remaining work; expired, unprepared or provider-gated selections retain their ordinary preparation requirements.

Ignored evidence: `output/research/prefetch-2026-09-08/optimized.json` (fresh baseline), `live-viewer.json`, `hidden-preparation.png`, `live-playback.png`, `next-prepared.png`, and `next-playing.png`. Screenshots show the subtle prepared indicator beneath the episode controls. Media URLs stayed in process memory; saved network records contain no query values. All testing used private virtual displays.

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
