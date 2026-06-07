# YouTube Live Channels — Design

**Date:** 2026-06-07
**Status:** Implemented, then revised (see Addendum)
**Component:** Tizen IPTV web app (`js/`, `config/`, `index.html`, `css/`)

> **Addendum (2026-06-07): data source changed from scraping to the YouTube Data API.**
> The original design detected live status by fetching each channel's `/live`
> page and scraping `ytInitialPlayerResponse`. On real TV hardware this fails
> for **every** channel: a browser context sends an `Origin` header, and
> youtube.com returns **no `Access-Control-Allow-Origin`** (body unreadable) and
> **302-redirects to a consent wall**. The implementation now uses the
> **YouTube Data API v3** (`search.list`), which is browser-callable (returns
> CORS headers, no consent wall) with a user-supplied API key stored in
> Settings. Channel IDs are baked into `config/youtube_channels.json`. Both live
> and offline videos play via the YouTube IFrame embed (an HLS URL is no longer
> available without scraping). Live detection = `search?eventType=live`; latest
> video (offline) = `search?order=date`. Quota-aware: probe on category open +
> selection, cached ~5 min, no continuous polling. The sections below describe
> the original (superseded) scraping approach.

## Summary

Add a section of YouTube channels to the IPTV app. Each channel is checked
**client-side** for live status. When live, the channel plays in the normal
player (via the live stream's HLS manifest). When not live, the channel shows
its latest video with a "Last streamed X ago" label, and selecting it plays
that latest video.

This is purely client-side — no backend, no server component, consistent with
the existing vanilla-JS Tizen app.

## Goals

- A dedicated category (`📺 YouTube`) listing 13 specified channels.
- Per-channel live detection that runs on the TV with no API key.
- Live channel → plays the live stream in the existing player with full OSD /
  remote support.
- Offline channel → shows latest-video thumbnail + relative "last streamed"
  time; selecting plays that video.
- Status shown per row (LIVE badge vs. offline subtitle), refreshed periodically.

## Non-goals

- No YouTube login / personalization / subscriptions.
- No transcoding or server-side proxying of streams.
- No full VOD browsing — only the single latest video per channel when offline.
- Reliable playback of arbitrary ciphered VOD via AVPlay (handled via embed).

## Channels (initial list)

Stored in `config/youtube_channels.json`:

| Handle | Display name |
| --- | --- |
| RadioShemroon | Radio Shemroon |
| gghamarimpp | (from channel) |
| MehdiMirghaderi | Mehdi Mirghaderi |
| TousiTV | Tousi TV |
| Behnamamini1 | Behnam Amini |
| cinamarex | Cinamarex |
| MoradVaisi | Morad Vaisi |
| Fravahar | Fravahar |
| JamshidChalangi1 | Jamshid Chalangi |
| MortezaEsmailpour | Morteza Esmailpour |
| upozittv | Upozit TV |
| MojVahedi | Moj Vahedi |
| project.leon.official | Project Leon |

Display names are best-effort and may be refined from the channel page title at
load time. The list is editable by hand in the JSON file.

## Architecture

The app stays a no-framework, module-per-file structure. One new module and a
new data file, plus small additions to existing modules.

```
config/youtube_channels.json   NEW  - the editable channel list
js/youtube.js                  NEW  - YT module: load + probe + extract
js/player.js                   EDIT - add IFrame-embed engine path for VOD
js/ui.js                       EDIT - render YouTube rows + setYtStatus()
js/app.js                      EDIT - merge YT channels, probe orchestration,
                                       YouTube-aware playback + refresh timer
index.html                     EDIT - add <iframe id="yt-embed"> to player screen
css/style.css                  EDIT - LIVE badge, thumbnail subtitle, embed layout
```

### Channel data model

YouTube channels are normal channel objects so existing navigation, favorites,
zapping and the OSD work unchanged, with extra fields:

```js
{
  id: 'yt:RadioShemroon',
  name: 'Radio Shemroon',
  group: '📺 YouTube',
  type: 'youtube',           // marks the special play/probe path
  handle: 'RadioShemroon',
  logo: '',                  // replaced by video thumbnail after probe
  url: '',                   // filled with hlsUrl when live
  yt: null                   // probe result (see below), null until checked
}
```

### `js/youtube.js` — the `YT` module

Public API:

- `YT.load()` → `Promise<channel[]>`
  Fetches `config/youtube_channels.json`, returns channel objects as above.

- `YT.probe(channel)` → `Promise<status>`
  1. `fetch('https://www.youtube.com/@' + handle + '/live?hl=en', {cache:'no-store'})`
     (prefixed with the optional CORS proxy if configured — see Dev caveat).
  2. Extract the `ytInitialPlayerResponse` object: locate the assignment, scan
     for the balanced closing brace, `JSON.parse`. Wrapped in try/catch.
  3. Classify:
     - **live**: `streamingData.hlsManifestUrl` present AND
       `playabilityStatus.status === 'OK'` AND `videoDetails.isLive`/`isLiveContent`.
       → `{ state:'live', hlsUrl, videoId, title, thumbnail }`
     - **offline**: otherwise. Parse `ytInitialData` (channel header / latest
       video) or fall back to fetching the `/streams` (then `/videos`) tab to
       find the most recent video: `videoId`, `title`, `thumbnail`, and
       `sinceText` taken from YouTube's own `publishedTimeText`
       (e.g. "Streamed 3 days ago").
       → `{ state:'offline', videoId, title, thumbnail, sinceText }`
     - **error**: network/parse failure → `{ state:'error' }`

`status` shape (returned and cached on `channel.yt`):
```js
{ state: 'live'|'offline'|'error',
  hlsUrl, videoId, title, thumbnail, sinceText, checkedAt }
```

Extraction helpers (`extractJsonObject(html, marker)`, brace scanner) live in
this module and are defensive: any failure yields `state:'error'` rather than
throwing.

### Playback paths

Driven by `channel.type === 'youtube'` and its probe state, handled in `app.js`:

- **Live** → set `channel.url = status.hlsUrl`, call the existing
  `Player.play(channel, handlers)`. AVPlay (TV) / HTML5 (Safari) plays the HLS
  manifest. OSD shows `● LIVE`. No new player code for this path.

- **Offline (latest video)** → `Player.playEmbed(videoId)` — a new minimal path
  in `player.js` that shows an `<iframe id="yt-embed">` over the player area with
  `src = https://www.youtube.com/embed/<videoId>?autoplay=1&playsinline=1`, and
  hides the AVPlay object / `<video>`. OSD shows the title + `sinceText`.
  If the embed errors or is blocked, surface the existing player-error panel
  with "Couldn't play — last streamed X ago."

`Player.stop()` is extended to also hide/clear the iframe so switching back to a
normal channel tears down the embed.

### UI

- `js/ui.js` gains `setYtStatus(channelId, status)`:
  - **live** → row shows a red `● LIVE` badge; OSD state `● LIVE`.
  - **offline** → row logo becomes the video `thumbnail`; a subtitle line shows
    `Last streamed X ago` (from `sinceText`).
  - **checking** (initial) → subtitle `Checking…`.
  - **error** → subtitle `Status unavailable`.
- `renderChannels` is extended so a channel with `type:'youtube'` can render the
  subtitle line and badge. Non-YouTube rows are unchanged.

### Orchestration & timing (in `app.js`)

- On `boot`, after the M3U playlist loads, `YT.load()` runs and its channels are
  appended to `state.channels`; `rebuildGroups()` (existing `groupByCategory`)
  then surfaces the `📺 YouTube` group automatically — no parser change needed.
- Entering the `📺 YouTube` group:
  - Fire `YT.probe` for all channels in parallel with a small concurrency cap
    (e.g. 4 at a time); update each row via `setYtStatus` as it resolves.
  - Start a refresh `setInterval` (~3 min) that re-probes while the group is the
    active view. Clear it on leaving the group / app pause.
- On OK for a YouTube channel: re-probe that one channel (fresh), then route to
  the live or embed playback path based on the result.

### Dev-browser caveat

YouTube page fetches are CORS-blocked in a desktop browser but allowed on TV
hardware (`<access origin="*">` + `network.public`). To allow optional browser
testing, `YT` reads a CORS-proxy prefix from settings/storage
(`iptv.ytProxy`, blank by default). When blank (production on TV), fetches go
direct. When set, probes route through the proxy. Browser without a proxy →
probes return `state:'error'` and rows show "Status unavailable"; the rest of
the app is unaffected.

## Error handling

- Probe network/parse errors → `state:'error'`, row shows "Status unavailable",
  no crash; channel can be retried by re-entering the group or on OK.
- Live HLS that AVPlay rejects → existing `onError` player panel.
- Offline embed blocked/unavailable → player-error panel with the "last
  streamed" hint.
- Missing/malformed `youtube_channels.json` → the group is simply omitted; the
  rest of the app loads normally.

## Testing

- **Unit (extraction):** feed saved sample HTML (live, offline, consent/edge,
  garbage) into `YT`'s extraction helpers and assert the classified status.
  Run in Node with small fixtures under `tools/` or a test dir.
- **Manual (TV / browser-with-proxy):**
  - Open `📺 YouTube` → rows transition checking → live/offline.
  - A live channel plays via AVPlay with `● LIVE` OSD.
  - An offline channel shows thumbnail + "last streamed X ago" and plays the
    latest video via embed on OK.
  - Periodic refresh flips a row when a stream goes live/offline.
  - Leaving the group stops the refresh timer.

## Known risks

1. **Scraping fragility** — YouTube can change page markup; extraction may need
   maintenance. Mitigated by defensive parsing (errors degrade to "unavailable",
   never crash).
2. **AVPlay + YouTube HLS** — generally works but is not guaranteed on every TV
   firmware; failures fall through to the existing error panel.
3. **VOD embed availability** — offline playback depends on YouTube allowing the
   iframe embed in the TV webview; blocked embeds degrade to the info-only state.
