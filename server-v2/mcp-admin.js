'use strict';
/**
 * server-v2/mcp-admin.js — the owner's tracker for the AI-app connector.
 *
 * Feeds owner.cbedge.net → System → AI Connections
 * (owner-vite/src/pages/AiConnections.tsx). Owner-only: both routes are
 * registered with auth 'owner', which api-router enforces before a handler runs.
 *
 *   GET  /api/admin/mcp-connections?days=7
 *        Who is connected through which app (Gemini / ChatGPT / Claude), when
 *        they last used it, how many tool calls, which tools, what got refused
 *        and why. `days` (1 | 7 | 30 | 90) windows the counts and the logs; the
 *        connection list itself is every grant still on file.
 *
 *   POST /api/admin/mcp-connections/revoke   { "familyId": "<uuid>" }
 *        Disconnects one connection — the same family revocation the token
 *        endpoint uses, so the app's next refresh fails and it asks the member
 *        to reconnect. JSON body only: a cross-site form cannot send one.
 *
 * The Activity list also carries the discovery steps ('probe' rows: an app
 * reaching /mcp without a token or reading the metadata), so a connection
 * attempt that dies before it registers still leaves a trace.
 *
 * Everything here is read off the connector's own tables (see mcp-oauth.js):
 * mcp_oauth_tokens / _codes / _clients for the connections themselves, and
 * mcp_tool_calls + mcp_oauth_events, which exist only to feed this page.
 * Tokens are never returned — only their family id, which is not a credential.
 */

const oauth = require('./mcp-oauth');

const WINDOWS = new Set([1, 7, 30, 90]);
const CHART_MIN_DAYS = 14;
const FAMILY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ET = 'America/New_York';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const iso = (v) => (v ? new Date(v).toISOString() : null);
const uriList = (v) => {
  if (Array.isArray(v)) return v;
  try { const j = JSON.parse(v || '[]'); return Array.isArray(j) ? j : []; } catch { return []; }
};
const hostsOf = (uris) => [...new Set(uris.map((u) => { try { return new URL(u).host; } catch { return null; } }).filter(Boolean))];

/** The last `n` calendar days in New York, oldest first, as YYYY-MM-DD. */
function etDays(n) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: ET });
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(fmt.format(new Date(Date.now() - i * 86_400_000)));
  return [...new Set(out)];
}

const SQL_CONNECTIONS = `
  WITH fam AS (
    SELECT family_id,
           MIN(user_id)    AS user_id,
           MIN(client_id)  AS client_id,
           MIN(created_at) AS connected_at,
           MAX(last_used_at) AS token_used_at,
           MAX(expires_at) FILTER (WHERE kind = 'refresh') AS expires_at,
           BOOL_OR(kind = 'refresh' AND revoked_at IS NULL AND expires_at > NOW()) AS live,
           MAX(revoked_at) FILTER (WHERE revoked_reason IS DISTINCT FROM 'rotated') AS revoked_at,
           (ARRAY_AGG(revoked_reason ORDER BY revoked_at DESC)
              FILTER (WHERE revoked_reason IS NOT NULL AND revoked_reason <> 'rotated'))[1] AS revoked_reason
      FROM mcp_oauth_tokens
     GROUP BY family_id
  )
  SELECT f.*, u.email, c.client_name, c.redirect_uris,
         COALESCE(k.calls, 0) AS calls, COALESCE(k.errors, 0) AS errors, k.last_tool, k.last_call_at
    FROM fam f
    LEFT JOIN users u ON u.id = f.user_id
    LEFT JOIN mcp_oauth_clients c ON c.client_id = f.client_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS calls,
             COUNT(*) FILTER (WHERE outcome <> 'ok')::int AS errors,
             (ARRAY_AGG(tool ORDER BY at DESC))[1] AS last_tool,
             MAX(at) AS last_call_at
        FROM mcp_tool_calls t
       WHERE t.family_id = f.family_id AND t.at > NOW() - $1::int * INTERVAL '1 day'
    ) k ON TRUE
   ORDER BY f.live DESC, GREATEST(f.token_used_at, k.last_call_at, f.connected_at) DESC
   LIMIT 300`;

