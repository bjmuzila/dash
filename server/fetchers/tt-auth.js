/**
 * TastyTrade auth — token load, refresh, and authenticated GET.
 * Self-contained: reads/writes tastytrade_token.json on disk.
 */
'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const ROOT_DIR      = path.resolve(__dirname, '../..');
const TOKEN_FILE    = path.join(ROOT_DIR, 'tastytrade_token.json');
const REFRESH_ENV   = process.env.TT_REFRESH_TOKEN || '';
const CLIENT_SECRET = process.env.TT_CLIENT_SECRET || '';

let accessToken  = null;
let refreshToken = REFRESH_ENV;
let tokenExpiry  = 0;

function loadTokenFile() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const t = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      accessToken  = t.access_token  || null;
      refreshToken = t.refresh_token || REFRESH_ENV;
      tokenExpiry  = t.expiry        || 0;
    }
  } catch (e) {
    console.error('[tt-auth] Token file read error:', e.message);
  }
  if (!refreshToken) refreshToken = REFRESH_ENV;
}

function saveTokenFile(t) {
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2)); } catch (e) {}
}

function isExpired() {
  return !accessToken || Date.now() >= tokenExpiry - 60_000;
}

function httpsRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function refreshAccessToken() {
  if (!refreshToken) { console.error('[tt-auth] No refresh token available'); return false; }
  try {
    const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (CLIENT_SECRET) params.set('client_secret', CLIENT_SECRET);
    const body = params.toString();
    const { status, data } = await httpsRequest({
      hostname: 'api.tastytrade.com',
      path:     '/oauth/token',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'spx-gex-dashboard/2.0',
      },
    }, body);

    if (status !== 200 || !data.access_token) {
      console.error('[tt-auth] Token refresh failed:', status, JSON.stringify(data));
      return false;
    }
    accessToken  = data.access_token;
    refreshToken = data.refresh_token || refreshToken;
    tokenExpiry  = Date.now() + (data.expires_in || 10800) * 1000;
    saveTokenFile({ access_token: accessToken, refresh_token: refreshToken, expiry: tokenExpiry, savedAt: new Date().toISOString() });
    console.log('[tt-auth] Token refreshed. Expires:', new Date(tokenExpiry).toISOString());
    return true;
  } catch (e) {
    console.error('[tt-auth] refreshAccessToken error:', e.message);
    return false;
  }
}

async function ensureToken() {
  if (!isExpired()) return true;
  return refreshAccessToken();
}

async function ttGet(apiPath) {
  await ensureToken();
  return httpsRequest({
    hostname: 'api.tastytrade.com',
    path:     apiPath,
    method:   'GET',
    headers:  {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type':  'application/json',
      'User-Agent':    'spx-gex-dashboard/2.0',
    },
  });
}

// Load token on module init
loadTokenFile();

module.exports = { ttGet, ensureToken, getAccessToken: () => accessToken };
