'use strict';
/**
 * server-v2/econ-calendar-discord.js
 *
 * Posts the Economic Calendar snapshot — today's US prints, the presidential
 * schedule and the earnings lane — to Discord on a schedule.
 *
 * This is the scheduled twin of the 📅 Discord button in the Economic Calendar
 * toolbar (components/shared/EconCalendarDiscordBtn.tsx), and unlike
 * mg-ladder-discord.js it does NOT hold a second copy of the renderer. The
 * template lives in exactly one place — lib/discord/econSnapshot.ts — and is
 * served as finished HTML by GET /api/econ-snapshot-html. All this file does is
 * screenshot that HTML in headless Chromium and upload the PNG. Edit the layout
 * there; nothing in this file needs to know what the snapshot looks like.
 *
 * SETTINGS LIVE IN THE OWNER PAGE, NOT IN ENV.
 * On/off, the time, the days, the webhook, the identity and the message line
 * all come from server-v2/scheduled-posts-store.js (job id `econ-calendar`),
 * edited on owner → BOT → Scheduled. They are re-read on EVERY tick, so a
 * change takes effect within a minute with no restart. The old env vars are the
 * fallback for a box whose settings table is unreachable, and only then — see
 * readConfig() — because otherwise an env var left over on the VPS would
 * silently outrank what the page shows.
 *
 * Why Chromium at all: the markup has to be rasterised somewhere, and it is
 * rasterised with html2canvas inside that browser — the same rasteriser the
 * button uses, deliberately, NOT page.screenshot(). renderPng() below explains
 * why that distinction is load-bearing. Chromium is already in the image
 * (/usr/bin/chromium, shipped for budget-email.js), so no new dependency.
 *
 * Env (fallback / operational only):
 *   ECON_CAL_DISABLED=1        hard-disable, whatever the page says
 *   ECON_CAL_DISCORD_CHANNEL_ID  bot-channel fallback; a channel set here or on
 *                              the page takes precedence over any webhook
 *   DISCORD_BOT_TOKEN          required for the bot path (see discord-bot-poster)
 *   ECON_CAL_DISCORD_WEBHOOK   webhook fallback, then DISCORD_WEBHOOK_URL —
 *                              the button's own channel (note: the OPPOSITE
 *                              default to mg-ladder-discord.js, which wants the
 *                              Signals channel)
 *   ECON_CAL_POST_ET           "HH:MM" — only honoured when the table is down
 *   ECON_CAL_POST_EMPTY=1      likewise
 *   ECON_CAL_GRACE_MIN         how late a post may still go out, default 90
 *   PUPPETEER_EXECUTABLE_PATH  /usr/bin/chromium in Docker
 *   INTERNAL_API_TOKEN         required — /api/econ-snapshot-html 404s without it
 *
 * Start from server-with-proxy.js after server.listen():
 *   require('./econ-calendar-discord').startEconCalendarDiscord(PORT);
 *
 * Scheduling is a 60s poll against the ET wall clock, NOT a setTimeout to the
 * next 08:00: that is DST-proof without any date math, it re-reads the settings
 * every minute for free, and a redeploy at 07:59 or 08:03 still posts exactly
 * once. Two guards keep it to once:
 *   · last_run_at in the settings table — survives a restart, so a process that
 *     comes back up at 08:04 does not repost what 08:00 already sent;
 *   · an in-memory date, for the case where the table is unreachable.
 * And a GRACE WINDOW (default 90 min) bounds how late a missed post may still
 * go out: a restart at 08:01 still posts, a redeploy at 14:00 does not push a
 * "morning" calendar into the channel.
 *
 * Never throws out of a tick.
 */

const store = require('./scheduled-posts-store');
const bot = require('./discord-bot-poster');

const JOB_ID = 'econ-calendar';
const CHROME_PATH = (process.env.PUPPETEER_EXECUTABLE_PATH || '').trim();
const GRACE_MIN = Math.max(1, Number(process.env.ECON_CAL_GRACE_MIN || 90));

// The snapshot template is authored against a locked 1280x720 canvas, and the
// button captures it at scale 1.5. Match both or the scheduled image is a
// different size to every one Brandon has posted by hand.
const CANVAS_W = 1280;
const CANVAS_H = 720;
const CAPTURE_SCALE = 1.5;

const DEFAULT_AVATAR = `${(process.env.SIGNALS_SITE_URL || 'https://cbedge.net').replace(/\/+$/, '')}/cb-edge-square.png`;

// ── Config ──────────────────────────────────────────────────────────────────

/**
 * The owner page is the source of truth. The env vars below are read ONLY when
 * the settings table could not be reached (`live:false`) — if they applied on
 * top of a live row, a stale VPS env var would quietly override a time the page
 * says is set, which is the exact confusion this table was added to end.
 */
async function readConfig() {
  const job = await store.getJob(JOB_ID);
  if (!job) throw new Error(`scheduled-posts has no job "${JOB_ID}"`);
  if (job.live) return job;

  return {
    ...job,
    postAt: store.normalizeTime(process.env.ECON_CAL_POST_ET, job.postAt),
    postEmpty: process.env.ECON_CAL_POST_EMPTY === '1' ? true : job.postEmpty,
  };
}

