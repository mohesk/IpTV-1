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

    // Flatten a YouTube text object ({simpleText} or {runs:[{text}]}) to a string.
    function textOf(t) {
        if (!t) { return ''; }
        if (typeof t === 'string') { return t; }
        if (t.simpleText !== undefined) { return t.simpleText; }
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
        if (guard.n++ > 300000) { return null; } // bound total nodes visited (YouTube JSON is wide, not deep)

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

    return {
        extractJsonObject: extractJsonObject,
        classify: classify,
        deepFindVideo: deepFindVideo
    };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = YT; }
