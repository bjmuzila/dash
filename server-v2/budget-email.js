'use strict';
/**
 * server-v2/budget-email.js
 *
 * Every morning at 08:00 America/New_York, emails the owner a MORNING BRIEFING:
 * today's schedule, what's on the task list, this morning's routines, what's
 * planned for dinner and still on the grocery list — and then the money: the
 * spend/don't-spend verdict, the pay landing against the bills still due, the
 * rent projection, and a screenshot of /owner/budget.
 *
 * ── WHERE THE DATA COMES FROM ──────────────────────────────────────────────
 *
 * MONEY comes over HTTP from this same process (`/api/budget`), authenticated
 * with a minted owner session, exactly as before.
 *
 * SCHEDULE / TASKS / ROUTINES / LISTS come from the household libs DIRECTLY —
 * `_lib-household*.cjs`, `_lib-google-calendar.cjs`, `_lib-ics-feeds.cjs` —
 * NOT from /api/hh/*. Those routes live in a separate process (household-server
 * on HH_PORT) behind an hh_session cookie this process has no way to mint: it
 * has no household login and, by design, no code path into one. But both
 * processes talk to the SAME Postgres, and the libs are plain modules sitting
 * in this folder, so reading them in-process is the short way round — no second
 * credential, no cross-container HTTP, and the same functions the Today screen
 * calls. See the header of household-server.js for why the process split exists
 * and why the DATA is deliberately shared.
 *
 * Every household section is optional and independently wrapped: a missing lib,
 * a Google outage, a DB hiccup drops THAT block out of the email and the rest
 * still goes. The money half is what this email exists for; the briefing around
 * it must never be able to stop it.
 *
 * ── WHICH HOUSEHOLD USER ───────────────────────────────────────────────────
 *
 * BRIEF_HH_EMAIL picks the hh_users row whose tasks/routines/calendar are read.
 * Unset, it falls back to the first address in BUDGET_EMAIL_TO, then to the
 * first active household user. Rows are shared between the two members anyway
 * (the visibility rule in household-routes.cjs), so the choice mostly decides
 * whose Google calendar and whose timezone the schedule is rendered in.
 *
 * Auth for the money half: /owner/budget is owner-gated. We mint an owner
 * session via the internal endpoint (POST /api/auth/internal-session,
 * x-internal-token), set it as the cbe_session cookie in a headless Chromium,
 * then screenshot the page exactly as the owner sees it. The same cookie is
 * reused to read /api/budget for the written numbers. Email goes out through
 * Resend (same provider as the app).
 *
 * Requires (in .env.local): INTERNAL_API_TOKEN, OWNER_USER_ID, RESEND_API_KEY,
 * EMAIL_FROM, BUDGET_EMAIL_TO, DATABASE_URL, and (in Docker)
 * PUPPETEER_EXECUTABLE_PATH → /usr/bin/chromium. Never throws out of the tick —
 * a bad morning just logs.
 */

const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim();
const FROM_EMAIL = (process.env.EMAIL_FROM || 'CB Edge <hello@cbedge.net>').trim();
// Comma-separated list of recipients, e.g. "a@x.com, b@y.com".
const TO_EMAILS = (process.env.BUDGET_EMAIL_TO || 'bjmuzila@gmail.com')
  .split(',').map((s) => s.trim()).filter(Boolean);
const INTERNAL_API_TOKEN = (process.env.INTERNAL_API_TOKEN || '').trim();
const CHROME_PATH = (process.env.PUPPETEER_EXECUTABLE_PATH || '').trim();
// Whose household rows to read. See the header.
const BRIEF_HH_EMAIL = (process.env.BRIEF_HH_EMAIL || '').trim().toLowerCase();

// ═══════════════════════════════════════════════════════════════════════════
// Design tokens — the v3 dashboard palette
// ═══════════════════════════════════════════════════════════════════════════
//
// These are cbedge-v3's tokens (`cbedge-v3/src/design/tokens.css`), not the old
// v2 email colours. THIS BLOCK IS THE ONLY PLACE A HEX MAY APPEAR in this file;
// every value below carries the v3 token it came from, so a palette move over
// there is a mechanical edit here.
//
// ── WHY LITERALS AND NOT var(--color-…) ────────────────────────────────────
//
// v3's rule is that no colour literal appears outside tokens.css, and
// `design/theme.ts` is the sanctioned bridge for the rare place a page needs a
// colour as a JS string. Neither is reachable here, for two separate reasons:
//
//   1. This file runs in server-v2, a plain Node process. It cannot import a
//      Vite app's TypeScript, and even if it could, `T.bg` resolves to the
//      STRING "var(--color-bg)", which is meaningful only inside a document
//      that loaded tokens.css.
//   2. The output is an EMAIL. Mail clients don't load a stylesheet from the
//      sender, several strip <style> blocks entirely, and Outlook's Word
//      renderer supports neither CSS custom properties nor color-mix(). An
//      inline `color:var(--color-fg)` there is not a fallback — it's black text
//      on a black card.
//
// So the values are resolved at authoring time, right here, and nowhere else.
//
// ── THE TEXT RAMP ──────────────────────────────────────────────────────────
//
// v3 sets fg/muted/faint ALL to #ffffff and gets hierarchy from opacity over
// the surface. `opacity` and rgba() are exactly the two things Outlook's
// renderer drops, so the ramp is pre-FLATTENED instead: white at v3's opacity,
// composited over --color-surface (#0f1117), as an opaque hex. Same pixels,
// no runtime compositing. Recompute if --color-surface moves.

