'use strict';
/**
 * server-v2/atm-prem-backfill.js
 *
 * Rebuilds history for atm_prem_diff (see atm-prem-recorder.js) from dxLink
 * DAILY CANDLES. Measured on 2026-08-10: a full-year SPY pull recovered 250
 * sessions (2025-08-11 → 2026-08-07) from ~4,400 contract subscriptions in
 * under two minutes.
 *
 * ── HOW IT GETS HISTORICAL OPTION VOLUME WITHOUT A HISTORY VENDOR ───────────
 *
 * TastyTrade's REST chain is a SNAPSHOT: today's volume for currently-listed
 * expirations, nothing for an expiry that has already passed. There is no
 * TastyTrade endpoint for historical option quotes, volume or OHLC.
 *
 * dxLink (the dxFeed stream behind the TastyTrade quote token) has one, sort
 * of: subscribing to a Candle event with `fromTime` makes dxFeed replay a
 * snapshot of every bar since that time before it starts streaming, and that
 * works for option symbols — `.SPY260821C773{=1d}` is a valid candle symbol and
 * each replayed bar carries `close` and `volume`.
 *
 * ── HOW FAR BACK IT REACHES ─────────────────────────────────────────────────
 *
 * EXPIRED contracts DO replay on this token — verified 2026-08-10 against
 * `.SPY260717C743`, a monthly that had already expired, which returned 42 daily
 * bars all carrying volume. So the pull is not limited to still-listed
 * expiries and by default it attempts every monthly in the window.
 *
 * What it is limited by is per-contract retention, which varies and is not
 * announced: that July contract's bars started 2026-05-18, roughly two months
 * before its expiry. A contract only produces a bar on a session it actually
 * traded, and bars with no close are dropped, so the deep past thins out on its
 * own. The script does not guess where the wall is — it reports the SPAN it
 * actually recovered per symbol, and `strikes` on every row records how many
 * strikes returned data for that session, so a thin month is visible rather
 * than silently low.
 *
 * `--listed-only` restricts the pull to expiries the root still lists. That is
 * the safe mode if the entitlement ever changes and dead symbols start coming
 * back empty — it avoids spending a few hundred subscriptions and a 90s
 * hard-timeout per expiry to discover they are empty.
 *
 * ── WHAT A RECOVERED BAR IS NOT ─────────────────────────────────────────────
 *
 *   · The live recorder prices volume at the MARK (bid/ask midpoint at 16:05).
 *     A daily candle carries only a CLOSE — the last trade — so a recovered bar
 *     is priced at last, which on an illiquid wing strike can sit at the bid or
 *     the ask rather than between them. The panel labels src='dxlink' rows.
 *   · Strikes are synthesised at the root's CURRENT increment. A root that
 *     re-struck (a split, a new $1 series) will have gaps. `strikes` on each row
 *     records how many strikes actually returned data, so a thin session is
 *     visible rather than silently low.
 *   · A listed monthly may still have been listed AFTER some of the sessions it
 *     was nominally front month for. Those sessions come back empty and are
 *     skipped rather than written as zero.
 *   · Holiday expiries are resolved off the underlying's own session list, not
 *     a holiday table — see makeMonthlyResolver(). Asking for a third Friday
 *     the market was closed returns zero contracts and looks like a feed
 *     failure; it is not.
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────
 *
 *   node server-v2/atm-prem-backfill.js --probe --symbols=SPY
 *   node server-v2/atm-prem-backfill.js --symbols=SPY --days=365 --dry
 *   node server-v2/atm-prem-backfill.js --symbols=SPY,QQQ,SPX,NVDA --days=365
 *
 * Flags: --probe (reachability check, writes nothing) · --symbols=A,B
 *   · --days=N window to attempt (default 365) · --dry (compute + report, no DB
 *     write) · --batch=N dxLink symbols per subscription wave (default 150)
 *   · --pad=N percent of padding beyond the widest band when synthesising
 *     strikes (default 3, i.e. ±8% for the ±5% band)
 *   · --listed-only to skip expiries the root no longer lists (see above;
 *     `--include-expired` is accepted as a no-op alias for the old default)
 *
 * Requires the same env the server uses: TastyTrade credentials (for the quote
 * token) and DATABASE_URL. Reads proxy-tastytrade's exports only — it changes
 * no proxy file and opens its own throwaway connection, exactly like
 * candle-history.js does, so it cannot disturb the live feed.
 */

