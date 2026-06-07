/* ===========================================================================
   keys.js  -  Samsung Tizen TV remote key codes + registration.

   On real hardware the extra media/colour keys must be registered through
   tizen.tvinputdevice.registerKey() before keydown events are delivered.
   In a desktop browser these APIs are absent, so we fall back to the
   standard codes and the app stays fully testable.
   =========================================================================== */
var KEYS = (function () {
    'use strict';

    // Standard / always-available codes
    var map = {
        LEFT: 37,
        UP: 38,
        RIGHT: 39,
        DOWN: 40,
        ENTER: 13,
        // Tizen "Return"/Back; 8 (Backspace) and 27 (Esc) help in a browser
        BACK: 10009,
        BACK_ALT1: 8,
        BACK_ALT2: 27,

        // Media keys (Tizen codes)
        MEDIA_PLAY_PAUSE: 10252,
        MEDIA_PLAY: 415,
        MEDIA_PAUSE: 19,
        MEDIA_STOP: 413,
        MEDIA_REWIND: 412,
        MEDIA_FAST_FORWARD: 417,

        // Colour keys
        RED: 403,
        GREEN: 404,
        YELLOW: 405,
        BLUE: 406,

        // Channel keys
        CHANNEL_UP: 427,
        CHANNEL_DOWN: 428,

        // Number keys share the standard 48-57 range on Tizen too
        NUM_0: 48, NUM_9: 57
    };

    // Names passed to tizen.tvinputdevice.registerKey().
    var registerNames = [
        'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
        'MediaRewind', 'MediaFastForward',
        'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
        'ChannelUp', 'ChannelDown',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
    ];

    function register() {
        try {
            if (typeof tizen !== 'undefined' &&
                tizen.tvinputdevice &&
                typeof tizen.tvinputdevice.registerKeyBatch === 'function') {
                tizen.tvinputdevice.registerKeyBatch(registerNames);
                return true;
            }
            if (typeof tizen !== 'undefined' &&
                tizen.tvinputdevice &&
                typeof tizen.tvinputdevice.registerKey === 'function') {
                registerNames.forEach(function (n) {
                    try { tizen.tvinputdevice.registerKey(n); } catch (e) {}
                });
                return true;
            }
        } catch (e) {
            console.warn('Key registration failed:', e);
        }
        return false;
    }

    function isBack(code) {
        return code === map.BACK || code === map.BACK_ALT1 || code === map.BACK_ALT2;
    }
    function isNumber(code) {
        return code >= map.NUM_0 && code <= map.NUM_9;
    }
    function digit(code) {
        return code - map.NUM_0;
    }

    return {
        map: map,
        register: register,
        isBack: isBack,
        isNumber: isNumber,
        digit: digit
    };
})();
