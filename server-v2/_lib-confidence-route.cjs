var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// confidence-compute.ts
var confidence_compute_exports = {};
__export(confidence_compute_exports, {
  computeConfidence: () => computeConfidence,
  dynamic: () => dynamic
});
module.exports = __toCommonJS(confidence_compute_exports);

// ../mnt/user-data/uploads/spx-gex-dashboard-tt-fixed/lib/db.ts
var import_pg = require("pg");
var _pool = null;
var _tablesEnsured = false;
function getPool() {
  if (!_pool) {
    _pool = new import_pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes("localhost") || process.env.DATABASE_URL?.includes("127.0.0.1") ? void 0 : { rejectUnauthorized: false },
      max: 5,
      // cap per-instance conns (Render Postgres is connection-limited)
      idleTimeoutMillis: 3e4,
      // hold idle conns 30s, not pg's 10s default → less connect churn
      keepAlive: true
      // TCP keepalive so dead idle sockets surface fast and reconnect
    });
    _pool.on("error", (err) => {
      console.warn("[db] idle pool client error (will reconnect):", err.message);
    });
  }
  return _pool;
}
async function getDb() {
  const pool = getPool();
  if (!_tablesEnsured) {
    _tablesEnsured = true;
    await ensureAllTables(pool);
  }
  return pool;
}
async function ensureAllTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flow_calls (
      id SERIAL PRIMARY KEY, ts BIGINT NOT NULL, date TEXT NOT NULL,
      source TEXT NOT NULL, symbol TEXT NOT NULL, underlying TEXT, expiration TEXT,
      strike REAL, option_type TEXT, side TEXT, action TEXT, price REAL,
      size INTEGER, premium REAL, is_otm INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_flow_calls_date ON flow_calls(date);
    CREATE INDEX IF NOT EXISTS idx_flow_calls_ts ON flow_calls(ts);

    CREATE TABLE IF NOT EXISTS mvc_snapshots (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      day TEXT, time TEXT, "strikeOIVol" REAL, "mvcValueOIVol" REAL, "pctOI_Vol" REAL,
      "volumeOIVol" REAL, "totalNetGEX_OI" REAL, "strikeVolOnly" REAL, "mvcValueVolOnly" REAL,
      "pctVol_Only" REAL, "volumeVolOnly" REAL, "totalNetGEX_Vol" REAL, "spxPrice" REAL,
      "esPrice" REAL, "netDEXStrike" REAL, "totalNetDEX_OI" REAL, "totalNetDEX_Vol" REAL,
      "totalAbsNetGEX" REAL, "gexFlip" REAL, "triggerType" TEXT, expiration TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mvc_date ON mvc_snapshots(date);
    CREATE INDEX IF NOT EXISTS idx_mvc_ts ON mvc_snapshots(timestamp);

    -- Confidence-score calibration log. One row per scored MVC level per day.
    -- Scores are captured as-predicted; the actual_* columns are graded once the
    -- session is final (date < today or session complete). Grading rule:
    --   held  = pivot OR chop  (wall defended)   broke = clean break-through.
    -- reach_hit = price actually got to the level. Used to measure whether the
    -- Reach/Reject/Break probabilities are calibrated (predicted % vs actual %).
    CREATE TABLE IF NOT EXISTS confidence_log (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      level REAL NOT NULL,
      regime TEXT,
      reach REAL, pivot REAL, chop REAL, "break" REAL, "netWallBias" REAL,
      scored_at BIGINT NOT NULL,
      touched INTEGER,            -- 1 = price reached the level (grades Reach)
      actual_outcome TEXT,        -- 'pivot' | 'chop' | 'break' | 'miss'
      held INTEGER,               -- 1 = defended (pivot|chop), given touched
      broke INTEGER,              -- 1 = clean break-through, given touched
      graded_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_conflog_date ON confidence_log(date);
    CREATE INDEX IF NOT EXISTS idx_conflog_graded ON confidence_log(graded_at);

    -- Cached reference levels (PDH/PDL written EOD, PWH/PWL written Sunday) so
    -- the analytics Levels card stops recomputing them from 20 days of candles.
    -- kind='day'  key=session date (YYYY-MM-DD)
    -- kind='week' key=that week's Monday date (YYYY-MM-DD)
    CREATE TABLE IF NOT EXISTS ref_levels (
      symbol TEXT NOT NULL,
      kind   TEXT NOT NULL,
      key    TEXT NOT NULL,
      high   REAL NOT NULL,
      low    REAL NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (symbol, kind, key)
    );
    CREATE INDEX IF NOT EXISTS idx_ref_levels_lookup ON ref_levels(symbol, kind, key);

    CREATE TABLE IF NOT EXISTS premium_flow (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      time TEXT, "callPremium" REAL, "putPremium" REAL, "netPremium" REAL, "spxPrice" REAL
    );
    CREATE INDEX IF NOT EXISTS idx_pf_date ON premium_flow(date);
    CREATE INDEX IF NOT EXISTS idx_pf_ts ON premium_flow(timestamp);

    CREATE TABLE IF NOT EXISTS greeks_ts (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      time TEXT, ticker TEXT, price REAL, "gexRaw" REAL, "dexRaw" REAL, "chexRaw" REAL, "vexRaw" REAL,
      gex REAL, dex REAL, chex REAL, vex REAL, "buyScore" REAL, "sellScore" REAL
    );
    CREATE INDEX IF NOT EXISTS idx_gts_date ON greeks_ts(date);
    CREATE INDEX IF NOT EXISTS idx_gts_ts ON greeks_ts(timestamp);

    CREATE TABLE IF NOT EXISTS playbook_feed (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      time TEXT, text TEXT NOT NULL, color TEXT, source TEXT DEFAULT 'insights-exposure',
      expiry TEXT, regime_key TEXT, spot REAL, gex REAL, dex REAL, chex REAL, vex REAL
    );
    CREATE INDEX IF NOT EXISTS idx_playbook_date ON playbook_feed(date);
    CREATE INDEX IF NOT EXISTS idx_playbook_ts ON playbook_feed(timestamp);

    -- NOTE: UNIQUE is ("slotKey","intervalMinutes"), NOT slotKey alone. slotKey is
    -- 'YYYY-MM-DDTHH:MM' and carries no interval, so a 1m bar at 09:30 and a 5m
    -- bar at 09:30 are the SAME key. Under the old slotKey-only UNIQUE the 1m bar
    -- silently overwrote the 5m bar's close+volume (and left intervalMinutes
    -- reading 5, so the damage didn't even show up in a GROUP BY). Existing DBs
    -- are migrated by scripts/migrate-es-candles-composite-key.sql \u2014 this CREATE
    -- is IF NOT EXISTS and will NOT retrofit them.
    CREATE TABLE IF NOT EXISTS es_candles (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      "slotKey" TEXT NOT NULL, time TEXT, symbol TEXT,
      "intervalMinutes" INTEGER NOT NULL DEFAULT 5,
      source TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL, "avgVolume" REAL,
      CONSTRAINT es_candles_slot_interval_key UNIQUE ("slotKey", "intervalMinutes")
    );
    CREATE INDEX IF NOT EXISTS idx_ec_date ON es_candles(date);
    CREATE INDEX IF NOT EXISTS idx_ec_slot ON es_candles("slotKey");
    CREATE INDEX IF NOT EXISTS idx_ec_interval_date ON es_candles("intervalMinutes", date);

    CREATE TABLE IF NOT EXISTS nq_candles (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      "slotKey" TEXT NOT NULL UNIQUE, time TEXT, symbol TEXT, "intervalMinutes" INTEGER,
      source TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL, "avgVolume" REAL
    );
    CREATE INDEX IF NOT EXISTS idx_nc_date ON nq_candles(date);
    CREATE INDEX IF NOT EXISTS idx_nc_slot ON nq_candles("slotKey");

    CREATE TABLE IF NOT EXISTS es_footprint (
      day TEXT PRIMARY KEY, symbol TEXT, updated_at BIGINT NOT NULL, payload JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ib_levels (
      id SERIAL PRIMARY KEY, date TEXT NOT NULL UNIQUE, symbol TEXT DEFAULT '/ES',
      timestamp BIGINT NOT NULL, locked INTEGER DEFAULT 0,
      high REAL, low REAL, mid REAL, range REAL, "rangePct" REAL,
      "openPrice" REAL, "lowFirst" INTEGER, "barCount" INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ib_date ON ib_levels(date);

    -- EOD Initial Balance results \u2014 one row per (date, symbol), written 16:30 ET
    -- by server-v2/ib-results-recorder.js via POST /api/ib-results. The rules
    -- column is the 14-rule scoreboard: [{id,name,state,side,hit,note}].
    -- NOTE: this whole block is a JS template literal \u2014 never use backticks in
    -- these SQL comments, they terminate the string and break the build.
    CREATE TABLE IF NOT EXISTS ib_daily_results (
      id SERIAL PRIMARY KEY, date TEXT NOT NULL, symbol TEXT NOT NULL,
      ib_high REAL, ib_low REAL, ib_mid REAL, ib_width REAL, width_bucket TEXT,
      bias TEXT, first_formed TEXT, close_zone TEXT, open_type TEXT, orb_dir TEXT, fvg TEXT,
      break_side TEXT, break_min INTEGER, failed INTEGER, retest INTEGER, retest_cont INTEGER,
      vol_surge INTEGER, single_break INTEGER, both_broke INTEGER, neither_broke INTEGER,
      contained_at2 INTEGER, contained_broke_late INTEGER,
      ext_05 INTEGER, ext_10 INTEGER, ext_15 INTEGER, ext_20 INTEGER,
      first_touch_side TEXT, first_touch_min INTEGER,
      day_high REAL, day_low REAL, day_close REAL,
      rules JSONB, computed_at BIGINT NOT NULL,
      UNIQUE(date, symbol)
    );
    CREATE INDEX IF NOT EXISTS idx_ibdr_date ON ib_daily_results(date);

    CREATE TABLE IF NOT EXISTS bzila_snapshots (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      time TEXT, ticker TEXT, session TEXT DEFAULT 'rth', orders TEXT, stats TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bs_date ON bzila_snapshots(date);
    CREATE INDEX IF NOT EXISTS idx_bs_ts ON bzila_snapshots(timestamp);

    CREATE TABLE IF NOT EXISTS option_strike_gex_history (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      expiry TEXT NOT NULL, spot REAL, strike REAL NOT NULL, net_gex REAL NOT NULL,
      net_vol_gex REAL
    );
    -- Backfill column for pre-existing tables (Vol-only heatmap history).
    ALTER TABLE option_strike_gex_history ADD COLUMN IF NOT EXISTS net_vol_gex REAL;
    CREATE INDEX IF NOT EXISTS idx_osgh_date ON option_strike_gex_history(date);
    CREATE INDEX IF NOT EXISTS idx_osgh_expiry ON option_strike_gex_history(expiry);
    CREATE INDEX IF NOT EXISTS idx_osgh_ts ON option_strike_gex_history(timestamp);
    -- Composite index for point-mode baseline queries (open/5/15/30): the
    -- DISTINCT ON (strike) ... ORDER BY strike, timestamp scans need date+expiry
    -- filtering with strike/timestamp ordering. Without this the popup's
    -- option-strike-gex-history?mode=point call took ~25s; with it, sub-second.
    CREATE INDEX IF NOT EXISTS idx_osgh_lookup
      ON option_strike_gex_history (date, expiry, strike, timestamp DESC);

    CREATE TABLE IF NOT EXISTS trades (
      id SERIAL PRIMARY KEY, timestamp TEXT NOT NULL,
      symbol TEXT, side TEXT, qty REAL, price REAL, data TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(timestamp);

    CREATE TABLE IF NOT EXISTS expirations_cache (
      id SERIAL PRIMARY KEY, ticker TEXT NOT NULL UNIQUE,
      timestamp BIGINT NOT NULL, expirations TEXT, raw TEXT
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      time TEXT NOT NULL, period TEXT NOT NULL DEFAULT 'weekly', "tableHtml" TEXT NOT NULL,
      expirations TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS es_stats (
      id SERIAL PRIMARY KEY, expiration TEXT NOT NULL UNIQUE,
      no_long TEXT, up TEXT, mid TEXT, down TEXT, no_short TEXT,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS page_load_status (
      id SERIAL PRIMARY KEY,
      page_key TEXT NOT NULL UNIQUE,
      page_label TEXT,
      path TEXT,
      is_loaded BOOLEAN NOT NULL DEFAULT FALSE,
      last_loaded_at TIMESTAMPTZ,
      last_unloaded_at TIMESTAMPTZ,
      total_loads INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    -- Backfill the visit counter on DBs created before total_loads existed.
    ALTER TABLE page_load_status ADD COLUMN IF NOT EXISTS total_loads INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_page_load_status_loaded ON page_load_status(is_loaded);

    -- One row per page load: full visit history with client IP + (optional) user.
    -- Owner-only data (IP is PII). Pruned to the newest rows on insert.
    CREATE TABLE IF NOT EXISTS page_visits (
      id SERIAL PRIMARY KEY,
      page_key TEXT,
      page_label TEXT,
      path TEXT,
      user_id TEXT,
      ip TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_page_visits_created ON page_visits(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_page_load_status_updated ON page_load_status(updated_at);

    -- One row per ticker interaction (scanner + anywhere tickers are shown).
    -- event = 'click' (user opened it) | 'render' (it appeared in a list).
    -- Per-event log so counts can be sliced by day/user/event; pruned on insert.
    CREATE TABLE IF NOT EXISTS ticker_events (
      id SERIAL PRIMARY KEY,
      ticker TEXT NOT NULL,
      event TEXT NOT NULL,
      source TEXT,
      user_id TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ticker_events_created ON ticker_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ticker_events_ticker ON ticker_events(ticker, event);

    CREATE TABLE IF NOT EXISTS budget_profiles (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      currency TEXT NOT NULL DEFAULT 'USD',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS budget_categories (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      period TEXT NOT NULL DEFAULT 'monthly',
      color TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_budget_categories_profile ON budget_categories(profile_id);

    CREATE TABLE IF NOT EXISTS budget_entries (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES budget_categories(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      title TEXT NOT NULL,
      notes TEXT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_budget_entries_profile ON budget_entries(profile_id);
    CREATE INDEX IF NOT EXISTS idx_budget_entries_occurred ON budget_entries(occurred_at);

    -- Check-register rows: one line item per row, ordered down the page. The
    -- amount lands under one bank column (coastal/truist/secu); a single running
    -- balance is computed client-side. A row with is_beginning=1 seeds the start.
    -- Negative amount = payment, positive = income.
    CREATE TABLE IF NOT EXISTS budget_register (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
      entry_date TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      label TEXT NOT NULL DEFAULT '',
      bank TEXT NOT NULL DEFAULT 'secu',
      amount REAL NOT NULL DEFAULT 0,
      is_beginning INTEGER NOT NULL DEFAULT 0,
      recurring_tag TEXT,
      category_id INTEGER REFERENCES budget_categories(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_budget_register_profile ON budget_register(profile_id);
    CREATE INDEX IF NOT EXISTS idx_budget_register_date ON budget_register(entry_date);
    -- Self-heal for databases created before per-row categories existed.
    ALTER TABLE budget_register ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES budget_categories(id) ON DELETE SET NULL;

    -- One manually-entered opening balance snapshot per day (updated each morning).
    CREATE TABLE IF NOT EXISTS budget_daily_balance (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      coastal REAL NOT NULL DEFAULT 0,
      truist REAL NOT NULL DEFAULT 0,
      secu REAL NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, day)
    );
    CREATE INDEX IF NOT EXISTS idx_budget_daily_balance_profile ON budget_daily_balance(profile_id);

    -- Recurring rules: a payment/income that repeats (weekly/biweekly/monthly).
    -- Occurrences are computed live for the displayed month, not stored as rows.
    -- amount is signed (payment negative, income positive). anchor_date is the
    -- first/reference occurrence; for monthly we repeat on that day-of-month.
    CREATE TABLE IF NOT EXISTS budget_recurring (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT '',
      bank TEXT NOT NULL DEFAULT 'secu',
      amount REAL NOT NULL DEFAULT 0,
      frequency TEXT NOT NULL DEFAULT 'monthly',
      anchor_date TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_budget_recurring_profile ON budget_recurring(profile_id);

    -- Amazon delivery log: one row per delivery (date, gross pay, gas cost).
    -- Multiple rows per work_date are allowed (several trips in one day).
    CREATE TABLE IF NOT EXISTS budget_amazon (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
      work_date TEXT NOT NULL,
      pay REAL NOT NULL DEFAULT 0,
      gas REAL NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_budget_amazon_profile ON budget_amazon(profile_id);
    -- Drop the old one-row-per-day uniqueness so multiple deliveries can share a date.
    ALTER TABLE budget_amazon DROP CONSTRAINT IF EXISTS budget_amazon_profile_id_work_date_key;

    -- Bzila business ledger: one row per dated event. The source column splits the
    -- streams entered here \u2014 'prop' (firm evals/resets + payouts), 'cbedge'
    -- (CB Edge earnings + spending), and 'contracts' (contract work entered
    -- directly on the Bzila tab).
    -- Contracts have TWO sources by design: rows entered here, plus register
    -- (Payments) rows in a Contracts category, which are read in as read-only
    -- ledger lines. Enter a given contract in one place or the other, never both.
    -- cost = money out, payout = money in, for all sources.
    CREATE TABLE IF NOT EXISTS budget_prop (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
      entry_date TEXT NOT NULL,
      firm TEXT NOT NULL DEFAULT 'TPT',
      accounts INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      payout REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_budget_prop_profile ON budget_prop(profile_id);
    -- Added after the table shipped: existing rows are all prop purchases.
    ALTER TABLE budget_prop ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'prop';

    CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      source TEXT DEFAULT 'landing',
      referrer TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      unsubscribed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at);
    ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;

    -- Customer feedback / notes. Any signed-in user can submit; the owner reads
    -- the feed on /dev/owner. category is one of 'bug'|'idea'|'note'|'other'.
    -- status is 'open' (new) or 'resolved' (owner cleared it).
    CREATE TABLE IF NOT EXISTS customer_feedback (
      id          SERIAL PRIMARY KEY,
      clerk_user_id TEXT,
      email       TEXT,
      category    TEXT NOT NULL DEFAULT 'note',
      message     TEXT NOT NULL,
      page        TEXT,
      status      TEXT NOT NULL DEFAULT 'open',
      created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_created ON customer_feedback(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_feedback_status ON customer_feedback(status);

    -- Far CB Watch: customer-added tickers on top of the curated CORE roster
    -- (server-v2/far-cb-tickers.js). Any signed-in user can add one; owner
    -- reviews who added what on /owner/dev (Page Activity-style panel).
    CREATE TABLE IF NOT EXISTS far_cb_custom_tickers (
      symbol        TEXT PRIMARY KEY,
      added_by_id   TEXT,
      added_by_email TEXT,
      created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      active        BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE INDEX IF NOT EXISTS idx_far_cb_custom_created ON far_cb_custom_tickers(created_at DESC);

    -- Email broadcast history. One row per send from /admin/emails. Summary only
    -- (no per-recipient rows). recipients is a JSON array of the addresses sent.
    CREATE TABLE IF NOT EXISTS email_sends (
      id            SERIAL PRIMARY KEY,
      subject       TEXT NOT NULL,
      audience      TEXT NOT NULL,
      sent_count    INTEGER NOT NULL DEFAULT 0,
      failed_count  INTEGER NOT NULL DEFAULT 0,
      recipients    JSONB,
      sent_by       TEXT,
      created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_email_sends_created ON email_sends(created_at DESC);

    -- Global email suppression list. ONE source of truth for "do not email".
    -- Every broadcast audience (accounts, subscribers, waitlist, legacy lists)
    -- is filtered against this before sending. Populated when anyone clicks an
    -- unsubscribe link (source='link') or when the owner adds one by hand
    -- (source='manual'). email is stored normalized (trim + lowercase).
    CREATE TABLE IF NOT EXISTS email_unsubscribes (
      email       TEXT PRIMARY KEY,
      source      TEXT NOT NULL DEFAULT 'link',
      created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_email_unsub_created ON email_unsubscribes(created_at DESC);

    -- Single-use, per-recipient Stripe promotion codes (e.g. the TRY30 nudge
    -- email). One row per email; the code is minted once via the Stripe API
    -- (promotionCodes.create, max_redemptions:1) and reused on any resend so
    -- the same person always gets the same code instead of a fresh one.
    CREATE TABLE IF NOT EXISTS promo_codes_single_use (
      email             TEXT NOT NULL,
      campaign          TEXT NOT NULL,
      code              TEXT NOT NULL,
      coupon_id         TEXT NOT NULL,
      promotion_code_id TEXT NOT NULL,
      created_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (email, campaign)
    );

    -- Business expenses shown/netted on the owner Sales page (/owner/dev/sales).
    -- amount_cents is always the per-cadence charge (e.g. 5000 = $50/mo if
    -- cadence='monthly'); the page converts to a monthly-equivalent for the
    -- Net KPI the same way subscription MRR does (yearly / 12).
    CREATE TABLE IF NOT EXISTS sales_expenses (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      category      TEXT NOT NULL DEFAULT 'other',
      amount_cents  INTEGER NOT NULL,
      cadence       TEXT NOT NULL DEFAULT 'monthly', -- 'monthly' | 'yearly' | 'once'
      created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sales_expenses_created ON sales_expenses(created_at DESC);

    -- Per-ticker weekly Estimated Move tracking. One row per (ticker, week).
    -- week_label is the human label that matches the EstimatedMoves columns
    -- (e.g. "10/3"); week_start is the Monday ISO date for ordering. em is the
    -- expected move (dollars for equities/$ index points, index points for SPX
    -- etc). ref_close is the reference close the band is centered on. The OHLC
    -- columns are the realized weekly candle; result is auto-computed:
    --   'hit'  = OHLC stayed inside the band  (win)
    --   'miss' = high or low broke the band   (loss)
    --   NULL   = not yet evaluated (week not closed / no OHLC)
    CREATE TABLE IF NOT EXISTS em_tracker (
      id SERIAL PRIMARY KEY,
      ticker TEXT NOT NULL,
      week_label TEXT NOT NULL,
      week_start DATE,
      em REAL NOT NULL,
      ref_close REAL,
      up REAL,
      down REAL,
      o REAL, h REAL, l REAL, c REAL,
      result TEXT,          -- 'hit' | 'miss' | NULL  (close inside band = hit)
      breach INTEGER,       -- 1 = high/low poked outside band intraweek, 0 = no, NULL = unknown
      breach_day TEXT,      -- ISO date (YYYY-MM-DD) of the FIRST day the band broke, NULL if none/unknown
      result_source TEXT,   -- 'auto' | 'manual' | 'import'
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_em_tracker_ticker ON em_tracker(ticker);
    CREATE INDEX IF NOT EXISTS idx_em_tracker_week ON em_tracker(week_start);

    -- Migration: add breach column to pre-existing em_tracker tables.
    ALTER TABLE em_tracker ADD COLUMN IF NOT EXISTS breach INTEGER;
    ALTER TABLE em_tracker ADD COLUMN IF NOT EXISTS breach_day TEXT;

    -- Uniqueness is per (ticker, week_start): week_label like "5/1" repeats every
    -- year, so 2 years of history would collide on (ticker, week_label). Keying on
    -- the Monday ISO date keeps each calendar week distinct. Drop the old label
    -- constraint if present, add the date-based one.
    ALTER TABLE em_tracker DROP CONSTRAINT IF EXISTS em_tracker_ticker_week_label_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_em_tracker_ticker_week_start
      ON em_tracker(ticker, week_start);

    -- EOD GEX snapshot: one row per (date, symbol), upserted at 3:55\u20134:05 ET.
    -- total_gex  signed net GEX (same value as the dashboard header)
    -- spot       underlying price at compute time
    -- computed_at ISO timestamp of the actual computation
    CREATE TABLE IF NOT EXISTS eod_gex (
      id          SERIAL PRIMARY KEY,
      date        TEXT NOT NULL,
      symbol      TEXT NOT NULL,
      total_gex   DOUBLE PRECISION NOT NULL,
      spot        DOUBLE PRECISION NOT NULL,
      computed_at TEXT NOT NULL,
      UNIQUE (date, symbol)
    );
    CREATE INDEX IF NOT EXISTS idx_eod_gex_date ON eod_gex(date);
    CREATE INDEX IF NOT EXISTS idx_eod_gex_symbol ON eod_gex(symbol);

    -- Delayed "preview" snapshot for signed-up-but-unpaid users (/preview page).
    -- Written once per cadence (~30m) by server-v2/preview-snapshot-recorder.js,
    -- copying the same /api/gex-derived values the live paid dashboard uses. The
    -- 30m cron cadence IS the delay \u2014 free users only ever see the last written
    -- row, never the live feed. History is kept (not upserted) so a future
    -- "today so far" strip is possible; the route always serves the latest row.
    CREATE TABLE IF NOT EXISTS preview_snapshots (
      id           SERIAL PRIMARY KEY,
      ts           BIGINT NOT NULL,
      date         TEXT NOT NULL,
      time         TEXT,
      spx_price    DOUBLE PRECISION,
      gex_flip     DOUBLE PRECISION,
      call_wall    DOUBLE PRECISION,
      put_wall     DOUBLE PRECISION,
      expiration   TEXT,
      created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_preview_snapshots_ts ON preview_snapshots(ts DESC);

    -- Full-chain static snapshot for /home in "delayed" mode (unpaid signed-in
    -- users). Written every ~30m by server-v2/home-snapshot-recorder.js, which
    -- stores the ENTIRE /proxy/gex payload (chain, spot, expiry, walls, etc.) as
    -- JSON \u2014 everything app/home/page.tsx's readInitial() normally reads live \u2014
    -- so the unpaid render path can reconstruct HomeInitial from a frozen row
    -- instead of the hot in-memory feed. History is kept; the route always
    -- serves the latest row.
    CREATE TABLE IF NOT EXISTS home_static_snapshots (
      id      SERIAL PRIMARY KEY,
      ts      BIGINT NOT NULL,
      date    TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_home_static_snapshots_ts ON home_static_snapshots(ts DESC);

    -- Full-chain static snapshot for /mult-greek in "delayed" mode (unpaid
    -- signed-in users). Written every ~30m by
    -- server-v2/mult-greek-snapshot-recorder.js, which stores the SPX/SPY/QQQ
    -- chain (raw TT items + underlyingPrice) at one shared expiry \u2014 the exact
    -- inputs MultGreekClient's existing buildStrikes()/computeRows() already
    -- know how to parse, so the frozen render reuses all the same code as live.
    CREATE TABLE IF NOT EXISTS mult_greek_static_snapshots (
      id      SERIAL PRIMARY KEY,
      ts      BIGINT NOT NULL,
      date    TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_mult_greek_static_snapshots_ts ON mult_greek_static_snapshots(ts DESC);

    -- Overnight ES gap tracker: one row per trading day, keyed on date.
    -- The gap is two EXACT 5-minute ES candle prints (never substituted):
    --   prior_close = close of YESTERDAY's 15:55 bar  (the 16:00:00 ET print)
    --   open_0930   = open  of TODAY's     09:30 bar  (the 09:30:00 ET print)
    --   gap_pts     = open_0930 - prior_close   (signed; + = gap up, - = gap down)
    -- Once open_0930 is written the row is locked=1 and the gap never changes
    -- (mirrors ib_levels). Fill tracking ratchets toward prior_close and never
    -- reverses: pct_filled climbs 0\u2192100 as price retraces the gap, filled flips
    -- 0\u21921 the moment price touches prior_close (stamped in fill_ts). extreme_after
    -- is the furthest price has traveled toward the close (low for gap-up days,
    -- high for gap-down days) \u2014 the high-water mark that drives pct_filled.
    CREATE TABLE IF NOT EXISTS es_gap (
      id            SERIAL PRIMARY KEY,
      date          TEXT NOT NULL UNIQUE,
      symbol        TEXT NOT NULL DEFAULT '/ES',
      prior_close   DOUBLE PRECISION,
      open_0930     DOUBLE PRECISION,
      gap_pts       DOUBLE PRECISION,
      gap_dir       TEXT,                 -- 'up' | 'down' | 'flat'
      locked        INTEGER NOT NULL DEFAULT 0,
      filled        INTEGER NOT NULL DEFAULT 0,
      pct_filled    DOUBLE PRECISION NOT NULL DEFAULT 0,  -- 0..100, ratchets up
      fill_ts       BIGINT,               -- epoch ms when price first touched prior_close
      extreme_after DOUBLE PRECISION,     -- furthest price toward prior_close so far
      open_ts       BIGINT,               -- epoch ms the row was posted (9:30 bar landed)
      updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_es_gap_date ON es_gap(date);

    -- ICT setup recorder: one row per detected ICT setup (every concept that
    -- flips "live"). Written by server-v2/ict-setup-tracker via /api/ict-setups.
    -- A row is keyed on a stable signature (setup_key) so re-scans never double-
    -- log the same event: setup_key = "<kind>:<dir>:<trigger_ts>:<round(price)>".
    --   kind       \u2014 concept id (fvg, ob, ifvg, ote, mss, bos, choch, liquidity,
    --                 eqhl, inducement, turtleSoup, judas, breaker, cisd,
    --                 model2022, displacement)
    --   dir        \u2014 'bull' | 'bear' | 'neutral'
    --   trigger_ts \u2014 epoch ms of the candle that fired the setup
    --   price      \u2014 the level/price the setup triggered at
    --   note       \u2014 short human description of the trigger
    -- Outcome is graded by follow-through over the bars AFTER trigger_ts:
    --   target       \u2014 implied directional objective
    --   invalidation \u2014 level that, if hit first, fails the setup
    --   outcome      \u2014 'pending' | 'win' | 'loss' | 'chop'
    --   mfe/mae      \u2014 max favorable / adverse excursion (pts) since trigger
    --   r_multiple   \u2014 favorable move achieved / initial risk to invalidation
    CREATE TABLE IF NOT EXISTS ict_setups (
      id             SERIAL PRIMARY KEY,
      setup_key      TEXT NOT NULL UNIQUE,
      date           TEXT NOT NULL,
      kind           TEXT NOT NULL,
      label          TEXT,
      dir            TEXT,
      trigger_ts     BIGINT NOT NULL,
      price          DOUBLE PRECISION,
      note           TEXT,
      target         DOUBLE PRECISION,
      invalidation   DOUBLE PRECISION,
      outcome        TEXT NOT NULL DEFAULT 'pending',
      mfe            DOUBLE PRECISION NOT NULL DEFAULT 0,
      mae            DOUBLE PRECISION NOT NULL DEFAULT 0,
      r_multiple     DOUBLE PRECISION,
      resolved_ts    BIGINT,
      resolved_price DOUBLE PRECISION,
      created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ict_setups_date ON ict_setups(date);
    CREATE INDEX IF NOT EXISTS idx_ict_setups_ts ON ict_setups(trigger_ts);
    CREATE INDEX IF NOT EXISTS idx_ict_setups_outcome ON ict_setups(outcome);

    -- Momentum Bias take-profit / reversal signals. One row per fired trigger on
    -- a CLOSED 5m ES bar (the forming bar is never recorded \u2014 it repaints). The
    -- feed computes lib/momentumBias.js over the rolling candle array; a crossunder
    -- of the up/down bias above the impulse boundary fires a signal. Keyed on a
    -- stable signature so re-scans never double-log: signal_key = "<dir>:<slotKey>".
    --   dir      \u2014 'bull' (down-bias crossunder \u2192 TP for shorts / bullish reversal)
    --            | 'bear' (up-bias crossunder \u2192 TP for longs / bearish reversal)
    --   price    \u2014 ES close of the signal bar
    --   up/down_bias, boundary \u2014 indicator state at the trigger
    -- Outcome is graded by follow-through over the bars AFTER trigger_ts, with an
    -- ATR-scaled target (atr = avg H-L of the 14 bars before the signal):
    --   outcome  \u2014 'pending' | 'win' | 'loss' | 'chop'
    --   mfe/mae  \u2014 max favorable / adverse excursion (pts) in the signal's direction
    --   r_multiple \u2014 favorable move achieved / initial risk (atr)
    CREATE TABLE IF NOT EXISTS momentum_bias_signals (
      id             SERIAL PRIMARY KEY,
      signal_key     TEXT NOT NULL UNIQUE,
      date           TEXT NOT NULL,
      symbol         TEXT NOT NULL DEFAULT '/ES',
      dir            TEXT NOT NULL,
      trigger_ts     BIGINT NOT NULL,
      slot_key       TEXT,
      time           TEXT,
      price          DOUBLE PRECISION,
      up_bias        DOUBLE PRECISION,
      down_bias      DOUBLE PRECISION,
      boundary       DOUBLE PRECISION,
      atr            DOUBLE PRECISION,
      outcome        TEXT NOT NULL DEFAULT 'pending',
      mfe            DOUBLE PRECISION NOT NULL DEFAULT 0,
      mae            DOUBLE PRECISION NOT NULL DEFAULT 0,
      r_multiple     DOUBLE PRECISION,
      resolved_ts    BIGINT,
      resolved_price DOUBLE PRECISION,
      created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_mbs_date ON momentum_bias_signals(date);
    CREATE INDEX IF NOT EXISTS idx_mbs_ts ON momentum_bias_signals(trigger_ts);
    CREATE INDEX IF NOT EXISTS idx_mbs_outcome ON momentum_bias_signals(outcome);

    -- Stripe subscription state. One row per Clerk user (clerk_user_id is the PK
    -- and the only identity we trust \u2014 never a client-supplied value). Mirrors
    -- the live state of the user's Stripe subscription, written exclusively by
    -- the Stripe webhook. status follows Stripe's subscription.status enum
    -- ('active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | ...).
    -- Gating treats 'active' and 'trialing' as paid. current_period_end is the
    -- epoch-seconds end of the paid period (for grace handling / display).
    CREATE TABLE IF NOT EXISTS subscriptions (
      clerk_user_id          TEXT PRIMARY KEY,
      stripe_customer_id     TEXT,
      stripe_subscription_id TEXT,
      status                 TEXT,
      price_id               TEXT,
      current_period_end     BIGINT,
      cancel_at_period_end   INTEGER NOT NULL DEFAULT 0,
      created_at             TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at             TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(stripe_customer_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_sub ON subscriptions(stripe_subscription_id);
    -- Set once when the founder thank-you auto-welcome has been emailed to this
    -- paid user. NULL = never sent. Guarantees exactly one welcome per customer.
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;

    -- Traders Dashboard per-user preferences. One row per Clerk user. schedule and
    -- tasks are JSON arrays the page owns; zip drives the weather card.
    CREATE TABLE IF NOT EXISTS td_user_prefs (
      clerk_user_id TEXT PRIMARY KEY,
      zip           TEXT,
      schedule      JSONB NOT NULL DEFAULT '[]'::jsonb,
      tasks         JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    -- Added after the table shipped. MUST stay after the CREATE above: an ALTER
    -- placed earlier in this script throws "relation does not exist" on a fresh
    -- DB and aborts every table after it (IF NOT EXISTS covers the column, not
    -- the table).
    ALTER TABLE td_user_prefs ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]'::jsonb;

    -- Traders Dashboard "Words from Bzila" owner note. Single global row (id=1),
    -- shown to every visitor of the Traders Dashboard page; only the owner can
    -- write/clear it (enforced server-side via getServerIsOwner in the API route).
    CREATE TABLE IF NOT EXISTS bzila_note (
      id         INTEGER PRIMARY KEY DEFAULT 1,
      content    TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT bzila_note_singleton CHECK (id = 1)
    );

    -- Owner "Bzila alerts" broadcast, shown in the toolbar bell dropdown (latest
    -- 5). Any signed-in paid user reads; only the owner can insert/edit/delete
    -- (enforced server-side via getServerIsOwner in the API route).
    CREATE TABLE IF NOT EXISTS bzila_alerts (
      id         SERIAL PRIMARY KEY,
      title      TEXT NOT NULL DEFAULT '',
      body       TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    -- \u{1F44D}/\u{1F44E} reactions on Bzila alerts. One row per (alert, user) \u2014 reaction holds
    -- the current pick ('' | 'up' | 'down', toggles off when re-clicked); clicks
    -- counts every tap so the owner report can show engagement, not just final
    -- state. email is denormalized for the owner "who reacted" list.
    CREATE TABLE IF NOT EXISTS bzila_alert_reactions (
      alert_id   INTEGER NOT NULL,
      user_id    TEXT NOT NULL,
      email      TEXT NOT NULL DEFAULT '',
      reaction   TEXT NOT NULL DEFAULT '',
      clicks     INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (alert_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS bzila_alert_reactions_alert_idx ON bzila_alert_reactions (alert_id);

    -- Traders Dashboard overnight AI overview. One row per ET date, written once
    -- by the 7am cron (overview-generator.js). summary is the narrative; drivers
    -- is a JSON array of {when,title,body} econ/news items.
    CREATE TABLE IF NOT EXISTS td_overview (
      date       TEXT PRIMARY KEY,
      summary    TEXT NOT NULL,
      drivers    JSONB NOT NULL DEFAULT '[]'::jsonb,
      generated_at BIGINT NOT NULL
    );
    -- Added after the table shipped. MUST stay after the CREATE above (see the
    -- td_user_prefs note).
    ALTER TABLE td_overview ADD COLUMN IF NOT EXISTS movers JSONB NOT NULL DEFAULT '[]'::jsonb;

    -- Pre-market AI 5-bullet read of the global overnight tape, written daily by
    -- the cron (premarket-summary-generator.js). bullets is a JSON array of
    -- strings; read by the Analytics Premarket card via GET (latest row).
    CREATE TABLE IF NOT EXISTS premarket_summary (
      date       TEXT PRIMARY KEY,
      bullets    JSONB NOT NULL DEFAULT '[]'::jsonb,
      generated_at BIGINT NOT NULL
    );

    -- Daily AI trade strategy for the Analytics strategy-builder card, written
    -- hourly on weekdays (~08:00-16:00 ET) by the cron (strategy-generator.js).
    -- plan is a JSON object (bias, levels, idea, risk, triggers); this row is the
    -- CURRENT plan (overwritten each hour) and is what the StrategyBuilder reads.
    CREATE TABLE IF NOT EXISTS daily_strategy (
      date       TEXT PRIMARY KEY,
      plan       JSONB NOT NULL DEFAULT '{}'::jsonb,
      generated_at BIGINT NOT NULL
    );

    -- Intraday audit trail: one row per hourly regeneration. daily_strategy only
    -- keeps the latest plan for the day, so this table preserves how the plan
    -- evolved (the Anthropic API does not retain past completions for us).
    CREATE TABLE IF NOT EXISTS daily_strategy_history (
      date         TEXT   NOT NULL,
      hour         INT    NOT NULL,          -- ET hour slot (8..16)
      plan         JSONB  NOT NULL DEFAULT '{}'::jsonb,
      generated_at BIGINT NOT NULL,
      PRIMARY KEY (date, hour)
    );
    CREATE INDEX IF NOT EXISTS idx_strategy_hist_date ON daily_strategy_history(date DESC, hour DESC);

    -- /ict glossary card visibility, per Clerk user. hidden_cards is a JSON array
    -- of concept ids (from CONCEPTS in app/ict/page.tsx) the user has toggled OFF.
    -- Empty array = all cards shown (the default). One row per user.
    CREATE TABLE IF NOT EXISTS ict_card_prefs (
      clerk_user_id TEXT PRIMARY KEY,
      hidden_cards  JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    -- Per-user customized Quotes list (toolbar dropdown). symbols is an ordered
    -- JSON array of { sym, label }. NULL/absent row = use the built-in defaults.
    CREATE TABLE IF NOT EXISTS quote_symbol_prefs (
      clerk_user_id TEXT PRIMARY KEY,
      symbols       JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    -- Per-user customized Options Positioning row (/test Positioning tab's
    -- second, user-editable row \u2014 the fixed SPX/NDX/SPY/QQQ row above it is
    -- never stored here). tickers is an ordered JSON array of exactly 4
    -- uppercase root symbols. Missing row = use the built-in default below.
    CREATE TABLE IF NOT EXISTS positioning_ticker_prefs (
      clerk_user_id TEXT PRIMARY KEY,
      tickers       JSONB NOT NULL DEFAULT '["AAPL","NVDA","TSLA","AMD"]'::jsonb,
      updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    -- Owner options watchlist (the /owner/watch tracker). One row per watched
    -- contract; live greeks/price/flow are captured into watch_snapshots.
    CREATE TABLE IF NOT EXISTS watch_options (
      id            SERIAL PRIMARY KEY,
      ticker        TEXT NOT NULL,
      expiration    TEXT NOT NULL,          -- YYYY-MM-DD
      strike        REAL NOT NULL,
      side          TEXT NOT NULL,          -- 'C' | 'P'
      note          TEXT,
      added_price   REAL,                   -- mark at the moment the contract was saved
      created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (ticker, expiration, strike, side)
    );
    ALTER TABLE watch_options ADD COLUMN IF NOT EXISTS added_price REAL;

    -- Time series of live values for each watched contract (greeks, quote, flow).
    CREATE TABLE IF NOT EXISTS watch_snapshots (
      id            SERIAL PRIMARY KEY,
      watch_id      INTEGER NOT NULL REFERENCES watch_options(id) ON DELETE CASCADE,
      ts            BIGINT NOT NULL,        -- epoch ms
      spot          REAL,
      bid           REAL,
      ask           REAL,
      mark          REAL,
      last          REAL,
      iv            REAL,
      delta         REAL,
      gamma         REAL,
      theta         REAL,
      vega          REAL,
      open_interest REAL,
      volume        REAL,
      net_prem      REAL,                   -- volume * mark * 100 (flow proxy)
      prev_close    REAL,                   -- prior session close (mark), for day-change %
      net_gex       REAL                    -- net GEX of the whole strike (call+put, OI+Vol)
    );
    CREATE INDEX IF NOT EXISTS idx_watch_snapshots_wid_ts ON watch_snapshots(watch_id, ts);
    ALTER TABLE watch_snapshots ADD COLUMN IF NOT EXISTS prev_close REAL;
    ALTER TABLE watch_snapshots ADD COLUMN IF NOT EXISTS net_gex REAL;

    -- Trading journal (/trading). Replaces the old localStorage key
    -- "trading_journals" so entries persist server-side and follow the user
    -- across browsers/devices. ONE row per session-day per user \u2014 the CSV
    -- importer upserts on (user_id, date), so a re-imported statement corrects
    -- the day in place instead of stacking duplicates.
    CREATE TABLE IF NOT EXISTS trading_journals (
      id            SERIAL PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date          TEXT NOT NULL,           -- YYYY-MM-DD (session date)
      net_pnl       REAL NOT NULL DEFAULT 0,
      trades        REAL NOT NULL DEFAULT 0,
      win_rate      REAL NOT NULL DEFAULT 0, -- 0-100
      avg_win       REAL NOT NULL DEFAULT 0,
      avg_loss      REAL NOT NULL DEFAULT 0,
      profit_factor REAL NOT NULL DEFAULT 0,
      commissions   REAL NOT NULL DEFAULT 0,
      notes         TEXT,
      kind          TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'verified'
      created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_trading_journals_user_date
      ON trading_journals(user_id, date);

    -- The table shipped once WITHOUT this constraint, and CREATE TABLE IF NOT
    -- EXISTS won't retrofit it \u2014 so the importer's ON CONFLICT (user_id, date)
    -- blew up with "no unique or exclusion constraint matching". Add it here,
    -- idempotently, after collapsing any duplicate (user, date) rows that the
    -- pre-constraint build allowed in (keep the newest, it's the corrected one).
    DELETE FROM trading_journals a USING trading_journals b
      WHERE a.user_id = b.user_id AND a.date = b.date AND a.id < b.id;
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'trading_journals_user_id_date_key'
      ) THEN
        ALTER TABLE trading_journals
          ADD CONSTRAINT trading_journals_user_id_date_key UNIQUE (user_id, date);
      END IF;
    END $$;

    -- Individual executions behind a journal day, imported from a broker CSV
    -- (tastytrade / TOS / IBKR / Rithmic / MotiveWave / Tradovate / generic).
    -- The day rows in trading_journals are DERIVED from these, never typed \u2014
    -- see lib/journal/csv.ts. Keeping the fills (rather than only the rolled-up
    -- day) is what makes per-trade MAE/MFE and setup analysis possible later;
    -- it cannot be backfilled from a day row.
    --
    -- ext_id is a stable hash of the source CSV line, so re-importing the same
    -- statement is a no-op instead of doubling every stat.
    CREATE TABLE IF NOT EXISTS trading_fills (
      id          SERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date        TEXT NOT NULL,          -- YYYY-MM-DD, ET session date
      ts          BIGINT NOT NULL,        -- epoch ms (execution time)
      symbol      TEXT NOT NULL,          -- raw broker symbol
      underlying  TEXT NOT NULL,
      asset_type  TEXT NOT NULL,          -- 'option' | 'future' | 'equity'
      side        TEXT NOT NULL,          -- 'BUY' | 'SELL'
      qty         REAL NOT NULL,
      price       REAL NOT NULL,
      fees        REAL NOT NULL DEFAULT 0,
      multiplier  REAL NOT NULL DEFAULT 1,
      source      TEXT NOT NULL,          -- broker id
      ext_id      TEXT NOT NULL,
      account     TEXT NOT NULL DEFAULT '', -- broker account #/label, '' if the file has none
      created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, ext_id)
    );
    CREATE INDEX IF NOT EXISTS idx_trading_fills_user_date ON trading_fills(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_trading_fills_user_ts   ON trading_fills(user_id, ts);
    -- Backfill for pre-existing tables (per-account P&L breakdown).
    ALTER TABLE trading_fills ADD COLUMN IF NOT EXISTS account TEXT NOT NULL DEFAULT '';

    -- Per-trade edits/deletes for the /trading "Trades" table. Trades are
    -- DERIVED (FIFO-matched from trading_fills), never stored directly, so an
    -- edit can't just UPDATE a trade row \u2014 and editing the underlying fills
    -- directly is unsafe when one fill is split across several trades (e.g. a
    -- 10-lot entry closed by five separate 2-lot exits all share one opening
    -- fill). Instead an edit is a shadow row keyed to the specific trade's
    -- (open_ext_id, close_ext_id) pair \u2014 the two fills THAT trade matched \u2014
    -- applied on top of the derived trade at read time. Never touches
    -- trading_fills, so it can't bleed into a sibling trade that happens to
    -- share one of those two fills.
    CREATE TABLE IF NOT EXISTS trading_trade_overrides (
      id            SERIAL PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      open_ext_id   TEXT NOT NULL,
      close_ext_id  TEXT NOT NULL,
      symbol        TEXT NOT NULL,
      underlying    TEXT NOT NULL,
      asset_type    TEXT NOT NULL,
      direction     TEXT NOT NULL,          -- 'long' | 'short'
      open_ts       BIGINT NOT NULL,
      close_ts      BIGINT NOT NULL,
      date          TEXT NOT NULL,
      qty           REAL NOT NULL,
      entry         REAL NOT NULL,
      exit          REAL NOT NULL,
      fees          REAL NOT NULL DEFAULT 0,
      pnl           REAL NOT NULL,
      account       TEXT NOT NULL DEFAULT '',
      deleted       BOOLEAN NOT NULL DEFAULT FALSE,  -- hides the trade instead of dropping the row
      created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, open_ext_id, close_ext_id)
    );
    CREATE INDEX IF NOT EXISTS idx_trading_trade_overrides_user ON trading_trade_overrides(user_id);

    -- \u2500\u2500 Custom auth (replaces Supabase Auth) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    -- One row per account. id is a plain TEXT uuid generated app-side
    -- (crypto.randomUUID()) rather than a DB default, so the migration script can
    -- preserve the EXACT id values every other table already keys on via the
    -- legacy 'clerk_user_id' TEXT columns (subscriptions, td_user_prefs, etc.) --
    -- no cross-table backfill needed. password_hash is NULL for Google-only
    -- accounts. Legacy imported hashes start as bcrypt ($2a$/$2b$...) and are
    -- transparently upgraded to scrypt (scrypt$...) on next successful login.
    CREATE TABLE IF NOT EXISTS users (
      id                TEXT PRIMARY KEY,
      email             TEXT NOT NULL UNIQUE,
      password_hash     TEXT,
      google_sub        TEXT UNIQUE,
      is_owner          BOOLEAN NOT NULL DEFAULT FALSE,
      email_verified_at TIMESTAMPTZ,
      discord_id        TEXT UNIQUE,
      discord_username  TEXT,
      discord_avatar    TEXT,
      discord_connected_at TIMESTAMPTZ,
      created_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
    -- Backfill for pre-existing tables (Discord account linking).
    ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id TEXT UNIQUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_username TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_avatar TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_connected_at TIMESTAMPTZ;

    -- Opaque session tokens. The raw token is never stored -- only sha256(token)
    -- -- so a DB read (backup leak, etc.) can't be replayed as a live session.
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMPTZ NOT NULL,
      user_agent TEXT,
      ip         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    -- Password-reset / set-initial-password tokens (email flow). Single-use:
    -- used_at is stamped the moment it's consumed and the token is rejected after.
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
  `);
}
function isTransientConnError(err) {
  const msg = err?.message ?? "";
  const code = err?.code ?? "";
  return /Connection terminated|ECONNRESET|server closed the connection|terminating connection|Client has encountered a connection error/i.test(msg) || code === "ECONNRESET" || code === "57P01" || code === "08006" || code === "08003";
}
async function pgQuery(sql, params = []) {
  const pool = await getDb();
  try {
    return await pool.query(sql, params);
  } catch (err) {
    if (!isTransientConnError(err)) throw err;
    console.warn("[db] transient connection error, retrying once:", err.message);
    await new Promise((r) => setTimeout(r, 150));
    return await pool.query(sql, params);
  }
}
async function queryAll(sql, params = []) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  const result = await pgQuery(pgSql, params);
  return result.rows;
}
async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows[0];
}
async function getEsCandles(date, daysBack, limit = 2e3, intervalMinutes = 5) {
  if (date) {
    return queryAll(
      `SELECT * FROM es_candles WHERE date = ? AND "intervalMinutes" = ? ORDER BY timestamp ASC LIMIT ?`,
      [date, intervalMinutes, limit]
    );
  }
  if (daysBack) {
    const cutoff = new Date(Date.now() - daysBack * 864e5).toISOString().slice(0, 10);
    return queryAll(
      `SELECT * FROM es_candles WHERE date >= ? AND "intervalMinutes" = ? ORDER BY timestamp ASC LIMIT ?`,
      [cutoff, intervalMinutes, limit]
    );
  }
  return queryAll(
    `SELECT * FROM es_candles WHERE "intervalMinutes" = ? ORDER BY timestamp DESC LIMIT ?`,
    [intervalMinutes, limit]
  );
}

// ../mnt/user-data/uploads/spx-gex-dashboard-tt-fixed/lib/confidenceScore.ts
var STUDY = {
  reach: 0.75,
  pivot: 0.55,
  chop: 0.26,
  break: 0.17,
  openAtMVCPivot: 0.85,
  ivLow: 16,
  ivHigh: 45
};
var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
var clamp01 = (v) => clamp(v, 0, 1);
function proximityFactor(distance, emSize) {
  if (!Number.isFinite(distance) || !Number.isFinite(emSize) || emSize <= 0) return 0;
  return clamp01(1 - Math.abs(distance) / emSize);
}
function gexMagnitudeFactor(netGexAtLevel, totalAbsNetGEX) {
  if (!Number.isFinite(totalAbsNetGEX) || totalAbsNetGEX <= 0) return 0;
  return clamp01(Math.abs(netGexAtLevel) / totalAbsNetGEX);
}
function flipProximityFactor(price, gexFlip, emSize) {
  if (gexFlip == null || !Number.isFinite(gexFlip) || emSize <= 0) return 0;
  return clamp01(1 - Math.abs(price - gexFlip) / emSize);
}
function liveRulePrior(ctx) {
  const distance = ctx.level - ctx.price;
  const distScale = ctx.intradayRange != null && Number.isFinite(ctx.intradayRange) && ctx.intradayRange > 0 ? ctx.intradayRange : ctx.emSize;
  const proximity = proximityFactor(distance, distScale);
  const gexMagnitude = gexMagnitudeFactor(ctx.netGexAtLevel, ctx.totalAbsNetGEX);
  const flipProximity = flipProximityFactor(ctx.price, ctx.gexFlip, distScale);
  const gammaRegime = ctx.netGexAtLevel > 0 ? "positive" : ctx.netGexAtLevel < 0 ? "negative" : "flat";
  const dexBias = ctx.totalAbsNetGEX > 0 ? clamp(ctx.netDexAtLevel / ctx.totalAbsNetGEX, -1, 1) : 0;
  const sp = ctx.sessionProgress == null ? 0.5 : clamp01(ctx.sessionProgress);
  const timeWeight = clamp01(1 - sp * 0.6);
  const gexRank = ctx.gexRank == null ? 1 : clamp01(ctx.gexRank);
  const dexTowardLevel = Math.sign(distance) === Math.sign(ctx.netDexAtLevel) ? Math.abs(dexBias) : 0;
  let hit = 0.15 + 0.45 * proximity + 0.25 * gexMagnitude + 0.1 * timeWeight + 0.1 * dexTowardLevel;
  if (ctx.isOpexOr0DTE) hit += 0.05 * gexMagnitude;
  hit = clamp(hit, 0, 0.95);
  const posGamma = gammaRegime === "positive" ? 1 : gammaRegime === "flat" ? 0.4 : 0;
  let chop = 0.15 + 0.45 * posGamma * gexMagnitude + 0.25 * proximity * posGamma;
  if (ctx.isOpexOr0DTE) chop += 0.1 * posGamma;
  chop = clamp(chop, 0, 0.9);
  const dexOpposes = Math.sign(distance) !== Math.sign(ctx.netDexAtLevel) ? Math.abs(dexBias) : 0;
  let pivot = 0.1 + 0.35 * posGamma * gexMagnitude * gexRank + 0.25 * proximity + 0.2 * dexOpposes;
  pivot -= 0.15 * flipProximity * (gammaRegime === "negative" ? 1 : 0);
  pivot = clamp(pivot, 0, 0.9);
  const negGamma = gammaRegime === "negative" ? 1 : gammaRegime === "flat" ? 0.4 : 0;
  let brk = 0.05 + 0.4 * negGamma * gexMagnitude + 0.25 * proximity * negGamma + 0.2 * dexTowardLevel * negGamma + 0.15 * flipProximity * negGamma;
  brk -= 0.2 * posGamma * gexMagnitude * gexRank;
  brk = clamp(brk, 0, 0.9);
  return {
    hit,
    pivot,
    chop,
    break: brk,
    factors: { proximity, gexMagnitude, gammaRegime, flipProximity, dexBias, timeWeight, gexRank, rejectionRate: 0 }
  };
}
function scoreConfidence(ctx, history) {
  const prior = liveRulePrior(ctx);
  const notes = [];
  let historyWeight = 0;
  let hit = prior.hit;
  let pivot = prior.pivot;
  let chop = prior.chop;
  let brk = prior.break;
  let rejectionRate = 0;
  if (history && history.sampleSize > 0) {
    historyWeight = clamp(0.65 * (history.sampleSize / (history.sampleSize + 10)), 0, 0.65);
    hit = (1 - historyWeight) * prior.hit + historyWeight * clamp01(history.hitRate);
    pivot = (1 - historyWeight) * prior.pivot + historyWeight * clamp01(history.pivotRate);
    chop = (1 - historyWeight) * prior.chop + historyWeight * clamp01(history.chopRate);
    notes.push(
      `Blended ${Math.round(historyWeight * 100)}% historical (${history.sampleSize} analog level${history.sampleSize === 1 ? "" : "s"}).`
    );
    if (history.rejectionRate != null && Number.isFinite(history.rejectionRate)) {
      rejectionRate = clamp01(history.rejectionRate);
      const stale = history.sessionsSinceDefense ?? 0;
      const decay = clamp01(1 - stale * 0.08);
      const boost = rejectionRate * decay;
      const conf = clamp(history.sampleSize / (history.sampleSize + 6), 0, 1);
      pivot = clamp(pivot + 0.3 * boost * conf, 0, 0.95);
      brk = clamp(brk - 0.25 * boost * conf, 0, 0.9);
      if (rejectionRate >= 0.6 && conf >= 0.4)
        notes.push(`Defended ${Math.round(rejectionRate * 100)}% of prior touches${stale > 0 ? ` (last ${stale} session${stale === 1 ? "" : "s"} ago)` : ""} \u2192 pivot-favored.`);
    }
  } else {
    notes.push("No historical analogs yet \u2014 live structural prior only.");
  }
  if (prior.factors.gexMagnitude >= 0.4) notes.push("Dominant gamma level (strong magnet).");
  if (prior.factors.gammaRegime === "positive") notes.push("Positive-gamma regime \u2192 dealers dampen moves (chop-prone).");
  if (prior.factors.gammaRegime === "negative") notes.push("Negative-gamma regime \u2192 moves accelerate (breakthrough-prone).");
  if (ctx.isOpexOr0DTE) notes.push("0DTE/OPEX \u2192 pinning & chop amplified.");
  if (prior.factors.gammaRegime === "negative" && prior.factors.gexMagnitude >= 0.4 && prior.break >= 0.5)
    notes.push("Breakthrough-prone: dominant level in negative gamma.");
  if (ctx.gexRank != null && ctx.gexRank < 0.8)
    notes.push(`Secondary magnet (GEX rank ${Math.round(clamp01(ctx.gexRank) * 100)}%) \u2192 structural credit discounted.`);
  const ANCHOR = 0.5;
  hit = ANCHOR * STUDY.reach + (1 - ANCHOR) * hit;
  pivot = ANCHOR * STUDY.pivot + (1 - ANCHOR) * pivot;
  chop = ANCHOR * STUDY.chop + (1 - ANCHOR) * chop;
  brk = ANCHOR * STUDY.break + (1 - ANCHOR) * brk;
  notes.push(`Anchored to MVC study base rates (reach ${Math.round(STUDY.reach * 100)}% \xB7 pivot ${Math.round(STUDY.pivot * 100)}% / chop ${Math.round(STUDY.chop * 100)}% / break ${Math.round(STUDY.break * 100)}%).`);
  if (ctx.openAtMVC) {
    pivot = 0.7 * STUDY.openAtMVCPivot + 0.3 * pivot;
    hit = Math.max(hit, 0.9);
    notes.push(`Opened AT the MVC \u2192 ${Math.round(STUDY.openAtMVCPivot * 100)}% setup: expect a pivot + overnight-gap close in the first 15 min.`);
  }
  const hitPct = Math.round(hit * 100);
  const condSum = pivot + chop + brk;
  let pivotPct, chopPct, brkPct;
  if (condSum > 0) {
    pivotPct = Math.round(pivot / condSum * 100);
    brkPct = Math.round(brk / condSum * 100);
    chopPct = Math.max(0, 100 - pivotPct - brkPct);
  } else {
    pivotPct = 33;
    chopPct = 34;
    brkPct = 33;
  }
  const netWallBias = pivotPct - brkPct;
  if (netWallBias >= 25) notes.push(`Net Wall Bias +${netWallBias} \u2192 lean defense / continuation if it holds.`);
  else if (netWallBias <= -25) notes.push(`Net Wall Bias ${netWallBias} \u2192 respect the break; don't fight it.`);
  else notes.push(`Net Wall Bias ${netWallBias >= 0 ? "+" : ""}${netWallBias} \u2192 neutral; smaller size until a clear reaction.`);
  return {
    hit: hitPct,
    pivot: pivotPct,
    chop: chopPct,
    break: brkPct,
    netWallBias,
    openAtMVC: ctx.openAtMVC ?? false,
    factors: { ...prior.factors, rejectionRate },
    historyWeight,
    sampleSize: history?.sampleSize ?? 0,
    notes
  };
}

// confidence-compute.ts
var dynamic = "force-dynamic";
var CACHE_TTL_MS = 6e4;
var _cache = /* @__PURE__ */ new Map();
var HIT_PTS = 8;
var PIVOT_PTS = 10;
var CHOP_BAND = 15;
var ANALOG_GEX_TOL = 0.25;
var ANALOG_MAX = 120;
var EM_FALLBACK_FRACT = 4e-3;
var EM_FLOOR_FRACT = 6e-3;
var RTH_OPEN_MIN = 9 * 60 + 30;
var RTH_CLOSE_MIN = 16 * 60;
function etMinutesOf(slotKey) {
  const hh = Number(slotKey.slice(11, 13));
  const mm = Number(slotKey.slice(14, 16));
  return Number.isFinite(hh) && Number.isFinite(mm) ? hh * 60 + mm : null;
}
function todayET() {
  return new Date((/* @__PURE__ */ new Date()).toLocaleString("en-US", { timeZone: "America/New_York" })).toISOString().slice(0, 10);
}
function nowMinutesET() {
  const hhmm = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
function sessionProgressET(date) {
  if (date < todayET()) return 1;
  if (date > todayET()) return 0;
  const mins = nowMinutesET();
  if (mins <= RTH_OPEN_MIN) return 0;
  if (mins >= RTH_CLOSE_MIN) return 1;
  return (mins - RTH_OPEN_MIN) / (RTH_CLOSE_MIN - RTH_OPEN_MIN);
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
var clamp2 = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function strikeOf(r) {
  return num(r.strikeOIVol) ?? num(r.strikeVolOnly) ?? null;
}
function rowMinutesET(r) {
  const t = String(r.time ?? "");
  const mm = /^(\d{1,2}):(\d{2})/.exec(t);
  if (mm) return Number(mm[1]) * 60 + Number(mm[2]);
  const ms = Number(r.timestamp) || 0;
  if (!ms) return null;
  const hhmm = new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });
  const p = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return p ? Number(p[1]) * 60 + Number(p[2]) : null;
}
function rowTimeET(r) {
  const t = String(r.time ?? "");
  if (/^\d{1,2}:\d{2}/.test(t)) return t.slice(0, 5);
  const ms = Number(r.timestamp) || 0;
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });
}
function pickLevel(r) {
  const level = num(r.strikeOIVol) ?? num(r.strikeVolOnly) ?? num(r.spxPrice) ?? 0;
  const strikeGex = num(r.mvcValueOIVol) ?? num(r.mvcValueVolOnly) ?? num(r.totalNetGEX_OI) ?? 0;
  const netTotal = num(r.totalNetGEX_OI) ?? num(r.totalNetGEX_Vol) ?? 0;
  const netDex = num(r.totalNetDEX_OI) ?? num(r.totalNetDEX_Vol) ?? num(r.netDEXStrike) ?? 0;
  const storedAbs = num(r.totalAbsNetGEX);
  const totalAbsNetGEX = storedAbs != null && storedAbs > Math.abs(strikeGex) * 1.0001 ? storedAbs : Math.abs(netTotal);
  return {
    level,
    netGex: strikeGex,
    // signed GEX at the level (regime + dominance numerator)
    netTotal,
    // chain net sum (kept for readouts)
    netDex,
    // spot:0 / sub-1000 prints are the feed not-yet-populated, not a real index
    // level — treat as missing so the fallbacks (today series / prior day) apply.
    spx: (() => {
      const v = num(r.spxPrice);
      return v != null && v > 1e3 ? v : level;
    })(),
    es: num(r.esPrice) ?? num(r.spxPrice) ?? level,
    // display reference only
    totalAbsNetGEX,
    gexFlip: num(r.gexFlip),
    ts: Number(r.timestamp) || 0
  };
}
function classifyDay(level, spxSeries) {
  const base = {
    outcome: "miss",
    touched: false,
    approachFromBelow: true,
    brokeThrough: false,
    maxAway: 0,
    maxBand: 0,
    overshoot: 0
  };
  if (!spxSeries.length || !Number.isFinite(level)) return base;
  let touchedIdx = -1;
  for (let i = 0; i < spxSeries.length; i++) {
    if (Math.abs(spxSeries[i] - level) <= HIT_PTS) {
      touchedIdx = i;
      break;
    }
  }
  if (touchedIdx === -1) return base;
  const approachFromBelow = spxSeries[touchedIdx] <= level;
  let maxAway = 0;
  let maxBand = 0;
  let overshoot = 0;
  for (let i = touchedIdx; i < spxSeries.length; i++) {
    const d = spxSeries[i] - level;
    maxBand = Math.max(maxBand, Math.abs(d));
    const away = approachFromBelow ? level - spxSeries[i] : spxSeries[i] - level;
    maxAway = Math.max(maxAway, away);
    const past = approachFromBelow ? spxSeries[i] - level : level - spxSeries[i];
    overshoot = Math.max(overshoot, past);
  }
  const last = spxSeries[spxSeries.length - 1];
  const brokeThrough = approachFromBelow ? last - level > HIT_PTS : level - last > HIT_PTS;
  let outcome = "hit";
  if (maxAway >= PIVOT_PTS) outcome = "pivot";
  else if (maxBand <= CHOP_BAND) outcome = "chop";
  return { outcome, touched: true, approachFromBelow, brokeThrough, maxAway, maxBand, overshoot };
}
function classifyFromSpxSeries(level, spxSeries) {
  return classifyDay(level, spxSeries).outcome;
}
function realClosest(real, level, fromMin) {
  let c = Infinity;
  for (const s of real) if (s.min >= fromMin) c = Math.min(c, Math.abs(s.px - level));
  return c;
}
function classifySegment(strike, win, startMin) {
  const det = classifyDay(strike, win.map((s) => s.px));
  let closest = Infinity;
  let minToTouch = null;
  for (const s of win) {
    const d = Math.abs(s.px - strike);
    if (d < closest) closest = d;
    if (minToTouch == null && d <= HIT_PTS) minToTouch = Math.max(0, s.min - startMin);
  }
  return {
    ...det,
    closestApproach: Number.isFinite(closest) ? closest : Infinity,
    minToTouch,
    priceAtStart: win.length ? win[0].px : null,
    distAtStart: win.length ? Math.abs(win[0].px - strike) : Infinity
  };
}
var fmtPts = (v) => Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "\u2014";
var APPROACH_PTS = 40;
function buildDayScenario(d, regime, level, price, provisional) {
  const wall = regime > 0 ? "call" : regime < 0 ? "put" : "neutral";
  const fwd = provisional ? "Live: " : "";
  if (!d.touched) {
    const dist = Math.abs(price - level);
    if (dist <= APPROACH_PTS) {
      return {
        kind: "approaching",
        wall,
        title: regime < 0 ? "Approaching Put Wall" : "Approaching Call Wall",
        status: "Not yet hit",
        detail: `Price ${fmtPts(dist)} pts from the ${level.toFixed(0)} level \u2014 in range to interact.`,
        forward: regime < 0 ? `${fwd}If it tags the floor \u2192 watch for a V-reversal/squeeze; a clean slice through \u2192 volatility cascade lower.` : `${fwd}If it tags the wall \u2192 expect resistance/pin; a convincing break \u2192 GEX migration higher.`,
        provisional
      };
    }
    return {
      kind: "untouched",
      wall,
      title: "Level Untouched",
      status: "Not hit",
      detail: `Price stayed ${fmtPts(dist)} pts away from ${level.toFixed(0)} \u2014 level never came into play.`,
      forward: `${fwd}Out of range for now; level only matters if price travels back toward ${level.toFixed(0)}.`,
      provisional
    };
  }
  if (regime < 0) {
    if (d.outcome === "pivot") {
      return {
        kind: "squeeze",
        wall,
        title: "Hit & V-Reversed (Squeeze)",
        status: "Hit \u2192 reversed up",
        detail: `Tagged the floor and snapped back ${fmtPts(d.maxAway)} pts \u2014 short covering / put monetization.`,
        forward: `${fwd}If the squeeze holds above the level \u2192 continuation higher; failure back below \u2192 retest of the floor.`,
        provisional
      };
    }
    if (d.outcome === "hit" && d.brokeThrough) {
      return {
        kind: "cascade",
        wall,
        title: "Break-Through & Volatility Cascade",
        status: "Broke through",
        detail: `Sliced through the level (${fmtPts(d.maxBand)} pts beyond) \u2014 forced selling / amplified downside.`,
        forward: `${fwd}If it stays below \u2192 cascade can extend to the next wall; reclaim of ${level.toFixed(0)} \u2192 squeeze risk.`,
        provisional
      };
    }
    return {
      kind: "chop",
      wall,
      title: "Hit & Chopped",
      status: "Hit \u2192 choppy",
      detail: `Lingered at the level with wide ${fmtPts(d.maxBand)}-pt swings \u2014 unstable, high-vol churn.`,
      forward: `${fwd}Negative-gamma chop resolves sharply: a decisive break either way tends to run \u2014 trade the break, not the middle.`,
      provisional
    };
  }
  if (d.outcome === "pivot") {
    return {
      kind: "reversal",
      wall,
      title: "Hit & Reversed",
      status: "Hit \u2192 reversed",
      detail: `Touched the level and turned ${fmtPts(d.maxAway)} pts away \u2014 dealer selling resistance held.`,
      forward: `${fwd}If price stays rejected \u2192 fade back toward the flip; a re-test that holds \u2192 breakout odds rise.`,
      provisional
    };
  }
  if (d.outcome === "hit" && d.brokeThrough && d.overshoot >= PIVOT_PTS && d.maxAway >= HIT_PTS) {
    return {
      kind: "false-break",
      wall,
      title: "Hit, Over-Shot & Faded (False Break)",
      status: "False break",
      detail: `Poked ${fmtPts(d.overshoot)} pts past the level, exhausted, then got dragged back.`,
      forward: `${fwd}If it closes back below \u2192 failed breakout, fade lower; reclaim of the high \u2192 real breakout.`,
      provisional
    };
  }
  if (d.outcome === "hit" && d.brokeThrough) {
    return {
      kind: "breakout",
      wall,
      title: "Clean Breakout & GEX Migration",
      status: "Broke through",
      detail: `Pushed convincingly through (${fmtPts(d.maxBand)} pts beyond) \u2014 flow rolls higher, wall migrates up.`,
      forward: `${fwd}If it holds above \u2192 new wall sets higher (regime shift); loss of the level \u2192 snap-back risk.`,
      provisional
    };
  }
  return {
    kind: "pinned",
    wall,
    title: "Pinned / Consolidated",
    status: "Pinned",
    detail: `Trapped at the strike in tight ${fmtPts(d.maxBand)}-pt chop \u2014 positive-gamma magnet effect.`,
    forward: `${fwd}If pinning persists into the close \u2192 expect a settle near ${level.toFixed(0)}; a break of the band \u2192 directional move.`,
    provisional
  };
}
async function computeConfidence(searchParams) {
  try {
    let gexRankFor = function(level, rows) {
      const peak = /* @__PURE__ */ new Map();
      for (const r of rows) {
        const k = strikeOf(r);
        if (k == null) continue;
        const g = Math.abs(num(r.mvcValueOIVol) ?? num(r.mvcValueVolOnly) ?? num(r.totalNetGEX_OI) ?? 0);
        const key = Math.round(k);
        peak.set(key, Math.max(peak.get(key) ?? 0, g));
      }
      if (peak.size === 0) return 1;
      const ranked = [...peak.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
      const idx = ranked.indexOf(Math.round(level));
      const rank = idx < 0 ? ranked.length - 1 : idx;
      return clamp2(1 - rank * 0.2, 0.2, 1);
    };
    const date = searchParams.get("date") || todayET();
    const emParam = searchParams.get("em");
    const emOverride = emParam != null ? num(emParam) : null;
    const isOpexOr0DTE = searchParams.get("opex") === "1";
    const cacheKey = searchParams.toString();
    const hit = _cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { status: 200, body: hit.body, headers: { "x-cache": "hit" } };
    }
    let effDate = date;
    let latest = await queryOne(
      `SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp DESC LIMIT 1`,
      [date]
    );
    if (!latest) {
      const prevDay = await queryOne(
        `SELECT * FROM mvc_snapshots WHERE date < ? ORDER BY date DESC, timestamp DESC LIMIT 1`,
        [date]
      );
      if (!prevDay) {
        return { status: 404, body: { error: "No MVC snapshot for date", date } };
      }
      latest = prevDay;
      effDate = prevDay.date;
    }
    const cur = pickLevel(latest);
    const todayRows = await queryAll(
      `SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp ASC LIMIT 2000`,
      [effDate]
    );
    const todaySpx = todayRows.map((r) => num(r.spxPrice)).filter((v) => v != null && v > 1e3);
    if (!todaySpx.length) {
      const prevSpxRow = await queryOne(
        `SELECT * FROM mvc_snapshots
         WHERE date < ? AND spxPrice > 1000
         ORDER BY date DESC, timestamp DESC LIMIT 1`,
        [effDate]
      );
      const prevSpx = prevSpxRow ? num(prevSpxRow.spxPrice) : null;
      if (prevSpx != null && Number.isFinite(prevSpx) && prevSpx > 1e3) {
        cur.spx = prevSpx;
      }
    }
    const intradayRange = todaySpx.length > 1 ? (Math.max(...todaySpx) - Math.min(...todaySpx)) / 2 : 0;
    const refPrice = cur.spx || todaySpx[todaySpx.length - 1] || cur.level || 0;
    const proxScale = Math.max(intradayRange, refPrice * 3e-3);
    const emFloor = refPrice * EM_FLOOR_FRACT;
    const emSize = Math.max(
      emOverride ?? (intradayRange > 0 ? intradayRange : refPrice * EM_FALLBACK_FRACT),
      emFloor
    );
    const sessionProgress = sessionProgressET(effDate);
    const priorDays = await queryAll(
      `SELECT DISTINCT date FROM mvc_snapshots WHERE date < ? ORDER BY date DESC LIMIT ?`,
      [effDate, ANALOG_MAX]
    );
    const curGexMag = cur.totalAbsNetGEX > 0 ? Math.abs(cur.netGex) / cur.totalAbsNetGEX : 0;
    const curRegime = Math.sign(cur.netGex);
    let hits = 0, pivots = 0, chops = 0, sampleSize = 0;
    const REJECT_CLUSTER_PTS = 15;
    let clusterTouches = 0, clusterRejections = 0;
    let sessionsSinceDefense = null;
    let analogIdx = -1;
    const drop = { regime: 0, dominance: 0, noSeries: 0, neverEngaged: 0, noRef: 0 };
    const analogDetail = [];
    for (const d of priorDays) {
      const dayRows = await queryAll(
        `SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp ASC LIMIT 2000`,
        [d.date]
      );
      if (!dayRows.length) {
        drop.noRef++;
        continue;
      }
      const ref = pickLevel(dayRows[0]);
      const pastGexMag = ref.totalAbsNetGEX > 0 ? Math.abs(ref.netGex) / ref.totalAbsNetGEX : 0;
      const pastRegime = Math.sign(ref.netGex);
      if (pastRegime !== curRegime) {
        drop.regime++;
        continue;
      }
      if (Math.abs(pastGexMag - curGexMag) > ANALOG_GEX_TOL) {
        drop.dominance++;
        continue;
      }
      const spxSeries = dayRows.map((r) => num(r.spxPrice)).filter((v) => v != null && v > 1e3);
      if (spxSeries.length < 2) {
        drop.noSeries++;
        continue;
      }
      const outcome = classifyFromSpxSeries(ref.level, spxSeries);
      if (outcome === "miss") {
        drop.neverEngaged++;
        continue;
      }
      sampleSize++;
      analogIdx++;
      if (outcome === "hit") hits++;
      else if (outcome === "pivot") pivots++;
      else if (outcome === "chop") chops++;
      if (Math.abs(ref.level - cur.level) <= REJECT_CLUSTER_PTS) {
        clusterTouches++;
        if (outcome === "pivot") {
          clusterRejections++;
          if (sessionsSinceDefense == null) sessionsSinceDefense = analogIdx;
        }
      }
      if (analogDetail.length < 30)
        analogDetail.push({ date: d.date, level: ref.level, gexMag: pastGexMag, outcome });
    }
    const history = sampleSize > 0 ? {
      sampleSize,
      hitRate: (hits + pivots + chops) / sampleSize,
      // engaged the level
      pivotRate: pivots / sampleSize,
      chopRate: chops / sampleSize,
      // Same-cluster defense history (this wall, not the whole regime).
      rejectionRate: clusterTouches > 0 ? clusterRejections / clusterTouches : 0,
      sessionsSinceDefense: sessionsSinceDefense ?? void 0
    } : null;
    const curGexRank = gexRankFor(cur.level, todayRows);
    const FIRST_15M = 15 / 390;
    const openSpx = todaySpx.length ? todaySpx[0] : cur.spx;
    const openAtMVC = effDate === todayET() && sessionProgress > 0 && sessionProgress <= FIRST_15M && Number.isFinite(openSpx) && Math.abs(openSpx - cur.level) <= HIT_PTS;
    const ctx = {
      level: cur.level,
      price: cur.spx,
      emSize,
      intradayRange: proxScale,
      totalAbsNetGEX: cur.totalAbsNetGEX,
      netGexAtLevel: cur.netGex,
      netDexAtLevel: cur.netDex,
      gexFlip: cur.gexFlip,
      isOpexOr0DTE,
      sessionProgress,
      gexRank: curGexRank,
      openAtMVC
    };
    const result = scoreConfidence(ctx, history);
    const isFinal = effDate < todayET() || sessionProgress >= 0.95;
    let spxTimed = todayRows.map((r) => ({ min: rowMinutesET(r), px: num(r.spxPrice) })).filter((s) => s.min != null && s.px != null && s.px > 1e3);
    const realTimed = [...spxTimed];
    if (Number.isFinite(cur.spx) && cur.spx > 1e3) {
      realTimed.push({ min: realTimed.length ? realTimed[realTimed.length - 1].min : RTH_CLOSE_MIN, px: cur.spx });
    }
    let seriesSource = "snapshots";
    let basis = null;
    try {
      const esCandles = await getEsCandles(effDate, void 0, 2e3);
      const rth = esCandles.map((c) => ({ c, m: etMinutesOf(c.slotKey) })).filter((x) => x.m != null && x.m >= RTH_OPEN_MIN && x.m <= RTH_CLOSE_MIN);
      const spxClose = todaySpx.length ? todaySpx[todaySpx.length - 1] : num(latest.spxPrice) ?? cur.spx;
      if (rth.length && Number.isFinite(spxClose) && spxClose > 0) {
        let esCloseBar = rth[rth.length - 1].c;
        let bestDelta = Math.abs(rth[rth.length - 1].m - RTH_CLOSE_MIN);
        for (const { c, m } of rth) {
          const dlt = Math.abs(m - RTH_CLOSE_MIN);
          if (dlt < bestDelta) {
            bestDelta = dlt;
            esCloseBar = c;
          }
        }
        const esClose = Number(esCloseBar.close);
        if (Number.isFinite(esClose)) {
          basis = esClose - spxClose;
          const timed = [];
          for (const { c, m } of rth) {
            for (const v of [c.open, c.high, c.low, c.close]) {
              const n = Number(v);
              if (Number.isFinite(n)) timed.push({ min: m, px: n - basis });
            }
          }
          const onScale = timed.length >= 4 && timed.every((s) => Math.abs(s.px - cur.level) < 500) && Math.abs(esClose - basis - spxClose) < 1;
          if (onScale) {
            spxTimed = timed;
            seriesSource = "es5m";
          } else {
            basis = null;
          }
        }
      }
    } catch (e) {
      console.warn("[/api/confidence] ES\u2192SPX series fallback:", e);
    }
    if (seriesSource === "snapshots" && Number.isFinite(cur.spx) && cur.spx > 0) {
      const lastMin = spxTimed.length ? spxTimed[spxTimed.length - 1].min : RTH_CLOSE_MIN;
      spxTimed = [...spxTimed, { min: lastMin, px: cur.spx }];
    }
    const spxSeriesForDay = spxTimed.map((s) => s.px);
    const dayDetail = classifyDay(cur.level, spxSeriesForDay);
    if (dayDetail.touched && realTimed.length && realClosest(realTimed, cur.level, RTH_OPEN_MIN) > HIT_PTS) {
      dayDetail.touched = false;
      dayDetail.outcome = "miss";
    }
    const scenario = buildDayScenario(
      dayDetail,
      curRegime,
      cur.level,
      refPrice,
      !isFinal
    );
    const dayOutcome = {
      ...scenario,
      final: isFinal,
      touched: dayDetail.touched,
      outcome: dayDetail.outcome,
      maxAway: Math.round(dayDetail.maxAway),
      maxBand: Math.round(dayDetail.maxBand),
      overshoot: Math.round(dayDetail.overshoot),
      seriesSource,
      // "es5m" = true 5m SPX, "snapshots" = 30m fallback
      basis: basis != null ? Math.round(basis * 100) / 100 : null,
      bars: seriesSource === "es5m" ? Math.round(spxSeriesForDay.length / 4) : todaySpx.length
    };
    const segments = [];
    for (const r of todayRows) {
      const k = strikeOf(r);
      if (k == null) continue;
      const t = rowTimeET(r);
      const mn = rowMinutesET(r) ?? RTH_OPEN_MIN;
      const last = segments[segments.length - 1];
      if (last && Math.abs(last.strike - k) < 0.5) {
        last.to = t || last.to;
        last.toMin = mn;
        last.snaps++;
      } else {
        segments.push({ strike: k, from: t, to: t, fromMin: mn, toMin: mn, snaps: 1, act: pickLevel(r) });
      }
    }
    const mvcTimeline = segments.map((seg, i) => {
      const isLast = i === segments.length - 1;
      const win = spxTimed.filter((s) => s.min >= seg.fromMin);
      const stats = classifySegment(seg.strike, win, seg.fromMin);
      if (stats.touched && realTimed.length && realClosest(realTimed, seg.strike, seg.fromMin) > HIT_PTS) {
        stats.touched = false;
        stats.outcome = "miss";
      }
      const sc = buildDayScenario(stats, Math.sign(seg.act.netGex) || curRegime, seg.strike, refPrice, !isFinal && isLast);
      const segCtx = {
        level: seg.strike,
        price: seg.act.spx,
        emSize,
        intradayRange: proxScale,
        totalAbsNetGEX: seg.act.totalAbsNetGEX,
        netGexAtLevel: seg.act.netGex,
        netDexAtLevel: seg.act.netDex,
        gexFlip: seg.act.gexFlip,
        isOpexOr0DTE,
        sessionProgress,
        gexRank: gexRankFor(seg.strike, todayRows)
      };
      const segHistory = history ? Math.abs(seg.strike - cur.level) <= REJECT_CLUSTER_PTS ? history : { ...history, rejectionRate: 0, sessionsSinceDefense: void 0 } : null;
      const segScore = scoreConfidence(segCtx, segHistory);
      const fullDayTouched = realTimed.some((s) => Math.abs(s.px - seg.strike) <= HIT_PTS);
      const touchedLater = !stats.touched && fullDayTouched;
      return {
        strike: seg.strike,
        from: seg.from,
        to: seg.to,
        snaps: seg.snaps,
        current: isLast,
        // Outcome read
        kind: sc.kind,
        title: sc.title,
        status: sc.status,
        detail: sc.detail,
        forward: sc.forward,
        touched: stats.touched,
        touchedLater,
        // true when untouched during window but hit later
        outcome: stats.outcome,
        maxAway: Math.round(stats.maxAway),
        maxBand: Math.round(stats.maxBand),
        overshoot: Math.round(stats.overshoot),
        closestApproach: Number.isFinite(stats.closestApproach) ? Math.round(stats.closestApproach) : null,
        minToTouch: stats.minToTouch,
        // Distance SPX was from this strike when it became the MVC. Prefer the
        // time-series window start; fall back to the activation snapshot's own SPX
        // (always present) when no intraday SPX series exists for the date.
        distAtStart: Number.isFinite(stats.distAtStart) ? Math.round(stats.distAtStart) : seg.act.spx != null && Number.isFinite(seg.act.spx) ? Math.round(Math.abs(seg.act.spx - seg.strike)) : null,
        // Per-strike confidence score
        score: { hit: segScore.hit, pivot: segScore.pivot, chop: segScore.chop, break: segScore.break, netWallBias: segScore.netWallBias },
        gexRank: Math.round(segScore.factors.gexRank * 100),
        rejectionRate: Math.round(segScore.factors.rejectionRate * 100),
        gammaRegime: segScore.factors.gammaRegime,
        // Activation stats for the expandable detail
        stats: {
          spxAtActivation: seg.act.spx != null ? Math.round(seg.act.spx * 100) / 100 : null,
          netGex: Math.round(seg.act.netGex),
          netDex: Math.round(seg.act.netDex),
          gexFlip: seg.act.gexFlip != null ? Math.round(seg.act.gexFlip * 100) / 100 : null,
          gexDominance: Math.round((seg.act.totalAbsNetGEX > 0 ? Math.abs(seg.act.netGex) / seg.act.totalAbsNetGEX : 0) * 100)
        }
      };
    });
    const mvcSummary = {
      distinctStrikes: segments.length,
      changes: Math.max(0, segments.length - 1),
      engaged: mvcTimeline.filter((s) => s.touched).length
    };
    const body = {
      date: effDate,
      requestedDate: date,
      stale: effDate !== date,
      mvcTimestamp: latest.timestamp ?? null,
      level: cur.level,
      price: cur.spx,
      spx: cur.spx,
      es: cur.es,
      emSize,
      netGex: cur.netTotal,
      netDex: cur.netDex,
      gexFlip: cur.gexFlip,
      gexMagnitude: curGexMag,
      gexRank: curGexRank,
      sessionProgress,
      score: result,
      dayOutcome,
      mvcTimeline,
      mvcSummary,
      history,
      analogs: analogDetail,
      thresholds: {
        hitPts: HIT_PTS,
        pivotPts: PIVOT_PTS,
        chopBand: CHOP_BAND,
        analogGexTol: ANALOG_GEX_TOL,
        analogMax: ANALOG_MAX
      },
      debug: {
        priorDaysScanned: priorDays.length,
        curRegime,
        curGexMag,
        todaySnapshots: todayRows.length,
        dropped: drop
      }
    };
    _cache.set(cacheKey, { at: Date.now(), body });
    return { status: 200, body, headers: { "x-cache": "miss" } };
  } catch (err) {
    console.error("[/api/confidence]", err);
    return { status: 500, body: { error: "Confidence error", detail: String(err) } };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  computeConfidence,
  dynamic
});
