// Server-side only — do NOT import from client components
// Uses pg (PostgreSQL) — connects via DATABASE_URL

import { Pool } from "pg";

let _pool: Pool | null = null;
let _tablesEnsured = false;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes("localhost") || process.env.DATABASE_URL?.includes("127.0.0.1")
        ? undefined
        : { rejectUnauthorized: false },
      max: 5,                   // cap per-instance conns (Render Postgres is connection-limited)
      idleTimeoutMillis: 30000, // hold idle conns 30s, not pg's 10s default → less connect churn
      keepAlive: true,          // TCP keepalive so dead idle sockets surface fast and reconnect
    });
    // An idle client losing its connection (e.g. Postgres restart / recovery)
    // emits 'error' on the pool. Without a listener, pg escalates it to an
    // uncaughtException that can kill the process. Log + swallow; the pool
    // discards the dead client and the next query opens a fresh one.
    _pool.on("error", (err) => {
      console.warn("[db] idle pool client error (will reconnect):", err.message);
    });
  }
  return _pool;
}

export async function getDb(): Promise<Pool> {
  const pool = getPool();
  if (!_tablesEnsured) {
    _tablesEnsured = true;
    await ensureAllTables(pool);
  }
  return pool;
}

async function ensureAllTables(pool: Pool): Promise<void> {
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
    -- are migrated by scripts/migrate-es-candles-composite-key.sql — this CREATE
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

    -- EOD Initial Balance results — one row per (date, symbol), written 16:30 ET
    -- by server-v2/ib-results-recorder.js via POST /api/ib-results. The rules
    -- column is the 14-rule scoreboard: [{id,name,state,side,hit,note}].
    -- NOTE: this whole block is a JS template literal — never use backticks in
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
    --
    -- country/region/city/latitude/longitude come from Cloudflare's "Add visitor
    -- location headers" managed transform (cf-ipcountry / cf-region / cf-ipcity /
    -- cf-iplatitude / cf-iplongitude). They are NULL until that transform is
    -- enabled on the zone, and NULL for any request that didn't traverse the edge
    -- (local dev, direct-to-origin health checks), so every consumer must treat
    -- them as optional.
    --
    -- latitude/longitude are CITY CENTROIDS from Cloudflare's IP database, not
    -- device GPS. Everyone in a metro shares one coordinate pair, which is
    -- exactly why the owner map can cluster them into bubbles.
    CREATE TABLE IF NOT EXISTS page_visits (
      id SERIAL PRIMARY KEY,
      page_key TEXT,
      page_label TEXT,
      path TEXT,
      user_id TEXT,
      ip TEXT,
      country TEXT,
      region TEXT,
      city TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    -- Added after the table shipped: existing rows keep NULL geo (they predate
    -- the managed transform), which the map renders as "Unknown".
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS country TEXT;
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS region TEXT;
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS city TEXT;
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

    -- Acquisition + device, added 2026-07. Parsing lives in lib/visitorAttribution.ts.
    --
    -- Attribution columns are populated ONLY on the first beacon of a browser
    -- session (the is_entry row). Inside the SPA, document.referrer keeps
    -- returning the original external referrer for every client-side navigation,
    -- so writing it on every row would report ONE Google visit as twenty.
    -- One entry row per session means COUNT(*) WHERE is_entry is a session count,
    -- and grouping those by referrer_host / utm_source / channel is real
    -- acquisition data. Non-entry rows keep NULL here BY DESIGN — that is the
    -- intended shape, not missing data.
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS is_entry BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS referrer TEXT;
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS referrer_host TEXT;
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS utm_source TEXT;
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS utm_medium TEXT;
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS utm_term TEXT;
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS utm_content TEXT;
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS channel TEXT;
    -- browser/os/device_type come from the User-Agent header, which is present on
    -- EVERY request — so unlike attribution these are written on every row.
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS browser TEXT;
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS os TEXT;
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS device_type TEXT;
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE INDEX IF NOT EXISTS idx_page_visits_created ON page_visits(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_page_visits_country ON page_visits(country);
    -- Partial indexes: acquisition queries always filter to entry rows, and
    -- entries are a small slice of the table, so these stay cheap.
    CREATE INDEX IF NOT EXISTS idx_page_visits_entry_channel
      ON page_visits(channel, created_at DESC) WHERE is_entry;
    CREATE INDEX IF NOT EXISTS idx_page_visits_entry_referrer
      ON page_visits(referrer_host, created_at DESC) WHERE is_entry AND referrer_host IS NOT NULL;
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
    -- streams entered here — 'prop' (firm evals/resets + payouts), 'cbedge'
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

    -- Weekly iron condor written against that week's Estimated Move band.
    -- One row per (ticker, week_start), same key as em_tracker so the two join
    -- 1:1 and the condor can be settled from the EM row's realized weekly OHLC.
    --
    --   Bull put spread  (lower): SELL put_short  / BUY put_long   (long < short)
    --   Bear call spread (upper): SELL call_short / BUY call_long   (long > short)
    --
    -- Strikes are seeded Monday from the EM band (short put ≈ ref−EM, short call
    -- ≈ ref+EM, snapped to the ticker's strike increment) and are editable.
    -- Credits are in strike points per 1 condor; multiplier converts to dollars.
    -- result/outcome/pnl are filled by the evaluator once the weekly close is in.
    CREATE TABLE IF NOT EXISTS em_condors (
      id SERIAL PRIMARY KEY,
      ticker TEXT NOT NULL,
      week_label TEXT NOT NULL,
      week_start DATE NOT NULL,
      ref_price REAL,        -- Monday underlying reference the band was built off
      em REAL,               -- EM used for the band (points)
      put_long REAL,         -- bought put   (lower wing)
      put_short REAL,        -- sold put
      call_short REAL,       -- sold call
      call_long REAL,        -- bought call  (upper wing)
      put_credit REAL,       -- credit taken on the bull put spread
      call_credit REAL,      -- credit taken on the bear call spread
      net_credit REAL,       -- total credit for the condor (points)
      contracts INTEGER DEFAULT 1,
      multiplier REAL DEFAULT 100,
      settle_price REAL,     -- price used to settle (weekly close)
      intrinsic REAL,        -- points owed back at expiration
      pnl REAL,              -- dollars, net of credit, × contracts × multiplier
      result TEXT,           -- 'win' | 'loss' | NULL (not settled)
      outcome TEXT,          -- 'max_win' | 'partial_win' | 'partial_loss' | 'max_loss'
      breached_side TEXT,    -- 'put' | 'call' | NULL — which short expired ITM
      touched_side TEXT,     -- 'put' | 'call' | 'both' | NULL — short tagged intraweek
      result_source TEXT,    -- 'auto' | 'manual' | 'seed'
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_em_condors_ticker ON em_condors(ticker);
    CREATE INDEX IF NOT EXISTS idx_em_condors_week ON em_condors(week_start);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_em_condors_ticker_week_start
      ON em_condors(ticker, week_start);

    -- Day-by-day valuation of a condor across its week. One row per
    -- (condor, ET session). Written on demand by /api/em-condors/marks, which
    -- prices all four legs off ThetaData's per-contract EOD history.
    --   mark     = (put_short − put_long) + (call_short − call_long)  [debit to close]
    --   open_pnl = (net_credit − mark) × multiplier × contracts
    --   cushion  = underlying close → nearer SHORT strike (+ inside, − beyond)
    -- legs_priced < 4 means the mark is NULL: a partial condor is a different
    -- position, not an estimate of this one. Futures rows carry underlying and
    -- cushion only (no Theta options feed).
    CREATE TABLE IF NOT EXISTS em_condor_marks (
      id SERIAL PRIMARY KEY,
      condor_id INTEGER NOT NULL REFERENCES em_condors(id) ON DELETE CASCADE,
      d DATE NOT NULL,
      underlying REAL,
      under_high REAL,
      under_low REAL,
      put_long_px REAL,
      put_short_px REAL,
      call_short_px REAL,
      call_long_px REAL,
      mark REAL,
      open_pnl REAL,
      pct_max REAL,
      cushion REAL,
      legs_priced INTEGER DEFAULT 0,
      source TEXT DEFAULT 'theta',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_em_condor_marks_condor ON em_condor_marks(condor_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_em_condor_marks_condor_day
      ON em_condor_marks(condor_id, d);

    -- Intraday condor ticks, written at the top of each RTH hour by
    -- server-v2/condor-mark-recorder.js. Same value columns as em_condor_marks
    -- but priced from the LIVE chain NBBO mid instead of an EOD close, keyed by
    -- epoch-ms so a week holds ~35 points instead of 5. em_condor_marks stays
    -- the authoritative daily series; these are the shape between the dots.
    CREATE TABLE IF NOT EXISTS em_condor_ticks (
      id SERIAL PRIMARY KEY,
      condor_id INTEGER NOT NULL REFERENCES em_condors(id) ON DELETE CASCADE,
      ts BIGINT NOT NULL,
      underlying REAL,
      put_long_px REAL,
      put_short_px REAL,
      call_short_px REAL,
      call_long_px REAL,
      mark REAL,
      open_pnl REAL,
      pct_max REAL,
      cushion REAL,
      legs_priced INTEGER DEFAULT 0,
      source TEXT DEFAULT 'theta',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_em_condor_ticks_condor_ts ON em_condor_ticks(condor_id, ts);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_em_condor_ticks_condor_ts
      ON em_condor_ticks(condor_id, ts);

    -- EOD GEX snapshot: one row per (date, symbol), upserted at 3:55–4:05 ET.
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
    -- 30m cron cadence IS the delay — free users only ever see the last written
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
    -- JSON — everything app/home/page.tsx's readInitial() normally reads live —
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
    -- chain (raw TT items + underlyingPrice) at one shared expiry — the exact
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
    -- reverses: pct_filled climbs 0→100 as price retraces the gap, filled flips
    -- 0→1 the moment price touches prior_close (stamped in fill_ts). extreme_after
    -- is the furthest price has traveled toward the close (low for gap-up days,
    -- high for gap-down days) — the high-water mark that drives pct_filled.
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
    --   kind       — concept id (fvg, ob, ifvg, ote, mss, bos, choch, liquidity,
    --                 eqhl, inducement, turtleSoup, judas, breaker, cisd,
    --                 model2022, displacement)
    --   dir        — 'bull' | 'bear' | 'neutral'
    --   trigger_ts — epoch ms of the candle that fired the setup
    --   price      — the level/price the setup triggered at
    --   note       — short human description of the trigger
    -- Outcome is graded by follow-through over the bars AFTER trigger_ts:
    --   target       — implied directional objective
    --   invalidation — level that, if hit first, fails the setup
    --   outcome      — 'pending' | 'win' | 'loss' | 'chop'
    --   mfe/mae      — max favorable / adverse excursion (pts) since trigger
    --   r_multiple   — favorable move achieved / initial risk to invalidation
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
    -- a CLOSED 5m ES bar (the forming bar is never recorded — it repaints). The
    -- feed computes lib/momentumBias.js over the rolling candle array; a crossunder
    -- of the up/down bias above the impulse boundary fires a signal. Keyed on a
    -- stable signature so re-scans never double-log: signal_key = "<dir>:<slotKey>".
    --   dir      — 'bull' (down-bias crossunder → TP for shorts / bullish reversal)
    --            | 'bear' (up-bias crossunder → TP for longs / bearish reversal)
    --   price    — ES close of the signal bar
    --   up/down_bias, boundary — indicator state at the trigger
    -- Outcome is graded by follow-through over the bars AFTER trigger_ts, with an
    -- ATR-scaled target (atr = avg H-L of the 14 bars before the signal):
    --   outcome  — 'pending' | 'win' | 'loss' | 'chop'
    --   mfe/mae  — max favorable / adverse excursion (pts) in the signal's direction
    --   r_multiple — favorable move achieved / initial risk (atr)
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
    -- and the only identity we trust — never a client-supplied value). Mirrors
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

    -- 👍/👎 reactions on Bzila alerts. One row per (alert, user) — reaction holds
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
    -- second, user-editable row — the fixed SPX/NDX/SPY/QQQ row above it is
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
    -- across browsers/devices. ONE row per session-day per user — the CSV
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
    -- EXISTS won't retrofit it — so the importer's ON CONFLICT (user_id, date)
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
    -- The day rows in trading_journals are DERIVED from these, never typed —
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
    -- edit can't just UPDATE a trade row — and editing the underlying fills
    -- directly is unsafe when one fill is split across several trades (e.g. a
    -- 10-lot entry closed by five separate 2-lot exits all share one opening
    -- fill). Instead an edit is a shadow row keyed to the specific trade's
    -- (open_ext_id, close_ext_id) pair — the two fills THAT trade matched —
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

    -- ── Custom auth (replaces Supabase Auth) ──────────────────────────────────
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

// ── Quotes list prefs (per-user customized toolbar quotes) ──────────────────

export interface QuoteSymPref { sym: string; label: string }

/** Returns the user's saved quote list, or [] if they've never customized it. */
export async function getQuoteSymbols(clerkUserId: string): Promise<QuoteSymPref[]> {
  await getDb();
  const row = await queryOne<{ symbols: unknown }>(
    `SELECT symbols FROM quote_symbol_prefs WHERE clerk_user_id = ?`, [clerkUserId]
  );
  if (!row) return [];
  const s = row.symbols;
  const arr = typeof s === "string" ? JSON.parse(s) : s;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is QuoteSymPref => !!x && typeof x.sym === "string")
    .map((x) => ({ sym: String(x.sym), label: String(x.label ?? x.sym) }));
}

export async function upsertQuoteSymbols(clerkUserId: string, symbols: QuoteSymPref[]): Promise<void> {
  await getDb();
  await queryAll(
    `INSERT INTO quote_symbol_prefs (clerk_user_id, symbols, updated_at)
     VALUES (?, ?::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       symbols = EXCLUDED.symbols, updated_at = CURRENT_TIMESTAMP`,
    [clerkUserId, JSON.stringify(symbols)]
  );
}

// ── Positioning ticker prefs (per-user 4-card /test Positioning row) ────────

const DEFAULT_POSITIONING_TICKERS = ["AAPL", "NVDA", "TSLA", "AMD"];

/** Returns the user's saved 4-ticker row, or the built-in default if unset. */
export async function getPositioningTickers(clerkUserId: string): Promise<string[]> {
  await getDb();
  const row = await queryOne<{ tickers: unknown }>(
    `SELECT tickers FROM positioning_ticker_prefs WHERE clerk_user_id = ?`, [clerkUserId]
  );
  if (!row) return [...DEFAULT_POSITIONING_TICKERS];
  const t = row.tickers;
  const arr = typeof t === "string" ? JSON.parse(t) : t;
  const out = Array.isArray(arr) ? arr.map((x) => String(x).toUpperCase()).slice(0, 4) : [];
  while (out.length < 4) out.push(DEFAULT_POSITIONING_TICKERS[out.length]);
  return out;
}

export async function upsertPositioningTickers(clerkUserId: string, tickers: string[]): Promise<void> {
  await getDb();
  const clean = tickers.map((x) => String(x).trim().toUpperCase()).filter(Boolean).slice(0, 4);
  while (clean.length < 4) clean.push(DEFAULT_POSITIONING_TICKERS[clean.length]);
  await queryAll(
    `INSERT INTO positioning_ticker_prefs (clerk_user_id, tickers, updated_at)
     VALUES (?, ?::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       tickers = EXCLUDED.tickers, updated_at = CURRENT_TIMESTAMP`,
    [clerkUserId, JSON.stringify(clean)]
  );
}

// ── Options watchlist (/owner/watch tracker) ────────────────────────────────

export interface WatchOption {
  id: number;
  ticker: string;
  expiration: string;
  strike: number;
  side: string;            // 'C' | 'P'
  note?: string | null;
  added_price?: number | null; // mark at the moment the contract was saved
  created_at?: string;
}

export interface WatchSnapshot {
  id?: number;
  watch_id: number;
  ts: number;
  spot?: number | null;
  bid?: number | null;
  ask?: number | null;
  mark?: number | null;
  last?: number | null;
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  open_interest?: number | null;
  volume?: number | null;
  net_prem?: number | null;
  prev_close?: number | null;
  net_gex?: number | null;
}

export async function getWatchOptions(): Promise<WatchOption[]> {
  await getDb();
  return queryAll<WatchOption>(
    `SELECT * FROM watch_options ORDER BY ticker ASC, expiration ASC, strike ASC, side ASC`
  );
}

/** Add a contract. Idempotent on (ticker, expiration, strike, side). */
export async function insertWatchOption(r: {
  ticker: string; expiration: string; strike: number; side: string; note?: string | null;
}): Promise<WatchOption | undefined> {
  await getDb();
  const rows = await queryAll<WatchOption>(
    `INSERT INTO watch_options (ticker, expiration, strike, side, note)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (ticker, expiration, strike, side)
       DO UPDATE SET note = EXCLUDED.note
     RETURNING *`,
    [r.ticker, r.expiration, r.strike, r.side, r.note ?? null]
  );
  return rows[0];
}

export async function deleteWatchOption(id: number): Promise<void> {
  await getDb();
  await queryAll(`DELETE FROM watch_options WHERE id = ?`, [id]);
}

/** Records the price at add-time, once. No-op if already set (idempotent on retry). */
export async function setWatchAddedPrice(id: number, price: number): Promise<void> {
  await getDb();
  await queryAll(
    `UPDATE watch_options SET added_price = ? WHERE id = ? AND added_price IS NULL`,
    [price, id]
  );
}

// ── Trading journal (/trading) ───────────────────────────────────────────────
// Server-side replacement for the old localStorage "trading_journals" key.
// Every function is user-scoped: the user_id comes from the session in the API
// route, never from the client body, so one user can't read/delete another's.

export interface TradingJournal {
  id: number;
  user_id?: string;
  date: string;            // YYYY-MM-DD
  net_pnl: number;
  trades: number;
  win_rate: number;        // 0-100
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  commissions: number;
  notes: string | null;
  kind: "manual" | "verified";
}

export type TradingJournalInput = Omit<TradingJournal, "id" | "user_id">;

export async function getTradingJournals(userId: string): Promise<TradingJournal[]> {
  await getDb();
  return queryAll<TradingJournal>(
    `SELECT id, date, net_pnl, trades, win_rate, avg_win, avg_loss, profit_factor,
            commissions, notes, kind
       FROM trading_journals
      WHERE user_id = ?
      ORDER BY date ASC, id ASC`,
    [userId]
  );
}

export async function insertTradingJournal(
  userId: string, j: TradingJournalInput
): Promise<TradingJournal | undefined> {
  await getDb();
  const rows = await queryAll<TradingJournal>(
    `INSERT INTO trading_journals
       (user_id, date, net_pnl, trades, win_rate, avg_win, avg_loss, profit_factor,
        commissions, notes, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id, date, net_pnl, trades, win_rate, avg_win, avg_loss, profit_factor,
               commissions, notes, kind`,
    [userId, j.date, j.net_pnl, j.trades, j.win_rate, j.avg_win, j.avg_loss,
     j.profit_factor, j.commissions, j.notes ?? null, j.kind]
  );
  return rows[0];
}

/** Full-row edit. Scoped by user_id so a guessed id can't touch someone else's row. */
export async function updateTradingJournal(
  userId: string, id: number, j: TradingJournalInput
): Promise<TradingJournal | undefined> {
  await getDb();
  const rows = await queryAll<TradingJournal>(
    `UPDATE trading_journals
        SET date = ?, net_pnl = ?, trades = ?, win_rate = ?, avg_win = ?, avg_loss = ?,
            profit_factor = ?, commissions = ?, notes = ?,
            kind = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
      RETURNING id, date, net_pnl, trades, win_rate, avg_win, avg_loss, profit_factor,
                commissions, notes, kind`,
    [j.date, j.net_pnl, j.trades, j.win_rate, j.avg_win, j.avg_loss, j.profit_factor,
     j.commissions, j.notes ?? null, j.kind, id, userId]
  );
  return rows[0];
}

export async function deleteTradingJournal(userId: string, id: number): Promise<void> {
  await getDb();
  await queryAll(`DELETE FROM trading_journals WHERE id = ? AND user_id = ?`, [id, userId]);
}

/** Upsert a day row by (user, date). CSV import owns the derived stats; a manual
 *  edit to the same date is overwritten by a re-import, but the NOTES survive —
 *  the broker can't know what the user wrote, so we never blank it. */
export async function upsertTradingJournalDay(
  userId: string, j: TradingJournalInput
): Promise<TradingJournal | undefined> {
  await getDb();
  const rows = await queryAll<TradingJournal>(
    `INSERT INTO trading_journals
       (user_id, date, net_pnl, trades, win_rate, avg_win, avg_loss, profit_factor,
        commissions, notes, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, date) DO UPDATE SET
       net_pnl = EXCLUDED.net_pnl, trades = EXCLUDED.trades, win_rate = EXCLUDED.win_rate,
       avg_win = EXCLUDED.avg_win, avg_loss = EXCLUDED.avg_loss,
       profit_factor = EXCLUDED.profit_factor, commissions = EXCLUDED.commissions,
       notes = COALESCE(EXCLUDED.notes, trading_journals.notes),
       kind = EXCLUDED.kind, updated_at = CURRENT_TIMESTAMP
     RETURNING id, date, net_pnl, trades, win_rate, avg_win, avg_loss, profit_factor,
               commissions, notes, kind`,
    [userId, j.date, j.net_pnl, j.trades, j.win_rate, j.avg_win, j.avg_loss,
     j.profit_factor, j.commissions, j.notes ?? null, j.kind]
  );
  return rows[0];
}

// ── Trading fills (CSV import) ───────────────────────────────────────────────

export interface TradingFill {
  date: string; ts: number; symbol: string; underlying: string;
  asset_type: string; side: string; qty: number; price: number;
  fees: number; multiplier: number; source: string; ext_id: string;
  account: string;
}

/** Bulk insert. ON CONFLICT (user_id, ext_id) → re-importing the same
 *  statement doesn't double every stat. It's a DO UPDATE (not DO NOTHING)
 *  scoped to JUST the account column, and only when the existing row's
 *  account is still blank — this is what backfills `account` onto fills that
 *  were imported before that column existed, the first time the same
 *  statement is re-uploaded. Once a row has a non-empty account it's never
 *  overwritten. Returns the number of rows inserted OR backfilled. */
export async function insertTradingFills(userId: string, fills: TradingFill[]): Promise<number> {
  if (!fills.length) return 0;
  const pool = await getDb();
  const COLS = 14;                       // must match the column list below
  const values: unknown[] = [];
  const tuples = fills.map((f, i) => {
    values.push(userId, f.date, f.ts, f.symbol, f.underlying, f.asset_type,
      f.side, f.qty, f.price, f.fees, f.multiplier, f.source, f.ext_id, f.account ?? "");
    const ph = Array.from({ length: COLS }, (_, c) => `$${i * COLS + c + 1}`);
    return `(${ph.join(", ")})`;
  });
  const res = await pool.query(
    `INSERT INTO trading_fills
       (user_id, date, ts, symbol, underlying, asset_type, side, qty, price, fees, multiplier, source, ext_id, account)
     VALUES ${tuples.join(",")}
     ON CONFLICT (user_id, ext_id) DO UPDATE SET account = EXCLUDED.account
       WHERE trading_fills.account = '' AND EXCLUDED.account <> ''`,
    values
  );
  return res.rowCount ?? 0;
}

/** All fills for a user, oldest first — the input to round-trip matching.
 *  node-pg hands BIGINT back as a STRING (it won't fit an i32), which silently
 *  breaks the FIFO sort and the ET session bucketing downstream. Coerce the
 *  numerics here so callers always get real numbers. Same class of bug as the
 *  fails-recorder string-timestamp one. */
export async function getTradingFills(userId: string, date?: string): Promise<TradingFill[]> {
  await getDb();
  const sql = date
    ? `SELECT date, ts, symbol, underlying, asset_type, side, qty, price, fees, multiplier, source, ext_id, account
         FROM trading_fills WHERE user_id = ? AND date = ? ORDER BY ts ASC`
    : `SELECT date, ts, symbol, underlying, asset_type, side, qty, price, fees, multiplier, source, ext_id, account
         FROM trading_fills WHERE user_id = ? ORDER BY ts ASC`;
  const rows = await queryAll<TradingFill>(sql, date ? [userId, date] : [userId]);
  return rows.map((r) => ({
    ...r,
    ts: Number(r.ts),
    qty: Number(r.qty),
    price: Number(r.price),
    fees: Number(r.fees),
    multiplier: Number(r.multiplier),
    account: r.account ?? "",
  }));
}

// ── Trade edits (/trading "Trades" table) ────────────────────────────────────
// See the trading_trade_overrides CREATE TABLE comment: a shadow row keyed to
// the (open_ext_id, close_ext_id) pair of the two fills a trade matched,
// applied on top of the FIFO-derived trade at read time. Never touches
// trading_fills.

export interface TradeOverride {
  open_ext_id: string; close_ext_id: string;
  symbol: string; underlying: string; asset_type: string; direction: string;
  open_ts: number; close_ts: number; date: string; qty: number;
  entry: number; exit: number; fees: number; pnl: number; account: string;
  deleted: boolean;
}

/** All overrides for a user, as a Map keyed by "openExtId|closeExtId" for O(1)
 *  lookup while walking the freshly FIFO-derived trades. */
export async function getTradeOverrides(userId: string): Promise<Map<string, TradeOverride>> {
  await getDb();
  const rows = await queryAll<TradeOverride>(
    `SELECT open_ext_id, close_ext_id, symbol, underlying, asset_type, direction,
            open_ts, close_ts, date, qty, entry, exit, fees, pnl, account, deleted
       FROM trading_trade_overrides WHERE user_id = ?`,
    [userId]
  );
  const map = new Map<string, TradeOverride>();
  for (const r of rows) {
    map.set(`${r.open_ext_id}|${r.close_ext_id}`, {
      ...r,
      open_ts: Number(r.open_ts), close_ts: Number(r.close_ts),
      qty: Number(r.qty), entry: Number(r.entry), exit: Number(r.exit),
      fees: Number(r.fees), pnl: Number(r.pnl),
    });
  }
  return map;
}

/** Create or replace the override for one trade. Scoped by user_id + the
 *  (open_ext_id, close_ext_id) unique constraint, so a guessed pair can't
 *  touch someone else's fills — and there's nothing to guess since both ids
 *  come from a trade the user's own GET /api/journal/trades already returned. */
export async function upsertTradeOverride(userId: string, o: TradeOverride): Promise<void> {
  await getDb();
  await queryAll(
    `INSERT INTO trading_trade_overrides
       (user_id, open_ext_id, close_ext_id, symbol, underlying, asset_type, direction,
        open_ts, close_ts, date, qty, entry, exit, fees, pnl, account, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, open_ext_id, close_ext_id) DO UPDATE SET
       symbol = EXCLUDED.symbol, underlying = EXCLUDED.underlying, asset_type = EXCLUDED.asset_type,
       direction = EXCLUDED.direction, open_ts = EXCLUDED.open_ts, close_ts = EXCLUDED.close_ts,
       date = EXCLUDED.date, qty = EXCLUDED.qty, entry = EXCLUDED.entry, exit = EXCLUDED.exit,
       fees = EXCLUDED.fees, pnl = EXCLUDED.pnl, account = EXCLUDED.account, deleted = EXCLUDED.deleted,
       updated_at = CURRENT_TIMESTAMP`,
    [userId, o.open_ext_id, o.close_ext_id, o.symbol, o.underlying, o.asset_type, o.direction,
     o.open_ts, o.close_ts, o.date, o.qty, o.entry, o.exit, o.fees, o.pnl, o.account, o.deleted]
  );
}

export async function insertWatchSnapshot(s: WatchSnapshot): Promise<void> {
  await getDb();
  await queryAll(
    `INSERT INTO watch_snapshots
       (watch_id, ts, spot, bid, ask, mark, last, iv, delta, gamma, theta, vega, open_interest, volume, net_prem, prev_close, net_gex)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [s.watch_id, s.ts, s.spot ?? null, s.bid ?? null, s.ask ?? null, s.mark ?? null,
     s.last ?? null, s.iv ?? null, s.delta ?? null, s.gamma ?? null, s.theta ?? null,
     s.vega ?? null, s.open_interest ?? null, s.volume ?? null, s.net_prem ?? null, s.prev_close ?? null, s.net_gex ?? null]
  );
}

/** Latest snapshot per watched contract (one row each). */
export async function getLatestWatchSnapshots(): Promise<WatchSnapshot[]> {
  await getDb();
  return queryAll<WatchSnapshot>(
    `SELECT DISTINCT ON (watch_id) *
       FROM watch_snapshots
      ORDER BY watch_id, ts DESC`
  );
}

/** Time series for one contract (oldest→newest), capped. */
export async function getWatchHistory(watchId: number, limit = 300): Promise<WatchSnapshot[]> {
  await getDb();
  const rows = await queryAll<WatchSnapshot>(
    `SELECT * FROM watch_snapshots WHERE watch_id = ? ORDER BY ts DESC LIMIT ?`,
    [watchId, limit]
  );
  return rows.reverse();
}

/** Time series since a given epoch-ms cutoff (oldest→newest), capped — powers the chart's multi-day ranges. */
export async function getWatchHistorySince(watchId: number, sinceTs: number, limit = 5000): Promise<WatchSnapshot[]> {
  await getDb();
  const rows = await queryAll<WatchSnapshot>(
    `SELECT * FROM watch_snapshots WHERE watch_id = ? AND ts >= ? ORDER BY ts DESC LIMIT ?`,
    [watchId, sinceTs, limit]
  );
  return rows.reverse();
}

// ── ICT glossary card prefs (per-user show/hide) ────────────────────────────

/** Concept ids the user has hidden on the /ict glossary. Empty = all shown. */
export async function getIctCardPrefs(clerkUserId: string): Promise<string[]> {
  await getDb();
  const row = await queryOne<{ hidden_cards: unknown }>(
    `SELECT hidden_cards FROM ict_card_prefs WHERE clerk_user_id = ?`, [clerkUserId]
  );
  if (!row) return [];
  const hc = row.hidden_cards;
  const arr = typeof hc === "string" ? JSON.parse(hc) : hc;
  return Array.isArray(arr) ? arr.map(String) : [];
}

export async function upsertIctCardPrefs(clerkUserId: string, hiddenCards: string[]): Promise<void> {
  await getDb();
  await queryAll(
    `INSERT INTO ict_card_prefs (clerk_user_id, hidden_cards, updated_at)
     VALUES (?, ?::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       hidden_cards = EXCLUDED.hidden_cards, updated_at = CURRENT_TIMESTAMP`,
    [clerkUserId, JSON.stringify(hiddenCards)]
  );
}

// ── Traders Dashboard: per-user prefs ───────────────────────────────────────

export interface TdPrefs {
  clerk_user_id: string;
  zip: string | null;
  schedule: unknown[];
  tasks: unknown[];
  updated_at?: string;
}

export async function getTdPrefs(clerkUserId: string): Promise<TdPrefs | undefined> {
  await getDb();
  return queryOne<TdPrefs>(`SELECT * FROM td_user_prefs WHERE clerk_user_id = ?`, [clerkUserId]);
}

export async function upsertTdPrefs(
  clerkUserId: string,
  fields: { zip?: string | null; schedule?: unknown[]; tasks?: unknown[]; links?: unknown[] }
): Promise<void> {
  await getDb();
  const existing = await getTdPrefs(clerkUserId);
  const zip = fields.zip !== undefined ? fields.zip : existing?.zip ?? null;
  const schedule = fields.schedule !== undefined ? fields.schedule : existing?.schedule ?? [];
  const tasks = fields.tasks !== undefined ? fields.tasks : existing?.tasks ?? [];
  const links = fields.links !== undefined ? fields.links : (existing as Record<string, unknown>)?.links ?? [];
  await queryAll(
    `INSERT INTO td_user_prefs (clerk_user_id, zip, schedule, tasks, links, updated_at)
     VALUES (?, ?, ?::jsonb, ?::jsonb, ?::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       zip = EXCLUDED.zip, schedule = EXCLUDED.schedule, tasks = EXCLUDED.tasks,
       links = EXCLUDED.links, updated_at = CURRENT_TIMESTAMP`,
    [clerkUserId, zip, JSON.stringify(schedule), JSON.stringify(tasks), JSON.stringify(links)]
  );
}

// ── Traders Dashboard: "Words from Bzila" owner note ────────────────────────

export interface BzilaNote { content: string; updated_at: string | null; }

export async function getBzilaNote(): Promise<BzilaNote | undefined> {
  await getDb();
  return queryOne<BzilaNote>(`SELECT content, updated_at FROM bzila_note WHERE id = 1`);
}

export async function upsertBzilaNote(content: string): Promise<void> {
  await getDb();
  await queryAll(
    `INSERT INTO bzila_note (id, content, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP`,
    [content]
  );
}

// ── Bzila alerts (owner broadcast → toolbar bell) ───────────────────────────

export interface BzilaAlert {
  id: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

/** Latest N alerts, newest first (default 5, capped 50). */
export async function getBzilaAlerts(limit = 5): Promise<BzilaAlert[]> {
  await getDb();
  const n = Math.min(Math.max(1, Math.floor(limit) || 5), 50);
  return queryAll<BzilaAlert>(
    `SELECT id, title, body, created_at, updated_at
       FROM bzila_alerts ORDER BY id DESC LIMIT ${n}`
  );
}

export async function insertBzilaAlert(title: string, body: string): Promise<number> {
  await getDb();
  const row = await queryOne<{ id: number }>(
    `INSERT INTO bzila_alerts (title, body) VALUES (?, ?) RETURNING id`,
    [title, body]
  );
  return row?.id ?? 0;
}

export async function updateBzilaAlert(id: number, title: string, body: string): Promise<void> {
  await getDb();
  await queryAll(
    `UPDATE bzila_alerts SET title = ?, body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [title, body, id]
  );
}

export async function deleteBzilaAlert(id: number): Promise<void> {
  await getDb();
  await queryAll(`DELETE FROM bzila_alert_reactions WHERE alert_id = ?`, [id]);
  await queryAll(`DELETE FROM bzila_alerts WHERE id = ?`, [id]);
}

// ── Bzila alert reactions (👍/👎) ───────────────────────────────────────────

export type BzilaReaction = "" | "up" | "down";

export interface BzilaAlertCounts { alert_id: number; up: number; down: number; }

/** Toggle a user's reaction on an alert. Re-clicking the same thumb clears it.
 *  Every tap increments `clicks`. Returns the resulting reaction ('' if cleared). */
export async function reactBzilaAlert(
  alertId: number, userId: string, email: string, reaction: "up" | "down"
): Promise<BzilaReaction> {
  await getDb();
  const row = await queryOne<{ reaction: BzilaReaction }>(
    `INSERT INTO bzila_alert_reactions (alert_id, user_id, email, reaction, clicks, updated_at)
     VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT (alert_id, user_id) DO UPDATE SET
       reaction = CASE WHEN bzila_alert_reactions.reaction = EXCLUDED.reaction THEN '' ELSE EXCLUDED.reaction END,
       email = EXCLUDED.email,
       clicks = bzila_alert_reactions.clicks + 1,
       updated_at = CURRENT_TIMESTAMP
     RETURNING reaction`,
    [alertId, userId, email, reaction]
  );
  return row?.reaction ?? "";
}

/** Up/down tallies per alert (only alerts that have at least one reaction). */
export async function getBzilaAlertCounts(): Promise<BzilaAlertCounts[]> {
  await getDb();
  return queryAll<BzilaAlertCounts>(
    `SELECT alert_id,
            SUM(CASE WHEN reaction = 'up'   THEN 1 ELSE 0 END)::int AS up,
            SUM(CASE WHEN reaction = 'down' THEN 1 ELSE 0 END)::int AS down
       FROM bzila_alert_reactions
      GROUP BY alert_id`
  );
}

/** The signed-in user's current reaction per alert (non-empty only). */
export async function getUserBzilaReactions(userId: string): Promise<Record<number, BzilaReaction>> {
  await getDb();
  const rows = await queryAll<{ alert_id: number; reaction: BzilaReaction }>(
    `SELECT alert_id, reaction FROM bzila_alert_reactions WHERE user_id = ? AND reaction <> ''`,
    [userId]
  );
  const out: Record<number, BzilaReaction> = {};
  for (const r of rows) out[r.alert_id] = r.reaction;
  return out;
}

export interface BzilaReactor { email: string; reaction: BzilaReaction; clicks: number; updated_at: string; }
export interface BzilaAlertReportRow extends BzilaAlert {
  up: number; down: number; clicks: number; reactors: BzilaReactor[];
}

/** Owner analytics: latest alerts with per-alert tallies + who reacted. */
export async function getBzilaAlertReport(limit = 50): Promise<BzilaAlertReportRow[]> {
  await getDb();
  const alerts = await getBzilaAlerts(limit);
  if (alerts.length === 0) return [];
  const ids = alerts.map((a) => a.id);
  const placeholders = ids.map(() => "?").join(",");
  const reactions = await queryAll<{ alert_id: number } & BzilaReactor>(
    `SELECT alert_id, email, reaction, clicks, updated_at
       FROM bzila_alert_reactions
      WHERE alert_id IN (${placeholders})
      ORDER BY updated_at DESC`,
    ids
  );
  const byAlert = new Map<number, BzilaReactor[]>();
  for (const r of reactions) {
    const list = byAlert.get(r.alert_id) ?? [];
    list.push({ email: r.email, reaction: r.reaction, clicks: r.clicks, updated_at: r.updated_at });
    byAlert.set(r.alert_id, list);
  }
  return alerts.map((a) => {
    const reactors = byAlert.get(a.id) ?? [];
    return {
      ...a,
      up: reactors.filter((r) => r.reaction === "up").length,
      down: reactors.filter((r) => r.reaction === "down").length,
      clicks: reactors.reduce((s, r) => s + (r.clicks || 0), 0),
      reactors,
    };
  });
}

// ── Traders Dashboard: overnight overview ───────────────────────────────────

export interface TdOverview {
  date: string;
  summary: string;
  drivers: unknown[];
  generated_at: number;
}

export async function getTdOverview(date: string): Promise<TdOverview | undefined> {
  await getDb();
  return queryOne<TdOverview>(`SELECT * FROM td_overview WHERE date = ?`, [date]);
}

export async function getLatestTdOverview(): Promise<TdOverview | undefined> {
  await getDb();
  return queryOne<TdOverview>(`SELECT * FROM td_overview ORDER BY date DESC LIMIT 1`);
}

export async function upsertTdOverview(
  date: string,
  summary: string,
  drivers: unknown[],
  movers: unknown[] = []
): Promise<void> {
  await getDb();
  await queryAll(
    `INSERT INTO td_overview (date, summary, drivers, movers, generated_at)
     VALUES (?, ?, ?::jsonb, ?::jsonb, ?)
     ON CONFLICT (date) DO UPDATE SET
       summary = EXCLUDED.summary, drivers = EXCLUDED.drivers,
       movers = EXCLUDED.movers, generated_at = EXCLUDED.generated_at`,
    [date, summary, JSON.stringify(drivers), JSON.stringify(movers), Date.now()]
  );
}

// ── Pre-market AI summary ───────────────────────────────────────────────────

export interface PremarketSummary {
  date: string;
  bullets: string[];
  generated_at: number;
}

export async function getPremarketSummary(date: string): Promise<PremarketSummary | undefined> {
  await getDb();
  return queryOne<PremarketSummary>(`SELECT * FROM premarket_summary WHERE date = ?`, [date]);
}

export async function getLatestPremarketSummary(): Promise<PremarketSummary | undefined> {
  await getDb();
  return queryOne<PremarketSummary>(`SELECT * FROM premarket_summary ORDER BY date DESC LIMIT 1`);
}

export async function upsertPremarketSummary(date: string, bullets: string[]): Promise<void> {
  await getDb();
  await queryAll(
    `INSERT INTO premarket_summary (date, bullets, generated_at)
     VALUES (?, ?::jsonb, ?)
     ON CONFLICT (date) DO UPDATE SET
       bullets = EXCLUDED.bullets, generated_at = EXCLUDED.generated_at`,
    [date, JSON.stringify(bullets), Date.now()]
  );
}

// ── Daily AI trade strategy (Analytics strategy-builder) ────────────────────

export interface DailyStrategy {
  date: string;
  plan: unknown;
  generated_at: number;
}

export async function getDailyStrategy(date: string): Promise<DailyStrategy | undefined> {
  await getDb();
  return queryOne<DailyStrategy>(`SELECT * FROM daily_strategy WHERE date = ?`, [date]);
}

export async function getLatestDailyStrategy(): Promise<DailyStrategy | undefined> {
  await getDb();
  return queryOne<DailyStrategy>(`SELECT * FROM daily_strategy ORDER BY date DESC LIMIT 1`);
}

export async function upsertDailyStrategy(date: string, plan: unknown): Promise<void> {
  await getDb();
  await queryAll(
    `INSERT INTO daily_strategy (date, plan, generated_at)
     VALUES (?, ?::jsonb, ?)
     ON CONFLICT (date) DO UPDATE SET
       plan = EXCLUDED.plan, generated_at = EXCLUDED.generated_at`,
    [date, JSON.stringify(plan), Date.now()]
  );
}

/** Append-only intraday snapshot of the plan, keyed by ET hour slot. */
export interface DailyStrategyHistoryRow extends DailyStrategy {
  hour: number;
}

export async function insertDailyStrategyHistory(date: string, hour: number, plan: unknown): Promise<void> {
  await getDb();
  await queryAll(
    `INSERT INTO daily_strategy_history (date, hour, plan, generated_at)
     VALUES (?, ?, ?::jsonb, ?)
     ON CONFLICT (date, hour) DO UPDATE SET
       plan = EXCLUDED.plan, generated_at = EXCLUDED.generated_at`,
    [date, hour, JSON.stringify(plan), Date.now()]
  );
}

export async function getDailyStrategyHistory(date: string): Promise<DailyStrategyHistoryRow[]> {
  await getDb();
  return queryAll<DailyStrategyHistoryRow>(
    `SELECT * FROM daily_strategy_history WHERE date = ? ORDER BY hour ASC`,
    [date]
  );
}

// ── Stripe subscriptions ────────────────────────────────────────────────────

export interface SubscriptionRecord {
  clerk_user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string | null;
  price_id: string | null;
  current_period_end: number | null;
  cancel_at_period_end: number;
  created_at?: string;
  updated_at?: string;
}

/** Statuses that grant access to the paid product. */
export const PAID_STATUSES = new Set(["active", "trialing"]);

/** Look up a user's subscription row (or undefined if they've never checked out). */
export async function getSubscription(clerkUserId: string): Promise<SubscriptionRecord | undefined> {
  return queryOne<SubscriptionRecord>(
    "SELECT * FROM subscriptions WHERE clerk_user_id = ?",
    [clerkUserId]
  );
}

/** Find the user row that owns a given Stripe customer (webhook reverse-lookup). */
export async function getSubscriptionByCustomer(customerId: string): Promise<SubscriptionRecord | undefined> {
  return queryOne<SubscriptionRecord>(
    "SELECT * FROM subscriptions WHERE stripe_customer_id = ?",
    [customerId]
  );
}

/** Record (or update) the Stripe customer id for a user at checkout time, before
 *  any subscription exists. NULL fields never clobber existing non-null values. */
export async function linkStripeCustomer(clerkUserId: string, customerId: string): Promise<void> {
  await pgQuery(
    `INSERT INTO subscriptions (clerk_user_id, stripe_customer_id)
     VALUES ($1, $2)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
       updated_at = CURRENT_TIMESTAMP`,
    [clerkUserId, customerId]
  );
}

/** Upsert the full subscription state from a Stripe webhook event, keyed on the
 *  Clerk user id. The webhook is the single writer of status/period fields. */
export async function upsertSubscription(r: {
  clerk_user_id: string;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  status?: string | null;
  price_id?: string | null;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean | null;
}): Promise<void> {
  await pgQuery(
    `INSERT INTO subscriptions
       (clerk_user_id, stripe_customer_id, stripe_subscription_id, status,
        price_id, current_period_end, cancel_at_period_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       stripe_customer_id     = COALESCE(EXCLUDED.stripe_customer_id,     subscriptions.stripe_customer_id),
       stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, subscriptions.stripe_subscription_id),
       status                 = COALESCE(EXCLUDED.status,                 subscriptions.status),
       price_id               = COALESCE(EXCLUDED.price_id,               subscriptions.price_id),
       current_period_end     = COALESCE(EXCLUDED.current_period_end,     subscriptions.current_period_end),
       cancel_at_period_end   = EXCLUDED.cancel_at_period_end,
       updated_at             = CURRENT_TIMESTAMP`,
    [
      r.clerk_user_id,
      r.stripe_customer_id ?? null,
      r.stripe_subscription_id ?? null,
      r.status ?? null,
      r.price_id ?? null,
      r.current_period_end ?? null,
      r.cancel_at_period_end ? 1 : 0,
    ]
  );
}

/**
 * Atomically claim the one-time founder welcome email for a paid user.
 * Returns true only on the FIRST successful claim (welcome_email_sent_at was
 * NULL); subsequent calls return false. The conditional UPDATE makes this safe
 * against concurrent/duplicate Stripe webhook deliveries — only one caller can
 * flip NULL → now(), so the email is sent exactly once. Any DB error returns
 * false so a failure never blocks the webhook (it just skips the email).
 */
export async function claimWelcomeEmail(clerkUserId: string): Promise<boolean> {
  try {
    const res = await pgQuery(
      `UPDATE subscriptions
         SET welcome_email_sent_at = CURRENT_TIMESTAMP
       WHERE clerk_user_id = $1 AND welcome_email_sent_at IS NULL`,
      [clerkUserId]
    );
    return (res?.rowCount ?? 0) > 0;
  } catch (err) {
    console.error("[db] claimWelcomeEmail failed:", err);
    return false;
  }
}

// ── Custom auth: users ───────────────────────────────────────────────────────

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string | null;
  google_sub: string | null;
  is_owner: boolean;
  email_verified_at: string | null;
  discord_id: string | null;
  discord_username: string | null;
  discord_avatar: string | null;
  discord_connected_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export async function getUserByEmail(email: string): Promise<UserRecord | undefined> {
  return queryOne<UserRecord>(`SELECT * FROM users WHERE lower(email) = lower(?)`, [email]);
}

export async function getUserById(id: string): Promise<UserRecord | undefined> {
  return queryOne<UserRecord>(`SELECT * FROM users WHERE id = ?`, [id]);
}

export async function getUserByGoogleSub(googleSub: string): Promise<UserRecord | undefined> {
  return queryOne<UserRecord>(`SELECT * FROM users WHERE google_sub = ?`, [googleSub]);
}

/** Creates a new account. Caller supplies id (crypto.randomUUID()) so callers
 *  that also need the id before the row exists (e.g. to stamp a Stripe customer)
 *  never have to round-trip. Throws on duplicate email (unique constraint). */
export async function createUser(r: {
  id: string;
  email: string;
  password_hash?: string | null;
  google_sub?: string | null;
  is_owner?: boolean;
}): Promise<UserRecord> {
  const rows = await queryAll<UserRecord>(
    `INSERT INTO users (id, email, password_hash, google_sub, is_owner)
     VALUES (?, ?, ?, ?, ?)
     RETURNING *`,
    [r.id, r.email.trim().toLowerCase(), r.password_hash ?? null, r.google_sub ?? null, !!r.is_owner]
  );
  return rows[0];
}

/** Transparent bcrypt->scrypt upgrade after a successful legacy-hash login. */
export async function updateUserPasswordHash(id: string, passwordHash: string): Promise<void> {
  await pgQuery(`UPDATE users SET password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id, passwordHash]);
}

/** Links a Google account to an existing (email/password) user on first Google sign-in. */
export async function setUserGoogleSub(id: string, googleSub: string): Promise<void> {
  await pgQuery(`UPDATE users SET google_sub = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id, googleSub]);
}

export async function markUserEmailVerified(id: string): Promise<void> {
  await pgQuery(`UPDATE users SET email_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND email_verified_at IS NULL`, [id]);
}

/** Links a Discord account after a successful OAuth callback. Upserts on
 *  conflict so re-connecting (e.g. after switching Discord accounts) just
 *  overwrites the previous link rather than erroring. */
export async function setUserDiscord(id: string, discord: {
  discord_id: string;
  discord_username: string;
  discord_avatar: string | null;
}): Promise<void> {
  await pgQuery(
    `UPDATE users
        SET discord_id = $2, discord_username = $3, discord_avatar = $4,
            discord_connected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [id, discord.discord_id, discord.discord_username, discord.discord_avatar]
  );
}

export async function clearUserDiscord(id: string): Promise<void> {
  await pgQuery(
    `UPDATE users
        SET discord_id = NULL, discord_username = NULL, discord_avatar = NULL,
            discord_connected_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [id]
  );
}

/** Owner-dashboard stats: total accounts + most recently created ones. */
export async function countUsers(): Promise<number> {
  const row = await queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM users`);
  return Number(row?.count ?? 0);
}

export async function listRecentUsers(limit = 5): Promise<Pick<UserRecord, "id" | "email" | "created_at">[]> {
  return queryAll(`SELECT id, email, created_at FROM users ORDER BY created_at DESC LIMIT ?`, [limit]);
}

export interface UserWithLastLogin {
  id: string;
  email: string;
  created_at: string;
  last_login_at: string | null;
}

/** Every user + their most recent session's created_at as a "last login"
 *  proxy (a session row is only ever created at login — see
 *  lib/auth/session.ts's createSession). Replaces the old
 *  Supabase-Auth-derived last_sign_in_at for the customer-activity admin page. */
export async function listUsersWithLastLogin(): Promise<UserWithLastLogin[]> {
  return queryAll<UserWithLastLogin>(`
    SELECT u.id, u.email, u.created_at, s.last_login_at
      FROM users u
      LEFT JOIN (
        SELECT user_id, MAX(created_at) AS last_login_at
          FROM sessions
         GROUP BY user_id
      ) s ON s.user_id = u.id
  `);
}

export interface DiscordConnectionRow {
  id: string;
  email: string;
  discord_id: string;
  discord_username: string;
  discord_avatar: string | null;
  discord_connected_at: string | null;
  is_owner: boolean;
}

/** Every account with a linked Discord — feeds the admin "Discord Connections"
 *  card and the Sales table's Discord column (joined there by email). */
export async function listDiscordConnections(): Promise<DiscordConnectionRow[]> {
  return queryAll<DiscordConnectionRow>(`
    SELECT id, email, discord_id, discord_username, discord_avatar, discord_connected_at, is_owner
      FROM users
     WHERE discord_id IS NOT NULL
     ORDER BY discord_connected_at DESC NULLS LAST
  `);
}

export async function countActiveSessions(): Promise<number> {
  const row = await queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM sessions WHERE expires_at > NOW()`);
  return Number(row?.count ?? 0);
}

/** Every account + whether they're currently paid — powers the /admin email
 *  broadcast recipient lists. Was previously paginated through Supabase's
 *  admin.auth.admin.listUsers(); now a single indexed join against our own
 *  tables (fine at current scale — cap is generous headroom, not a real limit). */
export interface BroadcastRecipient { userId: string; email: string; paid: boolean }

export async function listAllUsersForBroadcast(): Promise<BroadcastRecipient[]> {
  const rows = await queryAll<{ id: string; email: string; status: string | null }>(
    `SELECT u.id, u.email, sub.status
       FROM users u
       LEFT JOIN subscriptions sub ON sub.clerk_user_id = u.id
      ORDER BY u.created_at ASC
      LIMIT 50000`
  );
  return rows.map((r) => ({ userId: r.id, email: r.email, paid: !!r.status && PAID_STATUSES.has(r.status) }));
}

// ── Custom auth: sessions ────────────────────────────────────────────────────

export interface SessionRecord {
  token_hash: string;
  user_id: string;
  expires_at: string;
}

export async function insertSession(r: {
  token_hash: string;
  user_id: string;
  expires_at: Date;
  user_agent?: string | null;
  ip?: string | null;
}): Promise<void> {
  await pgQuery(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip) VALUES ($1,$2,$3,$4,$5)`,
    [r.token_hash, r.user_id, r.expires_at.toISOString(), r.user_agent ?? null, r.ip ?? null]
  );
}

/** Session + owning user's live gate flags (is_owner, is_paid) in one round trip
 *  -- this is what runs on every gated request, so it's a single indexed join
 *  rather than two queries. */
export interface SessionWithUser {
  user_id: string;
  email: string;
  is_owner: boolean;
  is_paid: boolean;
  expires_at: string;
}

export async function getSessionWithUser(tokenHash: string): Promise<SessionWithUser | undefined> {
  return queryOne<SessionWithUser>(
    `SELECT s.user_id, u.email, u.is_owner, s.expires_at,
            COALESCE(sub.status IN ('active','trialing'), FALSE) AS is_paid
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN subscriptions sub ON sub.clerk_user_id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > NOW()`,
    [tokenHash]
  );
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await pgQuery(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}

/** Signs out every device — used after a password reset/change so a leaked
 *  old password can't keep an attacker's existing session alive. */
export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await pgQuery(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

/** Housekeeping: drop expired rows. Cheap and idempotent -- fine to call on a
 *  timer or opportunistically (e.g. a fraction of login attempts). */
export async function deleteExpiredSessions(): Promise<number> {
  const res = await pgQuery(`DELETE FROM sessions WHERE expires_at <= NOW()`);
  return res.rowCount ?? 0;
}

// ── Custom auth: password resets ─────────────────────────────────────────────

export async function insertPasswordReset(r: { token_hash: string; user_id: string; expires_at: Date }): Promise<void> {
  await pgQuery(
    `INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1,$2,$3)`,
    [r.token_hash, r.user_id, r.expires_at.toISOString()]
  );
}

export async function consumePasswordReset(tokenHash: string): Promise<{ user_id: string } | undefined> {
  const rows = await queryAll<{ user_id: string }>(
    `UPDATE password_resets SET used_at = CURRENT_TIMESTAMP
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
      RETURNING user_id`,
    [tokenHash]
  );
  return rows[0];
}

// ── EM Tracker (per-ticker weekly Estimated Move hit/miss record) ───────────

export interface EmTrackerRow {
  id?: number;
  ticker: string;
  week_label: string;
  week_start?: string | null;
  em: number;
  ref_close?: number | null;
  up?: number | null;
  down?: number | null;
  o?: number | null;
  h?: number | null;
  l?: number | null;
  c?: number | null;
  result?: "hit" | "miss" | null;
  breach?: number | null;
  breach_day?: string | null;
  result_source?: "auto" | "manual" | "import" | "seed" | null;
  note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Insert or update one weekly EM row, keyed on (ticker, week_start).
 *  Requires week_start (the Monday ISO date) so 2+ years of weeks stay distinct.
 *  NULL incoming values never overwrite an existing non-null value. */
export async function upsertEmTrackerRow(r: EmTrackerRow): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO em_tracker
       (ticker, week_label, week_start, em, ref_close, up, down, o, h, l, c, result, breach, breach_day, result_source, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT(ticker, week_start) DO UPDATE SET
       week_label    = COALESCE(EXCLUDED.week_label,    em_tracker.week_label),
       em            = COALESCE(EXCLUDED.em,            em_tracker.em),
       ref_close     = COALESCE(EXCLUDED.ref_close,     em_tracker.ref_close),
       up            = COALESCE(EXCLUDED.up,            em_tracker.up),
       down          = COALESCE(EXCLUDED.down,          em_tracker.down),
       o             = COALESCE(EXCLUDED.o,             em_tracker.o),
       h             = COALESCE(EXCLUDED.h,             em_tracker.h),
       l             = COALESCE(EXCLUDED.l,             em_tracker.l),
       c             = COALESCE(EXCLUDED.c,             em_tracker.c),
       result        = COALESCE(EXCLUDED.result,        em_tracker.result),
       breach        = COALESCE(EXCLUDED.breach,        em_tracker.breach),
       breach_day    = COALESCE(EXCLUDED.breach_day,    em_tracker.breach_day),
       result_source = COALESCE(EXCLUDED.result_source, em_tracker.result_source),
       note          = COALESCE(EXCLUDED.note,          em_tracker.note),
       updated_at    = CURRENT_TIMESTAMP`,
    [
      r.ticker.toUpperCase(), r.week_label, r.week_start ?? null, r.em, r.ref_close ?? null,
      r.up ?? null, r.down ?? null, r.o ?? null, r.h ?? null, r.l ?? null, r.c ?? null,
      r.result ?? null, r.breach ?? null, r.breach_day ?? null, r.result_source ?? null, r.note ?? null,
    ]
  );
}

/** Fill realized weekly OHLC onto an EXISTING (ticker, week_label) row without
 *  touching the EM band. No-op if the row doesn't exist (never inserts an
 *  em-less row, which would violate the NOT NULL constraint). */
export async function updateEmTrackerOhlc(
  ticker: string, week_label: string,
  ohlc: { o?: number | null; h?: number | null; l?: number | null; c?: number | null }
): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `UPDATE em_tracker SET
       o = COALESCE($3, o), h = COALESCE($4, h), l = COALESCE($5, l), c = COALESCE($6, c),
       updated_at = CURRENT_TIMESTAMP
     WHERE ticker = $1 AND week_label = $2`,
    [ticker.toUpperCase(), week_label, ohlc.o ?? null, ohlc.h ?? null, ohlc.l ?? null, ohlc.c ?? null]
  );
}

/** All weekly rows, newest week first (then ticker). */
export async function getEmTrackerRows(ticker?: string): Promise<EmTrackerRow[]> {
  if (ticker) {
    return queryAll<EmTrackerRow>(
      `SELECT * FROM em_tracker WHERE ticker = ? ORDER BY week_start DESC NULLS LAST, week_label DESC`,
      [ticker.toUpperCase()]
    );
  }
  return queryAll<EmTrackerRow>(
    `SELECT * FROM em_tracker ORDER BY week_start DESC NULLS LAST, ticker ASC`
  );
}

/** Rows seeded for a given week that still need a result (band present, no
 *  result yet). Used by the Saturday evaluator. */
export async function getEmTrackerPendingForWeek(week_start: string): Promise<EmTrackerRow[]> {
  return queryAll<EmTrackerRow>(
    `SELECT * FROM em_tracker
      WHERE week_start = ? AND result IS NULL AND em IS NOT NULL
      ORDER BY ticker ASC`,
    [week_start]
  );
}

/** Per-ticker hit-rate summary: hits, evaluated weeks, total weeks, latest EM. */
export interface EmTrackerSummary {
  ticker: string;
  hits: number;
  misses: number;
  evaluated: number;   // hits + misses
  total: number;       // all weeks with an EM on record
  hit_rate: number | null; // hits / evaluated, 0..1
  latest_em: number | null;
  latest_week: string | null;
}

export async function getEmTrackerSummary(): Promise<EmTrackerSummary[]> {
  const pool = await getDb();
  const result = await pool.query(`
    SELECT
      ticker,
      COUNT(*) FILTER (WHERE result = 'hit')::int  AS hits,
      COUNT(*) FILTER (WHERE result = 'miss')::int AS misses,
      COUNT(*) FILTER (WHERE result IN ('hit','miss'))::int AS evaluated,
      COUNT(*)::int AS total,
      (SELECT em FROM em_tracker e2
         WHERE e2.ticker = e.ticker
         ORDER BY week_start DESC NULLS LAST, week_label DESC LIMIT 1) AS latest_em,
      (SELECT week_label FROM em_tracker e3
         WHERE e3.ticker = e.ticker
         ORDER BY week_start DESC NULLS LAST, week_label DESC LIMIT 1) AS latest_week
    FROM em_tracker e
    GROUP BY ticker
    ORDER BY ticker ASC
  `);
  return result.rows.map((r) => ({
    ticker: r.ticker,
    hits: Number(r.hits ?? 0),
    misses: Number(r.misses ?? 0),
    evaluated: Number(r.evaluated ?? 0),
    total: Number(r.total ?? 0),
    hit_rate: Number(r.evaluated) > 0 ? Number(r.hits) / Number(r.evaluated) : null,
    latest_em: r.latest_em != null ? Number(r.latest_em) : null,
    latest_week: r.latest_week ?? null,
  }));
}

/** Rows that have an EM + reference close + realized OHLC but no result yet —
 *  the candidates for auto-evaluation. */
export async function getEmTrackerUnevaluated(): Promise<EmTrackerRow[]> {
  return queryAll<EmTrackerRow>(
    `SELECT * FROM em_tracker
      WHERE result IS NULL AND em IS NOT NULL AND ref_close IS NOT NULL
        AND h IS NOT NULL AND l IS NOT NULL
      ORDER BY week_start ASC NULLS LAST, ticker ASC`
  );
}

/** Set the computed result for one row. */
export async function setEmTrackerResult(
  id: number, result: "hit" | "miss", source: "auto" | "manual" = "auto"
): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `UPDATE em_tracker SET result = $2, result_source = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id, result, source]
  );
}

export async function deleteEmTrackerRow(id: number): Promise<void> {
  const pool = await getDb();
  await pool.query(`DELETE FROM em_tracker WHERE id = $1`, [id]);
}

/** Wipe going-forward em_tracker rows. Optionally only those from a given
 *  result_source (e.g. 'import' to undo a bad import without losing manual/auto
 *  weeks). Returns number of rows removed. The verified 31-week history lives in
 *  data/em-tracker-history.json and is NOT affected. */
export async function clearEmTracker(source?: string): Promise<number> {
  const pool = await getDb();
  const res = source
    ? await pool.query(`DELETE FROM em_tracker WHERE result_source = $1`, [source])
    : await pool.query(`DELETE FROM em_tracker`);
  return res.rowCount ?? 0;
}

// ── EM Iron Condors (weekly condor written against the EM band) ────────────

export interface EmCondorRow {
  id?: number;
  ticker: string;
  week_label: string;
  week_start: string;
  ref_price?: number | null;
  em?: number | null;
  put_long?: number | null;
  put_short?: number | null;
  call_short?: number | null;
  call_long?: number | null;
  put_credit?: number | null;
  call_credit?: number | null;
  net_credit?: number | null;
  contracts?: number | null;
  multiplier?: number | null;
  settle_price?: number | null;
  intrinsic?: number | null;
  pnl?: number | null;
  result?: "win" | "loss" | null;
  outcome?: "max_win" | "partial_win" | "partial_loss" | "max_loss" | null;
  breached_side?: "put" | "call" | null;
  touched_side?: "put" | "call" | "both" | null;
  result_source?: "auto" | "manual" | "seed" | null;
  note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** The EM row's realized weekly candle, carried alongside a condor so the UI can
 *  show what actually happened without a second round-trip. */
export interface EmCondorJoined extends EmCondorRow {
  wk_high?: number | null;
  wk_low?: number | null;
  wk_close?: number | null;
  em_result?: "hit" | "miss" | null;
}

const CONDOR_COLS = [
  "ticker", "week_label", "week_start", "ref_price", "em",
  "put_long", "put_short", "call_short", "call_long",
  "put_credit", "call_credit", "net_credit", "contracts", "multiplier",
  "settle_price", "intrinsic", "pnl", "result", "outcome",
  "breached_side", "touched_side", "result_source", "note",
] as const;

/**
 * Insert or update one weekly condor, keyed on (ticker, week_start).
 *
 * NULL incoming values never clobber an existing non-null value, so a seed pass
 * can fill strikes without wiping credits you typed by hand, and a later manual
 * edit only changes the fields it sends. Pass `clear` to force specific columns
 * back to NULL (used by "re-open" / re-score).
 */
export async function upsertEmCondor(r: EmCondorRow, clear: string[] = []): Promise<void> {
  const pool = await getDb();
  const values: unknown[] = [
    r.ticker.toUpperCase(), r.week_label, r.week_start,
    r.ref_price ?? null, r.em ?? null,
    r.put_long ?? null, r.put_short ?? null, r.call_short ?? null, r.call_long ?? null,
    r.put_credit ?? null, r.call_credit ?? null, r.net_credit ?? null,
    r.contracts ?? null, r.multiplier ?? null,
    r.settle_price ?? null, r.intrinsic ?? null, r.pnl ?? null,
    r.result ?? null, r.outcome ?? null,
    r.breached_side ?? null, r.touched_side ?? null, r.result_source ?? null, r.note ?? null,
  ];
  const placeholders = CONDOR_COLS.map((_, i) => `$${i + 1}`).join(",");
  const updates = CONDOR_COLS
    .filter((c) => c !== "ticker" && c !== "week_start")
    .map((c) => (clear.includes(c)
      ? `${c} = EXCLUDED.${c}`
      : `${c} = COALESCE(EXCLUDED.${c}, em_condors.${c})`))
    .join(",\n       ");

  await pool.query(
    `INSERT INTO em_condors (${CONDOR_COLS.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT(ticker, week_start) DO UPDATE SET
       ${updates},
       updated_at = CURRENT_TIMESTAMP`,
    values
  );
}

/** All condors (optionally one ticker / one week), newest week first, joined to
 *  the EM row's realized weekly candle. */
export async function getEmCondors(opts: { ticker?: string; week_start?: string } = {}): Promise<EmCondorJoined[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.ticker) { params.push(opts.ticker.toUpperCase()); where.push(`c.ticker = $${params.length}`); }
  if (opts.week_start) { params.push(opts.week_start); where.push(`c.week_start = $${params.length}`); }
  const sql = `
    SELECT c.*, e.h AS wk_high, e.l AS wk_low, e.c AS wk_close, e.result AS em_result
      FROM em_condors c
      LEFT JOIN em_tracker e
        ON e.ticker = c.ticker AND e.week_start = c.week_start
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY c.week_start DESC, c.ticker ASC`;
  const res = await pgQuery(sql, params);
  return res.rows as EmCondorJoined[];
}

/** Condors that have strikes + a weekly close available but no result yet —
 *  the candidates for auto-settlement. */
export async function getEmCondorsUnsettled(week_start?: string): Promise<EmCondorJoined[]> {
  const params: unknown[] = [];
  let weekClause = "";
  if (week_start) { params.push(week_start); weekClause = `AND c.week_start = $${params.length}`; }
  const res = await pgQuery(
    `SELECT c.*, e.h AS wk_high, e.l AS wk_low, e.c AS wk_close, e.result AS em_result
       FROM em_condors c
       LEFT JOIN em_tracker e
         ON e.ticker = c.ticker AND e.week_start = c.week_start
      WHERE c.result IS NULL
        AND c.put_short IS NOT NULL AND c.put_long IS NOT NULL
        AND c.call_short IS NOT NULL AND c.call_long IS NOT NULL
        AND e.c IS NOT NULL
        ${weekClause}
      ORDER BY c.week_start ASC, c.ticker ASC`,
    params
  );
  return res.rows as EmCondorJoined[];
}

/** EM rows for a week that can seed a condor (band present). */
export async function getEmBandsForWeek(week_start: string): Promise<EmTrackerRow[]> {
  return queryAll<EmTrackerRow>(
    `SELECT * FROM em_tracker
      WHERE week_start = ? AND (up IS NOT NULL OR (ref_close IS NOT NULL AND em IS NOT NULL))
      ORDER BY ticker ASC`,
    [week_start]
  );
}

/** Write a settlement onto one condor. */
export async function setEmCondorSettlement(
  id: number,
  s: {
    settle_price?: number | null;
    intrinsic?: number | null;
    pnl?: number | null;
    result: "win" | "loss";
    outcome?: string | null;
    breached_side?: string | null;
    touched_side?: string | null;
    source?: "auto" | "manual";
  }
): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `UPDATE em_condors SET
       settle_price  = COALESCE($2, settle_price),
       intrinsic     = COALESCE($3, intrinsic),
       pnl           = COALESCE($4, pnl),
       result        = $5,
       outcome       = COALESCE($6, outcome),
       breached_side = $7,
       touched_side  = COALESCE($8, touched_side),
       result_source = $9,
       updated_at    = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [id, s.settle_price ?? null, s.intrinsic ?? null, s.pnl ?? null, s.result,
     s.outcome ?? null, s.breached_side ?? null, s.touched_side ?? null, s.source ?? "auto"]
  );
}

/** Drop a condor's settlement so it can be re-scored. */
export async function reopenEmCondor(id: number): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `UPDATE em_condors SET
       result = NULL, outcome = NULL, pnl = NULL, intrinsic = NULL,
       settle_price = NULL, breached_side = NULL, result_source = NULL,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [id]
  );
}

/** Per-ticker condor record: win rate and realized dollars. */
export interface EmCondorSummary {
  ticker: string;
  wins: number;
  losses: number;
  settled: number;
  total: number;
  win_rate: number | null;   // 0..1
  pnl: number;               // realized dollars
  avg_pnl: number | null;    // per settled condor
  max_wins: number;          // expired fully worthless
  max_losses: number;        // blew all the way through a wing
}

export async function getEmCondorSummary(): Promise<EmCondorSummary[]> {
  const res = await pgQuery(`
    SELECT
      ticker,
      COUNT(*) FILTER (WHERE result = 'win')::int  AS wins,
      COUNT(*) FILTER (WHERE result = 'loss')::int AS losses,
      COUNT(*) FILTER (WHERE result IS NOT NULL)::int AS settled,
      COUNT(*)::int AS total,
      COALESCE(SUM(pnl) FILTER (WHERE result IS NOT NULL), 0) AS pnl,
      COUNT(*) FILTER (WHERE outcome = 'max_win')::int  AS max_wins,
      COUNT(*) FILTER (WHERE outcome = 'max_loss')::int AS max_losses
    FROM em_condors
    GROUP BY ticker
    ORDER BY ticker ASC
  `);
  return res.rows.map((r) => {
    const settled = Number(r.settled ?? 0);
    const pnl = Number(r.pnl ?? 0);
    return {
      ticker: r.ticker,
      wins: Number(r.wins ?? 0),
      losses: Number(r.losses ?? 0),
      settled,
      total: Number(r.total ?? 0),
      win_rate: settled > 0 ? Number(r.wins) / settled : null,
      pnl,
      avg_pnl: settled > 0 ? pnl / settled : null,
      max_wins: Number(r.max_wins ?? 0),
      max_losses: Number(r.max_losses ?? 0),
    };
  });
}

// ── Condor day-by-day marks ────────────────────────────────────────────────

export interface EmCondorMark {
  id?: number;
  condor_id: number;
  d: string;                    // ET session date, YYYY-MM-DD
  underlying?: number | null;
  under_high?: number | null;
  under_low?: number | null;
  put_long_px?: number | null;
  put_short_px?: number | null;
  call_short_px?: number | null;
  call_long_px?: number | null;
  mark?: number | null;         // debit to close, points
  open_pnl?: number | null;     // dollars
  pct_max?: number | null;      // open_pnl / max profit, 0..1
  cushion?: number | null;      // to nearer short strike
  legs_priced?: number | null;  // 0..4
  source?: string | null;
}

/** Upsert a batch of daily marks for one condor. Re-pricing a day overwrites it
 *  (a later run sees a settled close where the first saw an intraday snapshot). */
export async function upsertEmCondorMarks(condor_id: number, marks: EmCondorMark[]): Promise<number> {
  if (!marks.length) return 0;
  const pool = await getDb();
  let n = 0;
  for (const m of marks) {
    await pool.query(
      `INSERT INTO em_condor_marks
         (condor_id, d, underlying, under_high, under_low,
          put_long_px, put_short_px, call_short_px, call_long_px,
          mark, open_pnl, pct_max, cushion, legs_priced, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT(condor_id, d) DO UPDATE SET
         underlying    = COALESCE(EXCLUDED.underlying,    em_condor_marks.underlying),
         under_high    = COALESCE(EXCLUDED.under_high,    em_condor_marks.under_high),
         under_low     = COALESCE(EXCLUDED.under_low,     em_condor_marks.under_low),
         put_long_px   = COALESCE(EXCLUDED.put_long_px,   em_condor_marks.put_long_px),
         put_short_px  = COALESCE(EXCLUDED.put_short_px,  em_condor_marks.put_short_px),
         call_short_px = COALESCE(EXCLUDED.call_short_px, em_condor_marks.call_short_px),
         call_long_px  = COALESCE(EXCLUDED.call_long_px,  em_condor_marks.call_long_px),
         mark          = COALESCE(EXCLUDED.mark,          em_condor_marks.mark),
         open_pnl      = COALESCE(EXCLUDED.open_pnl,      em_condor_marks.open_pnl),
         pct_max       = COALESCE(EXCLUDED.pct_max,       em_condor_marks.pct_max),
         cushion       = COALESCE(EXCLUDED.cushion,       em_condor_marks.cushion),
         legs_priced   = GREATEST(EXCLUDED.legs_priced,   em_condor_marks.legs_priced),
         source        = COALESCE(EXCLUDED.source,        em_condor_marks.source),
         updated_at    = CURRENT_TIMESTAMP`,
      [
        condor_id, m.d, m.underlying ?? null, m.under_high ?? null, m.under_low ?? null,
        m.put_long_px ?? null, m.put_short_px ?? null, m.call_short_px ?? null, m.call_long_px ?? null,
        m.mark ?? null, m.open_pnl ?? null, m.pct_max ?? null, m.cushion ?? null,
        m.legs_priced ?? 0, m.source ?? "theta",
      ]
    );
    n++;
  }
  return n;
}

/** Marks for a whole week (or one condor), oldest session first. */
export async function getEmCondorMarks(opts: { week_start?: string; condor_id?: number } = {}): Promise<EmCondorMark[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.condor_id) { params.push(opts.condor_id); where.push(`m.condor_id = $${params.length}`); }
  if (opts.week_start) { params.push(opts.week_start); where.push(`c.week_start = $${params.length}`); }
  const res = await pgQuery(
    `SELECT m.* FROM em_condor_marks m
       JOIN em_condors c ON c.id = m.condor_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY m.condor_id ASC, m.d ASC`,
    params
  );
  // DATE comes back from pg as a Date pinned to LOCAL midnight. toISOString()
  // would roll it to the previous day on any positive-offset host, so read the
  // local parts instead of round-tripping through UTC.
  const ymd = (v: unknown): string => {
    if (typeof v === "string") return v.slice(0, 10);
    const dt = v instanceof Date ? v : new Date(String(v));
    if (Number.isNaN(dt.getTime())) return String(v).slice(0, 10);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  };
  return res.rows.map((r) => ({ ...r, d: ymd(r.d) })) as EmCondorMark[];
}

// ── Condor intraday ticks (hourly writer) ──────────────────────────────────

export interface EmCondorTick {
  id?: number;
  condor_id: number;
  ts: number;                   // epoch ms
  underlying?: number | null;
  put_long_px?: number | null;
  put_short_px?: number | null;
  call_short_px?: number | null;
  call_long_px?: number | null;
  mark?: number | null;
  open_pnl?: number | null;
  pct_max?: number | null;
  cushion?: number | null;
  legs_priced?: number | null;
  source?: string | null;
}

/** Append a batch of intraday ticks. Re-running the same minute is a no-op. */
export async function insertEmCondorTicks(ticks: EmCondorTick[]): Promise<number> {
  if (!ticks.length) return 0;
  const pool = await getDb();
  let n = 0;
  for (const t of ticks) {
    const res = await pool.query(
      `INSERT INTO em_condor_ticks
         (condor_id, ts, underlying, put_long_px, put_short_px, call_short_px, call_long_px,
          mark, open_pnl, pct_max, cushion, legs_priced, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(condor_id, ts) DO NOTHING`,
      [
        t.condor_id, Math.round(Number(t.ts)), t.underlying ?? null,
        t.put_long_px ?? null, t.put_short_px ?? null, t.call_short_px ?? null, t.call_long_px ?? null,
        t.mark ?? null, t.open_pnl ?? null, t.pct_max ?? null, t.cushion ?? null,
        t.legs_priced ?? 0, t.source ?? "theta",
      ]
    );
    n += res.rowCount ?? 0;
  }
  return n;
}

/** Ticks for a week (or one condor), oldest first. */
export async function getEmCondorTicks(opts: { week_start?: string; condor_id?: number } = {}): Promise<EmCondorTick[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.condor_id) { params.push(opts.condor_id); where.push(`t.condor_id = $${params.length}`); }
  if (opts.week_start) { params.push(opts.week_start); where.push(`c.week_start = $${params.length}`); }
  const res = await pgQuery(
    `SELECT t.* FROM em_condor_ticks t
       JOIN em_condors c ON c.id = t.condor_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY t.condor_id ASC, t.ts ASC`,
    params
  );
  // BIGINT arrives as a string from pg — coerce or every client-side compare lies.
  return res.rows.map((r) => ({ ...r, ts: Number(r.ts) })) as EmCondorTick[];
}

/** Drop ticks older than `days`. Called by the recorder after each EOD run so
 *  the table stays bounded without a separate maintenance job. */
export async function pruneEmCondorTicks(days = 120): Promise<number> {
  const pool = await getDb();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const res = await pool.query(`DELETE FROM em_condor_ticks WHERE ts < $1`, [cutoff]);
  return res.rowCount ?? 0;
}

export async function deleteEmCondor(id: number): Promise<void> {
  const pool = await getDb();
  await pool.query(`DELETE FROM em_condors WHERE id = $1`, [id]);
}

/** Wipe condors — all, or just one week. Returns rows removed. */
export async function clearEmCondors(week_start?: string): Promise<number> {
  const pool = await getDb();
  const res = week_start
    ? await pool.query(`DELETE FROM em_condors WHERE week_start = $1`, [week_start])
    : await pool.query(`DELETE FROM em_condors`);
  return res.rowCount ?? 0;
}

// ── Waitlist (launch email capture) ────────────────────────────────────────

export interface WaitlistRecord {
  id?: number;
  email: string;
  source?: string | null;
  referrer?: string | null;
  user_agent?: string | null;
  created_at?: string | null;
  unsubscribed_at?: string | null;
}

/** Insert an email; returns true if newly added, false if it already existed. */
export async function addWaitlistEmail(input: {
  email: string;
  source?: string | null;
  referrer?: string | null;
  user_agent?: string | null;
}): Promise<{ added: boolean }> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO waitlist (email, source, referrer, user_agent)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [input.email, input.source ?? "landing", input.referrer ?? null, input.user_agent ?? null]
  );
  return { added: (result.rowCount ?? 0) > 0 };
}

/** Mark an email as unsubscribed. Returns true if a matching row was updated. */
export async function unsubscribeWaitlistEmail(email: string): Promise<{ updated: boolean }> {
  const pool = await getDb();
  const result = await pool.query(
    `UPDATE waitlist SET unsubscribed_at = CURRENT_TIMESTAMP
     WHERE email = $1 AND unsubscribed_at IS NULL`,
    [email]
  );
  return { updated: (result.rowCount ?? 0) > 0 };
}

export async function listWaitlist(limit = 1000): Promise<WaitlistRecord[]> {
  return queryAll<WaitlistRecord>(
    "SELECT * FROM waitlist ORDER BY created_at DESC LIMIT ?",
    [limit]
  );
}

export async function countWaitlist(): Promise<number> {
  const row = await queryOne<{ n: number }>("SELECT COUNT(*)::int AS n FROM waitlist", []);
  return Number(row?.n ?? 0);
}

// ── Email broadcast history ────────────────────────────────────────────────

export interface EmailSendRecord {
  id: number;
  subject: string;
  audience: string;
  sent_count: number;
  failed_count: number;
  recipients: string[] | null;
  sent_by: string | null;
  created_at: string;
}

/** Record one broadcast send (summary). recipients is the list of addresses. */
export async function addEmailSend(input: {
  subject: string;
  audience: string;
  sent_count: number;
  failed_count: number;
  recipients: string[];
  sent_by?: string | null;
}): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO email_sends (subject, audience, sent_count, failed_count, recipients, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.subject,
      input.audience,
      input.sent_count,
      input.failed_count,
      JSON.stringify(input.recipients ?? []),
      input.sent_by ?? null,
    ]
  );
}

export async function listEmailSends(limit = 100): Promise<EmailSendRecord[]> {
  return queryAll<EmailSendRecord>(
    "SELECT * FROM email_sends ORDER BY created_at DESC LIMIT ?",
    [limit]
  );
}

// ── Email suppression list (global unsubscribes) ───────────────────────────

export interface UnsubscribeRecord {
  email: string;
  source: string;
  created_at: string;
}

/** Add an email to the global suppression list. Idempotent (upsert). */
export async function addUnsubscribe(
  email: string,
  source: "link" | "manual" = "link"
): Promise<{ added: boolean }> {
  const e = email.trim().toLowerCase();
  if (!e) return { added: false };
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO email_unsubscribes (email, source)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING
     RETURNING email`,
    [e, source]
  );
  return { added: (result.rowCount ?? 0) > 0 };
}

/** Remove an email from the suppression list (owner re-subscribes them). */
export async function removeUnsubscribe(email: string): Promise<{ removed: boolean }> {
  const e = email.trim().toLowerCase();
  if (!e) return { removed: false };
  const pool = await getDb();
  const result = await pool.query(
    `DELETE FROM email_unsubscribes WHERE email = $1`,
    [e]
  );
  return { removed: (result.rowCount ?? 0) > 0 };
}

export async function listUnsubscribes(limit = 5000): Promise<UnsubscribeRecord[]> {
  return queryAll<UnsubscribeRecord>(
    "SELECT email, source, created_at FROM email_unsubscribes ORDER BY created_at DESC LIMIT ?",
    [limit]
  );
}

// ── Single-use per-recipient promo codes (campaign-scoped) ─────────────────

export interface PromoCodeRecord {
  email: string;
  campaign: string;
  code: string;
  coupon_id: string;
  promotion_code_id: string;
  created_at: string;
}

/** Look up an already-minted code for this (email, campaign) pair, if any. */
export async function getPromoCode(
  email: string,
  campaign: string
): Promise<PromoCodeRecord | undefined> {
  return queryOne<PromoCodeRecord>(
    "SELECT * FROM promo_codes_single_use WHERE email = ? AND campaign = ?",
    [email.trim().toLowerCase(), campaign]
  );
}

/** Persist a newly minted code. Idempotent — a race just keeps whichever
 *  row won; caller always re-reads via getPromoCode after. */
export async function savePromoCode(input: {
  email: string;
  campaign: string;
  code: string;
  coupon_id: string;
  promotion_code_id: string;
}): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO promo_codes_single_use (email, campaign, code, coupon_id, promotion_code_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email, campaign) DO NOTHING`,
    [input.email.trim().toLowerCase(), input.campaign, input.code, input.coupon_id, input.promotion_code_id]
  );
}

export async function listPromoCodes(campaign: string, limit = 5000): Promise<PromoCodeRecord[]> {
  return queryAll<PromoCodeRecord>(
    "SELECT * FROM promo_codes_single_use WHERE campaign = ? ORDER BY created_at DESC LIMIT ?",
    [campaign, limit]
  );
}

// ── Sales expenses (owner Sales page) ───────────────────────────────────────

export interface SalesExpenseRecord {
  id: number;
  name: string;
  category: string;
  amount_cents: number;
  cadence: "monthly" | "yearly" | "once";
  created_at: string;
}

export async function listSalesExpenses(limit = 500): Promise<SalesExpenseRecord[]> {
  return queryAll<SalesExpenseRecord>(
    "SELECT id, name, category, amount_cents, cadence, created_at FROM sales_expenses ORDER BY created_at DESC LIMIT ?",
    [limit]
  );
}

export async function addSalesExpense(
  name: string,
  category: string,
  amountCents: number,
  cadence: "monthly" | "yearly" | "once"
): Promise<SalesExpenseRecord> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO sales_expenses (name, category, amount_cents, cadence)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, category, amount_cents, cadence, created_at`,
    [name, category, amountCents, cadence]
  );
  return result.rows[0];
}

