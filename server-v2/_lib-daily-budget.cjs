'use strict';
/**
 * server-v2/_lib-daily-budget.cjs — the money half of daily.cbedge.net.
 *
 * This is a port of _lib-household-budget.cjs, which runs the owner's private
 * budget at budget.cbedge.net. The arithmetic, the recurring-rule expansion and
 * the materialisation tag are carried over deliberately unchanged; what changed
 * is who the data belongs to and what an "account" is.
 *
 * ── TENANCY ───────────────────────────────────────────────────────────────
 *
 * The original scoped rows by `profile_id` and resolved that profile from a
 * string key ('owner'). Here every row carries `household_id NOT NULL` and every
 * query filters on it through `scoped()` from _lib-daily.cjs. There is no
 * profile key to point at somebody else's data, because there is no key — the
 * caller's session decides the tenant and nothing in a request body can move it.
 *
 * A by-id write (`updateRow`, `deleteRule`, …) confirms the row is in the
 * caller's household BEFORE touching it, and reports NOT FOUND when it isn't —
 * never "forbidden". "Forbidden" is an answer: it tells an id-guesser that the
 * id exists and belongs to someone. 404 tells them nothing.
 *
 * ── THE BIG CHANGE: USER-DEFINED ACCOUNTS, NOT THREE HARDCODED BANKS ──────
 *
 * The original budget is built around exactly three columns — `coastal`,
 * `truist`, `secu` — because those are the owner's three real banks. They are
 * everywhere in it: a `BANKS` array, a `normBank()` that coerces anything
 * unrecognised to 'secu', a `bank` TEXT column on every register row, and a
 * `daily balances` row shaped `(day, coastal, truist, secu)` with one COLUMN per
 * bank.
 *
 * That cannot ship to paying customers. A customer with one checking account
 * would see two empty columns named after a stranger's banks; a customer with
 * five accounts could not enter three of them; and `normBank()` would silently
 * file every one of their transactions under 'secu'. Worse, adding a bank would
 * be an ALTER TABLE plus a new key in a dozen object literals — a schema change
 * per customer, which is not a product.
 *
 * So banks become rows that customers create:
 *
 *   daily_accounts    one row per account the household actually has, with a
 *                     `kind` of checking | savings | credit | cash. Named by
 *                     the customer, ordered by the customer.
 *   daily_balances    (household_id, account_id, day, balance) — one row per
 *                     account per day, instead of one row per day with a fixed
 *                     column per bank. Adding an account is an INSERT.
 *   ledger + rules    carry `account_id` instead of a `bank` string, so a typo
 *                     is a foreign-key violation rather than a transaction
 *                     quietly reassigned to the wrong bank.
 *
 * The consequence to design for: a brand-new household has ZERO accounts. The
 * original could always assume three. Every read path here must render an empty
 * screen that invites you to add your first account, and no code may index a
 * per-account map by a name it assumed was there — hence `needsAccount` on the
 * month payload and the total-of-nothing being 0 rather than NaN.
 *
 * Accounts are ARCHIVED, never deleted. Ledger rows point at them, and a closed
 * bank account does not un-happen last year's rent. The foreign key is
 * ON DELETE RESTRICT so a future "cleanup" migration cannot take the history
 * with it; archived accounts stay visible in any month where they carry rows.
 *
 * ── THE PART THAT MUST NOT DRIFT ──────────────────────────────────────────
 *
 * Recurring bills are NOT rows. They are rules, expanded into occurrences at
 * read time, and an occurrence only becomes a real row once someone marks it
 * paid (or edits it) — "materialising" it under the tag
 *
 *     __recur__:<ruleId>:<YYYY-MM-DD>
 *
 * `occurrencesInMonth()` and `recurTag()` below are ported verbatim from the
 * desktop page via _lib-household-budget.cjs. They are two halves of one
 * agreement: the expansion decides which dates exist, and the tag is how a
 * materialised row says "that one, already handled". If they ever disagree —
 * a date format that gains a time component, a monthly clamp that rounds the
 * other way, a rule id stringified differently — the failures are these:
 *
 *   * a bill marked paid on the phone still shows unpaid on the desktop,
 *     because the tag the desktop computes no longer matches the tag stored;
 *   * and the same bill is therefore paid twice;
 *   * or the synthetic occurrence sits alongside its own materialised row and
 *     double-counts against every balance in the month.
 *
 * None of those announce themselves. They look like the customer's arithmetic
 * being wrong. Change one of these two functions and you must change the other
 * in the same commit.
 */

const core = require('./_lib-daily.cjs');

/** Every daily_* table is created by whichever module owns it; these are ours. */
const ACCOUNT_KINDS = new Set(['checking', 'savings', 'credit', 'cash']);
const ROW_KINDS = new Set(['income', 'expense']);
const FREQUENCIES = new Set(['weekly', 'biweekly', 'monthly']);

/** No per-household currency column exists yet. When one does, this is the one
 *  place that changes; clients already read it off the payload. */
const DEFAULT_CURRENCY = 'USD';

const available = () => core.available();
const db = () => core.pool();

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

let ready = null;

/**
 * Self-bootstrapping, same as the core module: CREATE TABLE IF NOT EXISTS on
 * first use, no migration runner, nothing to remember on deploy.
 *
 * Runs core.ensureSchema() first because every table here has a foreign key
 * into daily_households / daily_users, and a FK to a table that does not exist
 * yet fails at CREATE rather than at INSERT.
 */
