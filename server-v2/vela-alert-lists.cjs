'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VELA ALERT LISTS · one level, many tickers, watched by the server.
 *
 * Brandon, 2026-10-10: "i would like another page to make custom lists for each
 * of those alerts. like if i click volt - i can add tickers to it. so i dont
 * have to go to each ticker to add the volt." Picked: stay armed with a
 * cooldown, the SERVER watches, and the lists live in a Lists tab of Vela's
 * Level Alerts panel (cbedge-v3/src/pages/vela/levels/levelLists.ts).
 *
 * WHAT IS DIFFERENT FROM A PANEL ALERT (levels/levelAlerts.ts)
 *   panel alert   kept in one browser, watched only while a Vela chart of that
 *                 symbol is open in it, fires ONCE then disarms.
 *   list alert    kept in Postgres per account, watched here every minute
 *                 whether or not any tab is open, STAYS ARMED: after it fires it
 *                 can fire again once the account's cooldown has passed.
 *
 * A LIST ALERT FOLLOWS ITS LEVEL, like the panel's. Each minute the level is
 * re-read and the alert asks: did price move from one side of THE CURRENT level
 * to the other since the last minute? Comparing both prices against the current
 * level (not last minute's level) means a Volt that jumps across price is not a
 * cross; only price moving through it is.
 *
 * ── THE LEVELS, PORTED ──────────────────────────────────────────────────────
 * The panel computes its levels in the browser (levelAlerts.ts readLevels). The
 * same arithmetic is transcribed here so the server can read a symbol nobody has
 * open. Every function below names the file it is copied from; change one, change
 * the other. The inputs are the SAME routes the browser reads, fetched over the
 * loopback with the internal token:
 *
 *   levels    /api/chains?ticker=&range=all&live=0&front=1&slim=1   (board/chainGex.ts)
 *             Volt / Reversal / Surge / Coil   data/voltickLevels.ts vtFromLadder
 *             Flip                             pages/vela/gexBasis.ts flipOf
 *             net GEX per strike               board/multiGreek/mgMath.ts strikeGex
 *   ES / NQ   the index chain shifted by the day's basis
 *             /proxy/es-spx-basis · /proxy/nq-ndx-basis      (pages/vela/wallsData.ts loadBasis)
 *   bars      /api/snapshots/etf-candles?symbol=&days=4&interval=5   stocks, ETFs, indexes
 *             /api/snapshots/candles?daysBack=5&interval=5&lite=1&symbol=NQ   futures
 *             IB, overnight, open, prior day     levelAlerts.ts readLevels
 *
 * The GEX book (OI, OI + Vol, Vol) and the Coil switch are the account's own
 * Vela settings, sent up by the Lists tab whenever they are saved, so a list alert
 * names the same strike the panel would. One known gap: on OI + Vol the panel's
 * Flip comes from deriveLevels' first-crossing rule; here it is flipOf (the
 * crossing nearest price) on every book. They agree whenever the ladder has one
 * crossing near the money.
 *
 * ── DELIVERY ────────────────────────────────────────────────────────────────
 *   1. a row in vela_alerts (server-v2/vela-alerts.cjs), so it shows on Vela's
 *      bell for the rest of the day, on every device
 *   2. the account's Discord webhook, when one is saved: the only channel that
 *      reaches someone with no Vela tab open (there is no web push on this box)
 *   3. an open Vela tab polls GET ?since= and toasts / notifies the new ones
 *
 * ── ROUTES ──────────────────────────────────────────────────────────────────
 *   GET  /api/vela/alert-lists[?since=ms]  { prefs, lists, fires }
 *   POST /api/vela/alert-lists             { action: 'add', level, symbols[] }
 *                                          { action: 'remove', level, symbol }
 *                                          { action: 'clear', level }
 *                                          { action: 'prefs', cooldownMin?, gexBasis?, coil?, webhook?, paused? }
 *                                          { action: 'test' }  one Discord message
 *   Per account: every query filters on user_id. Subscriber auth, like /api/vela/alerts.
 *
 * Watcher: startVelaAlertListWatcher(PORT) from server-with-proxy.js, under
 * runJob('vela-alert-lists') so it runs in exactly one process.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TICK_MS = 60_000;