// Approved on the consent page, but the app never traded the code for tokens —
// the exact shape of a connector that "says connected" and then does nothing.
const SQL_UNCLAIMED = `
  SELECT c.family_id, c.user_id, c.client_id, c.created_at, c.expires_at, (c.expires_at > NOW()) AS live,
         c.used_at, u.email, cl.client_name, cl.redirect_uris
    FROM mcp_oauth_codes c
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN mcp_oauth_clients cl ON cl.client_id = c.client_id
   WHERE c.created_at > NOW() - $1::int * INTERVAL '1 day'
     AND NOT EXISTS (SELECT 1 FROM mcp_oauth_tokens t WHERE t.family_id = c.family_id)
   ORDER BY c.created_at DESC
   LIMIT 50`;

const SQL_TOTALS = `
  SELECT
    (SELECT COUNT(*) FROM mcp_tool_calls WHERE at > NOW() - $1::int * INTERVAL '1 day')::int AS calls,
    (SELECT COUNT(*) FROM mcp_tool_calls WHERE at > NOW() - $1::int * INTERVAL '1 day' AND outcome <> 'ok')::int AS errors,
    (SELECT COUNT(DISTINCT user_id) FROM mcp_tool_calls WHERE at > NOW() - $1::int * INTERVAL '1 day')::int AS active_members,
    (SELECT COUNT(*) FROM mcp_tool_calls WHERE at > NOW() - INTERVAL '1 day')::int AS calls_24h,
    (SELECT COUNT(*) FROM mcp_oauth_clients WHERE created_at > NOW() - $1::int * INTERVAL '1 day')::int AS registrations,
    (SELECT COUNT(*) FROM mcp_oauth_clients WHERE created_at > NOW() - $1::int * INTERVAL '1 day'
        AND first_used_at IS NOT NULL)::int AS registrations_used,
    (SELECT COUNT(*) FROM mcp_oauth_events WHERE at > NOW() - $1::int * INTERVAL '1 day'
        AND kind IN ('register_refused', 'authorize_refused', 'token_refused'))::int AS refused,
    (SELECT COUNT(DISTINCT ip) FROM mcp_oauth_events WHERE at > NOW() - $1::int * INTERVAL '1 day'
        AND kind = 'probe')::int AS probe_callers,
    (SELECT COUNT(*) FROM mcp_oauth_events WHERE at > NOW() - $1::int * INTERVAL '1 day'
        AND kind = 'probe')::int AS probes`;

const SQL_DAILY = `
  SELECT to_char((at AT TIME ZONE '${ET}')::date, 'YYYY-MM-DD') AS day,
         COUNT(*)::int AS calls,
         COUNT(*) FILTER (WHERE outcome <> 'ok')::int AS errors,
         COUNT(DISTINCT user_id)::int AS members
    FROM mcp_tool_calls
   WHERE at > NOW() - $1::int * INTERVAL '1 day'
   GROUP BY 1 ORDER BY 1`;

const SQL_TOOLS = `
  SELECT tool,
         COUNT(*)::int AS calls,
         COUNT(*) FILTER (WHERE outcome <> 'ok')::int AS errors,
         ROUND(AVG(ms) FILTER (WHERE outcome IN ('ok', 'error')))::int AS avg_ms,
         COUNT(DISTINCT user_id)::int AS members
    FROM mcp_tool_calls
   WHERE at > NOW() - $1::int * INTERVAL '1 day'
   GROUP BY tool ORDER BY calls DESC`;

const SQL_CLIENTS = `
  SELECT c.client_id, c.client_name, c.redirect_uris, c.token_endpoint_auth_method, c.created_at, c.first_used_at,
         (SELECT COUNT(DISTINCT family_id) FROM mcp_oauth_tokens t WHERE t.client_id = c.client_id)::int AS connections
    FROM mcp_oauth_clients c
   WHERE c.created_at > NOW() - $1::int * INTERVAL '1 day'
   ORDER BY c.created_at DESC
   LIMIT 100`;

// Discovery rows ('probe') are read separately with their own limit, so a
// burst of scanners hitting /mcp can never push the real connection story
// (registrations, approvals, refusals) out of the Activity list.
const SQL_EVENTS = `
  SELECT e.id, e.at, e.kind, e.client_id, e.ip, e.detail, c.client_name, c.redirect_uris, u.email
    FROM mcp_oauth_events e
    LEFT JOIN mcp_oauth_clients c ON c.client_id = e.client_id
    LEFT JOIN users u ON u.id = e.user_id
   WHERE e.at > NOW() - $1::int * INTERVAL '1 day' AND e.kind <> 'probe'
   ORDER BY e.at DESC, e.id DESC
   LIMIT 200`;

