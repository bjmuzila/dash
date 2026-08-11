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

// lib/db.ts
var db_exports = {};
__export(db_exports, {
  PAID_STATUSES: () => PAID_STATUSES,
  addEmailSend: () => addEmailSend,
  addFarCbTicker: () => addFarCbTicker,
  addFeedback: () => addFeedback,
  addSalesExpense: () => addSalesExpense,
  addUnsubscribe: () => addUnsubscribe,
  addWaitlistEmail: () => addWaitlistEmail,
  adoptDefaultBudgetProfile: () => adoptDefaultBudgetProfile,
  claimWelcomeEmail: () => claimWelcomeEmail,
  clearEmCondors: () => clearEmCondors,
  clearEmTracker: () => clearEmTracker,
  clearUserDiscord: () => clearUserDiscord,
  consumePasswordReset: () => consumePasswordReset,
  countActiveSessions: () => countActiveSessions,
  countDashboardLayouts: () => countDashboardLayouts,
  countUsers: () => countUsers,
  countWaitlist: () => countWaitlist,
  createUser: () => createUser,
  deleteAllSessionsForUser: () => deleteAllSessionsForUser,
  deleteAmazonRow: () => deleteAmazonRow,
  deleteBudgetCategory: () => deleteBudgetCategory,
  deleteBzilaAlert: () => deleteBzilaAlert,
  deleteDashboardLayout: () => deleteDashboardLayout,
  deleteEmCondor: () => deleteEmCondor,
  deleteEmTrackerRow: () => deleteEmTrackerRow,
  deleteExpiredSessions: () => deleteExpiredSessions,
  deletePropRow: () => deletePropRow,
  deleteRecurring: () => deleteRecurring,
  deleteRegisterByTag: () => deleteRegisterByTag,
  deleteRegisterRow: () => deleteRegisterRow,
  deleteRetaSetup: () => deleteRetaSetup,
  deleteRetaShot: () => deleteRetaShot,
  deleteSession: () => deleteSession,
  deleteSnapshot: () => deleteSnapshot,
  deleteTradingJournal: () => deleteTradingJournal,
  deleteWatchOption: () => deleteWatchOption,
  ensureBzilaSnapshotsTable: () => ensureBzilaSnapshotsTable,
  ensureEsCandlesTable: () => ensureEsCandlesTable,
  ensureExpirationsTable: () => ensureExpirationsTable,
  ensureFlowCallsTable: () => ensureFlowCallsTable,
  ensureGreeksTsTable: () => ensureGreeksTsTable,
  ensureMvcTable: () => ensureMvcTable,
  ensurePremiumFlowTable: () => ensurePremiumFlowTable,
  getBzilaAlertCounts: () => getBzilaAlertCounts,
  getBzilaAlertReport: () => getBzilaAlertReport,
  getBzilaAlerts: () => getBzilaAlerts,
  getBzilaNote: () => getBzilaNote,
  getBzilaSnapshots: () => getBzilaSnapshots,
  getCachedExpirations: () => getCachedExpirations,
  getCustomerActivity: () => getCustomerActivity,
  getDailyBalanceBefore: () => getDailyBalanceBefore,
  getDailyStrategy: () => getDailyStrategy,
  getDailyStrategyHistory: () => getDailyStrategyHistory,
  getDashboardLayouts: () => getDashboardLayouts,
  getPagePresets: () => getPagePresets,
  getDb: () => getDb,
  getEmBandsForWeek: () => getEmBandsForWeek,
  getEmCondorMarks: () => getEmCondorMarks,
  getEmCondorSummary: () => getEmCondorSummary,
  getEmCondorTicks: () => getEmCondorTicks,
  getEmCondors: () => getEmCondors,
  getEmCondorsUnsettled: () => getEmCondorsUnsettled,
  getEmTrackerPendingForWeek: () => getEmTrackerPendingForWeek,
  getEmTrackerRows: () => getEmTrackerRows,
  getEmTrackerSummary: () => getEmTrackerSummary,
  getEmTrackerUnevaluated: () => getEmTrackerUnevaluated,
  getEodGex: () => getEodGex,
  getEsCandles: () => getEsCandles,
  getEsGap: () => getEsGap,
  getFlowCalls: () => getFlowCalls,
  getGradedConfidenceLog: () => getGradedConfidenceLog,
  getGreeksTs: () => getGreeksTs,
  getIbDailyResults: () => getIbDailyResults,
  getIbLevels: () => getIbLevels,
  getIbTrailingStats: () => getIbTrailingStats,
  getIctCardPrefs: () => getIctCardPrefs,
  getIctSetupSummary: () => getIctSetupSummary,
  getIctSetups: () => getIctSetups,
  getLatestBzilaSnapshot: () => getLatestBzilaSnapshot,
  getLatestDailyBalance: () => getLatestDailyBalance,
  getLatestDailyStrategy: () => getLatestDailyStrategy,
  getLatestHomeStaticSnapshot: () => getLatestHomeStaticSnapshot,
  getLatestMultGreekStaticSnapshot: () => getLatestMultGreekStaticSnapshot,
  getLatestPremarketSummary: () => getLatestPremarketSummary,
  getLatestPreviewSnapshot: () => getLatestPreviewSnapshot,
  getLatestTdOverview: () => getLatestTdOverview,
  getLatestWatchSnapshots: () => getLatestWatchSnapshots,
  getMomentumBiasSignals: () => getMomentumBiasSignals,
  getMomentumBiasSummary: () => getMomentumBiasSummary,
  getMvcSnapshots: () => getMvcSnapshots,
  getNqCandles: () => getNqCandles,
  // hand-added with the option_strike_gex_history symbol patch below
  normGexSymbol: () => normGexSymbol,
  getOptionStrikeGexSlots: () => getOptionStrikeGexSlots,
  getOptionStrikeGexSlotsWindow: () => getOptionStrikeGexSlotsWindow,
  getOptionStrikeGexSlotsWindowAny: () => getOptionStrikeGexSlotsWindowAny,
  getOptionStrikeNetGexAsOf: () => getOptionStrikeNetGexAsOf,
  getOptionStrikeNetGexAsOfOrNearest: () => getOptionStrikeNetGexAsOfOrNearest,
  getOptionStrikeNetGexAtOpen: () => getOptionStrikeNetGexAtOpen,
  getOptionStrikeRollingNetGex: () => getOptionStrikeRollingNetGex,
  getOrCreateBudgetProfile: () => getOrCreateBudgetProfile,
  getPageLoadStatus: () => getPageLoadStatus,
  getPendingIctSetups: () => getPendingIctSetups,
  getPlaybookFeed: () => getPlaybookFeed,
  getPool: () => getPool,
  getPositioningTickers: () => getPositioningTickers,
  getPremarketSummary: () => getPremarketSummary,
  getPremiumFlow: () => getPremiumFlow,
  getPageVisitStats: () => getPageVisitStats,
  getPageVisitsSince: () => getPageVisitsSince,
  getPromoCode: () => getPromoCode,
  getQuoteSymbols: () => getQuoteSymbols,
  getRecentPageVisits: () => getRecentPageVisits,
  getRecentTrades: () => getRecentTrades,
  getSessionWithUser: () => getSessionWithUser,
  getSnapshots: () => getSnapshots,
  getSubscription: () => getSubscription,
  getSubscriptionByCustomer: () => getSubscriptionByCustomer,
  getSubscriptionCancellations: () => getSubscriptionCancellations,
  getTdOverview: () => getTdOverview,
  getTdPrefs: () => getTdPrefs,
  getTickerEventCounts: () => getTickerEventCounts,
  getTradeOverrides: () => getTradeOverrides,
  getTradesByDate: () => getTradesByDate,
  getTradingFills: () => getTradingFills,
  getTradingJournals: () => getTradingJournals,
  getUnsubscribedSet: () => getUnsubscribedSet,
  getUserByEmail: () => getUserByEmail,
  getUserByGoogleSub: () => getUserByGoogleSub,
  getUserById: () => getUserById,
  getUserBzilaReactions: () => getUserBzilaReactions,
  getWatchHistory: () => getWatchHistory,
  getWatchHistorySince: () => getWatchHistorySince,
  getWatchOptions: () => getWatchOptions,
  insertAmazonRow: () => insertAmazonRow,
  insertBudgetEntry: () => insertBudgetEntry,
  insertBzilaAlert: () => insertBzilaAlert,
  insertBzilaSnapshot: () => insertBzilaSnapshot,
  insertDailyStrategyHistory: () => insertDailyStrategyHistory,
  insertEmCondorTicks: () => insertEmCondorTicks,
  insertFlowCalls: () => insertFlowCalls,
  insertGreeksTs: () => insertGreeksTs,
  insertHomeStaticSnapshot: () => insertHomeStaticSnapshot,
  insertIctSetup: () => insertIctSetup,
  insertMultGreekStaticSnapshot: () => insertMultGreekStaticSnapshot,
  insertMvcSnapshot: () => insertMvcSnapshot,
  insertOptionStrikeGexRows: () => insertOptionStrikeGexRows,
  insertPageVisit: () => insertPageVisit,
  insertPasswordReset: () => insertPasswordReset,
  insertPlaybookFeed: () => insertPlaybookFeed,
  insertPremiumFlow: () => insertPremiumFlow,
  insertPreviewSnapshot: () => insertPreviewSnapshot,
  insertPropRow: () => insertPropRow,
  insertRecurring: () => insertRecurring,
  insertRegisterRow: () => insertRegisterRow,
  deleteRegisterRowsInWindow: () => deleteRegisterRowsInWindow,
  listRegisterInsertBatches: () => listRegisterInsertBatches,
  listRegisterRowsInWindow: () => listRegisterRowsInWindow,
  clearStatementMonth: () => clearStatementMonth,
  deleteStatementTx: () => deleteStatementTx,
  insertStatementTx: () => insertStatementTx,
  listStatementMonths: () => listStatementMonths,
  listStatementTx: () => listStatementTx,
  listSubscriptions: () => listSubscriptions,
  getBudgetAdvice: () => getBudgetAdvice,
  upsertBudgetAdvice: () => upsertBudgetAdvice,
  setStatementCategoriesBulk: () => setStatementCategoriesBulk,
  setStatementCategoryByMerchant: () => setStatementCategoryByMerchant,
  setStatementTxCategory: () => setStatementTxCategory,
  updateStatementTx: () => updateStatementTx,
  upsertSubscription: () => upsertSubscription,
  insertSession: () => insertSession,
  insertTickerEvent: () => insertTickerEvent,
  insertTradingFills: () => insertTradingFills,
  insertTradingJournal: () => insertTradingJournal,
  insertWatchOption: () => insertWatchOption,
  insertWatchSnapshot: () => insertWatchSnapshot,
  linkStripeCustomer: () => linkStripeCustomer,
  listAllUsersForBroadcast: () => listAllUsersForBroadcast,
  listAmazonRows: () => listAmazonRows,
  listBudgetCategories: () => listBudgetCategories,
  listBudgetEntries: () => listBudgetEntries,
  listBudgetProfiles: () => listBudgetProfiles,
  listDiscordConnections: () => listDiscordConnections,
  listEmailSends: () => listEmailSends,
  listFarCbTickers: () => listFarCbTickers,
  listFeedback: () => listFeedback,
  listPromoCodes: () => listPromoCodes,
  listPropRows: () => listPropRows,
  listRecentUsers: () => listRecentUsers,
  listRecurring: () => listRecurring,
  listRegister: () => listRegister,
  listRetaSetups: () => listRetaSetups,
  listRetaShots: () => listRetaShots,
  listRetaWeekNotes: () => listRetaWeekNotes,
  listSalesExpenses: () => listSalesExpenses,
  listUnsubscribes: () => listUnsubscribes,
  listUsersWithLastLogin: () => listUsersWithLastLogin,
  listWaitlist: () => listWaitlist,
  markUserEmailVerified: () => markUserEmailVerified,
  persistDb: () => persistDb,
  pgQuery: () => pgQuery,
  postEsGap: () => postEsGap,
  pruneEmCondorTicks: () => pruneEmCondorTicks,
  queryAll: () => queryAll,
  queryOne: () => queryOne,
  recordSubscriptionCancellation: () => recordSubscriptionCancellation,
  reactBzilaAlert: () => reactBzilaAlert,
  removeSalesExpense: () => removeSalesExpense,
  removeUnsubscribe: () => removeUnsubscribe,
  reopenEmCondor: () => reopenEmCondor,
  savePromoCode: () => savePromoCode,
  saveSnapshot: () => saveSnapshot,
  setDefaultDashboardLayout: () => setDefaultDashboardLayout,
  setEmCondorSettlement: () => setEmCondorSettlement,
  setEmTrackerResult: () => setEmTrackerResult,
  setFeedbackStatus: () => setFeedbackStatus,
  setRegisterCategory: () => setRegisterCategory,
  setUserDiscord: () => setUserDiscord,
  setUserGoogleSub: () => setUserGoogleSub,
  setWatchAddedPrice: () => setWatchAddedPrice,
  unsubscribeWaitlistEmail: () => unsubscribeWaitlistEmail,
  updateBzilaAlert: () => updateBzilaAlert,
  updateEmTrackerOhlc: () => updateEmTrackerOhlc,
  updateEsGapFill: () => updateEsGapFill,
  updateIctSetupGrade: () => updateIctSetupGrade,
  updatePropRow: () => updatePropRow,
  updateRecurring: () => updateRecurring,
  updateRegisterRow: () => updateRegisterRow,
  updateTradingJournal: () => updateTradingJournal,
  updateUserPasswordHash: () => updateUserPasswordHash,
  upsertBudgetCategory: () => upsertBudgetCategory,
  upsertBzilaNote: () => upsertBzilaNote,
  upsertConfidenceLog: () => upsertConfidenceLog,
  upsertDailyBalance: () => upsertDailyBalance,
  upsertDailyStrategy: () => upsertDailyStrategy,
  upsertDashboardLayout: () => upsertDashboardLayout,
  upsertEmCondor: () => upsertEmCondor,
  upsertEmCondorMarks: () => upsertEmCondorMarks,
  upsertEmTrackerRow: () => upsertEmTrackerRow,
  upsertEodGex: () => upsertEodGex,
  upsertEsCandle: () => upsertEsCandle,
  upsertExpirationCache: () => upsertExpirationCache,
  upsertIbDailyResult: () => upsertIbDailyResult,
  upsertIbLevels: () => upsertIbLevels,
  upsertIctCardPrefs: () => upsertIctCardPrefs,
  upsertNqCandle: () => upsertNqCandle,
  upsertPageLoadStatus: () => upsertPageLoadStatus,
  upsertPositioningTickers: () => upsertPositioningTickers,
  upsertPremarketSummary: () => upsertPremarketSummary,
  upsertQuoteSymbols: () => upsertQuoteSymbols,
  upsertRetaSetup: () => upsertRetaSetup,
  upsertRetaShot: () => upsertRetaShot,
  upsertRetaWeekNote: () => upsertRetaWeekNote,
  upsertSubscription: () => upsertSubscription,
  upsertTdOverview: () => upsertTdOverview,
  upsertTdPrefs: () => upsertTdPrefs,
  upsertTradeOverride: () => upsertTradeOverride,
  upsertTradingJournalDay: () => upsertTradingJournalDay
});
module.exports = __toCommonJS(db_exports);
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
    -- acquisition data. Non-entry rows keep NULL here BY DESIGN \u2014 that is the
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
    -- EVERY request \u2014 so unlike attribution these are written on every row.
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

    -- Real Month: transactions read off an ACTUAL bank/card statement.
    -- Deliberately separate from budget_register. The register is the PLAN
    -- (what you expect to pay, plus recurring rules projected forward); this is
    -- what actually cleared. Writing statement rows into the register would
    -- double-count every dollar that appears in both, so the two never mix and
    -- Overview/Payments never read this table.
    -- dedupe_key makes a re-import of an overlapping statement a no-op.
    CREATE TABLE IF NOT EXISTS budget_statement_tx (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      tx_date TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      merchant TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      direction TEXT NOT NULL DEFAULT 'out',
      category_id INTEGER REFERENCES budget_categories(id) ON DELETE SET NULL,
      is_recurring INTEGER NOT NULL DEFAULT 0,
      bank TEXT NOT NULL DEFAULT 'secu',
      source TEXT,
      dedupe_key TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, dedupe_key)
    );
    CREATE INDEX IF NOT EXISTS idx_budget_statement_tx_month ON budget_statement_tx(profile_id, month);

    -- One verdict per merchant, kept across imports: keep / cancel / watch.
    -- 'cancel' rows roll up into the "if you killed these" savings number.
    -- pushed_recurring_id records that this subscription was pushed into the
    -- Payments register as a recurring rule, so the button can't fire twice.
    CREATE TABLE IF NOT EXISTS budget_subscription (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
      merchant_key TEXT NOT NULL,
      merchant TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'watch',
      note TEXT,
      pushed_recurring_id INTEGER,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, merchant_key)
    );
    CREATE INDEX IF NOT EXISTS idx_budget_subscription_profile ON budget_subscription(profile_id);

    -- The last "what to fix" pass for a month, kept so the conclusion survives
    -- a reload and a month switch. One row per month: re-running overwrites it,
    -- which is exactly the "stays until a new one shows up" behaviour.
    CREATE TABLE IF NOT EXISTS budget_advice (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      headline TEXT NOT NULL DEFAULT '',
      findings JSONB NOT NULL DEFAULT '[]'::jsonb,
      quick_wins JSONB NOT NULL DEFAULT '[]'::jsonb,
      model TEXT,
      generated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, month)
    );

    -- \u2500\u2500 Reta (retatrutide) protocol tracker \u2014 owner-only \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    -- Reconstitution changes week to week, so each recon is its own row keyed by
    -- the Sunday it takes effect. A shot resolves the setup with the greatest
    -- effective_from <= its own date, which is why editing this week's recon can
    -- never rewrite the math of a week already logged.
    CREATE TABLE IF NOT EXISTS reta_setups (
      id SERIAL PRIMARY KEY,
      effective_from TEXT NOT NULL UNIQUE,
      vial_mg REAL NOT NULL DEFAULT 10,
      bac_ml REAL NOT NULL DEFAULT 2,
      syringe_units INTEGER NOT NULL DEFAULT 100,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    -- One row per person per shot date (shot day is Sunday). dose_mg is what was
    -- actually drawn; units/mL are DERIVED from the recon in force at render
    -- time, never stored, so correcting a recon fixes that whole week at once.
    CREATE TABLE IF NOT EXISTS reta_shots (
      id SERIAL PRIMARY KEY,
      shot_date TEXT NOT NULL,
      person TEXT NOT NULL,
      dose_mg REAL NOT NULL DEFAULT 0,
      weight_lb REAL,
      taken INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (shot_date, person)
    );
    CREATE INDEX IF NOT EXISTS idx_reta_shots_date ON reta_shots(shot_date);

    -- One free-text note per week, shared by both people (sides, skips, refills).
    CREATE TABLE IF NOT EXISTS reta_week_notes (
      shot_date TEXT PRIMARY KEY,
      note TEXT,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

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
    -- Strikes are seeded Monday from the EM band (short put \u2248 ref\u2212EM, short call
    -- \u2248 ref+EM, snapped to the ticker's strike increment) and are editable.
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
      pnl REAL,              -- dollars, net of credit, \xD7 contracts \xD7 multiplier
      result TEXT,           -- 'win' | 'loss' | NULL (not settled)
      outcome TEXT,          -- 'max_win' | 'partial_win' | 'partial_loss' | 'max_loss'
      breached_side TEXT,    -- 'put' | 'call' | NULL \u2014 which short expired ITM
      touched_side TEXT,     -- 'put' | 'call' | 'both' | NULL \u2014 short tagged intraweek
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
    -- rolls the hourly em_condor_ticks up into one row per session (the last
    -- tick that priced all four legs becomes that day's close).
    --   mark     = (put_short \u2212 put_long) + (call_short \u2212 call_long)  [debit to close]
    --   open_pnl = (net_credit \u2212 mark) \xD7 multiplier \xD7 contracts
    --   cushion  = underlying close \u2192 nearer SHORT strike (+ inside, \u2212 beyond)
    -- legs_priced < 4 means the mark is NULL: a partial condor is a different
    -- position, not an estimate of this one. Futures rows carry underlying and
    -- cushion only (no options chain for the futures roots).
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
      source TEXT DEFAULT 'tt',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_em_condor_marks_condor ON em_condor_marks(condor_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_em_condor_marks_condor_day
      ON em_condor_marks(condor_id, d);

    -- Intraday condor ticks, written at the top of each RTH hour by
    -- server-v2/condor-mark-recorder.js. Same value columns as em_condor_marks
    -- but priced from the LIVE TastyTrade chain NBBO mid, keyed by epoch-ms so
    -- a week holds ~35 points instead of 5. em_condor_marks stays the
    -- authoritative daily series and is ROLLED UP FROM THESE ROWS (last 4-leg
    -- tick of each ET session) \u2014 TastyTrade sells no per-contract daily option
    -- history, so a missed hour cannot be backfilled later.
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
      source TEXT DEFAULT 'tt',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_em_condor_ticks_condor_ts ON em_condor_ticks(condor_id, ts);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_em_condor_ticks_condor_ts
      ON em_condor_ticks(condor_id, ts);

    -- EOD GEX snapshot: one row per (date, symbol), upserted at 3:55\u20134:05 ET.
    -- total_gex   signed net GEX \u2014 MIXED BASIS across sources, kept for
    --             back-compat only. It was originally "same as the dashboard
    --             header", but the PM ladder, AM settled pass and header
    --             fallback all write it on different scopes/bases. Chart
    --             total_gex_0dte / total_gex_ex0dte instead (both OI+Vol, one
    --             definition each) \u2014 see the COLUMN BASES block at the top of
    --             server-v2/eod-gex-recorder.js.
    -- spot        underlying price at compute time
    -- computed_at ISO timestamp of the actual computation
    -- NOTE: total_flow_gex, source, total_gex_ex0dte, total_gex_0dte and the
    -- pin_* columns are added idempotently by that recorder's ensureColumns(),
    -- which predates this DDL \u2014 they are intentionally not repeated here.
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

    -- Churn log. One row per subscription that has ever signalled it is leaving,
    -- written by the Stripe webhook (app/api/stripe/webhook/route.ts).
    --
    -- WHY THIS EXISTS: cancellation reasons used to live ONLY in Stripe. The
    -- owner Sales page read cancellation_details live off the API on every
    -- load, so the whole churn history was one API change / account change /
    -- Stripe retention window away from vanishing, and none of it was
    -- queryable next to our own users table. Stripe hands us the reason for
    -- free on customer.subscription.updated \u2014 this keeps a copy.
    --
    -- reason   = Stripe's cancellation_details.reason: why the sub ended at all
    --            ('cancellation_requested' | 'payment_failed' | 'payment_disputed').
    --            'payment_failed' is involuntary churn \u2014 a dead card, not a
    --            customer who chose to leave. The two need different follow-up.
    -- feedback = what the customer picked in the portal survey (too_expensive,
    --            missing_features, switched_service, unused, customer_service,
    --            too_complex, low_quality, other). NULL is normal and expected:
    --            Stripe shows that survey AFTER the cancellation is committed,
    --            so it is always skippable.
    -- comment  = the optional free text, only offered behind "Other reason".
    --
    -- reactivated_at: a customer who cancels at period end can un-cancel before
    -- it lands. The row stays (the intent to leave is real signal) but is
    -- stamped, so churn counts can exclude it instead of over-reporting.
    CREATE TABLE IF NOT EXISTS subscription_cancellations (
      stripe_subscription_id TEXT PRIMARY KEY,
      clerk_user_id          TEXT,
      stripe_customer_id     TEXT,
      customer_email         TEXT,
      status                 TEXT,
      cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE,
      reason                 TEXT,
      feedback               TEXT,
      comment                TEXT,
      price_id               TEXT,
      /* Epoch seconds, matching Stripe's own fields rather than converting. */
      canceled_at            BIGINT,
      ended_at               BIGINT,
      reactivated_at         TIMESTAMPTZ,
      first_seen_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at             TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sub_cancel_user ON subscription_cancellations(clerk_user_id);
    CREATE INDEX IF NOT EXISTS idx_sub_cancel_seen ON subscription_cancellations(first_seen_at DESC);

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

    -- Saved dashboard card layouts ("templates"), per user PER PAGE. A page
    -- (e.g. 'options') renders its cards through components/shared/DashGrid,
    -- which emits an array of { id, x, y, w, h } grid items; that array is what
    -- the layout column holds. Multiple named templates per page are allowed
    -- and exactly one may be flagged is_default \u2014 that is the one the page
    -- auto-loads. No row for a (user, page) = the page falls back to its
    -- built-in layout, so this table is additive and never has to be seeded.
    CREATE TABLE IF NOT EXISTS dashboard_layouts (
      id            SERIAL PRIMARY KEY,
      clerk_user_id TEXT NOT NULL,
      page          TEXT NOT NULL,           -- route key, e.g. 'options'
      name          TEXT NOT NULL,           -- user-facing template name
      layout        JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_default    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (clerk_user_id, page, name)
    );
    CREATE INDEX IF NOT EXISTS idx_dashboard_layouts_user_page
      ON dashboard_layouts(clerk_user_id, page);

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
async function getQuoteSymbols(clerkUserId) {
  await getDb();
  const row = await queryOne(
    `SELECT symbols FROM quote_symbol_prefs WHERE clerk_user_id = ?`,
    [clerkUserId]
  );
  if (!row) return [];
  const s = row.symbols;
  const arr = typeof s === "string" ? JSON.parse(s) : s;
  if (!Array.isArray(arr)) return [];
  return arr.filter((x) => !!x && typeof x.sym === "string").map((x) => ({ sym: String(x.sym), label: String(x.label ?? x.sym) }));
}
async function upsertQuoteSymbols(clerkUserId, symbols) {
  await getDb();
  await queryAll(
    `INSERT INTO quote_symbol_prefs (clerk_user_id, symbols, updated_at)
     VALUES (?, ?::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       symbols = EXCLUDED.symbols, updated_at = CURRENT_TIMESTAMP`,
    [clerkUserId, JSON.stringify(symbols)]
  );
}
var DEFAULT_POSITIONING_TICKERS = ["AAPL", "NVDA", "TSLA", "AMD"];
async function getPositioningTickers(clerkUserId) {
  await getDb();
  const row = await queryOne(
    `SELECT tickers FROM positioning_ticker_prefs WHERE clerk_user_id = ?`,
    [clerkUserId]
  );
  if (!row) return [...DEFAULT_POSITIONING_TICKERS];
  const t = row.tickers;
  const arr = typeof t === "string" ? JSON.parse(t) : t;
  const out = Array.isArray(arr) ? arr.map((x) => String(x).toUpperCase()).slice(0, 4) : [];
  while (out.length < 4) out.push(DEFAULT_POSITIONING_TICKERS[out.length]);
  return out;
}
async function upsertPositioningTickers(clerkUserId, tickers) {
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
async function getWatchOptions() {
  await getDb();
  return queryAll(
    `SELECT * FROM watch_options ORDER BY ticker ASC, expiration ASC, strike ASC, side ASC`
  );
}
async function insertWatchOption(r) {
  await getDb();
  const rows = await queryAll(
    `INSERT INTO watch_options (ticker, expiration, strike, side, note)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (ticker, expiration, strike, side)
       DO UPDATE SET note = EXCLUDED.note
     RETURNING *`,
    [r.ticker, r.expiration, r.strike, r.side, r.note ?? null]
  );
  return rows[0];
}
async function deleteWatchOption(id) {
  await getDb();
  await queryAll(`DELETE FROM watch_options WHERE id = ?`, [id]);
}
async function setWatchAddedPrice(id, price) {
  await getDb();
  await queryAll(
    `UPDATE watch_options SET added_price = ? WHERE id = ? AND added_price IS NULL`,
    [price, id]
  );
}
async function getTradingJournals(userId) {
  await getDb();
  return queryAll(
    `SELECT id, date, net_pnl, trades, win_rate, avg_win, avg_loss, profit_factor,
            commissions, notes, kind
       FROM trading_journals
      WHERE user_id = ?
      ORDER BY date ASC, id ASC`,
    [userId]
  );
}
async function insertTradingJournal(userId, j) {
  await getDb();
  const rows = await queryAll(
    `INSERT INTO trading_journals
       (user_id, date, net_pnl, trades, win_rate, avg_win, avg_loss, profit_factor,
        commissions, notes, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id, date, net_pnl, trades, win_rate, avg_win, avg_loss, profit_factor,
               commissions, notes, kind`,
    [
      userId,
      j.date,
      j.net_pnl,
      j.trades,
      j.win_rate,
      j.avg_win,
      j.avg_loss,
      j.profit_factor,
      j.commissions,
      j.notes ?? null,
      j.kind
    ]
  );
  return rows[0];
}
async function updateTradingJournal(userId, id, j) {
  await getDb();
  const rows = await queryAll(
    `UPDATE trading_journals
        SET date = ?, net_pnl = ?, trades = ?, win_rate = ?, avg_win = ?, avg_loss = ?,
            profit_factor = ?, commissions = ?, notes = ?,
            kind = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
      RETURNING id, date, net_pnl, trades, win_rate, avg_win, avg_loss, profit_factor,
                commissions, notes, kind`,
    [
      j.date,
      j.net_pnl,
      j.trades,
      j.win_rate,
      j.avg_win,
      j.avg_loss,
      j.profit_factor,
      j.commissions,
      j.notes ?? null,
      j.kind,
      id,
      userId
    ]
  );
  return rows[0];
}
async function deleteTradingJournal(userId, id) {
  await getDb();
  await queryAll(`DELETE FROM trading_journals WHERE id = ? AND user_id = ?`, [id, userId]);
}
async function upsertTradingJournalDay(userId, j) {
  await getDb();
  const rows = await queryAll(
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
    [
      userId,
      j.date,
      j.net_pnl,
      j.trades,
      j.win_rate,
      j.avg_win,
      j.avg_loss,
      j.profit_factor,
      j.commissions,
      j.notes ?? null,
      j.kind
    ]
  );
  return rows[0];
}
async function insertTradingFills(userId, fills) {
  if (!fills.length) return 0;
  const pool = await getDb();
  const COLS = 14;
  const values = [];
  const tuples = fills.map((f, i) => {
    values.push(
      userId,
      f.date,
      f.ts,
      f.symbol,
      f.underlying,
      f.asset_type,
      f.side,
      f.qty,
      f.price,
      f.fees,
      f.multiplier,
      f.source,
      f.ext_id,
      f.account ?? ""
    );
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
async function getTradingFills(userId, date) {
  await getDb();
  const sql = date ? `SELECT date, ts, symbol, underlying, asset_type, side, qty, price, fees, multiplier, source, ext_id, account
         FROM trading_fills WHERE user_id = ? AND date = ? ORDER BY ts ASC` : `SELECT date, ts, symbol, underlying, asset_type, side, qty, price, fees, multiplier, source, ext_id, account
         FROM trading_fills WHERE user_id = ? ORDER BY ts ASC`;
  const rows = await queryAll(sql, date ? [userId, date] : [userId]);
  return rows.map((r) => ({
    ...r,
    ts: Number(r.ts),
    qty: Number(r.qty),
    price: Number(r.price),
    fees: Number(r.fees),
    multiplier: Number(r.multiplier),
    account: r.account ?? ""
  }));
}
async function getTradeOverrides(userId) {
  await getDb();
  const rows = await queryAll(
    `SELECT open_ext_id, close_ext_id, symbol, underlying, asset_type, direction,
            open_ts, close_ts, date, qty, entry, exit, fees, pnl, account, deleted
       FROM trading_trade_overrides WHERE user_id = ?`,
    [userId]
  );
  const map = /* @__PURE__ */ new Map();
  for (const r of rows) {
    map.set(`${r.open_ext_id}|${r.close_ext_id}`, {
      ...r,
      open_ts: Number(r.open_ts),
      close_ts: Number(r.close_ts),
      qty: Number(r.qty),
      entry: Number(r.entry),
      exit: Number(r.exit),
      fees: Number(r.fees),
      pnl: Number(r.pnl)
    });
  }
  return map;
}
async function upsertTradeOverride(userId, o) {
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
    [
      userId,
      o.open_ext_id,
      o.close_ext_id,
      o.symbol,
      o.underlying,
      o.asset_type,
      o.direction,
      o.open_ts,
      o.close_ts,
      o.date,
      o.qty,
      o.entry,
      o.exit,
      o.fees,
      o.pnl,
      o.account,
      o.deleted
    ]
  );
}
async function insertWatchSnapshot(s) {
  await getDb();
  await queryAll(
    `INSERT INTO watch_snapshots
       (watch_id, ts, spot, bid, ask, mark, last, iv, delta, gamma, theta, vega, open_interest, volume, net_prem, prev_close, net_gex)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      s.watch_id,
      s.ts,
      realOrNull(s.spot),
      realOrNull(s.bid),
      realOrNull(s.ask),
      realOrNull(s.mark),
      realOrNull(s.last),
      realOrNull(s.iv),
      realOrNull(s.delta),
      realOrNull(s.gamma),
      realOrNull(s.theta),
      realOrNull(s.vega),
      realOrNull(s.open_interest),
      realOrNull(s.volume),
      realOrNull(s.net_prem),
      realOrNull(s.prev_close),
      realOrNull(s.net_gex)
    ]
  );
}
async function getLatestWatchSnapshots() {
  await getDb();
  return queryAll(
    `SELECT DISTINCT ON (watch_id) *
       FROM watch_snapshots
      ORDER BY watch_id, ts DESC`
  );
}
async function getWatchHistory(watchId, limit = 300) {
  await getDb();
  const rows = await queryAll(
    `SELECT * FROM watch_snapshots WHERE watch_id = ? ORDER BY ts DESC LIMIT ?`,
    [watchId, limit]
  );
  return rows.reverse();
}
async function getWatchHistorySince(watchId, sinceTs, limit = 5e3) {
  await getDb();
  const rows = await queryAll(
    `SELECT * FROM watch_snapshots WHERE watch_id = ? AND ts >= ? ORDER BY ts DESC LIMIT ?`,
    [watchId, sinceTs, limit]
  );
  return rows.reverse();
}
async function getIctCardPrefs(clerkUserId) {
  await getDb();
  const row = await queryOne(
    `SELECT hidden_cards FROM ict_card_prefs WHERE clerk_user_id = ?`,
    [clerkUserId]
  );
  if (!row) return [];
  const hc = row.hidden_cards;
  const arr = typeof hc === "string" ? JSON.parse(hc) : hc;
  return Array.isArray(arr) ? arr.map(String) : [];
}
async function upsertIctCardPrefs(clerkUserId, hiddenCards) {
  await getDb();
  await queryAll(
    `INSERT INTO ict_card_prefs (clerk_user_id, hidden_cards, updated_at)
     VALUES (?, ?::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       hidden_cards = EXCLUDED.hidden_cards, updated_at = CURRENT_TIMESTAMP`,
    [clerkUserId, JSON.stringify(hiddenCards)]
  );
}
function parseLayoutJson(value) {
  const v = typeof value === "string" ? safeJsonParse(value) : value;
  return Array.isArray(v) ? v : [];
}
function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
async function getDashboardLayouts(clerkUserId, page) {
  await getDb();
  const rows = await queryAll(
    `SELECT name, layout, is_default, updated_at
       FROM dashboard_layouts
      WHERE clerk_user_id = ? AND page = ?
      ORDER BY is_default DESC, updated_at DESC NULLS LAST, name ASC`,
    [clerkUserId, page]
  );
  return rows.map((r) => ({
    name: r.name,
    layout: parseLayoutJson(r.layout),
    isDefault: Boolean(r.is_default),
    updatedAt: r.updated_at ?? null
  }));
}
/**
 * Same rows as getDashboardLayouts, but for the /api/page-preset consumers,
 * whose payload is an OBJECT rather than a GridItem[].
 *
 * Needed because parseLayoutJson above coerces anything non-array to [] — which
 * is correct for the grid pages (a malformed layout must not crash a render)
 * and silently destroys an object preset. Same column, same table, different
 * shape contract, so it gets its own reader instead of a flag.
 */
async function getPagePresets(clerkUserId, page) {
  await getDb();
  const rows = await queryAll(
    `SELECT name, layout, is_default, updated_at
       FROM dashboard_layouts
      WHERE clerk_user_id = ? AND page = ?
      ORDER BY is_default DESC, updated_at DESC NULLS LAST, name ASC`,
    [clerkUserId, page]
  );
  return rows.map((r) => {
    const v = typeof r.layout === "string" ? safeJsonParse(r.layout) : r.layout;
    return {
      name: r.name,
      // null (not {}) when the row holds a grid layout — the route filters
      // these out rather than handing the client an empty preset to apply.
      preset: v && typeof v === "object" && !Array.isArray(v) ? v : null,
      isDefault: Boolean(r.is_default),
      updatedAt: r.updated_at ?? null
    };
  });
}
async function upsertDashboardLayout(clerkUserId, page, name, layout, makeDefault = false) {
  const pool = await getDb();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO dashboard_layouts (clerk_user_id, page, name, layout, is_default, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (clerk_user_id, page, name) DO UPDATE SET
         layout = EXCLUDED.layout,
         is_default = dashboard_layouts.is_default OR EXCLUDED.is_default,
         updated_at = CURRENT_TIMESTAMP`,
      [clerkUserId, page, name, JSON.stringify(layout), makeDefault]
    );
    if (makeDefault) {
      await client.query(
        `UPDATE dashboard_layouts SET is_default = FALSE
          WHERE clerk_user_id = $1 AND page = $2 AND name <> $3 AND is_default`,
        [clerkUserId, page, name]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
    }
    throw err;
  } finally {
    client.release();
  }
}
async function setDefaultDashboardLayout(clerkUserId, page, name) {
  const pool = await getDb();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hit = await client.query(
      `UPDATE dashboard_layouts SET is_default = TRUE, updated_at = CURRENT_TIMESTAMP
        WHERE clerk_user_id = $1 AND page = $2 AND name = $3`,
      [clerkUserId, page, name]
    );
    if (!hit.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      `UPDATE dashboard_layouts SET is_default = FALSE
        WHERE clerk_user_id = $1 AND page = $2 AND name <> $3 AND is_default`,
      [clerkUserId, page, name]
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
    }
    throw err;
  } finally {
    client.release();
  }
}
async function deleteDashboardLayout(clerkUserId, page, name) {
  await getDb();
  await queryAll(
    `DELETE FROM dashboard_layouts WHERE clerk_user_id = ? AND page = ? AND name = ?`,
    [clerkUserId, page, name]
  );
}
async function countDashboardLayouts(clerkUserId, page) {
  await getDb();
  const row = await queryOne(
    `SELECT COUNT(*)::int AS n FROM dashboard_layouts WHERE clerk_user_id = ? AND page = ?`,
    [clerkUserId, page]
  );
  return Number(row?.n ?? 0);
}
async function getTdPrefs(clerkUserId) {
  await getDb();
  return queryOne(`SELECT * FROM td_user_prefs WHERE clerk_user_id = ?`, [clerkUserId]);
}
async function upsertTdPrefs(clerkUserId, fields) {
  await getDb();
  const existing = await getTdPrefs(clerkUserId);
  const zip = fields.zip !== void 0 ? fields.zip : existing?.zip ?? null;
  const schedule = fields.schedule !== void 0 ? fields.schedule : existing?.schedule ?? [];
  const tasks = fields.tasks !== void 0 ? fields.tasks : existing?.tasks ?? [];
  const links = fields.links !== void 0 ? fields.links : existing?.links ?? [];
  await queryAll(
    `INSERT INTO td_user_prefs (clerk_user_id, zip, schedule, tasks, links, updated_at)
     VALUES (?, ?, ?::jsonb, ?::jsonb, ?::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       zip = EXCLUDED.zip, schedule = EXCLUDED.schedule, tasks = EXCLUDED.tasks,
       links = EXCLUDED.links, updated_at = CURRENT_TIMESTAMP`,
    [clerkUserId, zip, JSON.stringify(schedule), JSON.stringify(tasks), JSON.stringify(links)]
  );
}
async function getBzilaNote() {
  await getDb();
  return queryOne(`SELECT content, updated_at FROM bzila_note WHERE id = 1`);
}
async function upsertBzilaNote(content) {
  await getDb();
  await queryAll(
    `INSERT INTO bzila_note (id, content, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP`,
    [content]
  );
}
async function getBzilaAlerts(limit = 5) {
  await getDb();
  const n = Math.min(Math.max(1, Math.floor(limit) || 5), 50);
  return queryAll(
    `SELECT id, title, body, created_at, updated_at
       FROM bzila_alerts ORDER BY id DESC LIMIT ${n}`
  );
}
async function insertBzilaAlert(title, body) {
  await getDb();
  const row = await queryOne(
    `INSERT INTO bzila_alerts (title, body) VALUES (?, ?) RETURNING id`,
    [title, body]
  );
  return row?.id ?? 0;
}
async function updateBzilaAlert(id, title, body) {
  await getDb();
  await queryAll(
    `UPDATE bzila_alerts SET title = ?, body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [title, body, id]
  );
}
async function deleteBzilaAlert(id) {
  await getDb();
  await queryAll(`DELETE FROM bzila_alert_reactions WHERE alert_id = ?`, [id]);
  await queryAll(`DELETE FROM bzila_alerts WHERE id = ?`, [id]);
}
async function reactBzilaAlert(alertId, userId, email, reaction) {
  await getDb();
  const row = await queryOne(
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
async function getBzilaAlertCounts() {
  await getDb();
  return queryAll(
    `SELECT alert_id,
            SUM(CASE WHEN reaction = 'up'   THEN 1 ELSE 0 END)::int AS up,
            SUM(CASE WHEN reaction = 'down' THEN 1 ELSE 0 END)::int AS down
       FROM bzila_alert_reactions
      GROUP BY alert_id`
  );
}
async function getUserBzilaReactions(userId) {
  await getDb();
  const rows = await queryAll(
    `SELECT alert_id, reaction FROM bzila_alert_reactions WHERE user_id = ? AND reaction <> ''`,
    [userId]
  );
  const out = {};
  for (const r of rows) out[r.alert_id] = r.reaction;
  return out;
}
async function getBzilaAlertReport(limit = 50) {
  await getDb();
  const alerts = await getBzilaAlerts(limit);
  if (alerts.length === 0) return [];
  const ids = alerts.map((a) => a.id);
  const placeholders = ids.map(() => "?").join(",");
  const reactions = await queryAll(
    `SELECT alert_id, email, reaction, clicks, updated_at
       FROM bzila_alert_reactions
      WHERE alert_id IN (${placeholders})
      ORDER BY updated_at DESC`,
    ids
  );
  const byAlert = /* @__PURE__ */ new Map();
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
      reactors
    };
  });
}
async function getTdOverview(date) {
  await getDb();
  return queryOne(`SELECT * FROM td_overview WHERE date = ?`, [date]);
}
async function getLatestTdOverview() {
  await getDb();
  return queryOne(`SELECT * FROM td_overview ORDER BY date DESC LIMIT 1`);
}
async function upsertTdOverview(date, summary, drivers, movers = []) {
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
async function getPremarketSummary(date) {
  await getDb();
  return queryOne(`SELECT * FROM premarket_summary WHERE date = ?`, [date]);
}
async function getLatestPremarketSummary() {
  await getDb();
  return queryOne(`SELECT * FROM premarket_summary ORDER BY date DESC LIMIT 1`);
}
async function upsertPremarketSummary(date, bullets) {
  await getDb();
  await queryAll(
    `INSERT INTO premarket_summary (date, bullets, generated_at)
     VALUES (?, ?::jsonb, ?)
     ON CONFLICT (date) DO UPDATE SET
       bullets = EXCLUDED.bullets, generated_at = EXCLUDED.generated_at`,
    [date, JSON.stringify(bullets), Date.now()]
  );
}
async function getDailyStrategy(date) {
  await getDb();
  return queryOne(`SELECT * FROM daily_strategy WHERE date = ?`, [date]);
}
async function getLatestDailyStrategy() {
  await getDb();
  return queryOne(`SELECT * FROM daily_strategy ORDER BY date DESC LIMIT 1`);
}
async function upsertDailyStrategy(date, plan) {
  await getDb();
  await queryAll(
    `INSERT INTO daily_strategy (date, plan, generated_at)
     VALUES (?, ?::jsonb, ?)
     ON CONFLICT (date) DO UPDATE SET
       plan = EXCLUDED.plan, generated_at = EXCLUDED.generated_at`,
    [date, JSON.stringify(plan), Date.now()]
  );
}
async function insertDailyStrategyHistory(date, hour, plan) {
  await getDb();
  await queryAll(
    `INSERT INTO daily_strategy_history (date, hour, plan, generated_at)
     VALUES (?, ?, ?::jsonb, ?)
     ON CONFLICT (date, hour) DO UPDATE SET
       plan = EXCLUDED.plan, generated_at = EXCLUDED.generated_at`,
    [date, hour, JSON.stringify(plan), Date.now()]
  );
}
async function getDailyStrategyHistory(date) {
  await getDb();
  return queryAll(
    `SELECT * FROM daily_strategy_history WHERE date = ? ORDER BY hour ASC`,
    [date]
  );
}
var PAID_STATUSES = /* @__PURE__ */ new Set(["active", "trialing"]);
async function getSubscription(clerkUserId) {
  return queryOne(
    "SELECT * FROM subscriptions WHERE clerk_user_id = ?",
    [clerkUserId]
  );
}
async function getSubscriptionByCustomer(customerId) {
  return queryOne(
    "SELECT * FROM subscriptions WHERE stripe_customer_id = ?",
    [customerId]
  );
}
async function recordSubscriptionCancellation(r) {
  if (!r.stripe_subscription_id) return;
  await pgQuery(
    `INSERT INTO subscription_cancellations
       (stripe_subscription_id, clerk_user_id, stripe_customer_id, customer_email,
        status, cancel_at_period_end, reason, feedback, comment, price_id,
        canceled_at, ended_at, reactivated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET
       clerk_user_id        = COALESCE(EXCLUDED.clerk_user_id,      subscription_cancellations.clerk_user_id),
       stripe_customer_id   = COALESCE(EXCLUDED.stripe_customer_id, subscription_cancellations.stripe_customer_id),
       customer_email       = COALESCE(EXCLUDED.customer_email,     subscription_cancellations.customer_email),
       status               = COALESCE(EXCLUDED.status,             subscription_cancellations.status),
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       -- Never un-learn a reason. See the doc comment above.
       reason               = COALESCE(EXCLUDED.reason,             subscription_cancellations.reason),
       feedback             = COALESCE(EXCLUDED.feedback,           subscription_cancellations.feedback),
       comment              = COALESCE(EXCLUDED.comment,            subscription_cancellations.comment),
       price_id             = COALESCE(EXCLUDED.price_id,           subscription_cancellations.price_id),
       canceled_at          = COALESCE(EXCLUDED.canceled_at,        subscription_cancellations.canceled_at),
       ended_at             = COALESCE(EXCLUDED.ended_at,           subscription_cancellations.ended_at),
       reactivated_at       = EXCLUDED.reactivated_at,
       updated_at           = CURRENT_TIMESTAMP`,
    [
      r.stripe_subscription_id,
      r.clerk_user_id ?? null,
      r.stripe_customer_id ?? null,
      r.customer_email ?? null,
      r.status ?? null,
      Boolean(r.cancel_at_period_end),
      r.reason ?? null,
      r.feedback ?? null,
      r.comment ?? null,
      r.price_id ?? null,
      r.canceled_at ?? null,
      r.ended_at ?? null,
      r.reactivated ? (/* @__PURE__ */ new Date()).toISOString() : null
    ]
  );
}
async function getSubscriptionCancellations(limit = 500) {
  return queryAll(
    `SELECT * FROM subscription_cancellations
      ORDER BY COALESCE(ended_at, canceled_at, 0) DESC, first_seen_at DESC
      LIMIT ?`,
    [limit]
  );
}
async function linkStripeCustomer(clerkUserId, customerId) {
  await pgQuery(
    `INSERT INTO subscriptions (clerk_user_id, stripe_customer_id)
     VALUES ($1, $2)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
       updated_at = CURRENT_TIMESTAMP`,
    [clerkUserId, customerId]
  );
}
async function upsertSubscription(r) {
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
      r.cancel_at_period_end ? 1 : 0
    ]
  );
}
async function claimWelcomeEmail(clerkUserId) {
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
async function getUserByEmail(email) {
  return queryOne(`SELECT * FROM users WHERE lower(email) = lower(?)`, [email]);
}
async function getUserById(id) {
  return queryOne(`SELECT * FROM users WHERE id = ?`, [id]);
}
async function getUserByGoogleSub(googleSub) {
  return queryOne(`SELECT * FROM users WHERE google_sub = ?`, [googleSub]);
}
async function createUser(r) {
  const rows = await queryAll(
    `INSERT INTO users (id, email, password_hash, google_sub, is_owner)
     VALUES (?, ?, ?, ?, ?)
     RETURNING *`,
    [r.id, r.email.trim().toLowerCase(), r.password_hash ?? null, r.google_sub ?? null, !!r.is_owner]
  );
  return rows[0];
}
async function updateUserPasswordHash(id, passwordHash) {
  await pgQuery(`UPDATE users SET password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id, passwordHash]);
}
async function setUserGoogleSub(id, googleSub) {
  await pgQuery(`UPDATE users SET google_sub = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id, googleSub]);
}
async function markUserEmailVerified(id) {
  await pgQuery(`UPDATE users SET email_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND email_verified_at IS NULL`, [id]);
}
async function setUserDiscord(id, discord) {
  await pgQuery(
    `UPDATE users
        SET discord_id = $2, discord_username = $3, discord_avatar = $4,
            discord_connected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [id, discord.discord_id, discord.discord_username, discord.discord_avatar]
  );
}
async function clearUserDiscord(id) {
  await pgQuery(
    `UPDATE users
        SET discord_id = NULL, discord_username = NULL, discord_avatar = NULL,
            discord_connected_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [id]
  );
}
async function countUsers() {
  const row = await queryOne(`SELECT COUNT(*)::text AS count FROM users`);
  return Number(row?.count ?? 0);
}
async function listRecentUsers(limit = 5) {
  return queryAll(`SELECT id, email, created_at FROM users ORDER BY created_at DESC LIMIT ?`, [limit]);
}
async function listUsersWithLastLogin() {
  return queryAll(`
    SELECT u.id, u.email, u.created_at, s.last_login_at
      FROM users u
      LEFT JOIN (
        SELECT user_id, MAX(created_at) AS last_login_at
          FROM sessions
         GROUP BY user_id
      ) s ON s.user_id = u.id
  `);
}
async function listDiscordConnections() {
  return queryAll(`
    SELECT id, email, discord_id, discord_username, discord_avatar, discord_connected_at, is_owner
      FROM users
     WHERE discord_id IS NOT NULL
     ORDER BY discord_connected_at DESC NULLS LAST
  `);
}
async function countActiveSessions() {
  const row = await queryOne(`SELECT COUNT(*)::text AS count FROM sessions WHERE expires_at > NOW()`);
  return Number(row?.count ?? 0);
}
async function listAllUsersForBroadcast() {
  const rows = await queryAll(
    `SELECT u.id, u.email, sub.status
       FROM users u
       LEFT JOIN subscriptions sub ON sub.clerk_user_id = u.id
      ORDER BY u.created_at ASC
      LIMIT 50000`
  );
  return rows.map((r) => ({ userId: r.id, email: r.email, paid: !!r.status && PAID_STATUSES.has(r.status) }));
}
async function insertSession(r) {
  await pgQuery(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip) VALUES ($1,$2,$3,$4,$5)`,
    [r.token_hash, r.user_id, r.expires_at.toISOString(), r.user_agent ?? null, r.ip ?? null]
  );
}
async function getSessionWithUser(tokenHash) {
  return queryOne(
    `SELECT s.user_id, u.email, u.is_owner, s.expires_at,
            COALESCE(sub.status IN ('active','trialing'), FALSE) AS is_paid
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN subscriptions sub ON sub.clerk_user_id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > NOW()`,
    [tokenHash]
  );
}
async function deleteSession(tokenHash) {
  await pgQuery(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}
async function deleteAllSessionsForUser(userId) {
  await pgQuery(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}
async function deleteExpiredSessions() {
  const res = await pgQuery(`DELETE FROM sessions WHERE expires_at <= NOW()`);
  return res.rowCount ?? 0;
}
async function insertPasswordReset(r) {
  await pgQuery(
    `INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1,$2,$3)`,
    [r.token_hash, r.user_id, r.expires_at.toISOString()]
  );
}
async function consumePasswordReset(tokenHash) {
  const rows = await queryAll(
    `UPDATE password_resets SET used_at = CURRENT_TIMESTAMP
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
      RETURNING user_id`,
    [tokenHash]
  );
  return rows[0];
}
async function upsertEmTrackerRow(r) {
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
      r.ticker.toUpperCase(),
      r.week_label,
      r.week_start ?? null,
      r.em,
      r.ref_close ?? null,
      r.up ?? null,
      r.down ?? null,
      r.o ?? null,
      r.h ?? null,
      r.l ?? null,
      r.c ?? null,
      r.result ?? null,
      r.breach ?? null,
      r.breach_day ?? null,
      r.result_source ?? null,
      r.note ?? null
    ]
  );
}
async function updateEmTrackerOhlc(ticker, week_label, ohlc) {
  const pool = await getDb();
  await pool.query(
    `UPDATE em_tracker SET
       o = COALESCE($3, o), h = COALESCE($4, h), l = COALESCE($5, l), c = COALESCE($6, c),
       updated_at = CURRENT_TIMESTAMP
     WHERE ticker = $1 AND week_label = $2`,
    [ticker.toUpperCase(), week_label, ohlc.o ?? null, ohlc.h ?? null, ohlc.l ?? null, ohlc.c ?? null]
  );
}
async function getEmTrackerRows(ticker) {
  if (ticker) {
    return queryAll(
      `SELECT * FROM em_tracker WHERE ticker = ? ORDER BY week_start DESC NULLS LAST, week_label DESC`,
      [ticker.toUpperCase()]
    );
  }
  return queryAll(
    `SELECT * FROM em_tracker ORDER BY week_start DESC NULLS LAST, ticker ASC`
  );
}
async function getEmTrackerPendingForWeek(week_start) {
  return queryAll(
    `SELECT * FROM em_tracker
      WHERE week_start = ? AND result IS NULL AND em IS NOT NULL
      ORDER BY ticker ASC`,
    [week_start]
  );
}
async function getEmTrackerSummary() {
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
    latest_week: r.latest_week ?? null
  }));
}
async function getEmTrackerUnevaluated() {
  return queryAll(
    `SELECT * FROM em_tracker
      WHERE result IS NULL AND em IS NOT NULL AND ref_close IS NOT NULL
        AND h IS NOT NULL AND l IS NOT NULL
      ORDER BY week_start ASC NULLS LAST, ticker ASC`
  );
}
async function setEmTrackerResult(id, result, source = "auto") {
  const pool = await getDb();
  await pool.query(
    `UPDATE em_tracker SET result = $2, result_source = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id, result, source]
  );
}
async function deleteEmTrackerRow(id) {
  const pool = await getDb();
  await pool.query(`DELETE FROM em_tracker WHERE id = $1`, [id]);
}
async function clearEmTracker(source) {
  const pool = await getDb();
  const res = source ? await pool.query(`DELETE FROM em_tracker WHERE result_source = $1`, [source]) : await pool.query(`DELETE FROM em_tracker`);
  return res.rowCount ?? 0;
}
var CONDOR_COLS = [
  "ticker",
  "week_label",
  "week_start",
  "ref_price",
  "em",
  "put_long",
  "put_short",
  "call_short",
  "call_long",
  "put_credit",
  "call_credit",
  "net_credit",
  "contracts",
  "multiplier",
  "settle_price",
  "intrinsic",
  "pnl",
  "result",
  "outcome",
  "breached_side",
  "touched_side",
  "result_source",
  "note"
];
async function upsertEmCondor(r, clear = []) {
  const pool = await getDb();
  const values = [
    r.ticker.toUpperCase(),
    r.week_label,
    r.week_start,
    r.ref_price ?? null,
    r.em ?? null,
    r.put_long ?? null,
    r.put_short ?? null,
    r.call_short ?? null,
    r.call_long ?? null,
    r.put_credit ?? null,
    r.call_credit ?? null,
    r.net_credit ?? null,
    r.contracts ?? null,
    r.multiplier ?? null,
    r.settle_price ?? null,
    r.intrinsic ?? null,
    r.pnl ?? null,
    r.result ?? null,
    r.outcome ?? null,
    r.breached_side ?? null,
    r.touched_side ?? null,
    r.result_source ?? null,
    r.note ?? null
  ];
  const placeholders = CONDOR_COLS.map((_, i) => `$${i + 1}`).join(",");
  const updates = CONDOR_COLS.filter((c) => c !== "ticker" && c !== "week_start").map((c) => clear.includes(c) ? `${c} = EXCLUDED.${c}` : `${c} = COALESCE(EXCLUDED.${c}, em_condors.${c})`).join(",\n       ");
  await pool.query(
    `INSERT INTO em_condors (${CONDOR_COLS.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT(ticker, week_start) DO UPDATE SET
       ${updates},
       updated_at = CURRENT_TIMESTAMP`,
    values
  );
}
async function getEmCondors(opts = {}) {
  const where = [];
  const params = [];
  if (opts.ticker) {
    params.push(opts.ticker.toUpperCase());
    where.push(`c.ticker = $${params.length}`);
  }
  if (opts.week_start) {
    params.push(opts.week_start);
    where.push(`c.week_start = $${params.length}`);
  }
  const sql = `
    SELECT c.*, e.h AS wk_high, e.l AS wk_low, e.c AS wk_close, e.result AS em_result
      FROM em_condors c
      LEFT JOIN em_tracker e
        ON e.ticker = c.ticker AND e.week_start = c.week_start
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY c.week_start DESC, c.ticker ASC`;
  const res = await pgQuery(sql, params);
  return res.rows;
}
async function getEmCondorsUnsettled(week_start) {
  const params = [];
  let weekClause = "";
  if (week_start) {
    params.push(week_start);
    weekClause = `AND c.week_start = $${params.length}`;
  }
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
  return res.rows;
}
async function getEmBandsForWeek(week_start) {
  return queryAll(
    `SELECT * FROM em_tracker
      WHERE week_start = ? AND (up IS NOT NULL OR (ref_close IS NOT NULL AND em IS NOT NULL))
      ORDER BY ticker ASC`,
    [week_start]
  );
}
async function setEmCondorSettlement(id, s) {
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
    [
      id,
      s.settle_price ?? null,
      s.intrinsic ?? null,
      s.pnl ?? null,
      s.result,
      s.outcome ?? null,
      s.breached_side ?? null,
      s.touched_side ?? null,
      s.source ?? "auto"
    ]
  );
}
async function reopenEmCondor(id) {
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
async function getEmCondorSummary() {
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
      max_losses: Number(r.max_losses ?? 0)
    };
  });
}
async function upsertEmCondorMarks(condor_id, marks) {
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
        condor_id,
        m.d,
        m.underlying ?? null,
        m.under_high ?? null,
        m.under_low ?? null,
        m.put_long_px ?? null,
        m.put_short_px ?? null,
        m.call_short_px ?? null,
        m.call_long_px ?? null,
        m.mark ?? null,
        m.open_pnl ?? null,
        m.pct_max ?? null,
        m.cushion ?? null,
        m.legs_priced ?? 0,
        m.source ?? "tt"
      ]
    );
    n++;
  }
  return n;
}
async function getEmCondorMarks(opts = {}) {
  const params = [];
  const where = [];
  if (opts.condor_id) {
    params.push(opts.condor_id);
    where.push(`m.condor_id = $${params.length}`);
  }
  if (opts.week_start) {
    params.push(opts.week_start);
    where.push(`c.week_start = $${params.length}`);
  }
  const res = await pgQuery(
    `SELECT m.* FROM em_condor_marks m
       JOIN em_condors c ON c.id = m.condor_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY m.condor_id ASC, m.d ASC`,
    params
  );
  const ymd = (v) => {
    if (typeof v === "string") return v.slice(0, 10);
    const dt = v instanceof Date ? v : new Date(String(v));
    if (Number.isNaN(dt.getTime())) return String(v).slice(0, 10);
    const p = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  };
  return res.rows.map((r) => ({ ...r, d: ymd(r.d) }));
}
async function insertEmCondorTicks(ticks) {
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
        t.condor_id,
        Math.round(Number(t.ts)),
        t.underlying ?? null,
        t.put_long_px ?? null,
        t.put_short_px ?? null,
        t.call_short_px ?? null,
        t.call_long_px ?? null,
        t.mark ?? null,
        t.open_pnl ?? null,
        t.pct_max ?? null,
        t.cushion ?? null,
        t.legs_priced ?? 0,
        t.source ?? "tt"
      ]
    );
    n += res.rowCount ?? 0;
  }
  return n;
}
async function getEmCondorTicks(opts = {}) {
  const params = [];
  const where = [];
  if (opts.condor_id) {
    params.push(opts.condor_id);
    where.push(`t.condor_id = $${params.length}`);
  }
  if (opts.week_start) {
    params.push(opts.week_start);
    where.push(`c.week_start = $${params.length}`);
  }
  const res = await pgQuery(
    `SELECT t.* FROM em_condor_ticks t
       JOIN em_condors c ON c.id = t.condor_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY t.condor_id ASC, t.ts ASC`,
    params
  );
  return res.rows.map((r) => ({ ...r, ts: Number(r.ts) }));
}
async function pruneEmCondorTicks(days = 120) {
  const pool = await getDb();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1e3;
  const res = await pool.query(`DELETE FROM em_condor_ticks WHERE ts < $1`, [cutoff]);
  return res.rowCount ?? 0;
}
async function deleteEmCondor(id) {
  const pool = await getDb();
  await pool.query(`DELETE FROM em_condors WHERE id = $1`, [id]);
}
async function clearEmCondors(week_start) {
  const pool = await getDb();
  const res = week_start ? await pool.query(`DELETE FROM em_condors WHERE week_start = $1`, [week_start]) : await pool.query(`DELETE FROM em_condors`);
  return res.rowCount ?? 0;
}
async function addWaitlistEmail(input) {
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
async function unsubscribeWaitlistEmail(email) {
  const pool = await getDb();
  const result = await pool.query(
    `UPDATE waitlist SET unsubscribed_at = CURRENT_TIMESTAMP
     WHERE email = $1 AND unsubscribed_at IS NULL`,
    [email]
  );
  return { updated: (result.rowCount ?? 0) > 0 };
}
async function listWaitlist(limit = 1e3) {
  return queryAll(
    "SELECT * FROM waitlist ORDER BY created_at DESC LIMIT ?",
    [limit]
  );
}
async function countWaitlist() {
  const row = await queryOne("SELECT COUNT(*)::int AS n FROM waitlist", []);
  return Number(row?.n ?? 0);
}
async function addEmailSend(input) {
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
      input.sent_by ?? null
    ]
  );
}
async function listEmailSends(limit = 100) {
  return queryAll(
    "SELECT * FROM email_sends ORDER BY created_at DESC LIMIT ?",
    [limit]
  );
}
async function addUnsubscribe(email, source = "link") {
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
async function removeUnsubscribe(email) {
  const e = email.trim().toLowerCase();
  if (!e) return { removed: false };
  const pool = await getDb();
  const result = await pool.query(
    `DELETE FROM email_unsubscribes WHERE email = $1`,
    [e]
  );
  return { removed: (result.rowCount ?? 0) > 0 };
}
async function listUnsubscribes(limit = 5e3) {
  return queryAll(
    "SELECT email, source, created_at FROM email_unsubscribes ORDER BY created_at DESC LIMIT ?",
    [limit]
  );
}
async function getPromoCode(email, campaign) {
  return queryOne(
    "SELECT * FROM promo_codes_single_use WHERE email = ? AND campaign = ?",
    [email.trim().toLowerCase(), campaign]
  );
}
async function savePromoCode(input) {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO promo_codes_single_use (email, campaign, code, coupon_id, promotion_code_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email, campaign) DO NOTHING`,
    [input.email.trim().toLowerCase(), input.campaign, input.code, input.coupon_id, input.promotion_code_id]
  );
}
async function listPromoCodes(campaign, limit = 5e3) {
  return queryAll(
    "SELECT * FROM promo_codes_single_use WHERE campaign = ? ORDER BY created_at DESC LIMIT ?",
    [campaign, limit]
  );
}
async function listSalesExpenses(limit = 500) {
  return queryAll(
    "SELECT id, name, category, amount_cents, cadence, created_at FROM sales_expenses ORDER BY created_at DESC LIMIT ?",
    [limit]
  );
}
async function addSalesExpense(name, category, amountCents, cadence) {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO sales_expenses (name, category, amount_cents, cadence)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, category, amount_cents, cadence, created_at`,
    [name, category, amountCents, cadence]
  );
  return result.rows[0];
}
async function removeSalesExpense(id) {
  const pool = await getDb();
  const result = await pool.query(`DELETE FROM sales_expenses WHERE id = $1`, [id]);
  return { removed: (result.rowCount ?? 0) > 0 };
}
async function getUnsubscribedSet() {
  const rows = await queryAll(
    "SELECT email FROM email_unsubscribes",
    []
  );
  return new Set(rows.map((r) => r.email.trim().toLowerCase()));
}
var FEEDBACK_CATEGORIES = ["bug", "idea", "note", "other"];
async function addFeedback(input) {
  const category = FEEDBACK_CATEGORIES.includes(input.category ?? "") ? String(input.category) : "note";
  return queryOne(
    `INSERT INTO customer_feedback (clerk_user_id, email, category, message, page)
     VALUES (?, ?, ?, ?, ?)
     RETURNING *`,
    [input.clerk_user_id ?? null, input.email ?? null, category, input.message.trim(), input.page ?? null]
  );
}
async function listFeedback(opts = {}) {
  const limit = opts.limit ?? 500;
  if (opts.status === "open" || opts.status === "resolved") {
    return queryAll(
      "SELECT * FROM customer_feedback WHERE status = ? ORDER BY created_at DESC LIMIT ?",
      [opts.status, limit]
    );
  }
  return queryAll(
    "SELECT * FROM customer_feedback ORDER BY created_at DESC LIMIT ?",
    [limit]
  );
}
async function setFeedbackStatus(id, status) {
  await pgQuery(
    `UPDATE customer_feedback SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [status, id]
  );
}
var TICKER_RE = /^[A-Z]{1,6}$/;
async function addFarCbTicker(input) {
  const symbol = input.symbol.trim().toUpperCase();
  if (!TICKER_RE.test(symbol)) return { ok: false, error: "Enter a valid ticker (letters only, up to 6 characters)." };
  const row = await queryOne(
    `INSERT INTO far_cb_custom_tickers (symbol, added_by_id, added_by_email)
     VALUES (?, ?, ?)
     ON CONFLICT (symbol) DO UPDATE SET active = TRUE
     RETURNING *`,
    [symbol, input.added_by_id ?? null, input.added_by_email ?? null]
  );
  return row ? { ok: true, row } : { ok: false, error: "Save failed" };
}
async function listFarCbTickers(limit = 200) {
  return queryAll(
    "SELECT * FROM far_cb_custom_tickers WHERE active = TRUE ORDER BY created_at DESC LIMIT ?",
    [limit]
  );
}
function persistDb() {
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
async function getRecentTrades(limit = 100) {
  return queryAll(
    "SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}
async function getTradesByDate(date) {
  return queryAll(
    "SELECT * FROM trades WHERE date(timestamp) = ? ORDER BY timestamp DESC",
    [date]
  );
}
async function saveSnapshot(snap) {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO snapshots (timestamp, date, time, period, "tableHtml", expirations)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [snap.timestamp, snap.date, snap.time, snap.period, snap.tableHtml, JSON.stringify(snap.expirations || [])]
  );
  return snap;
}
async function getSnapshots(period) {
  let sql = `SELECT * FROM snapshots`;
  const params = [];
  if (period) {
    sql += " WHERE period = ?";
    params.push(period);
  }
  sql += " ORDER BY id DESC";
  const snapshots = await queryAll(sql, params);
  return snapshots.map((s) => ({
    ...s,
    expirations: typeof s.expirations === "string" ? JSON.parse(s.expirations) : s.expirations
  }));
}
async function deleteSnapshot(id) {
  await queryAll("DELETE FROM snapshots WHERE id = ?", [id]);
  return true;
}
async function ensureFlowCallsTable() {
}
async function insertFlowCalls(calls) {
  if (!calls.length) return;
  const pool = await getDb();
  for (const c of calls) {
    await pool.query(
      `INSERT INTO flow_calls (ts, date, source, symbol, underlying, expiration, strike, option_type, side, action, price, size, premium, is_otm)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        c.ts,
        c.date,
        c.source,
        c.symbol,
        c.underlying ?? null,
        c.expiration ?? null,
        c.strike,
        c.option_type,
        c.side,
        c.action,
        c.price,
        c.size,
        c.premium,
        c.is_otm
      ]
    );
  }
}
async function getFlowCalls(date, limit = 500) {
  return queryAll(
    "SELECT * FROM flow_calls WHERE date = ? ORDER BY ts DESC LIMIT ?",
    [date, limit]
  );
}
async function ensureMvcTable() {
}
async function insertMvcSnapshot(r) {
  const result = await pgQuery(
    `INSERT INTO mvc_snapshots (timestamp,date,day,time,"strikeOIVol","mvcValueOIVol","pctOI_Vol","volumeOIVol",
      "totalNetGEX_OI","strikeVolOnly","mvcValueVolOnly","pctVol_Only","volumeVolOnly","totalNetGEX_Vol",
      "spxPrice","esPrice","netDEXStrike","totalNetDEX_OI","totalNetDEX_Vol","totalAbsNetGEX","gexFlip","triggerType",expiration)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id`,
    [
      r.timestamp,
      r.date,
      r.day,
      r.time,
      r.strikeOIVol ?? null,
      r.mvcValueOIVol,
      r.pctOI_Vol ?? null,
      r.volumeOIVol,
      r.totalNetGEX_OI,
      r.strikeVolOnly ?? null,
      r.mvcValueVolOnly,
      r.pctVol_Only ?? null,
      r.volumeVolOnly,
      r.totalNetGEX_Vol,
      r.spxPrice,
      r.esPrice,
      r.netDEXStrike ?? null,
      r.totalNetDEX_OI ?? null,
      r.totalNetDEX_Vol ?? null,
      r.totalAbsNetGEX,
      r.gexFlip ?? null,
      r.triggerType,
      r.expiration
    ]
  );
  return Number(result.rows[0]?.id ?? 0);
}
async function getMvcSnapshots(date, limit = 200, sinceMs) {
  if (date) {
    return queryAll(
      "SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp DESC LIMIT ?",
      [date, limit]
    );
  }
  if (sinceMs) {
    return queryAll(
      // Identifiers MUST be quoted. mvc_snapshots is created with quoted
      // camelCase columns ("strikeOIVol" REAL, …), so an unquoted reference
      // folds to `strikeoivol` and Postgres errors with `column does not
      // exist`. This branch only fires when a caller passes ?days=, which
      // nothing did — so it has been dead-on-arrival rather than merely wrong.
      'SELECT timestamp, "strikeOIVol", "spxPrice", "esPrice" FROM mvc_snapshots WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?',
      [sinceMs, limit]
    );
  }
  return queryAll(
    "SELECT * FROM mvc_snapshots ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}
async function upsertConfidenceLog(r) {
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
    [
      r.date,
      r.level,
      r.regime,
      r.reach,
      r.pivot,
      r.chop,
      r.break,
      r.netWallBias,
      r.scored_at,
      r.touched,
      r.actual_outcome,
      r.held,
      r.broke,
      r.graded_at
    ]
  );
}
async function getGradedConfidenceLog() {
  return queryAll(
    `SELECT * FROM confidence_log WHERE graded_at IS NOT NULL ORDER BY date ASC`
  );
}
async function ensurePremiumFlowTable() {
}
async function insertPremiumFlow(r) {
  await pgQuery(
    `INSERT INTO premium_flow (timestamp,date,time,"callPremium","putPremium","netPremium","spxPrice")
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [r.timestamp, r.date, r.time, r.callPremium, r.putPremium, r.netPremium, r.spxPrice]
  );
}
async function getPremiumFlow(date, limit = 500) {
  if (date) {
    return queryAll(
      "SELECT * FROM premium_flow WHERE date = ? ORDER BY timestamp ASC LIMIT ?",
      [date, limit]
    );
  }
  return queryAll(
    "SELECT * FROM premium_flow ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}
async function ensureGreeksTsTable() {
}
async function insertGreeksTs(r) {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO greeks_ts (timestamp,date,time,ticker,price,"gexRaw","dexRaw","chexRaw","vexRaw",gex,dex,chex,vex,"buyScore","sellScore")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      r.timestamp,
      r.date,
      r.time,
      r.ticker,
      r.price,
      r.gexRaw,
      r.dexRaw,
      r.chexRaw,
      r.vexRaw,
      r.gex,
      r.dex,
      r.chex,
      r.vex,
      r.buyScore,
      r.sellScore
    ]
  );
}
async function getGreeksTs(date, limit = 1e3) {
  if (date) {
    return queryAll(
      "SELECT * FROM greeks_ts WHERE date = ? ORDER BY timestamp ASC LIMIT ?",
      [date, limit]
    );
  }
  return queryAll(
    "SELECT * FROM greeks_ts ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}
async function insertPlaybookFeed(r) {
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
      r.vex ?? null
    ]
  );
  return Number(result.rows[0]?.id ?? 0);
}
async function getPlaybookFeed(date, limit = 500) {
  if (date) {
    return queryAll(
      "SELECT * FROM playbook_feed WHERE date = ? ORDER BY timestamp DESC LIMIT ?",
      [date, limit]
    );
  }
  return queryAll(
    "SELECT * FROM playbook_feed ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}
async function upsertPageLoadStatus(r) {
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
      r.last_unloaded_at ?? null
    ]
  );
}
async function getPageLoadStatus(limit = 200) {
  return queryAll(
    "SELECT * FROM page_load_status ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT ?",
    [limit]
  );
}
async function insertPageVisit(r) {
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
      r.page_key ?? null,
      r.page_label ?? null,
      r.path ?? null,
      r.user_id ?? null,
      r.ip ?? null,
      r.country ?? null,
      r.region ?? null,
      r.city ?? null,
      r.latitude ?? null,
      r.longitude ?? null,
      r.is_entry ?? false,
      r.referrer ?? null,
      r.referrer_host ?? null,
      r.utm_source ?? null,
      r.utm_medium ?? null,
      r.utm_campaign ?? null,
      r.utm_term ?? null,
      r.utm_content ?? null,
      r.channel ?? null,
      r.browser ?? null,
      r.os ?? null,
      r.device_type ?? null,
      r.is_bot ?? false
    ]
  );
}
async function getRecentPageVisits(limit = 100) {
  return queryAll(
    "SELECT * FROM page_visits ORDER BY id DESC LIMIT ?",
    [limit]
  );
}
async function getPageVisitsSince(days, limit = 5e3) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) {
    return queryAll(
      "SELECT * FROM page_visits ORDER BY id DESC LIMIT ?",
      [limit]
    );
  }
  return queryAll(
    `SELECT * FROM page_visits
      WHERE created_at >= now() - (? || ' days')::interval
      ORDER BY id DESC
      LIMIT ?`,
    [String(Math.floor(d)), limit]
  );
}
async function getPageVisitStats(days) {
  const d = Number(days);
  const windowed = Number.isFinite(d) && d > 0;
  const rows = await queryAll(
    windowed ? `SELECT COUNT(*) AS total, MAX(created_at) AS newest_at, MIN(created_at) AS oldest_at
           FROM page_visits
          WHERE created_at >= now() - (? || ' days')::interval` : `SELECT COUNT(*) AS total, MAX(created_at) AS newest_at, MIN(created_at) AS oldest_at
           FROM page_visits`,
    windowed ? [String(Math.floor(d))] : []
  );
  const r = rows[0];
  return {
    total: Number(r?.total ?? 0),
    newestAt: r?.newest_at ?? null,
    oldestAt: r?.oldest_at ?? null
  };
}
async function getCustomerActivity() {
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
  return res.rows;
}
var TICKER_EVENTS_KEEP = 5e4;
async function insertTickerEvent(r) {
  if (!r.ticker || !r.event) return;
  const pool = await getDb();
  await pool.query(
    `INSERT INTO ticker_events (ticker, event, source, user_id)
     VALUES ($1, $2, $3, $4)`,
    [String(r.ticker).toUpperCase(), r.event, r.source ?? null, r.user_id ?? null]
  );
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
async function getTickerEventCounts(sinceDays, source) {
  const pool = await getDb();
  const conds = [];
  const params = [];
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
  return rows.map((r) => ({
    ticker: r.ticker,
    clicks: Number(r.clicks),
    renders: Number(r.renders)
  }));
}
async function ensureEsCandlesTable() {
}
async function upsertEsCandle(r) {
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
    [
      r.timestamp,
      r.date,
      r.slotKey,
      r.time ?? "",
      r.symbol ?? "/ES",
      r.intervalMinutes ?? 5,
      r.source ?? "dxlink",
      r.open,
      r.high,
      r.low,
      r.close,
      r.volume,
      r.avgVolume ?? 0
    ]
  );
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
async function upsertNqCandle(r) {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO nq_candles (timestamp,date,"slotKey",time,symbol,"intervalMinutes",source,open,high,low,close,volume,"avgVolume")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT("slotKey") DO UPDATE SET
       timestamp=EXCLUDED.timestamp, high=GREATEST(nq_candles.high,EXCLUDED.high), low=LEAST(nq_candles.low,EXCLUDED.low),
       close=EXCLUDED.close, volume=EXCLUDED.volume, "avgVolume"=EXCLUDED."avgVolume"`,
    [
      r.timestamp,
      r.date,
      r.slotKey,
      r.time ?? "",
      r.symbol ?? "/NQ",
      r.intervalMinutes ?? 5,
      r.source ?? "dxlink",
      r.open,
      r.high,
      r.low,
      r.close,
      r.volume,
      r.avgVolume ?? 0
    ]
  );
}
async function getNqCandles(date, daysBack, limit = 2e3) {
  if (date) {
    return queryAll(
      `SELECT * FROM nq_candles WHERE date = ? ORDER BY timestamp ASC LIMIT ?`,
      [date, limit]
    );
  }
  if (daysBack) {
    const cutoff = new Date(Date.now() - daysBack * 864e5).toISOString().slice(0, 10);
    return queryAll(
      `SELECT * FROM nq_candles WHERE date >= ? ORDER BY timestamp ASC LIMIT ?`,
      [cutoff, limit]
    );
  }
  return queryAll(
    `SELECT * FROM nq_candles ORDER BY timestamp DESC LIMIT ?`,
    [limit]
  );
}
async function upsertIbDailyResult(r) {
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
    [
      r.date,
      r.symbol,
      r.ib_high,
      r.ib_low,
      r.ib_mid,
      r.ib_width,
      r.width_bucket,
      r.bias,
      r.first_formed,
      r.close_zone,
      r.open_type,
      r.orb_dir,
      r.fvg,
      r.break_side,
      r.break_min,
      r.failed,
      r.retest,
      r.retest_cont,
      r.vol_surge,
      r.single_break,
      r.both_broke,
      r.neither_broke,
      r.contained_at2,
      r.contained_broke_late,
      r.ext_05,
      r.ext_10,
      r.ext_15,
      r.ext_20,
      r.first_touch_side,
      r.first_touch_min,
      r.day_high,
      r.day_low,
      r.day_close,
      JSON.stringify(r.rules ?? []),
      r.computed_at
    ]
  );
}
async function getIbDailyResults(symbol, limit = 90) {
  return queryAll(
    `SELECT * FROM ib_daily_results WHERE symbol = ? ORDER BY date DESC LIMIT ?`,
    [symbol, limit]
  );
}
async function getIbTrailingStats(table, beforeDate, daysBack = 70) {
  const tbl = table === "nq_candles" ? "nq_candles" : "es_candles";
  const cutoff = new Date(Date.parse(`${beforeDate}T12:00:00Z`) - daysBack * 864e5).toISOString().slice(0, 10);
  const rows = await queryAll(
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
  return rows.map((r) => ({
    date: r.date,
    dayRange: Number(r.rth_high) - Number(r.rth_low),
    ibWidth: Number(r.ib_high) - Number(r.ib_low)
  })).filter((r) => Number.isFinite(r.dayRange) && Number.isFinite(r.ibWidth) && r.ibWidth > 0);
}
async function upsertIbLevels(r) {
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
    [
      r.date,
      r.symbol ?? "/ES",
      r.timestamp,
      r.locked ?? 0,
      r.high,
      r.low,
      r.mid,
      r.range,
      r.rangePct,
      r.openPrice,
      r.lowFirst,
      r.barCount
    ]
  );
}
async function getIbLevels(date) {
  const rows = await queryAll(
    `SELECT * FROM ib_levels WHERE date = ? LIMIT 1`,
    [date]
  );
  return rows[0] ?? null;
}
async function ensureBzilaSnapshotsTable() {
}
async function insertBzilaSnapshot(r) {
  const result = await pgQuery(
    `INSERT INTO bzila_snapshots (timestamp,date,time,ticker,session,orders,stats) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      r.timestamp,
      r.date,
      r.time,
      r.ticker,
      r.session ?? "rth",
      JSON.stringify(r.orders ?? []),
      JSON.stringify(r.stats ?? {})
    ]
  );
  return Number(result.rows[0]?.id ?? 0);
}
async function getLatestBzilaSnapshot(date, session) {
  let rows;
  if (date && session) {
    rows = await queryAll(
      "SELECT * FROM bzila_snapshots WHERE date = ? AND session = ? ORDER BY timestamp DESC LIMIT 1",
      [date, session]
    );
    if (!rows.length && session === "ext") {
      rows = await queryAll(
        "SELECT * FROM bzila_snapshots WHERE session = 'ext' ORDER BY timestamp DESC LIMIT 1"
      );
    }
  } else if (date) {
    rows = await queryAll(
      "SELECT * FROM bzila_snapshots WHERE date = ? ORDER BY timestamp DESC LIMIT 1",
      [date]
    );
  } else {
    rows = await queryAll(
      "SELECT * FROM bzila_snapshots ORDER BY timestamp DESC LIMIT 1"
    );
  }
  if (!rows.length) return null;
  const r = rows[0];
  return {
    stats: typeof r.stats === "string" ? JSON.parse(r.stats) : r.stats,
    orders: typeof r.orders === "string" ? JSON.parse(r.orders) : r.orders ?? []
  };
}
async function getBzilaSnapshots(date, limit = 200) {
  if (date) {
    return queryAll(
      "SELECT * FROM bzila_snapshots WHERE date = ? ORDER BY timestamp DESC LIMIT ?",
      [date, limit]
    );
  }
  return queryAll(
    "SELECT * FROM bzila_snapshots ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}
async function postEsGap(r) {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO es_gap (date, symbol, prior_close, open_0930, gap_pts, gap_dir, locked, open_ts, extreme_after, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,1,$7,$4,CURRENT_TIMESTAMP)
     ON CONFLICT(date) DO NOTHING`,
    [r.date, r.symbol ?? "/ES", r.prior_close, r.open_0930, r.gap_pts, r.gap_dir, r.open_ts]
  );
}
async function updateEsGapFill(r) {
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
async function getEsGap(date) {
  const rows = await queryAll(`SELECT * FROM es_gap WHERE date = ? LIMIT 1`, [date]);
  return rows[0] ?? null;
}
async function insertIctSetup(r) {
  const res = await pgQuery(
    `INSERT INTO ict_setups
       (setup_key, date, kind, label, dir, trigger_ts, price, note, target, invalidation)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (setup_key) DO NOTHING
     RETURNING id`,
    [
      r.setup_key,
      r.date,
      r.kind,
      r.label ?? null,
      r.dir ?? null,
      r.trigger_ts,
      r.price ?? null,
      r.note ?? null,
      r.target ?? null,
      r.invalidation ?? null
    ]
  );
  return { inserted: (res.rowCount ?? 0) > 0 };
}
async function updateIctSetupGrade(r) {
  await pgQuery(
    `UPDATE ict_setups SET
       outcome = $2, mfe = $3, mae = $4, r_multiple = $5,
       resolved_ts = $6, resolved_price = $7, updated_at = CURRENT_TIMESTAMP
     WHERE setup_key = $1`,
    [
      r.setup_key,
      r.outcome,
      r.mfe,
      r.mae,
      r.r_multiple ?? null,
      r.resolved_ts ?? null,
      r.resolved_price ?? null
    ]
  );
}
async function getIctSetups(opts) {
  const limit = opts?.limit ?? 200;
  if (opts?.date) {
    return queryAll(
      `SELECT * FROM ict_setups WHERE date = ? ORDER BY trigger_ts DESC LIMIT ?`,
      [opts.date, limit]
    );
  }
  if (opts?.sinceDate) {
    return queryAll(
      `SELECT * FROM ict_setups WHERE date >= ? ORDER BY trigger_ts DESC LIMIT ?`,
      [opts.sinceDate, limit]
    );
  }
  return queryAll(
    `SELECT * FROM ict_setups ORDER BY trigger_ts DESC LIMIT ?`,
    [limit]
  );
}
async function getPendingIctSetups(date) {
  return queryAll(
    `SELECT * FROM ict_setups WHERE date = ? AND outcome = 'pending' ORDER BY trigger_ts ASC`,
    [date]
  );
}
async function getMomentumBiasSignals(opts) {
  const limit = opts?.limit ?? 200;
  if (opts?.date) {
    return queryAll(
      `SELECT * FROM momentum_bias_signals WHERE date = ? ORDER BY trigger_ts DESC LIMIT ?`,
      [opts.date, limit]
    );
  }
  if (opts?.sinceDate) {
    return queryAll(
      `SELECT * FROM momentum_bias_signals WHERE date >= ? ORDER BY trigger_ts DESC LIMIT ?`,
      [opts.sinceDate, limit]
    );
  }
  return queryAll(
    `SELECT * FROM momentum_bias_signals ORDER BY trigger_ts DESC LIMIT ?`,
    [limit]
  );
}
async function getMomentumBiasSummary(opts) {
  const pool = await getDb();
  let where = ``;
  const params = [];
  if (opts?.date) {
    where = `WHERE date = $1`;
    params.push(opts.date);
  } else if (opts?.sinceDate) {
    where = `WHERE date >= $1`;
    params.push(opts.sinceDate);
  }
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
  return result.rows.map((r) => {
    const wins = Number(r.wins), graded = Number(r.graded);
    return {
      dir: String(r.dir),
      wins,
      losses: Number(r.losses),
      chop: Number(r.chop),
      pending: Number(r.pending),
      graded,
      total: Number(r.total),
      win_rate: graded > 0 ? wins / graded : null,
      avg_r: r.avg_r != null ? Number(r.avg_r) : null,
      avg_mfe: r.avg_mfe != null ? Number(r.avg_mfe) : null
    };
  });
}
async function getIctSetupSummary(opts) {
  const pool = await getDb();
  let where = ``;
  const params = [];
  if (opts?.date) {
    where = `WHERE date = $1`;
    params.push(opts.date);
  } else if (opts?.sinceDate) {
    where = `WHERE date >= $1`;
    params.push(opts.sinceDate);
  }
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
      resolved,
      hit1,
      hit2,
      hit3,
      rate1: resolved > 0 ? hit1 / resolved : null,
      rate2: resolved > 0 ? hit2 / resolved : null,
      rate3: resolved > 0 ? hit3 / resolved : null
    };
  });
}
async function ensureExpirationsTable() {
}
async function upsertExpirationCache(ticker, expirations, raw) {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO expirations_cache (ticker,timestamp,expirations,raw) VALUES ($1,$2,$3,$4)
     ON CONFLICT(ticker) DO UPDATE SET timestamp=EXCLUDED.timestamp, expirations=EXCLUDED.expirations, raw=EXCLUDED.raw`,
    [ticker, Date.now(), JSON.stringify(expirations), JSON.stringify(raw)]
  );
}
async function getCachedExpirations(ticker) {
  const rows = await queryAll(
    "SELECT * FROM expirations_cache WHERE ticker = ? ORDER BY timestamp DESC LIMIT 1",
    [ticker]
  );
  if (!rows.length) return null;
  const r = rows[0];
  if (Date.now() - Number(r.timestamp) > 36e5) return null;
  return typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw;
}
var REAL_MIN_MAGNITUDE = 1e-37;
var REAL_MAX_MAGNITUDE = 3.4028234e38;
function clampReal(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.abs(v) < REAL_MIN_MAGNITUDE ? 0 : v;
}
// Nullable variant of clampReal for REAL columns that accept NULL.
// Postgres float4in REJECTS values it cannot represent — a deep-OTM gamma such
// as 4.4e-65 comes back from the feed as a perfectly valid JS number and then
// blows up the INSERT with `"4.414902099280869e-65" is out of range for type
// real`. Underflow collapses to 0 (that IS the value, to float4 precision) and
// overflow saturates at the float4 limit; null/blank/NaN stay null.
function realOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) < REAL_MIN_MAGNITUDE) return 0;
  if (Math.abs(n) > REAL_MAX_MAGNITUDE) return n > 0 ? REAL_MAX_MAGNITUDE : -REAL_MAX_MAGNITUDE;
  return n;
}
// ─── option_strike_gex_history: multi-underlying support ────────────────────
// HAND-PATCHED INTO THIS BUNDLE. api-router.js calls libDb.normGexSymbol() and
// passes a `symbol` argument to every option_strike_gex_history helper, but the
// bundle was never regenerated with them — so normGexSymbol was `undefined` and
// the FIRST line of the /api/snapshots/option-strike-gex-history handler threw
// `TypeError: libDb.normGexSymbol is not a function` on EVERY request, in every
// mode. The route's catch turned that into `200 {error, rows:[]}`, so the
// heatmap backfill and the bubble trail silently got nothing while the live
// websocket kept drawing — the "no historical bubbles, live ones fine" symptom.
//
// Regenerating this bundle from the TypeScript source would drop symbol support
// again (see the note in api-router.js). If you ever DO regenerate, port these
// three things forward: normGexSymbol, the `symbol` parameter on the helpers
// below, and the symbol column in insertOptionStrikeGexRows.
//
// Legacy rows predate the symbol column and are all '$SPX', so absent/blank/
// 'SPX' MUST normalize to '$SPX' or they go invisible. This mirrors normSymbol()
// in server-v2/gex-history-writer.js — the two have to agree or reads miss writes.
var DEFAULT_GEX_SYMBOL = "$SPX";
function normGexSymbol(sym) {
  const s = String(sym ?? "").trim().toUpperCase();
  if (!s || s === "SPX") return DEFAULT_GEX_SYMBOL;
  return s;
}
async function insertOptionStrikeGexRows(rows) {
  if (!rows.length) return;
  const pool = await getDb();
  for (const row of rows) {
    await pool.query(
      `INSERT INTO option_strike_gex_history
         (timestamp, date, expiry, spot, strike, net_gex, net_vol_gex, symbol, net_dex, net_vol_dex)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        row.timestamp,
        row.date,
        row.expiry,
        row.spot,
        row.strike,
        clampReal(row.net_gex),
        Number.isFinite(row.net_vol_gex) ? clampReal(row.net_vol_gex) : null,
        // Without this every POSTed row fell to the column DEFAULT ('$SPX'), so
        // SPY/QQQ history was being written into the SPX series.
        normGexSymbol(row.symbol),
        // DEX. Omitted from this INSERT until now, so every row that came in
        // through POST /api/snapshots/option-strike-gex-history landed with
        // net_dex NULL — which the GEX map reads as a flat book and reports as
        // "no DEX for this session". NULL stays NULL: a missing reading and a
        // zero reading are not the same thing on a positioning map.
        Number.isFinite(row.net_dex) ? clampReal(row.net_dex) : null,
        Number.isFinite(row.net_vol_dex) ? clampReal(row.net_vol_dex) : null
      ]
    );
  }
  await pruneOptionStrikeGexHistory(pool);
}
// How many TRADING SESSIONS of strike history to keep — sessions, not hours.
var GEX_HISTORY_KEEP_SESSIONS = 2;
// Prune at most this often. The old wall-clock DELETE was a cheap range scan;
// this one does a DISTINCT over `date`, and insertOptionStrikeGexRows runs
// several times a minute (once per symbol/expiry the recorders sweep). No
// reason to re-derive the cutoff every batch when it only moves once a day.
var GEX_PRUNE_MIN_INTERVAL_MS = 10 * 60 * 1e3;
var lastGexPruneAt = 0;
function etDateString(ts = Date.now()) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(ts)).filter((x) => x.type !== "literal")
    .reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}`;
}
/**
 * Retention for option_strike_gex_history, counted in SESSIONS.
 *
 * This used to be `WHERE timestamp < Date.now() - 48h`, which quietly destroyed
 * every Friday. The writer stops at Friday 17:00 ET and resumes Sunday 20:00 ET
 * (see isRecordingWindow in gex-history-writer.js), so no prune runs over the
 * weekend — and then the FIRST insert on Sunday night cut everything older than
 * Friday 20:00, i.e. the whole of Friday's RTH, in one shot. By Monday's open
 * Friday no longer existed. 48 wall-clock hours is ~2 sessions Tue–Fri; across
 * a weekend it is less than one.
 *
 * Counting distinct session dates is weekend- and holiday-proof by
 * construction: Saturday and Sunday produce no `date` values, so they cost
 * nothing. Two sessions on a Monday means Friday + Monday, which is the point.
 *
 * Still deliberately NOT scoped by symbol — every symbol shares one window.
 *
 * Three safety properties worth preserving if you touch this:
 *   • Fewer than N distinct dates present → the subquery returns the oldest
 *     date in the table, so NOTHING is deleted. A fresh or sparse table is
 *     never wiped.
 *   • Empty table → MIN(d) is NULL → `date < NULL` is NULL → no rows deleted.
 *   • `date <= today` stops a bad future-dated row from anchoring the window
 *     and taking the live session with it. That is what the old Date.now()
 *     anchor bought, and it is still bought here.
 */
async function pruneOptionStrikeGexHistory(pool, { force = false } = {}) {
  if (!force && Date.now() - lastGexPruneAt < GEX_PRUNE_MIN_INTERVAL_MS) return;
  lastGexPruneAt = Date.now();
  await pool.query(
    `DELETE FROM option_strike_gex_history
      WHERE date < (
        SELECT MIN(d) FROM (
          SELECT DISTINCT date AS d
            FROM option_strike_gex_history
           WHERE date <= $2
           ORDER BY d DESC
           LIMIT $1
        ) recent
      )`,
    [GEX_HISTORY_KEEP_SESSIONS, etDateString()]
  );
}
async function getOptionStrikeRollingNetGex(date, expiry, sinceTimestamp, symbol) {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT strike,
            AVG(net_gex) AS rolling_net_gex,
            COUNT(*)::int AS points
       FROM option_strike_gex_history
      WHERE date = $1
        AND expiry = $2
        AND timestamp >= $3
        AND symbol = $4
      GROUP BY strike
      ORDER BY strike ASC`,
    [date, expiry, sinceTimestamp, normGexSymbol(symbol)]
  );
  return result.rows.map((row) => ({
    strike: Number(row.strike ?? 0),
    rolling_net_gex: Number(row.rolling_net_gex ?? 0),
    points: Number(row.points ?? 0)
  }));
}
async function getOptionStrikeGexSlots(date, expiry, symbol) {
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
        AND symbol = $3
      ORDER BY (FLOOR(timestamp / 60000) * 60000) ASC, strike ASC, timestamp DESC`,
    [date, expiry, normGexSymbol(symbol)]
  );
  return result.rows.map((row) => ({
    slot_ts: Number(row.slot_ts ?? 0),
    strike: Number(row.strike ?? 0),
    net_gex: Number(row.net_gex ?? 0),
    net_vol_gex: Number(row.net_vol_gex ?? 0),
    // SPX spot AT THE TIME OF THE SNAPSHOT. The ES-Candles heatmap needs this to
    // rebuild the historical ES−SPX basis per column (basis drifts with carry/
    // divs and steps at the futures roll — one live basis mis-places old cells).
    spot: Number(row.spot ?? 0)
  }));
}
async function getOptionStrikeGexSlotsWindow(sinceTs, expiry, symbol) {
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
        AND symbol = $3
      ORDER BY (FLOOR(timestamp / 60000) * 60000) ASC, strike ASC, timestamp DESC`,
    [sinceTs, expiry, normGexSymbol(symbol)]
  );
  return result.rows.map((row) => ({
    slot_ts: Number(row.slot_ts ?? 0),
    strike: Number(row.strike ?? 0),
    net_gex: Number(row.net_gex ?? 0),
    net_vol_gex: Number(row.net_vol_gex ?? 0),
    spot: Number(row.spot ?? 0)
  }));
}
async function getOptionStrikeGexSlotsWindowAny(sinceTs, symbol) {
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
        AND symbol = $2
      ORDER BY (FLOOR(timestamp / 60000) * 60000) ASC, strike ASC, timestamp DESC`,
    [sinceTs, normGexSymbol(symbol)]
  );
  return result.rows.map((row) => ({
    slot_ts: Number(row.slot_ts ?? 0),
    strike: Number(row.strike ?? 0),
    net_gex: Number(row.net_gex ?? 0),
    net_vol_gex: Number(row.net_vol_gex ?? 0),
    spot: Number(row.spot ?? 0)
  }));
}
async function getOptionStrikeNetGexAsOf(date, expiry, asOfTimestamp, symbol) {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT DISTINCT ON (strike) strike, net_gex, net_vol_gex, timestamp
       FROM option_strike_gex_history
      WHERE date = $1
        AND expiry = $2
        AND timestamp <= $3
        AND symbol = $4
      ORDER BY strike ASC, timestamp DESC`,
    [date, expiry, asOfTimestamp, normGexSymbol(symbol)]
  );
  return result.rows.map((row) => ({
    strike: Number(row.strike ?? 0),
    net_gex: Number(row.net_gex ?? 0),
    net_vol_gex: Number(row.net_vol_gex ?? 0),
    timestamp: Number(row.timestamp ?? 0)
  }));
}
async function getOptionStrikeNetGexAsOfOrNearest(date, expiry, asOfTimestamp, symbol) {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT DISTINCT ON (strike) strike, net_gex, net_vol_gex, timestamp
       FROM option_strike_gex_history
      WHERE date = $1
        AND expiry = $2
        AND symbol = $4
      ORDER BY strike ASC,
               (timestamp <= $3) DESC,
               CASE WHEN timestamp <= $3
                    THEN $3 - timestamp
                    ELSE timestamp - $3
               END ASC`,
    [date, expiry, asOfTimestamp, normGexSymbol(symbol)]
  );
  return result.rows.map((row) => ({
    strike: Number(row.strike ?? 0),
    net_gex: Number(row.net_gex ?? 0),
    net_vol_gex: Number(row.net_vol_gex ?? 0),
    timestamp: Number(row.timestamp ?? 0)
  }));
}
async function getOptionStrikeNetGexAtOpen(date, expiry, symbol) {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT DISTINCT ON (strike) strike, net_gex, net_vol_gex, timestamp
       FROM option_strike_gex_history
      WHERE date = $1
        AND expiry = $2
        AND symbol = $3
      ORDER BY strike ASC, timestamp ASC`,
    [date, expiry, normGexSymbol(symbol)]
  );
  return result.rows.map((row) => ({
    strike: Number(row.strike ?? 0),
    net_gex: Number(row.net_gex ?? 0),
    net_vol_gex: Number(row.net_vol_gex ?? 0),
    timestamp: Number(row.timestamp ?? 0)
  }));
}
async function getOrCreateBudgetProfile(name = "Default") {
  const pool = await getDb();
  const found = await queryOne("SELECT * FROM budget_profiles WHERE name = ? LIMIT 1", [name]);
  if (found) return found;
  const result = await pool.query(
    `INSERT INTO budget_profiles (name, currency) VALUES ($1, $2) RETURNING *`,
    [name, "USD"]
  );
  return result.rows[0];
}
async function listBudgetProfiles() {
  return queryAll("SELECT * FROM budget_profiles ORDER BY id ASC");
}
async function upsertBudgetCategory(input) {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_categories (profile_id, name, amount, period, color)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT(profile_id, name) DO UPDATE SET amount = EXCLUDED.amount, period = EXCLUDED.period, color = EXCLUDED.color, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [input.profile_id, input.name, input.amount, input.period, input.color ?? null]
  );
  return result.rows[0];
}
async function listBudgetCategories(profileId) {
  return queryAll(
    "SELECT * FROM budget_categories WHERE profile_id = ? ORDER BY id DESC",
    [profileId]
  );
}
async function deleteBudgetCategory(profileId, id) {
  const pool = await getDb();
  await pool.query("DELETE FROM budget_categories WHERE id = $1 AND profile_id = $2", [id, profileId]);
}
async function upsertDailyBalance(input) {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_daily_balance (profile_id, day, coastal, truist, secu)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT(profile_id, day) DO UPDATE SET coastal = EXCLUDED.coastal, truist = EXCLUDED.truist, secu = EXCLUDED.secu, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [input.profile_id, input.day, input.coastal, input.truist, input.secu]
  );
  return result.rows[0];
}
async function getLatestDailyBalance(profileId) {
  const rows = await queryAll(
    "SELECT * FROM budget_daily_balance WHERE profile_id = ? ORDER BY day DESC LIMIT 1",
    [profileId]
  );
  return rows[0] ?? null;
}
async function getDailyBalanceBefore(profileId, day) {
  const rows = await queryAll(
    "SELECT * FROM budget_daily_balance WHERE profile_id = ? AND day < ? ORDER BY day DESC LIMIT 1",
    [profileId, day]
  );
  return rows[0] ?? null;
}
async function setRegisterCategory(profileId, id, categoryId) {
  const pool = await getDb();
  await pool.query(
    "UPDATE budget_register SET category_id = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND profile_id = $2",
    [id, profileId, categoryId]
  );
}
async function insertBudgetEntry(input) {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_entries (profile_id, category_id, type, amount, title, notes, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [input.profile_id, input.category_id ?? null, input.type, input.amount, input.title, input.notes ?? null, input.occurred_at]
  );
  return result.rows[0];
}
async function listBudgetEntries(profileId, limit = 200) {
  return queryAll(
    "SELECT * FROM budget_entries WHERE profile_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?",
    [profileId, limit]
  );
}
async function insertRegisterRow(input) {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_register (profile_id, entry_date, sort_order, label, bank, amount, is_beginning, recurring_tag, category_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [input.profile_id, input.entry_date, input.sort_order, input.label, input.bank, input.amount, input.is_beginning ?? 0, input.recurring_tag ?? null, input.category_id ?? null]
  );
  return result.rows[0];
}
async function updateRegisterRow(profileId, id, patch) {
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
async function deleteRegisterRow(profileId, id) {
  const pool = await getDb();
  await pool.query(`DELETE FROM budget_register WHERE id = $1 AND profile_id = $2 AND is_beginning = 0`, [id, profileId]);
}
async function deleteRegisterByTag(profileId, fromDate, toDate, tag) {
  const pool = await getDb();
  await pool.query(
    `DELETE FROM budget_register WHERE profile_id = $1 AND entry_date >= $2 AND entry_date <= $3 AND recurring_tag = $4`,
    [profileId, fromDate, toDate, tag]
  );
}
async function listRegister(profileId, fromDate, toDate) {
  return queryAll(
    "SELECT * FROM budget_register WHERE profile_id = ? AND entry_date >= ? AND entry_date <= ? ORDER BY entry_date ASC, sort_order ASC, id ASC",
    [profileId, fromDate, toDate]
  );
}

// ── Undo a bulk import into the register ────────────────────────────────────
// A bulk statement import lands as one burst of INSERTs, so rows inserted in
// the same clock minute are the batch. Manual single-row adds show up as their
// own 1-row "batch", which is why the UI shows the count and sample labels
// before anything is deleted. Beginning-balance rows are never included.
async function listRegisterInsertBatches(profileId, days = 90) {
  return queryAll(
    `SELECT to_char(date_trunc('minute', created_at), 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket,
            to_char(MIN(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS first_at,
            to_char(MAX(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_at,
            COUNT(*)::int AS n,
            SUM(amount) AS total,
            MIN(entry_date) AS from_date,
            MAX(entry_date) AS to_date,
            (array_agg(label ORDER BY id))[1:6] AS labels
       FROM budget_register
      WHERE profile_id = ?
        AND is_beginning = 0
        AND created_at > now() - (? || ' days')::interval
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 40`,
    [profileId, String(days)]
  );
}
async function listRegisterRowsInWindow(profileId, fromIso, toIso) {
  return queryAll(
    `SELECT * FROM budget_register
      WHERE profile_id = ? AND is_beginning = 0 AND created_at >= ?::timestamptz AND created_at <= ?::timestamptz
      ORDER BY id ASC`,
    [profileId, fromIso, toIso]
  );
}
async function deleteRegisterRowsInWindow(profileId, fromIso, toIso) {
  const pool = await getDb();
  const r = await pool.query(
    `DELETE FROM budget_register
      WHERE profile_id = $1 AND is_beginning = 0 AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz`,
    [profileId, fromIso, toIso]
  );
  return r.rowCount ?? 0;
}

// ── Real Month (statement truth) ────────────────────────────────────────────
// These never touch budget_register. See the table comment in ensureAllTables.
async function insertStatementTx(input) {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_statement_tx
       (profile_id, month, tx_date, description, merchant, amount, direction, category_id, is_recurring, bank, source, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT(profile_id, dedupe_key) DO NOTHING
     RETURNING *`,
    [
      input.profile_id, input.month, input.tx_date, input.description, input.merchant,
      input.amount, input.direction, input.category_id ?? null, input.is_recurring ?? 0,
      input.bank ?? "secu", input.source ?? null, input.dedupe_key,
    ]
  );
  return result.rows[0] ?? null;
}
async function listStatementTx(profileId, month) {
  return queryAll(
    "SELECT * FROM budget_statement_tx WHERE profile_id = ? AND month = ? ORDER BY tx_date ASC, id ASC",
    [profileId, month]
  );
}
async function listStatementMonths(profileId) {
  return queryAll(
    "SELECT month, COUNT(*)::int AS n FROM budget_statement_tx WHERE profile_id = ? GROUP BY month ORDER BY month DESC",
    [profileId]
  );
}
async function updateStatementTx(profileId, id, patch) {
  const pool = await getDb();
  await pool.query(
    `UPDATE budget_statement_tx
       SET tx_date      = COALESCE($3, tx_date),
           description  = COALESCE($4, description),
           merchant     = COALESCE($5, merchant),
           amount       = COALESCE($6, amount),
           direction    = COALESCE($7, direction),
           is_recurring = COALESCE($8, is_recurring),
           updated_at   = CURRENT_TIMESTAMP
     WHERE id = $1 AND profile_id = $2`,
    [id, profileId, patch.tx_date ?? null, patch.description ?? null, patch.merchant ?? null,
     patch.amount ?? null, patch.direction ?? null, patch.is_recurring ?? null]
  );
}
// Re-file every row from one merchant in a single UPDATE. The match is on the
// same normalization the client uses for grouping (trim, collapse runs of
// whitespace, lowercase), so what you see merged in the merchant rollup is
// exactly what gets updated. month = null re-files that merchant everywhere.
async function setStatementCategoryByMerchant(profileId, month, merchantKey, categoryId) {
  const pool = await getDb();
  const r = await pool.query(
    `UPDATE budget_statement_tx
        SET category_id = $2, updated_at = CURRENT_TIMESTAMP
      WHERE profile_id = $1
        AND ($3::text IS NULL OR month = $3)
        AND lower(regexp_replace(btrim(merchant), '\s+', ' ', 'g')) = $4`,
    [profileId, categoryId, month, merchantKey]
  );
  return r.rowCount ?? 0;
}
// Separate from updateStatementTx because COALESCE cannot express "set to NULL".
async function setStatementTxCategory(profileId, id, categoryId) {
  const pool = await getDb();
  await pool.query(
    "UPDATE budget_statement_tx SET category_id = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND profile_id = $2",
    [id, profileId, categoryId]
  );
}
// Apply a whole batch of category edits in ONE statement. The client holds
// edits locally until Save, so this is the only write that path makes — a
// partial failure can't leave half the screen re-filed and half not.
// NULLs are allowed in the cat array: that clears a row's category.
async function setStatementCategoriesBulk(profileId, ids, cats) {
  if (!ids.length) return 0;
  const pool = await getDb();
  const r = await pool.query(
    `UPDATE budget_statement_tx AS t
        SET category_id = v.cat, updated_at = CURRENT_TIMESTAMP
       FROM (SELECT * FROM unnest($2::int[], $3::int[]) AS x(id, cat)) AS v
      WHERE t.id = v.id AND t.profile_id = $1`,
    [profileId, ids, cats]
  );
  return r.rowCount ?? 0;
}
async function deleteStatementTx(profileId, id) {
  const pool = await getDb();
  await pool.query("DELETE FROM budget_statement_tx WHERE id = $1 AND profile_id = $2", [id, profileId]);
}
async function clearStatementMonth(profileId, month) {
  const pool = await getDb();
  const r = await pool.query("DELETE FROM budget_statement_tx WHERE profile_id = $1 AND month = $2", [profileId, month]);
  return r.rowCount ?? 0;
}
async function upsertBudgetAdvice(input) {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_advice (profile_id, month, headline, findings, quick_wins, model)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)
     ON CONFLICT(profile_id, month) DO UPDATE SET
       headline = EXCLUDED.headline,
       findings = EXCLUDED.findings,
       quick_wins = EXCLUDED.quick_wins,
       model = EXCLUDED.model,
       generated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [input.profile_id, input.month, input.headline ?? '', JSON.stringify(input.findings ?? []), JSON.stringify(input.quick_wins ?? []), input.model ?? null]
  );
  return result.rows[0];
}
async function getBudgetAdvice(profileId, month) {
  return queryOne("SELECT * FROM budget_advice WHERE profile_id = ? AND month = ?", [profileId, month]);
}
async function listSubscriptions(profileId) {
  return queryAll("SELECT * FROM budget_subscription WHERE profile_id = ? ORDER BY merchant ASC", [profileId]);
}
async function upsertSubscription(input) {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_subscription (profile_id, merchant_key, merchant, status, note, pushed_recurring_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT(profile_id, merchant_key) DO UPDATE SET
       merchant = EXCLUDED.merchant,
       status = EXCLUDED.status,
       note = COALESCE(EXCLUDED.note, budget_subscription.note),
       pushed_recurring_id = COALESCE(EXCLUDED.pushed_recurring_id, budget_subscription.pushed_recurring_id),
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [input.profile_id, input.merchant_key, input.merchant, input.status ?? "watch", input.note ?? null, input.pushed_recurring_id ?? null]
  );
  return result.rows[0];
}
async function insertRecurring(input) {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_recurring (profile_id, label, bank, amount, frequency, anchor_date)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [input.profile_id, input.label, input.bank, input.amount, input.frequency, input.anchor_date]
  );
  return result.rows[0];
}
async function updateRecurring(profileId, id, patch) {
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
async function deleteRecurring(profileId, id) {
  const pool = await getDb();
  await pool.query(`DELETE FROM budget_recurring WHERE id = $1 AND profile_id = $2`, [id, profileId]);
}
async function listRecurring(profileId) {
  return queryAll(
    "SELECT * FROM budget_recurring WHERE profile_id = ? ORDER BY id ASC",
    [profileId]
  );
}
async function adoptDefaultBudgetProfile(targetName) {
  if (targetName === "Default") return;
  const pool = await getDb();
  await pool.query(
    `UPDATE budget_profiles SET name = $1, updated_at = CURRENT_TIMESTAMP
     WHERE name = 'Default'
       AND NOT EXISTS (SELECT 1 FROM budget_profiles WHERE name = $1)`,
    [targetName]
  );
}
async function insertAmazonRow(input) {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_amazon (profile_id, work_date, pay, gas)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [input.profile_id, input.work_date, input.pay, input.gas]
  );
  return result.rows[0];
}
async function deleteAmazonRow(profileId, id) {
  const pool = await getDb();
  await pool.query(`DELETE FROM budget_amazon WHERE id = $1 AND profile_id = $2`, [id, profileId]);
}
async function listAmazonRows(profileId, fromDate, toDate) {
  return queryAll(
    "SELECT * FROM budget_amazon WHERE profile_id = ? AND work_date >= ? AND work_date <= ? ORDER BY work_date ASC, id ASC",
    [profileId, fromDate, toDate]
  );
}
function normSource(v) {
  return v === "cbedge" ? "cbedge" : v === "contracts" ? "contracts" : "prop";
}
async function insertPropRow(input) {
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
      input.note ?? null
    ]
  );
  return result.rows[0];
}
async function updatePropRow(profileId, id, patch) {
  const sets = [];
  const vals = [];
  let i = 1;
  const add = (col, v) => {
    sets.push(`${col} = $${i++}`);
    vals.push(v);
  };
  if (patch.entry_date !== void 0) add("entry_date", patch.entry_date);
  if (patch.source !== void 0) add("source", normSource(patch.source));
  if (patch.firm !== void 0) add("firm", patch.firm.trim() || "TPT");
  if (patch.accounts !== void 0) add("accounts", Math.round(patch.accounts));
  if (patch.cost !== void 0) add("cost", patch.cost);
  if (patch.payout !== void 0) add("payout", patch.payout);
  if (patch.note !== void 0) add("note", patch.note);
  if (!sets.length) return;
  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  const pool = await getDb();
  await pool.query(
    `UPDATE budget_prop SET ${sets.join(", ")} WHERE id = $${i++} AND profile_id = $${i}`,
    [...vals, id, profileId]
  );
}
async function deletePropRow(profileId, id) {
  const pool = await getDb();
  await pool.query(`DELETE FROM budget_prop WHERE id = $1 AND profile_id = $2`, [id, profileId]);
}
async function listPropRows(profileId, fromDate, toDate) {
  return queryAll(
    "SELECT * FROM budget_prop WHERE profile_id = ? AND entry_date >= ? AND entry_date <= ? ORDER BY entry_date DESC, id DESC",
    [profileId, fromDate, toDate]
  );
}
async function listRetaSetups() {
  return queryAll(
    "SELECT * FROM reta_setups ORDER BY effective_from ASC"
  );
}
async function upsertRetaSetup(input) {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO reta_setups (effective_from, vial_mg, bac_ml, syringe_units, note)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (effective_from) DO UPDATE SET
       vial_mg = EXCLUDED.vial_mg,
       bac_ml = EXCLUDED.bac_ml,
       syringe_units = EXCLUDED.syringe_units,
       note = EXCLUDED.note,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      input.effective_from,
      input.vial_mg,
      input.bac_ml,
      Math.round(input.syringe_units ?? 100) || 100,
      input.note ?? null
    ]
  );
  return result.rows[0];
}
async function deleteRetaSetup(id) {
  const pool = await getDb();
  await pool.query(`DELETE FROM reta_setups WHERE id = $1`, [id]);
}
async function listRetaShots() {
  return queryAll(
    "SELECT * FROM reta_shots ORDER BY shot_date ASC, person ASC"
  );
}
async function upsertRetaShot(input) {
  const pool = await getDb();
  const result = await pool.query(
    // Every param is cast explicitly: a bare `COALESCE($3, 0)` would let
    // Postgres infer $3 as integer from the literal and reject "0.5".
    `INSERT INTO reta_shots (shot_date, person, dose_mg, weight_lb, taken)
     VALUES ($1,$2,COALESCE($3::real,0),$4::real,COALESCE($5::int,0))
     ON CONFLICT (shot_date, person) DO UPDATE SET
       dose_mg   = COALESCE($3::real, reta_shots.dose_mg),
       weight_lb = CASE WHEN $6::boolean THEN $4::real ELSE reta_shots.weight_lb END,
       taken     = COALESCE($5::int, reta_shots.taken),
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      input.shot_date,
      input.person,
      input.dose_mg ?? null,
      input.weight_lb ?? null,
      input.taken ?? null,
      // weight_lb is nullable and clearable, so "was it sent?" can't be inferred
      // from the value — pass the intent explicitly.
      input.weight_lb !== void 0
    ]
  );
  return result.rows[0];
}
async function deleteRetaShot(shotDate, person) {
  const pool = await getDb();
  await pool.query(`DELETE FROM reta_shots WHERE shot_date = $1 AND person = $2`, [shotDate, person]);
}
async function listRetaWeekNotes() {
  return queryAll(
    "SELECT shot_date, note FROM reta_week_notes ORDER BY shot_date ASC"
  );
}
async function upsertRetaWeekNote(shotDate, note) {
  const pool = await getDb();
  const text = note && note.trim() ? note.trim() : null;
  if (!text) {
    await pool.query(`DELETE FROM reta_week_notes WHERE shot_date = $1`, [shotDate]);
    return;
  }
  await pool.query(
    `INSERT INTO reta_week_notes (shot_date, note) VALUES ($1,$2)
     ON CONFLICT (shot_date) DO UPDATE SET note = EXCLUDED.note, updated_at = CURRENT_TIMESTAMP`,
    [shotDate, text]
  );
}
async function upsertEodGex(r) {
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
async function getEodGex(opts = {}) {
  const { date, symbol, limit = 200 } = opts;
  if (date && symbol) {
    return queryAll(
      "SELECT * FROM eod_gex WHERE date = ? AND symbol = ? ORDER BY id DESC LIMIT ?",
      [date, symbol, limit]
    );
  }
  if (date) {
    return queryAll(
      "SELECT * FROM eod_gex WHERE date = ? ORDER BY symbol ASC LIMIT ?",
      [date, limit]
    );
  }
  if (symbol) {
    return queryAll(
      "SELECT * FROM eod_gex WHERE symbol = ? ORDER BY date DESC LIMIT ?",
      [symbol, limit]
    );
  }
  return queryAll(
    "SELECT * FROM eod_gex ORDER BY date DESC, symbol ASC LIMIT ?",
    [limit]
  );
}
async function insertPreviewSnapshot(r) {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO preview_snapshots (ts, date, time, spx_price, gex_flip, call_wall, put_wall, expiration)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      r.ts,
      r.date,
      r.time ?? null,
      r.spx_price ?? null,
      r.gex_flip ?? null,
      r.call_wall ?? null,
      r.put_wall ?? null,
      r.expiration ?? null
    ]
  );
}
async function getLatestPreviewSnapshot() {
  await getDb();
  return queryOne(
    "SELECT * FROM preview_snapshots ORDER BY ts DESC LIMIT 1"
  );
}
async function insertHomeStaticSnapshot(payload, ts = Date.now()) {
  const pool = await getDb();
  const now = new Date(ts);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now).filter((p) => p.type !== "literal").reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  await pool.query(
    `INSERT INTO home_static_snapshots (ts, date, payload) VALUES ($1, $2, $3::jsonb)`,
    [ts, `${date.year}-${date.month}-${date.day}`, JSON.stringify(payload)]
  );
}
async function getLatestHomeStaticSnapshot() {
  await getDb();
  const row = await queryOne(
    "SELECT ts, payload FROM home_static_snapshots ORDER BY ts DESC LIMIT 1"
  );
  if (!row) return void 0;
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  return { ts: Number(row.ts), payload };
}
async function insertMultGreekStaticSnapshot(payload, ts = Date.now()) {
  const pool = await getDb();
  const now = new Date(ts);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now).filter((p) => p.type !== "literal").reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  await pool.query(
    `INSERT INTO mult_greek_static_snapshots (ts, date, payload) VALUES ($1, $2, $3::jsonb)`,
    [ts, `${date.year}-${date.month}-${date.day}`, JSON.stringify(payload)]
  );
}
async function getLatestMultGreekStaticSnapshot() {
  await getDb();
  const row = await queryOne(
    "SELECT ts, payload FROM mult_greek_static_snapshots ORDER BY ts DESC LIMIT 1"
  );
  if (!row) return void 0;
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  return { ts: Number(row.ts), payload };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PAID_STATUSES,
  addEmailSend,
  addFarCbTicker,
  addFeedback,
  addSalesExpense,
  addUnsubscribe,
  addWaitlistEmail,
  adoptDefaultBudgetProfile,
  claimWelcomeEmail,
  clearEmCondors,
  clearEmTracker,
  clearUserDiscord,
  consumePasswordReset,
  countActiveSessions,
  countDashboardLayouts,
  countUsers,
  countWaitlist,
  createUser,
  deleteAllSessionsForUser,
  deleteAmazonRow,
  deleteBudgetCategory,
  deleteBzilaAlert,
  deleteDashboardLayout,
  deleteEmCondor,
  deleteEmTrackerRow,
  deleteExpiredSessions,
  deletePropRow,
  deleteRecurring,
  deleteRegisterByTag,
  deleteRegisterRow,
  deleteRetaSetup,
  deleteRetaShot,
  deleteSession,
  deleteSnapshot,
  deleteTradingJournal,
  deleteWatchOption,
  ensureBzilaSnapshotsTable,
  ensureEsCandlesTable,
  ensureExpirationsTable,
  ensureFlowCallsTable,
  ensureGreeksTsTable,
  ensureMvcTable,
  ensurePremiumFlowTable,
  getBzilaAlertCounts,
  getBzilaAlertReport,
  getBzilaAlerts,
  getBzilaNote,
  getBzilaSnapshots,
  getCachedExpirations,
  getCustomerActivity,
  getDailyBalanceBefore,
  getDailyStrategy,
  getDailyStrategyHistory,
  getDashboardLayouts,
  getPagePresets,
  getDb,
  getEmBandsForWeek,
  getEmCondorMarks,
  getEmCondorSummary,
  getEmCondorTicks,
  getEmCondors,
  getEmCondorsUnsettled,
  getEmTrackerPendingForWeek,
  getEmTrackerRows,
  getEmTrackerSummary,
  getEmTrackerUnevaluated,
  getEodGex,
  getEsCandles,
  getEsGap,
  getFlowCalls,
  getGradedConfidenceLog,
  getGreeksTs,
  getIbDailyResults,
  getIbLevels,
  getIbTrailingStats,
  getIctCardPrefs,
  getIctSetupSummary,
  getIctSetups,
  getLatestBzilaSnapshot,
  getLatestDailyBalance,
  getLatestDailyStrategy,
  getLatestHomeStaticSnapshot,
  getLatestMultGreekStaticSnapshot,
  getLatestPremarketSummary,
  getLatestPreviewSnapshot,
  getLatestTdOverview,
  getLatestWatchSnapshots,
  getMomentumBiasSignals,
  getMomentumBiasSummary,
  getMvcSnapshots,
  getNqCandles,
  normGexSymbol,
  getOptionStrikeGexSlots,
  getOptionStrikeGexSlotsWindow,
  getOptionStrikeGexSlotsWindowAny,
  getOptionStrikeNetGexAsOf,
  getOptionStrikeNetGexAsOfOrNearest,
  getOptionStrikeNetGexAtOpen,
  getOptionStrikeRollingNetGex,
  getOrCreateBudgetProfile,
  getPageLoadStatus,
  getPendingIctSetups,
  getPlaybookFeed,
  getPool,
  getPositioningTickers,
  getPremarketSummary,
  getPremiumFlow,
  getPageVisitStats,
  getPageVisitsSince,
  getPromoCode,
  getQuoteSymbols,
  getRecentPageVisits,
  getRecentTrades,
  getSessionWithUser,
  getSnapshots,
  getSubscription,
  getSubscriptionByCustomer,
  getSubscriptionCancellations,
  getTdOverview,
  getTdPrefs,
  getTickerEventCounts,
  getTradeOverrides,
  getTradesByDate,
  getTradingFills,
  getTradingJournals,
  getUnsubscribedSet,
  getUserByEmail,
  getUserByGoogleSub,
  getUserById,
  getUserBzilaReactions,
  getWatchHistory,
  getWatchHistorySince,
  getWatchOptions,
  insertAmazonRow,
  insertBudgetEntry,
  insertBzilaAlert,
  insertBzilaSnapshot,
  insertDailyStrategyHistory,
  insertEmCondorTicks,
  insertFlowCalls,
  insertGreeksTs,
  insertHomeStaticSnapshot,
  insertIctSetup,
  insertMultGreekStaticSnapshot,
  insertMvcSnapshot,
  insertOptionStrikeGexRows,
  insertPageVisit,
  insertPasswordReset,
  insertPlaybookFeed,
  insertPremiumFlow,
  insertPreviewSnapshot,
  insertPropRow,
  insertRecurring,
  insertRegisterRow,
  deleteRegisterRowsInWindow,
  listRegisterInsertBatches,
  listRegisterRowsInWindow,
  clearStatementMonth,
  deleteStatementTx,
  insertStatementTx,
  listStatementMonths,
  listStatementTx,
  listSubscriptions,
  getBudgetAdvice,
  upsertBudgetAdvice,
  setStatementCategoriesBulk,
  setStatementCategoryByMerchant,
  setStatementTxCategory,
  updateStatementTx,
  upsertSubscription,
  insertSession,
  insertTickerEvent,
  insertTradingFills,
  insertTradingJournal,
  insertWatchOption,
  insertWatchSnapshot,
  linkStripeCustomer,
  listAllUsersForBroadcast,
  listAmazonRows,
  listBudgetCategories,
  listBudgetEntries,
  listBudgetProfiles,
  listDiscordConnections,
  listEmailSends,
  listFarCbTickers,
  listFeedback,
  listPromoCodes,
  listPropRows,
  listRecentUsers,
  listRecurring,
  listRegister,
  listRetaSetups,
  listRetaShots,
  listRetaWeekNotes,
  listSalesExpenses,
  listUnsubscribes,
  listUsersWithLastLogin,
  listWaitlist,
  markUserEmailVerified,
  persistDb,
  pgQuery,
  postEsGap,
  pruneEmCondorTicks,
  queryAll,
  queryOne,
  recordSubscriptionCancellation,
  reactBzilaAlert,
  removeSalesExpense,
  removeUnsubscribe,
  reopenEmCondor,
  savePromoCode,
  saveSnapshot,
  setDefaultDashboardLayout,
  setEmCondorSettlement,
  setEmTrackerResult,
  setFeedbackStatus,
  setRegisterCategory,
  setUserDiscord,
  setUserGoogleSub,
  setWatchAddedPrice,
  unsubscribeWaitlistEmail,
  updateBzilaAlert,
  updateEmTrackerOhlc,
  updateEsGapFill,
  updateIctSetupGrade,
  updatePropRow,
  updateRecurring,
  updateRegisterRow,
  updateTradingJournal,
  updateUserPasswordHash,
  upsertBudgetCategory,
  upsertBzilaNote,
  upsertConfidenceLog,
  upsertDailyBalance,
  upsertDailyStrategy,
  upsertDashboardLayout,
  upsertEmCondor,
  upsertEmCondorMarks,
  upsertEmTrackerRow,
  upsertEodGex,
  upsertEsCandle,
  upsertExpirationCache,
  upsertIbDailyResult,
  upsertIbLevels,
  upsertIctCardPrefs,
  upsertNqCandle,
  upsertPageLoadStatus,
  upsertPositioningTickers,
  upsertPremarketSummary,
  upsertQuoteSymbols,
  upsertRetaSetup,
  upsertRetaShot,
  upsertRetaWeekNote,
  upsertSubscription,
  upsertTdOverview,
  upsertTdPrefs,
  upsertTradeOverride,
  upsertTradingJournalDay
});