const { DxLinkClient, getQuoteToken, fetchExpirations, fetchChainFull } = require('./proxy-tastytrade');
const {
  ensureSchema, upsertRows, monthlyTarget, thirdFriday, AM_SETTLED_ROOTS, BANDS, CONTRACT_MULTIPLIER,
} = require('./atm-prem-recorder');

// ── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  // Expired contracts DO replay (verified — see the header), so the default is
  // a full year and every monthly in it. --listed-only is the restrictive mode.
  const out = { symbols: ['SPY'], days: 365, dry: false, probe: false, batch: 150, pad: 3, listedOnly: false };
  for (const a of argv.slice(2)) {
    if (a === '--dry') out.dry = true;
    else if (a === '--probe') out.probe = true;
    else if (a === '--listed-only') out.listedOnly = true;
    // Accepted and ignored: this WAS the flag that opted IN to expired expiries,
    // back when they were assumed unreachable. They are the default now, so the
    // documented command from that era still does what it says.
    else if (a === '--include-expired') out.listedOnly = false;
    else if (a.startsWith('--symbols=')) out.symbols = a.slice(10).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a.startsWith('--days=')) out.days = Math.max(30, Math.min(1500, Number(a.slice(7)) || 365));
    else if (a.startsWith('--batch=')) out.batch = Math.max(10, Math.min(400, Number(a.slice(8)) || 150));
    else if (a.startsWith('--pad=')) out.pad = Math.max(0, Math.min(20, Number(a.slice(6)) || 3));
  }
  return out;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

const ymdUTC = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(ms));

/**
 * dxFeed stamps a daily candle at the session's start in EXCHANGE time, which
 * lands at 00:00 UTC for US equity dailies. Formatting in UTC therefore gives
 * the correct session date; formatting in America/New_York would shift it back
 * one day for every bar. Do not "fix" this to ET.
 */
const barDate = (timeMs) => ymdUTC(Number(timeMs));

function addMonths(ymd, n) {
  let [y, m] = ymd.split('-').map(Number);
  m += n;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return { y, m };
}

// ── dxLink batched daily candles ─────────────────────────────────────────────

/**
 * Daily candles for MANY symbols over ONE throwaway dxLink connection.
 *
 * candle-history.js does this for a single symbol; a backfill needs a few
 * thousand and one connection each would take hours. Same settle strategy:
 * collect the replay burst, resolve after `quietMs` of silence, hard-stop at
 * `hardMs` so a symbol with no data can't hang the wave.
 *
 * @param {string[]} candleSymbols e.g. ['.SPY260821C773{=1d}', ...]
 * @returns {Promise<Map<string, Array<{time,open,high,low,close,volume}>>>}
 *   keyed by the CANONICAL symbol (dxFeed drops an implicit multiplier of 1, so
 *   '{=1d}' comes back as '{=d}' — see DxLinkClient.canonCandleSymbol).
 */