async function ensureSchema() {
  if (!core.available()) throw new Error('daily-budget: no database');
  if (ready) return ready;
  ready = (async () => {
    await core.ensureSchema();
    const pool = db();

    // ── Accounts ─────────────────────────────────────────────────────────
    // `archived` rather than a DELETE — see the header. sort_order is the
    // customer's chosen order, which is the only order that means anything
    // once the names are theirs.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_accounts (
        id           SERIAL PRIMARY KEY,
        household_id INTEGER NOT NULL REFERENCES daily_households(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        kind         TEXT NOT NULL DEFAULT 'checking'
                     CHECK (kind IN ('checking','savings','credit','cash')),
        sort_order   INTEGER NOT NULL DEFAULT 0,
        archived     BOOLEAN NOT NULL DEFAULT FALSE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_accounts_hh_idx
                        ON daily_accounts(household_id, archived, sort_order)`);

    // ── Categories ───────────────────────────────────────────────────────
    // Created before the ledger so the ledger's category FK has a target.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_categories (
        id           SERIAL PRIMARY KEY,
        household_id INTEGER NOT NULL REFERENCES daily_households(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        kind         TEXT NOT NULL DEFAULT 'expense'
                     CHECK (kind IN ('income','expense')),
        color        TEXT,
        sort_order   INTEGER NOT NULL DEFAULT 0
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_categories_hh_idx
                        ON daily_categories(household_id, sort_order)`);

    // ── The ledger ───────────────────────────────────────────────────────
    // `amount` is a MAGNITUDE and `kind` carries the direction. Storing a sign
    // as well would mean two sources of truth for the same fact, and one of
    // them eventually lies — a client PATCHing amount:-40 onto an income row
    // gives you a deposit that subtracts. Sign is applied on the way out, in
    // signedAmount(), and never read from the caller.
    //
    // ON DELETE RESTRICT on account_id: archiving is the supported way to
    // retire an account precisely because the history must survive it.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_budget_rows (
        id            SERIAL PRIMARY KEY,
        household_id  INTEGER NOT NULL REFERENCES daily_households(id) ON DELETE CASCADE,
        account_id    INTEGER NOT NULL REFERENCES daily_accounts(id) ON DELETE RESTRICT,
        date          DATE NOT NULL,
        label         TEXT NOT NULL,
        amount        NUMERIC(12,2) NOT NULL,
        kind          TEXT NOT NULL CHECK (kind IN ('income','expense')),
        category_id   INTEGER REFERENCES daily_categories(id) ON DELETE SET NULL,
        recurring_tag TEXT,
        created_by    INTEGER REFERENCES daily_users(id) ON DELETE SET NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_budget_rows_month_idx
                        ON daily_budget_rows(household_id, date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_budget_rows_account_idx
                        ON daily_budget_rows(household_id, account_id, date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_budget_rows_category_idx
                        ON daily_budget_rows(household_id, category_id)`);
    // The one constraint that makes "mark paid" safe to double-tap. A
    // materialised occurrence is identified by its tag, so the database — not
    // an application-level check that two concurrent requests both pass —
    // guarantees a bill can be paid exactly once. Postgres treats NULLs as
    // distinct in a unique index, so the manual rows (tag NULL) are unaffected
    // and need no partial index.
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS daily_budget_rows_tag_uq
                        ON daily_budget_rows(household_id, recurring_tag)`);

    // ── Recurring rules ──────────────────────────────────────────────────
    // Same magnitude-plus-kind rule as the ledger, so an expanded occurrence
    // and the row it materialises into carry identical numbers.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_recurring_rules (
        id           SERIAL PRIMARY KEY,
        household_id INTEGER NOT NULL REFERENCES daily_households(id) ON DELETE CASCADE,
        account_id   INTEGER NOT NULL REFERENCES daily_accounts(id) ON DELETE RESTRICT,
        label        TEXT NOT NULL,
        amount       NUMERIC(12,2) NOT NULL,
        kind         TEXT NOT NULL CHECK (kind IN ('income','expense')),
        frequency    TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly')),
        anchor_date  DATE NOT NULL,
        category_id  INTEGER REFERENCES daily_categories(id) ON DELETE SET NULL,
        active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_recurring_rules_hh_idx
                        ON daily_recurring_rules(household_id, active)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_recurring_rules_account_idx
                        ON daily_recurring_rules(household_id, account_id)`);

    // ── Balances ─────────────────────────────────────────────────────────
    // One row per account per day. The original stored one row per day with a
    // column per bank, which is why it could never hold a fourth account.
    //
    // PRIMARY KEY (account_id, day) makes logging a balance idempotent: typing
    // today's figure twice corrects it rather than stacking a second reading
    // that a MAX(day) lookup would then pick between arbitrarily. `day` is
    // resolved in the household's timezone by the caller — never now()::date,
    // which rolls the day over at 8pm Eastern.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_balances (
        household_id INTEGER NOT NULL REFERENCES daily_households(id) ON DELETE CASCADE,
        account_id   INTEGER NOT NULL REFERENCES daily_accounts(id) ON DELETE CASCADE,
        day          DATE NOT NULL,
        balance      NUMERIC(12,2) NOT NULL DEFAULT 0,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, day)
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_balances_hh_day_idx
                        ON daily_balances(household_id, day DESC)`);

    return true;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * The answer for both "no such id" and "that id belongs to another household".
 * Deliberately the same object for both: a distinguishable 403 would confirm
 * which ids exist, which is a membership oracle over every customer's data.
 */
function notFound(what = 'That') {
  const e = new Error(`${what} could not be found.`);
  e.status = 404;
  e.code = 404;
  return e;
}

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  e.code = 400;
  return e;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Postgres hands NUMERIC back as a STRING, on purpose: the driver will not
 * silently push 12345678.91 through a float and hand you 12345678.910000001.
 * That means every amount arrives as text and has to be converted exactly once,
 * here, at the edge between the database and the composed payload. Convert it
 * twice and nothing breaks; forget once and `'40.00' + '12.00'` is `'40.0012.00'`
 * and the month's total is a string nobody can subtract from.
 */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Round an incoming amount to cents, or NaN if it isn't a number at all. */
const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : NaN;
};

/** Direction lives in `kind`; this is the only place it becomes a sign. */
const signedAmount = (magnitude, kind) =>
  (kind === 'income' ? Math.abs(magnitude) : -Math.abs(magnitude));

// ---------------------------------------------------------------------------
// Dates — ported from _lib-household-budget.cjs
// ---------------------------------------------------------------------------

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

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/**
 * "YYYY-MM" for right now, in the HOUSEHOLD's timezone.
 *
 * Never `now()::date` and never the server's local clock. The server runs in
 * UTC; a customer in Los Angeles opening the app at 6pm on the 31st would be
 * shown next month, with an empty register and every bill they just paid gone
 * from view. Same reasoning for todayIn().
 */
function currentMonth(tz = 'America/New_York') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  const m = {};
  parts.forEach((x) => { m[x.type] = x.value; });
  return `${m.year}-${m.month}`;
}

function todayIn(tz = 'America/New_York') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const m = {};
  parts.forEach((x) => { m[x.type] = x.value; });
  return `${m.year}-${m.month}-${m.day}`;
}

/** The household's zone, falling back to the user's, then to Eastern. Every
 *  day-boundary decision in this file goes through here. */
const tzOf = (user) => String(user?.household_tz || user?.tz || 'America/New_York');

/**
 * Coerce a Postgres DATE to 'YYYY-MM-DD' whichever way the driver hands it over.
 *
 * `pg` hydrates a DATE into a JS Date, and `String(thatDate)` is
 * "Sat Aug 01 2026 …" — so slicing 10 characters yields "Sat Aug 01", which
 * compares as a string against nothing. That silently emptied a date window
 * once already and made every figure read zero. Anything that compares or
 * splits a stored date has to come through here first, including the anchor
 * date handed to occurrencesInMonth().
 */
function isoDay(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  return null;
}

/** Whole days between two 'YYYY-MM-DD' strings. UTC on both ends so a DST
 *  boundary between them can't round the result to the wrong day. */