export async function removeSalesExpense(id: number): Promise<{ removed: boolean }> {
  const pool = await getDb();
  const result = await pool.query(`DELETE FROM sales_expenses WHERE id = $1`, [id]);
  return { removed: (result.rowCount ?? 0) > 0 };
}

/** All suppressed emails as a lowercase Set — used to filter every broadcast. */
export async function getUnsubscribedSet(): Promise<Set<string>> {
  const rows = await queryAll<{ email: string }>(
    "SELECT email FROM email_unsubscribes",
    []
  );
  return new Set(rows.map((r) => r.email.trim().toLowerCase()));
}

// ── Customer feedback ──────────────────────────────────────────────────────

export interface FeedbackRecord {
  id: number;
  clerk_user_id: string | null;
  email: string | null;
  category: string;
  message: string;
  page: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}

const FEEDBACK_CATEGORIES = ["bug", "idea", "note", "other"] as const;

export async function addFeedback(input: {
  clerk_user_id?: string | null;
  email?: string | null;
  category?: string | null;
  message: string;
  page?: string | null;
}): Promise<FeedbackRecord | undefined> {
  const category = FEEDBACK_CATEGORIES.includes((input.category ?? "") as never)
    ? String(input.category)
    : "note";
  return queryOne<FeedbackRecord>(
    `INSERT INTO customer_feedback (clerk_user_id, email, category, message, page)
     VALUES (?, ?, ?, ?, ?)
     RETURNING *`,
    [input.clerk_user_id ?? null, input.email ?? null, category, input.message.trim(), input.page ?? null]
  );
}