const C = {
  bg: '#07080b',      // --color-bg       page canvas
  card: '#0f1117',    // --color-surface  cards, panels
  cardAlt: '#14171d', // --color-surface2 nested rows, table headers
  raised: '#191b22',  // --color-raised   hovered / elevated
  line: '#23272e',    // --color-line     hairline borders and dividers

  ink: '#ffffff',     // --color-fg
  dim: '#d4d4d5',     // --color-fg @ 82% over surface — body copy
  mute: '#a4a5a7',    // --color-muted @ 62% — labels, dates, secondary
  faint: '#6a6b6f',   // --color-faint @ 38% — footer, watermarks
  hairInk: '#525458', // white @ 28% — separator dots between tally items
  hollow: '#484a4f',  // white @ 22% — an unchecked routine's ring

  green: '#22c55e',   // --color-up       the settled positive (2026-09-10)
  red: '#e0645f',     // --color-down
  amber: '#e0a44a',   // --color-warn
  blue: '#5b8cff',    // --color-accent   the UI accent
  info: '#4fb8d4',    // --color-series-5 v3's one card accent (v2's LIGHT_BLUE)
};

// The three states a card can be in. Fill and edge are the semantic colour at
// 16% / 42% over --color-bg, flattened for the same reason the text ramp is.
const TONE = {
  good: { bg: '#0b2618', bd: '#12572e', fg: C.green },
  warn: { bg: '#2a2115', bd: '#624a25', fg: C.amber },
  bad:  { bg: '#2a1718', bd: '#622f2e', fg: C.red },
};
const F = "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Every string that came out of the database or a calendar goes through this
// before it lands in the markup. A meal called "Mac & Cheese <3" used to break
// the layout; a task title is user input and must not be able to inject markup.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Panels are <table>, not <div> — Outlook drops border-radius/padding off a div
// often enough that the whole briefing would come apart in exactly the client
// least likely to be forgiven for it.
function panel(innerRows, { pad = '0' } = {}) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" ` +
    `style="width:100%;border-collapse:separate;background:${C.card};border-radius:12px;padding:${pad}">` +
    `${innerRows}</table>`;
}

function sectionLabel(text, right = '') {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse">` +
    `<tr><td style="padding:20px 2px 7px;font:700 11px ${F};color:${C.mute};letter-spacing:.11em;text-transform:uppercase">${esc(text)}</td>` +
    `<td style="padding:20px 2px 7px;text-align:right;font:700 11px ${F};color:${C.mute};letter-spacing:.04em">${right}</td></tr>` +
    `</table>`;
}

function banner(tone, headline, subline, extra = '') {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" ` +
    `style="width:100%;border-collapse:separate;background:${tone.bg};border:1px solid ${tone.bd};border-radius:12px">` +
    `<tr><td style="padding:14px 16px">` +
      `<div style="font:800 20px ${F};color:${tone.fg};line-height:1.25">${headline}</div>` +
      (subline ? `<div style="font:500 13px ${F};color:${C.mute};margin-top:5px">${subline}</div>` : '') +
      extra +
    `</td></tr></table>`;
}

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

// Today, in whichever timezone the household user keeps. Not UTC: a task due
// "today" must not flip to overdue at 8pm ET.
function todayIn(tz) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t)?.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
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

// ═══════════════════════════════════════════════════════════════════════════
// Household side — schedule, tasks, routines, lists
// ═══════════════════════════════════════════════════════════════════════════
//
// Loaded lazily and each one optionally. This module is required at boot by
// server-with-proxy.js; a household lib that throws on require must not be able
// to take the dashboard process down with it.

function opt(mod) {
  try { return require(mod); } catch (e) {
    console.warn(`[budget-email] ${mod} unavailable:`, e.message);
    return null;
  }
}