function daysBetween(aIso, bIso) {
  const [ay, am, ad] = aIso.split('-').map(Number);
  const [by, bm, bd] = bIso.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const isMonth = (v) => /^\d{4}-\d{2}$/.test(String(v || ''));

// ---------------------------------------------------------------------------
// Recurring expansion — the half of the agreement described in the header
// ---------------------------------------------------------------------------

/**
 * Every date a recurring rule fires within "YYYY-MM".
 *
 * VERBATIM PORT. Monthly clamps the anchor's day-of-month to the month length,
 * so a rule anchored on the 31st fires on the 30th in April and the 28th in
 * February — which is what a bank does, and what the desktop page does.
 * Weekly/biweekly walk back from the anchor to before the month, then step
 * forward through it. The guard of 10 is the original's, kept so both
 * implementations produce the same list even in the pathological cases (an
 * anchor decades away, a rule someone edited mid-month).
 *
 * `rule.anchor_date` MUST already be an ISO string — pass it through isoDay()
 * when it comes off the driver, or the monthly branch splits "Sat Aug 01 2026"
 * on "-" and clamps NaN.
 *
 * Read the header before editing this. Its output has to agree with recurTag()
 * below, forever.
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

/**
 * The identity of one occurrence, and the string a materialised row stores so
 * its synthetic twin gets skipped. The other half of the agreement with
 * occurrencesInMonth(); the two travel together or the register double-counts.
 */
const recurTag = (ruleId, date) => `__recur__:${ruleId}:${date}`;

/** Is this a materialisation tag at all? Guards markBillPaid against a client
 *  inventing a tag that would never match any expansion. */
const isRecurTag = (t) => typeof t === 'string' && t.startsWith('__recur__:');

// ---------------------------------------------------------------------------
// Tenancy plumbing
// ---------------------------------------------------------------------------

/**
 * `scoped()` builds the household predicate; this stitches extra placeholders
 * onto it without anybody hand-rolling `household_id = ${x}` and eventually
 * interpolating a request body into it.
 */
function withScope(user, extras = []) {
  const s = core.scoped(user);
  const params = [...s.params, ...extras];
  const ph = extras.map((_, i) => `$${s.next + i}`);
  return { where: s.where, params, ph };
}

const asId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Load one row by id, scoped. Returns null rather than throwing so callers can
 *  choose their own noun for the 404 message. */
async function ownedRow(user, table, id, columns = '*') {
  const rid = asId(id);
  if (rid === null) return null;
  const { where, params, ph } = withScope(user, [rid]);
  const { rows } = await db().query(
    `SELECT ${columns} FROM ${table} WHERE ${where} AND id = ${ph[0]}`, params);
  const row = rows[0] || null;
  // Belt and braces: the WHERE already did this, and assertOwned catches the
  // day someone edits the query and drops the predicate.
  return row && core.assertOwned(user, row) ? row : null;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const shapeAccount = (r) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  sortOrder: r.sort_order,
  archived: r.archived,
  createdAt: r.created_at,
});

/**
 * Every account in the household, archived ones last.
 *
 * Archived accounts are included by default because the month view has to name
 * an account that a January row points at even though it was closed in March.
 * Pass includeArchived:false for the pickers — you should not be able to file a
 * new expense against an account you told us you closed.
 */
async function listAccounts(user, { includeArchived = true } = {}) {
  await ensureSchema();
  const { where, params } = withScope(user);
  const { rows } = await db().query(
    `SELECT id, name, kind, sort_order, archived, created_at
       FROM daily_accounts
      WHERE ${where} ${includeArchived ? '' : 'AND archived = FALSE'}
      ORDER BY archived, sort_order, id`,
    params);
  return rows.map(shapeAccount);
}

/**
 * The first account a household ever creates is created HERE, explicitly, by
 * the customer — nothing is seeded at signup. Guessing that everyone has a
 * "Checking" is how the original ended up with three banks nobody asked for,
 * and a pre-made account you have to rename is worse than an empty screen that
 * asks you one question.
 */
async function createAccount(user, { name, kind = 'checking' } = {}) {
  await ensureSchema();
  const label = String(name || '').trim().slice(0, 60);
  if (!label) throw badRequest('Give the account a name.');
  const k = String(kind || 'checking');
  if (!ACCOUNT_KINDS.has(k)) throw badRequest('Pick checking, savings, credit or cash.');

  const { where, params } = withScope(user);
  // Append to the end of the customer's ordering rather than to the top: a new
  // account should not jump ahead of the one they check every morning.
  const { rows } = await db().query(
    `INSERT INTO daily_accounts (household_id, name, kind, sort_order)
     VALUES ($1, $${params.length + 1}, $${params.length + 2},
             COALESCE((SELECT MAX(sort_order) + 1 FROM daily_accounts WHERE ${where}), 0))
     RETURNING id, name, kind, sort_order, archived, created_at`,
    [...params, label, k]);
  return shapeAccount(rows[0]);
}

async function updateAccount(user, id, patch = {}) {
  await ensureSchema();
  const existing = await ownedRow(user, 'daily_accounts', id);
  if (!existing) throw notFound('That account');

  const sets = [];
  const vals = [];
  if (patch.name !== undefined) {
    const label = String(patch.name || '').trim().slice(0, 60);
    if (!label) throw badRequest('Give the account a name.');
    sets.push('name'); vals.push(label);
  }
  if (patch.kind !== undefined) {
    if (!ACCOUNT_KINDS.has(String(patch.kind))) throw badRequest('Pick checking, savings, credit or cash.');
    sets.push('kind'); vals.push(String(patch.kind));
  }
  if (patch.sortOrder !== undefined) {
    const n = Number(patch.sortOrder);
    if (!Number.isFinite(n)) throw badRequest('That position is not a number.');
    sets.push('sort_order'); vals.push(Math.trunc(n));
  }
  // Un-archiving is an update, not a separate verb — reopening an account you
  // closed by mistake should not need a support ticket.
  if (patch.archived !== undefined) { sets.push('archived'); vals.push(!!patch.archived); }
  if (!sets.length) throw badRequest('Nothing to update.');

  const { where, params, ph } = withScope(user, [existing.id, ...vals]);
  const assignments = sets.map((col, i) => `${col} = ${ph[i + 1]}`).join(', ');
  const { rows } = await db().query(
    `UPDATE daily_accounts SET ${assignments}
      WHERE ${where} AND id = ${ph[0]}
      RETURNING id, name, kind, sort_order, archived, created_at`,
    params);
  if (!rows[0]) throw notFound('That account');
  return shapeAccount(rows[0]);
}

/**
 * Close an account without erasing what happened in it.
 *
 * There is no deleteAccount, deliberately. Ledger rows and recurring rules
 * point at this id; a hard delete either fails on the foreign key (RESTRICT) or,
 * had it cascaded, would quietly remove a year of a customer's history to tidy
 * up a row they stopped using. Archiving keeps the register honest and takes
 * the account out of every picker, which is the only thing "delete" was ever
 * meant to achieve here.
 */