export async function listFeedback(opts: { status?: string; limit?: number } = {}): Promise<FeedbackRecord[]> {
  const limit = opts.limit ?? 500;
  if (opts.status === "open" || opts.status === "resolved") {
    return queryAll<FeedbackRecord>(
      "SELECT * FROM customer_feedback WHERE status = ? ORDER BY created_at DESC LIMIT ?",
      [opts.status, limit]
    );
  }
  return queryAll<FeedbackRecord>(
    "SELECT * FROM customer_feedback ORDER BY created_at DESC LIMIT ?",
    [limit]
  );
}

export async function setFeedbackStatus(id: number, status: "open" | "resolved"): Promise<void> {
  await pgQuery(
    `UPDATE customer_feedback SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [status, id]
  );
}

// ── Far CB Watch — customer-added tickers ────────────────────────────────────

export interface FarCbCustomTicker {
  symbol: string;
  added_by_id: string | null;
  added_by_email: string | null;
  created_at: string | null;
  active: boolean;
}

const TICKER_RE = /^[A-Z]{1,6}$/;

export async function addFarCbTicker(input: {
  symbol: string;
  added_by_id?: string | null;
  added_by_email?: string | null;
}): Promise<{ ok: true; row: FarCbCustomTicker } | { ok: false; error: string }> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!TICKER_RE.test(symbol)) return { ok: false, error: "Enter a valid ticker (letters only, up to 6 characters)." };
  const row = await queryOne<FarCbCustomTicker>(
    `INSERT INTO far_cb_custom_tickers (symbol, added_by_id, added_by_email)
     VALUES (?, ?, ?)
     ON CONFLICT (symbol) DO UPDATE SET active = TRUE
     RETURNING *`,
    [symbol, input.added_by_id ?? null, input.added_by_email ?? null]
  );
  return row ? { ok: true, row } : { ok: false, error: "Save failed" };
}

export async function listFarCbTickers(limit = 200): Promise<FarCbCustomTicker[]> {
  return queryAll<FarCbCustomTicker>(
    "SELECT * FROM far_cb_custom_tickers WHERE active = TRUE ORDER BY created_at DESC LIMIT ?",
    [limit]
  );
}

/** No-op: pg writes are immediate, no file persistence needed */
export function persistDb(): void {}

// ── Query helpers ─────────────────────────────────────────────────────────────

// A query in flight when the socket dies (Postgres restart/recovery, idle-conn
// reaped, Render connection churn) rejects with one of these. The pool's
// 'error' handler only covers IDLE clients, so an in-flight drop still surfaces
// as a route 500. Retry once on a fresh client — the dead one is discarded and
// the pool hands back a new connection.
function isTransientConnError(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? "";
  const code = (err as { code?: string })?.code ?? "";
  return /Connection terminated|ECONNRESET|server closed the connection|terminating connection|Client has encountered a connection error/i.test(msg)
    || code === "ECONNRESET" || code === "57P01" || code === "08006" || code === "08003";
}

export async function pgQuery(sql: string, params: unknown[] = []) {
  const pool = await getDb();
  try {
    return await pool.query(sql, params);
  } catch (err) {
    if (!isTransientConnError(err)) throw err;
    console.warn("[db] transient connection error, retrying once:", (err as Error).message);
    await new Promise(r => setTimeout(r, 150));
    return await pool.query(sql, params);
  }
}

export async function queryAll<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  // Convert ? placeholders to $1, $2, ...
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  const result = await pgQuery(pgSql, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const rows = await queryAll<T>(sql, params);
  return rows[0];
}

// ── Common queries ────────────────────────────────────────────────────────────

export interface TradeRecord {
  id: number;
  timestamp: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  premium: number;
  expiration: string;
  strike: number;
  option_type: string;
}

export async function getRecentTrades(limit = 100): Promise<TradeRecord[]> {
  return queryAll<TradeRecord>(
    "SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}

export async function getTradesByDate(date: string): Promise<TradeRecord[]> {
  return queryAll<TradeRecord>(
    "SELECT * FROM trades WHERE date(timestamp) = ? ORDER BY timestamp DESC",
    [date]
  );
}

// ── Snapshots (for estimated moves) ────────────────────────────────────────

export interface Snapshot {
  id?: number;
  timestamp: number;
  date: string;
  time: string;
  period: string;
  tableHtml: string;
  expirations: string[];
  created_at?: string;
}

export async function saveSnapshot(snap: Snapshot): Promise<Snapshot> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO snapshots (timestamp, date, time, period, "tableHtml", expirations)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [snap.timestamp, snap.date, snap.time, snap.period, snap.tableHtml, JSON.stringify(snap.expirations || [])]
  );
  return snap;
}

export async function getSnapshots(period?: string): Promise<Snapshot[]> {
  let sql = `SELECT * FROM snapshots`;
  const params: unknown[] = [];
  if (period) {
    sql += " WHERE period = ?";
    params.push(period);
  }
  sql += " ORDER BY id DESC";
  const snapshots = await queryAll<any>(sql, params);
  return snapshots.map((s: any) => ({
    ...s,
    expirations: typeof s.expirations === 'string' ? JSON.parse(s.expirations) : s.expirations
  }));
}

export async function deleteSnapshot(id: number): Promise<boolean> {
  await queryAll("DELETE FROM snapshots WHERE id = ?", [id]);
  return true;
}

// ── Flow Calls ─────────────────────────────────────────────────────────────────

export interface FlowCallRecord {
  id?: number;
  ts: number;
  date: string;
  source: "tape" | "rest";
  symbol: string;
  underlying?: string;
  expiration?: string;
  strike: number;
  option_type: string;
  side: string;
  action: string;
  price: number;
  size: number;
  premium: number;
  is_otm: number;
}

export async function ensureFlowCallsTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function insertFlowCalls(calls: Omit<FlowCallRecord, "id">[]): Promise<void> {
  if (!calls.length) return;
  const pool = await getDb();
  for (const c of calls) {
    await pool.query(
      `INSERT INTO flow_calls (ts, date, source, symbol, underlying, expiration, strike, option_type, side, action, price, size, premium, is_otm)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [c.ts, c.date, c.source, c.symbol, c.underlying ?? null, c.expiration ?? null,
       c.strike, c.option_type, c.side, c.action, c.price, c.size, c.premium, c.is_otm]
    );
  }
}