/** The hh_users row whose calendar / timezone the briefing is rendered for. */
async function resolveHhUser(hh) {
  const users = await hh.listUsers();
  const active = users.filter((u) => u.active !== false);
  if (!active.length) return null;
  const want = BRIEF_HH_EMAIL || (TO_EMAILS[0] || '').toLowerCase();
  return active.find((u) => String(u.email || '').toLowerCase() === want) || active[0];
}

/**
 * Today's calendar, Google + subscribed ICS feeds, merged the same way
 * household-routes.cjs merges them for the Today screen. Returns a shaped
 * object even on failure — the section renders "couldn't reach the calendar"
 * rather than an empty day, which is the one lie a schedule must not tell.
 */
async function calendarDay(user, date) {
  const gcal = opt('./_lib-google-calendar.cjs');
  const icsFeeds = opt('./_lib-ics-feeds.cjs');

  const g = gcal
    ? await gcal.eventsForDay(user.id, user.tz, date).catch((e) => ({ error: String(e?.message || e), events: [] }))
    : { events: [], error: 'not-configured' };

  let f = null;
  if (icsFeeds && icsFeeds.available()) {
    try { f = await icsFeeds.eventsForDay(user.id, user.tz, date); } catch { f = null; }
  }
  if (!f || !f.feedCount) return { date, events: g.events || [], upcoming: g.upcoming || [], error: g.error };

  const startKey = (e) => `${e.allDay ? '0' : '1'}${String(e.start)}`;
  const events = [...(g.events || []), ...f.events]
    .sort((a, b) => startKey(a).localeCompare(startKey(b))).slice(0, 40);
  const upcoming = [...(g.upcoming || []), ...f.upcoming]
    .sort((a, b) => String(a.start).localeCompare(String(b.start))).slice(0, 5);
  const error = (g.error && !events.length && !upcoming.length) ? g.error : undefined;
  return { date, events, upcoming, error };
}

/** "8:30a" / "12p" — short enough to sit in a narrow gutter column. */
function clockLabel(iso, tz) {
  try {
    const s = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(iso));
    return s.replace(':00', '').replace(' AM', 'a').replace(' PM', 'p');
  } catch { return ''; }
}

function scheduleSection(cal, tz) {
  if (!cal) return { html: '', count: 0 };
  const events = cal.events || [];
  if (cal.error && !events.length) {
    // Say WHY it's empty. A silent blank reads as "nothing on today", and acting
    // on that is exactly the mistake this section exists to prevent.
    const why = cal.error === 'not-configured' || cal.error === 'not-connected'
      ? 'Calendar not connected.' : `Calendar unavailable (${esc(cal.error)}).`;
    return {
      count: 0,
      html: sectionLabel('Today') + panel(
        `<tr><td style="padding:14px 16px;font:600 13px ${F};color:${C.mute}">${why}</td></tr>`),
    };
  }
  if (!events.length) {
    return {
      count: 0,
      html: sectionLabel('Today') + panel(
        `<tr><td style="padding:14px 16px;font:600 13px ${F};color:${C.dim}">Nothing on the calendar. The day is yours.</td></tr>`),
    };
  }
  const rows = events.slice(0, 10).map((e, i) => {
    const when = e.allDay ? 'all&nbsp;day' : clockLabel(e.start, tz);
    const bd = i ? `border-top:1px solid ${C.line};` : '';
    const dot = e.colour
      ? `<span style="display:inline-block;width:8px;height:8px;border-radius:8px;background:${esc(e.colour)};margin-right:8px"></span>`
      : '';
    return `<tr>` +
      `<td width="66" style="${bd}padding:10px 0 10px 16px;font:700 12px ${F};color:${e.allDay ? C.mute : C.blue};white-space:nowrap;vertical-align:top">${when}</td>` +
      `<td style="${bd}padding:10px 16px 10px 10px;vertical-align:top">` +
        `<div style="font:600 14px ${F};color:${C.ink};line-height:1.3">${dot}${esc(e.summary)}</div>` +
        (e.location ? `<div style="font:500 12px ${F};color:${C.mute};margin-top:2px">${esc(e.location)}</div>` : '') +
      `</td></tr>`;
  }).join('');
  const more = events.length > 10
    ? `<tr><td colspan="2" style="border-top:1px solid ${C.line};padding:8px 16px;font:600 12px ${F};color:${C.mute}">+${events.length - 10} more</td></tr>`
    : '';
  return {
    count: events.length,
    html: sectionLabel('Today', `${events.length} event${events.length === 1 ? '' : 's'}`) + panel(rows + more),
  };
}

