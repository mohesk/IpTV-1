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

// Keep the focused row visible by scrolling the container. We scroll natively
// (scrollTop) rather than transforming the container, because the container is
// also the overflow-clipping box — translating it would just move the clip
// window, never revealing rows past the fold. scrollTop self-clamps to the
// scrollable range, and works on overflow:hidden/auto containers.
ListNav.prototype._scrollTo = function (el) {
    var c = this.container;
    var viewH = c.clientHeight;
    var pad = el.offsetHeight * this.padRows;

    // Row position relative to the viewport's current top edge.
    var cRect = c.getBoundingClientRect();
    var eRect = el.getBoundingClientRect();
    var top = eRect.top - cRect.top;
    var bottom = eRect.bottom - cRect.top;

    if (top < pad) {
        c.scrollTop += (top - pad);
    } else if (bottom > viewH - pad) {
        c.scrollTop += (bottom - (viewH - pad));
    }
};

ListNav.prototype.reset = function () {
    this.container.scrollTop = 0;
    this.index = 0;
};
