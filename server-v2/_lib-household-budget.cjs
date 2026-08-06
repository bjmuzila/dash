'use strict';
/**
 * server-v2/_lib-household-budget.cjs — the budget, for budget.cbedge.net.
 *
 * READS THE SAME TABLES AS /owner/budget. There is no second budget, no copy,
 * no sync. `app/owner/budget/page.tsx` on cbedge.net and the phone screen here
 * are two views of one set of rows, so a payment entered on either shows up on
 * the other immediately.
 *
 * HOW THAT WORKS WITHOUT A MIGRATION
 *   The budget tables were already multi-profile: every row is scoped by
 *   profile_id, and /api/budget has always resolved it via
 *   getOrCreateBudgetProfile('owner'). A household user carries
 *   budget_profile_key, defaulting to 'owner' — so both accounts land on the
 *   existing profile and see the existing register. Point someone at another
 *   key and they get a private budget instead. No ALTER TABLE, no backfill.
 *
 * ── THE PART THAT MUST NOT DRIFT ──────────────────────────────────────────
 * Recurring bills are NOT rows. They are rules, expanded into occurrences at
 * read time, and an occurrence only becomes a real row once someone marks it
 * paid (or edits it) — "materialising" it under the tag
 *
 *     __recur__:<ruleId>:<YYYY-MM-DD>
 *
 * `occurrencesInMonth` and that tag format below are ported verbatim from
 * app/owner/budget/page.tsx. If the two implementations ever disagree, a bill
 * marked paid on the phone will still show unpaid on the desktop and get paid
 * twice — or a synthetic occurrence will sit alongside its own materialised row
 * and double-count against the balance. The parity tests exist for this.
 */

let libDb = null;
try { libDb = require('./_lib-db.cjs'); }
catch (e) { console.warn('[hh-budget] _lib-db.cjs not loaded — budget routes off:', e.message); }

const BANKS = ['coastal', 'truist', 'secu'];
const normBank = (v) => (v === 'coastal' || v === 'truist' ? v : 'secu');

const available = () => !!libDb;

// ── Date helpers — ported verbatim from the desktop page ────────────────────

const pad = (n) => String(n).padStart(2, '0');

