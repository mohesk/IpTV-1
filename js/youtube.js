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

    return {
        extractJsonObject: extractJsonObject,
        classify: classify
    };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = YT; }
