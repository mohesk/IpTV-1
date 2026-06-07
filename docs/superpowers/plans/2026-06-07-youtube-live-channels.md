# YouTube Live Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `📺 YouTube` channel category whose channels are live-checked client-side; live channels play in the existing player via the live HLS manifest, offline channels show their latest video with a "last streamed" time and play it via a YouTube IFrame embed.

**Architecture:** A new UMD-style module `js/youtube.js` does all detection by fetching each channel's `/live` page and extracting `ytInitialPlayerResponse` / `ytInitialData`. Its pure parsing functions are unit-tested in Node with small synthetic fixtures. `app.js` merges the YouTube channels into the existing channel list, orchestrates probing (on category open + periodic refresh), and routes playback to either the existing AVPlay/HTML5 pipeline (live) or a new IFrame-embed path in `player.js` (offline latest video).

**Tech Stack:** Vanilla ES5-style JS (no bundler, IIFE modules), Tizen AVPlay + HTML5 `<video>`, Node's built-in `node:test` for unit tests, `localStorage` for settings.

---

## Spec reference

Design: [docs/superpowers/specs/2026-06-07-youtube-live-channels-design.md](../specs/2026-06-07-youtube-live-channels-design.md)

## File structure

```
config/youtube_channels.json   CREATE - editable list of 13 channels
js/youtube.js                  CREATE - YT module: pure parsers + async load/probe
tools/test/youtube.test.js     CREATE - Node unit tests for the pure parsers
tools/test/fixtures.js         CREATE - synthetic HTML fixtures for tests
js/storage.js                  MODIFY - add getYtProxy/setYtProxy
js/player.js                   MODIFY - add playEmbed(); teardown iframe in play()/stop()
js/ui.js                       MODIFY - data-channel-id on rows; youtube subtitle/badge; setYtStatus()
js/app.js                      MODIFY - merge YT channels; probe orchestration; playback routing; refresh timer
index.html                     MODIFY - <iframe id="yt-embed"> + load js/youtube.js
css/style.css                  MODIFY - .ch-sub, .ch-live badge, .yt-embed
package.json                   MODIFY - "test" script
README.md                      MODIFY - document the YouTube section
```

## Status object shape (used everywhere)

Returned by `YT.parseProbeHtml(html)` / `YT.probe(channel)` and cached on `channel.yt`:

```js
// live
{ state: 'live',    hlsUrl, videoId, title, thumbnail, checkedAt }
// offline
{ state: 'offline', videoId, title, thumbnail, sinceText, checkedAt }
// could not determine
{ state: 'error', checkedAt }
// transient UI-only state set before a probe resolves
{ state: 'checking' }
```

---

### Task 1: Test harness + brace-balanced JSON extractor

**Files:**
- Create: `js/youtube.js`
- Create: `tools/test/fixtures.js`
- Create: `tools/test/youtube.test.js`
- Modify: `package.json`

- [ ] **Step 1: Add the test script to package.json**

In `package.json`, change the `"scripts"` block to:

```json
  "scripts": {
    "dev": "node scripts/dev-server.js",
    "build": "bash scripts/build-wgt.sh",
    "test": "node --test tools/test/"
  },
```

- [ ] **Step 2: Create the fixtures file**

Create `tools/test/fixtures.js` with small synthetic pages that mirror the real
markers (`ytInitialPlayerResponse`, `ytInitialData`) but with minimal JSON:

```js
'use strict';

// A page where the channel is currently live.
const LIVE_HTML = `
<!doctype html><html><head><title>Live Chan - YouTube</title></head><body>
<script>var ytInitialPlayerResponse = {
  "playabilityStatus": {"status": "OK"},
  "streamingData": {"hlsManifestUrl": "https://manifest.googlevideo.com/api/live/abc.m3u8"},
  "videoDetails": {
    "videoId": "LIVEvid123",
    "title": "Tonight Live Show",
    "isLive": true,
    "isLiveContent": true,
    "thumbnail": {"thumbnails": [{"url": "https://i.ytimg.com/vi/LIVEvid123/default.jpg"},
                                  {"url": "https://i.ytimg.com/vi/LIVEvid123/hqdefault.jpg"}]}
  }
};</script>
</body></html>`;

// A page where the live stream is offline; ytInitialData carries the latest video.
const OFFLINE_HTML = `
<!doctype html><html><head><title>Some Chan - YouTube</title></head><body>
<script>var ytInitialPlayerResponse = {
  "playabilityStatus": {"status": "LIVE_STREAM_OFFLINE"}
};</script>
<script>var ytInitialData = {
  "contents": {"section": {"items": [
    {"videoRenderer": {
      "videoId": "PASTvid456",
      "title": {"runs": [{"text": "Yesterday's Stream"}]},
      "publishedTimeText": {"simpleText": "Streamed 2 days ago"},
      "thumbnail": {"thumbnails": [{"url": "https://i.ytimg.com/vi/PASTvid456/hqdefault.jpg"}]}
    }}
  ]}}
};</script>
</body></html>`;

// A page with no usable YouTube JSON at all.
const GARBAGE_HTML = `<!doctype html><html><body>nothing here</body></html>`;

module.exports = { LIVE_HTML, OFFLINE_HTML, GARBAGE_HTML };
```

