/**
 * SPX GEX — Local Server
 * Usage:  node serve.js
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon'
};

http.createServer((req, res) => {
  // Favicon
  if (req.url === '/favicon.ico') {
    res.writeHead(204); 
    res.end(); 
    return;
  }

  // Default to index.html
  let filePath = req.url === '/' ? '/index.html' : req.url;
  
  // Remove query strings
  filePath = filePath.split('?')[0];
  
  // Build full path
  const fullPath = path.join(ROOT, filePath);
  
  // Security: prevent directory traversal
  if (!fullPath.startsWith(ROOT)) {
    res.writeHead(403, {'Content-Type': 'text/plain'});
    res.end('Forbidden');
    return;
  }

  // Get file extension for MIME type
  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // Read and serve file
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, {'Content-Type': 'text/plain'});
        res.end('404 Not Found: ' + filePath + '\n\nLooking in: ' + ROOT + '\nFull path: ' + fullPath);
      } else {
        res.writeHead(500, {'Content-Type': 'text/plain'});
        res.end('Server Error: ' + err.message);
      }
      return;
    }
    
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });

}).listen(PORT, '127.0.0.1');
