'use strict';
/**
 * server-v2/levels-auto-publish.js
 *
 * In-process WEEKLY publisher for the customer-facing /em page. Computes the
 * Estimated-Move + Buy/Sell-Zone levels server-side (levels-engine.js) and POSTs
 * each ticker to /api/levels, which persists them to Postgres. The /em page then
 * reads them per-ticker. No browser, no manual Refresh.
 *
 * Cadence: once per week, Monday ~09:35 ET (after the cash open so the new
 * week's quotes are live and last week's candle is complete). A one-time startup
 * run fires ~30s after boot so a fresh deploy publishes immediately.
 *
 * Wired from server-with-proxy.js after server.listen():
 *   require('./levels-auto-publish').startLevelsAutoPublish(PORT);
 */

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// Persist the last-published week key across restarts so a server-v2 restart
// doesn't wipe the in-memory guard and re-publish (overwriting the good
// Saturday-9am snapshot with worse mid-week/weekend numbers).
const PUB_STATE_FILE = path.join(__dirname, '.levels-last-week');
function readPublishedWeek() {
  try { return fs.readFileSync(PUB_STATE_FILE, 'utf8').trim() || null; } catch { return null; }
}
function writePublishedWeek(wk) {
  try { fs.writeFileSync(PUB_STATE_FILE, String(wk), 'utf8'); } catch (e) { console.log('[levels-pub] could not persist week key:', e.message); }
}
const { computeAllLevels, seedUpcomingWeek, SYMBOLS } = require('./levels-engine');
const { DISPLAY_LABEL } = (() => {
  // SYMBOLS are raw (ESM/NQM); the published rows use display labels (ESU/NQU).
  // Mirror the engine's mapping so the "missing EM" diff compares like-for-like.
  return { DISPLAY_LABEL: { ESM: 'ESU', NQM: 'NQU' } };
})();

// Last publish run summary, surfaced to the owner page via /proxy/levels-status.
let lastRun = null; // { at, reason, ms, emOk, emTotal, posted, failedEm:[], error }
let publishing = false; // true while a run is in flight (so the UI shows progress)

const PUBLISH_HOUR = 9;   // ET
const PUBLISH_MIN = 0;    // ET
const PUBLISH_DOW = 6;    // Saturday (0=Sun ... 6=Sat)
const CHECK_MS = 15 * 60 * 1000; // re-check every 15m whether it's time to fire

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: dowMap[get('weekday')], hour: Number(get('hour')), minute: Number(get('minute')) };
}

/**
 * Key used to publish at most once per trading week. We tag each run to the
 * UPCOMING Monday — i.e. the week the levels are FOR. This way a Saturday or
 * Sunday run and the trading week it precedes share one key, so the weekend
 * publish isn't re-fired when Monday rolls into a new calendar week.
 */
function weekKeyET(d = new Date()) {
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setHours(12, 0, 0, 0);
  const day = et.getDay();                 // 0=Sun..6=Sat
  const daysToMonday = day === 1 ? 0 : ((8 - day) % 7); // next Mon (today if Mon)
  et.setDate(et.getDate() + daysToMonday);
  return et.toISOString().slice(0, 10);
}

/**
 * Run the weekly publish.
 *
 * opts.only — optional array of display tickers (the not-found list) to retry.
 *   When set, only those rows are recomputed/POSTed and the result is MERGED into
 *   the existing lastRun: tickers that now price drop off failedEm, ones that
 *   still fail keep an updated reason. emTotal always reflects the full roster.
 *
 * failedEm is reported as [{ ticker, reason }] so the owner page can show WHY a
 *   name didn't price (no quote vs. straddle unpriced, etc.).
 */