async function fetchDailyCandlesBatch(candleSymbols, fromTime, { quietMs = 2500, hardMs = 90_000 } = {}) {
  const { token, url } = await getQuoteToken();
  const wanted = new Set(candleSymbols.map((s) => DxLinkClient.canonCandleSymbol(s)));

  return new Promise((resolve) => {
    /** canonSymbol → Map(barTimeMs → bar) */
    const bySymbol = new Map();
    let done = false;
    let quietTimer = null;
    let subscribed = false;

    const finish = () => {
      if (done) return;
      done = true;
      if (quietTimer) clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      try { client.close(); } catch { /* noop */ }
      const out = new Map();
      for (const [sym, bars] of bySymbol) {
        out.set(sym, [...bars.values()].filter((b) => b.close > 0).sort((a, b) => a.time - b.time));
      }
      resolve(out);
    };

    const client = new DxLinkClient({
      url,
      token,
      onEvent: (ev) => {
        if (ev.eventType !== 'Candle') return;
        const sym = DxLinkClient.canonCandleSymbol(ev.eventSymbol);
        if (!wanted.has(sym)) return;
        const t = Number(ev.time);
        const close = Number(ev.close);
        if (!(t > 0) || !(close > 0)) return;
        let volume = Number(ev.volume);
        if (!Number.isFinite(volume)) volume = 0;
        if (!bySymbol.has(sym)) bySymbol.set(sym, new Map());
        const bars = bySymbol.get(sym);
        const prev = bars.get(t);
        // dxFeed replays a bar as several updates: last close wins, widen the
        // range, keep the max (cumulative-per-bar) volume.
        bars.set(t, prev
          ? {
            time: t,
            open: prev.open,
            high: Math.max(prev.high, Number(ev.high) || prev.high),
            low: Math.min(prev.low, Number(ev.low) || prev.low),
            close,
            volume: Math.max(prev.volume, volume),
          }
          : {
            time: t,
            open: Number(ev.open) || close,
            high: Number(ev.high) || close,
            low: Number(ev.low) || close,
            close,
            volume,
          });
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      },
      onStatus: (s) => {
        if (s && s.dxlinkConnected && !subscribed) {
          subscribed = true;
          for (const cs of candleSymbols) client.subscribeCandle(cs, fromTime);
          // Nothing at all may come back (an expiry with no retained history).
          // Start the quiet clock at subscribe time so that case resolves in
          // quietMs rather than sitting until hardMs.
          if (quietTimer) clearTimeout(quietTimer);
          quietTimer = setTimeout(finish, quietMs);
        }
      },
    });

    const hardTimer = setTimeout(finish, hardMs);
    try { client.connect(); } catch { finish(); }
  });
}

// ── Option symbol construction ───────────────────────────────────────────────

/** dxFeed strike text: '773', '773.5' — no trailing zeros, no padding. */
function fmtStrike(k) {
  const s = Number(k);
  return Number.isInteger(s) ? String(s) : String(Number(s.toFixed(3)));
}

/** '.SPY260821C773' — the same shape proxy-thetadata's streamerSymbolFromContract emits. */
function optionSymbol(root, expiryYmd, right, strike) {
  const yymmdd = expiryYmd.replace(/-/g, '').slice(2);
  return `.${root}${yymmdd}${right === 'C' ? 'C' : 'P'}${fmtStrike(strike)}`;
}

/**
 * The root's listed strike increment, inferred from a live chain rather than
 * hardcoded per ticker. Uses the MODE of adjacent-strike gaps near the money —
 * the mean would be dragged up by the wide wings most roots list.
 */
async function inferStrikeIncrement(root) {
  try {
    const { items } = await fetchExpirations(root);
    const today = ymdUTC(Date.now());
    const exp = (items || [])
      .map((it) => String(it['expiration-date'] || '').slice(0, 10))
      .filter((d) => d >= today).sort()[0];
    if (!exp) return 1;
    const chain = await fetchChainFull(root, exp);
    const spot = Number(chain.underlyingPrice) || 0;
    const strikes = [...new Set((chain.items || []).flatMap((g) => (g.strikes || [])
      .map((s) => parseFloat(s['strike-price']))))].filter((k) => k > 0).sort((a, b) => a - b);
    if (strikes.length < 5) return 1;
    const near = spot > 0 ? strikes.filter((k) => Math.abs(k - spot) / spot <= 0.1) : strikes;
    const pool = near.length >= 5 ? near : strikes;
    const counts = new Map();
    for (let i = 1; i < pool.length; i++) {
      const gap = Number((pool[i] - pool[i - 1]).toFixed(4));
      if (gap > 0) counts.set(gap, (counts.get(gap) || 0) + 1);
    }
    let best = 1; let bestN = 0;
    for (const [gap, n] of counts) if (n > bestN) { best = gap; bestN = n; }
    return best || 1;
  } catch {
    return 1;
  }
}

// ── Per-symbol backfill ──────────────────────────────────────────────────────

