/**
 * google-auth.js — Run once to authorize Google Sheets access
 * 
 * Setup:
 * 1. Go to https://console.cloud.google.com/
 * 2. Create a project → Enable Google Sheets API
 * 3. Create OAuth2 credentials (Desktop app type)
 * 4. Download credentials JSON → save as google_credentials.json next to this file
 * 5. Run: node google-auth.js
 * 6. Follow the URL in terminal, paste the code back
 * 7. google_token.json will be created — the proxy uses this automatically
 */

'use strict';
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const http  = require('http');

const CREDENTIALS_FILE = path.join(__dirname, 'google_credentials.json');
const TOKEN_FILE       = path.join(__dirname, 'google_token.json');
const SCOPES           = 'https://www.googleapis.com/auth/spreadsheets';
const REDIRECT_URI     = 'http://localhost:3002/oauth2callback';

if (!fs.existsSync(CREDENTIALS_FILE)) {
  console.error('ERROR: google_credentials.json not found.');
  console.error('Download it from Google Cloud Console → APIs & Services → Credentials');
  process.exit(1);
}

const creds = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
const { client_id, client_secret } = creds.installed || creds.web || {};

if (!client_id || !client_secret) {
  console.error('ERROR: Invalid google_credentials.json — missing client_id or client_secret');
  process.exit(1);
}

// Build auth URL
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${encodeURIComponent(client_id)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log('\n=== Google Sheets Authorization ===');
console.log('Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for callback on http://localhost:3002/oauth2callback ...\n');

// Start local server to catch redirect
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3002');
  if (url.pathname !== '/oauth2callback') { res.end('Not found'); return; }

  const code = url.searchParams.get('code');
  if (!code) { res.end('No code in callback'); return; }

  res.end('<html><body><h2>✓ Authorization successful! You can close this window.</h2></body></html>');
  server.close();

  // Exchange code for tokens
  const body = new URLSearchParams({
    code, client_id, client_secret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code'
  }).toString();

  const token = await new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });

  if (!token.access_token) {
    console.error('ERROR: Token exchange failed:', token);
    process.exit(1);
  }

  // Save token with expiry
  const stored = {
    access_token:  token.access_token,
    refresh_token: token.refresh_token,
    expiry_date:   Date.now() + (token.expires_in * 1000),
    scope:         token.scope,
    token_type:    token.token_type
  };

  fs.writeFileSync(TOKEN_FILE, JSON.stringify(stored, null, 2));
  console.log('✓ google_token.json saved successfully!');
  console.log('  The proxy will now auto-refresh this token as needed.');
  process.exit(0);
});

server.listen(3002);
