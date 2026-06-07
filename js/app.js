/* ===========================================================================
   app.js  -  Application controller / state machine.

   Screens:  splash -> browser  <-> player
                          \-> settings
   Wires the playlist loader, the player back-end, focus navigation and the
   TV remote into one place. No framework: plain DOM + the helper modules.
   =========================================================================== */
(function () {
    'use strict';

    var VERSION = '1.0.0';
    var OSD_TIMEOUT = 4500;
    var ZAP_TIMEOUT = 1500;
    var YT_TTL = 300000;          // reuse a YouTube probe result for 5 min (saves API quota)
    // Default https "referrer-bounce" player page (overridable in Settings).
    // Required because a YouTube embed from the app's file:// origin fails with
    // Error 153; loading it from this https page gives YouTube a valid referrer.
    var YT_PLAYER_DEFAULT = 'https://mohesk.github.io/IpTV-1/player.html';

    var state = {
        mode: 'splash',          // splash | browser | player | settings
        area: 'groups',          // browser sub-focus: groups | channels
        channels: [],            // all channels
        groups: [],              // [{name, channels}]
        viewChannels: [],        // channels shown in the channel pane
        search: '',
        playList: [],            // list the player is iterating over
        playIndex: -1,
        playingId: null,
        zap: '',
        zapTimer: null,
        osdTimer: null,
        settingsIndex: 0,
        ytRefreshTimer: null,    // periodic re-probe while the YT group is open
        ytConcurrency: 4         // max parallel probes
    };

    var groupNav, channelNav;

    /* ============================================================ bootstrap */
    function boot() {
        UI.cache();
        Player.init();
        UI.startClock();
        KEYS.register();

        document.addEventListener('keydown', onKey, false);

        groupNav = new ListNav(UI.els['group-list'], {
            onFocus: onGroupFocus
        });
        channelNav = new ListNav(UI.els['channel-list'], {
            onSelect: onChannelSelect
        });

        loadPlaylist(Store.getPlaylistUrl(), true);
    }

    /* ============================================================ playlist */
    function loadPlaylist(url, initial) {
        stopYtProbing();
        state.mode = 'splash';
        UI.show('splash');
        UI.setSplashStatus('Loading playlist…');

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
            UI.setSplashStatus('Failed to load playlist: ' + err.message);
            // Offer settings after a moment so the user can fix the URL.
            setTimeout(function () {
                state.mode = 'browser';
                openSettings();
                UI.toast('Could not load playlist. Check the URL.', 4000);
            }, 1800);
        });
    }

    function rebuildGroups() {
        state.groups = Playlist.groupByCategory(state.channels, Store.getFavorites());
        UI.renderGroups(state.groups);
    }

    function tryResumeLast() {
        var lastId = Store.getLastChannel();
        if (!lastId) { return; }
        // Just leave the user on the browser; resume is optional. We surface a
        // hint instead of auto-playing to avoid surprising the user on launch.
    }

    /* ============================================================ browser */
    function enterBrowser() {
        state.mode = 'browser';
        state.area = 'groups';
        UI.show('browser');
        groupNav.setIndex(0);          // triggers onGroupFocus -> renders channels
    }

    function onGroupFocus(index) {
        var group = state.groups[index];
        if (!group) { return; }
        state.search = '';
        UI.setSearch('');
        state.viewChannels = group.channels;
        if (group.name === YT.GROUP) { startYtProbing(group.channels); }
        else { stopYtProbing(); }
        UI.setChannelCount(group.channels.length);
        UI.renderChannels(group.channels, state.playingId, Store.isFavorite);
        channelNav.reset();
        channelNav.setIndex(0, { silent: true });
        if (state.area === 'channels') {
            // keep visual focus on the channel side
            highlightChannelArea(true);
        } else {
            highlightChannelArea(false);
        }
    }

    function highlightChannelArea(on) {
        // Toggle which list shows the focus ring.
        if (on) {
            groupNav.clearFocus();
            channelNav.setIndex(channelNav.index);
            state.area = 'channels';
        } else {
            channelNav.clearFocus();
            groupNav.setIndex(groupNav.index, { silent: true });
            state.area = 'groups';
        }
    }

    /* ============================================================ youtube */
    // A cached probe result is reused while fresh (the Data API charges quota
    // per call, so we don't re-check on every category visit).
    function ytFresh(ch) {
        return ch.yt && ch.yt.state !== 'checking' && ch.yt.videoId &&
               ch.yt.checkedAt && (Date.now() - ch.yt.checkedAt) < YT_TTL;
    }

    function startYtProbing(channels) {
        stopYtProbing();
        runYtProbes(channels);
    }

    function stopYtProbing() {
        if (state.ytRefreshTimer) {
            clearInterval(state.ytRefreshTimer);
            state.ytRefreshTimer = null;
        }
    }

    // Paint cached statuses immediately; probe only the stale/unknown channels,
    // with a small concurrency cap, updating each row as it resolves.
    function runYtProbes(channels) {
        var queue = [];
        channels.forEach(function (ch) {
            if (ch.type !== 'youtube') { return; }
            if (ytFresh(ch)) { UI.setYtStatus(ch.id, ch.yt); }
            else { UI.setYtStatus(ch.id, { state: 'checking' }); queue.push(ch); }
        });
        var i = 0;
        function next() {
            if (i >= queue.length) { return; }
            var ch = queue[i++];
            YT.probe(ch).then(function (status) {
                ch.yt = status;
                // Only paint if we're still in the browser view.
                if (state.mode === 'browser') { UI.setYtStatus(ch.id, status); }
                next();
            });
        }
        var lanes = Math.min(state.ytConcurrency, queue.length);
        for (var L = 0; L < lanes; L++) { next(); }
    }

    function ytEmbedHandlers() {
        return {
            onError: function (msg) { UI.showSpinner(false); UI.showPlayerError(msg); },
            onPlaying: function () { UI.showSpinner(false); }
        };
    }

    // Build the embed URL. Prefer a self-hosted https "referrer-bounce" page
    // (required on the TV — a direct embed from file:// fails with Error 153).
    // With no page configured, fall back to a direct embed (works only in a
    // desktop dev browser).
    function ytEmbedUrl(videoId) {
        var base = Store.getYtPlayerUrl() || YT_PLAYER_DEFAULT;
        return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(videoId);
    }

    function ytErrorMessage(reason) {
        if (reason === 'no-key') {
            return 'Add a YouTube Data API key in Settings (green key) to enable YouTube channels.';
        }
        if (reason === 'quotaExceeded') {
            return 'YouTube API daily quota reached. Try again later.';
        }
        if (reason === 'keyInvalid' || reason === 'badRequest') {
            return 'The YouTube API key is invalid. Check it in Settings.';
        }
        if (reason === 'no-channel-id') { return 'This channel has no channel ID configured.'; }
        if (reason === 'no-video') { return 'This channel has no videos available.'; }
        return 'Could not reach YouTube (' + (reason || 'network') + ').';
    }

    function onChannelSelect(index) {
        var ch = state.viewChannels[index];
        if (!ch) { return; }
        state.playList = state.viewChannels.slice();
        state.playIndex = index;
        if (ch.type === 'youtube') { playYouTube(ch); }
        else { startPlayback(ch); }
    }

    function toggleFavoriteFocused() {
        if (state.area !== 'channels') {
            UI.toast('Move to a channel to favorite it.');
            return;
        }
        var ch = state.viewChannels[channelNav.index];
        if (!ch) { return; }
        var nowFav = Store.toggleFavorite(ch.id);
        UI.setFavMark(channelNav.index, nowFav);
        UI.toast(nowFav ? 'Added to favorites' : 'Removed from favorites');
        // Rebuild groups so the Favorites category stays accurate.
        var keepGroup = state.groups[groupNav.index].name;
        rebuildGroups();
        var newIdx = state.groups.findIndex(function (g) { return g.name === keepGroup; });
        groupNav.setIndex(newIdx >= 0 ? newIdx : 0);
    }

    /* ------- incremental search via the on-screen keyboard ------- */
    function openSearch() {
        OSK.open(state.search, function (text) {
            if (text === null) { return; }
            applySearch(text.trim());
        });
    }
    function applySearch(term) {
        state.search = term;
        UI.setSearch(term);
        var lc = term.toLowerCase();
        var matches = !term ? state.channels : state.channels.filter(function (ch) {
            return ch.name.toLowerCase().indexOf(lc) !== -1 ||
                   ch.group.toLowerCase().indexOf(lc) !== -1;
        });
        state.viewChannels = matches;
        UI.setChannelCount(matches.length);
        UI.renderChannels(matches, state.playingId, Store.isFavorite);
        channelNav.reset();
        highlightChannelArea(true);
        if (!matches.length) { UI.toast('No matches for "' + term + '"'); }
    }

    /* ============================================================ playback */
    function startPlayback(channel) {
        state.mode = 'player';
        state.playingId = channel.id;
        Store.setLastChannel(channel.id);
        UI.show('player-screen');
        UI.hidePlayerError();
        UI.showSpinner(true, 'Connecting…');
        UI.showOsd(channel, state.playIndex, 'Loading…');
        scheduleOsdHide();

        Player.play(channel, {
            onBuffering: function (on) {
                UI.showSpinner(on, 'Buffering…');
                if (on) { UI.setOsdState('Buffering…'); }
            },
            onPlaying: function () {
                UI.showSpinner(false);
                UI.setOsdState('● Live');
                scheduleOsdHide();
            },
            onEnded: function () {
                UI.setOsdState('Stream ended');
                UI.toast('Stream ended');
            },
            onError: function (msg) {
                UI.showSpinner(false);
                UI.showPlayerError(msg);
            }
        });
    }

    function playYouTube(channel) {
        stopYtProbing();
        state.mode = 'player';
        state.playingId = channel.id;
        Store.setLastChannel(channel.id);
        UI.show('player-screen');
        UI.hidePlayerError();
        UI.showSpinner(true, 'Checking…');
        UI.showOsd(channel, state.playIndex, 'Checking…');
        clearOsdHide();

        function present(status) {
            channel.yt = status;
            if (status.state === 'live') {
                UI.setOsdState('● LIVE');
                Player.playEmbed(ytEmbedUrl(status.videoId), ytEmbedHandlers());
            } else if (status.state === 'offline') {
                UI.showOsd(channel, state.playIndex,
                    'Offline · last streamed ' + (status.sinceText || 'recently'));
                scheduleOsdHide();
                Player.playEmbed(ytEmbedUrl(status.videoId), ytEmbedHandlers());
            } else {
                UI.showSpinner(false);
                UI.showPlayerError(ytErrorMessage(status.reason));
            }
        }

        // Reuse a fresh cached probe (with a videoId); otherwise re-check.
        if (ytFresh(channel)) { present(channel.yt); }
        else { YT.probe(channel).then(present); }
    }

    function switchChannel(delta) {
        if (!state.playList.length) { return; }
        var n = state.playList.length;
        state.playIndex = (state.playIndex + delta + n) % n;
        playCurrentInList();
    }

    function playCurrentInList() {
        var ch = state.playList[state.playIndex];
        if (!ch) { return; }
        state.playingId = ch.id;
        Store.setLastChannel(ch.id);
        UI.hidePlayerError();
        if (ch.type === 'youtube') { playYouTube(ch); return; }
        UI.showOsd(ch, state.playIndex, 'Loading…');
        UI.showSpinner(true, 'Connecting…');
        scheduleOsdHide();
        Player.play(ch, currentPlayHandlers());
    }

    function currentPlayHandlers() {
        return {
            onBuffering: function (on) { UI.showSpinner(on, 'Buffering…'); },
            onPlaying: function () { UI.showSpinner(false); UI.setOsdState('● Live'); scheduleOsdHide(); },
            onEnded: function () { UI.setOsdState('Stream ended'); },
            onError: function (msg) { UI.showSpinner(false); UI.showPlayerError(msg); }
        };
    }

    function togglePause() {
        var st = Player.togglePause();
        var ch = state.playList[state.playIndex];
        if (ch) { UI.showOsd(ch, state.playIndex, st === 'paused' ? '❚❚ Paused' : '● Live'); }
        if (st === 'paused') { clearOsdHide(); } else { scheduleOsdHide(); }
    }

    function stopPlayback() {
        stopYtProbing();
        Player.stop();
        UI.hideOsd();
        UI.hidePlayerError();
        UI.showSpinner(false);
        state.mode = 'browser';
        UI.show('browser');
        // Reflect the now-playing marker / keep selection where it was.
        UI.markPlaying(state.viewChannels, state.playingId);
    }

    function scheduleOsdHide() {
        clearOsdHide();
        state.osdTimer = setTimeout(function () { UI.hideOsd(); }, OSD_TIMEOUT);
    }
    function clearOsdHide() {
        if (state.osdTimer) { clearTimeout(state.osdTimer); state.osdTimer = null; }
    }
    function bumpOsd() {
        var ch = state.playList[state.playIndex];
        if (ch) {
            UI.showOsd(ch, state.playIndex, Player.isPaused() ? '❚❚ Paused' : '● Live');
            if (!Player.isPaused()) { scheduleOsdHide(); }
        }
    }

    /* ============================================================ zap (numbers) */
    function pushZap(digit) {
        state.zap += String(digit);
        if (state.mode === 'player') { UI.showZap(state.zap); }
        else { UI.toast('Channel ' + state.zap, ZAP_TIMEOUT + 200); }
        if (state.zapTimer) { clearTimeout(state.zapTimer); }
        state.zapTimer = setTimeout(resolveZap, ZAP_TIMEOUT);
    }
    function resolveZap() {
        var entry = state.zap;
        state.zap = '';
        UI.showZap('');
        if (!entry) { return; }
        var list = state.mode === 'player' ? state.playList : state.viewChannels;
        var idx = findChannelIndex(list, entry);
        if (idx === -1) { UI.toast('No channel ' + entry); return; }

        if (state.mode === 'player') {
            state.playIndex = idx;
            playCurrentInList();
        } else {
            highlightChannelArea(true);
            channelNav.setIndex(idx);
        }
    }
    function findChannelIndex(list, entry) {
        // Prefer an explicit channel number, then fall back to 1-based position.
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].chno) === entry) { return i; }
        }
        var pos = parseInt(entry, 10) - 1;
        return (pos >= 0 && pos < list.length) ? pos : -1;
    }

    /* ============================================================ settings */
    function openSettings() {
        stopYtProbing();
        state.mode = 'settings';
        state.settingsIndex = 0;
        refreshSettingsInfo();
        UI.show('settings');
        focusSettings(0);
    }
    function settingsFields() {
        return [
            UI.els['settings-url'],
            document.getElementById('settings-bundled'),
            document.getElementById('settings-clear-fav'),
            document.getElementById('settings-ytkey'),
            document.getElementById('settings-ytplayer')
        ];
    }
    function refreshSettingsInfo() {
        UI.setSettingsInfo(Store.getPlaylistUrl(), Player.getEngineName(), VERSION,
                           Store.getYtApiKey(), Store.getYtPlayerUrl());
    }
    function focusSettings(i) {
        var fields = settingsFields();
        if (i < 0) { i = 0; }
        if (i >= fields.length) { i = fields.length - 1; }
        state.settingsIndex = i;
        fields.forEach(function (f, idx) { f.classList.toggle('focused', idx === i); });
    }
    function activateSetting() {
        switch (state.settingsIndex) {
            case 0: // edit URL
                OSK.open(Store.getPlaylistUrl(), function (text) {
                    if (text === null) { return; }
                    Store.setPlaylistUrl(text);
                    refreshSettingsInfo();
                    UI.toast('Playlist URL saved');
                });
                break;
            case 1: // bundled sample
                Store.setPlaylistUrl(Store.DEFAULT_URL);
                refreshSettingsInfo();
                UI.toast('Using bundled sample playlist');
                break;
            case 2: // clear favorites
                Store.clearFavorites();
                UI.toast('Favorites cleared');
                break;
            case 3: // YouTube Data API key
                OSK.open(Store.getYtApiKey(), function (text) {
                    if (text === null) { return; }
                    Store.setYtApiKey(text);
                    refreshSettingsInfo();
                    UI.toast('YouTube API key saved');
                });
                break;
            case 4: // YouTube player page URL
                OSK.open(Store.getYtPlayerUrl(), function (text) {
                    if (text === null) { return; }
                    Store.setYtPlayerUrl(text);
                    refreshSettingsInfo();
                    UI.toast('YouTube player URL saved');
                });
                break;
        }
    }
    function closeSettings() {
        // Reload using whatever URL is now configured.
        loadPlaylist(Store.getPlaylistUrl(), false);
    }

    /* ============================================================ key router */
    function onKey(e) {
        var code = e.keyCode;

        // The on-screen keyboard captures everything while open.
        if (OSK.isOpen()) {
            if (OSK.handleKey(code)) { e.preventDefault(); }
            return;
        }

        var handled = true;
        switch (state.mode) {
            case 'browser':  handled = onKeyBrowser(code); break;
            case 'player':   handled = onKeyPlayer(code); break;
            case 'settings': handled = onKeySettings(code); break;
            default:         handled = false;
        }
        if (handled) { e.preventDefault(); }
    }

    function onKeyBrowser(code) {
        var K = KEYS.map;
        if (KEYS.isNumber(code)) { pushZap(KEYS.digit(code)); return true; }

        switch (code) {
            case K.UP:
                (state.area === 'groups' ? groupNav : channelNav).move(-1);
                return true;
            case K.DOWN:
                (state.area === 'groups' ? groupNav : channelNav).move(1);
                return true;
            case K.RIGHT:
                if (state.area === 'groups' && state.viewChannels.length) {
                    highlightChannelArea(true);
                }
                return true;
            case K.LEFT:
                if (state.area === 'channels') { highlightChannelArea(false); }
                return true;
            case K.ENTER:
                if (state.area === 'groups') { highlightChannelArea(true); }
                else { channelNav.select(); }
                return true;
            case K.RED:
                UI.toast('Reloading playlist…');
                loadPlaylist(Store.getPlaylistUrl(), false);
                return true;
            case K.GREEN:
                openSettings();
                return true;
            case K.YELLOW:
                toggleFavoriteFocused();
                return true;
            case K.BLUE:
                openSearch();
                return true;
            case K.CHANNEL_UP:
                channelNav.move(-1); return true;
            case K.CHANNEL_DOWN:
                channelNav.move(1); return true;
            default:
                if (KEYS.isBack(code)) { exitApp(); return true; }
                return false;
        }
    }

    function onKeyPlayer(code) {
        var K = KEYS.map;
        if (KEYS.isNumber(code)) { pushZap(KEYS.digit(code)); return true; }

        switch (code) {
            case K.ENTER:
            case K.MEDIA_PLAY_PAUSE:
                togglePause(); return true;
            case K.MEDIA_PLAY:
                if (Player.isPaused()) { togglePause(); } return true;
            case K.MEDIA_PAUSE:
                if (!Player.isPaused()) { togglePause(); } return true;
            case K.MEDIA_STOP:
                stopPlayback(); return true;
            case K.UP:
            case K.CHANNEL_UP:
                switchChannel(-1); return true;
            case K.DOWN:
            case K.CHANNEL_DOWN:
                switchChannel(1); return true;
            case K.LEFT:
            case K.RIGHT:
                bumpOsd(); return true;
            default:
                if (KEYS.isBack(code)) { stopPlayback(); return true; }
                return false;
        }
    }

    function onKeySettings(code) {
        var K = KEYS.map;
        switch (code) {
            case K.UP:    focusSettings(state.settingsIndex - 1); return true;
            case K.DOWN:  focusSettings(state.settingsIndex + 1); return true;
            case K.ENTER: activateSetting(); return true;
            default:
                if (KEYS.isBack(code)) { closeSettings(); return true; }
                return false;
        }
    }

    function exitApp() {
        try {
            if (typeof tizen !== 'undefined' && tizen.application) {
                tizen.application.getCurrentApplication().exit();
                return;
            }
        } catch (e) {}
        UI.toast('Press Back on the TV remote to exit.');
    }

    /* ============================================================ go */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