/**
 * A monthly-expiry resolver that knows about market holidays, without a holiday
 * table — it uses the underlying's own session list as the calendar.
 *
 * THIS IS NOT COSMETIC. When the third Friday is a holiday the monthly expires
 * the THURSDAY before, and the contract symbols carry that Thursday date. Ask
 * dxFeed for the Friday's symbols and every single one comes back empty, which
 * looks exactly like a feed failure.
 *
 * That is precisely what happened on the first full-year SPY pull: 2026-06-19
 * is Juneteenth and fell on the third Friday, so the June monthly expired
 * 2026-06-18. All 350 `.SPY260619…` subscriptions returned nothing while every
 * neighbouring expiry returned 113-241, and the ~23 sessions June was front
 * month for had no leg in the series.
 *
 * A session the underlying did not trade cannot be an expiry, so snapping the
 * target back to the previous session in `sessionDates` fixes it for every
 * holiday, past and future, with no list to maintain. Targets outside the
 * window's range are returned untouched — there is no calendar out there to
 * consult, and walking backwards from one would invent an expiry.
 *
 * (The live recorder does not need this: resolveMonthlies() snaps to what the
 * root actually LISTS, which is only possible for unexpired months.)
 */
function makeMonthlyResolver(sessionDates, { amSettled = false } = {}) {
  const sessions = new Set(sessionDates);
  const sorted = [...sessions].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const snap = (ymd) => {
    if (!sorted.length || ymd < first || ymd > last) return ymd;
    if (sessions.has(ymd)) return ymd;
    let t = Date.parse(`${ymd}T00:00:00Z`);
    // 6 days is enough for any exchange holiday run; give up rather than
    // wandering into the previous week and mislabelling the expiry.
    for (let i = 0; i < 6; i++) {
      t -= 86400_000;
      const c = ymdUTC(t);
      if (sessions.has(c)) return c;
    }
    return ymd;
  };

  /** The n-th monthly expiry on/after `ymd`, holiday-snapped. */
  return (ymd, n) => {
    let [y, m] = ymd.split('-').map(Number);
    // AM-settled roots roll a session early: the expiration date itself has no
    // tape in the expiring contract, so it belongs to the next month. Mirrors
    // monthlyTarget()'s `spent` test in atm-prem-recorder.js — the two must
    // agree or a live row and a backfilled row for the same date would carry
    // different expiries.
    const spent = (tf) => (amSettled ? tf <= ymd : tf < ymd);
    if (spent(snap(thirdFriday(y, m)))) { m += 1; if (m > 12) { m = 1; y += 1; } }
    for (let i = 0; i < n; i++) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return snap(thirdFriday(y, m));
  };
}

/**
 * Which monthly expiries were front or back month during the window, and for
 * which sessions.
 *
 * Returns { byExpiry: Map(expiry -> { front: Set(date), back: Set(date) }),
 *           byDate: Map(date -> { front: expiry, back: expiry }) }.
 * `byDate` exists so the row-flattening step reuses the SAME resolved expiry
 * the pull used, rather than recomputing it and risking the two disagreeing.
 */
function activeMonthlies(sessionDates, opts = {}) {
  const resolve = makeMonthlyResolver(sessionDates, opts);
  const byExpiry = new Map();
  const byDate = new Map();
  const touch = (exp, slot, d) => {
    if (!byExpiry.has(exp)) byExpiry.set(exp, { front: new Set(), back: new Set() });
    byExpiry.get(exp)[slot].add(d);
    if (!byDate.has(d)) byDate.set(d, { front: null, back: null });
    byDate.get(d)[slot] = exp;
  };
  for (const d of sessionDates) {
    touch(resolve(d, 0), 'front', d);
    touch(resolve(d, 1), 'back', d);
  }
  return { byExpiry, byDate, resolve };
}

/** The expiries the root still lists, as a Set of 'YYYY-MM-DD'. */
async function listedExpiries(root) {
  try {
    const { items } = await fetchExpirations(root);
    return new Set((items || [])
      .map((it) => String(it['expiration-date'] || '').slice(0, 10))
      .filter(Boolean));
  } catch {
    return new Set();
  }
}

