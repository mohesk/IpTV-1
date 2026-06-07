/* ===========================================================================
   focus.js  -  Vertical list navigation for the D-pad.

   A ListNav wraps a scroll container whose children are equal-ish height
   rows. It tracks the focused index, applies the ".focused" class, and
   translates the inner content so the focused row stays on screen (the
   containers use overflow:hidden because TVs have no usable scrollbars).
   =========================================================================== */
function ListNav(container, opts) {
    'use strict';
    opts = opts || {};
    this.container = container;
    this.index = 0;
    this.focusedClass = opts.focusedClass || 'focused';
    this.onSelect = opts.onSelect || function () {};   // ENTER
    this.onFocus = opts.onFocus || function () {};     // focus changed
    this.padRows = opts.padRows == null ? 2 : opts.padRows;
}

ListNav.prototype.items = function () {
    return Array.prototype.slice.call(this.container.children).filter(function (el) {
        return el.dataset && el.dataset.nav !== 'skip';
    });
};

ListNav.prototype.count = function () { return this.items().length; };

ListNav.prototype.clearFocus = function () {
    var els = this.items();
    for (var i = 0; i < els.length; i++) {
        els[i].classList.remove(this.focusedClass);
    }
};

ListNav.prototype.setIndex = function (i, opts) {
    var els = this.items();
    if (!els.length) { this.index = 0; return; }
    if (i < 0) { i = 0; }
    if (i > els.length - 1) { i = els.length - 1; }

    this.clearFocus();
    this.index = i;
    var el = els[i];
    el.classList.add(this.focusedClass);
    this._scrollTo(el);
    if (!opts || !opts.silent) { this.onFocus(i, el); }
};

ListNav.prototype.current = function () {
    return this.items()[this.index] || null;
};

ListNav.prototype.move = function (delta) {
    this.setIndex(this.index + delta);
};

ListNav.prototype.select = function () {
    var el = this.current();
    if (el) { this.onSelect(this.index, el); }
};

// Keep the focused row visible by translating the list content.
ListNav.prototype._scrollTo = function (el) {
    var c = this.container;
    var viewH = c.clientHeight;
    var rowTop = el.offsetTop;
    var rowH = el.offsetHeight;
    var pad = rowH * this.padRows;

    // Current translate
    var cur = this._translate || 0;
    var visTop = rowTop + cur;
    var visBottom = visTop + rowH;

    if (visTop < pad) {
        cur = -(rowTop - pad);
    } else if (visBottom > viewH - pad) {
        cur = viewH - pad - (rowTop + rowH);
    }

    // Clamp so we never scroll past the content edges.
    var contentH = c.scrollHeight;
    var minTranslate = Math.min(0, viewH - contentH);
    if (cur > 0) { cur = 0; }
    if (cur < minTranslate) { cur = minTranslate; }

    this._translate = cur;
    c.style.transition = 'transform 0.15s ease';
    c.style.transform = 'translateY(' + cur + 'px)';
};

ListNav.prototype.reset = function () {
    this._translate = 0;
    this.container.style.transform = 'translateY(0)';
    this.index = 0;
};
