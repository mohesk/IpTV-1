'use strict';
const test = require('node:test');
const assert = require('node:assert');
const YT = require('../../js/youtube.js');
const { LIVE_HTML, GARBAGE_HTML, OFFLINE_HTML } = require('./fixtures.js');

test('extractJsonObject pulls a balanced object after a marker', () => {
  const obj = YT.extractJsonObject(LIVE_HTML, 'ytInitialPlayerResponse');
  assert.ok(obj, 'should return an object');
  assert.strictEqual(obj.playabilityStatus.status, 'OK');
  assert.strictEqual(obj.streamingData.hlsManifestUrl,
    'https://manifest.googlevideo.com/api/live/abc.m3u8');
});

test('extractJsonObject returns null when the marker is absent', () => {
  assert.strictEqual(YT.extractJsonObject(GARBAGE_HTML, 'ytInitialPlayerResponse'), null);
});

test('extractJsonObject returns null on non-string input', () => {
  assert.strictEqual(YT.extractJsonObject(null, 'x'), null);
});

test('extractJsonObject with ytInitialPlayerResponse marker returns first object from OFFLINE_HTML', () => {
  const obj = YT.extractJsonObject(OFFLINE_HTML, 'ytInitialPlayerResponse');
  assert.ok(obj, 'should return an object');
  assert.strictEqual(obj.playabilityStatus.status, 'LIVE_STREAM_OFFLINE');
});

test('extractJsonObject with ytInitialData marker returns second object from OFFLINE_HTML', () => {
  const obj = YT.extractJsonObject(OFFLINE_HTML, 'ytInitialData');
  assert.ok(obj, 'should return an object');
  assert.ok(obj.contents, 'should have contents');
  assert.strictEqual(obj.contents.section.items[0].videoRenderer.videoId, 'PASTvid456');
});

test('classify returns a live status for a live player response', () => {
  const player = YT.extractJsonObject(LIVE_HTML, 'ytInitialPlayerResponse');
  const s = YT.classify(player);
  assert.ok(s);
  assert.strictEqual(s.state, 'live');
  assert.strictEqual(s.hlsUrl, 'https://manifest.googlevideo.com/api/live/abc.m3u8');
  assert.strictEqual(s.videoId, 'LIVEvid123');
  assert.strictEqual(s.title, 'Tonight Live Show');
  assert.strictEqual(s.thumbnail, 'https://i.ytimg.com/vi/LIVEvid123/hqdefault.jpg');
});

test('classify returns null when the stream is offline', () => {
  const player = YT.extractJsonObject(OFFLINE_HTML, 'ytInitialPlayerResponse');
  assert.strictEqual(YT.classify(player), null);
});

test('classify returns null on missing input', () => {
  assert.strictEqual(YT.classify(null), null);
  assert.strictEqual(YT.classify({}), null);
});