/** Bars older than this are not a live price: the symbol's market is shut. */
const STALE_BAR_MS = 20 * 60_000;
/** A previous reading older than this is not compared against (overnight gap, restart). */
const MAX_GAP_MS = 30 * 60_000;
const MAX_SYMBOLS_PER_LIST = 60;
const MAX_ROWS_PER_USER = 400;
const COOLDOWN_DEFAULT = 30;
const COOLDOWN_MIN = 1;
const COOLDOWN_MAX = 24 * 60;

const LEVELS = [
  { key: 'volt', name: 'Volt', group: 'Voltick' },
  { key: 'reversal', name: 'Reversal', group: 'Voltick' },
  { key: 'surge', name: 'Surge', group: 'Voltick' },
  { key: 'coil', name: 'Coil', group: 'Voltick' },
  { key: 'flip', name: 'Flip', group: 'Voltick' },
  { key: 'ibh', name: 'IB high', group: 'Session' },
  { key: 'ibl', name: 'IB low', group: 'Session' },
  { key: 'onh', name: 'Overnight high', group: 'Session' },
  { key: 'onl', name: 'Overnight low', group: 'Session' },
  { key: 'open', name: 'Open', group: 'Session' },
  { key: 'pdh', name: 'Prior day high', group: 'Prior' },
  { key: 'pdl', name: 'Prior day low', group: 'Prior' },
  { key: 'pdc', name: 'Prior close', group: 'Prior' },
];
const LEVEL_BY_KEY = new Map(LEVELS.map((l) => [l.key, l]));
const GEX_KEYS = new Set(['volt', 'reversal', 'surge', 'coil', 'flip']);
const BASES = new Set(['oi', 'oivol', 'vol']);
const TICKER_RE = /^\/?[A-Z][A-Z0-9.\-]{0,9}!?$/;

/* ── time (ET) ─────────────────────────────────────────────────────────────── */

const ET_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const ET_HM = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
const etDateKey = (ms) => ET_DATE.format(new Date(ms));
function etMinutesOfDay(ms) {
  let h = 0;
  let m = 0;
  for (const p of ET_HM.formatToParts(new Date(ms))) {
    if (p.type === 'hour') h = Number(p.value) % 24;
    else if (p.type === 'minute') m = Number(p.value);
  }
  return h * 60 + m;
}
const isRth = (t) => {
  const m = etMinutesOfDay(t);
  return m >= 570 && m < 960;
};

/* ── symbols · pages/vela/cbedgeProvider.ts resolveSym ─────────────────────── */

const FUTURES = { ES: 'ES', '/ES': 'ES', ES1: 'ES', NQ: 'NQ', '/NQ': 'NQ', NQ1: 'NQ' };
const INDEXES = new Set(['SPX', 'NDX', 'VIX', 'RUT', 'XSP']);

function resolveSym(ticker) {
  const raw = String(ticker || '').trim().toUpperCase().replace(/!$/, '');
  const fut = FUTURES[raw];
  if (fut) return { key: fut, kind: 'futures', fut };
  return { key: raw, kind: INDEXES.has(raw) ? 'index' : 'stock' };
}

/** What a list stores: the bare ticker the panel uses (`bare()` in levelAlerts.ts). */
function cleanSymbol(s) {
  const k = String(s ?? '').replace(/^[^:]*:/, '').trim().toUpperCase();
  if (!TICKER_RE.test(k)) return null;
  const r = resolveSym(k);
  return r.fut ?? k.replace(/!$/, '');
}

/* ── bars · board/gexCandles/candles.ts parseCandles / parseEsCandles / sanitize ── */

