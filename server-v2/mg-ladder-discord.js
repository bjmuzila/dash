'use strict';
/**
 * server-v2/mg-ladder-discord.js
 *
 * Posts the Multi Greek LADDERS snapshot — SPX / SPY / QQQ front-expiry
 * CB / CW / PW with the spot marker — to Discord every 15 minutes during RTH.
 *
 * This is the scheduled twin of the 🗒 LADDERS button in the /mult-greek dock
 * (components/dashboard/MultiGreekLevelSnapshot.tsx). The drawing code below is
 * a PORT OF THAT FILE'S canvas renderer, kept deliberately line-for-line so the
 * scheduled image and the hand-clicked one are the same picture. If the ladder
 * render changes there, change it here — DRAW_SRC is the only copy.
 *
 * Why a headless browser at all, when nothing here needs a DOM: the renderer is
 * pure Canvas2D, and Chromium is the only canvas already in the image (the
 * Dockerfile ships /usr/bin/chromium for budget-email.js). Rendering inside it
 * means zero new dependencies — no node-canvas, no native build step on the
 * deploy box. The page it loads is the PUBLIC landing route, purely so
 * getComputedStyle(document.body).fontFamily resolves next/font's hashed Inter
 * family exactly as it does for the in-app button. No auth, no data fetching
 * happens in the browser: the rows are computed here in Node and passed in.
 *
 * Levels are derived through the same math the page uses:
 *   net GEX per strike = (|Γcall|·(OI+VOL) − |Γput|·(OI+VOL)) · spot² · 0.01 · 100
 *   CB = highest |net|,  CW = highest +net (excluding CB),  PW = lowest −net (excl. CB)
 * — i.e. strikeGex() + computeWalls() from MultGreekClient.tsx, over the FULL
 * chain (no ±N strike window; the page's walls are untrimmed).
 *
 * Channel: the CB Edge Signals channel — the same one discord-relay.js and
 * signals-engine.js post to. Resolution order is HOME_SIGNALS_DISCORD_WEBHOOK →
 * SIGNALS_DISCORD_WEBHOOK (whichever of the two is set; they normally point at
 * the same channel) and only then DISCORD_WEBHOOK_URL, which is the in-app
 * button's webhook and a DIFFERENT channel. Set MG_LADDER_DISCORD_WEBHOOK to
 * override all of it.
 *
 * SETTINGS LIVE IN THE OWNER PAGE (owner → BOT → Scheduled, job `mg-ladder`).
 * On/off, window start/end, interval, days, bot channel or webhook, identity
 * and the message line come from server-v2/scheduled-posts-store.js and are
 * re-read every minute — no restart. The webhook env chain above is the
 * store's fallback when the row has no webhook of its own, so a box that has
 * never opened the page keeps posting exactly where it always did.
 *
 * Env (fallback / operational only):
 *   MG_LADDER_DISCORD_WEBHOOK  webhook fallback chain head (then HOME_SIGNALS_…,
 *                              SIGNALS_…, DISCORD_WEBHOOK_URL)
 *   MG_LADDER_DISCORD_CHANNEL_ID  bot-channel fallback
 *   MG_LADDER_DISABLED=1       hard-disable, whatever the page says
 *   MG_LADDER_TICKERS          default "SPX,SPY,QQQ"
 *   MG_LADDER_INTERVAL_MIN     only honoured when the settings table is down
 *   MG_LADDER_GRACE_MIN        how late a slot may still post, default 3
 *   PUPPETEER_EXECUTABLE_PATH  /usr/bin/chromium in Docker
 *   INTERNAL_API_TOKEN         forwarded to the local proxy like every recorder
 *
 * Start from server-with-proxy.js after server.listen():
 *   require('./mg-ladder-discord').startMgLadderDiscord(PORT);
 *
 * Never throws out of a tick — a bad 15 minutes just logs and waits for the next.
 */

const TICKERS = (process.env.MG_LADDER_TICKERS || 'SPX,SPY,QQQ')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const store = require('./scheduled-posts-store');
const bot = require('./discord-bot-poster');

const JOB_ID = 'mg-ladder';
const GRACE_MIN = Math.max(0, Number(process.env.MG_LADDER_GRACE_MIN || 3));
const CHROME_PATH = (process.env.PUPPETEER_EXECUTABLE_PATH || '').trim();

// Shared identity with discord-relay.js / signals-engine.js so everything the
// app posts renders as ONE bot in the channel.
const SITE_URL = (process.env.SIGNALS_SITE_URL || 'https://cbedge.net').replace(/\/+$/, '');
const DISCORD_USERNAME = 'CB Edge Signals';
const DISCORD_AVATAR = `${SITE_URL}/cb-edge-logo.png`;

// ── Config ──────────────────────────────────────────────────────────────────

/**
 * The owner page is the source of truth. MG_LADDER_INTERVAL_MIN is read ONLY
 * when the settings table is unreachable, so a stale VPS env var can never
 * outrank what the page shows.
 */
async function readConfig() {
  const job = await store.getJob(JOB_ID);
  if (!job) throw new Error(`scheduled-posts has no job "${JOB_ID}"`);
  if (job.live) return job;
  return {
    ...job,
    intervalMin: store.normalizeInterval(process.env.MG_LADDER_INTERVAL_MIN, job.intervalMin),
  };
}

