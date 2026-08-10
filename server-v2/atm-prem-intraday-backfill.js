'use strict';
/**
 * server-v2/atm-prem-intraday-backfill.js
 *
 * Rebuilds a SESSION of 1-minute Prem Diff buckets from dxLink 1-minute option
 * candles — so a day the recorder missed (it was not deployed yet, it restarted
 * mid-session, the box was down) still has a full intraday chart.
 *
 * ── WHY THIS IS SIMPLER THAN THE LIVE PATH ──────────────────────────────────
 *
 * The live recorder has to DIFFERENCE a cumulative counter, because the chain
 * only ever reports volume-so-far. A candle does not: each 1-minute bar carries
 * the volume traded IN that minute, already. So the arithmetic here is
 *
 *   premium(minute, side) = Σ over band strikes of  close × volume × 100
 *
 * with no previous-snapshot state to keep, no clamping of negative deltas, and
 * no baseline row. A backfilled session is also internally consistent in a way
 * a restarted live session cannot be: one pricing basis throughout, and a
 * cumulative that genuinely starts at the open.
 *
 * ── WHERE IT IS WORSE ───────────────────────────────────────────────────────
 *
 *   · Priced at the bar's CLOSE (last trade in that minute), not the mark. On an
 *     illiquid wing that can sit at the bid or the ask rather than between them.
 *     Rows are written with src='dxlink' and the panel labels the session.
 *   · 1-minute candle retention is much shorter than daily and is not announced.
 *     candle-history's own header notes ~7 days for the ES 1m stream regardless
 *     of what fromTime asks for. Expect today and a handful of prior sessions,
 *     not a year. The run reports the span it actually recovered.
 *
 * ── OVERWRITE POLICY ────────────────────────────────────────────────────────
 *
 * By default this REPLACES the whole session for the symbols named, live rows
 * included. That is deliberate: mixing mark-priced live minutes with
 * close-priced backfilled ones inside one session gives a cumulative line with a
 * seam in it, and half a session of each is worse than either. Pass --keep-live
 * to fill only the minutes that have no live row — useful when the recorder
 * covered most of the day and you just want the pre-deploy morning.
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────
 *
 *   node server-v2/atm-prem-intraday-backfill.js --symbols=SPX,SPY,QQQ
 *   node server-v2/atm-prem-intraday-backfill.js --date=2026-08-07 --dry
 *   node server-v2/atm-prem-intraday-backfill.js --symbols=SPY --keep-live
 *
 * Flags: --symbols=A,B (default SPX,SPY,QQQ) · --date=YYYY-MM-DD (default
 *   today ET) · --dry (compute + report, no DB write) · --keep-live · --batch=N
 *   dxLink symbols per wave (default 120 — 1m bars are ~390 per contract, so
 *   waves carry more events than the daily pull's) · --pad=N percent beyond the
 *   widest band (default 3)
 *
 * Reads proxy-tastytrade's exports only. No proxy file is modified; it opens its
 * own throwaway dxLink connections exactly like candle-history.js does.
 */

const { fetchDailyCandlesBatch, optionSymbol, inferStrikeIncrement, makeMonthlyResolver } = require('./atm-prem-backfill');
const { DxLinkClient } = require('./proxy-tastytrade');
const {
  getPool, BANDS, CONTRACT_MULTIPLIER, AM_SETTLED_ROOTS,
} = require('./atm-prem-recorder');
const { ensureIntradaySchema, upsertIntraday } = require('./atm-prem-intraday-recorder');

// ── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    symbols: ['SPX', 'SPY', 'QQQ'], date: null, dry: false, keepLive: false, batch: 120, pad: 3,
  };
  for (const a of argv.slice(2)) {
    if (a === '--dry') out.dry = true;
    else if (a === '--keep-live') out.keepLive = true;
    else if (a.startsWith('--symbols=')) out.symbols = a.slice(10).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a.startsWith('--date=')) out.date = a.slice(7).trim().slice(0, 10);
    else if (a.startsWith('--batch=')) out.batch = Math.max(10, Math.min(300, Number(a.slice(8)) || 120));
    else if (a.startsWith('--pad=')) out.pad = Math.max(0, Math.min(20, Number(a.slice(6)) || 3));
  }
  return out;
}

// ── Time ─────────────────────────────────────────────────────────────────────

const todayYmdET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

const ET_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

