'use strict';
const test = require('node:test');
const assert = require('node:assert');
const YT = require('../../js/youtube.js');
const { LIVE_SEARCH, LATEST_SEARCH, EMPTY_SEARCH, ERROR_QUOTA } = require('./fixtures.js');

/* ---------------------------------------------------- parseSearchItem ---- */

test('parseSearchItem returns the first video with the highest-res thumbnail', () => {
  const v = YT.parseSearchItem(LIVE_SEARCH);
  assert.ok(v);
  assert.strictEqual(v.videoId, 'LIVEvid123');
  assert.strictEqual(v.title, 'Tonight Live Show');
  assert.strictEqual(v.thumbnail, 'https://i.ytimg.com/vi/LIVEvid123/hqdefault.jpg'); // high > medium > default
  assert.strictEqual(v.publishedAt, '2026-06-07T18:00:00Z');
});

test('parseSearchItem falls back to the default thumbnail size', () => {
  const v = YT.parseSearchItem(LATEST_SEARCH);
  assert.strictEqual(v.videoId, 'PASTvid456');
  assert.strictEqual(v.thumbnail, 'https://i.ytimg.com/vi/PASTvid456/default.jpg');
});

test('parseSearchItem returns null when there are no items', () => {
  assert.strictEqual(YT.parseSearchItem(EMPTY_SEARCH), null);
  assert.strictEqual(YT.parseSearchItem({}), null);
});

test('parseSearchItem returns null when an item has no videoId', () => {
  assert.strictEqual(YT.parseSearchItem({ items: [{ id: {}, snippet: {} }] }), null);
});

test('parseSearchItem throws on an API error, carrying the reason', () => {
  assert.throws(
    () => YT.parseSearchItem(ERROR_QUOTA),
    (e) => e.reason === 'quotaExceeded'
  );
});

/* ---------------------------------------------------- relativeFromIso ---- */

test('relativeFromIso formats coarse relative times', () => {
  const now = Date.parse('2026-06-07T12:00:00Z');
  assert.strictEqual(YT.relativeFromIso('2026-06-05T12:00:00Z', now), '2 days ago');
  assert.strictEqual(YT.relativeFromIso('2026-06-07T11:00:00Z', now), '1 hour ago');
  assert.strictEqual(YT.relativeFromIso('2026-06-07T11:59:30Z', now), 'just now');
  assert.strictEqual(YT.relativeFromIso('2025-06-07T12:00:00Z', now), '1 year ago');
});

test('relativeFromIso degrades gracefully on bad input', () => {
  assert.strictEqual(YT.relativeFromIso('', 0), 'recently');
  assert.strictEqual(YT.relativeFromIso('not-a-date', 0), 'recently');
});

/* ------------------------------------------------------- buildChannels --- */

test('buildChannels maps entries to channel objects with channelId', () => {
  const chans = YT.buildChannels([
    { handle: '@RadioShemroon', name: 'Radio Shemroon', channelId: 'UC123' },
    { handle: 'TousiTV' }
  ]);
  assert.strictEqual(chans.length, 2);
  assert.strictEqual(chans[0].id, 'yt:RadioShemroon');   // leading @ stripped
  assert.strictEqual(chans[0].handle, 'RadioShemroon');
  assert.strictEqual(chans[0].channelId, 'UC123');
  assert.strictEqual(chans[0].type, 'youtube');
  assert.strictEqual(chans[0].group, '📺 YouTube');
  assert.strictEqual(chans[1].name, 'TousiTV');          // name falls back to handle
  assert.strictEqual(chans[1].channelId, '');            // missing channelId -> ''
});

test('buildChannels ignores bad entries', () => {
  assert.deepStrictEqual(YT.buildChannels(null), []);
  assert.strictEqual(YT.buildChannels([{}, { handle: 'x' }]).length, 1);
});
