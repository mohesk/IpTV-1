/* ===========================================================================
   ui.js  -  DOM rendering helpers. Pure-ish view layer: builds the group and
   channel rows, the player OSD, toasts and the clock. State lives in app.js.
   =========================================================================== */
var UI = (function () {
    'use strict';

    var els = {};

    function cache() {
        [
            'splash', 'splash-status', 'browser', 'group-list', 'channel-list',
            'channel-empty', 'channel-count', 'clock', 'player-screen',
            'player-spinner', 'player-spinner-text', 'player-osd', 'osd-logo',
            'osd-number', 'osd-name', 'osd-group', 'osd-state', 'zap-entry',
            'player-error', 'player-error-msg', 'settings', 'settings-url',
            'settings-engine', 'settings-version', 'settings-ytkey', 'toast',
            'channel-search', 'search-term'
        ].forEach(function (id) {
            els[id] = document.getElementById(id);
        });
    }

    function show(screenId) {
        ['splash', 'browser', 'player-screen', 'settings'].forEach(function (id) {
            els[id].classList.toggle('hidden', id !== screenId);
        });
    }

    /* ----- channel initials fallback for missing logos ----- */
    function initials(name) {
        var parts = name.replace(/[^a-zA-Z0-9 ]/g, '').trim().split(/\s+/);
        if (!parts[0]) { return '?'; }
        if (parts.length === 1) { return parts[0].slice(0, 2).toUpperCase(); }
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    function logoNode(channel, wrapClass, imgClass) {
        var wrap = document.createElement('div');
        wrap.className = wrapClass;
        if (channel.logo) {
            var img = document.createElement('img');
            img.className = imgClass;
            img.alt = '';
            img.src = channel.logo;
            img.onerror = function () {
                wrap.innerHTML = '';
                wrap.appendChild(fallbackNode(channel));
            };
            wrap.appendChild(img);
        } else {
            wrap.appendChild(fallbackNode(channel));
        }
        return wrap;
    }
    function fallbackNode(channel) {
        var f = document.createElement('span');
        f.className = 'ch-logo-fallback';
        f.textContent = initials(channel.name);
        return f;
    }

    /* ----- groups ----- */
    function renderGroups(groups) {
        var list = els['group-list'];
        list.innerHTML = '';
        list.style.transform = 'translateY(0)';
        groups.forEach(function (g) {
            var item = document.createElement('div');
            item.className = 'group-item';
            var label = document.createElement('span');
            label.textContent = g.name;
            var badge = document.createElement('span');
            badge.className = 'group-badge';
            badge.textContent = g.channels.length;
            item.appendChild(label);
            item.appendChild(badge);
            list.appendChild(item);
        });
    }

    /* ----- channels ----- */
    function renderChannels(channels, playingId, isFav) {
        var list = els['channel-list'];
        list.innerHTML = '';
        list.style.transform = 'translateY(0)';
        els['channel-empty'].classList.toggle('hidden', channels.length > 0);

        channels.forEach(function (ch, i) {
            var li = document.createElement('li');
            li.className = 'channel-item';
            li.setAttribute('data-channel-id', ch.id);
            if (ch.id === playingId) { li.classList.add('playing'); }

            var num = document.createElement('div');
            num.className = 'ch-number';
            num.textContent = ch.chno || (i + 1);

            var logo = logoNode(ch, 'ch-logo-wrap', 'ch-logo');

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

            var fav = document.createElement('div');
            fav.className = 'ch-fav';
            fav.textContent = isFav(ch.id) ? '★' : '';

            li.appendChild(num);
            li.appendChild(logo);
            li.appendChild(name);
            li.appendChild(fav);
            list.appendChild(li);
        });
    }

    function markPlaying(channels, playingId) {
        var items = els['channel-list'].children;
        for (var i = 0; i < items.length; i++) {
            items[i].classList.toggle('playing', channels[i] && channels[i].id === playingId);
        }
    }

    function setFavMark(index, on) {
        var item = els['channel-list'].children[index];
        if (item) { item.querySelector('.ch-fav').textContent = on ? '★' : ''; }
    }

    function setChannelCount(n) {
        els['channel-count'].textContent = n + (n === 1 ? ' channel' : ' channels');
    }

    function setSearch(term) {
        var box = els['channel-search'];
        if (term) {
            box.classList.remove('hidden');
            els['search-term'].textContent = term;
        } else {
            box.classList.add('hidden');
        }
    }

    /* ----- player OSD ----- */
    function showOsd(channel, index, stateText) {
        if (channel.logo) {
            els['osd-logo'].style.display = '';
            els['osd-logo'].src = channel.logo;
        } else {
            els['osd-logo'].style.display = 'none';
        }
        els['osd-number'].textContent = (channel.chno || (index + 1)) + '';
        els['osd-name'].textContent = channel.name;
        els['osd-group'].textContent = channel.group;
        els['osd-state'].textContent = stateText || '';
        els['player-osd'].classList.remove('hidden');
    }
    function setOsdState(text) { els['osd-state'].textContent = text || ''; }
    function hideOsd() { els['player-osd'].classList.add('hidden'); }

    function showSpinner(on, text) {
        els['player-spinner-text'].textContent = text || 'Buffering…';
        els['player-spinner'].classList.toggle('hidden', !on);
    }

    function showPlayerError(msg) {
        els['player-error-msg'].textContent = msg || 'Unknown error.';
        els['player-error'].classList.remove('hidden');
    }
    function hidePlayerError() { els['player-error'].classList.add('hidden'); }

    function showZap(digits) {
        var z = els['zap-entry'];
        if (digits) { z.textContent = digits; z.classList.remove('hidden'); }
        else { z.classList.add('hidden'); }
    }

    /* ----- misc ----- */
    var toastTimer = null;
    function toast(msg, ms) {
        var t = els['toast'];
        t.textContent = msg;
        t.classList.remove('hidden');
        if (toastTimer) { clearTimeout(toastTimer); }
        toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 2200);
    }

    function setSplashStatus(msg) { els['splash-status'].textContent = msg; }

    function startClock() {
        function tick() {
            var d = new Date();
            var h = ('0' + d.getHours()).slice(-2);
            var m = ('0' + d.getMinutes()).slice(-2);
            els['clock'].textContent = h + ':' + m;
        }
        tick();
        setInterval(tick, 15000);
    }

    function maskKey(key) {
        if (!key) { return '(not set — select to enter)'; }
        if (key.length <= 10) { return '•••• (set)'; }
        return key.slice(0, 6) + '…' + key.slice(-4);
    }

    function setSettingsInfo(url, engineName, version, ytKey) {
        els['settings-url'].textContent = url;
        els['settings-engine'].textContent = 'Playback engine: ' + engineName;
        els['settings-version'].textContent = version;
        if (els['settings-ytkey']) { els['settings-ytkey'].textContent = maskKey(ytKey); }
    }

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
            if (status.reason === 'no-key') { sub.textContent = 'Set API key in Settings'; }
            else if (status.reason === 'quotaExceeded') { sub.textContent = 'API quota reached'; }
            else { sub.textContent = 'Status unavailable'; }
        }
    }

    return {
        cache: cache,
        show: show,
        renderGroups: renderGroups,
        renderChannels: renderChannels,
        markPlaying: markPlaying,
        setFavMark: setFavMark,
        setChannelCount: setChannelCount,
        setSearch: setSearch,
        showOsd: showOsd,
        setOsdState: setOsdState,
        hideOsd: hideOsd,
        showSpinner: showSpinner,
        showPlayerError: showPlayerError,
        hidePlayerError: hidePlayerError,
        showZap: showZap,
        toast: toast,
        setSplashStatus: setSplashStatus,
        startClock: startClock,
        setSettingsInfo: setSettingsInfo,
        setYtStatus: setYtStatus,
        els: els
    };
})();