const n0 = (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
function sanitize(t, o, h, l, c, v) {
  if (!t || !(c > 0)) return null;
  const open = o > 0 ? o : c;
  let high = h > 0 ? h : Math.max(open, c);
  let low = l > 0 ? l : Math.min(open, c);
  high = Math.max(high, open, c);
  low = Math.min(low, open, c);
  if (high - low > c * 0.25) return null;
  return { time: t, open, high, low, close: c, volume: Math.max(0, v) };
}
function parseBars(json) {
  if (!json || typeof json !== 'object') return [];
  const out = [];
  const rows = json.rows;
  if (!Array.isArray(rows)) return [];
  if (json.lite === 1 && Array.isArray(json.cols)) {
    const ix = (k) => json.cols.indexOf(k);
    const iT = ix('timestamp'), iO = ix('open'), iH = ix('high'), iL = ix('low'), iC = ix('close'), iV = ix('volume');
    if (iT < 0 || iC < 0) return [];
    for (const t of rows) {
      const b = sanitize(n0(t[iT]), n0(t[iO]), n0(t[iH]), n0(t[iL]), n0(t[iC]), n0(t[iV]));
      if (b) out.push(b);
    }
  } else {
    for (const r of rows) {
      const b = sanitize(n0(r.timestamp), n0(r.open), n0(r.high), n0(r.low), n0(r.close), n0(r.volume));
      if (b) out.push(b);
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/* ── session levels · levels/levelAlerts.ts readLevels (the session / prior half) ── */

function sessionLevels(bars, fut) {
  const out = {};
  if (!bars.length) return out;
  const today = etDateKey(bars[bars.length - 1].time);
  const todays = bars.filter((b) => etDateKey(b.time) === today);
  const rthToday = todays.filter((b) => isRth(b.time));
  const ib = rthToday.filter((b) => etMinutesOfDay(b.time) < 630);
  const ibDone = rthToday.some((b) => etMinutesOfDay(b.time) >= 630);
  out.ibh = ibDone && ib.length ? Math.max(...ib.map((b) => b.high)) : null;
  out.ibl = ibDone && ib.length ? Math.min(...ib.map((b) => b.low)) : null;
  const preOpen = bars.filter((b) => {
    const d = etDateKey(b.time);
    const m = etMinutesOfDay(b.time);
    if (fut) {
      return (d === today && m < 570) ||
        (d < today && m >= 18 * 60 && Date.parse(`${today}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`) <= 3 * 86_400_000);
    }
    return d === today && m < 570;
  });
  out.onh = preOpen.length ? Math.max(...preOpen.map((b) => b.high)) : null;
  out.onl = preOpen.length ? Math.min(...preOpen.map((b) => b.low)) : null;
  out.open = rthToday[0]?.open ?? null;
  const prevDay = [...new Set(bars.filter((b) => isRth(b.time)).map((b) => etDateKey(b.time)))].filter((d) => d < today).pop();
  const prev = prevDay ? bars.filter((b) => isRth(b.time) && etDateKey(b.time) === prevDay) : [];
  out.pdh = prev.length ? Math.max(...prev.map((b) => b.high)) : null;
  out.pdl = prev.length ? Math.min(...prev.map((b) => b.low)) : null;
  out.pdc = prev.length ? prev[prev.length - 1].close : null;
  return out;
}

/* ── the chain · board/multiGreek/mgMath.ts parseChain + strikeGex ─────────── */

function parseFrontChain(json) {
  const data = json && json.data;
  const items = Array.isArray(data?.items) ? data.items : [];
  const expiries = [];
  const leg = (raw) => (raw ? { gamma: n0(raw.gamma), oi: n0(raw['open-interest']), vol: n0(raw.volume) } : null);
  for (const item of items) {
    const expiration = String(item?.['expiration-date'] ?? '');
    if (!expiration) continue;
    const rows = [];
    for (const s of Array.isArray(item.strikes) ? item.strikes : []) {
      const strike = n0(s?.['strike-price']);
      if (strike) rows.push({ strike, call: leg(s.call), put: leg(s.put) });
    }
    if (rows.length) expiries.push({ expiration, rows });
  }
  expiries.sort((a, b) => a.expiration.localeCompare(b.expiration));
  return { front: expiries[0] ?? null, spot: n0(data?.underlyingPrice) };
}

function strikeGex(row, spot, basis) {
  if (!row || !(spot > 0)) return 0;
  const useOi = basis !== 'vol';
  const useVol = basis !== 'oi';
  const cc = (useOi ? (row.call?.oi ?? 0) : 0) + (useVol ? (row.call?.vol ?? 0) : 0);
  const pc = (useOi ? (row.put?.oi ?? 0) : 0) + (useVol ? (row.put?.vol ?? 0) : 0);
  const cg = Math.abs(row.call?.gamma ?? 0);
  const pg = Math.abs(row.put?.gamma ?? 0);
  return (cg * cc - pg * pc) * spot * spot * 0.01 * 100;
}

/* ── data/voltickLevels.ts vtFromLadder ────────────────────────────────────── */

const COIL_SHARE = 0.5;
const MAX_COILS = 5;
function vtFromLadder(rows, spot, opts = {}) {
  const ok = rows.filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.net) && r.net !== 0);
  const byAbs = ok.slice().sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.strike - b.strike);
  const v = byAbs[0]?.strike ?? null;
  if (v == null) return { volt: null, reversal: null, surge: null, coil: null };
  const voltAbs = Math.abs(byAbs[0].net);
  let reversal = null;
  if (spot != null && spot > 0) {
    const up = v >= spot;
    reversal = byAbs.find((r) => r.strike !== v && (up ? r.strike < spot : r.strike >= spot))?.strike ?? null;
  }
  const surge = byAbs.find((r) => r.strike !== v && r.strike !== reversal)?.strike ?? null;
  const coils = opts.coil === false || !(voltAbs > 0)
    ? []
    : byAbs
      .filter((r) => r.strike !== v && r.strike !== reversal && r.strike !== surge && Math.abs(r.net) >= COIL_SHARE * voltAbs)
      .slice(0, MAX_COILS)
      .map((r) => r.strike);
  return { volt: v, reversal, surge, coil: coils[0] ?? null };
}

/* ── pages/vela/gexBasis.ts flipOf ─────────────────────────────────────────── */

function flipOf(rows, spot) {
  const s = rows.filter((r) => r.strike > 0 && Number.isFinite(r.net)).slice().sort((a, b) => a.strike - b.strike);
  const xs = [];
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i].net;
    const b = s[i + 1].net;
    if (a === 0) xs.push(s[i].strike);
    else if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
      const k0 = s[i].strike;
      const k1 = s[i + 1].strike;
      xs.push(Math.round((k0 + ((k1 - k0) * Math.abs(a)) / (Math.abs(a) + Math.abs(b))) * 10) / 10);
    }
  }
  if (!xs.length) return null;
  if (!(spot != null && spot > 0)) return xs[0];
  return xs.reduce((best, x) => (Math.abs(x - spot) < Math.abs(best - spot) ? x : best));
}

