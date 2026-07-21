'use strict';
/**
 * server-v2/scripts/backfill-flow-morning.js
 *
 * Recovers SPX option flow lost when the dashboard container is restarted mid
 * session. Live flow (dxLink / Theta stream) is append-only with NO history — a
 * restart at, say, 10:53 means 09:30–10:53 is gone from flow_prints and the
 * /flow page shows a blank morning. This script pulls that window's trades from
 * the Theta Terminal (still running even with DATA_SOURCE=tt), replays them
 * through the SAME FlowProcessor the live feed uses (identical side inference,
 * coalescing, isOtm, tape shape), and UPSERTs the result into flow_prints.
 *
 * Idempotent — the (ts,symbol,side) PK means re-running can only overwrite, never
 * duplicate. Run it from the dashboard container, e.g.:
 *
 *   docker compose exec -T dashboard node server-v2/scripts/backfill-flow-morning.js
 *   docker compose exec -T dashboard node server-v2/scripts/backfill-flow-morning.js --probe
 *   docker compose exec -T dashboard node server-v2/scripts/backfill-flow-morning.js --from=09:30 --until=10:53 --dry
 *
 * Flags:
 *   --date=YYYY-MM-DD   ET session date (default: today ET)
 *   --expiry=YYYY-MM-DD 0DTE contract expiration (default: same as --date)
 *   --from=HH:MM        window start ET (default: 09:30)
 *   --until=HH:MM       window end ET (default: auto = earliest live SPX print
 *                       that day, i.e. exactly the gap; falls back to 16:00)
 *   --strike-range=N    ± dollars around spot to pull (default: ~8% of spot)
 *   --spot=N            manual spot fallback if the index series can't be fetched
 *   --endpoint=NAME     Theta option-history endpoint (default: trade_quote;
 *                       use `trade` if trade_quote is not entitled — side then
 *                       falls back to the tick rule, no NBBO)
 *   --probe             fetch a thin slice and print the raw column names + a few
 *                       rows for the trade AND index endpoints, then exit. Run
 *                       this FIRST after any Theta API change to confirm the
 *                       field names below still match, then adjust FIELD maps.
 *   --dry               compute + summarize but do NOT write to the DB
 *
 * NOTE: Theta's exact v3 option-trade column names aren't pinned in this repo
 * yet (the OHLC path is). The FIELD_* maps below list the candidates we read in
 * priority order; `--probe` shows you what the terminal actually returns so you
 * can trim them. Everything is defensive: an unknown shape logs and no-ops rather
 * than throwing.
 */

const path = require('path');
const theta = require(path.join(__dirname, '..', 'proxy-thetadata'));
const { FlowProcessor } = require(path.join(__dirname, '..', 'computation', 'flow-processor'));

// Keep the whole morning's coalesced orders — the live default cap (1500) would
// evict the early session. Must be set BEFORE FlowProcessor is instantiated.
if (!process.env.FLOW_TAPE_CAP || Number(process.env.FLOW_TAPE_CAP) < 2_000_000) {
  process.env.FLOW_TAPE_CAP = '2000000';
}
const { backfillFlowRows } = require(path.join(__dirname, '..', 'state', 'flow-history-writer'));

const TAPE_FLOOR = Number(process.env.FLOW_TAPE_FLOOR || 100); // match the live writer

// ── CLI args ─────────────────────────────────────────────────────────────────
function arg(name, def = null) {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (hit == null) return def;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}

// ── ET time helpers ──────────────────────────────────────────────────────────
function todayYmdET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
// ET wall-clock (date + HH:MM[:SS]) -> epoch ms, DST-correct.
function etWallToMs(ymd, hhmmss) {
  const [Y, Mo, D] = String(ymd).split('-').map(Number);
  const [h, mi, s = 0] = String(hhmmss).split(':').map(Number);
  const guess = Date.UTC(Y, Mo - 1, D, h, mi, s);
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(guess)).find((x) => x.type === 'timeZoneName')?.value || 'GMT-5';
  const m = name.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  const offMin = m ? Number(m[1]) * 60 + (m[1].startsWith('-') ? -1 : 1) * Number(m[2] || 0) : -300;
  return guess - offMin * 60_000;
}
const hhmmssFromMs = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour12: false });
const ymdCompact = (ymd) => String(ymd).replace(/-/g, '');

// ── Field candidates (see --probe). First finite/present wins. ───────────────
const num = (...vals) => { for (const v of vals) { const n = Number(v); if (Number.isFinite(n)) return n; } return NaN; };
const F = {
  msOfDay: (r) => num(r.ms_of_day, r.msOfDay, r.time),
  price:   (r) => num(r.price, r.trade_price, r.last, r.close),
  size:    (r) => num(r.size, r.trade_size, r.volume, r.count),
  bid:     (r) => num(r.bid, r.bid_price, r.nbbo_bid),
  ask:     (r) => num(r.ask, r.ask_price, r.nbbo_ask),
};