async function publishOnce(base, reason, opts = {}) {
  const t0 = Date.now();
  publishing = true;
  const only = Array.isArray(opts.only) && opts.only.length ? opts.only : null;
  console.log(`[levels-pub] publishing (${reason})${only ? ` — retry ${only.length} not-found` : ''}…`);
  // Expected display tickers (so the "missing EM" diff matches the published rows).
  const expectedAll = SYMBOLS.map((s) => DISPLAY_LABEL[s] || s);
  const emTotal = expectedAll.length;
  // The scope we're actually computing this run (full roster, or the retry subset).
  const expectedRun = only ? only.slice() : expectedAll;
  const asFails = (list) => list.map((t) => ({ ticker: t, reason: 'not computed' }));
  try {
    let payloads, failReasons;
    try {
      ({ payloads, failReasons } = await computeAllLevels(base, only ? { only } : {}));
    } catch (e) {
      console.log(`[levels-pub] compute failed — ${e.message}`);
      // On a subset retry, keep the prior failedEm; on a full run, everything failed.
      const failedEm = only ? (lastRun?.failedEm || asFails(expectedAll)) : asFails(expectedAll);
      lastRun = { at: new Date().toISOString(), reason, ms: Date.now() - t0, emOk: emTotal - failedEm.length, emTotal, posted: 0, failedEm, error: e.message };
      return { ok: false, ...lastRun };
    }
    if (!payloads.length) {
      console.log('[levels-pub] nothing computed — skip');
      const failedEm = only ? (lastRun?.failedEm || asFails(expectedAll)) : asFails(expectedAll);
      lastRun = { at: new Date().toISOString(), reason, ms: Date.now() - t0, emOk: emTotal - failedEm.length, emTotal, posted: 0, failedEm, error: 'nothing computed' };
      return { ok: false, ...lastRun };
    }

    let posted = 0;
    for (const body of payloads) {
      try {
        const r = await fetch(`${base}/api/levels`, {
          method: 'POST',
          headers: Object.assign(
            { 'Content-Type': 'application/json' },
            process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {}
          ),
          body: JSON.stringify(body),
        });
        if (r.ok) posted += 1;
        else console.log(`[levels-pub] POST ${body.ticker} ${r.status}`);
      } catch (e) {
        console.log(`[levels-pub] POST ${body.ticker} failed — ${e.message}`);
      }
    }

    // EM coverage for THIS run's scope: a name failed if it has no priced EM.
    // failReasons (from the engine) already explains why; fall back generically.
    const withEm = new Set(payloads.filter((p) => p.em != null && p.em !== '').map((p) => p.ticker));
    const runFailed = expectedRun
      .filter((t) => !withEm.has(t))
      .map((t) => ({ ticker: t, reason: failReasons[t] || 'no EM priced' }));

    // Build the merged failedEm list.
    let failedEm;
    if (only) {
      // Retry: start from the prior list, drop any that now priced, refresh reasons
      // for any still failing. (Only the retried subset is touched.)
      const retried = new Set(expectedRun);
      const stillFailed = new Map(runFailed.map((f) => [f.ticker, f.reason]));
      const prior = (lastRun?.failedEm || []).map((f) => (typeof f === 'string' ? { ticker: f, reason: 'no EM priced' } : f));
      failedEm = prior
        .filter((f) => !retried.has(f.ticker) || stillFailed.has(f.ticker))
        .map((f) => (stillFailed.has(f.ticker) ? { ticker: f.ticker, reason: stillFailed.get(f.ticker) } : f));
    } else {
      failedEm = runFailed;
    }
    const emOk = emTotal - failedEm.length;

    console.log(`[levels-pub] published ${posted}/${payloads.length} rows — EM ${emOk}/${emTotal}` +
      (failedEm.length ? ` — no EM: ${failedEm.map((f) => f.ticker).join(', ')}` : '') +
      ` in ${Math.round((Date.now() - t0) / 1000)}s`);

    // Seed em_tracker rows for the upcoming week (best-effort). Skip on retries —
    // seeding already happened on the Saturday full run.
    if (!only) { try { await seedUpcomingWeek(base, payloads); } catch (e) { console.log('[levels-pub] seed failed:', e.message); } }

    // Push the new levels to the Pine Seeds repo (best-effort; no-op if unset).
    if (posted > 0) exportToPineSeeds();

    lastRun = {
      at: new Date().toISOString(), reason, ms: Date.now() - t0,
      emOk, emTotal, posted, failedEm, error: null,
    };
    return { ok: posted > 0, ...lastRun };
  } finally {
    publishing = false;
  }
}