function isoDate(dt) {
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + days));
}

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${pad(lastDay)}`, lastDay };
}

/** "YYYY-MM" for right now, in the household timezone. */
function currentMonth(tz = 'America/New_York') {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  const m = {};
  p.forEach((x) => { m[x.type] = x.value; });
  return `${m.year}-${m.month}`;
}

function todayIn(tz = 'America/New_York') {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const m = {};
  p.forEach((x) => { m[x.type] = x.value; });
  return `${m.year}-${m.month}-${m.day}`;
}

/**
 * Every date a recurring rule fires within "YYYY-MM".
 *
 * VERBATIM PORT of occurrencesInMonth() in app/owner/budget/page.tsx. Monthly
 * clamps the anchor's day-of-month to the month length (a rule anchored on the
 * 31st fires on the 30th in April, and the 28th in February). Weekly/biweekly
 * walk back from the anchor to before the month, then step forward through it.
 * The guard of 10 is the desktop's, kept so both produce the same list even in
 * the pathological cases.
 */
function occurrencesInMonth(rule, month) {
  const { from: first, to: last, lastDay } = monthRange(month);
  const out = [];

  if (rule.frequency === 'monthly') {
    const day = Math.min(Number(String(rule.anchor_date).split('-')[2]), lastDay);
    out.push(`${month}-${pad(day)}`);
    return out;
  }

  const step = rule.frequency === 'weekly' ? 7 : 14;
  let cursor = String(rule.anchor_date).slice(0, 10);
  while (cursor > first) cursor = addDays(cursor, -step);
  while (cursor < first) cursor = addDays(cursor, step);
  let guard = 0;
  while (cursor <= last && guard < 10) {
    out.push(cursor);
    cursor = addDays(cursor, step);
    guard++;
  }
  return out;
}

const recurTag = (ruleId, date) => `__recur__:${ruleId}:${date}`;

// ── Profile ─────────────────────────────────────────────────────────────────

async function profileFor(profileKey) {
  const key = String(profileKey || 'owner');
  // adopt + getOrCreate mirrors exactly what /api/budget does, so the household
  // app lands on the same profile row rather than quietly creating a second one.
  await libDb.adoptDefaultBudgetProfile(key);
  return libDb.getOrCreateBudgetProfile(key);
}

// ── Read ────────────────────────────────────────────────────────────────────

/**
 * The whole budget screen for one month, composed server-side.
 *
 * Mirrors the desktop page's `computed` memo: seed per-bank beginning balances,
 * merge manual rows with live-expanded recurring occurrences, skip any
 * occurrence that has been materialised, sort by date, then run the balance.
 */
async function getMonth(profileKey, month, tz = 'America/New_York') {
  const profile = await profileFor(profileKey);
  const m = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : currentMonth(tz);
  const { from, to } = monthRange(m);
  const today = todayIn(tz);

  const [categories, register, recurring, dailyBalance] = await Promise.all([
    libDb.listBudgetCategories(profile.id),
    libDb.listRegister(profile.id, from, to),
    libDb.listRecurring(profile.id),
    libDb.getLatestDailyBalance(profile.id),
  ]);
  // The anchor for the balance check. The desktop prefers a ~week-old entry and
  // documents falling back to the immediately prior one; only the fallback is
  // reachable through the shared helpers, so that is what this uses.
  // typeof-checked, not just try/caught: a missing export throws SYNCHRONOUSLY
  // at the call, so `.catch()` on the result never runs and the whole month
  // request 500s over one optional card.
  let prevDailyBalance = null;
  if (dailyBalance && typeof libDb.getDailyBalanceBefore === 'function') {
    try { prevDailyBalance = await libDb.getDailyBalanceBefore(profile.id, dailyBalance.day); }
    catch { prevDailyBalance = null; }
  }

  // Per-bank beginning balances come from is_beginning rows.
  const bal = { coastal: 0, truist: 0, secu: 0 };
  const beginningByBank = { coastal: null, truist: null, secu: null };
  for (const r of register) {
    if (r.is_beginning) { bal[r.bank] = r.amount; beginningByBank[r.bank] = r.amount; }
  }
  const anyBeginning = BANKS.some((b) => beginningByBank[b] !== null);

  const lines = register
    .filter((r) => !r.is_beginning)
    .map((r) => ({
      id: r.id, entry_date: r.entry_date, sort_order: r.sort_order, label: r.label,
      bank: r.bank, amount: Number(r.amount), recurring: false,
      category_id: r.category_id ?? null, recurring_tag: r.recurring_tag ?? null,
    }));

  // An occurrence someone edited or marked paid became a real row carrying the
  // tag. Its synthetic twin must be skipped or the month double-counts it.
  const materialised = new Set(
    register
      .filter((r) => !r.is_beginning && typeof r.recurring_tag === 'string' &&
                     r.recurring_tag.startsWith('__recur__:'))
      .map((r) => r.recurring_tag),
  );

  for (const rule of recurring) {
    if (!rule.active) continue;
    for (const date of occurrencesInMonth(rule, m)) {
      const tag = recurTag(rule.id, date);
      if (materialised.has(tag)) continue;
      lines.push({
        // Negative id marks it synthetic — the same scheme the desktop uses, so
        // nothing downstream mistakes it for a real row it can PATCH.
        id: -(rule.id * 100 + Number(date.split('-')[2])),
        entry_date: date, sort_order: 40, label: rule.label, bank: rule.bank,
        amount: Number(rule.amount), recurring: true, recurring_tag: tag, category_id: null,
      });
    }
  }

  lines.sort((a, b) => (a.entry_date < b.entry_date ? -1
                      : a.entry_date > b.entry_date ? 1
                      : a.sort_order - b.sort_order));

  const beginCombined = (beginningByBank.coastal ?? 0) + (beginningByBank.truist ?? 0) + (beginningByBank.secu ?? 0);
  let running = beginCombined;
  let income = 0;
  let payments = 0;
  const rows = [];

  for (const ln of lines) {
    bal[ln.bank] += ln.amount;
    running += ln.amount;
    if (ln.amount > 0) income += ln.amount; else payments += ln.amount;
    rows.push({
      id: ln.id, entry_date: ln.entry_date, label: ln.label, bank: ln.bank,
      amount: ln.amount, recurring: ln.recurring, recurring_tag: ln.recurring_tag,
      category_id: ln.category_id, balance: running,
      balances: { ...bal }, total: bal.coastal + bal.truist + bal.secu,
      // Everything the phone needs to decide whether a row is actionable.
      paid: !ln.recurring,
      past: ln.entry_date < today,
    });
  }

  // Unpaid recurring occurrences, split into overdue and upcoming. This is the
  // "what's about to hit" list — the thing you actually open a budget app for.
  const bills = rows
    .filter((r) => r.recurring)
    .map((r) => ({
      tag: r.recurring_tag, label: r.label, bank: r.bank, amount: r.amount,
      date: r.entry_date, overdue: r.entry_date < today,
    }));

  // Category spend for the month, from real rows only (a projected bill hasn't
  // been spent yet, and counting it would overstate every category).
  const spentByCategory = {};
  let unsorted = 0;
  for (const ln of lines) {
    if (ln.recurring || ln.amount >= 0) continue;
    if (ln.category_id) spentByCategory[ln.category_id] = (spentByCategory[ln.category_id] || 0) + Math.abs(ln.amount);
    else unsorted += Math.abs(ln.amount);
  }

  return {
    month: m,
    today,
    currency: profile.currency || 'USD',
    balances: { ...bal },
    beginning: anyBeginning ? beginningByBank : null,
    dailyBalance: dailyBalance || null,
    totals: {
      income,
      // Stored negative; flipped here so the client never has to remember which.
      expenses: Math.abs(payments),
      net: income + payments,
      endingBalance: running,
    },
    rows,
    bills,
    categories: categories.map((c) => ({
      id: c.id, name: c.name, amount: Number(c.amount), period: c.period, color: c.color,
      spent: spentByCategory[c.id] || 0,
    })),
    unsortedSpend: unsorted,
    recurringCount: recurring.filter((r) => r.active).length,
    overview: buildOverview({
      month: m, today, rows, register, recurring, categories, balances: bal,
      dailyBalance, prevDailyBalance, categorySpend: spentByCategory, unsorted,
    }),
  };
}

// ── Write ───────────────────────────────────────────────────────────────────

/** Whole days between two 'YYYY-MM-DD' strings. UTC on both ends so a DST
 *  boundary between them can't round the result to the wrong day. */
function daysBetween(aIso, bIso) {
  const [ay, am, ad] = aIso.split('-').map(Number);
  const [by, bm, bd] = bIso.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

const CATEGORY_COLOURS = ['#8ECAE6', '#FB8501', '#7dd3fc', '#F6BD60', '#A78BFA', '#EF4444'];

/**
 * Coerce a Postgres DATE to 'YYYY-MM-DD' whichever way the driver hands it over.
 *
 * `pg` hydrates a DATE into a JS Date, and `String(thatDate)` is
 * "Sat Aug 01 2026 …" — so slicing 10 characters yields "Sat Aug 01", which
 * compares as a string against nothing. That silently emptied the balance-check
 * window and made every figure read zero. Anything that compares a stored date
 * has to go through here.
 */
function isoDay(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  return null;
}

/**
 * Everything the read-only overview shows, computed from rows already loaded.
 *
 * Every formula here is ported from the `intel` / `reconcile` / `cashflow`
 * memos in app/owner/budget/page.tsx. The phone is a second VIEW of that page,
 * so a number that disagrees is a bug by definition — which is why this is a
 * port rather than a fresh implementation of "roughly the same idea".
 */
function buildOverview({ month, today, rows, register, recurring, categories, balances,
                         dailyBalance, prevDailyBalance, categorySpend, unsorted }) {
  const [iy, im] = month.split('-').map(Number);
  const daysInMonth = new Date(iy, im, 0).getDate();
  const ym = today.slice(0, 7);
  // Day-of-month "now" for this month: 0 if the month is in the future, the
  // last day if it is already past. Without that clamp a past month reports a
  // spend pace of zero and looks like you spent nothing.
  const todayDay = ym === month ? Number(today.split('-')[2]) : ym > month ? daysInMonth : 0;
  const daysLeft = Math.max(1, daysInMonth - todayDay + 1);

  const allBanks = BANKS.reduce((n, b) => n + (balances[b] || 0), 0);

  const materialised = new Set(
    register.filter((r) => !r.is_beginning && typeof r.recurring_tag === 'string' &&
                           r.recurring_tag.startsWith('__recur__:')).map((r) => r.recurring_tag));

  // Bills still to come this month — only NEGATIVE rules, only from today on,
  // and only ones not already paid.
  let billsLeft = 0;
  const upcomingPay = [];
  const horizon = addDays(today, 10);
  for (const rule of recurring) {
    if (!rule.active || rule.amount >= 0) continue;
    for (const date of occurrencesInMonth(rule, month)) {
      const tag = recurTag(rule.id, date);
      if (materialised.has(tag)) continue;
      if (date >= today) billsLeft += Math.abs(rule.amount);
      if (date <= horizon) {
        upcomingPay.push({
          tag, label: rule.label, amount: Number(rule.amount), date, bank: rule.bank,
          days: daysBetween(today, date), overdue: date < today,
        });
      }
    }
  }
  upcomingPay.sort((a, b) => (a.date < b.date ? -1 : 1));

  // Safe to spend: cash on hand minus what is already spoken for.
  const safe = allBanks - billsLeft;

  // Days grouped, for the calendar grid and the daily series.
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.entry_date)) groups.set(r.entry_date, { date: r.entry_date, rows: [], net: 0, out: 0 });
    const g = groups.get(r.entry_date);
    g.rows.push(r);
    g.net += r.amount;
    if (r.amount < 0) g.out += -r.amount;
  }
  const dayList = [...groups.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

  // Cumulative spend by day-of-month, and the pace line to compare it against.
  const spendByDay = new Array(daysInMonth).fill(0);
  for (const g of dayList) {
    const d = Number(g.date.split('-')[2]) - 1;
    if (d >= 0 && d < daysInMonth) spendByDay[d] += g.out;
  }
  const cum = [];
  let acc = 0;
  for (let i = 0; i < daysInMonth; i++) { acc += spendByDay[i]; cum.push(Math.round(acc * 100) / 100); }

  const payments = rows.reduce((n, r) => n + (r.amount < 0 ? r.amount : 0), 0);
  // Fall back to actual spend when no budget is set, so the pace line still has
  // something to mean — and never zero, which would divide badly.
  const budgetTotal = categories.reduce((n, c) => n + (Number(c.amount) || 0), 0) || Math.abs(payments) || 1;
  const paceNow = (budgetTotal * Math.min(Math.max(todayDay, 0), daysInMonth)) / daysInMonth;
  const spentMtd = todayDay > 0 ? (cum[Math.min(todayDay, daysInMonth) - 1] ?? 0) : 0;

  // Seven-day pulse against the seven before it.
  const dayAgg = (iso) => groups.get(iso) || { net: 0, out: 0 };
  const week = [];
  let wkOut = 0, prevWkOut = 0;
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    const a = dayAgg(d);
    week.push({ date: d, net: a.net, out: a.out });
    wkOut += a.out;
  }
  for (let i = 13; i >= 7; i--) prevWkOut += dayAgg(addDays(today, -i)).out;

  // Donut slices — categories with spend, largest first, then the unsorted bucket.
  const slices = categories
    .map((c, i) => ({
      label: c.name,
      value: categorySpend[c.id] || 0,
      colour: c.color || CATEGORY_COLOURS[i % CATEGORY_COLOURS.length],
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
  if (unsorted > 0) slices.push({ label: 'Unsorted', value: unsorted, colour: 'rgba(255,255,255,0.30)' });

  /**
   * Balance check. Only CLEARED money counts — real register rows. A scheduled
   * bill hasn't left the bank yet, so counting it would show a permanent
   * phantom shortfall. Drift below zero means money left that nobody logged.
   */
  let reconcile = null;
  if (dailyBalance && prevDailyBalance) {
    const anchorTotal = BANKS.reduce((n, b) => n + (Number(prevDailyBalance[b]) || 0), 0);
    const from = isoDay(prevDailyBalance.day);
    const to = isoDay(dailyBalance.day);
    if (from && to && to > from) {
      let moneyIn = 0, moneyOut = 0, uncleared = 0;
      for (const g of dayList) {
        if (g.date <= from || g.date > to) continue;
        for (const r of g.rows) {
          if (r.recurring) { if (r.amount < 0) uncleared += -r.amount; continue; }
          if (r.amount > 0) moneyIn += r.amount; else moneyOut += -r.amount;
        }
      }
      const expected = anchorTotal + moneyIn - moneyOut;
      reconcile = {
        from, to, days: daysBetween(from, to), prevBalance: anchorTotal,
        moneyIn, moneyOut, uncleared, expected, actual: allBanks,
        drift: Math.round((allBanks - expected) * 100) / 100,
      };
    }
  }

  return {
    daysInMonth, todayDay, daysLeft,
    allBanks, billsLeft, safe, safePerDay: safe / daysLeft,
    budgetTotal, paceNow, spentMtd, cum,
    week, wkOut, prevWkOut,
    slices, upcomingPay, reconcile,
    // Day cells for the calendar grid, and the running balance for the
    // projection line — both derived from the same rows as everything else.
    days: dayList.map((g) => ({ date: g.date, net: g.net, out: g.out, count: g.rows.length })),
    series: rows.map((r) => ({ date: r.entry_date, balance: r.balance })),
    cashflow: (() => {
      // Weekly in/out buckets: enough resolution to see a pattern on a phone,
      // where 31 daily bars are 6px wide and unreadable.
      const buckets = new Map();
      for (const r of rows) {
        const wk = Math.floor((Number(r.entry_date.split('-')[2]) - 1) / 7) + 1;
        if (!buckets.has(wk)) buckets.set(wk, { label: `W${wk}`, inflow: 0, outflow: 0 });
        const b = buckets.get(wk);
        if (r.amount > 0) b.inflow += r.amount; else b.outflow += -r.amount;
      }
      return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    })(),
  };
}

const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

/**
 * Add a register row. `sign` is applied here rather than trusted from the
 * client: the phone sends a positive amount plus "pay" or "income", so a
 * fumbled minus sign can't silently turn a payment into a deposit.
 */
async function addRow(profileKey, { date, label, bank, amount, kind, recurringTag }) {
  const profile = await profileFor(profileKey);
  if (!isDate(date)) throw new Error('Pick a date.');
  const text = String(label || '').trim().toUpperCase().slice(0, 120);
  if (!text) throw new Error('Give it a name.');
  const amt = money(amount);
  if (!Number.isFinite(amt) || amt === 0) throw new Error('Enter an amount.');
  const signed = kind === 'income' ? Math.abs(amt) : -Math.abs(amt);
  return libDb.insertRegisterRow({
    profile_id: profile.id,
    entry_date: date,
    sort_order: Date.now() % 100000,
    label: text,
    bank: normBank(bank),
    amount: signed,
    recurring_tag: recurringTag ? String(recurringTag) : null,
  });
}

/**
 * Mark a projected bill paid — i.e. materialise the occurrence as a real row
 * under its tag. Idempotent by tag so a double-tap on a slow connection can't
 * pay the same bill twice.
 */
async function markBillPaid(profileKey, { tag, date, label, bank, amount }) {
  const profile = await profileFor(profileKey);
  if (!String(tag || '').startsWith('__recur__:')) throw new Error('Not a scheduled bill.');
  const { from, to } = monthRange(String(date).slice(0, 7));
  const existing = await libDb.listRegister(profile.id, from, to);
  if (existing.some((r) => r.recurring_tag === tag)) {
    return { already: true };
  }
  const row = await libDb.insertRegisterRow({
    profile_id: profile.id,
    entry_date: date,
    sort_order: 40,
    label: String(label || '').trim().toUpperCase().slice(0, 120),
    bank: normBank(bank),
    amount: money(amount),
    recurring_tag: String(tag),
  });
  return { row };
}

async function updateRow(profileKey, id, patch) {
  const profile = await profileFor(profileKey);
  // Synthetic recurring rows have negative ids and no database row behind them.
  if (!Number.isInteger(id) || id <= 0) throw new Error('That row is a scheduled bill — mark it paid first.');
  const fields = {};
  if (patch.date !== undefined) {
    if (!isDate(patch.date)) throw new Error('Pick a date.');
    fields.entry_date = patch.date;
  }
  if (patch.label !== undefined) fields.label = String(patch.label).trim().toUpperCase().slice(0, 120);
  if (patch.bank !== undefined) fields.bank = normBank(patch.bank);
  if (patch.amount !== undefined) {
    const amt = money(patch.amount);
    if (!Number.isFinite(amt)) throw new Error('Enter an amount.');
    fields.amount = amt;
  }
  if (!Object.keys(fields).length) throw new Error('Nothing to update.');
  await libDb.updateRegisterRow(profile.id, id, fields);
  return true;
}

async function deleteRow(profileKey, id) {
  const profile = await profileFor(profileKey);
  if (!Number.isInteger(id) || id <= 0) throw new Error('That row is a scheduled bill, not an entry.');
  await libDb.deleteRegisterRow(profile.id, id);
  return true;
}

async function setDailyBalance(profileKey, { day, coastal, truist, secu }) {
  const profile = await profileFor(profileKey);
  if (!isDate(day)) throw new Error('Pick a date.');
  return libDb.upsertDailyBalance({
    profile_id: profile.id, day,
    coastal: money(coastal) || 0, truist: money(truist) || 0, secu: money(secu) || 0,
  });
}

async function setRowCategory(profileKey, id, categoryId) {
  const profile = await profileFor(profileKey);
  if (!Number.isInteger(id) || id <= 0) throw new Error('That row is a scheduled bill.');
  await libDb.setRegisterCategory(profile.id, id, categoryId == null ? null : Number(categoryId));
  return true;
}

/** The compact strip for the Today screen: balances + what's due next. */
async function summary(profileKey, tz = 'America/New_York') {
  const m = await getMonth(profileKey, currentMonth(tz), tz);
  const upcoming = m.bills
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    currency: m.currency,
    balances: m.balances,
    total: m.balances.coastal + m.balances.truist + m.balances.secu,
    net: m.totals.net,
    overdue: upcoming.filter((b) => b.overdue).length,
    nextBills: upcoming.filter((b) => !b.overdue).slice(0, 3),
    overdueBills: upcoming.filter((b) => b.overdue).slice(0, 3),
  };
}

module.exports = {
  available, BANKS, buildOverview, daysBetween, isoDay,
  getMonth, summary,
  addRow, markBillPaid, updateRow, deleteRow, setDailyBalance, setRowCategory,
  // exported for the parity tests
  occurrencesInMonth, recurTag, addDays, monthRange, currentMonth, todayIn,
};
