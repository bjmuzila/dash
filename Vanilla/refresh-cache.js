#!/usr/bin/env node
/**
 * refresh-cache.js — Call the cache refresh endpoint
 * Usage: node refresh-cache.js [host] [port]
 */

const http = require('http');

const host = process.argv[2] || 'localhost';
const port = process.argv[3] || 3001;

const options = {
  hostname: host,
  port: port,
  path: '/proxy/cache/refresh',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': 0
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      console.log('\n✓ Cache refreshed successfully');
      console.log(`  Entries cleared: ${result.entriesCleared}`);
      console.log(`  Timestamp: ${new Date(result.timestamp).toISOString()}`);
      if (result.symbols && result.symbols.length > 0) {
        console.log(`  Symbols: ${result.symbols.join(', ')}`);
      }
    } catch (e) {
      console.log(data);
    }
  });
});

req.on('error', (e) => {
  console.error(`✗ Error: ${e.message}`);
  process.exit(1);
});

req.end();