export async function getFlowCalls(date: string, limit = 500): Promise<FlowCallRecord[]> {
  return queryAll<FlowCallRecord>(
    "SELECT * FROM flow_calls WHERE date = ? ORDER BY ts DESC LIMIT ?",
    [date, limit]
  );
}

// ── MVC Snapshots ─────────────────────────────────────────────────────────────

export interface MvcRecord {
  id?: number;
  timestamp: number;
  date: string;
  day: string;
  time: string;
  strikeOIVol: number | null;
  mvcValueOIVol: number;
  pctOI_Vol: number | null;
  volumeOIVol: number;
  totalNetGEX_OI: number;
  strikeVolOnly: number | null;
  mvcValueVolOnly: number;
  pctVol_Only: number | null;
  volumeVolOnly: number;
  totalNetGEX_Vol: number;
  spxPrice: number;
  esPrice: number;
  netDEXStrike: number | null;
  totalNetDEX_OI: number | null;
  totalNetDEX_Vol: number | null;
  totalAbsNetGEX: number;
  gexFlip: number | null;
  triggerType: string;
  expiration: string;
}

export async function ensureMvcTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function insertMvcSnapshot(r: Omit<MvcRecord, "id">): Promise<number> {
  const result = await pgQuery(
    `INSERT INTO mvc_snapshots (timestamp,date,day,time,"strikeOIVol","mvcValueOIVol","pctOI_Vol","volumeOIVol",
      "totalNetGEX_OI","strikeVolOnly","mvcValueVolOnly","pctVol_Only","volumeVolOnly","totalNetGEX_Vol",
      "spxPrice","esPrice","netDEXStrike","totalNetDEX_OI","totalNetDEX_Vol","totalAbsNetGEX","gexFlip","triggerType",expiration)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id`,
    [r.timestamp, r.date, r.day, r.time, r.strikeOIVol ?? null, r.mvcValueOIVol, r.pctOI_Vol ?? null,
     r.volumeOIVol, r.totalNetGEX_OI, r.strikeVolOnly ?? null, r.mvcValueVolOnly, r.pctVol_Only ?? null,
     r.volumeVolOnly, r.totalNetGEX_Vol, r.spxPrice, r.esPrice, r.netDEXStrike ?? null,
     r.totalNetDEX_OI ?? null, r.totalNetDEX_Vol ?? null, r.totalAbsNetGEX, r.gexFlip ?? null,
     r.triggerType, r.expiration]
  );
  return Number(result.rows[0]?.id ?? 0);
}

