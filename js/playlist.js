/* ===========================================================================
   playlist.js  -  Loads and parses extended M3U / M3U8 playlists.

   Supported lines:
     #EXTM3U                                  (header, optional attributes)
     #EXTINF:-1 tvg-id="" tvg-name=""
             tvg-logo="" group-title="News",Channel Display Name
     #EXTGRP:News                             (alternate group syntax)
     http://host/stream.m3u8                  (stream URL on the next line)

   The parser is intentionally forgiving: blank lines and unknown #-directives
   are ignored, and a channel is only emitted once it has a stream URL.
   =========================================================================== */
var Playlist = (function () {
    'use strict';

    var ATTR_RE = /([a-zA-Z0-9_-]+)="([^"]*)"/g;

    function parseAttributes(s) {
        var attrs = {};
        var m;
        ATTR_RE.lastIndex = 0;
        while ((m = ATTR_RE.exec(s)) !== null) {
            attrs[m[1].toLowerCase()] = m[2];
        }
        return attrs;
    }

    // Parse an #EXTINF line into { attrs, duration, title }.
    function parseExtInf(line) {
        // line starts after "#EXTINF:"
        var body = line.slice(8);
        var commaIdx = body.indexOf(',');
        var meta = commaIdx === -1 ? body : body.slice(0, commaIdx);
        var title = commaIdx === -1 ? '' : body.slice(commaIdx + 1).trim();

        var durationMatch = meta.match(/^\s*(-?\d+(?:\.\d+)?)/);
        var duration = durationMatch ? parseFloat(durationMatch[1]) : -1;

        return {
            attrs: parseAttributes(meta),
            duration: duration,
            title: title
        };
    }

    function isUrlLine(line) {
        if (!line || line.charAt(0) === '#') { return false; }
        return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(line) || // http(s)://, rtsp://, udp://
               line.charAt(0) === '/' ||                      // absolute path
               /\.(m3u8?|ts|mp4|mkv)(\?|$)/i.test(line);      // relative media file
    }

    // Parse a full playlist string into an array of channel objects.
    function parse(text) {
        var lines = text.replace(/\r\n?/g, '\n').split('\n');
        var channels = [];
        var pending = null;     // metadata waiting for its URL
        var pendingGroup = '';   // from #EXTGRP
        var seq = 0;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) { continue; }

            if (line.indexOf('#EXTINF:') === 0) {
                pending = parseExtInf(line);
                pendingGroup = '';
            } else if (line.indexOf('#EXTGRP:') === 0) {
                pendingGroup = line.slice(8).trim();
            } else if (line.charAt(0) === '#') {
                // #EXTM3U / #EXTVLCOPT / comments -> ignore
                continue;
            } else if (isUrlLine(line)) {
                var meta = pending || { attrs: {}, title: '', duration: -1 };
                var attrs = meta.attrs;
                var name = (attrs['tvg-name'] || meta.title || 'Channel ' + (seq + 1)).trim();
                var group = (attrs['group-title'] || pendingGroup || 'Uncategorized').trim();

                channels.push({
                    id: attrs['tvg-id'] || (name + '|' + line),
                    name: name,
                    url: line,
                    logo: attrs['tvg-logo'] || '',
                    group: group,
                    chno: attrs['tvg-chno'] || attrs['channel-number'] || '',
                    attrs: attrs,
                    index: seq++
                });
                pending = null;
                pendingGroup = '';
            }
        }
        return channels;
    }

    // Group channels into ordered categories, with "Favorites" injected first
    // when there are any. Returns [{ name, channels: [...] }, ...].
    function groupByCategory(channels, favoriteIds) {
        var order = [];
        var byName = {};

        channels.forEach(function (ch) {
            if (!byName[ch.group]) {
                byName[ch.group] = { name: ch.group, channels: [] };
                order.push(ch.group);
            }
            byName[ch.group].channels.push(ch);
        });

        var groups = order.map(function (n) { return byName[n]; });

        // "All" pseudo-group first.
        groups.unshift({ name: 'All Channels', channels: channels.slice() });

        if (favoriteIds && favoriteIds.length) {
            var favSet = {};
            favoriteIds.forEach(function (id) { favSet[id] = true; });
            var favs = channels.filter(function (ch) { return favSet[ch.id]; });
            if (favs.length) {
                groups.unshift({ name: '★ Favorites', channels: favs });
            }
        }
        return groups;
    }

    // Resolve a possibly-relative playlist URL against the document location so
    // bundled files load both in a browser and from the Tizen package.
    function resolveUrl(url) {
        try { return new URL(url, window.location.href).href; }
        catch (e) { return url; }
    }

    // Fetch + parse. Returns a Promise<channels[]>.
    function load(url) {
        var resolved = resolveUrl(url);
        return fetchText(resolved).then(function (text) {
            if (!/#EXTM3U/i.test(text) && !/#EXTINF/i.test(text)) {
                // Not a recognisable playlist; still try to parse bare URLs.
                if (!/:\/\//.test(text)) {
                    throw new Error('The file does not look like an M3U playlist.');
                }
            }
            var channels = parse(text);
            if (!channels.length) {
                throw new Error('No channels found in the playlist.');
            }
            return channels;
        });
    }

    function fetchText(url) {
        // Prefer fetch(); fall back to XHR for older Tizen WebKit builds.
        if (typeof fetch === 'function') {
            return fetch(url, { cache: 'no-store' }).then(function (r) {
                if (!r.ok) { throw new Error('HTTP ' + r.status + ' loading playlist.'); }
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
                } else {
                    reject(new Error('HTTP ' + xhr.status + ' loading playlist.'));
                }
            };
            xhr.onerror = function () { reject(new Error('Network error loading playlist.')); };
            xhr.send();
        });
    }

    return {
        parse: parse,
        groupByCategory: groupByCategory,
        load: load
    };
})();