const SQL_PROBES = `
  SELECT e.id, e.at, e.kind, e.client_id, e.ip, e.detail, NULL AS client_name, NULL AS redirect_uris, NULL AS email
    FROM mcp_oauth_events e
   WHERE e.at > NOW() - $1::int * INTERVAL '1 day' AND e.kind = 'probe'
   ORDER BY e.at DESC, e.id DESC
   LIMIT 100`;

const APP_KINDS = new Set(['gemini', 'chatgpt', 'claude', 'local', 'other']);

/** Every tool the connector offers, in its own order. Read lazily: mcp-server
 *  mounts this module, so by the time a report is built it is fully loaded. */
function offeredTools() {
  try { return require('./mcp-server').TOOLS.map((t) => t.name); } catch { return []; }
}

/** Which app an activity row belongs to: the registered client's redirect
 *  URIs when there is one, else the app a discovery row read off its UA. */
function eventApp(r, appOf) {
  if (r.redirect_uris) return appOf(uriList(r.redirect_uris));
  const a = r.detail && typeof r.detail === 'object' ? r.detail.app : null;
  return APP_KINDS.has(a) ? a : null;
}

/** The Tools table: every tool the connector offers, used or not (a tool added
 *  to mcp-server.js shows here at 0 calls from the first deploy), plus any tool
 *  still in the call log that has since been retired. Busiest first; unused
 *  ones keep the connector's own order. */
function toolRows(rows) {
  const offered = offeredTools();
  const byName = new Map(rows.map((r) => [r.tool, r]));
  const names = [...offered, ...rows.map((r) => r.tool).filter((n) => !offered.includes(n))];
  return names
    .map((tool, i) => {
      const r = byName.get(tool);
      return {
        tool,
        calls: r?.calls || 0,
        errors: r?.errors || 0,
        avgMs: r?.avg_ms ?? null,
        members: r?.members || 0,
        offered: offered.includes(tool),
        _i: i,
      };
    })
    .sort((a, b) => b.calls - a.calls || a._i - b._i)
    .map(({ _i, ...r }) => r);
}