// ── ET helpers (same shape as every other server-v2 recorder) ────────────────

function nowParts() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

const toMins = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return h * 60 + m; };

/**
 * The slot "now" belongs to, or null when outside the window / off-day.
 * Slots are start, start+N, … while < end. `late` is minutes past the slot.
 */
function currentSlot(cfg) {
  const { hour, minute, weekday } = nowParts();
  const day = String(weekday || '').slice(0, 3).toLowerCase();
  if (!String(cfg.days || '').split(',').includes(day)) return null;
  const start = toMins(cfg.postAt);
  const end = toMins(cfg.endAt);
  const every = Math.max(1, Number(cfg.intervalMin) || 15);
  const mins = (hour % 24) * 60 + minute;
  if (!(mins >= start && mins < end)) return null;
  const slot = start + Math.floor((mins - start) / every) * every;
  const hh = String(Math.floor(slot / 60)).padStart(2, '0');
  const mm = String(slot % 60).padStart(2, '0');
  return { key: `${todayETStr()} ${hh}:${mm}`, late: mins - slot };
}

function etLongDate() {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function todayETStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // YYYY-MM-DD
}

function daysTo(dateStr) {
  return Math.round((new Date(dateStr).getTime() - new Date(todayETStr()).getTime()) / 86400000);
}

