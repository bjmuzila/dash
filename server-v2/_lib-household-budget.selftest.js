'use strict';
/**
 * Budget arithmetic checks for budget.cbedge.net.
 *
 *   node server-v2/_lib-household-budget.selftest.js
 *
 * Stubs _lib-db.cjs so no database is touched — the whole point is that these
 * are pure calculations over rows, and they can be checked with rows made up
 * here.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * There are two very different "balance" figures in this app and they had been
 * quietly swapped:
 *
 *   inBank                — cash on hand. The last hand-logged daily balance,
 *                           falling back to the month's beginning balances.
 *   totals.endingBalance  — the register's running total after every line in
 *                           the month, INCLUDING synthetic occurrences for
 *                           bills not yet paid and pay not yet landed. A
 *                           projection of where the month ends up.
 *
 * Passing the projection where cash-on-hand was expected read as a negative
 * bank balance for any month with rent outstanding, AND double-counted: the
 * briefing adds `coming` and subtracts `owed` from `inBank`, and both were
 * already baked into the projection. `overview.safe` then subtracted the
 * remaining bills a third time.
 *
 * Every assertion below is written against the FIXED meaning. If someone
 * reintroduces the swap, the first four fail immediately.
 */

const assert = require('assert');
const path = require('path');

// ── Stub the database layer before the module under test requires it ────────
const DB = path.join(__dirname, '_lib-db.cjs');
let STATE = {};
require.cache[DB] = {
  id: DB, filename: DB, loaded: true,
  exports: {
    adoptDefaultBudgetProfile: async () => {},
    getOrCreateBudgetProfile: async () => ({ id: 1, currency: 'USD' }),
    listBudgetCategories: async () => STATE.categories || [],
    listRegister: async (_p, from, to) =>
      (STATE.register || []).filter((r) => r.entry_date >= from && r.entry_date <= to),
    listRecurring: async () => STATE.recurring || [],
    getLatestDailyBalance: async () => STATE.dailyBalance || null,
    getDailyBalanceBefore: async () => STATE.prevDailyBalance || null,
  },
};

const B = require('./_lib-household-budget.cjs');

