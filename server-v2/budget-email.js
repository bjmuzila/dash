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

// Port of the /owner/budget Rent card's rentInfo: project cash flow to the 5th
// (every other income + expense landing before rent) so we can answer whether
// rent is covered when it's due. Keep in sync with app/owner/budget/page.tsx.
function computeRent(register, recurring, allBanks, today) {
  const RENT_DAY = 5;
  const rentRule = recurring.find((r) => r.active && r.amount < 0 && /rent/i.test(r.label));
  if (!rentRule) return null;
  const rentAmount = Math.abs(rentRule.amount);
  const now = new Date(`${today}T00:00:00`);
  let due = new Date(now.getFullYear(), now.getMonth(), RENT_DAY);
  if (due.getTime() < now.getTime()) due = new Date(now.getFullYear(), now.getMonth() + 1, RENT_DAY);
  const daysUntil = Math.round((due.getTime() - now.getTime()) / 86400000);
  const dueYm = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}`;
  const dueIso = `${dueYm}-${String(RENT_DAY).padStart(2, '0')}`;
  const paid = register.some((r) => !r.is_beginning && r.amount < 0 && /rent/i.test(r.label) && r.entry_date.slice(0, 7) === dueYm);
  const inWindow = (d) => d >= today && d <= dueIso;
  const materialized = new Set(
    register.filter((r) => !r.is_beginning && typeof r.recurring_tag === 'string' && r.recurring_tag.startsWith('__recur__:')).map((r) => r.recurring_tag)
  );
  const months = [];
  for (let d = new Date(now.getFullYear(), now.getMonth(), 1), g = 0; g < 4; d = new Date(d.getFullYear(), d.getMonth() + 1, 1), g++) {
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push(ym);
    if (ym === dueYm) break;
  }
  const flows = [];
  for (const r of register) {
    if (r.is_beginning || !inWindow(r.entry_date)) continue;
    flows.push({ label: r.label, amount: r.amount, date: r.entry_date });
  }
  for (const rule of recurring) {
    if (!rule.active) continue;
    for (const ym of months) {
      for (const date of occurrencesInMonth(rule, ym)) {
        if (!inWindow(date) || materialized.has(`__recur__:${rule.id}:${date}`)) continue;
        flows.push({ label: rule.label, amount: rule.amount, date });
      }
    }
  }
  flows.sort((a, b) => (a.date < b.date ? -1 : 1));
  const incoming = flows.filter((f) => f.amount > 0);
  const outgoing = flows.filter((f) => f.amount < 0 && !/rent/i.test(f.label));
  const incomingTotal = incoming.reduce((s, f) => s + f.amount, 0);
  const outgoingTotal = outgoing.reduce((s, f) => s + Math.abs(f.amount), 0);
  const projected = allBanks + incomingTotal - outgoingTotal;
  const shortfall = Math.max(0, rentAmount - projected);
  const perDay = daysUntil > 0 ? shortfall / daysUntil : shortfall;
  return { rentAmount, daysUntil, dueIso, paid, available: allBanks, incoming, outgoing, incomingTotal, outgoingTotal, projected, shortfall, perDay };
}

// Render the rent projection as the email section that sits under STILL DUE.
function rentSection(rent) {
  if (!rent) return '';
  const { rentAmount, daysUntil, dueIso, paid, available, incoming, outgoing, incomingTotal, outgoingTotal, projected, shortfall, perDay } = rent;
  const list = (items, sign, color) => items.map((f) =>
    `<div style="display:flex;justify-content:space-between;margin-top:2px">` +
    `<span style="color:#8b94a7;font:500 12px system-ui">${f.label} · ${f.date.slice(5)}</span>` +
    `<span style="color:${color};font:700 12px system-ui">${sign}${fmt(Math.abs(f.amount))}</span></div>`
  ).join('');
  let tone, headline, subline;
  if (paid) {
    tone = { bg: '#12241c', bd: '#2b5c45', fg: '#5ecb92' };
    headline = "Rent is paid for this month.";
    subline = '';
  } else if (projected >= rentAmount) {
    tone = { bg: '#12241c', bd: '#2b5c45', fg: '#5ecb92' };
    headline = "Enough coming in — rent's covered.";
    subline = `${fmt(projected - rentAmount)} to spare after rent on the 5th.`;
  } else {
    tone = { bg: '#2a1416', bd: '#5c2b30', fg: '#f4948e' };
    headline = `Still short by ${fmt(shortfall)}`;
    subline = daysUntil > 0 ? `${fmt(perDay)}/day extra needed before the 5th.` : `Rent is due.`;
  }
  const row = (k, v, color) =>
    `<div style="display:flex;justify-content:space-between;margin-top:3px">` +
    `<span style="color:#8b94a7;font:600 13px system-ui">${k}</span>` +
    `<span style="color:${color};font:800 14px system-ui">${v}</span></div>`;
  return (
    `<div style="font:600 12px system-ui;color:#8b94a7;margin:16px 0 6px;letter-spacing:.08em">RENT · DUE ${dueIso.slice(5)}${paid ? '' : ` · ${daysUntil} day${daysUntil === 1 ? '' : 's'}`}</div>` +
    `<div style="background:#111726;border-radius:10px;overflow:hidden;padding:12px 14px">` +
      row('Rent', fmt(rentAmount), '#e8ecf4') +
      row('On hand now', fmt(available), '#e8ecf4') +
      (incoming.length ? `<div style="font:700 11px system-ui;color:#8b94a7;letter-spacing:.06em;margin-top:10px">COMING IN BEFORE THEN <span style="color:#5ecb92">+${fmt(incomingTotal)}</span></div>` + list(incoming, '+', '#5ecb92') : '') +
      (outgoing.length ? `<div style="font:700 11px system-ui;color:#8b94a7;letter-spacing:.06em;margin-top:10px">GOING OUT BEFORE THEN <span style="color:#f4948e">-${fmt(outgoingTotal)}</span></div>` + list(outgoing, '-', '#f4948e') : '') +
      `<div style="display:flex;justify-content:space-between;margin-top:10px;padding-top:8px;border-top:1px solid #1c2333"><span style="color:#8b94a7;font:700 13px system-ui">Projected on the 5th</span><span style="color:#7dd3fc;font:800 16px system-ui">${fmt(projected)}</span></div>` +
    `</div>` +
    `<div style="background:${tone.bg};border:1px solid ${tone.bd};border-radius:10px;padding:10px 14px;margin-top:8px">` +
      `<div style="font:800 14px system-ui;color:${tone.fg}">${headline}</div>` +
      (subline ? `<div style="font:500 12px system-ui;color:#8b94a7;margin-top:2px">${subline}</div>` : '') +
    `</div>`
  );
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

  // Pay still expected this month — the positive side of the same rule-occurrence
  // logic used for bills. An occurrence counts as "still coming" until a real
  // register row carries its tag. Without this the briefing only ever counted
  // money going out, so any month with rent outstanding read as a disaster.
  const incoming = [];
  for (const rule of recurring) {
    if (!rule.active || rule.amount <= 0) continue;
    for (const date of occurrencesInMonth(rule, month)) {
      const tag = `__recur__:${rule.id}:${date}`;
      if (paid.has(tag)) continue;
      incoming.push({ label: rule.label, amount: rule.amount, date, late: date < today });
    }
  }
  incoming.sort((a, b) => (a.date < b.date ? -1 : 1));
  const coming = incoming.reduce((s, b) => s + b.amount, 0);

  // What's actually spendable this month: bank + pay still to land, against
  // everything still due.
  const available = allBanks + coming;
  const after = available - owed;

  // Rent projection (mirrors the /owner/budget Rent card) — shown under STILL DUE.
  const rentHtml = rentSection(computeRent(register, recurring, allBanks, today));

  // The headline: can we cover what's still due this month, and is it safe to spend?
  let tone, verdict, sub;
  if (after < 0) {
    tone = { bg: '#2a1416', bd: '#5c2b30', fg: '#f4948e' };
    verdict = `Short by ${fmt(Math.abs(after))} — don't spend`;
    sub = `${fmt(available)} available (${fmt(allBanks)} in the bank + ${fmt(coming)} pay coming) vs ${fmt(owed)} still due this month.`;
  } else if (after < SAFE_BUFFER) {
    tone = { bg: '#2a2314', bd: '#5c4f2b', fg: '#f0b429' };
    verdict = `Too close — don't spend`;
    sub = `Only ${fmt(after)} left after ${fmt(owed)} of bills. Cushion is ${fmt(SAFE_BUFFER)}.`;
  } else {
    tone = { bg: '#12241c', bd: '#2b5c45', fg: '#5ecb92' };
    verdict = `Covered — ${fmt(after)} spare`;
    sub = `${fmt(available)} available (${fmt(allBanks)} in the bank + ${fmt(coming)} pay coming) covers ${fmt(owed)} of remaining bills.`;
  }

  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  // Money in, money out, what's left — pay included so the month balances.
  const rows = [
    ['In the bank', fmt(allBanks), '#e8ecf4', false],
    ['Pay coming (mo)', `+${fmt(coming)}`, '#5ecb92', false],
    ['Income (mo)', fmt(available), '#7dd3fc', true],
    ['Still due (mo)', fmt(owed), '#f4948e', false],
    ['Left after bills', fmt(after), tone.fg, true],
  ];
  const cells = rows.map(([k, v, color, hi]) =>
    `<tr${hi ? ` style="background:#0d1424"` : ''}>` +
    `<td style="padding:7px 14px;color:#8b94a7;font:600 13px system-ui">${k}</td>` +
    `<td style="padding:7px 14px;text-align:right;font:800 15px system-ui;color:${color}">${v}</td></tr>`
  ).join('');

  // Next few bills so you can see what's actually coming.
  const nextBills = bills.slice(0, 6).map((b) =>
    `<tr><td style="padding:5px 14px;color:${b.pastDue ? '#f4948e' : '#8b94a7'};font:600 12px system-ui">` +
    `${b.date.slice(5)}${b.pastDue ? ' · past due' : ''}</td>` +
    `<td style="padding:5px 14px;color:#e8ecf4;font:600 13px system-ui">${b.label}</td>` +
    `<td style="padding:5px 14px;text-align:right;color:#f4948e;font:800 13px system-ui">${fmt(b.amount)}</td></tr>`
  ).join('');

  // …and the pay that's meant to land against them.
  const nextPay = incoming.slice(0, 6).map((b) =>
    `<tr><td style="padding:5px 14px;color:${b.late ? '#f0b429' : '#8b94a7'};font:600 12px system-ui">` +
    `${b.date.slice(5)}${b.late ? ' · not in yet' : ''}</td>` +
    `<td style="padding:5px 14px;color:#e8ecf4;font:600 13px system-ui">${b.label}</td>` +
    `<td style="padding:5px 14px;text-align:right;color:#5ecb92;font:800 13px system-ui">+${fmt(b.amount)}</td></tr>`
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
    (nextPay ? `<div style="font:600 12px system-ui;color:#8b94a7;margin:16px 0 6px;letter-spacing:.08em">PAY COMING IN</div>` +
      `<table style="width:100%;border-collapse:collapse;background:#111726;border-radius:10px;overflow:hidden">${nextPay}</table>` : '') +
    (nextBills ? `<div style="font:600 12px system-ui;color:#8b94a7;margin:16px 0 6px;letter-spacing:.08em">STILL DUE</div>` +
      `<table style="width:100%;border-collapse:collapse;background:#111726;border-radius:10px;overflow:hidden">${nextBills}</table>` : '') +
    rentHtml +
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

    // The budget page holds long-lived connections (toolbar WS / polling), so
    // 'networkidle2' never settles and the nav timed out (the 8am failure). Wait
    // for the DOM only, then the fixed delay below lets client data + charts render.
    await page.goto(`${base}/owner/budget`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // Let the client-side data + charts settle.
    await new Promise((r) => setTimeout(r, 9000));

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
  // Subject stays generic on purpose — the numbers and the verdict live inside
  // the email, not on a lock screen anyone can read over your shoulder.
  await send(html, `Budget briefing — ${label}`, shot);
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
    // Catch-up window: fire once per day any time from 08:00 ET onward (until
    // 22:00), so a container that was down or mid-redeploy during the 8am minute
    // still sends today's briefing when it comes back instead of skipping the day.
    if (hour >= 8 && hour < 22 && lastRunDay !== ymd) {
      // Set the guard BEFORE running so a restart mid-send can't re-send (the
      // guard is on the mounted ./state volume and survives restarts). On failure
      // we CLEAR it so the next 60s tick retries — a single bad run (chromium,
      // auth, Resend) no longer burns the whole day.
      lastRunDay = ymd;
      writeLastRunDay(ymd);
      console.log(`[budget-email] firing ${ymd}`);
      runOnce(base)
        .then(() => console.log(`[budget-email] done ${ymd}`))
        .catch((e) => {
          console.error('[budget-email] failed (will retry):', e.message);
          lastRunDay = null;
          writeLastRunDay('');
        });
    }
  }, 60_000);
  return () => {};
}

module.exports = { startBudgetEmail, runOnce };
