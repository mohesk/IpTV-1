'use strict';

// YouTube Data API v3 search responses (part=snippet, type=video).

// A live search hit (eventType=live returned an item).
const LIVE_SEARCH = {
  items: [{
    id: { kind: 'youtube#video', videoId: 'LIVEvid123' },
    snippet: {
      title: 'Tonight Live Show',
      publishedAt: '2026-06-07T18:00:00Z',
      thumbnails: {
        default: { url: 'https://i.ytimg.com/vi/LIVEvid123/default.jpg' },
        medium: { url: 'https://i.ytimg.com/vi/LIVEvid123/mqdefault.jpg' },
        high: { url: 'https://i.ytimg.com/vi/LIVEvid123/hqdefault.jpg' }
      }
    }
  }]
};

// A latest-video search hit (order=date), used for the offline state.
const LATEST_SEARCH = {
  items: [{
    id: { kind: 'youtube#video', videoId: 'PASTvid456' },
    snippet: {
      title: "Yesterday's Stream",
      publishedAt: '2026-06-05T12:00:00Z',
      thumbnails: {
        default: { url: 'https://i.ytimg.com/vi/PASTvid456/default.jpg' }
      }
    }
  }]
};

// No results (channel not live / no videos).
const EMPTY_SEARCH = { kind: 'youtube#searchListResponse', items: [] };

// An API error payload (quota exhausted).
const ERROR_QUOTA = {
  error: {
    code: 403,
    message: 'The request cannot be completed because you have exceeded your quota.',
    errors: [{ message: 'quota', domain: 'youtube.quota', reason: 'quotaExceeded' }]
  }
};

module.exports = { LIVE_SEARCH, LATEST_SEARCH, EMPTY_SEARCH, ERROR_QUOTA };
