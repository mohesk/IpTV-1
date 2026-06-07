/* ===========================================================================
   keyboard.js  -  Minimal grid on-screen keyboard for editing the playlist
   URL with a D-pad. Opens over everything, returns the entered text via a
   callback. Operated entirely with arrows + ENTER + Back.
   =========================================================================== */
var OSK = (function () {
    'use strict';

    // 14 columns wide to match the CSS grid.
    var ROWS = [
        ['1','2','3','4','5','6','7','8','9','0','-','_','.',':'],
        ['q','w','e','r','t','y','u','i','o','p','/','?','=','&'],
        ['a','s','d','f','g','h','j','k','l','+','#','%','~','@'],
        ['z','x','c','v','b','n','m',',',';','(',')','[',']','!'],
        // control row: handled specially via data-action
        ['ABC','SPACE','BKSP','CLEAR','DONE']
    ];

    var root, inputEl, keysEl, cursorRow = 0, cursorCol = 0;
    var value = '', onDone = null, upper = false;
    var grid = []; // grid[row] = array of {el, char, action, span}

    function build() {
        root = document.getElementById('osk');
        inputEl = document.getElementById('osk-input');
        keysEl = document.getElementById('osk-keys');
    }

    function render() {
        keysEl.innerHTML = '';
        grid = [];
        for (var r = 0; r < ROWS.length; r++) {
            grid[r] = [];
            for (var c = 0; c < ROWS[r].length; c++) {
                var token = ROWS[r][c];
                var key = document.createElement('div');
                key.className = 'osk-key';
                var cell = { el: key, char: null, action: null };

                if (token === 'SPACE') {
                    key.textContent = 'Space';
                    key.classList.add('xwide');
                    cell.action = 'space';
                } else if (token === 'BKSP') {
                    key.textContent = '⌫ Del';
                    key.classList.add('wide');
                    cell.action = 'bksp';
                } else if (token === 'CLEAR') {
                    key.textContent = 'Clear';
                    key.classList.add('wide');
                    cell.action = 'clear';
                } else if (token === 'DONE') {
                    key.textContent = '✓ Done';
                    key.classList.add('wide');
                    cell.action = 'done';
                } else if (token === 'ABC') {
                    key.textContent = upper ? 'abc' : 'ABC';
                    key.classList.add('wide');
                    cell.action = 'case';
                } else {
                    var ch = upper ? token.toUpperCase() : token;
                    key.textContent = ch;
                    cell.char = ch;
                }
                grid[r].push(cell);
                keysEl.appendChild(key);
            }
        }
        highlight();
        updateInput();
    }

    function updateInput() { inputEl.textContent = value; }

    function highlight() {
        for (var r = 0; r < grid.length; r++) {
            for (var c = 0; c < grid[r].length; c++) {
                grid[r][c].el.classList.remove('focused');
            }
        }
        if (cursorRow >= grid.length) { cursorRow = grid.length - 1; }
        if (cursorCol >= grid[cursorRow].length) { cursorCol = grid[cursorRow].length - 1; }
        grid[cursorRow][cursorCol].el.classList.add('focused');
    }

    function move(dr, dc) {
        cursorRow += dr;
        if (cursorRow < 0) { cursorRow = grid.length - 1; }
        if (cursorRow >= grid.length) { cursorRow = 0; }
        cursorCol += dc;
        if (cursorCol < 0) { cursorCol = grid[cursorRow].length - 1; }
        if (cursorCol >= grid[cursorRow].length) { cursorCol = 0; }
        highlight();
    }

    function activate() {
        var cell = grid[cursorRow][cursorCol];
        if (cell.char !== null) {
            value += cell.char;
        } else {
            switch (cell.action) {
                case 'space': value += ' '; break;
                case 'bksp':  value = value.slice(0, -1); break;
                case 'clear': value = ''; break;
                case 'case':  upper = !upper; render(); return;
                case 'done':  return finish(true);
            }
        }
        updateInput();
    }

    function finish(ok) {
        root.classList.add('hidden');
        var cb = onDone; onDone = null;
        if (cb) { cb(ok ? value : null); }
    }

    function open(initial, cb) {
        if (!root) { build(); }
        value = initial || '';
        onDone = cb;
        upper = false;
        cursorRow = 0; cursorCol = 0;
        root.classList.remove('hidden');
        render();
    }

    function isOpen() { return root && !root.classList.contains('hidden'); }

    // Returns true if it consumed the key.
    function handleKey(code) {
        if (!isOpen()) { return false; }
        switch (code) {
            case KEYS.map.LEFT:  move(0, -1); return true;
            case KEYS.map.RIGHT: move(0, 1); return true;
            case KEYS.map.UP:    move(-1, 0); return true;
            case KEYS.map.DOWN:  move(1, 0); return true;
            case KEYS.map.ENTER: activate(); return true;
            default:
                if (KEYS.isBack(code)) { finish(false); return true; }
                return true; // swallow everything while open
        }
    }

    return { open: open, isOpen: isOpen, handleKey: handleKey };
})();