async function archiveAccount(user, id) {
  await ensureSchema();
  const { where, params, ph } = withScope(user, [asId(id) ?? -1]);
  const { rows } = await db().query(
    `UPDATE daily_accounts SET archived = TRUE
      WHERE ${where} AND id = ${ph[0]}
      RETURNING id, name, kind, sort_order, archived, created_at`,
    params);
  if (!rows[0]) throw notFound('That account');
  // Rules keep firing forever otherwise, filing bills against an account the
  // customer has told us is closed.
  await db().query(
    `UPDATE daily_recurring_rules SET active = FALSE
      WHERE ${where} AND account_id = ${ph[0]}`,
    params);
  return shapeAccount(rows[0]);
}

/** Resolve an account id from a request, or explain what is wrong with it. */
async function requireAccount(user, accountId) {
  const acct = await ownedRow(user, 'daily_accounts', accountId, 'id, household_id, archived');
  if (!acct) throw notFound('That account');
  return acct;
}

// ---------------------------------------------------------------------------
// The month
// ---------------------------------------------------------------------------

/**
 * The whole budget screen for one month, composed server-side.
 *
 * Mirrors the original's `computed` memo, with per-bank columns replaced by
 * per-account rows: seed each account's opening balance, merge manual rows with
 * live-expanded recurring occurrences, skip any occurrence already materialised,
 * sort by date, then run the balance per account and in total.
 *
 * Everything the client shows is computed here so a phone and a laptop looking
 * at the same month can never disagree about it.
 *
 * With ZERO accounts this returns the same shape with empty collections and
 * `needsAccount: true`. There is deliberately no early return for that case —
 * one code path means the empty screen can't drift away from the full one.
 */
async function getMonth(user, month) {
  await ensureSchema();
  const tz = tzOf(user);
  const m = isMonth(month) ? String(month) : currentMonth(tz);
  const { from, to } = monthRange(m);
  const today = todayIn(tz);

  const { where, params, ph } = withScope(user, [from, to]);
  const [accountsRes, rowsRes, rulesRes, catsRes, openingRes, latestRes] = await Promise.all([
    db().query(
      `SELECT id, name, kind, sort_order, archived, created_at
         FROM daily_accounts WHERE ${where} ORDER BY archived, sort_order, id`,
      params.slice(0, 1)),
    db().query(
      `SELECT id, account_id, date, label, amount, kind, category_id, recurring_tag, created_by
         FROM daily_budget_rows
        WHERE ${where} AND date BETWEEN ${ph[0]} AND ${ph[1]}
        ORDER BY date, id`,
      params),
    db().query(
      `SELECT id, account_id, label, amount, kind, frequency, anchor_date, category_id, active
         FROM daily_recurring_rules WHERE ${where} ORDER BY id`,
      params.slice(0, 1)),
    db().query(
      `SELECT id, name, kind, color, sort_order
         FROM daily_categories WHERE ${where} ORDER BY sort_order, id`,
      params.slice(0, 1)),
    // The opening balance for each account: the last figure logged BEFORE the
    // month started. DISTINCT ON is Postgres's "latest row per group" and is
    // why this is one query rather than one per account.
    db().query(
      `SELECT DISTINCT ON (account_id) account_id, day, balance
         FROM daily_balances
        WHERE ${where} AND day < ${ph[0]}
        ORDER BY account_id, day DESC`,
      params.slice(0, 2)),
    // What is actually in each account right now: the last figure logged on or
    // before today, whatever month it came from.
    db().query(
      `SELECT DISTINCT ON (account_id) account_id, day, balance
         FROM daily_balances
        WHERE ${where} AND day <= $2
        ORDER BY account_id, day DESC`,
      [params[0], today]),
  ]);

  const accounts = accountsRes.rows.map(shapeAccount);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // NUMERIC → number happens exactly here, once, on the way out of the driver.
  const opening = {};
  for (const a of accounts) opening[a.id] = 0;
  for (const r of openingRes.rows) opening[r.account_id] = num(r.balance);

  const bankNow = {};
  let bankAsOf = null;
  for (const a of accounts) bankNow[a.id] = opening[a.id] ?? 0;
  for (const r of latestRes.rows) {
    bankNow[r.account_id] = num(r.balance);
    const day = isoDay(r.day);
    if (day && (!bankAsOf || day > bankAsOf)) bankAsOf = day;
  }
  // Sums over "however many accounts exist" — including none, which is 0 and
  // not NaN. The original could add three known keys; this cannot.
  const inBank = accounts.reduce((n, a) => n + (bankNow[a.id] || 0), 0);
  const openingTotal = accounts.reduce((n, a) => n + (opening[a.id] || 0), 0);

  const lines = rowsRes.rows.map((r) => ({
    id: r.id,
    date: isoDay(r.date),
    label: r.label,
    accountId: r.account_id,
    kind: r.kind,
    amount: signedAmount(num(r.amount), r.kind),
    recurring: false,
    recurringTag: r.recurring_tag ?? null,
    categoryId: r.category_id ?? null,
    seq: 0,
  }));

  // An occurrence someone paid or edited became a real row carrying the tag.
  // Its synthetic twin must be skipped, or the month counts the same bill
  // twice — once as a projection and once as the payment that settled it.
  const materialised = new Set(
    rowsRes.rows.map((r) => r.recurring_tag).filter(isRecurTag));

  const rules = rulesRes.rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    label: r.label,
    kind: r.kind,
    amount: num(r.amount),
    frequency: r.frequency,
    // Normalised BEFORE expansion — see isoDay(). A Date object here makes the
    // monthly branch clamp NaN and the rule silently stops firing.
    anchor_date: isoDay(r.anchor_date),
    categoryId: r.category_id ?? null,
    active: r.active,
  }));

  for (const rule of rules) {
    if (!rule.active || !rule.anchor_date) continue;
    // A rule pointing at an account that no longer exists in this household
    // has nowhere to land; skipping it beats a row filed under `undefined`.
    if (!accountById.has(rule.accountId)) continue;
    for (const date of occurrencesInMonth(rule, m)) {
      const tag = recurTag(rule.id, date);
      if (materialised.has(tag)) continue;
      lines.push({
        // Negative id marks it synthetic — the same scheme the desktop uses, so
        // nothing downstream mistakes it for a real row it can PATCH or DELETE.
        id: -(rule.id * 100 + Number(date.split('-')[2])),
        date,
        label: rule.label,
        accountId: rule.accountId,
        kind: rule.kind,
        amount: signedAmount(rule.amount, rule.kind),
        recurring: true,
        recurringTag: tag,
        categoryId: rule.categoryId,
        ruleId: rule.id,
        // Projections sort after the real rows of the same day: what happened
        // is more certain than what is expected to.
        seq: 1,
      });
    }
  }

  lines.sort((a, b) => (a.date < b.date ? -1
                      : a.date > b.date ? 1
                      : a.seq !== b.seq ? a.seq - b.seq
                      : Math.abs(a.id) - Math.abs(b.id)));

  /**
   * ── PROJECTION vs WHAT IS ACTUALLY IN THE BANK ───────────────────────────
   * `running` / `balances` below is the register's RUNNING total — opening
   * balance plus every line in the month, including projected bills nobody has
   * paid and pay that has not landed. It is the PROJECTED end-of-month figure.
   *
   * `bankNow` / `inBank` above is cash on hand: the last balance the customer
   * actually logged. These answer different questions and the original shipped
   * a bug in which they were swapped, which broke three figures at once —
   * "in the bank" showed end-of-month, so a month with rent still outstanding
   * read as a negative balance on the 1st; anything adding "pay still coming"
   * double-counted it, because the projection already contained it; and
   * anything subtracting "bills still due" subtracted them a second time.
   *
   * Both are on the payload, labelled. Do not swap them again.
   */
  const balances = {};
  for (const a of accounts) balances[a.id] = opening[a.id] ?? 0;

  let running = openingTotal;
  let income = 0;
  let payments = 0;
  const rows = [];

  for (const ln of lines) {
    if (balances[ln.accountId] === undefined) balances[ln.accountId] = 0;
    balances[ln.accountId] += ln.amount;
    running += ln.amount;
    if (ln.amount > 0) income += ln.amount; else payments += ln.amount;
    rows.push({
      id: ln.id,
      date: ln.date,
      label: ln.label,
      accountId: ln.accountId,
      accountName: accountById.get(ln.accountId)?.name ?? null,
      kind: ln.kind,
      amount: ln.amount,
      categoryId: ln.categoryId,
      recurring: ln.recurring,
      recurringTag: ln.recurringTag,
      ruleId: ln.ruleId ?? null,
      balance: running,
      balances: { ...balances },
      total: running,
      // A projection is not a payment. Everything the client needs to decide
      // whether a row is actionable, decided here rather than re-derived there.
      paid: !ln.recurring,
      past: ln.date < today,
    });
  }

  // The "what's about to hit" list — the reason anybody opens a budget app.
  const bills = rows
    .filter((r) => r.recurring)
    .map((r) => ({
      tag: r.recurringTag,
      ruleId: r.ruleId,
      label: r.label,
      accountId: r.accountId,
      accountName: r.accountName,
      kind: r.kind,
      amount: r.amount,
      date: r.date,
      overdue: r.date < today,
    }));

  // Category spend, from REAL rows only. A projected bill has not been spent
  // yet; counting it would overstate every category for the whole month and
  // then quietly correct itself on payday.
  const spentByCategory = {};
  let unsorted = 0;
  for (const ln of lines) {
    if (ln.recurring || ln.amount >= 0) continue;
    if (ln.categoryId) {
      spentByCategory[ln.categoryId] = (spentByCategory[ln.categoryId] || 0) + Math.abs(ln.amount);
    } else {
      unsorted += Math.abs(ln.amount);
    }
  }

  const billsLeft = bills
    .filter((b) => b.amount < 0)
    .reduce((n, b) => n + Math.abs(b.amount), 0);
  const payComing = bills
    .filter((b) => b.amount > 0)
    .reduce((n, b) => n + b.amount, 0);

  return {
    month: m,
    today,
    tz,
    currency: DEFAULT_CURRENCY,
    // The screen the customer sees before they have told us anything.
    needsAccount: accounts.length === 0,
    accounts: accounts.map((a) => ({
      ...a,
      opening: opening[a.id] ?? 0,
      bankNow: bankNow[a.id] ?? 0,
      ending: balances[a.id] ?? (opening[a.id] ?? 0),
    })),
    opening,
    openingTotal,
    // Projected per-account running totals after every line in the month.
    balances,
    // Cash on hand. See the block above; not interchangeable with `balances`.
    bankNow,
    inBank,
    bankAsOf,
    totals: {
      income,
      // Stored as a magnitude, run as a negative, reported positive — so the
      // client never has to remember which convention it is looking at.
      expenses: Math.abs(payments),
      net: income + payments,
      endingBalance: running,
      billsLeft,
      payComing,
    },
    rows,
    bills,
    categories: catsRes.rows.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      color: c.color,
      sortOrder: c.sort_order,
      spent: spentByCategory[c.id] || 0,
    })),
    unsortedSpend: unsorted,
    recurringCount: rules.filter((r) => r.active).length,
  };
}

