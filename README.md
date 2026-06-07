# IPTV for Samsung Tizen TV

A lightweight IPTV player for **Samsung Smart TVs (Tizen)** that streams live
channels from an **M3U / M3U8 playlist**. Built as a vanilla JavaScript Tizen
web app — no frameworks, no bundler — so it stays fast and easy to package.

![IPTV channel browser](icon.png)

## Features

- **M3U / M3U8 playlist support** — parses extended `#EXTINF` attributes
  (`tvg-name`, `tvg-logo`, `group-title`, `tvg-chno`, `#EXTGRP`).
- **Channel browser** — categories sidebar + channel list with logos
  (initials fallback), channel numbers and a live clock.
- **Robust HLS playback** — uses Samsung's **AVPlay** API on real hardware,
  with an automatic **HTML5 `<video>`** fallback for development and
  native-HLS TVs.
- **Full TV-remote control** — D-pad navigation, OK to play, number-key
  **zapping**, channel up/down, play/pause/stop, and the four colour keys.
- **Favorites** — mark channels with the yellow key; a Favorites category is
  added automatically (persisted in `localStorage`).
- **Search** — filter channels by name/group via an on-screen keyboard.
- **Settings** — change the playlist URL with the on-screen keyboard, switch
  to the bundled sample, or clear favorites. Settings persist across launches.
- **1080p UI** designed for the 10-foot viewing experience.

## Remote control

| Key | Channel browser | Player |
| --- | --- | --- |
| ◀ ▲ ▼ ▶ | Move between categories / channels | ▲▼ change channel; ◀▶ show info |
| **OK** | Enter category / play channel | Play / pause |
| **Back** | Exit app | Return to channel list |
| **0–9** | Jump to channel number | Zap to channel number |
| **CH ▲ / CH ▼** | Move in channel list | Previous / next channel |
| 🔴 Red | Reload playlist | — |
| 🟢 Green | Open Settings | — |
| 🟡 Yellow | Toggle favorite | — |
| 🔵 Blue | Search | — |
| ▶/⏸ ⏹ | — | Play-pause / stop |

## Project layout

```
config.xml                 Tizen application manifest (privileges, profile)
index.html                 App shell / screens
icon.png                   App icon
css/style.css              1080p TV-optimized styling
js/
  keys.js                  TV remote key codes + registration
  storage.js               localStorage settings (URL, favorites, last channel)
  playlist.js              M3U / M3U8 parser + loader
  focus.js                 D-pad list navigation with auto-scroll
  keyboard.js              On-screen keyboard for URL / search entry
  player.js                AVPlay + HTML5 video playback abstraction
  ui.js                    DOM rendering (groups, channels, OSD, toasts)
  app.js                   Controller / state machine + key router
config/playlist.example.m3u  Bundled sample playlist (public test streams)
scripts/
  dev-server.js            Static server for browser testing
  build-wgt.sh             Package an (unsigned) .wgt archive
```

## Develop in a browser

The app is plain HTML/CSS/JS, so you can run and exercise the whole UI in a
desktop browser (keyboard arrows + Enter map to the D-pad; `Esc`/`Backspace`
act as Back).

```bash
npm run dev          # serves on http://localhost:8080
# or: node scripts/dev-server.js 8080
```

> Note: raw HLS `.m3u8` streams only play in browsers with native HLS support
> (e.g. Safari). On Samsung TV hardware, AVPlay handles HLS natively.

## Configure your playlist

1. Launch the app and press the **green** (Settings) key.
2. Select **Playlist source** and enter your M3U / M3U8 URL with the on-screen
   keyboard, or choose **Use bundled sample playlist**.
3. Press **Back** to save and reload.

The URL is remembered between launches.

## Build & install on a TV

A Tizen `.wgt` is a ZIP of the project with `config.xml` at the root. For real
installation it must be **signed** with author + distributor certificates.

### Quick unsigned archive (for inspection / CLI input)

```bash
npm run build        # writes build/IPTV.wgt
```

### Signed package with Tizen Studio CLI

Install [Tizen Studio](https://developer.tizen.org/development/tizen-studio)
and create a signing profile, then:

```bash
# 1. Create an author + distributor certificate profile (once):
tizen certificate -a IPTV -p 1234 -f iptv-author -- ~/tizen-certs
tizen security-profiles add -n IPTVProfile -a ~/tizen-certs/iptv-author.p12 -p 1234

# 2. Build and package:
tizen build-web -- .
tizen package -t wgt -s IPTVProfile -- .buildResult

# 3. Install on a TV in Developer Mode (replace with your TV's IP):
sdb connect 192.168.1.50
tizen install -n IPTV.wgt -t <device-id>
```

### Enable Developer Mode on the TV

On the Samsung TV: **Apps → press `1 2 3 4 5`** to open the Developer Mode
dialog, turn it **On**, and enter your development PC's IP address, then
restart the TV. Connect with `sdb connect <tv-ip>`.

## How playback works

`js/player.js` exposes one API used by the controller:

```js
Player.init();                       // picks AVPlay or HTML5 automatically
Player.play(channel, handlers);      // handlers: onBuffering/onPlaying/onEnded/onError
Player.togglePause();                // -> 'playing' | 'paused'
Player.stop();
```

- **AVPlay** (`webapis.avplay`) renders into the `<object type="application/avplayer">`
  element, set to a full 1920×1080 display rect with letterboxing. This is the
  recommended path on Samsung TVs and supports HLS, DASH and progressive
  streams with hardware decoding.
- **HTML5 `<video>`** is used wherever AVPlay is unavailable.

## License

MIT
