#!/usr/bin/env node
/* Tiny static file server for testing the app in a desktop browser.
 * Usage: node scripts/dev-server.js [port]   (default 8080)
 * Then open http://localhost:8080/  (use a Chromium-based browser; note that
 * raw HLS .m3u8 streams only play where the browser supports native HLS).   */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var port = parseInt(process.argv[2], 10) || 8080;

var TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.m3u': 'application/vnd.apple.mpegurl',
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.xml': 'application/xml',
    '.json': 'application/json'
};

http.createServer(function (req, res) {
    var urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') { urlPath = '/index.html'; }
    var filePath = path.normalize(path.join(root, urlPath));
    if (filePath.indexOf(root) !== 0) { res.writeHead(403); return res.end('Forbidden'); }

    fs.readFile(filePath, function (err, data) {
        if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
        var ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
            'Content-Type': TYPES[ext] || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
    });
}).listen(port, function () {
    console.log('IPTV dev server running at http://localhost:' + port + '/');
    console.log('Serving: ' + root);
});