- [ ] **Step 3: Write the failing test for `extractJsonObject`**

Create `tools/test/youtube.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const YT = require('../../js/youtube.js');
const { LIVE_HTML, GARBAGE_HTML } = require('./fixtures.js');

test('extractJsonObject pulls a balanced object after a marker', () => {
  const obj = YT.extractJsonObject(LIVE_HTML, 'ytInitialPlayerResponse');
  assert.ok(obj, 'should return an object');
  assert.strictEqual(obj.playabilityStatus.status, 'OK');
  assert.strictEqual(obj.streamingData.hlsManifestUrl,
    'https://manifest.googlevideo.com/api/live/abc.m3u8');
});

test('extractJsonObject returns null when the marker is absent', () => {
  assert.strictEqual(YT.extractJsonObject(GARBAGE_HTML, 'ytInitialPlayerResponse'), null);
});

test('extractJsonObject returns null on non-string input', () => {
  assert.strictEqual(YT.extractJsonObject(null, 'x'), null);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../js/youtube.js'` (file does not exist yet).

- [ ] **Step 5: Create `js/youtube.js` with the extractor**

Create `js/youtube.js`:

```js
/* ===========================================================================
   youtube.js  -  YouTube channel live-detection + metadata extraction.

   Detection is fully client-side: fetch a channel's /live page and read the
   ytInitialPlayerResponse / ytInitialData JSON the page embeds. No API key.

   The pure parsing helpers (extractJsonObject, classify, deepFindVideo,
   parseProbeHtml, buildChannels) are exported for unit testing in Node. The
   async wrappers (load, probe) use fetch/XHR and only run in the app.
   =========================================================================== */
var YT = (function () {
    'use strict';

    // ---- pure helpers -------------------------------------------------------

    // Find the first {...} object after `marker` and JSON.parse it. Uses a
    // string-aware brace scanner so braces inside JSON strings don't confuse it.
    function extractJsonObject(html, marker) {
        if (typeof html !== 'string') { return null; }
        var idx = html.indexOf(marker);
        if (idx === -1) { return null; }
        var start = html.indexOf('{', idx);
        if (start === -1) { return null; }

        var depth = 0, inStr = false, esc = false;
        for (var i = start; i < html.length; i++) {
            var c = html.charAt(i);
            if (inStr) {
                if (esc) { esc = false; }
                else if (c === '\\') { esc = true; }
                else if (c === '"') { inStr = false; }
            } else if (c === '"') {
                inStr = true;
            } else if (c === '{') {
                depth++;
            } else if (c === '}') {
                depth--;
                if (depth === 0) {
                    try { return JSON.parse(html.slice(start, i + 1)); }
                    catch (e) { return null; }
                }
            }
        }
        return null;
    }

    return {
        extractJsonObject: extractJsonObject
    };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = YT; }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all three `extractJsonObject` tests pass.

- [ ] **Step 7: Commit**

```bash
git add js/youtube.js tools/test/fixtures.js tools/test/youtube.test.js package.json
git commit -m "feat(youtube): add JSON extractor + test harness"
```

---

### Task 2: `classify()` — live detection

**Files:**
- Modify: `js/youtube.js`
- Test: `tools/test/youtube.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tools/test/youtube.test.js`:

```js
const { OFFLINE_HTML } = require('./fixtures.js');

test('classify returns a live status for a live player response', () => {
  const player = YT.extractJsonObject(LIVE_HTML, 'ytInitialPlayerResponse');
  const s = YT.classify(player);
  assert.ok(s);
  assert.strictEqual(s.state, 'live');
  assert.strictEqual(s.hlsUrl, 'https://manifest.googlevideo.com/api/live/abc.m3u8');
  assert.strictEqual(s.videoId, 'LIVEvid123');
  assert.strictEqual(s.title, 'Tonight Live Show');
  assert.strictEqual(s.thumbnail, 'https://i.ytimg.com/vi/LIVEvid123/hqdefault.jpg');
});

test('classify returns null when the stream is offline', () => {
  const player = YT.extractJsonObject(OFFLINE_HTML, 'ytInitialPlayerResponse');
  assert.strictEqual(YT.classify(player), null);
});

