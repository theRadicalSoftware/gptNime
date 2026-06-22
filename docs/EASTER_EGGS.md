# GPTNime Easter Eggs and Quiet Touches

GPTNime keeps its hidden touches subtle. They should make repeat use feel warmer and more attentive without interrupting tracking, adding jokes, or turning the interface into a novelty mode.

## Late-Night Mode

- Trigger: local time from 11:00 PM through 4:59 AM.
- Behavior: the app applies a slightly warmer, dimmer presentation and adds the small dashboard note `Late queue warmed for quieter picks.`
- Persistence: not stored. It follows the current device clock and updates while the app is open.

## Seasonal Ambient Shift

- Trigger: current month.
- Behavior: the app shell gets a very low-opacity seasonal color wash:
  - Winter: cool blue.
  - Spring: soft green.
  - Summer: muted gold.
  - Fall: red/gold warmth.
- Persistence: not stored. It follows the current device date.

## Hidden Search Query

- Trigger: typing `sage` or `gptnime` into the AniList search field.
- Behavior: the brand mark does one quiet pulse.
- Persistence: not stored. This is only a momentary acknowledgement.

## Sage Queue Microcopy

- Trigger: the existing hidden Sage mode toggle still controls Sage mode. The Sage Queue card now also rotates restrained microcopy such as `Quiet pick`, `Good signal`, and `One gentle nudge`.
- Behavior: the card stays useful and understated; it does not become a joke mode.
- Persistence: Sage mode remains stored under `gptnime-sage-mode-v1`.

## 10/10 Favorite Glint

- Trigger: a title is marked as favorite and has a user score of exactly `10.0`.
- Behavior: favorite/star affordances get a slow, quiet shimmer.
- Persistence: uses normal title fields, `favorite` and `rating`.

## Franchise Complete Stamp

- Trigger: a grouped franchise has more than one entry and every entry is completed.
- Behavior: the library card shows a tasteful `Complete run` stamp.
- Persistence: derived from existing status/progress data.

## Episode Milestone Pips

- Trigger: any title with a known episode count.
- Behavior: progress bars show small pips for episode 1, halfway, and finale. Rewatching titles use the rewatch progress accent.
- Persistence: derived from existing progress and episode count data.

## Rewatch Ritual

- Trigger: a title is in `Plan to Rewatch` or `Rewatching`.
- Behavior: progress bars switch to the lighter rewatch accent so rewatch runs read differently from first runs.
- Persistence: uses the existing `rewatchStatus` field.

## Anime-Channel Static

- Trigger: opening the anime channel.
- Behavior: a half-second scanline/static overlay plays once as the channel appears.
- Persistence: not stored.

## End-Card Moment

- Trigger: a title becomes completed from a non-completed state by progress, status change, or `Mark watched already`.
- Behavior: a quiet end-card modal shows title art, completion date, score, episode count/logged count, run span, and actions to close or open the title.
- Persistence: not stored. It is a momentary completion acknowledgement.

## Related Quality-of-Life Features

- Episode memory: each title can store a focused recap under `episodeMemo`, separate from general notes.
- Notification controls: stale threshold, watching-only filter, high-priority-only filter, snooze, dismiss, mute title, and clear silences are stored under `gptnime-notification-prefs-v1`.
- Anime-channel player: local VTT subtitles, playback speed, Picture-in-Picture, 90% auto mark-watched, compact mode, and next-signal queue are session-level browser behaviors.
- Fan stats: dashboard stats include completion rate, episodes watched this month, rewatch count, movie/series mix, top genres/studios, average score by genre, month activity heatmap, and longest pause.
- Smart shelves: generated from local library data for one-episode finishes, short finishes, high-priority stalled titles, comfort rewatches, movies under two hours, studio spotlight, and long runners. The `Recommended for you` shelf uses AniList recommendations seeded by ratings, favorites, rewatches, and completed titles, then excludes every title already tracked in the library.
