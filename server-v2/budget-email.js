'use strict';
/**
 * server-v2/budget-email.js
 *
 * Every morning at 08:00 America/New_York, emails the owner a budget briefing:
 * a short written summary (banks, month income/expenses/net, prop spend, rent
 * countdown, upcoming + past-due pay) PLUS real screenshots of the Overview and
 * Prop tabs of /owner/budget.
 *
 * Auth: /owner/budget is owner-gated. We mint an owner session via the internal
 * endpoint (POST /api/auth/internal-session, x-internal-token), set it as the
 * cbe_session cookie in a headless Chromium, then screenshot the page exactly
 * as the owner sees it. The same cookie is reused to read /api/budget for the
 * written numbers. Email goes out through Resend (same provider as the app).
 *
 * Requires (in .env.local): INTERNAL_API_TOKEN, OWNER_USER_ID, RESEND_API_KEY,
 * EMAIL_FROM, BUDGET_EMAIL_TO, and (in Docker) PUPPETEER_EXECUTABLE_PATH →
 * /usr/bin/chromium. Never throws out of the tick — a bad morning just logs.
 */

const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim();
const FROM_EMAIL = (process.env.EMAIL_FROM || 'CB Edge <hello@cbedge.net>').trim();
// Comma-separated list of recipients, e.g. "a@x.com, b@y.com".
const TO_EMAILS = (process.env.BUDGET_EMAIL_TO || 'bjmuzila@gmail.com')
  .split(',').map((s) => s.trim()).filter(Boolean);
const INTERNAL_API_TOKEN = (process.env.INTERNAL_API_TOKEN || '').trim();
const CHROME_PATH = (process.env.PUPPETEER_EXECUTABLE_PATH || '').trim();

function etParts() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t)?.value;
  return {
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    month: `${get('year')}-${get('month')}`,
  };
}