// ---------------------------------------------------------------------------
// Ledger rows
// ---------------------------------------------------------------------------

const cleanLabel = (v) => String(v || '').trim().slice(0, 120);

function requireKind(kind) {
  const k = String(kind || '');
  if (!ROW_KINDS.has(k)) throw badRequest('Say whether that is income or an expense.');
  return k;
}

/** A category, if one was named, and only ever one of the caller's own. */
async function resolveCategory(user, categoryId) {
  if (categoryId === null || categoryId === undefined || categoryId === '') return null;
  const cat = await ownedRow(user, 'daily_categories', categoryId, 'id, household_id');
  if (!cat) throw notFound('That category');
  return cat.id;
}

/**
 * Add a ledger row.
 *
 * `kind` decides the direction and the stored amount is a magnitude, so a
 * fumbled minus sign in a client cannot turn a payment into a deposit — the
 * same guarantee the original got by applying the sign server-side, made
 * structural by not storing a sign at all.
 */
async function addRow(user, { accountId, date, label, amount, kind, categoryId = null, recurringTag = null } = {}) {
  await ensureSchema();
  if (!isDate(date)) throw badRequest('Pick a date.');
  const text = cleanLabel(label);
  if (!text) throw badRequest('Give it a name.');
  const amt = money(amount);
  if (!Number.isFinite(amt) || amt === 0) throw badRequest('Enter an amount.');
  const k = requireKind(kind);
  const acct = await requireAccount(user, accountId);
  const cat = await resolveCategory(user, categoryId);
  // A tag only ever comes from markBillPaid(). Letting a client post an
  // arbitrary one would let it suppress a projection that no rule generated.
  const tag = isRecurTag(recurringTag) ? String(recurringTag) : null;

  const { params } = withScope(user);
  const { rows } = await db().query(
    `INSERT INTO daily_budget_rows
       (household_id, account_id, date, label, amount, kind, category_id, recurring_tag, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, account_id, date, label, amount, kind, category_id, recurring_tag`,
    [params[0], acct.id, date, text, amt, k, cat, tag, user?.id ?? null]);
  return shapeRow(rows[0]);
}

const shapeRow = (r) => ({
  id: r.id,
  accountId: r.account_id,
  date: isoDay(r.date),
  label: r.label,
  kind: r.kind,
  amount: signedAmount(num(r.amount), r.kind),
  categoryId: r.category_id ?? null,
  recurringTag: r.recurring_tag ?? null,
});

