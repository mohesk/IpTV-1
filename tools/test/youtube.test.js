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
