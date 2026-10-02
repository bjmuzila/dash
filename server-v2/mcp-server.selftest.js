'use strict';
// ChatGPT connector checks — protocol, auth challenge, tool shaping, allowlists.
// Fully offline: ws-auth and the DB bundle are stubbed, upstream reads are fakes.
//   node server-v2/mcp-server.selftest.js
// The full OAuth round trip (register → sign-in → consent → token → refresh →
// revoke) needs a real Postgres and was verified against one when this shipped;
// see the 2026-10-01 CHANGELOG entry.
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const path = require('path');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const GOOD = `cbe_mcp_at_${'s'.repeat(43)}`; // real tokens are prefix + 43 base64url chars
const PAID = new Set(['u_paid']);

const stubModule = (file, exports) => {
  const f = path.join(__dirname, file);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};
stubModule('ws-auth.js', {
  verifyWsRequest: async () => ({ ok: false, reason: 'no-token' }),
  getAccessForUser: async (uid) => (PAID.has(uid) ? { ok: true, reason: 'subscribed' } : { ok: false, reason: 'inactive' }),
  isTransientAuthFailure: () => false,
});
stubModule('_lib-db.cjs', {
  async pgQuery(sql, params) {
    if (/FROM daily_em/.test(sql)) {
      return { rows: [{ session_date: params[1], ref_close: 6790.5, em: 42.25, up: 6832.75, down: 6748.25, expiry: params[1], method: 'straddle', recorded_at: Date.now() }] };
    }
    if (/UPDATE mcp_oauth_tokens SET last_used_at/.test(sql)) {
      return { rows: params[0] === sha(GOOD) ? [{ user_id: 'u_paid', client_id: 'c', scope: 'cbedge.read', resource: null, family_id: 'f' }] : [] };
    }
    return { rows: [] };
  },
});

const mcp = require('./mcp-server');
const oauth = require('./mcp-oauth');

const BOARD = {
  symbol: 'SPX', spot: 6812.34, prevClose: 6790.5, expiry: '2026-10-01', callWall: 6850, putWall: 6750,
  gexFlip: 6801.2, totalNetGex: 1.23e9, updatedAt: Date.now() - 5000,
  gexRows: [6750, 6800, 6820, 6850].map((k) => ({
    strike: k, netGEX: k === 6850 ? 4e8 : k === 6750 ? -3e8 : 1e7, netVolGEX: k === 6820 ? 5e7 : 0,
    callOI: 1000, putOI: 900, callVolume: 50, putVolume: 40,
  })),
};
const etToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const FAKES = {
  '/proxy/gex': BOARD,
  '/api/calendar': { events: [
    { date: etToday, time_formatted: '8:30am', title: 'CPI m/m', country: 'USD', impact: 'High' },
    { date: etToday, time_formatted: '10:00am', title: 'Sentiment', country: 'USD', impact: 'Medium' },
    { date: etToday, time_formatted: '5:00am', title: 'German CPI', country: 'EUR', impact: 'High' },
  ] },
};
const ctx = {
  internalFetch: async (p) => {
    const body = FAKES[p.split('?')[0]];
    return new Response(JSON.stringify(body ?? null), { status: body === undefined ? 404 : 200 });
  },
};