function fmt(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// ── owner session for headless auth ─────────────────────────────────────────
async function mintOwnerSession(base) {
  const r = await fetch(`${base}/api/auth/internal-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-token': INTERNAL_API_TOKEN },
  });
  if (!r.ok) throw new Error(`internal-session ${r.status}`);
  const j = await r.json();
  if (!j.token) throw new Error('internal-session returned no token');
  return { name: j.cookieName || 'cbe_session', value: j.token };
}

// ── written summary from /api/budget ────────────────────────────────────────
async function buildWriteup(base, cookie, month) {
  const r = await fetch(`${base}/api/budget?month=${month}`, {
    cache: 'no-store',
    headers: { Cookie: `${cookie.name}=${cookie.value}` },
  });
  if (!r.ok) throw new Error(`/api/budget ${r.status}`);
  const d = await r.json();

  const register = Array.isArray(d.register) ? d.register : [];
  const db = d.dailyBalance || null;

  let income = 0, expenses = 0;
  for (const row of register) {
    if (row.is_beginning) continue;
    if (row.amount > 0) income += row.amount; else expenses += Math.abs(row.amount);
  }
  const allBanks = db ? (db.coastal || 0) + (db.truist || 0) + (db.secu || 0) : null;

  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const net = income - expenses;
  const rows = [
    ['Banks', allBanks == null ? '—' : fmt(allBanks)],
    ['Income (mo)', fmt(income)],
    ['Expenses (mo)', fmt(expenses)],
    ['Net (mo)', fmt(net)],
  ];
  const cells = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 14px;color:#8b94a7;font:600 13px system-ui">${k}</td>` +
    `<td style="padding:6px 14px;text-align:right;font:800 15px system-ui;color:#e8ecf4">${v}</td></tr>`
  ).join('');

  const html =
    `<div style="background:#0b0e14;padding:20px;border-radius:12px;max-width:560px">` +
    `<div style="font:800 18px system-ui;color:#e8ecf4;letter-spacing:.02em">Budget briefing — ${label}</div>` +
    `<div style="font:500 13px system-ui;color:#8b94a7;margin:4px 0 14px">Good morning. Snapshot as of 8:00 AM ET.</div>` +
    `<table style="width:100%;border-collapse:collapse;background:#111726;border-radius:10px;overflow:hidden">${cells}</table>` +
    `<img src="cid:overview" style="width:100%;border-radius:10px;border:1px solid #1c2333;margin-top:16px" />` +
    `</div>`;
  return { html, label };
}

// ── screenshot via headless chromium ────────────────────────────────────────
// Captures ONLY the budget Overview content: the app chrome (GlobalToolbar +
// OwnerSidebar) are siblings of <main>, so we hide every sibling of <main> and
// of each of its ancestors, then unlock the page's internal scroll container
// (the budget root is overflowY:auto inside a height-capped <main>) so a
// fullPage shot captures the whole thing rather than one viewport.
async function captureShot(base, cookie) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
    const host = new URL(base).host.split(':')[0];
    await page.setCookie({ name: cookie.name, value: cookie.value, domain: host, path: '/', httpOnly: true });

    await page.goto(`${base}/owner/budget`, { waitUntil: 'networkidle2', timeout: 45_000 });
    // Let the client-side data + charts settle.
    await new Promise((r) => setTimeout(r, 6000));

    await page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) return;
      // Hide toolbar / sidebar / docks: anything that isn't on main's ancestry.
      let node = main;
      while (node.parentElement && node !== document.body) {
        const parent = node.parentElement;
        for (const sib of Array.from(parent.children)) {
          if (sib !== node) sib.style.display = 'none';
        }
        parent.style.overflow = 'visible';
        parent.style.height = 'auto';
        parent.style.maxHeight = 'none';
        node = parent;
      }
      // Let every internal scroll container grow to its full content height.
      const unlock = (el) => {
        el.style.overflow = 'visible';
        el.style.height = 'auto';
        el.style.maxHeight = 'none';
      };
      unlock(main);
      for (const el of main.querySelectorAll('*')) {
        const s = getComputedStyle(el);
        if (s.overflowY === 'auto' || s.overflowY === 'scroll') unlock(el);
      }
      for (const el of [document.documentElement, document.body]) unlock(el);
    });
    await new Promise((r) => setTimeout(r, 800));

    return await page.screenshot({ type: 'png', fullPage: true });
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── send via Resend (inline cid attachments) ────────────────────────────────
async function send(html, label, shot) {
  const attachments = [
    { filename: 'budget.png', content: Buffer.from(shot).toString('base64'), content_id: 'overview' },
  ];
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: TO_EMAILS, subject: `Budget briefing — ${label}`, html, attachments }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
}

async function runOnce(base) {
  if (!RESEND_API_KEY) { console.log('[budget-email] skip — RESEND_API_KEY not set'); return; }
  if (!INTERNAL_API_TOKEN) { console.log('[budget-email] skip — INTERNAL_API_TOKEN not set'); return; }
  const { month } = etParts();
  const cookie = await mintOwnerSession(base);
  const { html, label } = await buildWriteup(base, cookie, month);
  const shot = await captureShot(base, cookie);
  await send(html, label, shot);
  console.log(`[budget-email] sent ${label} → ${TO_EMAILS.join(', ')}`);
}

// ── daily 08:00 ET scheduler (60s tick + once-per-day guard) ────────────────
function startBudgetEmail(port) {
  const base = `http://localhost:${port}`;
  let lastRunDay = null;
  console.log('[budget-email] enabled — daily 08:00 ET briefing');
  setInterval(() => {
    const { hour, ymd } = etParts();
    if (hour === 8 && lastRunDay !== ymd) {
      lastRunDay = ymd;
      console.log(`[budget-email] firing ${ymd}`);
      runOnce(base).catch((e) => console.error('[budget-email] failed:', e.message));
    }
  }, 60_000);
  return () => {};
}

module.exports = { startBudgetEmail, runOnce };