export async function getMvcSnapshots(date?: string, limit = 200, sinceMs?: number): Promise<MvcRecord[]> {
  if (date) {
    return queryAll<MvcRecord>(
      "SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp DESC LIMIT ?",
      [date, limit]
    );
  }
  // Windowed read (sinceMs) — used by the ES-candles chart, which only draws the
  // last few days of CB history and only needs 4 of this table's ~20 columns.
  // SELECT * over 1000 rows was ~87kB on the wire for ~10kB of usable data.
  if (sinceMs) {
    return queryAll<MvcRecord>(
      "SELECT timestamp, strikeOIVol, spxPrice, esPrice FROM mvc_snapshots WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?",
      [sinceMs, limit]
    );
  }
  return queryAll<MvcRecord>(
    "SELECT * FROM mvc_snapshots ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}

// ── Confidence calibration log ─────────────────────────────────────────────────

export interface ConfidenceLogRecord {
  id?: number;
  date: string;
  level: number;
  regime: string | null;
  reach: number; pivot: number; chop: number; break: number; netWallBias: number;
  scored_at: number;
  touched: number | null;
  actual_outcome: string | null; // 'pivot' | 'chop' | 'break' | 'miss'
  held: number | null;
  broke: number | null;
  graded_at: number | null;
}

/** Upsert one day's scored + graded calibration row (one row per date). */
export async function upsertConfidenceLog(r: ConfidenceLogRecord): Promise<void> {
  await pgQuery(
    `INSERT INTO confidence_log
       (date, level, regime, reach, pivot, chop, "break", "netWallBias",
        scored_at, touched, actual_outcome, held, broke, graded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (date) DO UPDATE SET
       level = EXCLUDED.level, regime = EXCLUDED.regime,
       reach = EXCLUDED.reach, pivot = EXCLUDED.pivot, chop = EXCLUDED.chop,
       "break" = EXCLUDED."break", "netWallBias" = EXCLUDED."netWallBias",
       scored_at = EXCLUDED.scored_at, touched = EXCLUDED.touched,
       actual_outcome = EXCLUDED.actual_outcome, held = EXCLUDED.held,
       broke = EXCLUDED.broke, graded_at = EXCLUDED.graded_at`,
    [r.date, r.level, r.regime, r.reach, r.pivot, r.chop, r.break, r.netWallBias,
     r.scored_at, r.touched, r.actual_outcome, r.held, r.broke, r.graded_at]
  );
}

/** All graded calibration rows (oldest → newest). */
export async function getGradedConfidenceLog(): Promise<ConfidenceLogRecord[]> {
  return queryAll<ConfidenceLogRecord>(
    `SELECT * FROM confidence_log WHERE graded_at IS NOT NULL ORDER BY date ASC`
  );
}

// ── Premium Flow ──────────────────────────────────────────────────────────────

export interface PremiumFlowRecord {
  id?: number;
  timestamp: number;
  date: string;
  time: string;
  callPremium: number;
  putPremium: number;
  netPremium: number;
  spxPrice: number;
}

export async function ensurePremiumFlowTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function insertPremiumFlow(r: Omit<PremiumFlowRecord, "id">): Promise<void> {
  await pgQuery(
    `INSERT INTO premium_flow (timestamp,date,time,"callPremium","putPremium","netPremium","spxPrice")
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [r.timestamp, r.date, r.time, r.callPremium, r.putPremium, r.netPremium, r.spxPrice]
  );
}

export async function getPremiumFlow(date?: string, limit = 500): Promise<PremiumFlowRecord[]> {
  if (date) {
    return queryAll<PremiumFlowRecord>(
      "SELECT * FROM premium_flow WHERE date = ? ORDER BY timestamp ASC LIMIT ?",
      [date, limit]
    );
  }
  return queryAll<PremiumFlowRecord>(
    "SELECT * FROM premium_flow ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}

// ── Greeks Time Series ────────────────────────────────────────────────────────

export interface GreeksTsRecord {
  id?: number;
  timestamp: number;
  date: string;
  time: string;
  ticker: string;
  price: number;
  gexRaw: number;
  dexRaw: number;
  chexRaw: number;
  vexRaw: number;
  gex: number;
  dex: number;
  chex: number;
  vex: number;
  buyScore: number;
  sellScore: number;
}

export async function ensureGreeksTsTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function insertGreeksTs(r: Omit<GreeksTsRecord, "id">): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO greeks_ts (timestamp,date,time,ticker,price,"gexRaw","dexRaw","chexRaw","vexRaw",gex,dex,chex,vex,"buyScore","sellScore")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [r.timestamp, r.date, r.time, r.ticker, r.price,
     r.gexRaw, r.dexRaw, r.chexRaw, r.vexRaw,
     r.gex, r.dex, r.chex, r.vex, r.buyScore, r.sellScore]
  );
}

export async function getGreeksTs(date?: string, limit = 1000): Promise<GreeksTsRecord[]> {
  if (date) {
    return queryAll<GreeksTsRecord>(
      "SELECT * FROM greeks_ts WHERE date = ? ORDER BY timestamp ASC LIMIT ?",
      [date, limit]
    );
  }
  return queryAll<GreeksTsRecord>(
    "SELECT * FROM greeks_ts ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}

// —— Playbook Feed ————————————————————————————————————————————————————————————————

export interface PlaybookFeedRecord {
  id?: number;
  timestamp: number;
  date: string;
  time: string;
  text: string;
  color?: string | null;
  source?: string | null;
  expiry?: string | null;
  regime_key?: string | null;
  spot?: number | null;
  gex?: number | null;
  dex?: number | null;
  chex?: number | null;
  vex?: number | null;
}

export async function insertPlaybookFeed(r: Omit<PlaybookFeedRecord, "id">): Promise<number> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO playbook_feed (timestamp,date,time,text,color,source,expiry,regime_key,spot,gex,dex,chex,vex)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      r.timestamp,
      r.date,
      r.time,
      r.text,
      r.color ?? null,
      r.source ?? "insights-exposure",
      r.expiry ?? null,
      r.regime_key ?? null,
      r.spot ?? null,
      r.gex ?? null,
      r.dex ?? null,
      r.chex ?? null,
      r.vex ?? null,
    ]
  );
  return Number(result.rows[0]?.id ?? 0);
}

export async function getPlaybookFeed(date?: string, limit = 500): Promise<PlaybookFeedRecord[]> {
  if (date) {
    return queryAll<PlaybookFeedRecord>(
      "SELECT * FROM playbook_feed WHERE date = ? ORDER BY timestamp DESC LIMIT ?",
      [date, limit]
    );
  }
  return queryAll<PlaybookFeedRecord>(
    "SELECT * FROM playbook_feed ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}

// ── Page load status ─────────────────────────────────────────────────────────

export interface PageLoadStatusRecord {
  id?: number;
  page_key: string;
  page_label?: string | null;
  path?: string | null;
  is_loaded: boolean;
  last_loaded_at?: string | null;
  last_unloaded_at?: string | null;
  total_loads?: number | null;
  updated_at?: string | null;
}

export async function upsertPageLoadStatus(r: Omit<PageLoadStatusRecord, "id" | "updated_at">): Promise<void> {
  const pool = await getDb();
  await pool.query(
    // total_loads counts real page loads only: the seed row starts at 1 when
    // is_loaded, and each subsequent load (is_loaded = true) bumps it by 1. The
    // unload beacon (is_loaded = false) leaves the counter untouched so a single
    // visit isn't double-counted.
    `INSERT INTO page_load_status (page_key, page_label, path, is_loaded, last_loaded_at, last_unloaded_at, total_loads)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $4 THEN 1 ELSE 0 END)
     ON CONFLICT (page_key) DO UPDATE
       SET page_label = EXCLUDED.page_label,
           path = EXCLUDED.path,
           is_loaded = EXCLUDED.is_loaded,
           last_loaded_at = COALESCE(EXCLUDED.last_loaded_at, page_load_status.last_loaded_at),
           last_unloaded_at = COALESCE(EXCLUDED.last_unloaded_at, page_load_status.last_unloaded_at),
           total_loads = page_load_status.total_loads + (CASE WHEN EXCLUDED.is_loaded THEN 1 ELSE 0 END),
           updated_at = CURRENT_TIMESTAMP`,
    [
      r.page_key,
      r.page_label ?? null,
      r.path ?? null,
      r.is_loaded,
      r.last_loaded_at ?? null,
      r.last_unloaded_at ?? null,
    ]
  );
}

export async function getPageLoadStatus(limit = 200): Promise<PageLoadStatusRecord[]> {
  return queryAll<PageLoadStatusRecord>(
    "SELECT * FROM page_load_status ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT ?",
    [limit]
  );
}

// ── Page visits (full history w/ IP) ─────────────────────────────────────────

export interface PageVisitRecord {
  id?: number;
  page_key?: string | null;
  page_label?: string | null;
  path?: string | null;
  user_id?: string | null;
  ip?: string | null;
  /** ISO 3166-1 alpha-2, from Cloudflare's cf-ipcountry. Null pre-transform. */
  country?: string | null;
  region?: string | null;
  city?: string | null;
  /** City-centroid coords from Cloudflare's IP database — not device GPS. */
  latitude?: number | null;
  longitude?: number | null;

  // ── Acquisition (entry rows only — see the schema comment above) ───────────
  /** True on the first beacon of a browser session. Attribution below is only
   *  meaningful on these rows; everywhere else it is NULL by design. */
  is_entry?: boolean | null;
  /** Full document.referrer of the inbound visit. NULL for direct + self-referrals. */
  referrer?: string | null;
  /** www-stripped hostname of `referrer` — the column you GROUP BY. */
  referrer_host?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  /** direct | search | social | paid | email | referral | internal */
  channel?: string | null;

  // ── Device (every row) ─────────────────────────────────────────────────────
  browser?: string | null;
  os?: string | null;
  /** mobile | tablet | desktop | bot */
  device_type?: string | null;
  is_bot?: boolean | null;

  created_at?: string | null;
}

// Keep the visit log bounded so it can't grow without limit.
//
// NOTE: this is a HARD cap on how far back any acquisition report can look —
// once you're past PAGE_VISITS_KEEP visits, the oldest entry rows are deleted
// and that traffic is gone. Raise it via the env var rather than editing code;
// the rows are narrow (a few hundred bytes), so 100k costs tens of MB.
const PAGE_VISITS_KEEP = Math.max(1000, Number(process.env.PAGE_VISITS_KEEP) || 5000);

export async function insertPageVisit(
  r: Pick<
    PageVisitRecord,
    | "page_key" | "page_label" | "path" | "user_id" | "ip"
    | "country" | "region" | "city" | "latitude" | "longitude"
    | "is_entry" | "referrer" | "referrer_host"
    | "utm_source" | "utm_medium" | "utm_campaign" | "utm_term" | "utm_content"
    | "channel" | "browser" | "os" | "device_type" | "is_bot"
  >
): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO page_visits (
       page_key, page_label, path, user_id, ip, country, region, city, latitude, longitude,
       is_entry, referrer, referrer_host,
       utm_source, utm_medium, utm_campaign, utm_term, utm_content,
       channel, browser, os, device_type, is_bot
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
    [
      r.page_key ?? null, r.page_label ?? null, r.path ?? null, r.user_id ?? null, r.ip ?? null,
      r.country ?? null, r.region ?? null, r.city ?? null, r.latitude ?? null, r.longitude ?? null,
      r.is_entry ?? false, r.referrer ?? null, r.referrer_host ?? null,
      r.utm_source ?? null, r.utm_medium ?? null, r.utm_campaign ?? null,
      r.utm_term ?? null, r.utm_content ?? null,
      r.channel ?? null, r.browser ?? null, r.os ?? null, r.device_type ?? null, r.is_bot ?? false,
    ]
  );
  // Opportunistic prune: drop anything older than the newest PAGE_VISITS_KEEP rows.
  await pool.query(
    `DELETE FROM page_visits
     WHERE id < (
       SELECT MIN(id) FROM (
         SELECT id FROM page_visits ORDER BY id DESC LIMIT $1
       ) keep
     )`,
    [PAGE_VISITS_KEEP]
  );
}

export async function getRecentPageVisits(limit = 100): Promise<PageVisitRecord[]> {
  return queryAll<PageVisitRecord>(
    "SELECT * FROM page_visits ORDER BY id DESC LIMIT ?",
    [limit]
  );
}

// Per-user engagement rollup from page_visits. total_loads = every logged load;
// distinct_pages = unique paths; last_seen/first_seen bracket their activity.
// approx_active_sec is ESTIMATED: consecutive visits are bucketed into sessions
// (a gap > 30 min starts a new session), and each session's span (last−first
// visit) is summed. It undercounts the final page of every session (no exit
// event is recorded) and can't distinguish an idle tab from active use — it's a
// lower-bound engagement proxy, not a precise dwell time.
export interface CustomerActivityRow {
  user_id: string;
  total_loads: number;
  distinct_pages: number;
  session_count: number;
  approx_active_sec: number;
  last_seen: string;
  first_seen: string;
  top_path: string | null;
}

export async function getCustomerActivity(): Promise<CustomerActivityRow[]> {
  const pool = await getDb();
  const res = await pool.query(`
    WITH gaps AS (
      SELECT user_id, path, created_at,
             EXTRACT(EPOCH FROM (created_at
               - LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at))) AS gap_sec
      FROM page_visits
      WHERE user_id IS NOT NULL
    ),
    sessioned AS (
      SELECT user_id, path, created_at,
             SUM(CASE WHEN gap_sec IS NULL OR gap_sec > 1800 THEN 1 ELSE 0 END)
               OVER (PARTITION BY user_id ORDER BY created_at) AS session_id
      FROM gaps
    ),
    spans AS (
      SELECT user_id, session_id,
             EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) AS span_sec
      FROM sessioned GROUP BY user_id, session_id
    ),
    per_user_time AS (
      SELECT user_id, COUNT(*) AS session_count, COALESCE(SUM(span_sec), 0) AS approx_active_sec
      FROM spans GROUP BY user_id
    ),
    per_user_counts AS (
      SELECT user_id,
             COUNT(*) AS total_loads,
             COUNT(DISTINCT COALESCE(path, page_key)) AS distinct_pages,
             MAX(created_at) AS last_seen,
             MIN(created_at) AS first_seen
      FROM page_visits WHERE user_id IS NOT NULL GROUP BY user_id
    ),
    top AS (
      SELECT DISTINCT ON (user_id) user_id, COALESCE(path, page_key) AS top_path
      FROM page_visits WHERE user_id IS NOT NULL
      GROUP BY user_id, COALESCE(path, page_key)
      ORDER BY user_id, COUNT(*) DESC
    )
    SELECT c.user_id, c.total_loads::int, c.distinct_pages::int,
           t.session_count::int, t.approx_active_sec::float8,
           c.last_seen, c.first_seen, tp.top_path
    FROM per_user_counts c
    JOIN per_user_time t USING (user_id)
    LEFT JOIN top tp USING (user_id)
    ORDER BY c.last_seen DESC
  `);
  return res.rows as CustomerActivityRow[];
}

// ── Ticker events (click / render tracking) ────────────────────────────────────

export interface TickerEventRecord {
  id?: number;
  ticker?: string | null;
  event?: string | null;   // 'click' | 'render'
  source?: string | null;  // e.g. 'scanner'
  user_id?: string | null;
  created_at?: string | null;
}

export interface TickerEventCount {
  ticker: string;
  clicks: number;
  renders: number;
}

// Keep the ticker-event log bounded (renders are high-volume).
const TICKER_EVENTS_KEEP = 50000;

export async function insertTickerEvent(
  r: Pick<TickerEventRecord, "ticker" | "event" | "source" | "user_id">
): Promise<void> {
  if (!r.ticker || !r.event) return;
  const pool = await getDb();
  await pool.query(
    `INSERT INTO ticker_events (ticker, event, source, user_id)
     VALUES ($1, $2, $3, $4)`,
    [String(r.ticker).toUpperCase(), r.event, r.source ?? null, r.user_id ?? null]
  );
  // Opportunistic prune: keep only the newest TICKER_EVENTS_KEEP rows.
  await pool.query(
    `DELETE FROM ticker_events
     WHERE id < (
       SELECT MIN(id) FROM (
         SELECT id FROM ticker_events ORDER BY id DESC LIMIT $1
       ) keep
     )`,
    [TICKER_EVENTS_KEEP]
  );
}

// Aggregated click/render counts per ticker. Optional sinceDays window (e.g. 7)
// and optional source filter (e.g. "em") to scope the ranking to one surface.
export async function getTickerEventCounts(sinceDays?: number, source?: string): Promise<TickerEventCount[]> {
  const pool = await getDb();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (sinceDays && sinceDays > 0) {
    conds.push(`created_at >= NOW() - INTERVAL '${Math.floor(sinceDays)} days'`);
  }
  if (source) {
    params.push(source);
    conds.push(`source = $${params.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT ticker,
            COUNT(*) FILTER (WHERE event = 'click')  AS clicks,
            COUNT(*) FILTER (WHERE event = 'render') AS renders
     FROM ticker_events
     ${where}
     GROUP BY ticker
     ORDER BY clicks DESC, renders DESC`,
    params
  );
  return rows.map((r: { ticker: string; clicks: string; renders: string }) => ({
    ticker: r.ticker,
    clicks: Number(r.clicks),
    renders: Number(r.renders),
  }));
}

// ── ES Candles ────────────────────────────────────────────────────────────────

export interface EsCandleDbRecord {
  id?: number;
  timestamp: number;
  date: string;
  slotKey: string;
  time: string;
  symbol: string;
  intervalMinutes: number;
  source: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  avgVolume: number;
}

export async function ensureEsCandlesTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function upsertEsCandle(r: Omit<EsCandleDbRecord, "id">): Promise<void> {
  const pool = await getDb();
  await pool.query(
    // Conflict target MUST include "intervalMinutes" — on slotKey alone a 1-minute
    // bar and a 5-minute bar at the same clock time are the same row, and this
    // upsert would overwrite the 5m close+volume with 1m values. See
    // scripts/migrate-es-candles-composite-key.sql.
    `INSERT INTO es_candles (timestamp,date,"slotKey",time,symbol,"intervalMinutes",source,open,high,low,close,volume,"avgVolume")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT("slotKey","intervalMinutes") DO UPDATE SET
       timestamp=EXCLUDED.timestamp, high=GREATEST(es_candles.high,EXCLUDED.high), low=LEAST(es_candles.low,EXCLUDED.low),
       close=EXCLUDED.close, volume=EXCLUDED.volume, "avgVolume"=EXCLUDED."avgVolume"`,
    [r.timestamp, r.date, r.slotKey, r.time ?? "", r.symbol ?? "/ES", r.intervalMinutes ?? 5,
     r.source ?? "dxlink", r.open, r.high, r.low, r.close, r.volume, r.avgVolume ?? 0]
  );
}

/**
 * Read ES candles at ONE aggregation.
 *
 * `intervalMinutes` is REQUIRED in every query and defaults to 5. This table now
 * holds mixed intervals, and an unfiltered `SELECT *` returns 1m and 5m bars
 * interleaved in a single ascending-by-timestamp array — which looks like
 * plausible data and is not. Every existing caller (chart, IB stats, signals
 * engine, backtests) wants 5m, hence the default: their behaviour is unchanged.
 */
export async function getEsCandles(
  date?: string, daysBack?: number, limit = 2000, intervalMinutes = 5
): Promise<EsCandleDbRecord[]> {
  if (date) {
    return queryAll<EsCandleDbRecord>(
      `SELECT * FROM es_candles WHERE date = ? AND "intervalMinutes" = ? ORDER BY timestamp ASC LIMIT ?`,
      [date, intervalMinutes, limit]
    );
  }
  if (daysBack) {
    const cutoff = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
    return queryAll<EsCandleDbRecord>(
      `SELECT * FROM es_candles WHERE date >= ? AND "intervalMinutes" = ? ORDER BY timestamp ASC LIMIT ?`,
      [cutoff, intervalMinutes, limit]
    );
  }
  return queryAll<EsCandleDbRecord>(
    `SELECT * FROM es_candles WHERE "intervalMinutes" = ? ORDER BY timestamp DESC LIMIT ?`,
    [intervalMinutes, limit]
  );
}

// ── NQ candles (5m NASDAQ futures — parallel to es_candles, own table so ES
//    stays untouched and the unique-slotKey conflict target doesn't collide) ────
//
// ⚠ LATENT: this table still keys on slotKey ALONE, which is the exact defect
//   that corrupted es_candles (slotKey has no interval in it, so a 1m and a 5m
//   bar at the same clock time are one row and the upsert below silently
//   overwrites close+volume). It is not a live bug ONLY because nothing writes
//   1m NQ bars today. Before adding any NQ interval other than 5m, migrate this
//   to UNIQUE("slotKey","intervalMinutes") — see
//   scripts/migrate-es-candles-composite-key.sql for the pattern.

export async function upsertNqCandle(r: Omit<EsCandleDbRecord, "id">): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO nq_candles (timestamp,date,"slotKey",time,symbol,"intervalMinutes",source,open,high,low,close,volume,"avgVolume")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT("slotKey") DO UPDATE SET
       timestamp=EXCLUDED.timestamp, high=GREATEST(nq_candles.high,EXCLUDED.high), low=LEAST(nq_candles.low,EXCLUDED.low),
       close=EXCLUDED.close, volume=EXCLUDED.volume, "avgVolume"=EXCLUDED."avgVolume"`,
    [r.timestamp, r.date, r.slotKey, r.time ?? "", r.symbol ?? "/NQ", r.intervalMinutes ?? 5,
     r.source ?? "dxlink", r.open, r.high, r.low, r.close, r.volume, r.avgVolume ?? 0]
  );
}