/** { ymd, minutes } of an epoch ms in New York — the session a bar belongs to. */
function etOf(ms) {
  const parts = ET_PARTS.formatToParts(new Date(ms));
  const get = (t) => parts.find((x) => x.type === t)?.value ?? '';
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** RTH by ET wall clock: 09:30 inclusive through 15:59. */
const isRthBar = (ms, day) => {
  const { ymd, minutes } = etOf(ms);
  return ymd === day && minutes >= 570 && minutes < 960;
};

// ── One symbol, one session ──────────────────────────────────────────────────

async function backfillSession(root, day, opts) {
  const { batch, pad, dry, keepLive } = opts;

  // Reach back a couple of days so the replay definitely covers the session,
  // then filter to it. Asking for exactly midnight-to-midnight has bitten every
  // dxFeed integration that assumed fromTime is honoured to the second.
  const fromTime = Date.parse(`${day}T00:00:00Z`) - 2 * 86400_000;

  // 1 ── underlying 1m bars: the session calendar, the price pane, and the
  //      per-minute spot every band assignment is measured against.
  const uKey = DxLinkClient.canonCandleSymbol(`${root}{=1m}`);
  const uMap = await fetchDailyCandlesBatch([`${root}{=1m}`], fromTime, { quietMs: 3000, hardMs: 45_000 });
  const uBars = (uMap.get(uKey) || []).filter((b) => isRthBar(b.time, day));
  if (!uBars.length) {
    console.warn(`[atm-prem-intraday-backfill] ${root} ${day}: no underlying 1m bars — 1m retention probably does not reach this session`);
    return { root, date: day, minutes: 0, rows: 0, wrote: 0 };
  }
  /** minuteMs → underlying close */
  const spotAt = new Map();
  for (const b of uBars) spotAt.set(Math.floor(b.time / 60_000) * 60_000, b.close);
  const minutes = [...spotAt.keys()].sort((a, b) => a - b);
  console.log(`[atm-prem-intraday-backfill] ${root} ${day}: ${minutes.length} RTH minutes on the underlying`);

  // 2 ── which monthlies were front / back that session.
  //
  // The resolver is seeded with the underlying's DAILY sessions, not just this
  // one date. That costs one extra subscription and is what makes the holiday
  // snap work: a resolver that only knows about `day` has no calendar to check
  // the third Friday against, so a Juneteenth-style month would resolve to a
  // Friday the market was shut and every symbol would come back empty — the
  // exact failure the daily backfill already hit once.
  const dKey = DxLinkClient.canonCandleSymbol(`${root}{=1d}`);
  const dMap = await fetchDailyCandlesBatch([`${root}{=1d}`], Date.parse(`${day}T00:00:00Z`) - 400 * 86400_000,
    { quietMs: 2000, hardMs: 30_000 });
  const sessionDates = (dMap.get(dKey) || [])
    .map((b) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(b.time)));
  const amSettled = AM_SETTLED_ROOTS.has(root.toUpperCase().replace(/^\$/, ''));
  const resolve = makeMonthlyResolver(sessionDates.length ? sessionDates : [day], { amSettled });
  const slots = [['front', resolve(day, 0)], ['back', resolve(day, 1)]];
  console.log(`[atm-prem-intraday-backfill] ${root} ${day}: front=${slots[0][1]} back=${slots[1][1]}`);

  const inc = await inferStrikeIncrement(root);
  const widest = Math.max(...BANDS) + pad;
  const lo = Math.min(...spotAt.values());
  const hi = Math.max(...spotAt.values());
  const kLo = Math.floor((lo * (1 - widest / 100)) / inc) * inc;
  const kHi = Math.ceil((hi * (1 + widest / 100)) / inc) * inc;
  const strikes = [];
  for (let k = kLo; k <= kHi + 1e-9; k += inc) strikes.push(Number(k.toFixed(4)));

  /** minuteMs → slot → band → acc */
  const grid = new Map();
  const blank = () => {
    const o = {};
    for (const b of BANDS) o[b] = { callPrem: 0, putPrem: 0, callVol: 0, putVol: 0, strikes: new Set() };
    return o;
  };

  let got = 0;
  let asked = 0;

  for (const [slot, expiry] of slots) {
    if (!expiry) continue;
    const symbols = [];
    for (const k of strikes) {
      symbols.push(`${optionSymbol(root, expiry, 'C', k)}{=1m}`);
      symbols.push(`${optionSymbol(root, expiry, 'P', k)}{=1m}`);
    }
    asked += symbols.length;

    for (let i = 0; i < symbols.length; i += batch) {
      const wave = symbols.slice(i, i + batch);
      // eslint-disable-next-line no-await-in-loop
      const res = await fetchDailyCandlesBatch(wave, fromTime, { quietMs: 3000, hardMs: 120_000 });
      for (const [sym, bars] of res) {
        if (!bars.length) continue;
        got += 1;
        const m = /^\.([A-Z]+)\d{6}([CP])([\d.]+)\{/.exec(sym);
        if (!m) continue;
        const right = m[2];
        const strike = Number(m[3]);
        if (!(strike > 0)) continue;

        for (const bar of bars) {
          if (!isRthBar(bar.time, day)) continue;
          const vol = Number(bar.volume) || 0;
          if (!(vol > 0)) continue;
          const t = Math.floor(bar.time / 60_000) * 60_000;
          const spot = spotAt.get(t);
          if (!(spot > 0)) continue;
          const distPct = Math.abs(strike - spot) / spot * 100;
          if (distPct > Math.max(...BANDS)) continue;
          const notional = Number(bar.close) * vol * CONTRACT_MULTIPLIER;

          if (!grid.has(t)) grid.set(t, { front: blank(), back: blank() });
          const acc = grid.get(t)[slot];
          for (const b of BANDS) {
            if (distPct > b) continue;
            if (right === 'C') { acc[b].callPrem += notional; acc[b].callVol += vol; }
            else { acc[b].putPrem += notional; acc[b].putVol += vol; }
            acc[b].strikes.add(strike);
          }
        }
      }
      process.stdout.write(`\r[atm-prem-intraday-backfill] ${root} ${day} ${slot} ${expiry}: ${Math.min(i + batch, symbols.length)}/${symbols.length} symbols, ${got} with data   `);
    }
    process.stdout.write('\n');
  }

  // 3 ── flatten in time order, accumulating the cumulative as we go. Every RTH
  //      minute gets a row even when nothing traded near the money, so the
  //      cumulative line is continuous and a quiet stretch reads as flat rather
  //      than as a gap in the series.
  const rows = [];
  const cum = { front: {}, back: {} };
  for (const slot of ['front', 'back']) for (const b of BANDS) cum[slot][b] = { call: 0, put: 0 };

  for (const t of minutes) {
    const cell = grid.get(t);
    const spot = spotAt.get(t);
    for (const [slot, expiry] of slots) {
      if (!expiry) continue;
      const acc = cell?.[slot];
      for (const b of BANDS) {
        const a = acc?.[b];
        const callPrem = a?.callPrem ?? 0;
        const putPrem = a?.putPrem ?? 0;
        cum[slot][b].call += callPrem;
        cum[slot][b].put += putPrem;
        rows.push({
          date: day, symbol: root, slot, bandPct: b, minute: new Date(t), expiry, spot,
          callPrem, putPrem,
          callVol: a?.callVol ?? 0, putVol: a?.putVol ?? 0,
          cumCallPrem: cum[slot][b].call, cumPutPrem: cum[slot][b].put,
          strikes: a ? a[b].strikes.size : 0,
          isBaseline: false, src: 'dxlink',
        });
      }
    }
  }

  console.log(`[atm-prem-intraday-backfill] ${root} ${day}: ${got}/${asked} contracts returned 1m history → ${rows.length} rows over ${minutes.length} minutes`);

  if (dry) {
    const sample = rows.filter((r) => r.bandPct === 5 && r.slot === 'front' && r.callPrem + r.putPrem > 0).slice(-5);
    for (const r of sample) {
      const hhmm = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(r.minute);
      console.log(`  ${hhmm} ET  calls $${(r.callPrem / 1e6).toFixed(2)}M  puts $${(r.putPrem / 1e6).toFixed(2)}M  diff $${((r.putPrem - r.callPrem) / 1e6).toFixed(2)}M  (${r.strikes} strikes)`);
    }
    return { root, date: day, minutes: minutes.length, rows: rows.length, wrote: 0 };
  }

  let toWrite = rows;
  if (keepLive) {
    // Only fill the holes. The seam this leaves in the cumulative line is the
    // price of not clobbering minutes the recorder actually measured at the
    // mark — which is why it is opt-in rather than the default.
    const p = getPool();
    const { rows: live } = await p.query(
      `SELECT minute, slot, band_pct FROM atm_prem_intraday
        WHERE symbol = $1 AND date = $2 AND src = 'live'`,
      [root, day],
    );
    const have = new Set(live.map((r) => `${new Date(r.minute).getTime()}|${r.slot}|${Number(r.band_pct)}`));
    toWrite = rows.filter((r) => !have.has(`${r.minute.getTime()}|${r.slot}|${r.bandPct}`));
    console.log(`[atm-prem-intraday-backfill] ${root} ${day}: --keep-live, ${rows.length - toWrite.length} row(s) left as recorded`);
  }

  let wrote = 0;
  for (let i = 0; i < toWrite.length; i += 500) {
    // eslint-disable-next-line no-await-in-loop
    wrote += await upsertIntraday(toWrite.slice(i, i + 500));
  }
  return { root, date: day, minutes: minutes.length, rows: rows.length, wrote };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);
  const day = opts.date || todayYmdET();

  if (!opts.dry && !(await ensureIntradaySchema())) {
    console.error('[atm-prem-intraday-backfill] no DATABASE_URL / schema unavailable — use --dry to test without a database');
    process.exit(1);
  }

  const started = Date.now();
  for (const root of opts.symbols) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await backfillSession(root, day, opts);
      console.log(`[atm-prem-intraday-backfill] ${root} done:`, JSON.stringify(r));
    } catch (e) {
      console.error(`[atm-prem-intraday-backfill] ${root} failed:`, e.message);
    }
  }
  console.log(`[atm-prem-intraday-backfill] finished in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log('Note: these minutes are priced at each bar\'s CLOSE, not the mark the live');
  console.log('recorder uses. The panel labels the session so the two are not confused.');
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => { console.error('[atm-prem-intraday-backfill] fatal:', e); process.exit(1); });
}

module.exports = { backfillSession, isRthBar, etOf };