// ── ET clock ────────────────────────────────────────────────────────────────

function etParts(d = new Date()) {
  // Date, weekday, hour and minute all come from ONE format call so they can
  // never straddle a minute boundary.
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
    day: String(parts.weekday || '').slice(0, 3).toLowerCase(), // mon, tue, ...
  };
}

function etDateOf(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(t);
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
  return { html, econ: n('x-econ-events'), pres: n('x-econ-pres'), earn: n('x-econ-earn') };
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

/** {date} / {time} are the only tokens — the message is a caption, not a report. */
function renderMessage(template) {
  return String(template || '📅 **Economic Calendar** — {date} · {time} ET')
    .replace(/\{date\}/g, etLongDate())
    .replace(/\{time\}/g, etClock());
}

/**
 * Two ways out, and the CHANNEL WINS when both are set — the same precedence
 * scheduled-posts-store documents, applied in one place.
 *
 * Bot posts cannot carry a per-message name or avatar; the identity fields are
 * simply not sent on that path. That is a property of Discord, not an omission
 * here — discord-bot-poster.js explains it.
 */
async function postToDiscord(cfg, png, content) {
  if (cfg.channelId) {
    await bot.postToChannel(cfg.channelId, { content, file: png, filename: 'econ-calendar.png' });
    return;
  }

  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    username: cfg.username || 'CB Edge Signals',
    avatar_url: cfg.avatarUrl || DEFAULT_AVATAR,
    content,
  }));
  form.append('files[0]', new Blob([png], { type: 'image/png' }), 'econ-calendar.png');

  const res = await fetch(cfg.webhookUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`webhook ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

// ── Run ─────────────────────────────────────────────────────────────────────

/**
 * One attempt. `force` (the page's "Post now" button) skips the empty-day skip
 * but NOT the missing-webhook check — there is nowhere to post without one.
 * Always records the outcome on the job row, so the page can show what happened.
 */
async function collectOnce(base, opts = {}) {
  let cfg = null;
  try {
    cfg = opts.config || (await readConfig());
    if (!cfg.channelId && !cfg.webhookUrl) throw new Error('no destination configured (bot channel or webhook)');

    const { html, econ, pres, earn } = await fetchSnapshotHtml(base);

    if (!econ && !pres && !earn && !cfg.postEmpty && !opts.force) {
      console.log('[econ-cal] nothing on the calendar today — skip');
      await store.markRun(JOB_ID, { status: 'skipped', error: 'empty day' });
      return { ok: false, error: 'empty day' };
    }

    const png = await renderPng(html);
    await postToDiscord(cfg, png, renderMessage(cfg.message));
    console.log(`[econ-cal] posted — ${econ} econ / ${pres} pres / ${earn} earnings (${Math.round(png.length / 1024)}KB)`);
    await store.markRun(JOB_ID, { status: 'ok' });
    return { ok: true, econ, pres, earn };
  } catch (e) {
    console.log(`[econ-cal] post failed — ${e.message}`);
    await store.markRun(JOB_ID, { status: 'error', error: e.message });
    return { ok: false, error: e.message };
  }
}

function startEconCalendarDiscord(port) {
  if (process.env.ECON_CAL_DISABLED === '1') {
    console.log('[econ-cal] disabled via ECON_CAL_DISABLED=1');
    return () => {};
  }

  const base = `http://127.0.0.1:${port}`;
  console.log(`[econ-cal] watcher up — settings from owner → BOT → Scheduled (job "${JOB_ID}"), checked every 60s`);

  let stopped = false;
  let busy = false;
  let lastPostedMem = '';

  const timer = setInterval(() => {
    if (stopped || busy) return;
    busy = true;
    void (async () => {
      try {
        const cfg = await readConfig();
        if (!cfg.enabled || (!cfg.channelId && !cfg.webhookUrl)) return;

        const now = etParts();
        if (now.date === lastPostedMem) return;
        // Survives a restart — the in-memory date above does not.
        if (cfg.live && etDateOf(cfg.lastRunAt) === now.date && cfg.lastStatus === 'ok') return;
        if (!cfg.days.split(',').includes(now.day)) return;

        const [h, m] = cfg.postAt.split(':').map(Number);
        const minsLate = (now.hour * 60 + now.minute) - (h * 60 + m);
        // Not yet, or so late that this is a redeploy rather than the morning.
        if (minsLate < 0 || minsLate > GRACE_MIN) return;

        // Claim the day BEFORE awaiting the post, so a slow render cannot let
        // the next tick fire a second one.
        lastPostedMem = now.date;
        await collectOnce(base, { config: cfg });
      } catch (e) {
        console.log(`[econ-cal] tick failed — ${e.message}`);
      } finally {
        busy = false;
      }
    })();
  }, 60000);
  if (typeof timer.unref === 'function') timer.unref();

  return () => { stopped = true; clearInterval(timer); };
}

module.exports = { startEconCalendarDiscord, collectOnce, fetchSnapshotHtml, renderPng, readConfig, JOB_ID };
