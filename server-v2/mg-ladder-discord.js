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
 * Env:
 *   MG_LADDER_DISCORD_WEBHOOK  webhook URL (falls back to DISCORD_WEBHOOK_URL,
 *                              the same webhook the in-app Discord buttons use
 *                              via app/api/discord-share)
 *   MG_LADDER_DISABLED=1       hard-disable
 *   MG_LADDER_TICKERS          default "SPX,SPY,QQQ"
 *   MG_LADDER_INTERVAL_MIN     default 15
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
const INTERVAL_MIN = Math.max(1, Number(process.env.MG_LADDER_INTERVAL_MIN || 15));
const WEBHOOK = (process.env.MG_LADDER_DISCORD_WEBHOOK || process.env.DISCORD_WEBHOOK_URL || '').trim();
const CHROME_PATH = (process.env.PUPPETEER_EXECUTABLE_PATH || '').trim();

// Shared identity with discord-relay.js / signals-engine.js so everything the
// app posts renders as ONE bot in the channel.
const SITE_URL = (process.env.SIGNALS_SITE_URL || 'https://cbedge.net').replace(/\/+$/, '');
const DISCORD_USERNAME = 'CB Edge Signals';
const DISCORD_AVATAR = `${SITE_URL}/cb-edge-logo.png`;

// ── ET helpers (same shape as every other server-v2 recorder) ────────────────

function nowParts() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

function isRTH() {
  const { hour, minute, weekday } = nowParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const mins = hour * 60 + minute;
  return mins >= 570 && mins < 960; // 09:30–16:00 ET
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
function netGexByStrike(items, spot) {
  const out = [];
  for (const grp of (items || [])) {
    for (const s of (grp.strikes || [])) {
      const strike = Number(s['strike-price']);
      if (!(strike > 0)) continue;
      const c = s.call || {}, p = s.put || {};
      const cg = Math.abs(Number(c.gamma) || 0), pg = Math.abs(Number(p.gamma) || 0);
      const cc = (Number(c['open-interest']) || 0) + (Number(c.volume) || 0);
      const pc = (Number(p['open-interest']) || 0) + (Number(p.volume) || 0);
      const net = (cg * cc - pg * pc) * spot * spot * 0.01 * 100;
      if (!Number.isFinite(net)) continue;
      out.push({ strike, net });
    }
  }
  return out;
}

/** computeWalls(): CB = max |net|; CW = max +net excluding CB; PW = min −net excluding CB. */
function computeWalls(rows) {
  let cb = null, cbAbs = -1;
  rows.forEach((r) => { const a = Math.abs(r.net); if (a > cbAbs) { cbAbs = a; cb = r.strike; } });
  const pos = rows.filter((r) => r.net > 0).sort((a, b) => b.net - a.net);
  const neg = rows.filter((r) => r.net < 0).sort((a, b) => a.net - b.net);
  const cw = pos.find((r) => r.strike !== cb)?.strike ?? null;
  const pw = neg.find((r) => r.strike !== cb)?.strike ?? null;
  return { cb, cw, pw };
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

      const { cb, cw, pw } = computeWalls(netGexByStrike(items, spot));
      rows.push({ ticker, spot, expiration: front, cb, cw, pw });
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

async function postToDiscord(png, content) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    username: DISCORD_USERNAME, avatar_url: DISCORD_AVATAR, content,
  }));
  form.append('files[0]', new Blob([png], { type: 'image/png' }), `multigreek-ladders-${fileStamp()}.png`);

  const res = await fetch(WEBHOOK, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`webhook ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

// ── Tick ────────────────────────────────────────────────────────────────────

async function collectOnce(base, opts = {}) {
  if (!WEBHOOK) return { ok: false, error: 'no webhook' };
  if (!isRTH() && !opts.force) return { ok: false, error: 'outside RTH' };

  try {
    const rows = await buildRows(base);
    if (!rows.length) { console.log('[mg-ladder] no rows resolved — skip'); return { ok: false, error: 'no rows' }; }

    const png = await renderPng(base, rows);
    const summary = rows.map((r) => `${r.ticker} ${r.cb == null ? '--' : r.cb}`).join(' · ');
    await postToDiscord(png, `📊 **Multi-Greek Ladders** — ${etClock()} ET · CB ${summary}`);
    console.log(`[mg-ladder] posted — ${rows.map((r) => r.ticker).join(',')} (${Math.round(png.length / 1024)}KB)`);
    return { ok: true, tickers: rows.map((r) => r.ticker) };
  } catch (e) {
    console.log(`[mg-ladder] tick failed — ${e.message}`);
    return { ok: false, error: e.message };
  }
}

function startMgLadderDiscord(port) {
  if (process.env.MG_LADDER_DISABLED === '1') {
    console.log('[mg-ladder] disabled via MG_LADDER_DISABLED=1');
    return () => {};
  }
  if (!WEBHOOK) {
    console.log('[mg-ladder] off — MG_LADDER_DISCORD_WEBHOOK / DISCORD_WEBHOOK_URL not set');
    return () => {};
  }

  const base = `http://localhost:${port}`;

  // Fire on the wall-clock boundary (:00 / :15 / :30 / :45) rather than N
  // minutes after boot, so the timestamps in the channel are readable and two
  // redeploys in an hour don't shift the whole series.
  function msToNextBoundary() {
    const now = new Date();
    const minsToNext = INTERVAL_MIN - (now.getMinutes() % INTERVAL_MIN) || INTERVAL_MIN;
    return (minsToNext * 60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  }

  console.log(`[mg-ladder] enabled — ladders for ${TICKERS.join(',')} to Discord every ${INTERVAL_MIN}m during RTH · next in ${Math.round(msToNextBoundary() / 60000)}m`);

  let stopped = false;
  let timer = null;
  function arm() {
    if (stopped) return;
    timer = setTimeout(() => { void collectOnce(base).finally(arm); }, msToNextBoundary());
  }
  arm();

  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

module.exports = { startMgLadderDiscord, collectOnce, buildRows };