// Normalize a Theta v3 JSON payload to [{ contract, rows:[obj,…] }]. Handles the
// nested snapshot/history shape (response[].contract + response[].data[]) AND the
// flat {header.format, response:[[...]]} shape (mapped via rowsFromV3).
function normalizeContracts(json) {
  const resp = json?.response || [];
  if (Array.isArray(resp) && resp.length && resp[0] && resp[0].contract && Array.isArray(resp[0].data)) {
    return resp.map((e) => ({ contract: e.contract, rows: e.data }));
  }
  // Flat: one pseudo-contract, rows carry their own strike/right/expiration.
  const flat = theta.rowsFromV3(json);
  return flat.length ? [{ contract: null, rows: flat }] : [];
}

// ── Intraday SPX spot series (for isOtm), minute-keyed. Best-effort. ─────────
async function fetchSpotSeries(dateYmd, fromMs, untilMs) {
  const map = new Map(); // minuteMs -> close
  try {
    const ymd = ymdCompact(dateYmd);
    const json = await theta.thetaGet(
      `/v3/index/history/ohlc?symbol=SPX&start_date=${ymd}&end_date=${ymd}`
      + `&interval=1m&start_time=${hhmmssFromMs(fromMs)}&end_time=${hhmmssFromMs(untilMs)}`,
    );
    for (const { rows } of normalizeContracts(json)) {
      for (const r of rows) {
        const mod = F.msOfDay(r);
        const close = num(r.close, r.price, r.last);
        if (!Number.isFinite(mod) || !(close > 0)) continue;
        const t = etWallToMs(dateYmd, '00:00:00') + mod;
        map.set(Math.floor(t / 60_000) * 60_000, close);
      }
    }
  } catch (e) {
    console.warn('[backfill] spot series unavailable:', String(e.message || e).slice(0, 140));
  }
  return map;
}
function spotAt(series, ms, fallback) {
  const minute = Math.floor(ms / 60_000) * 60_000;
  for (let k = minute; k >= minute - 10 * 60_000; k -= 60_000) {
    const v = series.get(k);
    if (v > 0) return v;
  }
  return fallback;
}

// ── Earliest live SPX print for the date, so --until can auto-fill the gap. ──
async function earliestLiveTs(dateYmd) {
  let Pool;
  try { ({ Pool } = require('pg')); } catch { return null; }
  if (!process.env.DATABASE_URL) return null;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
    max: 1,
  });
  try {
    const r = await pool.query(
      "select min(ts) mn from flow_prints where date=$1 and underlying_norm='SPX'",
      [dateYmd],
    );
    const mn = Number(r.rows?.[0]?.mn);
    return Number.isFinite(mn) ? mn : null;
  } catch { return null; } finally { await pool.end().catch(() => {}); }
}