export async function getNqCandles(date?: string, daysBack?: number, limit = 2000): Promise<EsCandleDbRecord[]> {
  if (date) {
    return queryAll<EsCandleDbRecord>(
      `SELECT * FROM nq_candles WHERE date = ? ORDER BY timestamp ASC LIMIT ?`,
      [date, limit]
    );
  }
  if (daysBack) {
    const cutoff = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
    return queryAll<EsCandleDbRecord>(
      `SELECT * FROM nq_candles WHERE date >= ? ORDER BY timestamp ASC LIMIT ?`,
      [cutoff, limit]
    );
  }
  return queryAll<EsCandleDbRecord>(
    `SELECT * FROM nq_candles ORDER BY timestamp DESC LIMIT ?`,
    [limit]
  );
}

// ── IB Daily Results (EOD 16:30 ET scoreboard — ib_daily_results) ─────────────

export interface IbDailyResultRow {
  id?: number;
  date: string;
  symbol: string;                 // 'ES' | 'NQ'
  ib_high: number | null; ib_low: number | null; ib_mid: number | null; ib_width: number | null;
  width_bucket: string | null;    // 'narrow' | 'normal' | 'wide'
  bias: string | null;            // 'H' | 'L'
  first_formed: string | null;    // 'H' | 'L'
  close_zone: string | null;      // 'top25' | 'mid50' | 'bot25'
  open_type: string | null;       // 'OAR-H' | 'OAR-L' | 'HIR' | 'LIR'
  orb_dir: string | null; fvg: string | null;
  break_side: string | null; break_min: number | null;
  failed: number | null; retest: number | null; retest_cont: number | null; vol_surge: number | null;
  single_break: number | null; both_broke: number | null; neither_broke: number | null;
  contained_at2: number | null; contained_broke_late: number | null;
  ext_05: number | null; ext_10: number | null; ext_15: number | null; ext_20: number | null;
  first_touch_side: string | null; first_touch_min: number | null;
  day_high: number | null; day_low: number | null; day_close: number | null;
  rules: unknown;                 // JSONB — IbRuleResult[]
  computed_at: number;
}

export async function upsertIbDailyResult(r: Omit<IbDailyResultRow, "id">): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO ib_daily_results (
       date, symbol, ib_high, ib_low, ib_mid, ib_width, width_bucket,
       bias, first_formed, close_zone, open_type, orb_dir, fvg,
       break_side, break_min, failed, retest, retest_cont, vol_surge,
       single_break, both_broke, neither_broke, contained_at2, contained_broke_late,
       ext_05, ext_10, ext_15, ext_20, first_touch_side, first_touch_min,
       day_high, day_low, day_close, rules, computed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
               $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
     ON CONFLICT (date, symbol) DO UPDATE SET
       ib_high=EXCLUDED.ib_high, ib_low=EXCLUDED.ib_low, ib_mid=EXCLUDED.ib_mid, ib_width=EXCLUDED.ib_width,
       width_bucket=EXCLUDED.width_bucket, bias=EXCLUDED.bias, first_formed=EXCLUDED.first_formed,
       close_zone=EXCLUDED.close_zone, open_type=EXCLUDED.open_type, orb_dir=EXCLUDED.orb_dir, fvg=EXCLUDED.fvg,
       break_side=EXCLUDED.break_side, break_min=EXCLUDED.break_min, failed=EXCLUDED.failed,
       retest=EXCLUDED.retest, retest_cont=EXCLUDED.retest_cont, vol_surge=EXCLUDED.vol_surge,
       single_break=EXCLUDED.single_break, both_broke=EXCLUDED.both_broke, neither_broke=EXCLUDED.neither_broke,
       contained_at2=EXCLUDED.contained_at2, contained_broke_late=EXCLUDED.contained_broke_late,
       ext_05=EXCLUDED.ext_05, ext_10=EXCLUDED.ext_10, ext_15=EXCLUDED.ext_15, ext_20=EXCLUDED.ext_20,
       first_touch_side=EXCLUDED.first_touch_side, first_touch_min=EXCLUDED.first_touch_min,
       day_high=EXCLUDED.day_high, day_low=EXCLUDED.day_low, day_close=EXCLUDED.day_close,
       rules=EXCLUDED.rules, computed_at=EXCLUDED.computed_at`,
    [r.date, r.symbol, r.ib_high, r.ib_low, r.ib_mid, r.ib_width, r.width_bucket,
     r.bias, r.first_formed, r.close_zone, r.open_type, r.orb_dir, r.fvg,
     r.break_side, r.break_min, r.failed, r.retest, r.retest_cont, r.vol_surge,
     r.single_break, r.both_broke, r.neither_broke, r.contained_at2, r.contained_broke_late,
     r.ext_05, r.ext_10, r.ext_15, r.ext_20, r.first_touch_side, r.first_touch_min,
     r.day_high, r.day_low, r.day_close, JSON.stringify(r.rules ?? []), r.computed_at]
  );
}

export async function getIbDailyResults(symbol: string, limit = 90): Promise<IbDailyResultRow[]> {
  return queryAll<IbDailyResultRow>(
    `SELECT * FROM ib_daily_results WHERE symbol = ? ORDER BY date DESC LIMIT ?`,
    [symbol, limit]
  );
}

/** Per-session RTH day range + IB width for the sessions BEFORE `beforeDate` —
 *  feeds the trailing ATR14 / avgIB20 width-bucket classification. String
 *  time compare is safe: `time` is zero-padded ET 'HH:MM'. */
export async function getIbTrailingStats(
  table: "es_candles" | "nq_candles",
  beforeDate: string,
  daysBack = 70
): Promise<{ date: string; dayRange: number; ibWidth: number }[]> {
  const tbl = table === "nq_candles" ? "nq_candles" : "es_candles";
  const cutoff = new Date(Date.parse(`${beforeDate}T12:00:00Z`) - daysBack * 86400_000)
    .toISOString().slice(0, 10);
  const rows = await queryAll<{ date: string; rth_high: number; rth_low: number; ib_high: number; ib_low: number }>(
    `SELECT date,
            MAX(high) FILTER (WHERE time >= '09:30' AND time < '16:00') AS rth_high,
            MIN(low)  FILTER (WHERE time >= '09:30' AND time < '16:00') AS rth_low,
            MAX(high) FILTER (WHERE time >= '09:30' AND time < '10:30') AS ib_high,
            MIN(low)  FILTER (WHERE time >= '09:30' AND time < '10:30') AS ib_low
       FROM ${tbl}
      WHERE date >= ? AND date < ?
      GROUP BY date
     HAVING COUNT(*) FILTER (WHERE time >= '09:30' AND time < '10:30') > 0
      ORDER BY date ASC`,
    [cutoff, beforeDate]
  );
  return rows
    .map((r) => ({
      date: r.date,
      dayRange: Number(r.rth_high) - Number(r.rth_low),
      ibWidth: Number(r.ib_high) - Number(r.ib_low),
    }))
    .filter((r) => Number.isFinite(r.dayRange) && Number.isFinite(r.ibWidth) && r.ibWidth > 0);
}

// ── IB Levels (locked Initial Balance per day) ──────────────────────────────────

export interface IbLevelsRecord {
  id?: number;
  date: string;
  symbol?: string;
  timestamp: number;
  locked: number;          // 1 once frozen at/after 10:30 ET — never overwritten after
  high: number;
  low: number;
  mid: number;
  range: number;
  rangePct: number;
  openPrice: number;
  lowFirst: number | null; // 1 = low formed first, 0 = high first, null = tie/unknown
  barCount: number;
}

/**
 * Upsert the day's IB levels. Once a row is `locked=1`, this is a no-op for that
 * date (the IB is frozen post-10:30 and must never be recomputed/overwritten).
 * While unlocked (still forming), the row is updated freely.
 */
export async function upsertIbLevels(r: Omit<IbLevelsRecord, "id">): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO ib_levels (date,symbol,timestamp,locked,high,low,mid,range,"rangePct","openPrice","lowFirst","barCount")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT(date) DO UPDATE SET
       symbol=EXCLUDED.symbol, timestamp=EXCLUDED.timestamp, locked=EXCLUDED.locked,
       high=EXCLUDED.high, low=EXCLUDED.low, mid=EXCLUDED.mid, range=EXCLUDED.range,
       "rangePct"=EXCLUDED."rangePct", "openPrice"=EXCLUDED."openPrice",
       "lowFirst"=EXCLUDED."lowFirst", "barCount"=EXCLUDED."barCount"
     WHERE ib_levels.locked = 0`,
    [r.date, r.symbol ?? "/ES", r.timestamp, r.locked ?? 0, r.high, r.low, r.mid,
     r.range, r.rangePct, r.openPrice, r.lowFirst, r.barCount]
  );
}

export async function getIbLevels(date: string): Promise<IbLevelsRecord | null> {
  const rows = await queryAll<IbLevelsRecord>(
    `SELECT * FROM ib_levels WHERE date = ? LIMIT 1`,
    [date]
  );
  return rows[0] ?? null;
}

// ── Bzila Live Snapshots ──────────────────────────────────────────────────────

export interface BzilaSnapshotRecord {
  id?: number;
  timestamp: number;
  date: string;
  time: string;
  ticker: string;
  orders: string;
  stats: string;
}

export async function ensureBzilaSnapshotsTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function insertBzilaSnapshot(r: { timestamp: number; date: string; time: string; ticker: string; session?: string; orders: unknown[]; stats: unknown }): Promise<number> {
  const result = await pgQuery(
    `INSERT INTO bzila_snapshots (timestamp,date,time,ticker,session,orders,stats) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [r.timestamp, r.date, r.time, r.ticker, r.session ?? "rth",
     JSON.stringify(r.orders ?? []), JSON.stringify(r.stats ?? {})]
  );
  return Number(result.rows[0]?.id ?? 0);
}

export async function getLatestBzilaSnapshot(date?: string, session?: string): Promise<{ stats: unknown; orders: unknown[] } | null> {
  let rows: BzilaSnapshotRecord[];
  if (date && session) {
    rows = await queryAll<BzilaSnapshotRecord>(
      "SELECT * FROM bzila_snapshots WHERE date = ? AND session = ? ORDER BY timestamp DESC LIMIT 1",
      [date, session]
    );
    if (!rows.length && session === "ext") {
      rows = await queryAll<BzilaSnapshotRecord>(
        "SELECT * FROM bzila_snapshots WHERE session = 'ext' ORDER BY timestamp DESC LIMIT 1"
      );
    }
  } else if (date) {
    rows = await queryAll<BzilaSnapshotRecord>(
      "SELECT * FROM bzila_snapshots WHERE date = ? ORDER BY timestamp DESC LIMIT 1",
      [date]
    );
  } else {
    rows = await queryAll<BzilaSnapshotRecord>(
      "SELECT * FROM bzila_snapshots ORDER BY timestamp DESC LIMIT 1"
    );
  }
  if (!rows.length) return null;
  const r = rows[0];
  return {
    stats: typeof r.stats === "string" ? JSON.parse(r.stats) : r.stats,
    orders: typeof r.orders === "string" ? JSON.parse(r.orders) : (r.orders ?? []),
  };
}

export async function getBzilaSnapshots(date?: string, limit = 200): Promise<BzilaSnapshotRecord[]> {
  if (date) {
    return queryAll<BzilaSnapshotRecord>(
      "SELECT * FROM bzila_snapshots WHERE date = ? ORDER BY timestamp DESC LIMIT ?",
      [date, limit]
    );
  }
  return queryAll<BzilaSnapshotRecord>(
    "SELECT * FROM bzila_snapshots ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}

// ── ES Overnight Gap (one row per trading day) ─────────────────────────────────

export interface EsGapRecord {
  id?: number;
  date: string;
  symbol?: string;
  prior_close: number | null;
  open_0930: number | null;
  gap_pts: number | null;
  gap_dir: "up" | "down" | "flat" | null;
  locked: number;
  filled: number;
  pct_filled: number;
  fill_ts: number | null;
  extreme_after: number | null;
  open_ts: number | null;
  updated_at?: string | null;
}

/**
 * Post the day's gap row. Writes prior_close / open_0930 / gap_pts ONCE and locks
 * the row (locked=1); a second call for the same date is a no-op on those fields
 * (mirrors ib_levels' frozen-once rule). Safe to call repeatedly.
 */
export async function postEsGap(r: {
  date: string;
  symbol?: string;
  prior_close: number;
  open_0930: number;
  gap_pts: number;
  gap_dir: "up" | "down" | "flat";
  open_ts: number;
}): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO es_gap (date, symbol, prior_close, open_0930, gap_pts, gap_dir, locked, open_ts, extreme_after, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,1,$7,$4,CURRENT_TIMESTAMP)
     ON CONFLICT(date) DO NOTHING`,
    [r.date, r.symbol ?? "/ES", r.prior_close, r.open_0930, r.gap_pts, r.gap_dir, r.open_ts]
  );
}

