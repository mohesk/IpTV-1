'use strict';

// A page where the channel is currently live.
const LIVE_HTML = `
<!doctype html><html><head><title>Live Chan - YouTube</title></head><body>
<script>var ytInitialPlayerResponse = {
  "playabilityStatus": {"status": "OK"},
  "streamingData": {"hlsManifestUrl": "https://manifest.googlevideo.com/api/live/abc.m3u8"},
  "videoDetails": {
    "videoId": "LIVEvid123",
    "title": "Tonight Live Show",
    "isLive": true,
    "isLiveContent": true,
    "thumbnail": {"thumbnails": [{"url": "https://i.ytimg.com/vi/LIVEvid123/default.jpg"},
                                  {"url": "https://i.ytimg.com/vi/LIVEvid123/hqdefault.jpg"}]}
  }
};</script>
</body></html>`;

// A page where the live stream is offline; ytInitialData carries the latest video.
const OFFLINE_HTML = `
<!doctype html><html><head><title>Some Chan - YouTube</title></head><body>
<script>var ytInitialPlayerResponse = {
  "playabilityStatus": {"status": "LIVE_STREAM_OFFLINE"}
};</script>
<script>var ytInitialData = {
  "contents": {"section": {"items": [
    {"videoRenderer": {
      "videoId": "PASTvid456",
      "title": {"runs": [{"text": "Yesterday's Stream"}]},
      "publishedTimeText": {"simpleText": "Streamed 2 days ago"},
      "thumbnail": {"thumbnails": [{"url": "https://i.ytimg.com/vi/PASTvid456/hqdefault.jpg"}]}
    }}
  ]}}
};</script>
</body></html>`;

// A page with no usable YouTube JSON at all.
const GARBAGE_HTML = `<!doctype html><html><body>nothing here</body></html>`;

module.exports = { LIVE_HTML, OFFLINE_HTML, GARBAGE_HTML };
