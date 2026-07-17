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

// Anything below this much left AFTER every unpaid bill this month counts as
// "too close to spend". Override with BUDGET_SAFE_BUFFER.
const SAFE_BUFFER = Number(process.env.BUDGET_SAFE_BUFFER || 200);

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Port of the /owner/budget page's occurrencesInMonth — keep the two in sync.
function occurrencesInMonth(rule, month) {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${month}-${String(lastDay).padStart(2, '0')}`;
  const out = [];
  if (rule.frequency === 'monthly') {
    const day = Math.min(Number(rule.anchor_date.split('-')[2]), lastDay);
    return [`${month}-${String(day).padStart(2, '0')}`];
  }
  const step = rule.frequency === 'weekly' ? 7 : 14;
  let cursor = rule.anchor_date;
  while (cursor > first) cursor = addDays(cursor, -step);
  while (cursor < first) cursor = addDays(cursor, step);
  let guard = 0;
  while (cursor <= last && guard < 10) { out.push(cursor); cursor = addDays(cursor, step); guard++; }
  return out;
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
  const recurring = Array.isArray(d.recurring) ? d.recurring : [];
  const db = d.dailyBalance || null;
  const { ymd: today } = etParts();

  let income = 0, expenses = 0;
  for (const row of register) {
    if (row.is_beginning) continue;
    if (row.amount > 0) income += row.amount; else expenses += Math.abs(row.amount);
  }
  const allBanks = db ? (db.coastal || 0) + (db.truist || 0) + (db.secu || 0) : 0;

  // Every recurring outflow this month that hasn't been logged as paid yet.
  // A rule occurrence is "paid" once a real register row carries its tag.
  const paid = new Set(
    register.filter((x) => !x.is_beginning && typeof x.recurring_tag === 'string' && x.recurring_tag.startsWith('__recur__:'))
      .map((x) => x.recurring_tag)
  );
  const bills = [];
  for (const rule of recurring) {
    if (!rule.active || rule.amount >= 0) continue;
    for (const date of occurrencesInMonth(rule, month)) {
      const tag = `__recur__:${rule.id}:${date}`;
      if (paid.has(tag)) continue;
      bills.push({ label: rule.label, amount: Math.abs(rule.amount), date, pastDue: date < today });
    }
  }
  bills.sort((a, b) => (a.date < b.date ? -1 : 1));
  const owed = bills.reduce((s, b) => s + b.amount, 0);
  const pastDue = bills.filter((b) => b.pastDue);
  const after = allBanks - owed;

  // The headline: can we cover what's still due this month, and is it safe to spend?
  let tone, verdict, sub;
  if (after < 0) {
    tone = { bg: '#2a1416', bd: '#5c2b30', fg: '#f4948e' };
    verdict = `Short by ${fmt(Math.abs(after))} — don't spend`;
    sub = `${fmt(allBanks)} in the bank vs ${fmt(owed)} still due this month.`;
  } else if (after < SAFE_BUFFER) {
    tone = { bg: '#2a2314', bd: '#5c4f2b', fg: '#f0b429' };
    verdict = `Too close — don't spend`;
    sub = `Only ${fmt(after)} left after ${fmt(owed)} of bills. Cushion is ${fmt(SAFE_BUFFER)}.`;
  } else {
    tone = { bg: '#12241c', bd: '#2b5c45', fg: '#5ecb92' };
    verdict = `Covered — ${fmt(after)} spare`;
    sub = `${fmt(allBanks)} in the bank covers ${fmt(owed)} of remaining bills.`;
  }

  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const rows = [
    ['In the bank', fmt(allBanks)],
    ['Still due (mo)', fmt(owed)],
    ['Left after bills', fmt(after)],
    ['Income (mo)', fmt(income)],
    ['Expenses (mo)', fmt(expenses)],
  ];
  const cells = rows.map(([k, v], i) =>
    `<tr${i === 2 ? ` style="background:#0d1424"` : ''}>` +
    `<td style="padding:7px 14px;color:#8b94a7;font:600 13px system-ui">${k}</td>` +
    `<td style="padding:7px 14px;text-align:right;font:800 15px system-ui;color:${i === 2 ? tone.fg : '#e8ecf4'}">${v}</td></tr>`
  ).join('');

  // Next few bills so you can see what's actually coming.
  const nextBills = bills.slice(0, 6).map((b) =>
    `<tr><td style="padding:5px 14px;color:${b.pastDue ? '#f4948e' : '#8b94a7'};font:600 12px system-ui">` +
    `${b.date.slice(5)}${b.pastDue ? ' · past due' : ''}</td>` +
    `<td style="padding:5px 14px;color:#e8ecf4;font:600 13px system-ui">${b.label}</td>` +
    `<td style="padding:5px 14px;text-align:right;color:#f4948e;font:800 13px system-ui">${fmt(b.amount)}</td></tr>`
  ).join('');

  const html =
    `<div style="background:#0b0e14;padding:20px;border-radius:12px;max-width:600px">` +
    `<div style="font:800 18px system-ui;color:#e8ecf4;letter-spacing:.02em">Budget briefing — ${label}</div>` +
    `<div style="font:500 13px system-ui;color:#8b94a7;margin:4px 0 14px">Good morning. Snapshot as of 8:00 AM ET.</div>` +
    `<div style="background:${tone.bg};border:1px solid ${tone.bd};border-radius:10px;padding:14px 16px;margin-bottom:14px">` +
      `<div style="font:800 20px system-ui;color:${tone.fg}">${verdict}</div>` +
      `<div style="font:500 13px system-ui;color:#8b94a7;margin-top:4px">${sub}</div>` +
      (pastDue.length ? `<div style="font:700 12px system-ui;color:#f4948e;margin-top:6px">${pastDue.length} payment${pastDue.length === 1 ? '' : 's'} past due — ${fmt(pastDue.reduce((s, b) => s + b.amount, 0))}</div>` : '') +
    `</div>` +
    `<table style="width:100%;border-collapse:collapse;background:#111726;border-radius:10px;overflow:hidden">${cells}</table>` +
    (nextBills ? `<div style="font:600 12px system-ui;color:#8b94a7;margin:16px 0 6px;letter-spacing:.08em">STILL DUE</div>` +
      `<table style="width:100%;border-collapse:collapse;background:#111726;border-radius:10px;overflow:hidden">${nextBills}</table>` : '') +
    `<img src="cid:overview" style="width:100%;border-radius:10px;border:1px solid #1c2333;margin-top:16px" />` +
    `</div>`;
  return { html, label, verdict };
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

    // Shoot ONLY <main>'s box. The toolbar and OwnerSidebar live outside it, so
    // they're excluded by the capture region itself — not by the hiding above,
    // which a React re-render could undo.
    const el = await page.$('main');
    if (el) return await el.screenshot({ type: 'png' });
    return await page.screenshot({ type: 'png', fullPage: true });
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── send via Resend (inline cid attachments) ────────────────────────────────
async function send(html, subject, shot) {
  const attachments = [
    { filename: 'budget.png', content: Buffer.from(shot).toString('base64'), content_id: 'overview' },
  ];
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: TO_EMAILS, subject, html, attachments }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
}