test('classify returns null on missing input', () => {
  assert.strictEqual(YT.classify(null), null);
  assert.strictEqual(YT.classify({}), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `YT.classify is not a function`.

- [ ] **Step 3: Implement `classify` (+ thumbnail helpers)**

In `js/youtube.js`, insert these helpers and `classify` immediately after the
`extractJsonObject` function (before the `return {...}`):

```js
    function pickThumb(t) {
        if (t && t.thumbnails && t.thumbnails.length) {
            return t.thumbnails[t.thumbnails.length - 1].url;
        }
        return '';
    }

    function thumbFor(id) {
        return id ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : '';
    }

    // Given a parsed ytInitialPlayerResponse, return a live status or null.
    function classify(player) {
        if (!player || !player.streamingData) { return null; }
        var hls = player.streamingData.hlsManifestUrl;
        var status = player.playabilityStatus && player.playabilityStatus.status;
        var vd = player.videoDetails || {};
        var isLive = vd.isLive === true ||
                     (vd.isLiveContent === true && status === 'OK' && !!hls);
        if (hls && status === 'OK' && isLive) {
            return {
                state: 'live',
                hlsUrl: hls,
                videoId: vd.videoId || '',
                title: vd.title || '',
                thumbnail: pickThumb(vd.thumbnail) || thumbFor(vd.videoId)
            };
        }
        return null;
    }
```

Then add them to the returned object:

```js
    return {
        extractJsonObject: extractJsonObject,
        classify: classify
    };
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS — all `classify` tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/youtube.js tools/test/youtube.test.js
git commit -m "feat(youtube): add classify() live detection"
```

---

### Task 3: `deepFindVideo()` — latest video from ytInitialData

**Files:**
- Modify: `js/youtube.js`
- Test: `tools/test/youtube.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tools/test/youtube.test.js`:

```js
test('deepFindVideo finds the first video node with id + title', () => {
  const data = YT.extractJsonObject(OFFLINE_HTML, 'ytInitialData');
  const v = YT.deepFindVideo(data);
  assert.ok(v);
  assert.strictEqual(v.videoId, 'PASTvid456');
  assert.strictEqual(v.title, "Yesterday's Stream");
  assert.strictEqual(v.sinceText, 'Streamed 2 days ago');
  assert.strictEqual(v.thumbnail, 'https://i.ytimg.com/vi/PASTvid456/hqdefault.jpg');
});

test('deepFindVideo returns null when no video node exists', () => {
  assert.strictEqual(YT.deepFindVideo({a: {b: [1, 2, 3]}}), null);
  assert.strictEqual(YT.deepFindVideo(null), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `YT.deepFindVideo is not a function`.

- [ ] **Step 3: Implement `textOf` + `deepFindVideo`**

In `js/youtube.js`, insert after `classify` (before the `return {...}`):

```js
    // Flatten a YouTube text object ({simpleText} or {runs:[{text}]}) to a string.
    function textOf(t) {
        if (!t) { return ''; }
        if (typeof t === 'string') { return t; }
        if (t.simpleText) { return t.simpleText; }
        if (t.runs && t.runs.length) {
            return t.runs.map(function (r) { return r.text || ''; }).join('');
        }
        return '';
    }

    // Depth-first search for the first node that looks like a video
    // (has a videoId and a title/headline). Returns its id/title/thumb/since.
    function deepFindVideo(node, guard) {
        guard = guard || { n: 0 };
        if (!node || typeof node !== 'object') { return null; }
        if (guard.n++ > 300000) { return null; } // safety bound on huge pages

        if (node.videoId && (node.title || node.headline)) {
            return {
                videoId: node.videoId,
                title: textOf(node.title || node.headline),
                thumbnail: pickThumb(node.thumbnail) || thumbFor(node.videoId),
                sinceText: textOf(node.publishedTimeText)
            };
        }

        if (Array.isArray(node)) {
            for (var i = 0; i < node.length; i++) {
                var r = deepFindVideo(node[i], guard);
                if (r) { return r; }
            }
        } else {
            for (var k in node) {
                if (!Object.prototype.hasOwnProperty.call(node, k)) { continue; }
                var v = node[k];
                if (v && typeof v === 'object') {
                    var r2 = deepFindVideo(v, guard);
                    if (r2) { return r2; }
                }
            }
        }
        return null;
    }
```

Update the returned object:

```js
    return {
        extractJsonObject: extractJsonObject,
        classify: classify,
        deepFindVideo: deepFindVideo
    };
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/youtube.js tools/test/youtube.test.js
git commit -m "feat(youtube): add deepFindVideo() latest-video extractor"
```

---

### Task 4: `parseProbeHtml()` — orchestration

**Files:**
- Modify: `js/youtube.js`
- Test: `tools/test/youtube.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tools/test/youtube.test.js`:

```js
const { GARBAGE_HTML: GARBAGE } = require('./fixtures.js'); // alias, already imported above is fine

test('parseProbeHtml -> live for a live page', () => {
  const s = YT.parseProbeHtml(LIVE_HTML);
  assert.strictEqual(s.state, 'live');
  assert.strictEqual(s.videoId, 'LIVEvid123');
});

test('parseProbeHtml -> offline with sinceText for an offline page', () => {
  const s = YT.parseProbeHtml(OFFLINE_HTML);
  assert.strictEqual(s.state, 'offline');
  assert.strictEqual(s.videoId, 'PASTvid456');
  assert.strictEqual(s.sinceText, 'Streamed 2 days ago');
});

test('parseProbeHtml -> error for an unusable page', () => {
  assert.strictEqual(YT.parseProbeHtml('<html></html>').state, 'error');
  assert.strictEqual(YT.parseProbeHtml(null).state, 'error');
});
```

Note: `GARBAGE` alias is unused by these assertions; you may omit that `require` line if your linter complains.

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `YT.parseProbeHtml is not a function`.

- [ ] **Step 3: Implement `parseProbeHtml`**

In `js/youtube.js`, insert after `deepFindVideo` (before `return {...}`):

```js
    // Classify a fetched /live page into a status object.
    function parseProbeHtml(html) {
        if (typeof html !== 'string' || !html) { return { state: 'error' }; }

        var player = extractJsonObject(html, 'ytInitialPlayerResponse');
        var live = classify(player);
        if (live) { return live; }

        var data = extractJsonObject(html, 'ytInitialData');
        var vid = data ? deepFindVideo(data) : null;
        if (vid && vid.videoId) {
            return {
                state: 'offline',
                videoId: vid.videoId,
                title: vid.title,
                thumbnail: vid.thumbnail,
                sinceText: vid.sinceText || 'recently'
            };
        }
        return { state: 'error' };
    }
```

Update the returned object:

```js
    return {
        extractJsonObject: extractJsonObject,
        classify: classify,
        deepFindVideo: deepFindVideo,
        parseProbeHtml: parseProbeHtml
    };
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/youtube.js tools/test/youtube.test.js
git commit -m "feat(youtube): add parseProbeHtml() orchestration"
```

---

### Task 5: `buildChannels()` + the channel list file

**Files:**
- Create: `config/youtube_channels.json`
- Modify: `js/youtube.js`
- Test: `tools/test/youtube.test.js`

- [ ] **Step 1: Create the channel list**

Create `config/youtube_channels.json`:

```json
[
  { "handle": "RadioShemroon", "name": "Radio Shemroon" },
  { "handle": "gghamarimpp", "name": "GG Hamari" },
  { "handle": "MehdiMirghaderi", "name": "Mehdi Mirghaderi" },
  { "handle": "TousiTV", "name": "Tousi TV" },
  { "handle": "Behnamamini1", "name": "Behnam Amini" },
  { "handle": "cinamarex", "name": "Cinamarex" },
  { "handle": "MoradVaisi", "name": "Morad Vaisi" },
  { "handle": "Fravahar", "name": "Fravahar" },
  { "handle": "JamshidChalangi1", "name": "Jamshid Chalangi" },
  { "handle": "MortezaEsmailpour", "name": "Morteza Esmailpour" },
  { "handle": "upozittv", "name": "Upozit TV" },
  { "handle": "MojVahedi", "name": "Moj Vahedi" },
  { "handle": "project.leon.official", "name": "Project Leon" }
]
```

- [ ] **Step 2: Write the failing tests**

Append to `tools/test/youtube.test.js`:

```js
test('buildChannels maps entries to channel objects', () => {
  const chans = YT.buildChannels([
    { handle: '@RadioShemroon', name: 'Radio Shemroon' },
    { handle: 'TousiTV' }
  ]);
  assert.strictEqual(chans.length, 2);
  assert.strictEqual(chans[0].id, 'yt:RadioShemroon');   // leading @ stripped
  assert.strictEqual(chans[0].handle, 'RadioShemroon');
  assert.strictEqual(chans[0].type, 'youtube');
  assert.strictEqual(chans[0].group, '📺 YouTube');
  assert.strictEqual(chans[1].name, 'TousiTV');          // falls back to handle
});

test('buildChannels ignores bad entries', () => {
  assert.deepStrictEqual(YT.buildChannels(null), []);
  assert.strictEqual(YT.buildChannels([{}, { handle: 'x' }]).length, 1);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test`
Expected: FAIL — `YT.buildChannels is not a function`.

- [ ] **Step 4: Implement `buildChannels`**

In `js/youtube.js`, insert after `parseProbeHtml` (before `return {...}`):

```js
    var GROUP = '📺 YouTube'; // 📺 YouTube

    // Map the JSON list to channel objects compatible with the app's model.
    function buildChannels(list) {
        if (!Array.isArray(list)) { return []; }
        return list
            .filter(function (e) { return e && e.handle; })
            .map(function (e) {
                var handle = String(e.handle).replace(/^@/, '');
                return {
                    id: 'yt:' + handle,
                    name: e.name || handle,
                    url: '',
                    logo: '',
                    group: GROUP,
                    type: 'youtube',
                    handle: handle,
                    chno: '',
                    attrs: {},
                    yt: null,
                    index: 0
                };
            });
    }
```

Update the returned object to include both `buildChannels` and the group name:

```js
    return {
        GROUP: GROUP,
        extractJsonObject: extractJsonObject,
        classify: classify,
        deepFindVideo: deepFindVideo,
        parseProbeHtml: parseProbeHtml,
        buildChannels: buildChannels
    };
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/youtube.js config/youtube_channels.json tools/test/youtube.test.js
git commit -m "feat(youtube): add buildChannels() and channel list"
```

---

### Task 6: Async wrappers — `load()` and `probe()`

These use `fetch`/`XHR` and the optional CORS proxy; they are exercised manually
in the app (Task 11), not unit-tested.

**Files:**
- Modify: `js/youtube.js`

- [ ] **Step 1: Add the async wrappers**

In `js/youtube.js`, insert after `buildChannels` (before `return {...}`):

```js
    // ---- async wrappers (browser/TV only) ----------------------------------

    function httpGet(url) {
        if (typeof fetch === 'function') {
            return fetch(url, { cache: 'no-store' }).then(function (r) {
                if (!r.ok) { throw new Error('HTTP ' + r.status); }
                return r.text();
            });
        }
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) { return; }
                if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
                    resolve(xhr.responseText);
                } else { reject(new Error('HTTP ' + xhr.status)); }
            };
            xhr.onerror = function () { reject(new Error('Network error')); };
            xhr.send();
        });
    }

    // Optional CORS-proxy prefix for dev-browser testing (blank on TV).
    function proxied(url) {
        var p = (typeof Store !== 'undefined' && Store.getYtProxy)
            ? Store.getYtProxy() : '';
        return p ? (p + encodeURIComponent(url)) : url;
    }

    function now() { return (Date && Date.now) ? Date.now() : 0; }

    // Load the bundled channel list (same-origin, no proxy).
    function load() {
        return httpGet('config/youtube_channels.json').then(function (text) {
            var list;
            try { list = JSON.parse(text); }
            catch (e) { return []; }
            return buildChannels(list);
        }).catch(function () { return []; });
    }

    // Probe one channel's live status. Never rejects: failures -> state:'error'.
    function probe(channel) {
        var url = 'https://www.youtube.com/@' + channel.handle + '/live?hl=en';
        return httpGet(proxied(url)).then(function (html) {
            var s = parseProbeHtml(html);
            s.checkedAt = now();
            return s;
        }).catch(function () {
            return { state: 'error', checkedAt: now() };
        });
    }
