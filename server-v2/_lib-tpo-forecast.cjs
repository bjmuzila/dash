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

// tpo-forecast-compute.ts
var tpo_forecast_compute_exports = {};
__export(tpo_forecast_compute_exports, {
  computeTpoForecast: () => computeTpoForecast,
  dynamic: () => dynamic
});
module.exports = __toCommonJS(tpo_forecast_compute_exports);

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

// ../mnt/user-data/uploads/spx-gex-dashboard-tt-fixed/lib/balanceImbalance.ts
var RTH_OPEN = 9 * 60 + 30;
var RTH_CLOSE = 16 * 60;
var ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});
function etParts(ts) {
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return { date: "", minutes: NaN };
  const p = ET_FMT.formatToParts(d);
  const m = {};
  p.forEach((x) => {
    m[x.type] = x.value;
  });
  const hh = m.hour === "24" ? "00" : m.hour;
  return { date: `${m.year}-${m.month}-${m.day}`, minutes: Number(hh) * 60 + Number(m.minute) };
}
function isRthBar(ts) {
  const { minutes } = etParts(ts);
  return minutes >= RTH_OPEN && minutes < RTH_CLOSE;
}
function etSessionDate(c) {
  return etParts(c.timestamp).date || c.date;
}
function rthBarsForDate(candles, date) {
  return candles.filter((c) => isRthBar(c.timestamp) && etSessionDate(c) === date).sort((a, b) => a.timestamp - b.timestamp);
}

// ../mnt/user-data/uploads/spx-gex-dashboard-tt-fixed/lib/tpo.ts
var TPO_PERIOD_MS = 30 * 6e4;
function buildTpoSession(bars, date, binSize = 1, vaPct = 0.7, periodMs = TPO_PERIOD_MS) {
  if (!bars.length || !(binSize > 0)) return null;
  const floorBin = (p) => Math.floor(p / binSize) * binSize;
  const byPeriod = /* @__PURE__ */ new Map();
  for (const c of bars) {
    const k = Math.floor(c.timestamp / periodMs) * periodMs;
    const p = byPeriod.get(k);
    if (!p) byPeriod.set(k, { lo: c.low, hi: c.high, close: c.close, ts: k, lastTs: c.timestamp });
    else {
      if (c.low < p.lo) p.lo = c.low;
      if (c.high > p.hi) p.hi = c.high;
      if (c.timestamp >= p.lastTs) {
        p.close = c.close;
        p.lastTs = c.timestamp;
      }
    }
  }
  const periods = [...byPeriod.values()].sort((a, b) => a.ts - b.ts);
  if (!periods.length) return null;
  const touched = /* @__PURE__ */ new Map();
  periods.forEach((p, idx) => {
    const b0 = floorBin(p.lo), b1 = floorBin(p.hi);
    for (let b = b0; b <= b1 + 1e-9; b += binSize) {
      const arr = touched.get(b);
      if (arr) arr.push(idx);
      else touched.set(b, [idx]);
    }
  });
  const bins = [...touched.entries()].map(([price, ps]) => ({ price, count: ps.length, periods: ps })).sort((a, b) => a.price - b.price);
  if (bins.length < 3) return null;
  let pocIdx = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i].count > bins[pocIdx].count) pocIdx = i;
  const total = bins.reduce((s, b) => s + b.count, 0);
  const target = total * vaPct;
  let loI = pocIdx, hiI = pocIdx, acc = bins[pocIdx].count;
  while (acc < target && (loI > 0 || hiI < bins.length - 1)) {
    const below = loI > 0 ? bins[loI - 1].count : -1;
    const above = hiI < bins.length - 1 ? bins[hiI + 1].count : -1;
    if (above >= below) {
      hiI++;
      acc += Math.max(0, above);
    } else {
      loI--;
      acc += Math.max(0, below);
    }
  }
  const high = Math.max(...bars.map((b) => b.high));
  const low = Math.min(...bars.map((b) => b.low));
  const poc = bins[pocIdx].price, vah = bins[hiI].price, val = bins[loI].price;
  const ib = periods.slice(0, 2);
  const ibHigh = ib.length ? Math.max(...ib.map((p) => p.hi)) : null;
  const ibLow = ib.length ? Math.min(...ib.map((p) => p.lo)) : null;
  const singleIdx = bins.map((b, i) => b.count === 1 ? i : -1).filter((i) => i >= 0);
  const runs = [];
  for (const i of singleIdx) {
    const last = runs[runs.length - 1];
    if (last && i === last[last.length - 1] + 1) last.push(i);
    else runs.push([i]);
  }
  const topIdx = bins.length - 1, botIdx = 0;
  const ts = periods[periods.length - 1].lastTs;
  const S = [];
  const mk = (kind, side, lo, hi) => ({
    id: `${date}:${kind}:${lo}`,
    date,
    kind,
    side,
    priceLo: lo,
    priceHi: hi,
    createdTs: ts,
    testedAt: null,
    repairedAt: null,
    touches: 0,
    ageSessions: 0
  });
  const topRun = runs.find((r) => r[r.length - 1] === topIdx && r.length >= 2);
  const botRun = runs.find((r) => r[0] === botIdx && r.length >= 2);
  if (topRun) {
    const lo = bins[topRun[0]].price, hi = bins[topRun[topRun.length - 1]].price;
    const hiPeriod = periods.reduce((a, b) => b.hi > a.hi ? b : a);
    const rejected = hiPeriod.close < lo;
    S.push(mk(rejected ? "excess_high" : "tail_high", "up", lo, hi));
  } else if (bins[topIdx].count >= 2) {
    S.push(mk("poor_high", "up", bins[topIdx].price, bins[topIdx].price));
  }
  if (botRun) {
    const lo = bins[botRun[0]].price, hi = bins[botRun[botRun.length - 1]].price;
    const loPeriod = periods.reduce((a, b) => b.lo < a.lo ? b : a);
    const rejected = loPeriod.close > hi;
    S.push(mk(rejected ? "excess_low" : "tail_low", "down", lo, hi));
  } else if (bins[botIdx].count >= 2) {
    S.push(mk("poor_low", "down", bins[botIdx].price, bins[botIdx].price));
  }
  for (const r of runs) {
    if (r[r.length - 1] === topIdx || r[0] === botIdx) continue;
    const lo = bins[r[0]].price, hi = bins[r[r.length - 1]].price;
    S.push(mk("hole", lo >= poc ? "up" : "down", lo, hi));
  }
  S.push(mk("naked_poc", "up", poc, poc));
  return {
    date,
    bins,
    maxCount: bins[pocIdx].count,
    poc,
    vah,
    val,
    mid: (high + low) / 2,
    high,
    low,
    open: bars[0].open,
    ibHigh,
    ibLow,
    ibRange: ibHigh != null && ibLow != null ? ibHigh - ibLow : null,
    periods: periods.length,
    singles: singleIdx.map((i) => bins[i].price),
    structures: S
  };
}

