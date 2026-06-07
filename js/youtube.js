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
