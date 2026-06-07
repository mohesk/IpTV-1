/* ===========================================================================
   storage.js  -  Thin wrapper over localStorage for persisted settings:
   playlist URL, favourites, and the last-watched channel. Falls back to an
   in-memory store if localStorage is unavailable.
   =========================================================================== */
var Store = (function () {
    'use strict';

    var KEY_URL      = 'iptv.playlistUrl';
    var KEY_FAVS     = 'iptv.favorites';
    var KEY_LAST     = 'iptv.lastChannel';
    var KEY_YTPROXY  = 'iptv.ytProxy';
    var KEY_YTKEY    = 'iptv.ytApiKey';
    var DEFAULT_URL  = 'config/my_playlist.working2.m3u8';

    var mem = {};
    var backend;
    try {
        // Touch it to make sure access doesn't throw (private mode, etc.)
        window.localStorage.setItem('iptv.test', '1');
        window.localStorage.removeItem('iptv.test');
        backend = window.localStorage;
    } catch (e) {
        backend = {
            getItem: function (k) { return k in mem ? mem[k] : null; },
            setItem: function (k, v) { mem[k] = String(v); },
            removeItem: function (k) { delete mem[k]; }
        };
    }

    function get(k) { try { return backend.getItem(k); } catch (e) { return null; } }
    function set(k, v) { try { backend.setItem(k, v); } catch (e) {} }

    function getPlaylistUrl() {
        var u = get(KEY_URL);
        return (u && u.trim()) ? u.trim() : DEFAULT_URL;
    }
    function setPlaylistUrl(u) { set(KEY_URL, (u || '').trim()); }

    function getFavorites() {
        try { return JSON.parse(get(KEY_FAVS) || '[]'); }
        catch (e) { return []; }
    }
    function isFavorite(id) { return getFavorites().indexOf(id) !== -1; }
    function toggleFavorite(id) {
        var favs = getFavorites();
        var i = favs.indexOf(id);
        if (i === -1) { favs.push(id); } else { favs.splice(i, 1); }
        set(KEY_FAVS, JSON.stringify(favs));
        return i === -1; // true => now a favourite
    }
    function clearFavorites() { set(KEY_FAVS, '[]'); }

    function getLastChannel() { return get(KEY_LAST); }
    function setLastChannel(id) { set(KEY_LAST, id || ''); }

    function getYtProxy() { var v = get(KEY_YTPROXY); return (v && v.trim()) ? v.trim() : ''; }
    function setYtProxy(v) { set(KEY_YTPROXY, (v || '').trim()); }

    function getYtApiKey() { var v = get(KEY_YTKEY); return (v && v.trim()) ? v.trim() : ''; }
    function setYtApiKey(v) { set(KEY_YTKEY, (v || '').trim()); }

    return {
        DEFAULT_URL: DEFAULT_URL,
        getPlaylistUrl: getPlaylistUrl,
        setPlaylistUrl: setPlaylistUrl,
        getFavorites: getFavorites,
        isFavorite: isFavorite,
        toggleFavorite: toggleFavorite,
        clearFavorites: clearFavorites,
        getLastChannel: getLastChannel,
        setLastChannel: setLastChannel,
        getYtProxy: getYtProxy,
        setYtProxy: setYtProxy,
        getYtApiKey: getYtApiKey,
        setYtApiKey: setYtApiKey
    };
})();