function etClock() {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function fileStamp() {
  const d = new Date();
  const date = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
  const time = d.toLocaleTimeString('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(':', '');
  return `${date}-${time}`;
}

// ── Levels (mirrors MultGreekClient loadExpirations → strikeGex → computeWalls)

function internalHeaders(extra = {}) {
  return Object.assign({}, extra,
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {});
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store', headers: internalHeaders() });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

/** Keep-filter the client uses: within 7 DTE, or weekly/monthly, or any Friday. */
function expiryList(items) {
  const seen = new Set();
  const list = [];
  (items || []).forEach((item) => {
    const d = String(item['expiration-date'] ?? '');
    if (!d || seen.has(d)) return;
    seen.add(d);
    const dt = daysTo(d);
    if (dt < 0) return;
    const t = String(item['expiration-type'] ?? '').toLowerCase();
    const keep = dt <= 7 || t === 'weekly' || t === 'monthly' || new Date(`${d}T12:00:00`).getDay() === 5;
    if (!keep) return;
    list.push({ date: d, daysTo: dt });
  });
  list.sort((a, b) => a.daysTo - b.daysTo);
  return list;
}

async function expiriesFor(base, ticker) {
  try {
    const j = await fetchJson(`${base}/proxy/api/tt/expirations/${encodeURIComponent(ticker)}`);
    const l = expiryList(j?.data?.items ?? []);
    if (l.length) return l;
  } catch { /* fall through to the chain-derived list */ }
  try {
    const j = await fetchJson(`${base}/proxy/api/tt/chains/${encodeURIComponent(ticker)}?range=all`);
    return expiryList(j?.data?.items ?? []);
  } catch { return []; }
}

/** Per-strike NET GEX over the WHOLE chain, OI+VOL basis — strikeGex()'s default. */
function netGexByStrike(items, spot, basis = 'oi+vol') {
  const out = [];
  for (const grp of (items || [])) {
    for (const s of (grp.strikes || [])) {
      const strike = Number(s['strike-price']);
      if (!(strike > 0)) continue;
      const c = s.call || {}, p = s.put || {};
      const cg = Math.abs(Number(c.gamma) || 0), pg = Math.abs(Number(p.gamma) || 0);
      // basis 'vol' = today's volume only (Voltick "Surge"); default OI+VOL.
      const withOi = basis !== 'vol';
      const cc = (withOi ? Number(c['open-interest']) || 0 : 0) + (Number(c.volume) || 0);
      const pc = (withOi ? Number(p['open-interest']) || 0 : 0) + (Number(p.volume) || 0);
      const net = (cg * cc - pg * pc) * spot * spot * 0.01 * 100;
      if (!Number.isFinite(net)) continue;
      out.push({ strike, net });
    }
  }
  return out;
}

/**
 * Chain totals — matched to the v3 Key Levels "Stats" copy button
 * (cbedge-v3/src/board/keyLevels/statsShot.ts), which sums the ladder on the
 * VOL-ONLY basis (netVolGEX / volNetDEX from computation/gex-calculator.js):
 *   net GEX = Σ (|Γc|·volC − |Γp|·volP) · spot²
 *   net DEX = Σ (Δc·volC − |Δp|·volP) · spot · 100
 * Over the front expiry — the same ladder the card reads.
 */
function chainTotals(items, spot) {
  let gex = 0, dex = 0;
  for (const grp of (items || [])) {
    for (const s of (grp.strikes || [])) {
      const c = s.call || {}, p = s.put || {};
      const qc = Number(c.volume) || 0;
      const qp = Number(p.volume) || 0;
      const g = (Math.abs(Number(c.gamma) || 0) * qc - Math.abs(Number(p.gamma) || 0) * qp) * spot * spot;
      const d = ((Number(c.delta) || 0) * qc - Math.abs(Number(p.delta) || 0) * qp) * spot * 100;
      if (Number.isFinite(g)) gex += g;
      if (Number.isFinite(d)) dex += d;
    }
  }
  return { netGex: gex, netDex: dex };
}

/**
 * Per-strike books in VOLTICK's convention (Voltick repo, server/engine.js ·
 * GEX-METHOD.md): one gamma per strike times the NET position, 1%-move dollars.
 *   oi  = Γ × (callOI − putOI) × 100 × S² × 0.01      — the standing book
 *   vol = Γ × (callVol − putVol) × 100 × S² × 0.01    — today's traded contracts
 * Γ is the same for a call and put at one strike under Black-Scholes; the chain's
 * two values are averaged (whichever side is present if only one is).
 */
function strikeBooks(items, spot) {
  const byK = new Map();
  const dollar = 100 * spot * spot * 0.01;
  for (const grp of (items || [])) {
    for (const s of (grp.strikes || [])) {
      const strike = Number(s['strike-price']);
      if (!(strike > 0)) continue;
      const c = s.call || {}, p = s.put || {};
      const gs = [Math.abs(Number(c.gamma) || 0), Math.abs(Number(p.gamma) || 0)].filter((g) => g > 0);
      const g = gs.length ? gs.reduce((a, b) => a + b, 0) / gs.length : 0;
      const netOI = (Number(c['open-interest']) || 0) - (Number(p['open-interest']) || 0);
      const netVol = (Number(c.volume) || 0) - (Number(p.volume) || 0);
      const cur = byK.get(strike) || { strike, oi: 0, vol: 0 };
      cur.oi += g * netOI * dollar;
      cur.vol += g * netVol * dollar;
      byK.set(strike, cur);
    }
  }
  return [...byK.values()].filter((r) => Number.isFinite(r.oi) && Number.isFinite(r.vol)).sort((a, b) => a.strike - b.strike);
}

/**
 * PORT of Voltick's marksOf() (server/engine.js) — the definitions its Key
 * Levels card draws — run on the OI column, plus its headline Surge.
 *   Volt ★     = the single biggest |oi| strike (the king)
 *   Reversal ↘ = the opposite-sign pole, each candidate's size weighted by its
 *                THICK-SHELF support (opposite-sign neighbours ≥ 40% its size
 *                within 2.5 strike steps); nodes under 5% of the Volt ignored.
 *                revWeight 0.18 = Voltick's default before its nightly grading.
 *   Coil ◆     = other strikes ≥ half the Volt, Volt and Reversal excluded,
 *                heaviest first (Voltick keeps 5; the card shows the first)
 *   Surge ↯    = the live magnet: biggest |vol| on the nearest expiration.
 *                Voltick prefers its own classified TAPE flow when it has it and
 *                falls back to exactly this volume read, so on a heavy-tape day
 *                the two can differ.
 */
const REV_WEIGHT = 0.18;

function voltickFromBooks(rows) {
  let volt = null, voltAbs = 0;
  for (const r of rows) if (Math.abs(r.oi) > voltAbs) { voltAbs = Math.abs(r.oi); volt = r; }
  const voltSign = volt ? Math.sign(volt.oi) : 0;

  let step = Infinity;
  for (let a = 1; a < rows.length; a++) { const d = rows[a].strike - rows[a - 1].strike; if (d > 0 && d < step) step = d; }
  const clusterWin = (step === Infinity ? 1 : step) * 2.5;

  let reversal = null, revBest = -Infinity;
  for (const r of rows) {
    if (voltSign === 0 || Math.sign(r.oi) !== -voltSign) continue;
    const size = Math.abs(r.oi);
    if (size < 0.05 * voltAbs) continue;
    let cluster = 0;
    for (const r2 of rows) {
      if (r2 !== r && Math.abs(r2.strike - r.strike) <= clusterWin
          && Math.sign(r2.oi) === -voltSign && Math.abs(r2.oi) >= 0.4 * size) cluster++;
    }
    const score = size * (1 + REV_WEIGHT * Math.min(cluster, 3));
    if (score > revBest) { revBest = score; reversal = r; }
  }

  const coils = rows
    .filter((r) => volt && r !== volt && r !== reversal && voltAbs > 0 && Math.abs(r.oi) >= 0.5 * voltAbs)
    .sort((a, b) => Math.abs(b.oi) - Math.abs(a.oi))
    .slice(0, 5)
    .map((r) => r.strike);

  let surge = null, surgeAbs = 0;
  for (const r of rows) if (Math.abs(r.vol) > surgeAbs) { surgeAbs = Math.abs(r.vol); surge = r; }

  return {
    volt: volt?.strike ?? null,
    surge: surge?.strike ?? null,
    reversal: reversal?.strike ?? null,
    coil: coils[0] ?? null,
    coils,
  };
}

/** computeWalls(): CB = max |net|; CW = max +net excluding CB; PW = min −net excluding CB. */
function computeWalls(rows) {
  let cb = null, cbAbs = -1, cbNet = 0;
  rows.forEach((r) => { const a = Math.abs(r.net); if (a > cbAbs) { cbAbs = a; cb = r.strike; cbNet = r.net; } });
  const pos = rows.filter((r) => r.net > 0).sort((a, b) => b.net - a.net);
  const neg = rows.filter((r) => r.net < 0).sort((a, b) => a.net - b.net);
  const cw = pos.find((r) => r.strike !== cb)?.strike ?? null;
  const pw = neg.find((r) => r.strike !== cb)?.strike ?? null;
  return { cb, cw, pw, cbNet };
}

/**
 * One SnapshotRow per ticker: { ticker, spot, expiration, cb, cw, pw }.
 *
 * Front expiry is SPX-anchored exactly like the page: SPX picks 0DTE if it has
 * one (else its nearest), and every other ticker takes its OWN first expiry at
 * or after that date — which is why SPY/QQQ can legitimately show a different
 * date from SPX on a day SPX has a 0DTE they don't.
 */
async function buildRows(base) {
  const spxList = await expiriesFor(base, 'SPX');
  const anchor = (spxList.find((e) => e.daysTo === 0) ?? spxList[0])?.date ?? null;

  const rows = [];
  for (const ticker of TICKERS) {
    try {
      const list = ticker === 'SPX' ? spxList : await expiriesFor(base, ticker);
      const front = (anchor ? list.find((e) => e.date >= anchor) : null)?.date ?? list[0]?.date ?? anchor;
      if (!front) { console.log(`[mg-ladder] ${ticker} — no expiry resolved`); continue; }

      const j = await fetchJson(`${base}/proxy/api/tt/chains/${encodeURIComponent(ticker)}?expiration=${encodeURIComponent(front)}&range=all`);
      const all = j?.data?.items ?? [];
      const filtered = all.filter((i) => String(i['expiration-date'] ?? '').slice(0, 10) === front.slice(0, 10));
      const items = filtered.length ? filtered : all;
      const spot = Number(j?.data?.underlyingPrice ?? 0) || 0;
      if (!(spot > 0) || !items.length) { console.log(`[mg-ladder] ${ticker} — empty chain at ${front}`); continue; }

      const { cb, cw, pw, cbNet } = computeWalls(netGexByStrike(items, spot));
      // Voltick "Surge": the core recomputed on VOLUME only.
      const surge = computeWalls(netGexByStrike(items, spot, 'vol')).cb;
      const { netGex, netDex } = chainTotals(items, spot);
      const voltick = voltickFromBooks(strikeBooks(items, spot));
      rows.push({ ticker, spot, expiration: front, cb, cw, pw, cbNet, surge, netGex, netDex, voltick });
    } catch (e) {
      console.log(`[mg-ladder] ${ticker} levels failed — ${e.message}`);
    }
  }
  return rows;
}

// ── Renderer ────────────────────────────────────────────────────────────────
//
// PORT of components/dashboard/MultiGreekLevelSnapshot.tsx (LADDERS view only),
// stringified so it can run inside the page. Theme values are inlined from
// components/shared/homeTheme.ts — the one place in this repo where hex is
// written by hand rather than imported, because a .ts module cannot be required
// from a CommonJS recorder. Keep them in sync with homeTheme:
//   HOME_THEME.bg #05060A · .panel #0D1119 · .cyan #219EBC · .text #FFFFFF
//   .border rgba(255,255,255,0.10) · LEVEL_COLORS cb #ffd600 cw #29b6f6 pw #ff4757
//   LIGHT_BLUE #7dd3fc · SOFT_RED #f4948e · REFRESH_GREEN #1FD98A

const DRAW_SRC = String(function drawLaddersPng(rows) {
  const HT = { bg: '#05060A', panel: '#0D1119', cyan: '#219EBC', text: '#FFFFFF', border: 'rgba(255,255,255,0.10)' };
  const LEVEL_COLORS = { cb: '#ffd600', cw: '#29b6f6', pw: '#ff4757' };
  const LIGHT_BLUE = '#7dd3fc';
  const SOFT_RED = '#f4948e';
  const REFRESH_GREEN = '#1FD98A';
  const INK = HT.text;

  const DPR = 2;
  const PAD = 22, HEAD_H = 34, FOOT_H = 36;
  const L_W = 1240, L_GAP = 14, L_TRACK_H = 216, L_TILE_H = 300;

  let FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";
  try { const f = getComputedStyle(document.body).fontFamily; if (f) FONT = f; } catch (e) { /* detached */ }

  function rrect(c, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad);
    c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad);
    c.arcTo(x, y, x + w, y, rad);
    c.closePath();
  }

  function txt(c, s, x, y, opts) {
    const o = opts || {};
    const size = o.size == null ? 13 : o.size;
    const weight = o.weight == null ? 600 : o.weight;
    const color = o.color || INK;
    const align = o.align || 'left';
    const track = o.track || 0;
    c.font = weight + ' ' + size + 'px ' + FONT;
    c.fillStyle = color;
    c.textBaseline = 'middle';
    if (!track) { c.textAlign = align; c.fillText(s, x, y); return; }
    const chars = Array.from(s);
    const w = chars.reduce((a, ch) => a + c.measureText(ch).width + track, -track);
    let cx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    c.textAlign = 'left';
    chars.forEach((ch) => { c.fillText(ch, cx, y); cx += c.measureText(ch).width + track; });
  }

  const fmtLvl = (v) => (v == null || !isFinite(v)) ? '--' : (Number.isInteger(v) ? String(v) : v.toFixed(2));
  const fmtSpot = (v) => (!isFinite(v) || v <= 0) ? '--'
    : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function dteOf(iso) {
    if (!iso) return null;
    const d = new Date(iso + 'T16:00:00-04:00').getTime();
    if (!isFinite(d)) return null;
    return Math.max(0, Math.round((d - Date.now()) / 86400000));
  }

  function stampNow() {
    const d = new Date();
    const day = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' }).toUpperCase();
    const date = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const time = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
    return day + ' ' + date + ' · ' + time + ' ET';
  }

  function drawShell(c, w, h) {
    c.fillStyle = HT.bg;
    c.fillRect(0, 0, w, h);
    const glow = c.createRadialGradient(w / 2, 0, 0, w / 2, 0, h * 0.9);
    glow.addColorStop(0, 'rgba(33,158,188,0.07)');
    glow.addColorStop(1, 'rgba(33,158,188,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = HT.border;
    c.lineWidth = 1;
    rrect(c, 0.5, 0.5, w - 1, h - 1, 18);
    c.stroke();
  }

  function drawHeader(c, w) {
    const y = PAD + 10;
    c.fillStyle = HT.cyan;
    rrect(c, PAD, y - 4, 8, 8, 2);
    c.fill();
    txt(c, 'CB EDGE · MULTI GREEK', PAD + 17, y, { size: 11, weight: 700, track: 1.9 });
    txt(c, stampNow(), w - PAD, y, { size: 10.5, weight: 600, align: 'right', track: 0.8 });
  }

  function drawFooter(c, w, y) {
    c.strokeStyle = HT.border;
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(PAD, y + 0.5); c.lineTo(w - PAD, y + 0.5); c.stroke();

    const ly = y + 18;
    const legend = [
      ['CB · CORE BULLSEYE', LEVEL_COLORS.cb],
      ['CW · CALL WALL', LEVEL_COLORS.cw],
      ['PW · PUT WALL', LEVEL_COLORS.pw],
    ];
    let x = PAD;
    legend.forEach((pair) => {
      const label = pair[0], color = pair[1];
      c.fillStyle = color;
      rrect(c, x, ly - 4, 8, 8, 2);
      c.fill();
      txt(c, label, x + 14, ly, { size: 9.5, weight: 700, track: 1.2 });
      c.font = '700 9.5px ' + FONT;
      x += 14 + Array.from(label).reduce((a, ch) => a + c.measureText(ch).width + 1.2, 0) + 18;
    });
    txt(c, 'CBEDGE.NET', w - PAD, ly, { size: 9.5, weight: 700, color: HT.cyan, align: 'right', track: 1.1 });
  }

  function drawLadderTile(c, r, x, y, w) {
    c.fillStyle = 'rgba(13,17,25,0.45)';
    rrect(c, x, y, w, L_TILE_H, 16);
    c.fill();
    c.strokeStyle = HT.border;
    c.lineWidth = 1;
    rrect(c, x + 0.5, y + 0.5, w - 1, L_TILE_H - 1, 16);
    c.stroke();

    const px = x + 15;
    const pw = w - 30;

    txt(c, r.ticker, px, y + 20, { size: 16, weight: 700, color: LIGHT_BLUE, track: 1.5 });
    const dte = dteOf(r.expiration);
    const sub = ((r.expiration || '').slice(5) || '--') + ' · ' + (dte == null ? '--' : dte + 'DTE');
    txt(c, sub, x + w - 15, y + 20, { size: 10, weight: 600, align: 'right', track: 0.7 });

    const tTop = y + 40;
    const tBot = tTop + L_TRACK_H;

    const vals = [r.cb, r.cw, r.pw, r.spot].filter((v) => v != null && isFinite(v));
    const lo = Math.min.apply(null, vals);
    const hi = Math.max.apply(null, vals);
    const span = (hi - lo) || 1;
    const yOf = (v) => tBot - (0.08 + ((v - lo) / span) * 0.84) * L_TRACK_H;

    const marks = [];
    if (r.cb != null) marks.push({ v: r.cb, tag: 'CB', color: LEVEL_COLORS.cb });
    if (r.cw != null) marks.push({ v: r.cw, tag: 'CW', color: LEVEL_COLORS.cw });
    if (r.pw != null) marks.push({ v: r.pw, tag: 'PW', color: LEVEL_COLORS.pw });

    const spotOk = isFinite(r.spot) && r.spot > 0;
    const sy = spotOk ? yOf(r.spot) : 0;
    if (spotOk) {
      c.save();
      c.setLineDash([5, 5]);
      c.strokeStyle = LIGHT_BLUE;
      c.globalAlpha = 0.7;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(px - 9, sy + 0.5);
      c.lineTo(px + pw + 6, sy + 0.5);
      c.stroke();
      c.restore();

      c.fillStyle = LIGHT_BLUE;
      c.beginPath();
      c.moveTo(px - 11, sy - 5);
      c.lineTo(px - 4, sy);
      c.lineTo(px - 11, sy + 5);
      c.closePath();
      c.fill();
    }

    marks.forEach((m) => {
      const my = yOf(m.v);
      c.globalAlpha = 0.45;
      c.fillStyle = m.color;
      c.fillRect(px, my - 0.75, pw, 1.5);
      c.globalAlpha = 1;

      c.font = '700 9.5px ' + FONT;
      const tw = Array.from(m.tag).reduce((a, ch) => a + c.measureText(ch).width + 0.9, 0) + 12;
      c.fillStyle = HT.panel;
      rrect(c, px, my - 8, tw, 16, 4);
      c.fill();
      c.strokeStyle = m.color;
      c.globalAlpha = 0.45;
      rrect(c, px + 0.5, my - 7.5, tw - 1, 15, 4);
      c.stroke();
      c.globalAlpha = 1;
      txt(c, m.tag, px + 6, my, { size: 9.5, weight: 700, color: m.color, track: 0.9 });

      c.font = '600 13.5px ' + FONT;
      const vs = fmtLvl(m.v);
      const vw = c.measureText(vs).width;
      c.fillStyle = HT.panel;
      c.fillRect(px + pw - vw - 6, my - 8, vw + 6, 16);
      txt(c, vs, px + pw, my, { size: 13.5, weight: 600, color: m.color, align: 'right' });
    });

    if (spotOk) {
      c.font = '700 13.5px ' + FONT;
      const ss = fmtSpot(r.spot);
      const sw = c.measureText(ss).width + 16;
      const sx = px + pw / 2 - sw / 2;
      c.fillStyle = HT.panel;
      rrect(c, sx, sy - 10, sw, 20, 5);
      c.fill();
      c.fillStyle = 'rgba(125,211,252,0.12)';
      rrect(c, sx, sy - 10, sw, 20, 5);
      c.fill();
      c.strokeStyle = 'rgba(125,211,252,0.45)';
      c.lineWidth = 1;
      rrect(c, sx + 0.5, sy - 9.5, sw - 1, 19, 5);
      c.stroke();
      txt(c, ss, px + pw / 2, sy, { size: 13.5, weight: 700, align: 'center' });
    }

    const fy = y + L_TILE_H - 22;
    c.strokeStyle = HT.border;
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(px, fy - 10.5); c.lineTo(px + pw, fy - 10.5); c.stroke();
    txt(c, 'SPOT VS CB', px, fy, { size: 9.5, weight: 700, track: 1.1 });
    if (r.cb != null && isFinite(r.spot)) {
      const d = r.spot - r.cb;
      const s = (d < 0 ? '−' : '+') + Math.abs(d).toFixed(2);
      txt(c, s, px + pw, fy, { size: 12, weight: 700, align: 'right', color: d < 0 ? SOFT_RED : REFRESH_GREEN });
    } else {
      txt(c, '--', px + pw, fy, { size: 12, weight: 700, align: 'right' });
    }
  }

  const w = L_W;
  const h = PAD + HEAD_H + 10 + L_TILE_H + 14 + FOOT_H + PAD - 12;
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * DPR);
  cv.height = Math.round(h * DPR);
  const c = cv.getContext('2d');
  if (!c) return null;
  c.scale(DPR, DPR);

  drawShell(c, w, h);
  drawHeader(c, w);
  const top = PAD + HEAD_H + 10;
  const inner = w - PAD * 2;
  const tileW = (inner - L_GAP * (rows.length - 1)) / rows.length;
  rows.forEach((r, i) => { drawLadderTile(c, r, PAD + i * (tileW + L_GAP), top, tileW); });
  drawFooter(c, w, top + L_TILE_H + 14);

  return cv.toDataURL('image/png');
});

/**
 * Draw the ladders in headless Chromium and return the PNG bytes.
 *
 * `base` is the LOCAL origin, so the font-priming navigation never leaves the
 * box. The route is the public landing page — it must stay reachable without a
 * session; if it ever becomes gated, point this at another public route rather
 * than minting a session, because nothing on the page is read but its font.
 */
async function renderPng(base, rows) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 });
      // Await the font set, but return a plain boolean — handing puppeteer the
      // FontFaceSet itself fails serialization and throws.
      await page.evaluate(async () => { try { await document.fonts.ready; } catch (e) { /* no font API */ } return true; });
    } catch (e) {
      // Font priming is a nicety, not a requirement — the renderer falls back to
      // the literal Inter stack and still produces a correct (if slightly
      // differently-metricked) image.
      console.log(`[mg-ladder] font priming skipped — ${e.message}`);
    }
    const dataUrl = await page.evaluate(`(${DRAW_SRC})(${JSON.stringify(rows)})`);
    if (!dataUrl) throw new Error('canvas render returned null');
    return Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64');
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── Discord ─────────────────────────────────────────────────────────────────

