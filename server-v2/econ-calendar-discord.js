'use strict';
/**
 * server-v2/econ-calendar-discord.js
 *
 * Posts the Economic Calendar snapshot — today's US prints, the presidential
 * schedule and the earnings lane — to Discord once every weekday morning.
 *
 * This is the scheduled twin of the 📅 Discord button in the Economic Calendar
 * toolbar (components/shared/EconCalendarDiscordBtn.tsx), and unlike
 * mg-ladder-discord.js it does NOT hold a second copy of the renderer. The
 * template lives in exactly one place — lib/discord/econSnapshot.ts — and is
 * served as finished HTML by GET /api/econ-snapshot-html. All this file does is
 * screenshot that HTML in headless Chromium and upload the PNG. Edit the layout
 * there; nothing in this file needs to know what the snapshot looks like.
 *
 * Why Chromium at all: the markup has to be rasterised somewhere, and it is
 * rasterised with html2canvas inside that browser — the same rasteriser the
 * button uses, deliberately, NOT page.screenshot(). renderPng() below explains
 * why that distinction is load-bearing. Chromium is already in the image
 * (/usr/bin/chromium, shipped for budget-email.js), so no new dependency.
 *
 * Env:
 *   ECON_CAL_DISCORD_WEBHOOK   explicit override
 *   DISCORD_WEBHOOK_URL        default target — the SAME channel the in-app
 *                              button posts to (via /api/discord-share), which
 *                              is the point: the morning post should land where
 *                              the manual ones always have. Note this is the
 *                              opposite default to mg-ladder-discord.js, which
 *                              wants the Signals channel.
 *   ECON_CAL_POST_ET           local ET time to post, "HH:MM", default "08:00"
 *   ECON_CAL_POST_EMPTY=1      post even when the day has no events at all
 *   ECON_CAL_DISABLED=1        hard-disable
 *   PUPPETEER_EXECUTABLE_PATH  /usr/bin/chromium in Docker
 *   INTERNAL_API_TOKEN         required — /api/econ-snapshot-html 404s without it
 *
 * Start from server-with-proxy.js after server.listen():
 *   require('./econ-calendar-discord').startEconCalendarDiscord(PORT);
 *
 * Scheduling is a 60s poll against the ET wall clock plus a "already posted
 * today" guard, NOT a setTimeout to the next 08:00. That is deliberate: it is
 * DST-proof without any date math, and a redeploy at 07:59 or 08:03 still
 * posts exactly once. The guard is in-memory, so a process restart after a
 * successful post would repost — hence it also records the date BEFORE the
 * upload, and a failed attempt is not retried until the next morning.
 *
 * Never throws out of a tick.
 */

const WEBHOOK = [
  process.env.ECON_CAL_DISCORD_WEBHOOK,
  process.env.DISCORD_WEBHOOK_URL,
].map((v) => (v || '').trim()).find(Boolean) || '';

const CHROME_PATH = (process.env.PUPPETEER_EXECUTABLE_PATH || '').trim();
const POST_EMPTY = process.env.ECON_CAL_POST_EMPTY === '1';

// Shared identity with discord-relay.js / mg-ladder-discord.js so everything the
// app posts renders as ONE bot in the channel.
const SITE_URL = (process.env.SIGNALS_SITE_URL || 'https://cbedge.net').replace(/\/+$/, '');
const DISCORD_USERNAME = 'CB Edge Signals';
const DISCORD_AVATAR = `${SITE_URL}/cb-edge-square.png`;

// The snapshot template is authored against a locked 1280x720 canvas, and the
// button captures it at scale 1.5. Match both or the scheduled image is a
// different size to every one Brandon has posted by hand.
const CANVAS_W = 1280;
const CANVAS_H = 720;
const CAPTURE_SCALE = 1.5;

function parseHHMM(raw, fallbackH, fallbackM) {
  const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { h: fallbackH, m: fallbackM };
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || h < 0 || h > 23 || !Number.isFinite(mm) || mm < 0 || mm > 59) {
    return { h: fallbackH, m: fallbackM };
  }
  return { h, m: mm };
}

const POST_AT = parseHHMM(process.env.ECON_CAL_POST_ET, 8, 0);