let n = 0;
const fails = [];
const check = (name, fn) => {
  try { fn(); n++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL ${name}\n       ${e.message}`); }
};

const beginRow = (amount, bank = 'secu') => ({
  id: 1, entry_date: '2026-08-01', sort_order: 0, label: 'BEGIN', bank,
  amount, is_beginning: true, category_id: null, recurring_tag: null,
});
const row = (id, date, label, amount, bank = 'secu', recurring_tag = null) => ({
  id, entry_date: date, sort_order: 10, label, bank, amount,
  is_beginning: false, category_id: null, recurring_tag,
});
const rule = (id, label, amount, anchor, bank = 'secu') => ({
  id, active: true, label, bank, amount, frequency: 'monthly', anchor_date: anchor,
});

(async () => {
  console.log('household budget selftest');

  // ═════════════════════════════════════════════════════════════════════════
  // The scenario the bug report came from: money IS in the bank, but several
  // bills for the month have not been paid yet, so the projection is far lower
  // than the balance — and for a bigger month, negative.
  // ═════════════════════════════════════════════════════════════════════════
  STATE = {
    register: [beginRow(3000), row(2, '2026-08-03', 'GROCERIES', -220)],
    recurring: [
      rule(10, 'RENT', -2200, '2026-08-15'),
      rule(11, 'CAR', -480, '2026-08-20'),
      rule(12, 'INSURE', -300, '2026-08-25'),
      rule(13, 'PAYCHECK', 1500, '2026-08-28'),
    ],
    dailyBalance: { day: '2026-08-05', coastal: 400, truist: 180, secu: 2200 },
  };

  const BANK = 400 + 180 + 2200;   // 2780 — what is actually there
  const OWED = 2200 + 480 + 300;   // 2980 — unpaid bills this month
  const COMING = 1500;             // pay not landed yet

  let m = await B.getMonth('owner', '2026-08', 'America/New_York');

  check('inBank is the logged bank balance, not the projection', () => {
    assert.strictEqual(m.inBank, BANK);
    assert.notStrictEqual(m.inBank, m.totals.endingBalance);
  });

  check('the projection is still exposed, correctly labelled', () => {
    // beginning − groceries − bills + pay
    assert.strictEqual(m.totals.endingBalance, 3000 - 220 - OWED + COMING);
  });

  check('bankAsOf reports when the balance was logged', () => {
    assert.strictEqual(m.bankAsOf, '2026-08-05');
  });

  check('briefing applies coming/owed to CASH, so nothing is counted twice', () => {
    assert.strictEqual(m.briefing.inBank, BANK);
    assert.strictEqual(m.briefing.coming, COMING);
    assert.strictEqual(m.briefing.owed, OWED);
    assert.strictEqual(m.briefing.available, BANK + COMING);
    assert.strictEqual(m.briefing.after, BANK + COMING - OWED);
  });

  check('the All banks tile is cash on hand', () => {
    assert.strictEqual(m.overview.tiles.allBanks, BANK);
    assert.strictEqual(m.overview.allBanks, BANK);
  });

  check('safe-to-spend subtracts the remaining bills exactly once', () => {
    assert.strictEqual(m.overview.billsLeft, OWED);
    assert.strictEqual(m.overview.safe, BANK - OWED);
  });

  check('the verdict follows from the corrected figures', () => {
    // 2780 + 1500 − 2980 = 1300 spare. The old code reported this month as
    // short by $180, because it had already deducted the bills once.
    assert.strictEqual(m.briefing.after, 1300);
    assert.strictEqual(m.briefing.tone, 'good');
  });

  // ═════════════════════════════════════════════════════════════════════════
  // No daily balance logged → fall back to the month's beginning balances,
  // exactly as `bankNow` does on /owner/budget.
  // ═════════════════════════════════════════════════════════════════════════
  STATE = { ...STATE, dailyBalance: null, prevDailyBalance: null };
  m = await B.getMonth('owner', '2026-08', 'America/New_York');

  check('falls back to beginning balances when nothing is logged', () => {
    assert.strictEqual(m.inBank, 3000);
    assert.strictEqual(m.bankAsOf, null, 'null is the signal that this is a fallback');
    assert.strictEqual(m.briefing.available, 3000 + COMING);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // A bill marked paid must leave `owed` AND must not be double-counted as
  // both a real row and a synthetic occurrence.
  // ═════════════════════════════════════════════════════════════════════════
  STATE = {
    register: [
      beginRow(3000),
      row(3, '2026-08-15', 'RENT', -2200, 'secu', '__recur__:10:2026-08-15'),
    ],
    recurring: [rule(10, 'RENT', -2200, '2026-08-15'), rule(13, 'PAYCHECK', 1500, '2026-08-28')],
    dailyBalance: { day: '2026-08-16', coastal: 0, truist: 0, secu: 800 },
  };
  m = await B.getMonth('owner', '2026-08', 'America/New_York');

  check('a materialised bill drops out of owed and is counted once', () => {
    assert.strictEqual(m.briefing.owed, 0, 'rent is paid');
    assert.strictEqual(m.inBank, 800);
    assert.strictEqual(m.briefing.after, 800 + 1500);
    // One rent line in the month, not two.
    assert.strictEqual(m.rows.filter((r) => r.label === 'RENT').length, 1);
    assert.strictEqual(m.totals.endingBalance, 3000 - 2200 + 1500);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Reconcile compares CLEARED movement against the logged balance. A
  // projected bill must not appear as drift.
  // ═════════════════════════════════════════════════════════════════════════
  STATE = {
    register: [beginRow(1000), row(4, '2026-08-10', 'FUEL', -60)],
    recurring: [rule(10, 'RENT', -2200, '2026-08-25')],
    prevDailyBalance: { day: '2026-08-08', coastal: 0, truist: 0, secu: 1000 },
    dailyBalance: { day: '2026-08-12', coastal: 0, truist: 0, secu: 940 },
  };
  m = await B.getMonth('owner', '2026-08', 'America/New_York');

  check('reconcile drift ignores bills that have not left the bank', () => {
    const r = m.overview.reconcile;
    assert.ok(r, 'reconcile needs both a current and a prior balance');
    assert.strictEqual(r.actual, 940);
    assert.strictEqual(r.expected, 1000 - 60);
    assert.strictEqual(r.drift, 0, 'an unpaid future bill is not missing money');
  });

  // ═════════════════════════════════════════════════════════════════════════
  // The Today strip reads from the same numbers.
  // ═════════════════════════════════════════════════════════════════════════
  STATE = {
    register: [beginRow(3000), row(2, '2026-08-03', 'GROCERIES', -220)],
    recurring: [rule(10, 'RENT', -2200, '2026-08-15'), rule(13, 'PAYCHECK', 1500, '2026-08-28')],
    dailyBalance: { day: '2026-08-05', coastal: 400, truist: 180, secu: 2200 },
    prevDailyBalance: null,
  };
  const s = await B.summary('owner', 'America/New_York');

  check("Today's Bank balance is cash on hand", () => {
    assert.strictEqual(s.total, BANK);
    assert.strictEqual(s.balances.secu, 2200);
    assert.strictEqual(s.asOf, '2026-08-05');
    assert.strictEqual(s.projectedEom, 3000 - 220 - 2200 + 1500);
    assert.notStrictEqual(s.total, s.projectedEom, 'these two must never be the same field');
  });

  console.log(fails.length ? `\nFAILED (${fails.length})` : `\nall ${n} budget checks passed`);
  process.exit(fails.length ? 1 : 0);
})();