// tpo-forecast-compute.ts
var dynamic = "force-dynamic";
var BIN = 1;
var GRID_LO = -100;
var GRID_HI = 100;
var GRID_N = (GRID_HI - GRID_LO) / BIN + 1;
var K = 25;
var LIVE_MIN = 40;
var IB_CLOSE_MIN = 630;
function etDateStr(d = /* @__PURE__ */ new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(d).filter((p) => p.type !== "literal").reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function etNowMin() {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(/* @__PURE__ */ new Date());
  const h = Number(p.find((x) => x.type === "hour")?.value);
  const m = Number(p.find((x) => x.type === "minute")?.value);
  return h * 60 + m;
}
function toDensity(bins, anchor) {
  const d = new Array(GRID_N).fill(0);
  let sum = 0;
  for (const b of bins) {
    const idx = Math.round((b.price - anchor - GRID_LO) / BIN);
    if (idx >= 0 && idx < GRID_N) {
      d[idx] += b.count;
      sum += b.count;
    }
  }
  if (sum > 0) for (let i = 0; i < GRID_N; i++) d[i] /= sum;
  return d;
}
var median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
function features(r, prev, trailIb, trailRng) {
  const ibMid = r.ib_mid ?? 0, ibRng = r.ib_range || 1;
  const gap = prev?.day_close != null && r.day_open != null ? r.day_open - prev.day_close : 0;
  const prevPocOff = prev?.poc != null ? prev.poc - ibMid : 0;
  const prevRng = prev?.day_high != null && prev?.day_low != null ? prev.day_high - prev.day_low : 0;
  return [
    ibRng / (trailIb || 1),
    r.day_open != null ? (r.day_open - ibMid) / ibRng : 0,
    gap / (trailIb || 1),
    prevPocOff / (trailIb || 1),
    prevRng / (trailRng || 1)
  ];
}
function vaBand(dens, pct = 0.7) {
  let poc = 0;
  for (let i = 1; i < dens.length; i++) if (dens[i] > dens[poc]) poc = i;
  const tot = dens.reduce((s, x) => s + x, 0);
  let lo = poc, hi = poc, acc = dens[poc];
  while (acc < tot * pct && (lo > 0 || hi < dens.length - 1)) {
    const below = lo > 0 ? dens[lo - 1] : -1;
    const above = hi < dens.length - 1 ? dens[hi + 1] : -1;
    if (above >= below) {
      hi++;
      acc += Math.max(0, above);
    } else {
      lo--;
      acc += Math.max(0, below);
    }
  }
  return [lo, hi];
}
async function computeTpoForecast(searchParams) {
  try {
    const u = { searchParams };
    const symbol = (u.searchParams.get("symbol") || "ES").toUpperCase() === "NQ" ? "NQU" : "ESU";
    const today = etDateStr();
    let hist = [];
    try {
      hist = await queryAll(
        `SELECT date, poc, vah, val, ib_high, ib_low, ib_mid, ib_range,
                day_open, day_close, day_high, day_low, profile_json
           FROM tpo_profiles WHERE symbol = ? AND date < ? ORDER BY date ASC`,
        [symbol, today]
      );
    } catch {
      return { status: 200, body: {
        ok: false,
        status: "accumulating",
        nHistory: 0,
        need: LIVE_MIN,
        note: "Recorder table not created yet \u2014 deploys with the nightly recorder."
      } };
    }
    const rows = await getEsCandles(today, void 0, 2e3);
    const bars = rthBarsForDate(rows, today);
    const todaySess = bars.length >= 3 ? buildTpoSession(bars, today, BIN) : null;
    const ibDone = etNowMin() >= IB_CLOSE_MIN && todaySess?.ibHigh != null && todaySess?.ibLow != null;
    if (hist.length < LIVE_MIN) {
      return { status: 200, body: {
        ok: false,
        status: "accumulating",
        nHistory: hist.length,
        need: LIVE_MIN,
        note: "The forecast lights up once the recorder (or a one-time backfill) has enough sessions."
      } };
    }
    if (!todaySess || !ibDone) {
      return { status: 200, body: {
        ok: false,
        status: "pre_ib",
        nHistory: hist.length,
        note: "Waiting on the Initial Balance (first two 30-min periods) to complete."
      } };
    }
    const ibMid = (todaySess.ibHigh + todaySess.ibLow) / 2;
    const feat = [];
    for (let i = 0; i < hist.length; i++) {
      const win = hist.slice(Math.max(0, i - 20), i);
      const trailIb = median(win.map((x) => x.ib_range || 0)) || (hist[i].ib_range || 1);
      const trailRng = median(win.map((x) => (x.day_high ?? 0) - (x.day_low ?? 0))) || 1;
      feat.push(features(hist[i], i > 0 ? hist[i - 1] : null, trailIb, trailRng));
    }
    const winT = hist.slice(-20);
    const trailIbT = median(winT.map((x) => x.ib_range || 0)) || (todaySess.ibRange || 1);
    const trailRngT = median(winT.map((x) => (x.day_high ?? 0) - (x.day_low ?? 0))) || 1;
    const todayRow = {
      date: today,
      poc: todaySess.poc,
      vah: todaySess.vah,
      val: todaySess.val,
      ib_high: todaySess.ibHigh,
      ib_low: todaySess.ibLow,
      ib_mid: ibMid,
      ib_range: todaySess.ibRange,
      day_open: todaySess.open,
      day_close: null,
      day_high: null,
      day_low: null,
      profile_json: []
    };
    const qf = features(todayRow, hist[hist.length - 1], trailIbT, trailRngT);
    const dims = qf.length;
    const mu = new Array(dims).fill(0), sd = new Array(dims).fill(0);
    for (const f of feat) for (let j = 0; j < dims; j++) mu[j] += f[j] / feat.length;
    for (const f of feat) for (let j = 0; j < dims; j++) sd[j] += (f[j] - mu[j]) ** 2 / feat.length;
    for (let j = 0; j < dims; j++) sd[j] = Math.sqrt(sd[j]) || 1;
    const norm = (f) => f.map((v, j) => (v - mu[j]) / sd[j]);
    const qn = norm(qf);
    const dist = feat.map((f, i) => {
      const fn = norm(f);
      let s = 0;
      for (let j = 0; j < dims; j++) s += (fn[j] - qn[j]) ** 2;
      return { i, d: Math.sqrt(s) };
    }).sort((a, b) => a.d - b.d);
    const nn = dist.slice(0, K);
    const wsum = nn.reduce((s, x) => s + 1 / (x.d + 1e-6), 0);
    const pred = new Array(GRID_N).fill(0);
    for (const { i, d } of nn) {
      const w = 1 / (d + 1e-6) / wsum;
      const dens = toDensity(hist[i].profile_json || [], hist[i].ib_mid ?? 0);
      for (let g = 0; g < GRID_N; g++) pred[g] += dens[g] * w;
    }
    const realized = toDensity(todaySess.bins.map((b) => ({ price: b.price, count: b.count })), ibMid);
    const medAll = median(dist.map((x) => x.d)) || 1;
    const meanK = nn.reduce((s, x) => s + x.d, 0) / nn.length;
    const confidence = Math.max(0, Math.min(100, Math.round(100 * (1 - meanK / medAll))));
    const prices = Array.from({ length: GRID_N }, (_, g) => GRID_LO + g * BIN + ibMid);
    const predMax = Math.max(...pred, 1e-9), realMax = Math.max(...realized, 1e-9);
    const [pvl, pvh] = vaBand(pred), [rvl, rvh] = vaBand(realized);
    return { status: 200, body: {
      ok: true,
      symbol,
      date: today,
      nHistory: hist.length,
      k: K,
      confidence,
      ibMid,
      ibHigh: todaySess.ibHigh,
      ibLow: todaySess.ibLow,
      spot: bars[bars.length - 1]?.close ?? null,
      prices,
      predicted: pred.map((v) => v / predMax),
      realized: realized.map((v) => v / realMax),
      predicted_poc: prices[pred.indexOf(Math.max(...pred))],
      realized_poc: prices[realized.indexOf(Math.max(...realized))],
      predicted_va: [prices[pvl], prices[pvh]],
      realized_va: [prices[rvl], prices[rvh]]
    } };
  } catch (e) {
    return { status: 500, body: { error: String(e?.message || e) } };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  computeTpoForecast,
  dynamic
});