async function backfillSymbol(root, opts) {
  const { days, batch, pad, dry, listedOnly } = opts;
  const fromTime = Date.now() - days * 86400_000;

  // 1 ── underlying dailies. Also the session calendar for everything below.
  const uKey = DxLinkClient.canonCandleSymbol(`${root}{=1d}`);
  const uMap = await fetchDailyCandlesBatch([`${root}{=1d}`], fromTime, { quietMs: 2000, hardMs: 30_000 });
  const uBars = uMap.get(uKey) || [];
  if (!uBars.length) {
    console.warn(`[atm-prem-backfill] ${root}: no underlying daily candles — skipping`);
    return { root, sessions: 0, rows: 0, error: 'no underlying candles' };
  }
  /** date → { open, high, low, close } */
  const under = new Map();
  for (const b of uBars) under.set(barDate(b.time), b);
  const sessions = [...under.keys()].sort();
  console.log(`[atm-prem-backfill] ${root}: ${sessions.length} sessions ${sessions[0]} → ${sessions[sessions.length - 1]}`);

  const inc = await inferStrikeIncrement(root);
  const widest = Math.max(...BANDS) + pad;
  const amSettled = AM_SETTLED_ROOTS.has(root.toUpperCase().replace(/^\$/, ''));
  const active = activeMonthlies(sessions, { amSettled });

  // Every monthly that was front or back month in the window. Expired ones are
  // included by default — they replay on this token — so this is normally the
  // full list. --listed-only trims it to what the root still lists.
  const allTargets = [...active.byExpiry.keys()].sort()
    .filter((e) => active.byExpiry.get(e).front.size + active.byExpiry.get(e).back.size > 0);
  const listed = listedOnly ? await listedExpiries(root) : null;
  const expiries = listed ? allTargets.filter((e) => listed.has(e)) : allTargets;
  const skipped = allTargets.filter((e) => !expiries.includes(e));
  if (skipped.length) {
    console.log(`[atm-prem-backfill] ${root}: --listed-only, skipping ${skipped.length} delisted monthly(s): ${skipped.join(', ')}`);
  }
  if (!expiries.length) {
    console.warn(`[atm-prem-backfill] ${root}: no monthly overlaps the window — nothing to attempt`);
    return { root, sessions: 0, rows: 0, wrote: 0, skippedExpiries: skipped.length };
  }
  console.log(`[atm-prem-backfill] ${root}: attempting ${expiries.length} monthly(s): ${expiries.join(', ')}`);

  /** date → { front: acc, back: acc } where acc is per-band totals. */
  const perDate = new Map();
  const blankAcc = () => {
    const o = {};
    for (const b of BANDS) o[b] = { callPrem: 0, putPrem: 0, callVol: 0, putVol: 0, strikes: new Set() };
    return o;
  };

  let totalSymbols = 0;
  let hitSymbols = 0;
  /** Expiries that returned nothing even after a retry — reported, not swallowed. */
  const emptyExpiries = [];

  for (const expiry of expiries) {
    const slots = active.byExpiry.get(expiry);
    const dates = [...new Set([...slots.front, ...slots.back])].sort();
    if (!dates.length) continue;

    // Strike range = the underlying's travel across the sessions this expiry
    // was in play, padded. Computing it per expiry (rather than once for the
    // whole year) is what keeps the symbol count in the low thousands.
    let lo = Infinity; let hi = -Infinity;
    for (const d of dates) {
      const c = under.get(d)?.close;
      if (c > 0) { lo = Math.min(lo, c); hi = Math.max(hi, c); }
    }
    if (!(lo < Infinity)) continue;
    const kLo = Math.floor((lo * (1 - widest / 100)) / inc) * inc;
    const kHi = Math.ceil((hi * (1 + widest / 100)) / inc) * inc;

    const strikes = [];
    for (let k = kLo; k <= kHi + 1e-9; k += inc) strikes.push(Number(k.toFixed(4)));
    if (!strikes.length) continue;

    const symbols = [];
    for (const k of strikes) {
      symbols.push(`${optionSymbol(root, expiry, 'C', k)}{=1d}`);
      symbols.push(`${optionSymbol(root, expiry, 'P', k)}{=1d}`);
    }
    totalSymbols += symbols.length;

    // Only sessions this expiry was active for can receive its premium.
    const expFrom = Date.parse(`${dates[0]}T00:00:00Z`) - 3 * 86400_000;

    // One full pass over this expiry's symbols. Returns how many contracts came
    // back with bars, accumulating into perDate as it goes.
    const pullExpiry = async () => {
      let got = 0;
      for (let i = 0; i < symbols.length; i += batch) {
        const wave = symbols.slice(i, i + batch);
        // eslint-disable-next-line no-await-in-loop
        const res = await fetchDailyCandlesBatch(wave, expFrom);
        for (const [sym, bars] of res) {
          if (!bars.length) continue;
          got += 1;
          // '.SPY260821C773{=d}' -> right + strike
          const m = /^\.([A-Z]+)\d{6}([CP])([\d.]+)\{/.exec(sym);
          if (!m) continue;
          const right = m[2];
          const strike = Number(m[3]);
          if (!(strike > 0)) continue;

          for (const bar of bars) {
            const d = barDate(bar.time);
            const u = under.get(d);
            if (!u || !(u.close > 0)) continue;
            const isFront = slots.front.has(d);
            const isBack = slots.back.has(d);
            if (!isFront && !isBack) continue;
            const vol = Number(bar.volume) || 0;
            if (!(vol > 0)) continue;
            const distPct = Math.abs(strike - u.close) / u.close * 100;
            if (distPct > Math.max(...BANDS)) continue;
            const notional = Number(bar.close) * vol * CONTRACT_MULTIPLIER;

            if (!perDate.has(d)) perDate.set(d, { front: blankAcc(), back: blankAcc() });
            const slotAcc = perDate.get(d)[isFront ? 'front' : 'back'];
            for (const b of BANDS) {
              if (distPct > b) continue;
              const acc = slotAcc[b];
              if (right === 'C') { acc.callPrem += notional; acc.callVol += vol; }
              else { acc.putPrem += notional; acc.putVol += vol; }
              acc.strikes.add(strike);
            }
          }
        }
        process.stdout.write(`\r[atm-prem-backfill] ${root} ${expiry}: ${Math.min(i + batch, symbols.length)}/${symbols.length} symbols, ${got} with data   `);
      }
      process.stdout.write('\n');
      return got;
    };

    let got = await pullExpiry();

    // ONE retry when an expiry comes back completely empty — a cheap backstop
    // for a dropped connection or a stalled replay.
    //
    // Note what it is NOT for. The first all-empty expiry seen here (2026-06-19,
    // 0 of 350 contracts) was not transient: that Friday was Juneteenth, the
    // market was shut, and the June monthly had actually expired on the 18th —
    // so every symbol asked for was fictional and a retry just asked for the
    // same fiction again. That class of failure is fixed at the source in
    // makeMonthlyResolver(); this retry only covers the genuinely flaky case.
    //
    // Retrying is only safe BECAUSE got===0 means nothing was accumulated into
    // perDate on the first pass. A partial failure must NOT be retried — the
    // bars that did land would be added a second time and that expiry's premium
    // would silently double. Hence the ===0 test rather than a threshold.
    if (got === 0) {
      console.log(`[atm-prem-backfill] ${root} ${expiry}: 0 of ${symbols.length} contracts returned data — retrying once`);
      got = await pullExpiry();
      if (got === 0) {
        emptyExpiries.push(expiry);
        console.warn(`[atm-prem-backfill] ${root} ${expiry}: still empty after retry — the sessions this expiry covered will have no leg`);
      }
    }

    hitSymbols += got;
  }

  // 3 ── flatten into rows
  const rows = [];
  for (const [date, slotsAcc] of perDate) {
    const u = under.get(date);
    for (const slot of ['front', 'back']) {
      const acc = slotsAcc[slot];
      // A slot with no strikes at all on this date got no data — writing a zero
      // row would draw a real-looking flat bar. Skip it.
      const any = BANDS.some((b) => acc[b].strikes.size > 0);
      if (!any) continue;
      // Reuse the resolved expiry from the pull, not a fresh monthlyTarget()
      // call — the raw helper is holiday-blind and would relabel these rows
      // with a Friday the market was closed.
      const expiry = active.byDate.get(date)?.[slot];
      if (!expiry) continue;
      for (const b of BANDS) {
        const a = acc[b];
        rows.push({
          date, symbol: root, slot, bandPct: b, expiry,
          spot: u?.close ?? null,
          uOpen: u?.open ?? null, uHigh: u?.high ?? null,
          uLow: u?.low ?? null, uClose: u?.close ?? null,
          callPrem: a.callPrem, putPrem: a.putPrem,
          callVol: a.callVol, putVol: a.putVol,
          strikes: a.strikes.size, src: 'dxlink',
        });
      }
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Report the RECOVERED WINDOW, not just a row count. "412 rows" reads like
  // success; "18 sessions, 2026-07-21 → 2026-08-08" is the number that tells
  // you how much of the chart is real and where the EOD recorder takes over.
  const covered = [...perDate.keys()].sort();
  const span = covered.length ? `${covered[0]} → ${covered[covered.length - 1]}` : 'none';
  console.log(`[atm-prem-backfill] ${root}: ${hitSymbols}/${totalSymbols} contracts returned history → ${rows.length} rows over ${perDate.size} sessions (${span})`);
  if (covered.length) {
    const frontCovered = new Set(rows.filter((r) => r.slot === 'front').map((r) => r.date));
    console.log(`[atm-prem-backfill] ${root}: front-month leg present on ${frontCovered.size} of those sessions; everything before ${covered[0]} must accumulate forward from the EOD recorder`);
  }
  if (emptyExpiries.length) {
    // Named, because the effect is a HOLE in the middle of the series — the
    // sessions that expiry was front month for get no bar at all — and a hole
    // in the middle is much easier to mistake for a real quiet stretch than a
    // short series is. Re-run with --days trimmed to just that period to retry.
    console.warn(`[atm-prem-backfill] ${root}: ${emptyExpiries.length} expiry(s) returned nothing even after a retry: ${emptyExpiries.join(', ')} — the sessions they covered have no leg in the series`);
  }

  if (dry) {
    const sample = rows.filter((r) => r.bandPct === 5 && r.slot === 'front').slice(-5);
    for (const r of sample) {
      console.log(`  ${r.date} front ±5%  calls $${(r.callPrem / 1e6).toFixed(1)}M  puts $${(r.putPrem / 1e6).toFixed(1)}M  diff $${((r.putPrem - r.callPrem) / 1e6).toFixed(1)}M  (${r.strikes} strikes)`);
    }
    return { root, sessions: perDate.size, rows: rows.length, wrote: 0, span, skippedExpiries: skipped.length, emptyExpiries };
  }

  // 4 ── write, chunked so one failure doesn't lose the whole pull
  let wrote = 0;
  for (let i = 0; i < rows.length; i += 500) {
    // eslint-disable-next-line no-await-in-loop
    wrote += await upsertRows(rows.slice(i, i + 500));
  }
  return { root, sessions: perDate.size, rows: rows.length, wrote, span, skippedExpiries: skipped.length, emptyExpiries };
}

// ── Probe ────────────────────────────────────────────────────────────────────

/**
 * Ten-second answer to "does this account get historical option candles at
 * all?" — the one question that decides whether a backfill is worth starting.
 *
 * Takes the most recent EXPIRED monthly, picks the strike nearest where the
 * underlying was, and asks for its dailies. Also pulls a LIVE expiry's ATM
 * contract as a control: if the live one returns bars and the expired one does
 * not, the feed works and the retention is the limit.
 */
async function probe(root) {
  const fromTime = Date.now() - 400 * 86400_000;
  const uMap = await fetchDailyCandlesBatch([`${root}{=1d}`], fromTime, { quietMs: 2000, hardMs: 30_000 });
  const uBars = uMap.get(DxLinkClient.canonCandleSymbol(`${root}{=1d}`)) || [];
  console.log(`[probe] ${root} underlying dailies: ${uBars.length} bars` +
    (uBars.length ? ` (${barDate(uBars[0].time)} → ${barDate(uBars[uBars.length - 1].time)})` : ''));
  if (!uBars.length) {
    console.log('[probe] VERDICT: no underlying history — the quote token is not returning candle replay at all. Backfill is not possible on this connection.');
    return;
  }

  const inc = await inferStrikeIncrement(root);
  console.log(`[probe] ${root} strike increment: ${inc}`);

  // Most recent monthly that has already expired.
  const today = ymdUTC(Date.now());
  let { y, m } = addMonths(today.slice(0, 7) + '-01', 0);
  let expired = thirdFriday(y, m);
  if (expired >= today) { const p = addMonths(`${y}-${String(m).padStart(2, '0')}-01`, -1); expired = thirdFriday(p.y, p.m); }

  const atExpiry = uBars.filter((b) => barDate(b.time) <= expired).pop();
  const spotThen = Number(atExpiry?.close) || Number(uBars[uBars.length - 1].close);
  const k = Math.round(spotThen / inc) * inc;

  const live = monthlyTarget(today, 0);
  const spotNow = Number(uBars[uBars.length - 1].close);
  const kNow = Math.round(spotNow / inc) * inc;

  const syms = [
    `${optionSymbol(root, expired, 'C', k)}{=1d}`,
    `${optionSymbol(root, expired, 'P', k)}{=1d}`,
    `${optionSymbol(root, live, 'C', kNow)}{=1d}`,
    `${optionSymbol(root, live, 'P', kNow)}{=1d}`,
  ];
  console.log(`[probe] asking for:\n  ${syms.join('\n  ')}`);

  const res = await fetchDailyCandlesBatch(syms, fromTime, { quietMs: 4000, hardMs: 45_000 });
  let expiredBars = 0; let liveBars = 0;
  for (const [sym, bars] of res) {
    const isLive = sym.includes(live.replace(/-/g, '').slice(2));
    if (isLive) liveBars += bars.length; else expiredBars += bars.length;
    const withVol = bars.filter((b) => b.volume > 0).length;
    console.log(`[probe]   ${sym}: ${bars.length} bars, ${withVol} with volume` +
      (bars.length ? ` (${barDate(bars[0].time)} → ${barDate(bars[bars.length - 1].time)})` : ''));
  }

  console.log('');
  if (expiredBars > 0) {
    console.log(`[probe] VERDICT: expired-contract history IS available on this token (${expiredBars} bars off the delisted monthly). The full pull is on — run it with --days=365 --dry first to see the numbers, then without --dry. Per-contract retention still varies, so check the recovered SPAN the run prints rather than assuming it reached the whole year.`);
  } else if (liveBars > 0) {
    console.log(`[probe] VERDICT: LIVE contracts replay history (${liveBars} bars) but this EXPIRED one returned nothing. If that holds across expiries, recoverable history is only the window where a still-listed monthly was already front or back month — roughly the last three to eight weeks. Use --listed-only so the run doesn't spend a 90s timeout per dead expiry.`);
  } else {
    console.log('[probe] VERDICT: no option candle history on either contract, though the underlying works. Candle replay is not entitled for options on this token at all, so even the trailing weeks are unreachable — forward-only via the EOD recorder is the whole path.');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.probe) {
    for (const root of opts.symbols) {
      // eslint-disable-next-line no-await-in-loop
      await probe(root);
    }
    process.exit(0);
  }

  if (!opts.dry && !(await ensureSchema())) {
    console.error('[atm-prem-backfill] no DATABASE_URL / schema unavailable — use --dry to test without a database');
    process.exit(1);
  }

  const started = Date.now();
  for (const root of opts.symbols) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await backfillSymbol(root, opts);
      console.log(`[atm-prem-backfill] ${root} done:`, JSON.stringify(r));
    } catch (e) {
      console.error(`[atm-prem-backfill] ${root} failed:`, e.message);
    }
  }
  console.log(`[atm-prem-backfill] finished in ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => { console.error('[atm-prem-backfill] fatal:', e); process.exit(1); });
}

module.exports = { fetchDailyCandlesBatch, optionSymbol, inferStrikeIncrement, makeMonthlyResolver, activeMonthlies, backfillSymbol, probe };