/** Voltick levels off one front chain, in the chart's price space. */
function gexLevels(chainJson, price, basis, coil, shift) {
  const { front, spot } = parseFrontChain(chainJson);
  if (!front || !(spot > 0) || !Number.isFinite(shift)) return null;
  const book = front.rows.map((r) => ({ strike: r.strike, net: strikeGex(r, spot, basis) }));
  // the chart's price moved onto the index's strikes judges the sides (levelAlerts.ts)
  const judge = price != null && price > 0 ? price - shift : spot;
  const d = vtFromLadder(book, judge, { coil });
  const at = (v) => (v == null ? null : v + shift);
  return {
    volt: at(d.volt),
    reversal: at(d.reversal),
    surge: at(d.surge),
    coil: at(d.coil),
    flip: at(flipOf(book, spot)),
  };
}

/* ── one minute's decision, kept pure for the selftest ─────────────────────── */

/**
 * Should this row ring? `prev` is last minute's price, `price` this minute's,
 * both against the level as it stands NOW.
 */
function decide({ prevPrice, prevAt, price, level, now, lastFiredAt, cooldownMin }) {
  if (!(level > 0) || !(price > 0)) return { ring: false, why: 'no level or price' };
  if (!(prevPrice > 0) || !prevAt || now - prevAt > MAX_GAP_MS) return { ring: false, why: 'no recent reading' };
  if (prevPrice === price) return { ring: false, why: 'no move' };
  const crossed = (prevPrice < level && price >= level) || (prevPrice > level && price <= level);
  if (!crossed) return { ring: false, why: 'no cross' };
  if (lastFiredAt && now - lastFiredAt < cooldownMin * 60_000) return { ring: false, why: 'cooling down' };
  return { ring: true, dir: price > prevPrice ? 'up' : 'down' };
}

/* ── storage ───────────────────────────────────────────────────────────────── */