let n = 0; const fails = [];
async function check(name, fn) {
  try { await fn(); n++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL ${name}\n       ${e.message}`); }
}

(async () => {
  console.log('mcp-server selftest');
  const srv = http.createServer((req, res) => mcp.handleMcp(req, res, ctx));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const rpc = (body, token = GOOD) => fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const call = async (name, args = {}) => (await (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).json()).result;

  await check('no bearer → 401 whose challenge names the protected-resource metadata', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, null);
    assert.strictEqual(r.status, 401);
    // Off-production the issuer is this loopback host; in production it is pinned to cbedge.net.
    const origin = process.env.NODE_ENV === 'production' ? 'https://cbedge.net' : base;
    assert.ok(r.headers.get('www-authenticate').includes(`resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`));
  });

  await check('unknown bearer → 401 invalid_token', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'cbe_mcp_at_nope');
    assert.strictEqual(r.status, 401);
    assert.match(r.headers.get('www-authenticate'), /error="invalid_token"/);
  });

  await check('initialize echoes a supported protocol version', async () => {
    const j = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json();
    assert.strictEqual(j.result.protocolVersion, '2025-06-18');
    assert.strictEqual(j.result.serverInfo.name, 'cbedge');
  });

  await check('notifications get 202, unknown methods -32601', async () => {
    assert.strictEqual((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    assert.strictEqual((await (await rpc({ jsonrpc: '2.0', id: 2, method: 'x/y' })).json()).error.code, -32601);
  });

  await check('tools/list: every tool read-only, oauth2-scoped, no handler leaked', async () => {
    const { result } = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).json();
    assert.strictEqual(result.tools.length, mcp.TOOLS.length);
    for (const t of result.tools) {
      assert.strictEqual(t.annotations.readOnlyHint, true, t.name);
      assert.deepStrictEqual(t.securitySchemes, [{ type: 'oauth2', scopes: [oauth.SCOPE] }]);
      assert.ok(!('run' in t));
    }
  });

  await check('spx_gamma_levels reads walls, flip and regime off the board', async () => {
    const s = (await call('spx_gamma_levels')).structuredContent;
    assert.strictEqual(s.callWall, 6850); assert.strictEqual(s.putWall, 6750);
    assert.strictEqual(s.gammaRegime, 'positive');
    assert.strictEqual(s.largestPositiveStrikes[0].strike, 6850);
    assert.strictEqual(s.largestNegativeStrikes[0].strike, 6750);
    assert.strictEqual(s.dailyExpectedMove.upper, 6832.75);
  });

  await check('economic_calendar defaults to today, high impact, USD', async () => {
    const s = (await call('economic_calendar')).structuredContent;
    assert.deepStrictEqual(s.events.map((e) => e.title), ['CPI m/m']);
  });

  await check('an upstream 404 comes back as a tool error, not a crash', async () => {
    const r = await call('earnings_today');
    assert.strictEqual(r.isError, true);
  });

  await check('lapsed membership → isError, no data', async () => {
    PAID.delete('u_paid');
    oauth._test.reset();
    const r = await call('spx_gamma_levels');
    assert.strictEqual(r.isError, true);
    assert.strictEqual(r.structuredContent, undefined);
    PAID.add('u_paid');
    oauth._test.reset();
  });

  await check('redirect allowlist: AI-client hosts + loopback only', () => {
    const ok = oauth._test.redirectAllowed;
    assert.ok(ok('https://chatgpt.com/connector/oauth/abc'));
    assert.ok(ok('https://chatgpt.com/connector_platform_oauth_redirect'));
    const loopbackOk = process.env.NODE_ENV !== 'production' || process.env.MCP_ALLOW_LOOPBACK === '1';
    assert.strictEqual(ok('http://localhost:6274/oauth/callback'), loopbackOk);
    assert.ok(!ok('https://chatgpt.com.evil.io/x'));
    assert.ok(!ok('http://chatgpt.com/x'));
    assert.ok(!ok('https://evil.example/cb'));
    // Gemini: Google's relay, but only on the path no Cloud project can own.
    assert.ok(ok('https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-7f3a9c-cbedge.net'));
    assert.ok(!ok('https://oauth-redirect.googleusercontent.com/r/some-cloud-project'));
    assert.ok(!ok('https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-x/../evil'));
    assert.ok(!ok('http://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-x'));
  });

  await check('MCP_CONNECTOR=0 registers nothing; default registers all 9 paths', () => {
    const seen = [];
    process.env.MCP_CONNECTOR = '0';
    assert.strictEqual(mcp.registerRoutes((p) => seen.push(p)), false);
    assert.strictEqual(seen.length, 0);
    delete process.env.MCP_CONNECTOR;
    mcp.registerRoutes((p, def) => { assert.strictEqual(def.auth, 'public'); seen.push(p); });
    assert.deepStrictEqual(seen.sort(), [
      '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp', '/mcp', '/mcp/', '/oauth/authorize', '/oauth/register',
      '/oauth/revoke', '/oauth/token',
    ]);
  });

  srv.close();
  console.log(`\n${n} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();