async function updateRow(user, id, patch = {}) {
  await ensureSchema();
  // Synthetic recurring rows have negative ids and no database row behind them.
  // Say so plainly — the alternative is a 404 on a row the customer can see.
  const rid = asId(id);
  if (rid === null) throw badRequest('That row is a scheduled bill — mark it paid first.');
  const existing = await ownedRow(user, 'daily_budget_rows', rid, 'id, household_id, kind');
  if (!existing) throw notFound('That entry');

  const sets = [];
  const vals = [];
  if (patch.date !== undefined) {
    if (!isDate(patch.date)) throw badRequest('Pick a date.');
    sets.push('date'); vals.push(patch.date);
  }
  if (patch.label !== undefined) {
    const text = cleanLabel(patch.label);
    if (!text) throw badRequest('Give it a name.');
    sets.push('label'); vals.push(text);
  }
  if (patch.kind !== undefined) { sets.push('kind'); vals.push(requireKind(patch.kind)); }
  if (patch.amount !== undefined) {
    const amt = money(patch.amount);
    if (!Number.isFinite(amt) || amt === 0) throw badRequest('Enter an amount.');
    // Magnitude only. If the caller also flipped `kind` it is handled above;
    // a negative number here just means the same expense, said twice.
    sets.push('amount'); vals.push(amt);
  }
  if (patch.accountId !== undefined) {
    const acct = await requireAccount(user, patch.accountId);
    sets.push('account_id'); vals.push(acct.id);
  }
  if (patch.categoryId !== undefined) {
    sets.push('category_id'); vals.push(await resolveCategory(user, patch.categoryId));
  }
  if (!sets.length) throw badRequest('Nothing to update.');

  const { where, params, ph } = withScope(user, [rid, ...vals]);
  const assignments = sets.map((col, i) => `${col} = ${ph[i + 1]}`).join(', ');
  const { rows } = await db().query(
    `UPDATE daily_budget_rows SET ${assignments}
      WHERE ${where} AND id = ${ph[0]}
      RETURNING id, account_id, date, label, amount, kind, category_id, recurring_tag`,
    params);
  if (!rows[0]) throw notFound('That entry');
  return shapeRow(rows[0]);
}

/**
 * Delete a ledger row.
 *
 * Deleting a MATERIALISED row is legitimate — it is how you undo "marked paid
 * by mistake". Once the tagged row is gone the expansion generates the
 * occurrence again on the next read, which is exactly the behaviour you want
 * and only works because the tag is the single record of "this one is handled".
 */
async function deleteRow(user, id) {
  await ensureSchema();
  const rid = asId(id);
  if (rid === null) throw badRequest('That row is a scheduled bill, not an entry.');
  const { where, params, ph } = withScope(user, [rid]);
  const { rows } = await db().query(
    `DELETE FROM daily_budget_rows WHERE ${where} AND id = ${ph[0]} RETURNING id, recurring_tag`,
    params);
  if (!rows[0]) throw notFound('That entry');
  return { ok: true, id: rows[0].id, unpaid: isRecurTag(rows[0].recurring_tag) };
}

async function setRowCategory(user, id, categoryId) {
  await ensureSchema();
  const rid = asId(id);
  if (rid === null) throw badRequest('That row is a scheduled bill.');
  const cat = await resolveCategory(user, categoryId);
  const { where, params, ph } = withScope(user, [rid, cat]);
  const { rows } = await db().query(
    `UPDATE daily_budget_rows SET category_id = ${ph[1]}
      WHERE ${where} AND id = ${ph[0]}
      RETURNING id, account_id, date, label, amount, kind, category_id, recurring_tag`,
    params);
  if (!rows[0]) throw notFound('That entry');
  return shapeRow(rows[0]);
}

/**
 * Mark a projected bill paid — materialise the occurrence as a real row under
 * `__recur__:<ruleId>:<date>`.
 *
 * The date is checked against the rule's own expansion first. A tag for a date
 * the rule never fires on would be an orphan: it suppresses nothing, so the
 * projection stays on the screen next to the payment that settled it, and the
 * month double-counts. The occurrence has to be one occurrencesInMonth() would
 * actually produce, or this is not a bill being paid.
 *
 * Idempotent by the unique index on (household_id, recurring_tag), not by a
 * read-then-write: two taps on a slow connection are two concurrent requests,
 * and only the database can decide between them. ON CONFLICT DO NOTHING means
 * the loser gets `already: true` instead of paying the bill twice.
 */
async function markBillPaid(user, { ruleId, date, amount, label, accountId, categoryId } = {}) {
  await ensureSchema();
  if (!isDate(date)) throw badRequest('Pick a date.');
  const rule = await ownedRow(user, 'daily_recurring_rules', ruleId);
  if (!rule) throw notFound('That scheduled bill');

  const anchor = isoDay(rule.anchor_date);
  const month = String(date).slice(0, 7);
  const fires = anchor
    ? occurrencesInMonth({ frequency: rule.frequency, anchor_date: anchor }, month)
    : [];
  if (!fires.includes(date)) throw badRequest('That bill isn’t due on that date.');

  const tag = recurTag(rule.id, date);
  const k = ROW_KINDS.has(String(rule.kind)) ? rule.kind : 'expense';
  // Amount and account may be corrected at payment time — the bill you pay is
  // not always the bill you expected — but they default to the rule's own.
  const amt = amount === undefined ? num(rule.amount) : money(amount);
  if (!Number.isFinite(amt)) throw badRequest('Enter an amount.');
  const acct = await requireAccount(user, accountId ?? rule.account_id);
  const cat = categoryId === undefined ? (rule.category_id ?? null) : await resolveCategory(user, categoryId);
  const text = cleanLabel(label) || cleanLabel(rule.label);

  const { params } = withScope(user);
  const { rows } = await db().query(
    `INSERT INTO daily_budget_rows
       (household_id, account_id, date, label, amount, kind, category_id, recurring_tag, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (household_id, recurring_tag) DO NOTHING
     RETURNING id, account_id, date, label, amount, kind, category_id, recurring_tag`,
    [params[0], acct.id, date, text, amt, k, cat, tag, user?.id ?? null]);

  if (!rows[0]) {
    const { where, params: p2, ph } = withScope(user, [tag]);
    const { rows: had } = await db().query(
      `SELECT id, account_id, date, label, amount, kind, category_id, recurring_tag
         FROM daily_budget_rows WHERE ${where} AND recurring_tag = ${ph[0]}`,
      p2);
    return { already: true, row: had[0] ? shapeRow(had[0]) : null };
  }
  return { already: false, row: shapeRow(rows[0]) };
}

// ---------------------------------------------------------------------------
// Recurring rules
// ---------------------------------------------------------------------------

const shapeRule = (r) => ({
  id: r.id,
  accountId: r.account_id,
  label: r.label,
  kind: r.kind,
  amount: signedAmount(num(r.amount), r.kind),
  frequency: r.frequency,
  anchorDate: isoDay(r.anchor_date),
  categoryId: r.category_id ?? null,
  active: r.active,
});