```

Update the returned object to add `load` and `probe`:

```js
    return {
        GROUP: GROUP,
        extractJsonObject: extractJsonObject,
        classify: classify,
        deepFindVideo: deepFindVideo,
        parseProbeHtml: parseProbeHtml,
        buildChannels: buildChannels,
        load: load,
        probe: probe
    };
```

- [ ] **Step 2: Verify the unit tests still pass (no regression)**

Run: `npm test`
Expected: PASS — adding async functions must not break the pure-function tests.
(`require`-ing the module must not throw: `fetch`/`XMLHttpRequest`/`Store` are
only referenced inside functions, never at load time.)

- [ ] **Step 3: Commit**

```bash
git add js/youtube.js
git commit -m "feat(youtube): add load()/probe() async wrappers with proxy support"
```

---

### Task 7: `storage.js` — CORS-proxy setting

**Files:**
- Modify: `js/storage.js`

- [ ] **Step 1: Add the proxy key and accessors**

In `js/storage.js`, add the key constant next to the others (after line 11,
`var KEY_LAST = 'iptv.lastChannel';`):

```js
    var KEY_YTPROXY = 'iptv.ytProxy';
```

Add these two functions just before the `return {` block (after
`setLastChannel`):

```js
    function getYtProxy() { var v = get(KEY_YTPROXY); return (v && v.trim()) ? v.trim() : ''; }
    function setYtProxy(v) { set(KEY_YTPROXY, (v || '').trim()); }
```

Add them to the returned object (inside the `return { ... }`):

```js
        getYtProxy: getYtProxy,
        setYtProxy: setYtProxy,
```

- [ ] **Step 2: Manual sanity check**

Run: `npm run dev` then in the browser console at `http://localhost:8080`:
```js
Store.setYtProxy('https://example.org/?u='); Store.getYtProxy();
```
Expected: returns `'https://example.org/?u='`. Then `Store.setYtProxy(''); Store.getYtProxy();` returns `''`.

- [ ] **Step 3: Commit**

```bash
git add js/storage.js
git commit -m "feat(storage): add YouTube CORS-proxy setting"
```

---

### Task 8: `player.js` — IFrame embed path

**Files:**
- Modify: `index.html` (add iframe)
- Modify: `js/player.js`

- [ ] **Step 1: Add the iframe element**

In `index.html`, inside `<div id="player-screen" ...>`, add the iframe right
after the `<video id="html5-player" ...>` line (after line 55):

```html
        <!-- YouTube IFrame embed (offline channels' latest video) -->
        <iframe id="yt-embed" class="yt-embed hidden" frameborder="0"
                allow="autoplay; encrypted-media" allowfullscreen></iframe>
```

- [ ] **Step 2: Load the youtube module**

In `index.html`, add the script tag before `js/ui.js` (after the
`js/player.js` line, line 130):

```html
    <script src="js/youtube.js"></script>
```

- [ ] **Step 3: Add iframe handling to player.js**

In `js/player.js`, add a module-level variable next to the others (after
`var video = null;`, line 23):

```js
    var ytFrame = null;        // <iframe> for YouTube VOD embeds
```

In `init()`, cache the iframe — add after `video = document.getElementById('html5-player');`:

```js
        ytFrame = document.getElementById('yt-embed');
```

Add a helper and the public `playEmbed` function. Insert before the
`/* ----------------------------------------------------------------- public */`
comment:

```js
    /* -------------------------------------------------------- YouTube embed */
    function hideEmbed() {
        if (!ytFrame) { return; }
        ytFrame.classList.add('hidden');
        try { ytFrame.src = 'about:blank'; } catch (e) {}
    }

    function playEmbed(videoId) {
        // Stop any AVPlay/HTML5 playback and surface the iframe.
        if (engine === 'avplay') { avplayStop(); }
        else { try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) {} }
        if (avObj) { avObj.style.display = 'none'; }
        if (video) { video.style.display = 'none'; }
        if (!ytFrame) { fire('onError', 'Embedded player unavailable.'); return; }

        ytFrame.classList.remove('hidden');
        ytFrame.onerror = function () { fire('onError', 'Could not load the video.'); };
        ytFrame.src = 'https://www.youtube.com/embed/' + videoId +
                      '?autoplay=1&playsinline=1&rel=0';
        paused = false;
        fire('onPlaying');
    }
```

- [ ] **Step 4: Restore the native surface when playing a normal channel**

In `play()` (the public function), add embed teardown and surface restore at the
top of the function body, before the `if (engine === 'avplay')` line:

```js
        hideEmbed();
        if (engine === 'avplay') { if (avObj) { avObj.style.display = 'block'; } }
        else if (video) { video.style.display = 'block'; }
```

- [ ] **Step 5: Tear down the iframe on stop()**

In `stop()`, add `hideEmbed();` as the first line of the function body.

- [ ] **Step 6: Export `playEmbed`**

In the returned object at the bottom of `player.js`, add:

```js
        playEmbed: playEmbed,
```

- [ ] **Step 7: Add iframe styling**

In `css/style.css`, append:

```css
/* YouTube VOD embed fills the player surface like the video element. */
.yt-embed {
    position: absolute;
    top: 0; left: 0;
    width: 1920px;
    height: 1080px;
    border: 0;
    background: #000;
    z-index: 1;
}
.yt-embed.hidden { display: none; }
```

- [ ] **Step 8: Manual smoke test (browser)**

Run: `npm run dev`, open `http://localhost:8080`, then in the console:
```js
Player.init(); Player.playEmbed('dQw4w9WgXcQ');
```
Expected: the `#yt-embed` iframe becomes visible and loads a YouTube player.
Then `Player.stop();` hides it again.

- [ ] **Step 9: Commit**

```bash
git add index.html js/player.js css/style.css
git commit -m "feat(player): add YouTube IFrame embed playback path"
```

---

### Task 9: `ui.js` — YouTube row rendering + status updates

**Files:**
- Modify: `js/ui.js`
- Modify: `css/style.css`

- [ ] **Step 1: Tag every channel row with its id**

In `js/ui.js` `renderChannels`, after `li.className = 'channel-item';`
(line 91), add:

```js
            li.setAttribute('data-channel-id', ch.id);
```

- [ ] **Step 2: Render a subtitle + live badge for YouTube channels**

In `renderChannels`, replace the block that builds the name node (lines 100-102):

```js
            var name = document.createElement('div');
            name.className = 'ch-name';
            name.textContent = ch.name;
```

with:

```js
            var name = document.createElement('div');
            name.className = 'ch-name';
            var nameText = document.createElement('span');
            nameText.textContent = ch.name;
            name.appendChild(nameText);
            if (ch.type === 'youtube') {
                var badge = document.createElement('span');
                badge.className = 'ch-live hidden';
                name.appendChild(badge);
                var sub = document.createElement('div');
                sub.className = 'ch-sub';
                sub.textContent = 'Checking…';
                name.appendChild(sub);
            }
```

- [ ] **Step 3: Add `setYtStatus`**

In `js/ui.js`, add this function before the `return {` block:

```js
    // Update a YouTube channel row in place with its probe status.
    function setYtStatus(channelId, status) {
        var list = els['channel-list'];
        var li = list.querySelector('[data-channel-id="' + channelId + '"]');
        if (!li) { return; }
        var badge = li.querySelector('.ch-live');
        var sub = li.querySelector('.ch-sub');
        if (!sub) { return; }

        if (status.state === 'live') {
            if (badge) { badge.textContent = '● LIVE'; badge.classList.remove('hidden'); }
            sub.textContent = 'Live now';
        } else if (status.state === 'offline') {
            if (badge) { badge.classList.add('hidden'); }
            sub.textContent = 'Last streamed ' + (status.sinceText || 'recently');
            if (status.thumbnail) {
                var wrap = li.querySelector('.ch-logo-wrap');
                if (wrap) {
                    wrap.innerHTML = '';
                    var img = document.createElement('img');
                    img.className = 'ch-logo';
                    img.alt = '';
                    img.src = status.thumbnail;
                    wrap.appendChild(img);
                }
            }
        } else if (status.state === 'checking') {
            if (badge) { badge.classList.add('hidden'); }
            sub.textContent = 'Checking…';
        } else {
            if (badge) { badge.classList.add('hidden'); }
            sub.textContent = 'Status unavailable';
        }
    }
```

Add it to the returned object:

```js
        setYtStatus: setYtStatus,
```

- [ ] **Step 4: Style the badge and subtitle**

In `css/style.css`, append:

```css
/* YouTube live badge + status subtitle in the channel list. */
.ch-live {
    margin-left: 12px;
    padding: 2px 10px;
    border-radius: 6px;
    background: #c00;
    color: #fff;
    font-size: 20px;
    font-weight: 700;
    vertical-align: middle;
}
.ch-live.hidden { display: none; }
.ch-sub {
    margin-top: 4px;
    font-size: 22px;
    color: #9aa0a6;
}
```

- [ ] **Step 5: Manual smoke test (browser)**

Run: `npm run dev`, open the app, then in the console:
```js
UI.cache();
UI.renderChannels(
  [{ id: 'yt:Test', name: 'Test Chan', type: 'youtube', logo: '', group: '📺 YouTube' }],
  null, function () { return false; });
UI.setYtStatus('yt:Test', { state: 'live' });
```
Expected: the row shows a red `● LIVE` badge and `Live now`. Re-running with
`{ state: 'offline', sinceText: '2 days ago', thumbnail: '' }` shows
`Last streamed 2 days ago`.

- [ ] **Step 6: Commit**

```bash
git add js/ui.js css/style.css
git commit -m "feat(ui): render YouTube live badge + status subtitle"
```

---

### Task 10: `app.js` — merge channels, probe orchestration, playback routing

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Add YouTube state fields**

In `js/app.js`, add fields to the `state` object (after `settingsIndex: 0`,
line 29 — add a comma to the previous line):

```js
        settingsIndex: 0,
        ytRefreshTimer: null,    // periodic re-probe while the YT group is open
        ytConcurrency: 4         // max parallel probes
```

- [ ] **Step 2: Merge YouTube channels after the playlist loads**

In `loadPlaylist`, replace the `.then(function (channels) {...})` body (lines
59-64) with:

```js
        Playlist.load(url).then(function (channels) {
            state.channels = channels;
            rebuildGroups();
            enterBrowser();
            if (initial) { tryResumeLast(); }
            // Append YouTube channels asynchronously; failure is non-fatal.
            YT.load().then(function (yt) {
                if (yt && yt.length) {
                    state.channels = state.channels.concat(yt);
                    rebuildGroups();
                }
            });
        }).catch(function (err) {
```

(Leave the existing `.catch(...)` block unchanged.)

- [ ] **Step 3: Start/stop probing when the YouTube group gains/loses focus**

In `onGroupFocus`, after `state.viewChannels = group.channels;` (line 100), add:

```js
        if (group.name === YT.GROUP) { startYtProbing(group.channels); }
        else { stopYtProbing(); }
```

- [ ] **Step 4: Add the probing orchestration functions**

In `js/app.js`, add these functions after `onGroupFocus`/`highlightChannelArea`
(before `onChannelSelect`, line 126):

```js
    /* ============================================================ youtube */
    function startYtProbing(channels) {
        stopYtProbing();
        channels.forEach(function (ch) {
            if (ch.type === 'youtube') { UI.setYtStatus(ch.id, { state: 'checking' }); }
        });
        runYtProbes(channels);
        state.ytRefreshTimer = setInterval(function () {
            runYtProbes(channels);
        }, 180000); // refresh every 3 minutes
    }

    function stopYtProbing() {
        if (state.ytRefreshTimer) {
            clearInterval(state.ytRefreshTimer);
            state.ytRefreshTimer = null;
        }
    }

    // Probe a list of YouTube channels with a small concurrency cap, updating
    // each row as it resolves.
    function runYtProbes(channels) {
        var queue = channels.filter(function (ch) { return ch.type === 'youtube'; });
        var i = 0;
        function next() {
            if (i >= queue.length) { return; }
            var ch = queue[i++];
            YT.probe(ch).then(function (status) {
                ch.yt = status;
                // Only paint if this group is still the one on screen.
                if (state.mode === 'browser') { UI.setYtStatus(ch.id, status); }
                next();
            });
        }
        var lanes = Math.min(state.ytConcurrency, queue.length);
        for (var L = 0; L < lanes; L++) { next(); }
    }
```

- [ ] **Step 5: Route YouTube channels through a dedicated playback function**

In `onChannelSelect`, replace the body (lines 126-132):

```js
    function onChannelSelect(index) {
        var ch = state.viewChannels[index];
        if (!ch) { return; }
        state.playList = state.viewChannels.slice();
        state.playIndex = index;
        startPlayback(ch);
    }
```

with:

```js
    function onChannelSelect(index) {
        var ch = state.viewChannels[index];
        if (!ch) { return; }
        state.playList = state.viewChannels.slice();
        state.playIndex = index;
        if (ch.type === 'youtube') { playYouTube(ch); }
        else { startPlayback(ch); }
    }
```

- [ ] **Step 6: Add `playYouTube`**

In `js/app.js`, add after `startPlayback` (after line 204):

```js
    function playYouTube(channel) {
        state.mode = 'player';
        state.playingId = channel.id;
        Store.setLastChannel(channel.id);
        UI.show('player-screen');
        UI.hidePlayerError();
        UI.showSpinner(true, 'Checking live status…');
        UI.showOsd(channel, state.playIndex, 'Checking…');
        clearOsdHide();

        YT.probe(channel).then(function (status) {
            channel.yt = status;
            if (status.state === 'live') {
                channel.url = status.hlsUrl;
                UI.setOsdState('● LIVE');
                Player.play(channel, currentPlayHandlers());
            } else if (status.state === 'offline') {
                UI.showSpinner(false);
                UI.showOsd(channel, state.playIndex,
                    'Offline · last streamed ' + (status.sinceText || 'recently'));
                scheduleOsdHide();
                Player.playEmbed(status.videoId);
            } else {
                UI.showSpinner(false);
                UI.showPlayerError('This channel is offline and no recent video was found.');
            }
        });
    }
```

- [ ] **Step 7: Stop probing when leaving the browser into settings/app exit**

In `openSettings`, add `stopYtProbing();` as the first line of the function body
(before `state.mode = 'settings';`, line 303).

- [ ] **Step 8: Manual verification — see Task 11.**

- [ ] **Step 9: Commit**

```bash
git add js/app.js
git commit -m "feat(app): merge YouTube channels, probe orchestration, playback routing"
```

---

### Task 11: End-to-end manual verification

**Files:** none (verification only)

This feature's network + DOM + AVPlay behavior can't be unit-tested in this
project; verify it by running the app. The dev browser cannot fetch YouTube
(CORS) unless a proxy is set, so do the full check on TV hardware; use the proxy
for a browser smoke test.

- [ ] **Step 1: Unit tests green**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 2: Browser smoke test with a CORS proxy (optional)**

Run: `npm run dev`, open `http://localhost:8080`. In the console set a proxy
(use any CORS proxy you trust, expecting a URL-encoded target), e.g.:
```js
Store.setYtProxy('https://corsproxy.io/?url=');
```
Reload. Open the `📺 YouTube` category.
Expected: rows transition from `Checking…` to either `● LIVE` / `Live now` or
`Last streamed <time>`. Selecting an offline channel shows the embedded latest
video; selecting a live channel attempts HLS playback (may not play in a
non-Safari browser — that's expected; it plays on TV).
Reset afterward: `Store.setYtProxy('');`

- [ ] **Step 3: TV verification (authoritative)**

Build and install per README (`npm run build` for an unsigned archive, or the
signed Tizen CLI flow), launch on the TV, and confirm:
- The `📺 YouTube` category lists all 13 channels.
- Rows show `Checking…` then live/offline status.
- A live channel plays in the player with `● LIVE` on the OSD; CH▲/▼ and number
  zapping still work across the list.
- An offline channel shows `Offline · last streamed <time>` and plays its latest
  video in the embedded player.
- Leaving the category (open Settings, or focus another category) stops the
  background refresh (no further network requests for YouTube).

- [ ] **Step 4: Update the README**

In `README.md`, under **Features**, add a bullet:

```markdown
- **YouTube live channels** — a `📺 YouTube` category checks listed channels for
  live status (client-side, no API key); live channels play directly, offline
  ones show their latest video and when it last streamed. Edit the list in
  `config/youtube_channels.json`.
```

Under **Project layout**, add inside the `config/` area:

```markdown
config/youtube_channels.json  YouTube channels checked for live status
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document the YouTube live channels section"
```

---

## Self-review notes

- **Spec coverage:** channel source/JSON (Task 5), `YT.load`/`probe` (Task 6),
  `ytInitialPlayerResponse` extraction + classify (Tasks 1-2), latest-video +
  sinceText (Tasks 3-4), live→AVPlay routing (Task 10 `playYouTube`),
  offline→IFrame embed (Tasks 8 + 10), per-row status UI (Task 9), on-open +
  periodic refresh (Task 10 `startYtProbing`), dev CORS proxy (Tasks 6-7),
  error degradation (`state:'error'` throughout), README (Task 11). All spec
  sections map to a task.
- **Type consistency:** status object `{state, hlsUrl, videoId, title,
  thumbnail, sinceText, checkedAt}` is produced by `classify`/`parseProbeHtml`
  (Tasks 2,4) and consumed identically by `UI.setYtStatus` (Task 9) and
  `playYouTube` (Task 10). Group name is the single constant `YT.GROUP`
  (`'📺 YouTube'`) used in `buildChannels`, `onGroupFocus`, and `startYtProbing`.
  Public functions referenced match their definitions: `YT.load`, `YT.probe`,
  `YT.GROUP`, `Player.playEmbed`, `UI.setYtStatus`, `Store.getYtProxy`.
```