/**
 * Best-effort: export levels to the Pine Seeds repo and git push, so a published
 * TradingView indicator (request.seed) shows the new weekly levels. No-op unless
 * PINE_SEEDS_OUT is set. End-of-day cadence on TV's side; runs once per weekly
 * publish. Never throws — a seeds failure must not affect the levels publish.
 *
 *   PINE_SEEDS_OUT   absolute path to the local clone of your seeds repo (required)
 *   PINE_SEEDS_REPO  repo name = exporter --repo (default seed_em_levels)
 */
function exportToPineSeeds() {
  const out = process.env.PINE_SEEDS_OUT;
  if (!out) return; // not configured — skip silently
  const repo = process.env.PINE_SEEDS_REPO || 'seed_em_levels';
  const script = path.join(__dirname, '..', 'pine-seeds', 'pine-seeds-export.js');

  const run = (cmd, args, cwd) => new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: 120000 }, (err, stdout, stderr) => {
      if (err) console.log(`[levels-pub] seeds ${cmd} failed — ${stderr || err.message}`);
      resolve(!err);
    });
  });

  (async () => {
    try {
      const ok = await run('node', [script, '--repo', repo, '--out', out], process.cwd());
      if (!ok) return;
      await run('git', ['add', '.'], out);
      // commit may "fail" with nothing to commit — that's fine, still try push.
      await run('git', ['commit', '-m', `Update levels ${new Date().toISOString().slice(0, 10)}`], out);
      await run('git', ['push'], out);
      console.log('[levels-pub] pine seeds exported + pushed');
    } catch (e) {
      console.log('[levels-pub] seeds export error:', e.message);
    }
  })();
}

function getLastRun() { return lastRun; }
function isPublishing() { return publishing; }

function startLevelsAutoPublish(port) {
  const base = `http://localhost:${port}`;
  // Seed from disk so a restart remembers we already published this week.
  let lastPublishedWeek = readPublishedWeek();

  console.log(`[levels-pub] enabled — weekly, Sat ~${PUBLISH_HOUR}:${String(PUBLISH_MIN).padStart(2, '0')} ET`);

  // NO startup publish: levels are computed once a week (Saturday) and must hold
  // unchanged through Friday's close. Republishing on every boot would overwrite
  // the weekend snapshot with mid-week numbers on any restart. To (re)publish
  // manually, call publishOnce() / hit the manual trigger.

  // Poll: fire ONLY at/after Saturday's publish time, once per upcoming trading
  // week. No Sunday catch-up — a weekend restart must not recompute levels
  // (markets are closed, quotes come back NaN, and the moves are stale anyway).
  // If Saturday's run is ever missed, use the manual "Publish Now" button on the
  // owner dash (/proxy/levels-publish).
  const tick = () => {
    const { dow, hour, minute } = etParts();
    const mins = hour * 60 + minute;
    const target = PUBLISH_HOUR * 60 + PUBLISH_MIN;
    const wk = weekKeyET();
    if (lastPublishedWeek === wk) return;
    const isSatAfterTarget = dow === PUBLISH_DOW && mins >= target;
    if (isSatAfterTarget) {
      publishOnce(base, 'weekly').then((res) => {
        if (res && res.ok) {
          lastPublishedWeek = wk;
          writePublishedWeek(wk); // persist so restarts don't re-publish
        }
      });
    }
  };
  const timer = setInterval(tick, CHECK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { startLevelsAutoPublish, publishOnce, getLastRun, isPublishing };