async function listRules(user) {
  await ensureSchema();
  const { where, params } = withScope(user);
  const { rows } = await db().query(
    `SELECT r.id, r.account_id, r.label, r.amount, r.kind, r.frequency, r.anchor_date,
            r.category_id, r.active, a.name AS account_name
       FROM daily_recurring_rules r
       LEFT JOIN daily_accounts a ON a.id = r.account_id
      WHERE r.${where} ORDER BY r.active DESC, r.anchor_date, r.id`,
    params);
  return rows.map((r) => ({ ...shapeRule(r), accountName: r.account_name ?? null }));
}

async function createRule(user, { accountId, label, amount, kind, frequency, anchorDate, categoryId = null, active = true } = {}) {
  await ensureSchema();
  const text = cleanLabel(label);
  if (!text) throw badRequest('Give the bill a name.');
  const amt = money(amount);
  if (!Number.isFinite(amt) || amt === 0) throw badRequest('Enter an amount.');
  const k = requireKind(kind);
  const f = String(frequency || '');
  if (!FREQUENCIES.has(f)) throw badRequest('Pick weekly, biweekly or monthly.');
  // The anchor is not decoration: for weekly and biweekly it fixes WHICH day the
  // rule lands on, and for monthly it is the day-of-month the expansion clamps.
  if (!isDate(anchorDate)) throw badRequest('Pick the date it next falls on.');
  const acct = await requireAccount(user, accountId);
  const cat = await resolveCategory(user, categoryId);

  const { params } = withScope(user);
  const { rows } = await db().query(
    `INSERT INTO daily_recurring_rules
       (household_id, account_id, label, amount, kind, frequency, anchor_date, category_id, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, account_id, label, amount, kind, frequency, anchor_date, category_id, active`,
    [params[0], acct.id, text, amt, k, f, anchorDate, cat, !!active]);
  return shapeRule(rows[0]);
}

/**
 * Edit a rule.
 *
 * Note what this does NOT do: it does not touch rows already materialised from
 * it. Changing the amount of the electricity bill must not rewrite what you
 * actually paid in March. Past occurrences are history; the rule only describes
 * the ones still to come.
 */
async function updateRule(user, id, patch = {}) {
  await ensureSchema();
  const existing = await ownedRow(user, 'daily_recurring_rules', id, 'id, household_id');
  if (!existing) throw notFound('That scheduled bill');

  const sets = [];
  const vals = [];
  if (patch.label !== undefined) {
    const text = cleanLabel(patch.label);
    if (!text) throw badRequest('Give the bill a name.');
    sets.push('label'); vals.push(text);
  }
  if (patch.amount !== undefined) {
    const amt = money(patch.amount);
    if (!Number.isFinite(amt) || amt === 0) throw badRequest('Enter an amount.');
    sets.push('amount'); vals.push(amt);
  }
  if (patch.kind !== undefined) { sets.push('kind'); vals.push(requireKind(patch.kind)); }
  if (patch.frequency !== undefined) {
    if (!FREQUENCIES.has(String(patch.frequency))) throw badRequest('Pick weekly, biweekly or monthly.');
    sets.push('frequency'); vals.push(String(patch.frequency));
  }
  if (patch.anchorDate !== undefined) {
    if (!isDate(patch.anchorDate)) throw badRequest('Pick the date it next falls on.');
    sets.push('anchor_date'); vals.push(patch.anchorDate);
  }
  if (patch.accountId !== undefined) {
    const acct = await requireAccount(user, patch.accountId);
    sets.push('account_id'); vals.push(acct.id);
  }
  if (patch.categoryId !== undefined) {
    sets.push('category_id'); vals.push(await resolveCategory(user, patch.categoryId));
  }
  if (patch.active !== undefined) { sets.push('active'); vals.push(!!patch.active); }
  if (!sets.length) throw badRequest('Nothing to update.');

  const { where, params, ph } = withScope(user, [existing.id, ...vals]);
  const assignments = sets.map((col, i) => `${col} = ${ph[i + 1]}`).join(', ');
  const { rows } = await db().query(
    `UPDATE daily_recurring_rules SET ${assignments}
      WHERE ${where} AND id = ${ph[0]}
      RETURNING id, account_id, label, amount, kind, frequency, anchor_date, category_id, active`,
    params);
  if (!rows[0]) throw notFound('That scheduled bill');
  return shapeRule(rows[0]);
}

/**
 * Delete a rule outright.
 *
 * Unlike an account, a rule owns no history: the payments it produced are
 * ordinary rows that keep their tag and their place in the register after it is
 * gone. Only the future projections disappear, which is what "stop this bill"
 * means. Deactivating (`updateRule(..., { active: false })`) is the softer
 * option and is what the UI should offer first.
 */