/**
 * Push a fill update for the day. Ratchets toward prior_close and never reverses:
 *   - pct_filled only increases (GREATEST against the stored value)
 *   - filled only flips 0→1, and fill_ts is stamped once
 *   - extreme_after tracks the furthest price toward the close
 * No-op if the row isn't posted/locked yet.
 */
export async function updateEsGapFill(r: {
  date: string;
  pct_filled: number;
  extreme_after: number;
  filled: boolean;
  fill_ts: number | null;
}): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `UPDATE es_gap SET
       pct_filled    = GREATEST(es_gap.pct_filled, $2),
       extreme_after = $3,
       filled        = CASE WHEN es_gap.filled = 1 OR $4 THEN 1 ELSE 0 END,
       fill_ts       = COALESCE(es_gap.fill_ts, $5),
       updated_at    = CURRENT_TIMESTAMP
     WHERE date = $1 AND locked = 1`,
    [r.date, r.pct_filled, r.extreme_after, r.filled, r.fill_ts]
  );
}

export async function getEsGap(date: string): Promise<EsGapRecord | null> {
  const rows = await queryAll<EsGapRecord>(`SELECT * FROM es_gap WHERE date = ? LIMIT 1`, [date]);
  return rows[0] ?? null;
}

// ── ICT Setup recorder ──────────────────────────────────────────────────────

export interface IctSetupRecord {
  id?: number;
  setup_key: string;
  date: string;
  kind: string;
  label?: string | null;
  dir?: string | null;
  trigger_ts: number;
  price?: number | null;
  note?: string | null;
  target?: number | null;
  invalidation?: number | null;
  outcome: "pending" | "win" | "loss" | "chop";
  mfe: number;
  mae: number;
  r_multiple?: number | null;
  resolved_ts?: number | null;
  resolved_price?: number | null;
  created_at?: string;
  updated_at?: string;
}

/** Record a newly-detected setup. Idempotent on setup_key — a re-scan that sees
 *  the same event is a no-op (DO NOTHING), so the cron can run every 5m safely. */
export async function insertIctSetup(r: {
  setup_key: string; date: string; kind: string; label?: string | null;
  dir?: string | null; trigger_ts: number; price?: number | null; note?: string | null;
  target?: number | null; invalidation?: number | null;
}): Promise<{ inserted: boolean }> {
  const res = await pgQuery(
    `INSERT INTO ict_setups
       (setup_key, date, kind, label, dir, trigger_ts, price, note, target, invalidation)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (setup_key) DO NOTHING
     RETURNING id`,
    [r.setup_key, r.date, r.kind, r.label ?? null, r.dir ?? null, r.trigger_ts,
     r.price ?? null, r.note ?? null, r.target ?? null, r.invalidation ?? null]
  );
  return { inserted: (res.rowCount ?? 0) > 0 };
}

/** Update grading fields on an existing setup (by setup_key). Used as price
 *  develops: ratchets mfe/mae, and stamps outcome once win/loss/chop resolves. */
export async function updateIctSetupGrade(r: {
  setup_key: string;
  outcome: "pending" | "win" | "loss" | "chop";
  mfe: number; mae: number;
  r_multiple?: number | null;
  resolved_ts?: number | null;
  resolved_price?: number | null;
}): Promise<void> {
  await pgQuery(
    `UPDATE ict_setups SET
       outcome = $2, mfe = $3, mae = $4, r_multiple = $5,
       resolved_ts = $6, resolved_price = $7, updated_at = CURRENT_TIMESTAMP
     WHERE setup_key = $1`,
    [r.setup_key, r.outcome, r.mfe, r.mae, r.r_multiple ?? null,
     r.resolved_ts ?? null, r.resolved_price ?? null]
  );
}

/** Feed for the recap panel: newest-first, optionally one ET date. */
export async function getIctSetups(
  opts?: { date?: string; sinceDate?: string; limit?: number }
): Promise<IctSetupRecord[]> {
  const limit = opts?.limit ?? 200;
  if (opts?.date) {
    return queryAll<IctSetupRecord>(
      `SELECT * FROM ict_setups WHERE date = ? ORDER BY trigger_ts DESC LIMIT ?`,
      [opts.date, limit]
    );
  }
  if (opts?.sinceDate) {
    return queryAll<IctSetupRecord>(
      `SELECT * FROM ict_setups WHERE date >= ? ORDER BY trigger_ts DESC LIMIT ?`,
      [opts.sinceDate, limit]
    );
  }
  return queryAll<IctSetupRecord>(
    `SELECT * FROM ict_setups ORDER BY trigger_ts DESC LIMIT ?`, [limit]
  );
}

/** Setups still being graded (outcome='pending') for a date — the grader's worklist. */
export async function getPendingIctSetups(date: string): Promise<IctSetupRecord[]> {
  return queryAll<IctSetupRecord>(
    `SELECT * FROM ict_setups WHERE date = ? AND outcome = 'pending' ORDER BY trigger_ts ASC`,
    [date]
  );
}

/** One recorded Momentum Bias TP/reversal signal (see momentum_bias_signals). */
export interface MomentumBiasSignalRecord {
  id: number;
  signal_key: string;
  date: string;
  symbol: string;
  dir: "bull" | "bear";
  trigger_ts: number;
  slot_key: string | null;
  time: string | null;
  price: number | null;
  up_bias: number | null;
  down_bias: number | null;
  boundary: number | null;
  atr: number | null;
  outcome: "pending" | "win" | "loss" | "chop";
  mfe: number;
  mae: number;
  r_multiple: number | null;
  resolved_ts: number | null;
  resolved_price: number | null;
}

/** Recorded Momentum Bias signals, newest first. Filter by date or sinceDate. */
export async function getMomentumBiasSignals(
  opts?: { date?: string; sinceDate?: string; limit?: number }
): Promise<MomentumBiasSignalRecord[]> {
  const limit = opts?.limit ?? 200;
  if (opts?.date) {
    return queryAll<MomentumBiasSignalRecord>(
      `SELECT * FROM momentum_bias_signals WHERE date = ? ORDER BY trigger_ts DESC LIMIT ?`,
      [opts.date, limit]
    );
  }
  if (opts?.sinceDate) {
    return queryAll<MomentumBiasSignalRecord>(
      `SELECT * FROM momentum_bias_signals WHERE date >= ? ORDER BY trigger_ts DESC LIMIT ?`,
      [opts.sinceDate, limit]
    );
  }
  return queryAll<MomentumBiasSignalRecord>(
    `SELECT * FROM momentum_bias_signals ORDER BY trigger_ts DESC LIMIT ?`, [limit]
  );
}

/** Win/loss/chop tally + win-rate + avg peak-R for Momentum Bias signals, per direction. */
export interface MomentumBiasSummary {
  dir: string;            // 'bull' | 'bear'
  wins: number; losses: number; chop: number; pending: number;
  graded: number;         // wins + losses (win-rate denominator)
  total: number;
  win_rate: number | null;
  avg_r: number | null;   // mean peak-R over resolved rows
  avg_mfe: number | null; // mean max-favorable-excursion (pts)
}

export async function getMomentumBiasSummary(
  opts?: { date?: string; sinceDate?: string }
): Promise<MomentumBiasSummary[]> {
  const pool = await getDb();
  let where = ``;
  const params: unknown[] = [];
  if (opts?.date) { where = `WHERE date = $1`; params.push(opts.date); }
  else if (opts?.sinceDate) { where = `WHERE date >= $1`; params.push(opts.sinceDate); }
  const result = await pool.query(`
    SELECT dir,
      COUNT(*) FILTER (WHERE outcome = 'win')::int  AS wins,
      COUNT(*) FILTER (WHERE outcome = 'loss')::int AS losses,
      COUNT(*) FILTER (WHERE outcome = 'chop')::int AS chop,
      COUNT(*) FILTER (WHERE outcome = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE outcome IN ('win','loss'))::int AS graded,
      COUNT(*)::int AS total,
      AVG(r_multiple) FILTER (WHERE outcome IN ('win','loss','chop')) AS avg_r,
      AVG(mfe) AS avg_mfe
    FROM momentum_bias_signals ${where}
    GROUP BY dir ORDER BY dir`, params);
  return result.rows.map((r: Record<string, unknown>) => {
    const wins = Number(r.wins), graded = Number(r.graded);
    return {
      dir: String(r.dir),
      wins, losses: Number(r.losses), chop: Number(r.chop), pending: Number(r.pending),
      graded, total: Number(r.total),
      win_rate: graded > 0 ? wins / graded : null,
      avg_r: r.avg_r != null ? Number(r.avg_r) : null,
      avg_mfe: r.avg_mfe != null ? Number(r.avg_mfe) : null,
    };
  });
}

/** Per-kind win/loss tally + averages for the results cards. */
export interface IctSetupSummary {
  kind: string;
  wins: number;
  losses: number;
  chop: number;
  pending: number;
  graded: number;       // wins + losses (chop excluded from win-rate)
  total: number;
  win_rate: number | null; // wins / graded
  avg_r: number | null;    // mean peak-R (max favorable / risk) over resolved rows
  avg_mfe: number | null;  // mean max-favorable-excursion (pts) over all rows
  resolved: number;        // win + loss + chop (rows with a final R)
  hit1: number;            // resolved rows that ran ≥ 1R
  hit2: number;            // ≥ 2R
  hit3: number;            // ≥ 3R
  rate1: number | null;    // hit1 / resolved
  rate2: number | null;
  rate3: number | null;
}

/** Summary grouped by kind. Filters:
 *   date     — exact ET date "YYYY-MM-DD"
 *   sinceDate— inclusive lower bound (date >= sinceDate); for "last 7 days" etc.
 *  Pass neither for all-time. (date wins if both given.) */
export async function getIctSetupSummary(opts?: { date?: string; sinceDate?: string }): Promise<IctSetupSummary[]> {
  const pool = await getDb();
  let where = ``;
  const params: unknown[] = [];
  if (opts?.date) { where = `WHERE date = $1`; params.push(opts.date); }
  else if (opts?.sinceDate) { where = `WHERE date >= $1`; params.push(opts.sinceDate); }
  const result = await pool.query(`
    SELECT kind,
      COUNT(*) FILTER (WHERE outcome = 'win')::int  AS wins,
      COUNT(*) FILTER (WHERE outcome = 'loss')::int AS losses,
      COUNT(*) FILTER (WHERE outcome = 'chop')::int AS chop,
      COUNT(*) FILTER (WHERE outcome = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE outcome IN ('win','loss'))::int AS graded,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE outcome IN ('win','loss','chop'))::int AS resolved,
      COUNT(*) FILTER (WHERE outcome IN ('win','loss','chop') AND r_multiple >= 1)::int AS hit1,
      COUNT(*) FILTER (WHERE outcome IN ('win','loss','chop') AND r_multiple >= 2)::int AS hit2,
      COUNT(*) FILTER (WHERE outcome IN ('win','loss','chop') AND r_multiple >= 3)::int AS hit3,
      AVG(r_multiple) FILTER (WHERE outcome IN ('win','loss','chop')) AS avg_r,
      AVG(mfe) AS avg_mfe
    FROM ict_setups ${where}
    GROUP BY kind ORDER BY total DESC, kind ASC
  `, params);
  return result.rows.map((r) => {
    const resolved = Number(r.resolved ?? 0);
    const hit1 = Number(r.hit1 ?? 0), hit2 = Number(r.hit2 ?? 0), hit3 = Number(r.hit3 ?? 0);
    return {
      kind: r.kind,
      wins: Number(r.wins ?? 0),
      losses: Number(r.losses ?? 0),
      chop: Number(r.chop ?? 0),
      pending: Number(r.pending ?? 0),
      graded: Number(r.graded ?? 0),
      total: Number(r.total ?? 0),
      win_rate: Number(r.graded) > 0 ? Number(r.wins) / Number(r.graded) : null,
      avg_r: r.avg_r != null ? Number(r.avg_r) : null,
      avg_mfe: r.avg_mfe != null ? Number(r.avg_mfe) : null,
      resolved, hit1, hit2, hit3,
      rate1: resolved > 0 ? hit1 / resolved : null,
      rate2: resolved > 0 ? hit2 / resolved : null,
      rate3: resolved > 0 ? hit3 / resolved : null,
    };
  });
}

// ── Expirations Cache ─────────────────────────────────────────────────────────

export async function ensureExpirationsTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function upsertExpirationCache(ticker: string, expirations: string[], raw: unknown): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO expirations_cache (ticker,timestamp,expirations,raw) VALUES ($1,$2,$3,$4)
     ON CONFLICT(ticker) DO UPDATE SET timestamp=EXCLUDED.timestamp, expirations=EXCLUDED.expirations, raw=EXCLUDED.raw`,
    [ticker, Date.now(), JSON.stringify(expirations), JSON.stringify(raw)]
  );
}

export async function getCachedExpirations(ticker: string): Promise<unknown | null> {
  const rows = await queryAll<{ ticker: string; timestamp: number; raw: string }>(
    "SELECT * FROM expirations_cache WHERE ticker = ? ORDER BY timestamp DESC LIMIT 1",
    [ticker]
  );
  if (!rows.length) return null;
  const r = rows[0];
  if (Date.now() - Number(r.timestamp) > 3_600_000) return null;
  return typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw;
}

// ── Option Strike GEX History ─────────────────────────────────────────────────

export interface OptionStrikeGexRecord {
  id?: number;
  timestamp: number;
  date: string;
  expiry: string;
  spot: number;
  strike: number;
  net_gex: number;
  net_vol_gex?: number;
}

// Postgres `real` (float4) underflows on any non-zero magnitude below ~1.18e-38
// and throws "out of range for type real" — a deep-OTM strike with gamma≈0 and
// tiny OI can legitimately compute to e.g. 8.3e-48, which is indistinguishable
// from 0 at this precision anyway. Clamp instead of losing the whole batch.
const REAL_MIN_MAGNITUDE = 1e-37;
function clampReal(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.abs(v) < REAL_MIN_MAGNITUDE ? 0 : v;
}

export async function insertOptionStrikeGexRows(rows: Omit<OptionStrikeGexRecord, "id">[]): Promise<void> {
  if (!rows.length) return;
  const pool = await getDb();
  for (const row of rows) {
    await pool.query(
      `INSERT INTO option_strike_gex_history (timestamp, date, expiry, spot, strike, net_gex, net_vol_gex)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [row.timestamp, row.date, row.expiry, row.spot, row.strike, clampReal(row.net_gex),
       Number.isFinite(row.net_vol_gex as number) ? clampReal(row.net_vol_gex as number) : null]
    );
  }
  // Retention: keep only the last 2 days. The heatmap + bubble backfill never
  // reads older, and the unbounded window scan over this table is what made the
  // ~700KB/5s query slow. Runs once per batch (~1/min), so the table stays small.
  await pool.query(
    `DELETE FROM option_strike_gex_history WHERE timestamp < $1`,
    [Date.now() - 2 * 24 * 60 * 60 * 1000]
  );
}

export async function getOptionStrikeRollingNetGex(
  date: string,
  expiry: string,
  sinceTimestamp: number
): Promise<Array<{ strike: number; rolling_net_gex: number; points: number }>> {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT strike,
            AVG(net_gex) AS rolling_net_gex,
            COUNT(*)::int AS points
       FROM option_strike_gex_history
      WHERE date = $1
        AND expiry = $2
        AND timestamp >= $3
      GROUP BY strike
      ORDER BY strike ASC`,
    [date, expiry, sinceTimestamp]
  );
  return result.rows.map((row) => ({
    strike: Number(row.strike ?? 0),
    rolling_net_gex: Number(row.rolling_net_gex ?? 0),
    points: Number(row.points ?? 0),
  }));
}

/**
 * Per-strike net GEX for an entire day, collapsed to ONE reading per
 * (strike, 5-minute slot) — the latest snapshot within each slot. Powers the
 * ES Candles heatmap backfill: each distinct slot becomes a heatmap column.
 *
 * `slot_ts` is the floor of `timestamp` to the 1-minute grid (ms), so it lines
 * up with the candle grid the overlay draws against. Ordered by slot then
 * strike for easy client-side bucketing.
 */
export async function getOptionStrikeGexSlots(
  date: string,
  expiry: string
): Promise<Array<{ slot_ts: number; strike: number; net_gex: number; net_vol_gex: number; spot: number }>> {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT DISTINCT ON ((FLOOR(timestamp / 60000) * 60000), strike)
            (FLOOR(timestamp / 60000) * 60000)::bigint AS slot_ts,
            strike,
            net_gex,
            net_vol_gex,
            spot
       FROM option_strike_gex_history
      WHERE date = $1
        AND expiry = $2
      ORDER BY (FLOOR(timestamp / 60000) * 60000) ASC, strike ASC, timestamp DESC`,
    [date, expiry]
  );
  return result.rows.map((row) => ({
    slot_ts: Number(row.slot_ts ?? 0),
    strike: Number(row.strike ?? 0),
    net_gex: Number(row.net_gex ?? 0),
    net_vol_gex: Number(row.net_vol_gex ?? 0),
    // SPX spot AT THE TIME OF THE SNAPSHOT. The ES-Candles heatmap needs this to
    // rebuild the historical ES−SPX basis per column (basis drifts with carry/
    // divs and steps at the futures roll — one live basis mis-places old cells).
    spot: Number(row.spot ?? 0),
  }));
}

/**
 * Same as getOptionStrikeGexSlots but bounded by a rolling timestamp window
 * (timestamp >= sinceTs) instead of a single calendar `date`. Lets the ES
 * Candles heatmap span ~24h across the ET-midnight boundary, since rows are
 * written 24/7 (only the day-keyed read was capping it to one ET day).
 */
export async function getOptionStrikeGexSlotsWindow(
  sinceTs: number,
  expiry: string
): Promise<Array<{ slot_ts: number; strike: number; net_gex: number; net_vol_gex: number; spot: number }>> {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT DISTINCT ON ((FLOOR(timestamp / 60000) * 60000), strike)
            (FLOOR(timestamp / 60000) * 60000)::bigint AS slot_ts,
            strike,
            net_gex,
            net_vol_gex,
            spot
       FROM option_strike_gex_history
      WHERE timestamp >= $1
        AND expiry = $2
      ORDER BY (FLOOR(timestamp / 60000) * 60000) ASC, strike ASC, timestamp DESC`,
    [sinceTs, expiry]
  );
  return result.rows.map((row) => ({
    slot_ts: Number(row.slot_ts ?? 0),
    strike: Number(row.strike ?? 0),
    net_gex: Number(row.net_gex ?? 0),
    net_vol_gex: Number(row.net_vol_gex ?? 0),
    spot: Number(row.spot ?? 0),
  }));
}

/**
 * Same as getOptionStrikeGexSlotsWindow but with NO expiry filter. The writer
 * tags every row with that day's front (0DTE) expiry, which is a different
 * string each trading day — so a literal `expiry =` match only ever returns
 * today's rows and multi-day heatmap backfill silently comes back empty for
 * older candles. Front/live mode wants "whichever expiry was active that
 * day," which in practice is one distinct expiry per calendar date, so
 * dropping the filter and keying purely on the time window is safe.
 */
export async function getOptionStrikeGexSlotsWindowAny(
  sinceTs: number
): Promise<Array<{ slot_ts: number; strike: number; net_gex: number; net_vol_gex: number; spot: number }>> {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT DISTINCT ON ((FLOOR(timestamp / 60000) * 60000), strike)
            (FLOOR(timestamp / 60000) * 60000)::bigint AS slot_ts,
            strike,
            net_gex,
            net_vol_gex,
            spot
       FROM option_strike_gex_history
      WHERE timestamp >= $1
      ORDER BY (FLOOR(timestamp / 60000) * 60000) ASC, strike ASC, timestamp DESC`,
    [sinceTs]
  );
  return result.rows.map((row) => ({
    slot_ts: Number(row.slot_ts ?? 0),
    strike: Number(row.strike ?? 0),
    net_gex: Number(row.net_gex ?? 0),
    net_vol_gex: Number(row.net_vol_gex ?? 0),
    spot: Number(row.spot ?? 0),
  }));
}

/**
 * Per-strike net GEX as it read at the most recent snapshot AT OR BEFORE
 * `asOfTimestamp` (point-in-time, not an average). Used by the strike-detail
 * popup to compute rolling differences (current − reading N minutes ago).
 * Returns the single nearest row per strike via DISTINCT ON.
 */