// ── ET clock ────────────────────────────────────────────────────────────────

function etParts(d = new Date()) {
  // en-CA gives YYYY-MM-DD, and weekday/hour/minute come from the same format
  // call so they can never straddle a minute boundary.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: parts.weekday, // Mon, Tue, ...
  };
}

function isWeekday(wd) {
  return wd === 'Mon' || wd === 'Tue' || wd === 'Wed' || wd === 'Thu' || wd === 'Fri';
}

function etClock() {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function etLongDate() {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
  });
}

// ── Snapshot HTML ───────────────────────────────────────────────────────────

/**
 * Pull the finished, self-contained document from the app. Returns the markup
 * plus today's row counts (from the response headers) so an empty calendar can
 * be skipped without this file knowing anything about the calendar feed.
 */
async function fetchSnapshotHtml(base) {
  const token = (process.env.INTERNAL_API_TOKEN || '').trim();
  if (!token) throw new Error('INTERNAL_API_TOKEN unset — /api/econ-snapshot-html would 404');

  const res = await fetch(`${base}/api/econ-snapshot-html`, {
    headers: { 'x-internal-token': token },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`snapshot html ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  const html = await res.text();
  if (!html || html.length < 500) throw new Error(`snapshot html too short (${html.length} bytes)`);

  const n = (h) => Number(res.headers.get(h) || 0) || 0;
  return {
    html,
    econ: n('x-econ-events'),
    pres: n('x-econ-pres'),
    earn: n('x-econ-earn'),
  };
}

// ── Render ──────────────────────────────────────────────────────────────────

/**
 * Rasterise with html2canvas INSIDE the headless browser — not with
 * page.screenshot().
 *
 * This looks like the long way round and is the whole point of the file. The
 * template in lib/discord/econSnapshot.ts is tuned to html2canvas, which is a
 * partial renderer: it ignores line-height half-leading, implements neither
 * text-overflow:ellipsis nor line-clamp, and drops backdrop-filter. The
 * template compensates — PILL_NUDGE_EM shifts every pill's padding by ~0.42em
 * to re-centre text html2canvas would otherwise draw low, titles are truncated
 * in JS against measured lane widths, and so on. Real Chrome does NOT have
 * those bugs, so a straight page.screenshot() applies the corrections to a
 * renderer that never needed them and every pill's text rides visibly high.
 *
 * Running the same rasteriser the 📅 button runs means the corrections land on
 * the renderer they were measured against, and the scheduled PNG is the picture
 * Brandon has been posting by hand. Options mirror the single html2canvas call
 * in lib/snapshot.ts for this capture: scale 1.5, the document's own --bg, and
 * the deliberate windowWidth/windowHeight reflow at the locked canvas size.
 *
 * (scripts/audit-ui.mjs --strict forbids a second html2canvas call site, but it
 * scans app / components / lib / app-vite/src / hooks — not server-v2. This is
 * a Node process driving a browser, not a second engine in the app bundle.)
 */
function html2canvasPath() {
  const path = require('path');
  try {
    // Resolves the package's own main build — whatever version is installed.
    return require.resolve('html2canvas');
  } catch {
    return path.join(__dirname, '..', 'node_modules', 'html2canvas', 'dist', 'html2canvas.min.js');
  }
}

async function renderPng(html) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    // deviceScaleFactor stays 1 — html2canvas does the 1.5x itself, and doing
    // it twice would produce a 2880px-wide image.
    await page.setViewport({ width: CANVAS_W, height: CANVAS_H, deviceScaleFactor: 1 });

    // Every image in the document is a data: URL, so nothing here goes to the
    // network — 'load' is enough and networkidle0 would just add its idle wait.
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    try {
      // Plain boolean back, not the FontFaceSet — handing puppeteer the object
      // fails serialization and throws (the mg-ladder lesson).
      await page.evaluate(async () => { try { await document.fonts.ready; } catch (e) { /* no font API */ } return true; });
    } catch { /* fonts are a nicety; the stack falls back */ }

    await page.addScriptTag({ path: html2canvasPath() });

    const dataUrl = await page.evaluate(async (opts) => {
      const root = document.getElementById('root') || document.body;
      // The template declares its own background on :root as --bg; read it back
      // rather than hardcoding, exactly as lib/snapshot.ts stopped doing.
      const bg =
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() ||
        getComputedStyle(document.body).backgroundColor;
      /* global html2canvas */
      const canvas = await html2canvas(root, {
        backgroundColor: bg,
        useCORS: true,
        allowTaint: true,
        scale: opts.scale,
        logging: false,
        windowWidth: opts.w,
        windowHeight: opts.h,
      });
      return canvas.toDataURL('image/png');
    }, { scale: CAPTURE_SCALE, w: CANVAS_W, h: CANVAS_H });

    if (!dataUrl || !String(dataUrl).startsWith('data:image/png')) {
      throw new Error('html2canvas returned no image');
    }
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
  form.append('files[0]', new Blob([png], { type: 'image/png' }), 'econ-calendar.png');

  const res = await fetch(WEBHOOK, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`webhook ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

// ── Tick ────────────────────────────────────────────────────────────────────

async function collectOnce(base, opts = {}) {
  if (!WEBHOOK) return { ok: false, error: 'no webhook' };

  try {
    const { html, econ, pres, earn } = await fetchSnapshotHtml(base);

    if (!econ && !pres && !earn && !POST_EMPTY && !opts.force) {
      console.log('[econ-cal] nothing on the calendar today — skip');
      return { ok: false, error: 'empty day' };
    }

    const png = await renderPng(html);
    // Same message shape the button posts, so the channel reads as one series.
    await postToDiscord(png, `📅 **Economic Calendar** — ${etLongDate()} · ${etClock()} ET`);
    console.log(`[econ-cal] posted — ${econ} econ / ${pres} pres / ${earn} earnings (${Math.round(png.length / 1024)}KB)`);
    return { ok: true, econ, pres, earn };
  } catch (e) {
    console.log(`[econ-cal] post failed — ${e.message}`);
    return { ok: false, error: e.message };
  }
}

function startEconCalendarDiscord(port) {
  if (process.env.ECON_CAL_DISABLED === '1') {
    console.log('[econ-cal] disabled via ECON_CAL_DISABLED=1');
    return () => {};
  }
  if (!WEBHOOK) {
    console.log('[econ-cal] off — no webhook (ECON_CAL_DISCORD_WEBHOOK / DISCORD_WEBHOOK_URL both unset)');
    return () => {};
  }
  if (!(process.env.INTERNAL_API_TOKEN || '').trim()) {
    console.log('[econ-cal] off — INTERNAL_API_TOKEN unset (the snapshot route would 404)');
    return () => {};
  }

  const base = `http://127.0.0.1:${port}`;
  const hhmm = `${String(POST_AT.h).padStart(2, '0')}:${String(POST_AT.m).padStart(2, '0')}`;

  // Boot-day guard: if the process starts AFTER today's slot, don't fire the
  // moment the poll wakes up — a lunchtime redeploy should not push a "morning"
  // calendar into the channel. Tomorrow is the next post.
  const boot = etParts();
  let lastPosted =
    boot.hour > POST_AT.h || (boot.hour === POST_AT.h && boot.minute >= POST_AT.m)
      ? boot.date
      : '';

  if (lastPosted) {
    console.log(`[econ-cal] enabled — daily at ${hhmm} ET (weekdays) · today's slot already passed, next post tomorrow`);
  } else {
    console.log(`[econ-cal] enabled — daily at ${hhmm} ET (weekdays) · next post today`);
  }

  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    const now = etParts();
    if (now.date === lastPosted) return;
    if (!isWeekday(now.weekday)) return;
    if (now.hour < POST_AT.h || (now.hour === POST_AT.h && now.minute < POST_AT.m)) return;

    // Claim the day BEFORE awaiting, so a slow render can't let the next tick
    // fire a second post. A failure therefore waits for tomorrow rather than
    // retrying every minute into a channel Brandon has to read.
    lastPosted = now.date;
    void collectOnce(base);
  }, 60000);
  if (typeof timer.unref === 'function') timer.unref();

  return () => { stopped = true; clearInterval(timer); };
}

module.exports = { startEconCalendarDiscord, collectOnce, fetchSnapshotHtml, renderPng };
