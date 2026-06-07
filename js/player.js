/* ===========================================================================
   player.js  -  Streaming abstraction.

   Two back-ends, selected automatically:
     1. Samsung AVPlay (webapis.avplay)  -  used on real TV hardware. Best
        HLS / DASH / progressive support, hardware decoding.
     2. HTML5 <video>                    -  used in a desktop browser for
        development and on TVs with native HLS.

   The public API is identical for both:
     Player.init()
     Player.play(channel, handlers)
     Player.stop()
     Player.togglePause()  -> returns 'playing' | 'paused'
     Player.getEngineName()
   handlers = { onBuffering, onPlaying, onEnded, onError }
   =========================================================================== */
var Player = (function () {
    'use strict';

    var engine = null;         // 'avplay' | 'html5'
    var avObj = null;          // <object> for AVPlay
    var video = null;          // <video> fallback
    var ytFrame = null;        // <iframe> for YouTube VOD embeds
    var handlers = {};
    var current = null;
    var paused = false;

    function hasAvplay() {
        return typeof webapis !== 'undefined' &&
               webapis.avplay &&
               typeof webapis.avplay.open === 'function';
    }

    function init() {
        avObj = document.getElementById('av-player');
        video = document.getElementById('html5-player');
        ytFrame = document.getElementById('yt-embed');
        engine = hasAvplay() ? 'avplay' : 'html5';

        if (engine === 'avplay') {
            avObj.style.display = 'block';
            video.style.display = 'none';
        } else {
            avObj.style.display = 'none';
            video.style.display = 'block';
            wireHtml5();
        }
    }

    function getEngineName() {
        return engine === 'avplay' ? 'Samsung AVPlay' : 'HTML5 video';
    }

    function fire(name, arg) {
        if (handlers && typeof handlers[name] === 'function') {
            handlers[name](arg);
        }
    }

    /* ---------------------------------------------------------------- AVPlay */
    function avplayListener() {
        return {
            onbufferingstart: function () { fire('onBuffering', true); },
            onbufferingprogress: function () { /* percent available if needed */ },
            onbufferingcomplete: function () {
                fire('onBuffering', false);
                fire('onPlaying');
            },
            onstreamcompleted: function () { fire('onEnded'); },
            oncurrentplaytime: function () {},
            onevent: function (type) {
                if (type === 'PLAYER_MSG_HD_VIDEO' || type === 'PLAYER_MSG_RESOLUTION_CHANGED') {
                    fire('onPlaying');
                }
            },
            onerror: function (type) {
                fire('onError', 'AVPlay error: ' + type);
            }
        };
    }

    function avplayStop() {
        try {
            var st = webapis.avplay.getState();
            if (st !== 'NONE' && st !== 'IDLE') {
                webapis.avplay.stop();
            }
            webapis.avplay.close();
        } catch (e) { /* ignore */ }
    }

    function avplayPlay(channel) {
        avplayStop();
        try {
            webapis.avplay.open(channel.url);
            webapis.avplay.setListener(avplayListener());
            // Full-screen on a 1080p surface; AVPlay scales to the panel.
            webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
            try { webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) {}

            fire('onBuffering', true);
            webapis.avplay.prepareAsync(function () {
                webapis.avplay.play();
                paused = false;
            }, function (err) {
                fire('onError', 'Could not prepare stream (' + err + ').');
            });
        } catch (e) {
            fire('onError', 'AVPlay failed: ' + (e && e.message ? e.message : e));
        }
    }

    function avplayToggle() {
        try {
            if (paused) { webapis.avplay.play(); paused = false; }
            else { webapis.avplay.pause(); paused = true; }
        } catch (e) {}
        return paused ? 'paused' : 'playing';
    }

    /* ----------------------------------------------------------------- HTML5 */
    function wireHtml5() {
        video.addEventListener('waiting', function () { fire('onBuffering', true); });
        video.addEventListener('playing', function () { fire('onBuffering', false); fire('onPlaying'); });
        video.addEventListener('canplay', function () { fire('onBuffering', false); });
        video.addEventListener('ended', function () { fire('onEnded'); });
        video.addEventListener('error', function () {
            var err = video.error;
            var msg = 'Media error';
            if (err) {
                var codes = { 1: 'aborted', 2: 'network', 3: 'decode', 4: 'source not supported' };
                msg = 'Media error: ' + (codes[err.code] || err.code);
            }
            fire('onError', msg);
        });
    }

    function html5Play(channel) {
        try {
            video.pause();
        } catch (e) {}
        fire('onBuffering', true);
        video.src = channel.url;
        video.load();
        var p = video.play();
        if (p && typeof p.catch === 'function') {
            p.catch(function (e) {
                // Autoplay rejection or unsupported source.
                fire('onError', 'Cannot play this stream (' + (e && e.name ? e.name : 'error') + ').');
            });
        }
        paused = false;
    }

    function html5Toggle() {
        if (video.paused) { video.play(); paused = false; }
        else { video.pause(); paused = true; }
        return paused ? 'paused' : 'playing';
    }

    /* -------------------------------------------------------- YouTube embed */
    function hideEmbed() {
        if (!ytFrame) { return; }
        ytFrame.classList.add('hidden');
        try { ytFrame.src = 'about:blank'; } catch (e) {}
    }

    // Show the YouTube embed at the given URL. The caller supplies the full URL
    // (normally a self-hosted https "referrer-bounce" page) because YouTube
    // returns "Error 153" when an embed loads from the app's file:// origin.
    function playEmbed(url, h) {
        handlers = h || {};
        // Stop any AVPlay/HTML5 playback and surface the iframe.
        if (engine === 'avplay') { avplayStop(); }
        else { try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) {} }
        if (avObj) { avObj.style.display = 'none'; }
        if (video) { video.style.display = 'none'; }
        if (!ytFrame) { fire('onError', 'Embedded player unavailable.'); return; }

        ytFrame.classList.remove('hidden');
        ytFrame.onerror = function () { fire('onError', 'Could not load the video.'); };
        try { ytFrame.referrerPolicy = 'strict-origin-when-cross-origin'; } catch (e) {}
        ytFrame.src = url;
        paused = false;
        fire('onPlaying');
    }

    /* ----------------------------------------------------------------- public */
    function play(channel, h) {
        handlers = h || {};
        current = channel;
        paused = false;
        hideEmbed();
        if (engine === 'avplay') { if (avObj) { avObj.style.display = 'block'; } }
        else if (video) { video.style.display = 'block'; }
        if (engine === 'avplay') { avplayPlay(channel); }
        else { html5Play(channel); }
    }

    function stop() {
        hideEmbed();
        if (engine === 'avplay') { if (avObj) { avObj.style.display = 'block'; } }
        else if (video) { video.style.display = 'block'; }
        if (engine === 'avplay') {
            avplayStop();
        } else {
            try { video.pause(); video.removeAttribute('src'); video.load(); }
            catch (e) {}
        }
        current = null;
        paused = false;
    }

    function togglePause() {
        return engine === 'avplay' ? avplayToggle() : html5Toggle();
    }

    function isPaused() { return paused; }

    return {
        init: init,
        play: play,
        stop: stop,
        togglePause: togglePause,
        isPaused: isPaused,
        getEngineName: getEngineName,
        playEmbed: playEmbed
    };
})();