function renderMessage(template, summary) {
  return String(template || '📊 **Multi-Greek Ladders** — {time} ET · CB {summary}')
    .replace(/\{date\}/g, etLongDate())
    .replace(/\{time\}/g, etClock())
    .replace(/\{summary\}/g, summary);
}

/** Channel wins over webhook — same precedence scheduled-posts-store documents. */
async function postOwn(cfg, png, content, filename) {
  if (cfg.channelId) {
    await bot.postToChannel(cfg.channelId, { content, file: png, filename });
    return;
  }
  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    username: cfg.username || DISCORD_USERNAME,
    avatar_url: cfg.avatarUrl || DISCORD_AVATAR,
    content,
  }));
  form.append('files[0]', new Blob([png], { type: 'image/png' }), filename);

  const res = await fetch(cfg.webhookUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`webhook ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

// ── Tick ────────────────────────────────────────────────────────────────────

/**
 * One attempt. `force` (the page's "Post now") ignores the window. `slotKey`
 * is passed only by the scheduler and is what claims the slot on success, so
 * a manual post never eats a scheduled one. Always records the outcome.
 */
async function collectOnce(base, opts = {}) {
  let cfg = null;
  try {
    cfg = opts.config || (await readConfig());
    if (!(await store.hasDestination(cfg))) throw new Error('no destination configured (bot channel, webhook, or a Signals webhook on BOT → Manage)');
    if (!opts.force && !currentSlot(cfg)) return { ok: false, error: 'outside window' };

    const rows = await buildRows(base);
    if (!rows.length) throw new Error('no ladder rows resolved (chains empty?)');

    const png = await renderPng(base, rows);
    const summary = rows.map((r) => `${r.ticker} ${r.cb == null ? '--' : r.cb}`).join(' · ');
    const content = renderMessage(cfg.message, summary);
    const filename = `multigreek-ladders-${fileStamp()}.png`;
    // Own destination + every Signals webhook on BOT → Manage.
    const out = await store.deliver(cfg, {
      ownPost: () => postOwn(cfg, png, content, filename),
      content, file: png, filename,
      defaultUsername: cfg.username || DISCORD_USERNAME, defaultAvatar: cfg.avatarUrl || DISCORD_AVATAR,
    });
    console.log(`[mg-ladder] posted${opts.force ? ' (manual)' : ''} — ${rows.map((r) => r.ticker).join(',')} · +${out.fan.filter((r) => r.ok).length} signals (${Math.round(png.length / 1024)}KB)`);
    await store.markRun(JOB_ID, { status: out.warning ? 'partial' : 'ok', error: out.warning, postedDate: opts.slotKey || '' });
    return { ok: true, tickers: rows.map((r) => r.ticker) };
  } catch (e) {
    console.log(`[mg-ladder] post failed — ${e.message}`);
    await store.markRun(JOB_ID, { status: 'error', error: e.message });
    return { ok: false, error: e.message };
  }
}

function startMgLadderDiscord(port) {
  if (process.env.MG_LADDER_DISABLED === '1') {
    console.log('[mg-ladder] disabled via MG_LADDER_DISABLED=1');
    return () => {};
  }

  const base = `http://localhost:${port}`;
  console.log(`[mg-ladder] watcher up — settings from owner → BOT → Scheduled (job "${JOB_ID}"), checked every minute`);

  let stopped = false;
  let busy = false;
  let timer = null;
  // In-memory slot claim for when the settings table is unreachable.
  let lastSlotMem = '';

  // Re-arm to just after the next minute boundary so a slot minute is never
  // skipped by setInterval drift.
  function msToNextMinute() {
    const now = new Date();
    return (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 1500;
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const cfg = await readConfig();
      if (!cfg.enabled) return;
      if (!(await store.hasDestination(cfg))) return;
      const slot = currentSlot(cfg);
      if (!slot || slot.late > GRACE_MIN) return;
      if (slot.key === lastSlotMem) return;
      if (cfg.live && cfg.lastPostDate === slot.key) return;
      const res = await collectOnce(base, { config: cfg, slotKey: slot.key });
      if (res?.ok) lastSlotMem = slot.key;
    } catch (e) {
      console.log(`[mg-ladder] tick failed — ${e.message}`);
    } finally {
      busy = false;
    }
  }

  function arm() {
    if (stopped) return;
    timer = setTimeout(() => { void tick().finally(arm); }, msToNextMinute());
    if (typeof timer.unref === 'function') timer.unref();
  }
  arm();

  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

// ── Levels (text) — job `levels-text` ───────────────────────────────────────
//
// Same rows as the ladder picture, posted as a plain message at fixed ET times
// (default 09:45 and 10:30). No Chromium, no image.

const TEXT_JOB_ID = 'levels-text';

const fmtLvl = (v) => (v == null || !Number.isFinite(Number(v))) ? '--' : String(Number.isInteger(v) ? v : Number(v).toFixed(2));
const fmtSpot = (v) => (Number(v) > 0)
  ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';

/** -147200000000 -> "-$147.20B"; under a billion -> "-$812.40M". Sign always shown. */
function fmtBn(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '--';
  const sign = n < 0 ? '-' : '+';
  const a = Math.abs(n);
  return a >= 1e9 ? `${sign}$${(a / 1e9).toFixed(2)}B` : `${sign}$${(a / 1e6).toFixed(2)}M`;
}

// Tickers that get the FULL block. Everything else (SPY, QQQ) shows spot + Volt only.
const FULL_TICKERS = (process.env.VOLTICK_FULL_TICKERS || 'SPX')
  .split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);

