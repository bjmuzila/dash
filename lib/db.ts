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

    CREATE TABLE IF NOT EXISTS es_candles (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      "slotKey" TEXT NOT NULL UNIQUE, time TEXT, symbol TEXT, "intervalMinutes" INTEGER,
      source TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL, "avgVolume" REAL
    );
    CREATE INDEX IF NOT EXISTS idx_ec_date ON es_candles(date);
    CREATE INDEX IF NOT EXISTS idx_ec_slot ON es_candles("slotKey");

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
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_budget_register_profile ON budget_register(profile_id);
    CREATE INDEX IF NOT EXISTS idx_budget_register_date ON budget_register(entry_date);

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

    -- Amazon delivery log: one row per work day (date, gross pay, gas cost).
    CREATE TABLE IF NOT EXISTS budget_amazon (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
      work_date TEXT NOT NULL,
      pay REAL NOT NULL DEFAULT 0,
      gas REAL NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, work_date)
    );
    CREATE INDEX IF NOT EXISTS idx_budget_amazon_profile ON budget_amazon(profile_id);

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
      result_source TEXT,   -- 'auto' | 'manual' | 'import'
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_em_tracker_ticker ON em_tracker(ticker);
    CREATE INDEX IF NOT EXISTS idx_em_tracker_week ON em_tracker(week_start);

    -- Migration: add breach column to pre-existing em_tracker tables.
    ALTER TABLE em_tracker ADD COLUMN IF NOT EXISTS breach INTEGER;

    -- Uniqueness is per (ticker, week_start): week_label like "5/1" repeats every
    -- year, so 2 years of history would collide on (ticker, week_label). Keying on
    -- the Monday ISO date keeps each calendar week distinct. Drop the old label
    -- constraint if present, add the date-based one.
    ALTER TABLE em_tracker DROP CONSTRAINT IF EXISTS em_tracker_ticker_week_label_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_em_tracker_ticker_week_start
      ON em_tracker(ticker, week_start);

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
    ALTER TABLE td_overview ADD COLUMN IF NOT EXISTS movers JSONB NOT NULL DEFAULT '[]'::jsonb;

    -- Traders Dashboard per-user preferences. One row per Clerk user. schedule and
    -- tasks are JSON arrays the page owns; zip drives the weather card.
    CREATE TABLE IF NOT EXISTS td_user_prefs (
      clerk_user_id TEXT PRIMARY KEY,
      zip           TEXT,
      schedule      JSONB NOT NULL DEFAULT '[]'::jsonb,
      tasks         JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    -- Traders Dashboard overnight AI overview. One row per ET date, written once
    -- by the 7am cron (overview-generator.js). summary is the narrative; drivers
    -- is a JSON array of {when,title,body} econ/news items.
    CREATE TABLE IF NOT EXISTS td_overview (
      date       TEXT PRIMARY KEY,
      summary    TEXT NOT NULL,
      drivers    JSONB NOT NULL DEFAULT '[]'::jsonb,
      generated_at BIGINT NOT NULL
    );

    -- Pre-market AI 5-bullet read of the global overnight tape, written daily by
    -- the cron (premarket-summary-generator.js). bullets is a JSON array of
    -- strings; read by the Analytics Premarket card via GET (latest row).
    CREATE TABLE IF NOT EXISTS premarket_summary (
      date       TEXT PRIMARY KEY,
      bullets    JSONB NOT NULL DEFAULT '[]'::jsonb,
      generated_at BIGINT NOT NULL
    );

    -- Daily AI trade strategy for the Analytics strategy-builder card, written
    -- weekday mornings by the cron (strategy-generator.js). plan is a JSON object
    -- (bias, levels, idea, risk, triggers); read by the StrategyBuilder card.
    CREATE TABLE IF NOT EXISTS daily_strategy (
      date       TEXT PRIMARY KEY,
      plan       JSONB NOT NULL DEFAULT '{}'::jsonb,
      generated_at BIGINT NOT NULL
    );

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
  fields: { zip?: string | null; schedule?: unknown[]; tasks?: unknown[] }
): Promise<void> {
  await getDb();
  const existing = await getTdPrefs(clerkUserId);
  const zip = fields.zip !== undefined ? fields.zip : existing?.zip ?? null;
  const schedule = fields.schedule !== undefined ? fields.schedule : existing?.schedule ?? [];
  const tasks = fields.tasks !== undefined ? fields.tasks : existing?.tasks ?? [];
  await queryAll(
    `INSERT INTO td_user_prefs (clerk_user_id, zip, schedule, tasks, updated_at)
     VALUES (?, ?, ?::jsonb, ?::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       zip = EXCLUDED.zip, schedule = EXCLUDED.schedule, tasks = EXCLUDED.tasks,
       updated_at = CURRENT_TIMESTAMP`,
    [clerkUserId, zip, JSON.stringify(schedule), JSON.stringify(tasks)]
  );
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
       (ticker, week_label, week_start, em, ref_close, up, down, o, h, l, c, result, breach, result_source, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
       result_source = COALESCE(EXCLUDED.result_source, em_tracker.result_source),
       note          = COALESCE(EXCLUDED.note,          em_tracker.note),
       updated_at    = CURRENT_TIMESTAMP`,
    [
      r.ticker.toUpperCase(), r.week_label, r.week_start ?? null, r.em, r.ref_close ?? null,
      r.up ?? null, r.down ?? null, r.o ?? null, r.h ?? null, r.l ?? null, r.c ?? null,
      r.result ?? null, r.breach ?? null, r.result_source ?? null, r.note ?? null,
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

export async function getMvcSnapshots(date?: string, limit = 200): Promise<MvcRecord[]> {
  if (date) {
    return queryAll<MvcRecord>(
      "SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp DESC LIMIT ?",
      [date, limit]
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
  created_at?: string | null;
}

// Keep the visit log bounded so it can't grow without limit.
const PAGE_VISITS_KEEP = 5000;

export async function insertPageVisit(
  r: Pick<PageVisitRecord, "page_key" | "page_label" | "path" | "user_id" | "ip">
): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO page_visits (page_key, page_label, path, user_id, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [r.page_key ?? null, r.page_label ?? null, r.path ?? null, r.user_id ?? null, r.ip ?? null]
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
    `INSERT INTO es_candles (timestamp,date,"slotKey",time,symbol,"intervalMinutes",source,open,high,low,close,volume,"avgVolume")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT("slotKey") DO UPDATE SET
       timestamp=EXCLUDED.timestamp, high=GREATEST(es_candles.high,EXCLUDED.high), low=LEAST(es_candles.low,EXCLUDED.low),
       close=EXCLUDED.close, volume=EXCLUDED.volume, "avgVolume"=EXCLUDED."avgVolume"`,
    [r.timestamp, r.date, r.slotKey, r.time ?? "", r.symbol ?? "/ES", r.intervalMinutes ?? 5,
     r.source ?? "dxlink", r.open, r.high, r.low, r.close, r.volume, r.avgVolume ?? 0]
  );
}

export async function getEsCandles(date?: string, daysBack?: number, limit = 2000): Promise<EsCandleDbRecord[]> {
  if (date) {
    return queryAll<EsCandleDbRecord>(
      `SELECT * FROM es_candles WHERE date = ? ORDER BY timestamp ASC LIMIT ?`,
      [date, limit]
    );
  }
  if (daysBack) {
    const cutoff = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
    return queryAll<EsCandleDbRecord>(
      `SELECT * FROM es_candles WHERE date >= ? ORDER BY timestamp ASC LIMIT ?`,
      [cutoff, limit]
    );
  }
  return queryAll<EsCandleDbRecord>(
    `SELECT * FROM es_candles ORDER BY timestamp DESC LIMIT ?`,
    [limit]
  );
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
export async function getIctSetups(date?: string, limit = 200): Promise<IctSetupRecord[]> {
  if (date) {
    return queryAll<IctSetupRecord>(
      `SELECT * FROM ict_setups WHERE date = ? ORDER BY trigger_ts DESC LIMIT ?`,
      [date, limit]
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
  avg_r: number | null;    // mean r_multiple over graded (win+loss) rows
  avg_mfe: number | null;  // mean max-favorable-excursion (pts) over all rows
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
      AVG(r_multiple) FILTER (WHERE outcome IN ('win','loss')) AS avg_r,
      AVG(mfe) AS avg_mfe
    FROM ict_setups ${where}
    GROUP BY kind ORDER BY total DESC, kind ASC
  `, params);
  return result.rows.map((r) => ({
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
  }));
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

export async function insertOptionStrikeGexRows(rows: Omit<OptionStrikeGexRecord, "id">[]): Promise<void> {
  if (!rows.length) return;
  const pool = await getDb();
  for (const row of rows) {
    await pool.query(
      `INSERT INTO option_strike_gex_history (timestamp, date, expiry, spot, strike, net_gex, net_vol_gex)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [row.timestamp, row.date, row.expiry, row.spot, row.strike, row.net_gex,
       Number.isFinite(row.net_vol_gex as number) ? row.net_vol_gex : null]
    );
  }
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
): Promise<Array<{ slot_ts: number; strike: number; net_gex: number; net_vol_gex: number }>> {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT DISTINCT ON ((FLOOR(timestamp / 60000) * 60000), strike)
            (FLOOR(timestamp / 60000) * 60000)::bigint AS slot_ts,
            strike,
            net_gex,
            net_vol_gex
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
): Promise<Array<{ slot_ts: number; strike: number; net_gex: number; net_vol_gex: number }>> {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT DISTINCT ON ((FLOOR(timestamp / 60000) * 60000), strike)
            (FLOOR(timestamp / 60000) * 60000)::bigint AS slot_ts,
            strike,
            net_gex,
            net_vol_gex
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
}): Promise<BudgetRegisterRecord> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_register (profile_id, entry_date, sort_order, label, bank, amount, is_beginning, recurring_tag)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [input.profile_id, input.entry_date, input.sort_order, input.label, input.bank, input.amount, input.is_beginning ?? 0, input.recurring_tag ?? null]
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

export async function upsertAmazonRow(input: { profile_id: number; work_date: string; pay: number; gas: number }): Promise<BudgetAmazonRecord> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_amazon (profile_id, work_date, pay, gas)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT(profile_id, work_date) DO UPDATE SET pay = EXCLUDED.pay, gas = EXCLUDED.gas, updated_at = CURRENT_TIMESTAMP
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

// ── EOD GEX Snapshots ─────────────────────────────────────────────────────────

export interface EodGexRecord {
  id?: number;
  date: string;
  symbol: string;
  total_gex: number;
  spot: number;
  computed_at: string;
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