async function buildReport(days) {
  const { query, appOf } = oauth.admin;
  const chartDays = Math.max(days, CHART_MIN_DAYS);
  const [conns, unclaimed, totals, daily, tools, clients, events, probes] = await Promise.all([
    query(SQL_CONNECTIONS, [days]),
    query(SQL_UNCLAIMED, [days]),
    query(SQL_TOTALS, [days]),
    query(SQL_DAILY, [chartDays]),
    query(SQL_TOOLS, [days]),
    query(SQL_CLIENTS, [days]),
    query(SQL_EVENTS, [days]),
    query(SQL_PROBES, [days]),
  ]);

  const connections = conns.rows.map((r) => {
    const status = r.live ? 'live' : r.revoked_reason ? 'revoked' : 'expired';
    const used = [r.token_used_at, r.last_call_at].filter(Boolean).map((v) => new Date(v).getTime());
    return {
      familyId: r.family_id,
      userId: r.user_id,
      email: r.email || null,
      app: appOf(uriList(r.redirect_uris)),
      appName: r.client_name || null,
      clientId: r.client_id,
      status,
      connectedAt: iso(r.connected_at),
      lastUsedAt: used.length ? new Date(Math.max(...used)).toISOString() : null,
      expiresAt: iso(r.expires_at),
      revokedAt: status === 'revoked' ? iso(r.revoked_at) : null,
      revokedReason: status === 'revoked' ? r.revoked_reason : null,
      calls: r.calls,
      errors: r.errors,
      lastTool: r.last_tool || null,
    };
  });
  for (const r of unclaimed.rows) {
    connections.push({
      familyId: r.family_id,
      userId: r.user_id,
      email: r.email || null,
      app: appOf(uriList(r.redirect_uris)),
      appName: r.client_name || null,
      clientId: r.client_id,
      // 'pending': the 5-minute code is still redeemable. 'unclaimed': it
      // lapsed (or was burned by a failed PKCE check) with no tokens issued.
      status: r.live && !r.used_at ? 'pending' : 'unclaimed',
      connectedAt: iso(r.created_at),
      lastUsedAt: null,
      expiresAt: iso(r.expires_at),
      revokedAt: null,
      revokedReason: null,
      calls: 0,
      errors: 0,
      lastTool: null,
    });
  }

  const live = connections.filter((c) => c.status === 'live');
  const apps = {};
  for (const c of connections) {
    const a = (apps[c.app] ||= { app: c.app, live: 0, calls: 0 });
    if (c.status === 'live') a.live++;
    a.calls += c.calls;
  }

  const byDay = new Map(daily.rows.map((r) => [r.day, r]));
  const t = totals.rows[0] || {};
  return {
    generatedAt: new Date().toISOString(),
    days,
    chartDays,
    connectorOn: process.env.MCP_CONNECTOR !== '0',
    maxGrants: Number(process.env.MCP_MAX_GRANTS) > 0 ? Math.floor(Number(process.env.MCP_MAX_GRANTS)) : 2,
    totals: {
      live: live.length,
      members: new Set(live.map((c) => c.userId)).size,
      activeMembers: t.active_members || 0,
      calls: t.calls || 0,
      errors: t.errors || 0,
      calls24h: t.calls_24h || 0,
      registrations: t.registrations || 0,
      registrationsUsed: t.registrations_used || 0,
      refused: t.refused || 0,
      probes: t.probes || 0,
      probeCallers: t.probe_callers || 0,
      unclaimed: connections.filter((c) => c.status === 'unclaimed').length,
    },
    connections,
    apps: Object.values(apps).sort((a, b) => b.live - a.live || b.calls - a.calls),
    daily: etDays(chartDays).map((day) => {
      const r = byDay.get(day);
      return { day, calls: r?.calls || 0, errors: r?.errors || 0, members: r?.members || 0 };
    }),
    tools: toolRows(tools.rows),
    clients: clients.rows.map((r) => {
      const uris = uriList(r.redirect_uris);
      return {
        clientId: r.client_id,
        name: r.client_name || null,
        app: appOf(uris),
        authMethod: r.token_endpoint_auth_method,
        createdAt: iso(r.created_at),
        firstUsedAt: iso(r.first_used_at),
        callbacks: uris.length,
        hosts: hostsOf(uris),
        connections: r.connections,
      };
    }),
    events: [...events.rows, ...probes.rows]
      .sort((a, b) => new Date(b.at) - new Date(a.at) || Number(b.id) - Number(a.id))
      .map((r) => ({
        id: Number(r.id),
        at: iso(r.at),
        kind: r.kind,
        clientId: r.client_id,
        clientName: r.client_name || null,
        app: eventApp(r, appOf),
        email: r.email || null,
        ip: r.ip || null,
        detail: r.detail || null,
      })),
  };
}

async function handleReport(req, res) {
  const raw = Number(new URL(req.url || '/', 'http://localhost').searchParams.get('days') || 7);
  const days = WINDOWS.has(raw) ? raw : 7;
  try {
    send(res, 200, await buildReport(days));
  } catch (e) {
    console.warn('[mcp-admin] report failed:', e?.message || e);
    send(res, 503, { error: 'The connector tables could not be read just now.' });
  }
}

function readJson(req, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

async function handleRevokeConnection(req, res) {
  if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
    return send(res, 415, { error: 'Send JSON.' });
  }
  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: 'Bad request body.' }); }
  const familyId = typeof body?.familyId === 'string' ? body.familyId : '';
  if (!FAMILY_RE.test(familyId)) return send(res, 400, { error: 'familyId must be a connection id.' });
  try {
    const n = await oauth.admin.revokeFamily(familyId, 'disconnected by owner');
    if (!n) return send(res, 404, { error: 'No such connection.' });
    send(res, 200, { ok: true, familyId });
  } catch (e) {
    console.warn('[mcp-admin] revoke failed:', e?.message || e);
    send(res, 503, { error: 'Could not disconnect just now.' });
  }
}

function registerAdminRoutes(register) {
  register('/api/admin/mcp-connections', { auth: 'owner', methods: ['GET'], handler: handleReport });
  register('/api/admin/mcp-connections/revoke', { auth: 'owner', methods: ['POST'], handler: handleRevokeConnection });
}

module.exports = { registerAdminRoutes, _test: { buildReport, etDays, toolRows } };