export async function getOptionStrikeNetGexAsOf(
  date: string,
  expiry: string,
  asOfTimestamp: number
): Promise<Array<{ strike: number; net_gex: number; net_vol_gex: number; timestamp: number }>> {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT DISTINCT ON (strike) strike, net_gex, net_vol_gex, timestamp
       FROM option_strike_gex_history
      WHERE date = $1
        AND expiry = $2
        AND timestamp <= $3
      ORDER BY strike ASC, timestamp DESC`,
    [date, expiry, asOfTimestamp]
  );
  return result.rows.map((row) => ({
    strike: Number(row.strike ?? 0),
    net_gex: Number(row.net_gex ?? 0),
    net_vol_gex: Number(row.net_vol_gex ?? 0),
    timestamp: Number(row.timestamp ?? 0),
  }));
}

/**
 * Per-strike net GEX as of a target time, but TOLERANT of sparse history:
 * prefers the latest row at-or-before `asOfTimestamp`; if a strike has no row
 * that old, falls back to that strike's nearest available row instead of
 * dropping it. Keeps the ghost overlay populated after-hours / right after the
 * writer starts, when nothing is yet `age` minutes old.
 */
export async function getOptionStrikeNetGexAsOfOrNearest(
  date: string,
  expiry: string,
  asOfTimestamp: number
): Promise<Array<{ strike: number; net_gex: number; net_vol_gex: number; timestamp: number }>> {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT DISTINCT ON (strike) strike, net_gex, net_vol_gex, timestamp
       FROM option_strike_gex_history
      WHERE date = $1
        AND expiry = $2
      ORDER BY strike ASC,
               (timestamp <= $3) DESC,
               CASE WHEN timestamp <= $3
                    THEN $3 - timestamp
                    ELSE timestamp - $3
               END ASC`,
    [date, expiry, asOfTimestamp]
  );
  return result.rows.map((row) => ({
    strike: Number(row.strike ?? 0),
    net_gex: Number(row.net_gex ?? 0),
    net_vol_gex: Number(row.net_vol_gex ?? 0),
    timestamp: Number(row.timestamp ?? 0),
  }));
}

/**
 * Per-strike net GEX at the FIRST snapshot of the session (RTH open baseline).
 * "Open" = earliest reading recorded for `date`/`expiry`.
 */
export async function getOptionStrikeNetGexAtOpen(
  date: string,
  expiry: string
): Promise<Array<{ strike: number; net_gex: number; net_vol_gex: number; timestamp: number }>> {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT DISTINCT ON (strike) strike, net_gex, net_vol_gex, timestamp
       FROM option_strike_gex_history
      WHERE date = $1
        AND expiry = $2
      ORDER BY strike ASC, timestamp ASC`,
    [date, expiry]
  );
  return result.rows.map((row) => ({
    strike: Number(row.strike ?? 0),
    net_gex: Number(row.net_gex ?? 0),
    net_vol_gex: Number(row.net_vol_gex ?? 0),
    timestamp: Number(row.timestamp ?? 0),
  }));
}

export interface BudgetProfileRecord {
  id: number;
  name: string;
  currency: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface BudgetCategoryRecord {
  id: number;
  profile_id: number;
  name: string;
  amount: number;
  period: string;
  color?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface BudgetEntryRecord {
  id: number;
  profile_id: number;
  category_id?: number | null;
  type: "income" | "expense";
  amount: number;
  title: string;
  notes?: string | null;
  occurred_at: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function getOrCreateBudgetProfile(name = "Default"): Promise<BudgetProfileRecord> {
  const pool = await getDb();
  const found = await queryOne<BudgetProfileRecord>("SELECT * FROM budget_profiles WHERE name = ? LIMIT 1", [name]);
  if (found) return found;
  const result = await pool.query(
    `INSERT INTO budget_profiles (name, currency) VALUES ($1, $2) RETURNING *`,
    [name, "USD"]
  );
  return result.rows[0] as BudgetProfileRecord;
}

export async function listBudgetProfiles(): Promise<BudgetProfileRecord[]> {
  return queryAll<BudgetProfileRecord>("SELECT * FROM budget_profiles ORDER BY id ASC");
}

export async function upsertBudgetCategory(input: { profile_id: number; name: string; amount: number; period: string; color?: string | null }): Promise<BudgetCategoryRecord> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_categories (profile_id, name, amount, period, color)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT(profile_id, name) DO UPDATE SET amount = EXCLUDED.amount, period = EXCLUDED.period, color = EXCLUDED.color, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [input.profile_id, input.name, input.amount, input.period, input.color ?? null]
  );
  return result.rows[0] as BudgetCategoryRecord;
}

export async function listBudgetCategories(profileId: number): Promise<BudgetCategoryRecord[]> {
  return queryAll<BudgetCategoryRecord>(
    "SELECT * FROM budget_categories WHERE profile_id = ? ORDER BY id DESC",
    [profileId]
  );
}

export async function deleteBudgetCategory(profileId: number, id: number): Promise<void> {
  const pool = await getDb();
  await pool.query("DELETE FROM budget_categories WHERE id = $1 AND profile_id = $2", [id, profileId]);
}

export interface DailyBalanceRecord {
  id: number;
  profile_id: number;
  day: string;
  coastal: number;
  truist: number;
  secu: number;
}

export async function upsertDailyBalance(input: { profile_id: number; day: string; coastal: number; truist: number; secu: number }): Promise<DailyBalanceRecord> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_daily_balance (profile_id, day, coastal, truist, secu)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT(profile_id, day) DO UPDATE SET coastal = EXCLUDED.coastal, truist = EXCLUDED.truist, secu = EXCLUDED.secu, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [input.profile_id, input.day, input.coastal, input.truist, input.secu]
  );
  return result.rows[0] as DailyBalanceRecord;
}

export async function getLatestDailyBalance(profileId: number): Promise<DailyBalanceRecord | null> {
  const rows = await queryAll<DailyBalanceRecord>(
    "SELECT * FROM budget_daily_balance WHERE profile_id = ? ORDER BY day DESC LIMIT 1",
    [profileId]
  );
  return rows[0] ?? null;
}

// Most recent saved opening balance strictly before `day` — used to show the
// day-over-day delta (today's balance vs. what was left after yesterday's
// bills/payments) on the Daily Opening Balance card.
export async function getDailyBalanceBefore(profileId: number, day: string): Promise<DailyBalanceRecord | null> {
  const rows = await queryAll<DailyBalanceRecord>(
    "SELECT * FROM budget_daily_balance WHERE profile_id = ? AND day < ? ORDER BY day DESC LIMIT 1",
    [profileId, day]
  );
  return rows[0] ?? null;
}

// Assign (or clear, with null) a register row's category.
export async function setRegisterCategory(profileId: number, id: number, categoryId: number | null): Promise<void> {
  const pool = await getDb();
  await pool.query(
    "UPDATE budget_register SET category_id = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND profile_id = $2",
    [id, profileId, categoryId]
  );
}

export async function insertBudgetEntry(input: Omit<BudgetEntryRecord, "id" | "created_at" | "updated_at">): Promise<BudgetEntryRecord> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_entries (profile_id, category_id, type, amount, title, notes, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [input.profile_id, input.category_id ?? null, input.type, input.amount, input.title, input.notes ?? null, input.occurred_at]
  );
  return result.rows[0] as BudgetEntryRecord;
}

export async function listBudgetEntries(profileId: number, limit = 200): Promise<BudgetEntryRecord[]> {
  return queryAll<BudgetEntryRecord>(
    "SELECT * FROM budget_entries WHERE profile_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?",
    [profileId, limit]
  );
}

// ── Check register: one line item per row, single running balance ─────────────
export type RegisterBank = "coastal" | "truist" | "secu";
export interface BudgetRegisterRecord {
  id: number;
  profile_id: number;
  entry_date: string;
  sort_order: number;
  label: string;
  bank: RegisterBank;
  amount: number;
  is_beginning: number;
  recurring_tag?: string | null;
  category_id?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function insertRegisterRow(input: {
  profile_id: number;
  entry_date: string;
  sort_order: number;
  label: string;
  bank: RegisterBank;
  amount: number;
  is_beginning?: number;
  recurring_tag?: string | null;
  category_id?: number | null;
}): Promise<BudgetRegisterRecord> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_register (profile_id, entry_date, sort_order, label, bank, amount, is_beginning, recurring_tag, category_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [input.profile_id, input.entry_date, input.sort_order, input.label, input.bank, input.amount, input.is_beginning ?? 0, input.recurring_tag ?? null, input.category_id ?? null]
  );
  return result.rows[0] as BudgetRegisterRecord;
}

export async function updateRegisterRow(profileId: number, id: number, patch: { entry_date?: string; label?: string; bank?: RegisterBank; amount?: number }): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `UPDATE budget_register
       SET entry_date = COALESCE($3, entry_date),
           label = COALESCE($4, label),
           bank = COALESCE($5, bank),
           amount = COALESCE($6, amount),
           updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND profile_id = $2`,
    [id, profileId, patch.entry_date ?? null, patch.label ?? null, patch.bank ?? null, patch.amount ?? null]
  );
}

export async function deleteRegisterRow(profileId: number, id: number): Promise<void> {
  const pool = await getDb();
  await pool.query(`DELETE FROM budget_register WHERE id = $1 AND profile_id = $2 AND is_beginning = 0`, [id, profileId]);
}

export async function deleteRegisterByTag(profileId: number, fromDate: string, toDate: string, tag: string): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `DELETE FROM budget_register WHERE profile_id = $1 AND entry_date >= $2 AND entry_date <= $3 AND recurring_tag = $4`,
    [profileId, fromDate, toDate, tag]
  );
}

export async function listRegister(profileId: number, fromDate: string, toDate: string): Promise<BudgetRegisterRecord[]> {
  return queryAll<BudgetRegisterRecord>(
    "SELECT * FROM budget_register WHERE profile_id = ? AND entry_date >= ? AND entry_date <= ? ORDER BY entry_date ASC, sort_order ASC, id ASC",
    [profileId, fromDate, toDate]
  );
}

// ── Recurring rules ───────────────────────────────────────────────────────────
export type RecurringFrequency = "weekly" | "biweekly" | "monthly";
export interface BudgetRecurringRecord {
  id: number;
  profile_id: number;
  label: string;
  bank: RegisterBank;
  amount: number;
  frequency: RecurringFrequency;
  anchor_date: string;
  active: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function insertRecurring(input: { profile_id: number; label: string; bank: RegisterBank; amount: number; frequency: RecurringFrequency; anchor_date: string }): Promise<BudgetRecurringRecord> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_recurring (profile_id, label, bank, amount, frequency, anchor_date)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [input.profile_id, input.label, input.bank, input.amount, input.frequency, input.anchor_date]
  );
  return result.rows[0] as BudgetRecurringRecord;
}

export async function updateRecurring(profileId: number, id: number, patch: { label?: string; bank?: RegisterBank; amount?: number; frequency?: RecurringFrequency; anchor_date?: string; active?: number }): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `UPDATE budget_recurring
       SET label = COALESCE($3, label),
           bank = COALESCE($4, bank),
           amount = COALESCE($5, amount),
           frequency = COALESCE($6, frequency),
           anchor_date = COALESCE($7, anchor_date),
           active = COALESCE($8, active),
           updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND profile_id = $2`,
    [id, profileId, patch.label ?? null, patch.bank ?? null, patch.amount ?? null, patch.frequency ?? null, patch.anchor_date ?? null, patch.active ?? null]
  );
}

export async function deleteRecurring(profileId: number, id: number): Promise<void> {
  const pool = await getDb();
  await pool.query(`DELETE FROM budget_recurring WHERE id = $1 AND profile_id = $2`, [id, profileId]);
}

export async function listRecurring(profileId: number): Promise<BudgetRecurringRecord[]> {
  return queryAll<BudgetRecurringRecord>(
    "SELECT * FROM budget_recurring WHERE profile_id = ? ORDER BY id ASC",
    [profileId]
  );
}

// One-time: adopt the legacy shared "Default" budget as the named profile, but
// only if that target doesn't already exist. Idempotent — safe to call on load.
export async function adoptDefaultBudgetProfile(targetName: string): Promise<void> {
  if (targetName === "Default") return;
  const pool = await getDb();
  await pool.query(
    `UPDATE budget_profiles SET name = $1, updated_at = CURRENT_TIMESTAMP
     WHERE name = 'Default'
       AND NOT EXISTS (SELECT 1 FROM budget_profiles WHERE name = $1)`,
    [targetName]
  );
}

// ── Amazon delivery log ───────────────────────────────────────────────────────
export interface BudgetAmazonRecord {
  id: number;
  profile_id: number;
  work_date: string;
  pay: number;
  gas: number;
  created_at?: string | null;
  updated_at?: string | null;
}

// Each call inserts a new delivery row. Days can hold several rows (multiple
// trips), so this no longer upserts on (profile, date).
export async function insertAmazonRow(input: { profile_id: number; work_date: string; pay: number; gas: number }): Promise<BudgetAmazonRecord> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_amazon (profile_id, work_date, pay, gas)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [input.profile_id, input.work_date, input.pay, input.gas]
  );
  return result.rows[0] as BudgetAmazonRecord;
}

export async function deleteAmazonRow(profileId: number, id: number): Promise<void> {
  const pool = await getDb();
  await pool.query(`DELETE FROM budget_amazon WHERE id = $1 AND profile_id = $2`, [id, profileId]);
}

export async function listAmazonRows(profileId: number, fromDate: string, toDate: string): Promise<BudgetAmazonRecord[]> {
  return queryAll<BudgetAmazonRecord>(
    "SELECT * FROM budget_amazon WHERE profile_id = ? AND work_date >= ? AND work_date <= ? ORDER BY work_date ASC, id ASC",
    [profileId, fromDate, toDate]
  );
}

// ── Prop-firm spending log ────────────────────────────────────────────────────
export type BudgetPropSource = "prop" | "cbedge" | "contracts";

export interface BudgetPropRecord {
  id: number;
  profile_id: number;
  entry_date: string;
  source: BudgetPropSource;
  firm: string;
  accounts: number;
  cost: number;
  payout: number;
  note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

function normSource(v: unknown): BudgetPropSource {
  return v === "cbedge" ? "cbedge" : v === "contracts" ? "contracts" : "prop";
}

export async function insertPropRow(input: {
  profile_id: number;
  entry_date: string;
  source?: string;
  firm?: string;
  accounts?: number;
  cost?: number;
  payout?: number;
  note?: string | null;
}): Promise<BudgetPropRecord> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_prop (profile_id, entry_date, source, firm, accounts, cost, payout, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      input.profile_id,
      input.entry_date,
      normSource(input.source),
      input.firm && input.firm.trim() ? input.firm.trim() : "TPT",
      Math.round(input.accounts ?? 0),
      input.cost ?? 0,
      input.payout ?? 0,
      input.note ?? null,
    ]
  );
  return result.rows[0] as BudgetPropRecord;
}

export async function updatePropRow(
  profileId: number,
  id: number,
  patch: { entry_date?: string; source?: string; firm?: string; accounts?: number; cost?: number; payout?: number; note?: string | null }
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  const add = (col: string, v: unknown) => { sets.push(`${col} = $${i++}`); vals.push(v); };
  if (patch.entry_date !== undefined) add("entry_date", patch.entry_date);
  if (patch.source !== undefined) add("source", normSource(patch.source));
  if (patch.firm !== undefined) add("firm", patch.firm.trim() || "TPT");
  if (patch.accounts !== undefined) add("accounts", Math.round(patch.accounts));
  if (patch.cost !== undefined) add("cost", patch.cost);
  if (patch.payout !== undefined) add("payout", patch.payout);
  if (patch.note !== undefined) add("note", patch.note);
  if (!sets.length) return;
  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  const pool = await getDb();
  await pool.query(
    `UPDATE budget_prop SET ${sets.join(", ")} WHERE id = $${i++} AND profile_id = $${i}`,
    [...vals, id, profileId]
  );
}

export async function deletePropRow(profileId: number, id: number): Promise<void> {
  const pool = await getDb();
  await pool.query(`DELETE FROM budget_prop WHERE id = $1 AND profile_id = $2`, [id, profileId]);
}

export async function listPropRows(profileId: number, fromDate: string, toDate: string): Promise<BudgetPropRecord[]> {
  return queryAll<BudgetPropRecord>(
    "SELECT * FROM budget_prop WHERE profile_id = ? AND entry_date >= ? AND entry_date <= ? ORDER BY entry_date DESC, id DESC",
    [profileId, fromDate, toDate]
  );
}

// ── EOD GEX Snapshots ─────────────────────────────────────────────────────────

export interface EodGexRecord {
  id?: number;
  date: string;
  symbol: string;
  total_gex: number;
  spot: number;
  computed_at: string;
  // Combined net GEX across all expirations EXCEPT 0DTE. Nullable — older rows
  // and any where the chain couldn't be read have no value.
  total_gex_ex0dte?: number | null;
}

/** Upsert one EOD GEX row. Overwrites an existing (date, symbol) row. */
export async function upsertEodGex(r: Omit<EodGexRecord, "id">): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO eod_gex (date, symbol, total_gex, spot, computed_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (date, symbol) DO UPDATE SET
       total_gex   = EXCLUDED.total_gex,
       spot        = EXCLUDED.spot,
       computed_at = EXCLUDED.computed_at`,
    [r.date, r.symbol, r.total_gex, r.spot, r.computed_at]
  );
}

export async function getEodGex(opts: { date?: string; symbol?: string; limit?: number } = {}): Promise<EodGexRecord[]> {
  const { date, symbol, limit = 200 } = opts;
  if (date && symbol) {
    return queryAll<EodGexRecord>(
      "SELECT * FROM eod_gex WHERE date = ? AND symbol = ? ORDER BY id DESC LIMIT ?",
      [date, symbol, limit]
    );
  }
  if (date) {
    return queryAll<EodGexRecord>(
      "SELECT * FROM eod_gex WHERE date = ? ORDER BY symbol ASC LIMIT ?",
      [date, limit]
    );
  }
  if (symbol) {
    return queryAll<EodGexRecord>(
      "SELECT * FROM eod_gex WHERE symbol = ? ORDER BY date DESC LIMIT ?",
      [symbol, limit]
    );
  }
  return queryAll<EodGexRecord>(
    "SELECT * FROM eod_gex ORDER BY date DESC, symbol ASC LIMIT ?",
    [limit]
  );
}

// ── Delayed preview snapshot (/preview page for unpaid signed-in users) ─────

export interface PreviewSnapshotRecord {
  id?: number;
  ts: number;
  date: string;
  time?: string | null;
  spx_price?: number | null;
  gex_flip?: number | null;
  call_wall?: number | null;
  put_wall?: number | null;
  expiration?: string | null;
}

export async function insertPreviewSnapshot(r: PreviewSnapshotRecord): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO preview_snapshots (ts, date, time, spx_price, gex_flip, call_wall, put_wall, expiration)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [r.ts, r.date, r.time ?? null, r.spx_price ?? null, r.gex_flip ?? null,
     r.call_wall ?? null, r.put_wall ?? null, r.expiration ?? null]
  );
}

export async function getLatestPreviewSnapshot(): Promise<PreviewSnapshotRecord | undefined> {
  await getDb();
  return queryOne<PreviewSnapshotRecord>(
    "SELECT * FROM preview_snapshots ORDER BY ts DESC LIMIT 1"
  );
}

// ── Full-chain static snapshot (/home in delayed mode) ──────────────────────

export async function insertHomeStaticSnapshot(payload: unknown, ts: number = Date.now()): Promise<void> {
  const pool = await getDb();
  const now = new Date(ts);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).filter((p) => p.type !== "literal")
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);
  await pool.query(
    `INSERT INTO home_static_snapshots (ts, date, payload) VALUES ($1, $2, $3::jsonb)`,
    [ts, `${date.year}-${date.month}-${date.day}`, JSON.stringify(payload)]
  );
}

/** Latest frozen /home payload, or undefined if nothing's been captured yet. */
export async function getLatestHomeStaticSnapshot(): Promise<{ ts: number; payload: unknown } | undefined> {
  await getDb();
  const row = await queryOne<{ ts: number; payload: unknown }>(
    "SELECT ts, payload FROM home_static_snapshots ORDER BY ts DESC LIMIT 1"
  );
  if (!row) return undefined;
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  return { ts: Number(row.ts), payload };
}

// ── Full-chain static snapshot (/mult-greek in delayed mode) ────────────────

export async function insertMultGreekStaticSnapshot(payload: unknown, ts: number = Date.now()): Promise<void> {
  const pool = await getDb();
  const now = new Date(ts);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).filter((p) => p.type !== "literal")
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);
  await pool.query(
    `INSERT INTO mult_greek_static_snapshots (ts, date, payload) VALUES ($1, $2, $3::jsonb)`,
    [ts, `${date.year}-${date.month}-${date.day}`, JSON.stringify(payload)]
  );
}

export async function getLatestMultGreekStaticSnapshot(): Promise<{ ts: number; payload: unknown } | undefined> {
  await getDb();
  const row = await queryOne<{ ts: number; payload: unknown }>(
    "SELECT ts, payload FROM mult_greek_static_snapshots ORDER BY ts DESC LIMIT 1"
  );
  if (!row) return undefined;
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  return { ts: Number(row.ts), payload };
}