async function runOnce(base) {
  if (!RESEND_API_KEY) { console.log('[budget-email] skip — RESEND_API_KEY not set'); return; }
  if (!INTERNAL_API_TOKEN) { console.log('[budget-email] skip — INTERNAL_API_TOKEN not set'); return; }
  const { month } = etParts();
  const cookie = await mintOwnerSession(base);
  const { html, label, verdict } = await buildWriteup(base, cookie, month);
  const shot = await captureShot(base, cookie);
  // Lead the subject with the verdict so it's readable from the lock screen.
  await send(html, `Budget — ${verdict}`, shot);
  console.log(`[budget-email] sent ${label} (${verdict}) → ${TO_EMAILS.join(', ')}`);
}

// ── daily 08:00 ET scheduler (60s tick + once-per-day guard) ────────────────
// Guard is persisted to disk (mounted ./state volume) — an in-memory guard
// resets on every container restart, so a restart during the 8am hour
// re-sent the email (root cause of the 3x-in-one-morning bug).
const path = require('path');
const fs = require('fs');
const GUARD_FILE = path.join(__dirname, '..', 'state', '.budget-email-last-run');

function readLastRunDay() {
  try { return fs.readFileSync(GUARD_FILE, 'utf8').trim(); } catch { return null; }
}
function writeLastRunDay(ymd) {
  try { fs.mkdirSync(path.dirname(GUARD_FILE), { recursive: true }); fs.writeFileSync(GUARD_FILE, ymd); } catch (e) { console.error('[budget-email] guard write failed:', e.message); }
}

function startBudgetEmail(port) {
  const base = `http://localhost:${port}`;
  let lastRunDay = readLastRunDay();
  console.log('[budget-email] enabled — daily 08:00 ET briefing');
  setInterval(() => {
    const { hour, ymd } = etParts();
    if (hour === 8 && lastRunDay !== ymd) {
      lastRunDay = ymd;
      writeLastRunDay(ymd);
      console.log(`[budget-email] firing ${ymd}`);
      runOnce(base).catch((e) => console.error('[budget-email] failed:', e.message));
    }
  }, 60_000);
  return () => {};
}

module.exports = { startBudgetEmail, runOnce };
