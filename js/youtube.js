/* ===========================================================================
   youtube.js  -  YouTube channel live-detection + metadata via the official
   YouTube Data API v3.

   Why the API (and not scraping youtube.com): a TV browser sends an Origin
   header on cross-origin requests, and youtube.com returns no
   Access-Control-Allow-Origin (so the body is unreadable) and 302-redirects to
   a consent wall. The Data API IS browser-callable (returns CORS headers) and
   needs only an API key the user pastes into Settings.

   probe(channel):
     1. search?eventType=live  -> if an item, the channel is LIVE.
     2. else search?order=date -> the channel's latest video (offline state).

   Pure helpers (buildChannels, parseSearchItem, relativeFromIso) are exported
   for unit testing in Node. The async wrappers (load, probe) run in the app.
   =========================================================================== */
var YT = (function () {
    'use strict';

    var GROUP = '📺 YouTube'; // 📺 YouTube
    var API = 'https://www.googleapis.com/youtube/v3/search';

    // ---- pure helpers -------------------------------------------------------

    function pickThumb(thumbs) {
        if (!thumbs) { return ''; }
        var t = thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default;
        return (t && t.url) ? t.url : '';
    }

    function thumbFor(id) {
        return id ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : '';
    }

    // Parse a YouTube Data API search response. Returns the first video's
    // { videoId, title, thumbnail, publishedAt } or null when there are no
    // items. Throws on an API error payload (carrying .reason, e.g.
    // 'quotaExceeded' / 'keyInvalid') so callers can report it.
    function parseSearchItem(json) {
        if (json && json.error) {
            var errs = json.error.errors;
            var reason = (errs && errs.length && errs[0].reason) || '';
            var e = new Error(json.error.message || 'YouTube API error');
            e.reason = reason;
            throw e;
        }
        if (!json || !json.items || !json.items.length) { return null; }
        var it = json.items[0];
        var sn = it.snippet || {};
        var vid = (it.id && it.id.videoId) ? it.id.videoId : '';
        if (!vid) { return null; }
        return {
            videoId: vid,
            title: sn.title || '',
            thumbnail: pickThumb(sn.thumbnails) || thumbFor(vid),
            publishedAt: sn.publishedAt || ''
        };
    }

    // Turn an ISO timestamp into a coarse "3 days ago" string. nowMs is passed
    // in so this stays pure and testable.
    function relativeFromIso(iso, nowMs) {
        if (!iso) { return 'recently'; }
        var t = Date.parse(iso);
        if (isNaN(t)) { return 'recently'; }
        var s = Math.floor((nowMs - t) / 1000);
        if (s < 0) { s = 0; }
        var units = [
            ['year', 31536000], ['month', 2592000], ['week', 604800],
            ['day', 86400], ['hour', 3600], ['minute', 60]
        ];
        for (var i = 0; i < units.length; i++) {
            var n = Math.floor(s / units[i][1]);
            if (n >= 1) { return n + ' ' + units[i][0] + (n > 1 ? 's' : '') + ' ago'; }
        }
        return 'just now';
    }

    // Map the JSON channel list to channel objects compatible with the app.
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
                    channelId: e.channelId || '',
                    chno: '',
                    attrs: {},
                    yt: null,
                    index: 0
                };
            });
    }

    // ---- async wrappers (browser/TV only) ----------------------------------

    function now() { return (Date && Date.now) ? Date.now() : 0; }

    // GET that returns the response body even on a 4xx/5xx, so the API's JSON
    // error payload (quota/key) can be parsed rather than swallowed.
    function apiGet(url) {
        if (typeof fetch === 'function') {
            return fetch(url, { cache: 'no-store' }).then(function (r) { return r.text(); });
        }
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) { return; }
                if (xhr.responseText) { resolve(xhr.responseText); }
                else { reject(new Error('Network error')); }
            };
            xhr.onerror = function () { reject(new Error('Network error')); };
            xhr.send();
        });
    }

    // Plain GET for the bundled, same-origin channel list.
    function localGet(url) {
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

    function getApiKey() {
        return (typeof Store !== 'undefined' && Store.getYtApiKey) ? Store.getYtApiKey() : '';
    }

    function searchOne(channelId, mode, key) {
        var url = API + '?part=snippet&type=video&maxResults=1' +
            '&channelId=' + encodeURIComponent(channelId) +
            '&key=' + encodeURIComponent(key) +
            (mode === 'live' ? '&eventType=live' : '&order=date');
        return apiGet(url).then(function (text) {
            var json;
            try { json = JSON.parse(text); }
            catch (e) { throw new Error('Bad API response'); }
            return parseSearchItem(json);
        });
    }

    // Load the bundled channel list (same-origin, no key needed).
    function load() {
        return localGet('config/youtube_channels.json').then(function (text) {
            var list;
            try { list = JSON.parse(text); }
            catch (e) { return []; }
            return buildChannels(list);
        }).catch(function () { return []; });
    }

    // Probe one channel via the Data API. Never rejects: failures resolve to
    // { state:'error', reason }.
    function probe(channel) {
        var key = getApiKey();
        if (!key) { return Promise.resolve({ state: 'error', reason: 'no-key', checkedAt: now() }); }
        if (!channel.channelId) {
            return Promise.resolve({ state: 'error', reason: 'no-channel-id', checkedAt: now() });
        }
        return searchOne(channel.channelId, 'live', key).then(function (live) {
            if (live) {
                return {
                    state: 'live',
                    videoId: live.videoId,
                    title: live.title,
                    thumbnail: live.thumbnail,
                    checkedAt: now()
                };
            }
            return searchOne(channel.channelId, 'latest', key).then(function (v) {
                if (v) {
                    return {
                        state: 'offline',
                        videoId: v.videoId,
                        title: v.title,
                        thumbnail: v.thumbnail,
                        sinceText: relativeFromIso(v.publishedAt, now()),
                        checkedAt: now()
                    };
                }
                return { state: 'error', reason: 'no-video', checkedAt: now() };
            });
        }).catch(function (e) {
            return { state: 'error', reason: (e && e.reason) || (e && e.message) || 'fetch', checkedAt: now() };
        });
    }

    return {
        GROUP: GROUP,
        buildChannels: buildChannels,
        parseSearchItem: parseSearchItem,
        relativeFromIso: relativeFromIso,
        load: load,
        probe: probe
    };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = YT; }