async function fetchTrades({ endpoint, root, expiryYmd, dateYmd, fromMs, untilMs, strikeRange }) {
  const url =
    `/v3/option/history/${endpoint}?symbol=${encodeURIComponent(root)}`
    + `&expiration=${ymdCompact(expiryYmd)}&start_date=${ymdCompact(dateYmd)}&end_date=${ymdCompact(dateYmd)}`
    + `&start_time=${hhmmssFromMs(fromMs)}&end_time=${hhmmssFromMs(untilMs)}`
    + `&strike_range=${Math.max(40, Math.ceil(strikeRange))}`;
  return theta.thetaGet(url);
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('[backfill] DATABASE_URL unset — nothing to write.'); process.exit(1); }

  const dateYmd = String(arg('date', todayYmdET()));
  const expiryYmd = String(arg('expiry', dateYmd));
  const endpoint = String(arg('endpoint', 'trade_quote'));
  const root = theta.thetaRoot('SPX'); // 'SPXW'
  const fromMs = etWallToMs(dateYmd, String(arg('from', '09:30'))); // etWallToMs accepts HH:MM

  // --until: explicit, else the earliest live print (fill exactly the gap), else 16:00.
  let untilMs;
  const untilArg = arg('until', null);
  if (untilArg) {
    untilMs = etWallToMs(dateYmd, String(untilArg));
  } else {
    const live = await earliestLiveTs(dateYmd);
    untilMs = live && live > fromMs ? live : etWallToMs(dateYmd, '16:00:00');
    if (live) console.log(`[backfill] earliest live SPX print ${hhmmssFromMs(live)} ET — filling ${hhmmssFromMs(fromMs)}→${hhmmssFromMs(untilMs)}`);
  }
  if (!(untilMs > fromMs)) { console.log('[backfill] no gap to fill.'); process.exit(0); }

  // Spot: series for isOtm; a representative value sizes the strike window.
  const spotSeries = await fetchSpotSeries(dateYmd, fromMs, untilMs);
  const seriesVals = [...spotSeries.values()];
  const refSpot = Number(arg('spot', 0)) || (seriesVals.length ? seriesVals[Math.floor(seriesVals.length / 2)] : 0);
  if (!(refSpot > 0)) console.warn('[backfill] no spot — isOtm will be false and OTM-filtered views will miss these rows. Pass --spot=NNNN.');
  const strikeRange = Number(arg('strike-range', 0)) || (refSpot > 0 ? Math.ceil(refSpot * 0.08) : 400);

  console.log(`[backfill] ${root} exp ${expiryYmd} · ${dateYmd} ${hhmmssFromMs(fromMs)}→${hhmmssFromMs(untilMs)} ET · ±$${strikeRange} · endpoint=${endpoint} · refSpot=${refSpot || 'n/a'}`);

  let json;
  try {
    json = await fetchTrades({ endpoint, root, expiryYmd, dateYmd, fromMs, untilMs, strikeRange });
  } catch (e) {
    console.error(`[backfill] trade fetch failed (${endpoint}):`, String(e.message || e).slice(0, 240));
    if (endpoint === 'trade_quote') console.error('[backfill] try --endpoint=trade (no NBBO; side via tick rule).');
    process.exit(1);
  }

  const contracts = normalizeContracts(json);

  if (arg('probe')) {
    console.log('\n=== PROBE: trade endpoint ===');
    console.log('contracts in response:', contracts.length);
    const sample = contracts.find((c) => c.rows && c.rows.length);
    console.log('contract meta keys:', sample?.contract ? Object.keys(sample.contract) : '(flat rows)');
    console.log('row keys:', sample?.rows?.[0] ? Object.keys(sample.rows[0]) : '(none)');
    console.log('first 2 rows:', JSON.stringify((sample?.rows || []).slice(0, 2), null, 2));
    console.log('\n=== PROBE: index spot series ===');
    console.log('minutes fetched:', spotSeries.size, '· sample:', seriesVals.slice(0, 3));
    process.exit(0);
  }

  // Replay every trade through a fresh FlowProcessor — reuse of the live path
  // guarantees identical side/coalesce/isOtm/shape.
  const fp = new FlowProcessor();
  const contractRoot = root; // SPXW → displayUnderlying 'SPX'
  let seen = 0, kept = 0;
  const prints = [];
  for (const { contract, rows } of contracts) {
    for (const r of rows) {
      const mod = F.msOfDay(r);
      const price = F.price(r);
      const size = F.size(r);
      if (!Number.isFinite(mod) || !(price > 0) || !(size > 0)) continue;
      const strike = num(contract?.strike, r.strike);
      const right = String(contract?.right ?? r.right ?? '').toUpperCase();
      if (!(strike > 0) || !(right === 'C' || right === 'P' || right.startsWith('C') || right.startsWith('P'))) continue;
      const time = etWallToMs(dateYmd, '00:00:00') + mod;
      if (time < fromMs || time > untilMs) continue;
      const bid = F.bid(r), ask = F.ask(r);
      const streamerSymbol = theta.streamerSymbolFromContract({
        root: contractRoot, expiration: ymdCompact(expiryYmd), strike, right,
      });
      prints.push({
        streamerSymbol, price, size, time,
        quote: Number.isFinite(bid) && Number.isFinite(ask) ? { bid, ask, t: time } : null,
        spot: spotAt(spotSeries, time, refSpot),
      });
      seen++;
    }
  }
  // Time order so coalescing + the tick-rule side fallback behave like live.
  prints.sort((a, b) => a.time - b.time);
  for (const p of prints) fp.addPrint(p);

  const tape = fp.tape.filter((o) => o.premium >= TAPE_FLOOR);
  kept = tape.length;
  const totalPrem = tape.reduce((s, o) => s + (o.premium || 0), 0);
  const otm = tape.filter((o) => o.isOtm).length;
  console.log(`[backfill] trades read=${seen} → coalesced orders=${fp.tape.length} → ≥$${TAPE_FLOOR} kept=${kept} (otm=${otm}) · premium=$${(totalPrem / 1e6).toFixed(1)}M`);

  if (arg('dry')) { console.log('[backfill] --dry: not writing.'); process.exit(0); }
  if (!kept) { console.log('[backfill] nothing to write.'); process.exit(0); }

  const wrote = await backfillFlowRows(tape, dateYmd);
  console.log(`[backfill] UPSERT ${wrote} rows into flow_prints (date=${dateYmd}). Done.`);
  process.exit(0);
}

main().catch((e) => { console.error('[backfill] fatal:', e); process.exit(1); });