/**
 * Focus — the starred three, then anything overdue or due today that isn't
 * already up there. Capped hard: a briefing that lists forty open tasks is a
 * backlog, and nobody reads their backlog at 8am.
 */
async function focusSection(hh, user, today) {
  const p = hh.pool();
  const VISIBLE = `(owner_id = $1 OR visibility = 'shared')`;
  const COLS = `id, title, to_char(due_date, 'YYYY-MM-DD') AS due_date, starred, project, urgent`;
  const ORDER = `ORDER BY urgent DESC, starred DESC, due_date NULLS LAST, id`;

  const [{ rows: top3 }, { rows: dated }, { rows: [counts] }] = await Promise.all([
    p.query(`SELECT ${COLS} FROM hh_tasks WHERE ${VISIBLE} AND done_at IS NULL AND starred = TRUE ${ORDER} LIMIT 3`, [user.id]),
    p.query(`SELECT ${COLS} FROM hh_tasks WHERE ${VISIBLE} AND done_at IS NULL AND starred = FALSE
              AND due_date IS NOT NULL AND due_date <= $2::date ${ORDER} LIMIT 6`, [user.id, today]),
    p.query(`SELECT
               COUNT(*) FILTER (WHERE done_at IS NULL)::int AS open,
               COUNT(*) FILTER (WHERE done_at IS NULL AND due_date < $2::date)::int AS overdue,
               COUNT(*) FILTER (WHERE done_at IS NULL AND due_date = $2::date)::int AS due_today
             FROM hh_tasks WHERE ${VISIBLE}`, [user.id, today]),
  ]);

  const items = [...top3, ...dated];
  if (!items.length && !(counts?.open)) return { html: '', counts: counts || {} };

  const row = (t, i) => {
    const bd = i ? `border-top:1px solid ${C.line};` : '';
    let badge = '';
    if (t.due_date && t.due_date < today) badge = `<span style="color:${C.red};font:700 11px ${F}"> · overdue</span>`;
    else if (t.due_date === today) badge = `<span style="color:${C.amber};font:700 11px ${F}"> · today</span>`;
    const mark = t.starred
      ? `<span style="color:${C.amber};font:700 13px ${F};margin-right:9px">★</span>`
      : `<span style="color:${C.mute};font:700 13px ${F};margin-right:9px">·</span>`;
    return `<tr><td style="${bd}padding:10px 16px">` +
      `<div style="font:600 14px ${F};color:${C.ink};line-height:1.3">${mark}${esc(t.title)}${badge}</div>` +
      (t.project ? `<div style="font:500 12px ${F};color:${C.mute};margin-top:2px;padding-left:22px">${esc(t.project)}</div>` : '') +
      `</td></tr>`;
  };

  const tally = [];
  if (counts?.overdue) tally.push(`<span style="color:${C.red}">${counts.overdue} overdue</span>`);
  if (counts?.due_today) tally.push(`<span style="color:${C.amber}">${counts.due_today} due today</span>`);
  tally.push(`<span style="color:${C.mute}">${counts?.open || 0} open</span>`);

  const body = items.length
    ? items.map(row).join('')
    : `<tr><td style="padding:14px 16px;font:600 13px ${F};color:${C.dim}">Nothing starred and nothing due. Pick your own fight today.</td></tr>`;

  return {
    counts: counts || {},
    html: sectionLabel('Focus', tally.join(`<span style="color:${C.hairInk}"> · </span>`)) + panel(body),
  };
}

/**
 * Routines — the morning block in full (it's the one you can still act on at
 * 8am), afternoon and evening as a count only.
 */
async function routinesSection(hroutines, user, today) {
  const r = await hroutines.getRoutines(user.id, user.tz, today);
  if (!r || !r.total) return { html: '', done: 0, total: 0 };

  const blocks = r.blocks || [];
  const morning = blocks.find((b) => b.block === 'morning');
  const rest = blocks.filter((b) => b.block !== 'morning' && b.total);

  let body = '';
  if (morning && morning.total) {
    body += morning.items.map((it, i) => {
      const bd = i ? `border-top:1px solid ${C.line};` : '';
      const box = it.done
        ? `<span style="color:${C.green};font:700 14px ${F};margin-right:9px">✓</span>`
        : `<span style="color:${C.hollow};font:700 14px ${F};margin-right:9px">○</span>`;
      const streak = it.streak > 1
        ? `<span style="color:${C.mute};font:600 11px ${F}"> · ${it.streak}d streak</span>` : '';
      // The strike goes on the TITLE only — striking the streak with it read as
      // "this streak is over", which is the opposite of what a done item means.
      const title = it.done
        ? `<span style="text-decoration:line-through">${esc(it.title)}</span>`
        : esc(it.title);
      return `<tr><td style="${bd}padding:9px 16px;font:600 14px ${F};color:${it.done ? C.mute : C.ink};` +
        `line-height:1.3">${box}${title}${streak}</td></tr>`;
    }).join('');
  }
  if (rest.length) {
    const later = rest.map((b) => `${b.block} ${b.done}/${b.total}`).join(' · ');
    body += `<tr><td style="border-top:1px solid ${C.line};padding:9px 16px;font:600 12px ${F};color:${C.mute};text-transform:capitalize">${esc(later)}</td></tr>`;
  }
  if (!body) return { html: '', done: r.doneToday, total: r.total };

  const head = morning && morning.total ? `${morning.done}/${morning.total} this morning` : `${r.doneToday}/${r.total} today`;
  return {
    done: r.doneToday,
    total: r.total,
    html: sectionLabel('Routines', head) + panel(body),
  };
}