function makeStore(libDb) {
  const q = (sql, params = []) => libDb.queryAll(sql, params);
  let schema = null;
  function ensure() {
    if (!schema) {
      schema = (async () => {
        await q(`CREATE TABLE IF NOT EXISTS vela_alert_lists (
          user_id TEXT NOT NULL,
          level_key TEXT NOT NULL,
          symbol TEXT NOT NULL,
          added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_price DOUBLE PRECISION,
          last_level DOUBLE PRECISION,
          last_at TIMESTAMPTZ,
          last_fired_at TIMESTAMPTZ,
          fired_count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, level_key, symbol)
        )`);
        await q(`CREATE TABLE IF NOT EXISTS vela_alert_list_prefs (
          user_id TEXT PRIMARY KEY,
          cooldown_min INTEGER NOT NULL DEFAULT ${COOLDOWN_DEFAULT},
          gex_basis TEXT NOT NULL DEFAULT 'vol',
          coil BOOLEAN NOT NULL DEFAULT TRUE,
          webhook TEXT,
          paused BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        // vela_alerts is vela-alerts.cjs's table. Its DDL is repeated, verbatim and
        // idempotent, so a server that fires before anyone has opened the bell
        // still has somewhere to write. Change one, change the other.
        await q(`CREATE TABLE IF NOT EXISTS vela_alerts (
          id BIGSERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          day DATE NOT NULL,
          at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          key TEXT NOT NULL,
          kind TEXT NOT NULL,
          symbol TEXT,
          title TEXT,
          text TEXT,
          meta TEXT
        )`);
        await q('CREATE UNIQUE INDEX IF NOT EXISTS vela_alerts_user_day_key ON vela_alerts (user_id, day, key)');
      })().catch((e) => { schema = null; throw e; });
    }
    return schema;
  }
  return { q, ensure };
}

const prefsOut = (r) => ({
  cooldownMin: Number(r?.cooldown_min ?? COOLDOWN_DEFAULT),
  gexBasis: BASES.has(r?.gex_basis) ? r.gex_basis : 'vol',
  coil: r?.coil !== false,
  webhook: r?.webhook ? maskHook(r.webhook) : null,
  hasWebhook: !!r?.webhook,
  paused: r?.paused === true,
});
const maskHook = (u) => String(u).replace(/(webhooks\/\d+\/).+$/, '$1…');
const isHook = (u) => /^https:\/\/(discord\.com|discordapp\.com|canary\.discord\.com|ptb\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(String(u || ''));

async function postDiscord(url, content) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`discord ${r.status}`);
}

/* ── routes ────────────────────────────────────────────────────────────────── */

function registerVelaAlertListRoutes({ register, send, readJson, libDb }) {
  if (!libDb) return 0;
  const { q, ensure } = makeStore(libDb);
  const TODAY = `(NOW() AT TIME ZONE 'America/New_York')::date`;

  async function readAll(userId, since) {
    const [prefRows, rows] = await Promise.all([
      q('SELECT * FROM vela_alert_list_prefs WHERE user_id = ?', [userId]),
      q(`SELECT level_key, symbol, last_price, last_level,
                (EXTRACT(EPOCH FROM last_at) * 1000)::bigint AS last_at_ms,
                (EXTRACT(EPOCH FROM last_fired_at) * 1000)::bigint AS fired_ms,
                fired_count
           FROM vela_alert_lists WHERE user_id = ? ORDER BY level_key, symbol`, [userId]),
    ]);
    const lists = {};
    for (const l of LEVELS) lists[l.key] = [];
    for (const r of rows) {
      if (!lists[r.level_key]) continue;
      lists[r.level_key].push({
        symbol: r.symbol,
        price: r.last_price == null ? null : Number(r.last_price),
        level: r.last_level == null ? null : Number(r.last_level),
        checkedAt: r.last_at_ms == null ? null : Number(r.last_at_ms),
        firedAt: r.fired_ms == null ? null : Number(r.fired_ms),
        fired: Number(r.fired_count || 0),
      });
    }
    let fires = [];
    if (since != null) {
      const f = await q(
        `SELECT key, symbol, title, text, (EXTRACT(EPOCH FROM at) * 1000)::bigint AS at_ms
           FROM vela_alerts
          WHERE user_id = ? AND day = ${TODAY} AND meta = 'Level list'
            AND at > to_timestamp(?::double precision / 1000.0)
          ORDER BY at ASC LIMIT 50`,
        [userId, since],
      );
      fires = f.map((r) => ({ key: r.key, symbol: r.symbol, title: r.title, text: r.text, at: Number(r.at_ms) }));
    }
    return { prefs: prefsOut(prefRows[0]), lists, fires, levels: LEVELS, now: Date.now() };
  }

  register('/api/vela/alert-lists', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res, ctx, verdict) {
      const userId = String(verdict?.userId || '').trim();
      if (!userId) return send(res, 400, { error: 'no account on this request' });
      try {
        await ensure();
        if (req.method === 'GET') {
          const sp = new URL(req.url || '/', 'http://localhost').searchParams;
          const s = Number(sp.get('since'));
          return send(res, 200, await readAll(userId, Number.isFinite(s) && s > 0 ? s : null), { 'Cache-Control': 'no-store' });
        }
        const b = (await readJson(req, 16 * 1024).catch(() => null)) || {};
        const action = String(b.action || '');
        const level = String(b.level || '');
        if (action === 'add') {
          if (!LEVEL_BY_KEY.has(level)) return send(res, 400, { error: 'unknown level' });
          const syms = [...new Set((Array.isArray(b.symbols) ? b.symbols : [b.symbol]).map(cleanSymbol).filter(Boolean))];
          if (!syms.length) return send(res, 400, { error: 'no valid tickers' });
          const [{ n: inList }] = await q('SELECT count(*)::int AS n FROM vela_alert_lists WHERE user_id = ? AND level_key = ?', [userId, level]);
          const [{ n: total }] = await q('SELECT count(*)::int AS n FROM vela_alert_lists WHERE user_id = ?', [userId]);
          const room = Math.max(0, Math.min(MAX_SYMBOLS_PER_LIST - inList, MAX_ROWS_PER_USER - total));
          const take = syms.slice(0, room);
          for (const s of take) {
            await q('INSERT INTO vela_alert_lists (user_id, level_key, symbol) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [userId, level, s]);
          }
          const out = await readAll(userId, null);
          return send(res, 200, { ok: true, added: take, skipped: syms.slice(take.length), ...out }, { 'Cache-Control': 'no-store' });
        }
        if (action === 'remove') {
          const s = cleanSymbol(b.symbol);
          if (!LEVEL_BY_KEY.has(level) || !s) return send(res, 400, { error: 'level and symbol required' });
          await q('DELETE FROM vela_alert_lists WHERE user_id = ? AND level_key = ? AND symbol = ?', [userId, level, s]);
          return send(res, 200, { ok: true, ...(await readAll(userId, null)) }, { 'Cache-Control': 'no-store' });
        }
        if (action === 'clear') {
          if (!LEVEL_BY_KEY.has(level)) return send(res, 400, { error: 'unknown level' });
          await q('DELETE FROM vela_alert_lists WHERE user_id = ? AND level_key = ?', [userId, level]);
          return send(res, 200, { ok: true, ...(await readAll(userId, null)) }, { 'Cache-Control': 'no-store' });
        }
        if (action === 'prefs') {
          const cur = (await q('SELECT * FROM vela_alert_list_prefs WHERE user_id = ?', [userId]))[0] || {};
          let cooldown = b.cooldownMin != null ? Math.round(Number(b.cooldownMin)) : Number(cur.cooldown_min ?? COOLDOWN_DEFAULT);
          if (!Number.isFinite(cooldown)) cooldown = COOLDOWN_DEFAULT;
          cooldown = Math.max(COOLDOWN_MIN, Math.min(COOLDOWN_MAX, cooldown));
          const basis = BASES.has(b.gexBasis) ? b.gexBasis : (BASES.has(cur.gex_basis) ? cur.gex_basis : 'vol');
          const coil = typeof b.coil === 'boolean' ? b.coil : cur.coil !== false;
          const paused = typeof b.paused === 'boolean' ? b.paused : cur.paused === true;
          let webhook = cur.webhook ?? null;
          if (b.webhook === '' || b.webhook === null) webhook = null;
          else if (typeof b.webhook === 'string') {
            if (!isHook(b.webhook.trim())) return send(res, 400, { error: 'that is not a Discord webhook URL' });
            webhook = b.webhook.trim();
          }
          await q(
            `INSERT INTO vela_alert_list_prefs (user_id, cooldown_min, gex_basis, coil, webhook, paused, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())
             ON CONFLICT (user_id) DO UPDATE SET cooldown_min = EXCLUDED.cooldown_min, gex_basis = EXCLUDED.gex_basis,
               coil = EXCLUDED.coil, webhook = EXCLUDED.webhook, paused = EXCLUDED.paused, updated_at = NOW()`,
            [userId, cooldown, basis, coil, webhook, paused],
          );
          return send(res, 200, { ok: true, ...(await readAll(userId, null)) }, { 'Cache-Control': 'no-store' });
        }
        if (action === 'test') {
          const cur = (await q('SELECT webhook FROM vela_alert_list_prefs WHERE user_id = ?', [userId]))[0];
          if (!cur?.webhook) return send(res, 400, { error: 'no Discord webhook saved' });
          await postDiscord(cur.webhook, '🔔 Vela alert lists are connected. List alerts will post here.');
          return send(res, 200, { ok: true });
        }
        return send(res, 400, { error: 'unknown action' });
      } catch (e) {
        return send(res, 500, { error: String(e?.message || e).slice(0, 200) });
      }
    },
  });
  return 1;
}

/* ── the watcher ───────────────────────────────────────────────────────────── */

function internalHeaders() {
  return process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {};
}

async function getJson(base, path, ms = 15_000) {
  const r = await fetch(`${base}${path}`, { headers: internalHeaders(), signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${path.split('?')[0]} ${r.status}`);
  return r.json();
}

/** One symbol's price and every level, on one GEX book. Cached for a tick. */
async function readSymbol(base, symbol, basis, coil, cache) {
  const r = resolveSym(symbol);
  const barsKey = `bars|${r.key}`;
  if (!cache.has(barsKey)) {
    const path = r.fut
      ? `/api/snapshots/candles?daysBack=5&limit=20000&interval=5&lite=1${r.fut === 'NQ' ? '&symbol=NQ' : ''}`
      : `/api/snapshots/etf-candles?symbol=${encodeURIComponent(r.key)}&days=4&interval=5&limit=8000`;
    cache.set(barsKey, getJson(base, path).then(parseBars).catch(() => []));
  }
  let bars = await cache.get(barsKey);
  // the index chart is regular hours only (levelAlerts.ts asks 'regular' for an index)
  if (r.kind === 'index') bars = bars.filter((b) => isRth(b.time));
  const newest = bars[bars.length - 1];
  const price = newest ? newest.close : null;
  const live = !!newest && Date.now() - newest.time < STALE_BAR_MS;
  const levels = sessionLevels(bars, !!r.fut);

  const chainTicker = r.fut === 'NQ' ? 'NDX' : r.fut === 'ES' ? 'SPX' : r.key;
  const chainKey = `chain|${chainTicker}`;
  if (!cache.has(chainKey)) {
    cache.set(chainKey, getJson(base, `/api/chains?ticker=${encodeURIComponent(chainTicker)}&range=all&live=0&front=1&slim=1`, 20_000).catch(() => null));
  }
  let shift = 0;
  if (r.fut) {
    const bKey = `basis|${r.fut}`;
    if (!cache.has(bKey)) {
      const url = r.fut === 'NQ' ? '/proxy/nq-ndx-basis' : '/proxy/es-spx-basis';
      cache.set(bKey, getJson(base, url).catch(() => null));
    }
    const bj = await cache.get(bKey);
    const max = r.fut === 'NQ' ? 600 : 250;
    const b = Number(bj?.basis);
    shift = Number.isFinite(b) && b > 0 && b < max ? b : NaN;
  }
  const chain = await cache.get(chainKey);
  const g = chain ? gexLevels(chain, price, basis, coil, shift) : null;
  if (g) Object.assign(levels, g);
  return { price, live, levels, at: newest?.time ?? null };
}

const fmt = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inSentence = (n) => (/^(Volt|Coil|Reversal|Surge|Flip|IB)\b/.test(n) ? n : n.charAt(0).toLowerCase() + n.slice(1));
const MARK = { volt: '★', reversal: '↘', surge: '↯', coil: '◆', flip: '⚡︎' };

async function tick(base, store) {
  await store.ensure();
  const rows = await store.q(
    `SELECT l.user_id, l.level_key, l.symbol, l.last_price,
            (EXTRACT(EPOCH FROM l.last_at) * 1000)::bigint AS last_at_ms,
            (EXTRACT(EPOCH FROM l.last_fired_at) * 1000)::bigint AS fired_ms,
            COALESCE(p.cooldown_min, ${COOLDOWN_DEFAULT}) AS cooldown_min,
            COALESCE(p.gex_basis, 'vol') AS gex_basis,
            COALESCE(p.coil, TRUE) AS coil,
            p.webhook
       FROM vela_alert_lists l
       LEFT JOIN vela_alert_list_prefs p ON p.user_id = l.user_id
      WHERE COALESCE(p.paused, FALSE) = FALSE`,
  );
  if (!rows.length) return { rows: 0, rang: 0 };
  const cache = new Map();
  const reads = new Map();
  let rang = 0;
  for (const row of rows) {
    const basis = BASES.has(row.gex_basis) ? row.gex_basis : 'vol';
    const coil = row.coil !== false;
    const rk = `${row.symbol}|${basis}|${coil ? 1 : 0}`;
    if (!reads.has(rk)) reads.set(rk, readSymbol(base, row.symbol, basis, coil, cache).catch(() => null));
    const read = await reads.get(rk);
    if (!read || !read.live || !(read.price > 0)) continue; // market shut or no data: leave the last reading alone
    const level = read.levels[row.level_key];
    const now = Date.now();
    const d = decide({
      prevPrice: row.last_price == null ? null : Number(row.last_price),
      prevAt: row.last_at_ms == null ? null : Number(row.last_at_ms),
      price: read.price,
      level: level == null ? null : Number(level),
      now,
      lastFiredAt: row.fired_ms == null ? null : Number(row.fired_ms),
      cooldownMin: Number(row.cooldown_min),
    });
    if (d.ring) {
      rang++;
      const lv = LEVEL_BY_KEY.get(row.level_key);
      const title = `${lv.name} crossed ${d.dir}`;
      const text = `${row.symbol} ${fmt(read.price)} crossed the ${inSentence(lv.name)} at ${fmt(level)}.`;
      // the bell's own key shape (alertBell.ts fromScript) so an open tab that
      // re-delivers this fire writes nothing twice
      const key = `levels|${row.symbol}|${title}|${now}`;
      await store.q(
        `INSERT INTO vela_alerts (user_id, day, at, key, kind, symbol, title, text, meta)
         VALUES (?, (NOW() AT TIME ZONE 'America/New_York')::date, to_timestamp(?::double precision / 1000.0), ?, 'level', ?, ?, ?, 'Level list')
         ON CONFLICT (user_id, day, key) DO NOTHING`,
        [row.user_id, now, key, row.symbol, title, text],
      ).catch((e) => console.warn('[alert-lists] bell write failed:', e.message));
      await store.q(
        `UPDATE vela_alert_lists SET last_fired_at = NOW(), fired_count = fired_count + 1
          WHERE user_id = ? AND level_key = ? AND symbol = ?`,
        [row.user_id, row.level_key, row.symbol],
      );
      if (row.webhook) {
        const mark = MARK[row.level_key] ? `${MARK[row.level_key]} ` : '';
        postDiscord(row.webhook, `**${row.symbol} · ${mark}${title}**\n${text}`).catch((e) =>
          console.warn('[alert-lists] discord failed:', e.message));
      }
    }
    await store.q(
      `UPDATE vela_alert_lists SET last_price = ?, last_level = ?, last_at = to_timestamp(?::double precision / 1000.0)
        WHERE user_id = ? AND level_key = ? AND symbol = ?`,
      [read.price, level == null ? null : Number(level), now, row.user_id, row.level_key, row.symbol],
    );
  }
  return { rows: rows.length, rang };
}

function startVelaAlertListWatcher(port, { libDb } = {}) {
  const db = libDb || require('./_lib-db.cjs');
  const store = makeStore(db);
  const base = `http://127.0.0.1:${port}`;
  let busy = false;
  const run = async () => {
    // Saturday, and Sunday before the futures open, nothing trades
    const wd = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
    if (wd === 'Sat' || (wd === 'Sun' && etMinutesOfDay(Date.now()) < 18 * 60)) return;
    if (busy) return; // a slow tick never stacks
    busy = true;
    try {
      const r = await tick(base, store);
      if (r.rang) console.log(`[alert-lists] ${r.rang} alert(s) rang across ${r.rows} watched row(s)`);
    } catch (e) {
      console.warn('[alert-lists] tick failed, retrying next minute:', e.message);
    } finally {
      busy = false;
    }
  };
  console.log('[alert-lists] watcher on · every 60s');
  setTimeout(run, 25_000);
  const timer = setInterval(run, TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = {
  registerVelaAlertListRoutes,
  startVelaAlertListWatcher,
  // pure pieces, for vela-alert-lists.selftest.js
  __tick: (base, libDb) => tick(base, makeStore(libDb || require('./_lib-db.cjs'))),
  _test: { decide, sessionLevels, vtFromLadder, flipOf, strikeGex, parseFrontChain, gexLevels, cleanSymbol, parseBars, isHook },
};