async function deleteRule(user, id) {
  await ensureSchema();
  const { where, params, ph } = withScope(user, [asId(id) ?? -1]);
  const { rows } = await db().query(
    `DELETE FROM daily_recurring_rules WHERE ${where} AND id = ${ph[0]} RETURNING id`,
    params);
  if (!rows[0]) throw notFound('That scheduled bill');
  return { ok: true, id: rows[0].id };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const CATEGORY_COLOURS = ['#8ECAE6', '#FB8501', '#7dd3fc', '#F6BD60', '#A78BFA', '#EF4444'];

async function listCategories(user) {
  await ensureSchema();
  const { where, params } = withScope(user);
  const { rows } = await db().query(
    `SELECT id, name, kind, color, sort_order
       FROM daily_categories WHERE ${where} ORDER BY sort_order, id`,
    params);
  return rows.map((c) => ({
    id: c.id, name: c.name, kind: c.kind, color: c.color, sortOrder: c.sort_order,
  }));
}

async function createCategory(user, { name, kind = 'expense', color = null } = {}) {
  await ensureSchema();
  const label = String(name || '').trim().slice(0, 40);
  if (!label) throw badRequest('Give the category a name.');
  const k = String(kind || 'expense');
  if (!ROW_KINDS.has(k)) throw badRequest('A category is for income or for expenses.');

  const { where, params } = withScope(user);
  const { rows: countRows } = await db().query(
    `SELECT COUNT(*)::int AS n FROM daily_categories WHERE ${where}`, params);
  // Pick a colour from the palette rather than leaving it null, so a fresh
  // category is legible in a chart the moment it has spend against it.
  const colour = color || CATEGORY_COLOURS[(countRows[0]?.n ?? 0) % CATEGORY_COLOURS.length];

  const { rows } = await db().query(
    `INSERT INTO daily_categories (household_id, name, kind, color, sort_order)
     VALUES ($1, $2, $3, $4,
             COALESCE((SELECT MAX(sort_order) + 1 FROM daily_categories WHERE ${where}), 0))
     RETURNING id, name, kind, color, sort_order`,
    [params[0], label, k, colour]);
  const c = rows[0];
  return { id: c.id, name: c.name, kind: c.kind, color: c.color, sortOrder: c.sort_order };
}

/**
 * Delete a category. Rows filed under it are NOT deleted — the FK is
 * ON DELETE SET NULL, so they fall back into the unsorted bucket and show up in
 * `unsortedSpend` waiting to be re-filed. Removing a label must never remove
 * the money it was attached to.
 */
async function deleteCategory(user, id) {
  await ensureSchema();
  const { where, params, ph } = withScope(user, [asId(id) ?? -1]);
  const { rows } = await db().query(
    `DELETE FROM daily_categories WHERE ${where} AND id = ${ph[0]} RETURNING id`, params);
  if (!rows[0]) throw notFound('That category');
  return { ok: true, id: rows[0].id };
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

/**
 * Log what an account actually holds on a given day.
 *
 * This is the anchor everything else is measured from: the opening figure a
 * month starts from and the "in the bank" number the Today card shows. It is
 * hand-entered because there is no bank feed — so `day` must be the customer's
 * day in the HOUSEHOLD's timezone, resolved by the caller, never now()::date.
 * A balance logged at 8pm Eastern and filed against tomorrow is a balance that
 * appears to come from the future and wins every "latest reading" comparison.
 */
async function setBalance(user, { accountId, day, balance } = {}) {
  await ensureSchema();
  const acct = await requireAccount(user, accountId);
  const d = isDate(day) ? String(day) : todayIn(tzOf(user));
  const amt = Number(balance);
  // NOT money(): a credit card balance is legitimately negative, and taking the
  // absolute value here would turn every card someone owes on into an asset.
  if (!Number.isFinite(amt)) throw badRequest('Enter a balance.');
  const rounded = Math.round(amt * 100) / 100;

  const { params } = withScope(user);
  const { rows } = await db().query(
    `INSERT INTO daily_balances (household_id, account_id, day, balance)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (account_id, day)
     DO UPDATE SET balance = EXCLUDED.balance, updated_at = now()
     RETURNING account_id, day, balance`,
    [params[0], acct.id, d, rounded]);
  const r = rows[0];
  return { accountId: r.account_id, day: isoDay(r.day), balance: num(r.balance) };
}

// ---------------------------------------------------------------------------
// The Today card
// ---------------------------------------------------------------------------

/**
 * The small card the Today screen shows: this month, what has gone out so far,
 * what is left, and what lands next.
 *
 * `remaining` is CASH ON HAND minus the bills still to come — not the month's
 * projected ending balance, and not a budget allowance. It is the answer to
 * "can I spend anything today", which is the only question this card exists to
 * answer. See the projection-vs-cash block in getMonth() before changing it:
 * feed this the projected balance and it subtracts every unpaid bill twice.
 *
 * With no accounts yet this returns zeros and `needsAccount: true` rather than
 * a card full of dashes — the Today screen renders a "set up your first
 * account" prompt off that flag.
 */
async function summary(user) {
  await ensureSchema();
  const tz = tzOf(user);
  const month = currentMonth(tz);
  const m = await getMonth(user, month);

  const upcoming = m.bills
    .filter((b) => b.amount < 0)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const overdue = upcoming.filter((b) => b.overdue);

  // A bill due on the 2nd is the next bill on the 30th, so when this month has
  // nothing left to pay we look one month ahead rather than reporting "nothing
  // due" to someone whose rent is three days away.
  let nextBill = upcoming.find((b) => !b.overdue) || null;
  if (!nextBill) nextBill = await peekNextMonthBill(user, month, m.today);

  return {
    month,
    today: m.today,
    currency: m.currency,
    needsAccount: m.needsAccount,
    accountCount: m.accounts.length,
    // Cash on hand, per account and combined, plus when it was last confirmed.
    // `asOf` being null means nobody has ever logged a balance, and every
    // figure derived from it is only as good as the opening entry.
    balances: m.bankNow,
    inBank: m.inBank,
    asOf: m.bankAsOf,
    spent: m.totals.expenses,
    income: m.totals.income,
    billsLeft: m.totals.billsLeft,
    remaining: m.inBank - m.totals.billsLeft,
    // The month's projection, kept and labelled honestly so nothing has to
    // reach for `remaining` when it wanted this.
    projectedEom: m.totals.endingBalance,
    overdueCount: overdue.length,
    overdueTotal: overdue.reduce((n, b) => n + Math.abs(b.amount), 0),
    nextBill,
    nextBills: upcoming.filter((b) => !b.overdue).slice(0, 3),
    overdueBills: overdue.slice(0, 3),
  };
}

/**
 * The first unpaid bill of NEXT month. Same expansion and the same tag as
 * everywhere else — a bill already paid ahead of time must not reappear here as
 * the next thing due.
 */
async function peekNextMonthBill(user, month, today) {
  const next = shiftMonth(month, 1);
  const { from, to } = monthRange(next);
  const { where, params, ph } = withScope(user, [from, to]);

  const [rulesRes, paidRes] = await Promise.all([
    db().query(
      `SELECT r.id, r.account_id, r.label, r.amount, r.kind, r.frequency, r.anchor_date,
              a.name AS account_name
         FROM daily_recurring_rules r
         LEFT JOIN daily_accounts a ON a.id = r.account_id
        WHERE r.${where} AND r.active AND r.kind = 'expense'`,
      params.slice(0, 1)),
    db().query(
      `SELECT recurring_tag FROM daily_budget_rows
        WHERE ${where} AND date BETWEEN ${ph[0]} AND ${ph[1]} AND recurring_tag IS NOT NULL`,
      params),
  ]);

  const paid = new Set(paidRes.rows.map((r) => r.recurring_tag).filter(isRecurTag));
  let best = null;
  for (const r of rulesRes.rows) {
    const anchor = isoDay(r.anchor_date);
    if (!anchor) continue;
    for (const date of occurrencesInMonth({ frequency: r.frequency, anchor_date: anchor }, next)) {
      const tag = recurTag(r.id, date);
      if (paid.has(tag)) continue;
      if (best && best.date <= date) continue;
      best = {
        tag,
        ruleId: r.id,
        label: r.label,
        accountId: r.account_id,
        accountName: r.account_name ?? null,
        kind: r.kind,
        amount: signedAmount(num(r.amount), r.kind),
        date,
        overdue: date < today,
      };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------

module.exports = {
  available, ensureSchema,
  // accounts
  listAccounts, createAccount, updateAccount, archiveAccount, ACCOUNT_KINDS,
  // the screen
  getMonth, summary,
  // ledger
  addRow, updateRow, deleteRow, setRowCategory, markBillPaid,
  // rules
  listRules, createRule, updateRule, deleteRule,
  // categories
  listCategories, createCategory, deleteCategory,
  // balances
  setBalance,
  // exported for the parity tests — these two must agree with the desktop's
  // implementation, and the tests are how we find out when they stop.
  occurrencesInMonth, recurTag, addDays, monthRange, shiftMonth,
  currentMonth, todayIn, isoDay, daysBetween,
};