/** Kitchen — what's for dinner, and what still has to be bought for it. */
async function kitchenSection(hlists, user, today) {
  const week = await hlists.getWeek(user.id, user.tz, today);
  if (!week) return { html: '', groceryOpen: 0 };

  const day = (week.days || []).find((d) => d.day === today);
  const tonight = day && day.meals && day.meals.length
    ? day.meals.map((m) => m.title).filter(Boolean).join(', ')
    : null;
  const openItems = (week.aisles || []).flatMap((a) => a.items || []);
  const openCount = week.counts?.open ?? openItems.length;

  if (!tonight && !openCount) return { html: '', groceryOpen: 0 };

  let body = '';
  if (tonight) {
    body += `<tr><td style="padding:12px 16px">` +
      `<div style="font:700 11px ${F};color:${C.mute};letter-spacing:.08em">DINNER</div>` +
      `<div style="font:700 15px ${F};color:${C.ink};margin-top:3px">${esc(tonight)}</div></td></tr>`;
  }
  if (openCount) {
    // Names, not just a count: "6 things to buy" makes you open the app, and the
    // whole point of the briefing is that you don't have to.
    const names = openItems.slice(0, 8).map((i) => esc(i.text)).join(' · ');
    const more = openItems.length > 8 ? ` <span style="color:${C.mute}">+${openItems.length - 8}</span>` : '';
    body += `<tr><td style="${tonight ? `border-top:1px solid ${C.line};` : ''}padding:12px 16px">` +
      `<div style="font:700 11px ${F};color:${C.mute};letter-spacing:.08em">GROCERIES · ${openCount} OPEN</div>` +
      (names ? `<div style="font:600 13px ${F};color:${C.dim};margin-top:4px;line-height:1.5">${names}${more}</div>` : '') +
      `</td></tr>`;
  }
  return { groceryOpen: openCount, html: sectionLabel('Kitchen') + panel(body) };
}

/**
 * Everything above the money, in one call. Individually wrapped: one broken
 * section is a missing block, never a missing email.
 */
async function buildBriefing() {
  const empty = { html: '', glance: {}, tz: 'America/New_York' };
  const hh = opt('./_lib-household.cjs');
  if (!hh || !hh.available || !hh.available()) return empty;

  let user = null;
  try { user = await resolveHhUser(hh); }
  catch (e) { console.warn('[budget-email] household user lookup failed:', e.message); }
  if (!user) return empty;

  const tz = user.tz || 'America/New_York';
  const today = todayIn(tz);
  const hroutines = opt('./_lib-household-routines.cjs');
  const hlists = opt('./_lib-household-lists.cjs');

  const safe = (label, fn, fallback) => fn().catch((e) => {
    console.warn(`[budget-email] ${label} section skipped:`, e?.message || e);
    return fallback;
  });

  const [cal, focus, routines, kitchen] = await Promise.all([
    safe('schedule', () => calendarDay(user, today), null),
    safe('focus', () => focusSection(hh, user, today), { html: '', counts: {} }),
    hroutines && hroutines.available()
      ? safe('routines', () => routinesSection(hroutines, user, today), { html: '', done: 0, total: 0 })
      : Promise.resolve({ html: '', done: 0, total: 0 }),
    hlists && hlists.available()
      ? safe('kitchen', () => kitchenSection(hlists, user, today), { html: '', groceryOpen: 0 })
      : Promise.resolve({ html: '', groceryOpen: 0 }),
  ]);

  const schedule = scheduleSection(cal, tz);
  return {
    tz,
    today,
    html: schedule.html + focus.html + routines.html + kitchen.html,
    glance: {
      events: schedule.count,
      overdue: focus.counts?.overdue || 0,
      dueToday: focus.counts?.due_today || 0,
      routines: routines.total ? `${routines.done}/${routines.total}` : null,
      grocery: kitchen.groceryOpen || 0,
    },
  };
}