function levelsText(rows) {
  return rows.map((r) => {
    const v = r.voltick || {};
    if (!FULL_TICKERS.includes(r.ticker)) {
      return [`**${r.ticker}** ${fmtSpot(r.spot)}`, `Volt: ${fmtLvl(v.volt)}`].join('\n');
    }
    return [
      `**${r.ticker}** ${fmtSpot(r.spot)}`,
      `Volt: ${fmtLvl(v.volt)}`,
      `Surge: ${fmtLvl(v.surge)}`,
      `Reversal: ${fmtLvl(v.reversal)}`,
      `Coil: ${fmtLvl(v.coil)}`,
      `Net GEX: ${fmtBn(r.netGex)} · Net DEX: ${fmtBn(r.netDex)}`,
    ].join('\n');
  }).join('\n\n');
}

function renderTextMessage(template, levels) {
  return String(template || '⚡ **Voltick Levels** — {time} ET\n\n{levels}')
    .replace(/\\n/g, '\n')
    .replace(/\{date\}/g, etLongDate())
    .replace(/\{time\}/g, etClock())
    .replace(/\{levels\}/g, levels)
    .slice(0, 2000);
}

async function postTextOwn(cfg, content) {
  if (cfg.channelId) {
    await bot.postToChannel(cfg.channelId, { content });
    return;
  }
  const res = await fetch(cfg.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: cfg.username || DISCORD_USERNAME,
      avatar_url: cfg.avatarUrl || DISCORD_AVATAR,
      content,
      allowed_mentions: { parse: [] },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

async function collectLevelsText(base, opts = {}) {
  try {
    const cfg = opts.config || (await store.getJob(TEXT_JOB_ID));
    if (!cfg) throw new Error(`scheduled-posts has no job "${TEXT_JOB_ID}"`);
    if (!(await store.hasDestination(cfg))) throw new Error('no destination configured (bot channel, webhook, or a Signals webhook on BOT → Manage)');

    const rows = await buildRows(base);
    if (!rows.length) throw new Error('no level rows resolved (chains empty?)');

    const content = renderTextMessage(cfg.message, levelsText(rows));
    const out = await store.deliver(cfg, {
      ownPost: () => postTextOwn(cfg, content),
      content,
      defaultUsername: cfg.username || DISCORD_USERNAME, defaultAvatar: cfg.avatarUrl || DISCORD_AVATAR,
    });
    console.log(`[levels-text] posted${opts.force ? ' (manual)' : ''} — ${rows.map((r) => r.ticker).join(',')} · +${out.fan.filter((r) => r.ok).length} signals`);
    await store.markRun(TEXT_JOB_ID, { status: out.warning ? 'partial' : 'ok', error: out.warning, postedDate: opts.slotKey || '' });
    return { ok: true, tickers: rows.map((r) => r.ticker) };
  } catch (e) {
    console.log(`[levels-text] post failed — ${e.message}`);
    await store.markRun(TEXT_JOB_ID, { status: 'error', error: e.message });
    return { ok: false, error: e.message };
  }
}

/** Slot for a times job: the listed time we are 0..GRACE_MIN past, or null. */
function timesSlot(cfg) {
  const { hour, minute, weekday } = nowParts();
  const day = String(weekday || '').slice(0, 3).toLowerCase();
  if (!String(cfg.days || '').split(',').includes(day)) return null;
  const mins = (hour % 24) * 60 + minute;
  for (const t of String(cfg.times || '').split(',').filter(Boolean)) {
    const late = mins - toMins(t);
    if (late >= 0 && late <= GRACE_MIN) return { key: `${todayETStr()} ${t}`, late };
  }
  return null;
}

function startLevelsTextDiscord(port) {
  if (process.env.MG_LADDER_DISABLED === '1') {
    console.log('[levels-text] disabled via MG_LADDER_DISABLED=1');
    return () => {};
  }
  const base = `http://localhost:${port}`;
  console.log(`[levels-text] watcher up — settings from owner → BOT → Scheduled (job "${TEXT_JOB_ID}"), checked every minute`);

  let stopped = false;
  let busy = false;
  let timer = null;
  let lastSlotMem = '';

  const msToNextMinute = () => {
    const now = new Date();
    return (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 1500;
  };

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const cfg = await store.getJob(TEXT_JOB_ID);
      if (!cfg || !cfg.enabled) return;
      const slot = timesSlot(cfg);
      if (!slot || slot.key === lastSlotMem) return;
      if (cfg.live && cfg.lastPostDate === slot.key) return;
      if (!(await store.hasDestination(cfg))) return;
      const res = await collectLevelsText(base, { config: cfg, slotKey: slot.key });
      if (res?.ok) lastSlotMem = slot.key;
    } catch (e) {
      console.log(`[levels-text] tick failed — ${e.message}`);
    } finally {
      busy = false;
    }
  }

  function arm() {
    if (stopped) return;
    timer = setTimeout(() => { void tick().finally(arm); }, msToNextMinute());
    if (typeof timer.unref === 'function') timer.unref();
  }
  arm();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

module.exports = {
  startMgLadderDiscord, collectOnce, buildRows, readConfig, JOB_ID,
  startLevelsTextDiscord, collectLevelsText, levelsText, voltickFromBooks, strikeBooks, TEXT_JOB_ID,
};