/**
 * The four-tile strip under the verdict. Deliberately a fixed-layout table:
 * flex/grid collapse unpredictably in Outlook and this is the one row where a
 * wrap would look broken rather than merely tall.
 */
function glanceStrip(tiles) {
  const shown = tiles.filter(Boolean);
  if (!shown.length) return '';
  const w = Math.floor(100 / shown.length);
  const cells = shown.map(([k, v, color], i) =>
    `<td width="${w}%" style="padding:12px 6px;text-align:center;${i ? `border-left:1px solid ${C.line};` : ''}">` +
    `<div style="font:800 19px ${F};color:${color || C.ink};line-height:1.1">${v}</div>` +
    `<div style="font:700 10px ${F};color:${C.mute};letter-spacing:.08em;margin-top:4px">${esc(k)}</div></td>`
  ).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" ` +
    `style="width:100%;border-collapse:collapse;background:${C.card};border-radius:12px;margin-top:12px">` +
    `<tr>${cells}</tr></table>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Money
// ═══════════════════════════════════════════════════════════════════════════

// Port of the /owner/budget Rent card's rentInfo: project cash flow to the 5th
// (every other income + expense landing before rent) so we can answer whether
// rent is covered when it's due. Keep in sync with owner-vite/src/pages/Budget.tsx.
//
// `settled` carries the occurrences marked "already cleared / not coming" on
// the card (budget_flow_settled, returned by /api/budget as settledFlows).
// Skipping them is not cosmetic: `allBanks` is the CURRENT bank balance, so a
// paycheque that already landed is inside it, and adding the scheduled
// occurrence on top counts the same money twice. That is what made this email
// the most optimistic of the three surfaces.
function computeRent(register, recurring, allBanks, today, settled = new Set()) {
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
    if (settled.has(`row:${r.id}`)) continue;
    flows.push({ label: r.label, amount: r.amount, date: r.entry_date });
  }
  for (const rule of recurring) {
    if (!rule.active) continue;
    for (const ym of months) {
      for (const date of occurrencesInMonth(rule, ym)) {
        const tag = `__recur__:${rule.id}:${date}`;
        if (!inWindow(date) || materialized.has(tag) || settled.has(tag)) continue;
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
    `<tr><td style="padding:2px 16px;font:500 12px ${F};color:${C.mute}">${esc(f.label)} · ${f.date.slice(5)}</td>` +
    `<td style="padding:2px 16px;text-align:right;font:700 12px ${F};color:${color}">${sign}${fmt(Math.abs(f.amount))}</td></tr>`
  ).join('');
  const groupHead = (text, total, color) =>
    `<tr><td colspan="2" style="padding:11px 16px 2px;font:700 10px ${F};color:${C.mute};letter-spacing:.08em">` +
    `${text} <span style="color:${color}">${total}</span></td></tr>`;
  const row = (k, v, color) =>
    `<tr><td style="padding:4px 16px;font:600 13px ${F};color:${C.mute}">${k}</td>` +
    `<td style="padding:4px 16px;text-align:right;font:800 14px ${F};color:${color}">${v}</td></tr>`;

  let tone, headline, subline;
  if (paid) {
    tone = TONE.good;
    headline = 'Rent is paid for this month.';
    subline = '';
  } else if (projected >= rentAmount) {
    tone = TONE.good;
    headline = "Enough coming in — rent's covered.";
    subline = `${fmt(projected - rentAmount)} to spare after rent on the 5th.`;
  } else {
    tone = TONE.bad;
    headline = `Still short by ${fmt(shortfall)}`;
    subline = daysUntil > 0 ? `${fmt(perDay)}/day extra needed before the 5th.` : 'Rent is due.';
  }

  const head = `Due ${dueIso.slice(5)}${paid ? '' : ` · ${daysUntil} day${daysUntil === 1 ? '' : 's'}`}`;
  return sectionLabel('Rent', head) +
    panel(
      `<tr><td colspan="2" style="height:10px"></td></tr>` +
      row('Rent', fmt(rentAmount), C.ink) +
      row('On hand now', fmt(available), C.ink) +
      (incoming.length ? groupHead('COMING IN BEFORE THEN', `+${fmt(incomingTotal)}`, C.green) + list(incoming, '+', C.green) : '') +
      (outgoing.length ? groupHead('GOING OUT BEFORE THEN', `-${fmt(outgoingTotal)}`, C.red) + list(outgoing, '-', C.red) : '') +
      `<tr><td style="border-top:1px solid ${C.line};padding:10px 16px;font:700 13px ${F};color:${C.mute}">Projected on the 5th</td>` +
      `<td style="border-top:1px solid ${C.line};padding:10px 16px;text-align:right;font:800 16px ${F};color:${C.blue}">${fmt(projected)}</td></tr>`
    ) +
    `<div style="height:8px"></div>` +
    banner(tone, headline, subline);
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

// ── the money half, from /api/budget ────────────────────────────────────────
async function buildMoney(base, cookie, month) {
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
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const allBanks = db ? (db.coastal || 0) + (db.truist || 0) + (db.secu || 0) : 0;

  // Occurrences marked "already cleared / not coming" on the Rent card. They
  // are excluded EVERYWHERE below for the same reason: `allBanks` is the bank
  // balance as it stands, so anything already inside it must not be added or
  // subtracted a second time. Without this the email is the only surface still
  // double-counting an early paycheque.
  const settled = new Set(Array.isArray(d.settledFlows) ? d.settledFlows.map(String) : []);

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
      if (paid.has(tag) || settled.has(tag)) continue;
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
      if (paid.has(tag) || settled.has(tag)) continue;
      incoming.push({ label: rule.label, amount: rule.amount, date, late: date < today });
    }
  }
  incoming.sort((a, b) => (a.date < b.date ? -1 : 1));
  const coming = incoming.reduce((s, b) => s + b.amount, 0);

  // What's actually spendable this month: bank + pay still to land, against
  // everything still due.
  const available = allBanks + coming;
  const after = available - owed;

  const rentHtml = rentSection(computeRent(register, recurring, allBanks, today, settled));

  // The headline: can we cover what's still due this month, and is it safe to spend?
  let tone, verdict, sub;
  if (after < 0) {
    tone = TONE.bad;
    verdict = `Short by ${fmt(Math.abs(after))} — don't spend`;
    sub = `${fmt(available)} available (${fmt(allBanks)} in the bank + ${fmt(coming)} pay coming) vs ${fmt(owed)} still due this month.`;
  } else if (after < SAFE_BUFFER) {
    tone = TONE.warn;
    verdict = 'Too close — don’t spend';
    sub = `Only ${fmt(after)} left after ${fmt(owed)} of bills. Cushion is ${fmt(SAFE_BUFFER)}.`;
  } else {
    tone = TONE.good;
    verdict = `Covered — ${fmt(after)} spare`;
    sub = `${fmt(available)} available (${fmt(allBanks)} in the bank + ${fmt(coming)} pay coming) covers ${fmt(owed)} of remaining bills.`;
  }

  // Money in, money out, what's left — pay included so the month balances.
  const rows = [
    ['In the bank', fmt(allBanks), C.ink, false],
    ['Pay coming (mo)', `+${fmt(coming)}`, C.green, false],
    ['Income (mo)', fmt(available), C.blue, true],
    ['Still due (mo)', fmt(owed), C.red, false],
    ['Left after bills', fmt(after), tone.fg, true],
  ];
  const cells = rows.map(([k, v, color, hi]) =>
    `<tr${hi ? ` style="background:${C.cardAlt}"` : ''}>` +
    `<td style="padding:8px 16px;color:${C.mute};font:600 13px ${F}">${k}</td>` +
    `<td style="padding:8px 16px;text-align:right;font:800 15px ${F};color:${color}">${v}</td></tr>`
  ).join('');

  const flowRow = (b, color, sign, note) =>
    `<tr><td width="58" style="padding:6px 0 6px 16px;color:${note.color};font:600 12px ${F};white-space:nowrap">${b.date.slice(5)}</td>` +
    `<td style="padding:6px 10px;color:${C.ink};font:600 13px ${F}">${esc(b.label)}` +
    (note.text ? `<span style="color:${note.color};font:600 11px ${F}"> · ${note.text}</span>` : '') + `</td>` +
    `<td style="padding:6px 16px;text-align:right;color:${color};font:800 13px ${F}">${sign}${fmt(b.amount)}</td></tr>`;

  const nextBills = bills.slice(0, 6)
    .map((b) => flowRow(b, C.red, '', { text: b.pastDue ? 'past due' : '', color: b.pastDue ? C.red : C.mute })).join('');
  const nextPay = incoming.slice(0, 6)
    .map((b) => flowRow(b, C.green, '+', { text: b.late ? 'not in yet' : '', color: b.late ? C.amber : C.mute })).join('');

  const pastDueLine = pastDue.length
    ? `<div style="font:700 12px ${F};color:${C.red};margin-top:7px">${pastDue.length} payment${pastDue.length === 1 ? '' : 's'} past due — ${fmt(pastDue.reduce((s, b) => s + b.amount, 0))}</div>`
    : '';

  // Banner and detail are returned SEPARATELY, not as one blob the caller has
  // to slice apart: the verdict goes at the very top of the email, above the
  // schedule, and the tables it summarises go at the bottom under MONEY.
  return {
    bannerHtml: banner(tone, esc(verdict), esc(sub), pastDueLine),
    detailHtml:
      sectionLabel('This month', esc(monthLabel)) +
      panel(cells) +
      (nextPay ? sectionLabel('Pay coming in') + panel(nextPay) : '') +
      (nextBills ? sectionLabel('Still due') + panel(nextBills) : '') +
      rentHtml,
    verdict,
    after,
    tone,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// The email
// ═══════════════════════════════════════════════════════════════════════════

function compose({ dateLine, dayLabel, money, briefing, hasShot }) {
  const g = briefing.glance || {};
  // Four at most, and only the ones that have something to say. A tile reading
  // "0" for a section the household doesn't use is worse than no tile.
  const tiles = [
    ['LEFT AFTER BILLS', fmt(money.after), money.tone.fg],
    g.events != null ? ['ON THE CALENDAR', String(g.events), g.events ? C.blue : C.mute] : null,
    (g.overdue || g.dueToday)
      ? ['TASKS DUE', String((g.overdue || 0) + (g.dueToday || 0)), g.overdue ? C.red : C.amber]
      : null,
    g.routines ? ['ROUTINES', g.routines, C.green] : null,
  ];

  return (
    `<div style="background:${C.bg};padding:22px 18px;font-family:${F}">` +
    `<div style="max-width:600px;margin:0 auto">` +
      `<div style="font:800 22px ${F};color:${C.ink};letter-spacing:-.01em">Good morning.</div>` +
      `<div style="font:600 13px ${F};color:${C.mute};margin-top:4px">${esc(dateLine)} · 8:00 AM ET</div>` +
      `<div style="height:16px"></div>` +
      // MONEY FIRST, in full — verdict, the month's tables, rent, the board.
      // This email is opened to answer "can I spend today"; the schedule and the
      // lists are what you read once that's settled, so they sit underneath.
      // Do not "balance" the layout by moving the budget back down.
      money.bannerHtml +
      glanceStrip(tiles) +
      money.detailHtml +
      // The board is a nicety. When chromium fails the section goes away rather
      // than emailing a broken-image icon.
      (hasShot
        ? sectionLabel('Budget board') +
          `<img src="cid:overview" alt="Budget board" style="width:100%;border-radius:12px;border:1px solid ${C.line}" />`
        : '') +
      // Then the rest of the morning, under a rule so the switch from money to
      // day is obvious at a glance rather than one more section heading.
      (briefing.html
        ? `<div style="height:22px"></div>` +
          `<div style="border-top:1px solid ${C.line}"></div>` +
          `<div style="font:700 11px ${F};color:${C.mute};letter-spacing:.11em;padding:18px 2px 0">YOUR DAY · ${esc(dayLabel.toUpperCase())}</div>` +
          briefing.html
        : '') +
      `<div style="font:500 11px ${F};color:${C.faint};margin-top:18px;text-align:center">CB Edge · budget.cbedge.net</div>` +
    `</div></div>`
  );
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
  const attachments = shot
    ? [{ filename: 'budget.png', content: Buffer.from(shot).toString('base64'), content_id: 'overview' }]
    : [];
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

  // The briefing is gathered alongside the money and can fail on its own — the
  // email goes out either way, just shorter.
  const [money, briefing] = await Promise.all([
    buildMoney(base, cookie, month),
    buildBriefing().catch((e) => {
      console.warn('[budget-email] briefing skipped:', e?.message || e);
      return { html: '', glance: {} };
    }),
  ]);

  // A screenshot failure is no longer fatal either: chromium is the flakiest
  // dependency here and the written briefing is worth more than the picture.
  let shot = null;
  try { shot = await captureShot(base, cookie); }
  catch (e) { console.warn('[budget-email] screenshot failed, sending without it:', e?.message || e); }

  const dateLine = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric',
  });
  const dayLabel = dateLine.split(',')[0];

  const html = compose({ dateLine, dayLabel, money, briefing, hasShot: !!shot });

  // Subject stays generic on purpose — the numbers and the verdict live inside
  // the email, not on a lock screen anyone can read over your shoulder.
  await send(html, `Morning briefing — ${dateLine}`, shot);
  console.log(`[budget-email] sent ${dateLine} (${money.verdict}) → ${TO_EMAILS.join(', ')}`);
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
  console.log('[budget-email] enabled — daily 08:00 ET morning briefing');
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
