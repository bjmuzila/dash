#!/usr/bin/env node
/**
 * server-v2/scripts/gex-level-reaction.mjs
 *
 * When price reached a gamma level, what did it do?
 *
 * Not a ranking and not a prediction. For every (symbol, session) it takes the
 * levels that were ALREADY ON THE BOARD before the open, walks the day's
 * 1-minute bars, and records what happened at each one: was it reached, did it
 * hold, how far past did price get, how long did it sit there, and was it the
 * day's high or low.
 *
 *   node server-v2/scripts/gex-level-reaction.mjs
 *   node server-v2/scripts/gex-level-reaction.mjs --dump        # every observation
 *   node server-v2/scripts/gex-level-reaction.mjs --symbol SPY
 *   node server-v2/scripts/gex-level-reaction.mjs --selftest    # no DB
 *
 * ══ WHY THIS WORKS WITH SIX SESSIONS AND THE OTHER STUDY DOES NOT ═══════════
 * gex-move-study.mjs asks whether a level PREDICTS the next day — a claim about
 * a population, which needs ~60 sessions before a t-stat means anything.
 *
 * This asks what price DID at a level, which is a description of events that
 * either happened or did not. One session of it is already a real observation.
 * The counts here are small and are printed as counts, never as a rate with an
 * implied confidence — "18 of 31 held" is a fact; "58% hold rate" invites a
 * conclusion the sample cannot carry, so this prints the former.
 *
 * ══ NO LOOKAHEAD, BY CONSTRUCTION ═══════════════════════════════════════════
 * The levels for session T come from the sweep at T−1's 16:05 close. They were
 * on the board, unchangeable, before T opened. Using T's own recorded levels
 * would be circular — that snapshot is taken AFTER the price action it is being
 * asked to explain, and it already contains it.
 *
 * ══ WHAT IS MEASURED, PER LEVEL PER DAY ═════════════════════════════════════
 * Each level is first classified by which side of the prior close it sits on,
 * because that decides what "reaching it" and "holding" even mean:
 *   above the prior close → RESISTANCE: reached when the high tags it, held
 *                           when price fails to extend past it
 *   below                 → SUPPORT:    reached when the low tags it
 *
 *   reached       high (or low) crossed the level at some point in the session
 *   held          price got no further than HOLD_PCT beyond it after reaching
 *   excursion     how far past it price actually went, % of the level
 *   pinned        minutes closed within PIN_PCT of it — the magnet reading
 *   closed_beyond ended the session on the far side
 *   extreme_gap   |day extreme − level| as % — near 0 means the level MARKED
 *                 the day's high or low, which is the strongest single thing
 *                 a wall can do and is invisible in a close-to-close study
 *
 * ══ THE HONEST LIMITS ═══════════════════════════════════════════════════════
 * • Coverage is whatever has BOTH a prior-session level set and 1m bars. That
 *   is the etf_candles roster (~13 names), not the 169-name scanner board.
 * • A level near the prior close is reached by accident almost every day. The
 *   report separates levels by how far away they started (NEAR/MID/FAR), so a
 *   flip sitting 0.1% away is never counted as evidence that flips get reached.
 * • "Held" is not causation. Price stopping at a wall is consistent with the
 *   wall causing it AND with the wall having been placed where resistance
 *   already was. This measures the coincidence and does not explain it.
 */

import process from 'node:process';

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (n) => argv.includes(`--${n}`);

const LOOKBACK_DAYS = Number(flag('days', 60));
const ONLY_SYMBOL = String(flag('symbol', '')).toUpperCase();
/** Beyond this much past a level, it did not hold. 0.1% of the level. */
const HOLD_PCT = Number(flag('hold', 0.001));
/** Within this much of a level counts as sitting on it. 0.25%. */
const PIN_PCT = Number(flag('pin', 0.0025));
/** Regular trading hours only, in ET minutes-of-day. Extended-hours bars are in
 *  etf_candles (04:00–20:00) but a wall tagged on 300 shares at 05:12 is not
 *  the event this is trying to describe. --overnight includes them. */
const RTH_OPEN = 9 * 60 + 30, RTH_CLOSE = 16 * 60;

// ── ET helpers ──────────────────────────────────────────────────────────────
const etParts = (ms) => {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(Number(ms)));
  const g = (t) => Number(p.find((x) => x.type === t)?.value);
  return { minutes: g('hour') * 60 + g('minute') };
};

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

// ── levels, from the PRIOR session's recorded ladder ────────────────────────
/** Interpolated zero crossings of the cumulative ladder — the page's rule. */
function gammaFlip(ladder, spot) {
  let cum = 0, prev = null;
  const xs = [];
  for (const r of ladder) {
    const before = cum;
    cum += r.gex;
    if (prev != null && ((before < 0 && cum >= 0) || (before > 0 && cum <= 0))) {
      const t = cum === before ? 0 : (0 - before) / (cum - before);
      xs.push(prev + t * (r.strike - prev));
    }
    prev = r.strike;
  }
  return xs.length ? xs.reduce((b, x) => (Math.abs(x - spot) < Math.abs(b - spot) ? x : b), xs[0]) : null;
}

/**
 * The four levels, from one session's ladder. Same definitions the ΔGEX Board
 * draws, so a number here and a number on the page cannot disagree.
 */
function levelsOf(ladder, spot) {
  if (!(spot > 0) || ladder.length < 5) return null;
  let callWall = null, putWall = null, heaviest = null;
  for (const r of ladder) {
    if (!heaviest || Math.abs(r.gex) > Math.abs(heaviest.gex)) heaviest = r;
    if (r.strike > spot && r.gex > 0 && (!callWall || r.gex > callWall.gex)) callWall = r;
    if (r.strike < spot && r.gex < 0 && (!putWall || r.gex < putWall.gex)) putWall = r;
  }
  const out = [];
  if (putWall) out.push({ kind: 'PUT WALL', level: putWall.strike });
  const flip = gammaFlip(ladder, spot);
  if (flip != null) out.push({ kind: 'FLIP', level: flip });
  if (callWall) out.push({ kind: 'CALL WALL', level: callWall.strike });
  // Only when it is not already one of the walls — otherwise it double-counts
  // the same strike under two names and inflates every total.
  if (heaviest && heaviest.strike !== callWall?.strike && heaviest.strike !== putWall?.strike) {
    out.push({ kind: 'HEAVIEST', level: heaviest.strike });
  }
  return { levels: out, spot };
}

// ── the measurement ─────────────────────────────────────────────────────────
/**
 * Walk one session's bars against one level.
 *
 * `from` is the prior close, which decides whether this level is resistance or
 * support. A level exactly at the prior close is skipped: "reached" is
 * meaningless when you start on top of it.
 */
function reactionOf(bars, level, from) {
  if (!bars.length || !(level > 0) || !(from > 0)) return null;
  const side = level > from ? 'above' : level < from ? 'below' : null;
  if (!side) return null;

  const dayHigh = Math.max(...bars.map((b) => b.high));
  const dayLow = Math.min(...bars.map((b) => b.low));
  const close = bars[bars.length - 1].close;
  const startGap = Math.abs(level - from) / from;

  const touchIdx = bars.findIndex((b) => (side === 'above' ? b.high >= level : b.low <= level));
  const reached = touchIdx >= 0;

  // How far past the level price got, measured only AFTER it was reached.
  // Measuring over the whole day would let a gap-and-fade on the other side
  // count as an excursion past a level price never actually touched.
  let excursion = 0;
  if (reached) {
    const after = bars.slice(touchIdx);
    excursion = side === 'above'
      ? (Math.max(...after.map((b) => b.high)) - level) / level
      : (level - Math.min(...after.map((b) => b.low))) / level;
  }

  return {
    side,
    startGap,
    reached,
    touchMin: reached ? bars[touchIdx].min : null,
    excursion,
    held: reached && excursion <= HOLD_PCT,
    closedBeyond: side === 'above' ? close > level : close < level,
    pinnedBars: bars.filter((b) => Math.abs(b.close - level) / level <= PIN_PCT).length,
    // Near zero = the level marked the day's extreme. The single strongest
    // thing a wall can do, and completely invisible close-to-close.
    extremeGap: side === 'above' ? (dayHigh - level) / level : (level - dayLow) / level,
  };
}

// ── report ──────────────────────────────────────────────────────────────────
const pct = (x, d = 2) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : '—');
const KINDS = ['PUT WALL', 'FLIP', 'CALL WALL', 'HEAVIEST'];
/** How far the level started from the prior close. A level 0.1% away is reached
 *  by accident; counting it as evidence that levels get reached is the easiest
 *  way to make this whole report say nothing while looking impressive. */
const BANDS = [
  ['NEAR  <0.5%', (o) => o.startGap < 0.005],
  ['MID  0.5-1.5%', (o) => o.startGap >= 0.005 && o.startGap < 0.015],
  ['FAR   >1.5%', (o) => o.startGap >= 0.015],
];

function report(obs, cov) {
  console.log(`\n${'═'.repeat(76)}\nCOVERAGE`);
  console.log(`  symbols with BOTH prior-session levels and 1m bars: ${cov.symbols.length}`);
  console.log(`  ${cov.symbols.join(' ') || '(none)'}`);
  console.log(`  sessions: ${cov.dates.length ? `${cov.dates[0]} … ${cov.dates[cov.dates.length - 1]}` : '—'} (${cov.dates.length})`);
  console.log(`  level-days measured: ${obs.length}`);
  for (const m of cov.misses.slice(0, 6)) console.log(`  skipped: ${m}`);

  if (!obs.length) {
    console.log(`\n${'═'.repeat(76)}`);
    console.log('  NOTHING TO MEASURE.');
    console.log('  This needs a symbol to appear in BOTH eod_strike_gex (for the levels)');
    console.log('  and etf_candles (for the bars), on consecutive sessions. If coverage');
    console.log('  above is empty, check that the etf-candle recorder is running — its');
    console.log('  roster is SPY/QQQ/NDX/VIX + the scanner MAIN lane, not all 169 names.');
    console.log(`${'═'.repeat(76)}`);
    return;
  }

  console.log(`\n${'─'.repeat(76)}\nDID PRICE REACH THE LEVEL, AND DID IT HOLD?`);
  console.log('  Counts, not rates — the sample is too small for a percentage to mean');
  console.log('  what a percentage implies.\n');
  for (const [bandName, inBand] of BANDS) {
    const band = obs.filter(inBand);
    if (!band.length) continue;
    console.log(`  ${bandName}   (${band.length} level-days)`);
    console.log('    level        n   reached   held   closed beyond   med excursion   med pin (min)');
    for (const kind of KINDS) {
      const g = band.filter((o) => o.kind === kind);
      if (!g.length) continue;
      const r = g.filter((o) => o.reached);
      const held = r.filter((o) => o.held);
      const beyond = r.filter((o) => o.closedBeyond);
      console.log(
        `    ${kind.padEnd(11)} ${String(g.length).padStart(3)}`
        + `   ${String(r.length).padStart(3)}/${String(g.length).padEnd(3)}`
        + `  ${String(held.length).padStart(3)}/${String(r.length).padEnd(3)}`
        + `   ${String(beyond.length).padStart(3)}/${String(r.length).padEnd(11)}`
        + `  ${(r.length ? pct(median(r.map((o) => o.excursion))) : '—').padStart(9)}`
        + `      ${r.length ? String(Math.round(median(r.map((o) => o.pinnedBars)))).padStart(4) : '   —'}`,
      );
    }
    console.log('');
  }

  console.log(`${'─'.repeat(76)}\nDID THE LEVEL MARK THE DAY'S EXTREME?`);
  console.log('  |day high − level| for resistance, |level − day low| for support.');
  console.log('  Near zero means the level was where the day turned. This is the');
  console.log('  reading a close-to-close study cannot see at all.\n');
  console.log('    level        n   median gap   within 0.25%   within 0.5%');
  for (const kind of KINDS) {
    const g = obs.filter((o) => o.kind === kind && o.startGap >= 0.005);
    if (!g.length) continue;
    const gaps = g.map((o) => Math.abs(o.extremeGap));
    console.log(
      `    ${kind.padEnd(11)} ${String(g.length).padStart(3)}`
      + `   ${pct(median(gaps)).padStart(9)}`
      + `   ${String(gaps.filter((x) => x <= 0.0025).length).padStart(6)}/${String(g.length).padEnd(6)}`
      + `  ${String(gaps.filter((x) => x <= 0.005).length).padStart(5)}/${g.length}`,
    );
  }
  console.log('\n  (NEAR levels excluded — a level 0.3% away is next to the extreme by');
  console.log('   default, and would make every row look impressive.)');

  if (has('dump')) {
    console.log(`\n${'─'.repeat(76)}\nEVERY OBSERVATION`);
    console.log('  date        sym    level      kind        gap    reached  exc      pin  extreme');
    for (const o of obs.sort((a, b) => (a.date < b.date ? -1 : 1))) {
      console.log(
        `  ${o.date}  ${o.symbol.padEnd(6)} ${String(o.level).padStart(9)}  ${o.kind.padEnd(10)}`
        + ` ${pct(o.startGap, 1).padStart(6)}  ${(o.reached ? 'yes' : 'no').padEnd(7)}`
        + ` ${pct(o.excursion, 2).padStart(7)}  ${String(o.pinnedBars).padStart(3)}  ${pct(Math.abs(o.extremeGap), 2).padStart(7)}`,
      );
    }
  }
  console.log(`\n${'═'.repeat(76)}`);
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  if (has('selftest')) return selftest();
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Run inside the container, or use --selftest.');
    process.exit(1);
  }
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
    max: 2,
  });

  // Only symbols that exist in BOTH tables — the intersection IS the coverage.
  const { rows: symRows } = await pool.query(
    `SELECT DISTINCT g.symbol
       FROM eod_strike_gex g
       JOIN etf_candles c ON c.symbol = g.symbol
      WHERE g.date >= CURRENT_DATE - $1::int
      ORDER BY 1`, [LOOKBACK_DAYS]);
  let symbols = symRows.map((r) => r.symbol);
  if (ONLY_SYMBOL) symbols = symbols.filter((s) => s === ONLY_SYMBOL);

  const obs = [];
  const cov = { symbols: [], dates: new Set(), misses: [] };

  for (const symbol of symbols) {
    const { rows: lr } = await pool.query(
      `SELECT to_char(date,'YYYY-MM-DD') AS d, strike, net_gex, spot
         FROM eod_strike_gex
        WHERE symbol = $1 AND date >= CURRENT_DATE - $2::int AND spot > 0
        ORDER BY date, strike`, [symbol, LOOKBACK_DAYS]);
    const byDate = new Map();
    for (const r of lr) {
      if (!byDate.has(r.d)) byDate.set(r.d, { ladder: [], spot: Number(r.spot) });
      byDate.get(r.d).ladder.push({ strike: Number(r.strike), gex: Number(r.net_gex) || 0 });
    }
    const dates = [...byDate.keys()].sort();
    if (dates.length < 2) { cov.misses.push(`${symbol}: <2 recorded sessions`); continue; }

    let used = 0;
    for (let i = 1; i < dates.length; i++) {
      const prev = dates[i - 1], day = dates[i];
      const L = levelsOf(byDate.get(prev).ladder, byDate.get(prev).spot);
      if (!L) continue;
      const priorClose = byDate.get(prev).spot;

      // eslint-disable-next-line no-await-in-loop
      const { rows: cr } = await pool.query(
        `SELECT timestamp, open, high, low, close
           FROM etf_candles WHERE symbol = $1 AND date = $2 ORDER BY timestamp`, [symbol, day]);
      const bars = cr
        .map((b) => ({ ...etParts(b.timestamp), high: Number(b.high), low: Number(b.low), close: Number(b.close) }))
        .filter((b) => Number.isFinite(b.high) && Number.isFinite(b.low)
          && (has('overnight') || (b.minutes >= RTH_OPEN && b.minutes <= RTH_CLOSE)));
      if (bars.length < 30) continue;

      for (const lv of L.levels) {
        const r = reactionOf(bars, lv.level, priorClose);
        if (r) { obs.push({ symbol, date: day, kind: lv.kind, level: lv.level, ...r }); used++; }
      }
      cov.dates.add(day);
    }
    if (used) cov.symbols.push(symbol);
    else cov.misses.push(`${symbol}: levels but no matching 1m bars`);
  }
  await pool.end();

  cov.dates = [...cov.dates].sort();
  report(obs, cov);
}

// ── self-test ───────────────────────────────────────────────────────────────
/**
 * Synthetic sessions with a known shape, so the measurement is verified before
 * it is pointed at real bars. Every assertion below is a claim the report makes
 * out loud, checked against a day whose answer is obvious by construction.
 */
function bars(path) {
  return path.map((p, i) => ({ minutes: RTH_OPEN + i, high: p.h, low: p.l, close: p.c }));
}
function selftest() {
  console.log('SELF-TEST — measurement verified against sessions with a known shape\n');
  let fails = 0;
  const check = (n, ok, d) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  ${d}` : ''}`); if (!ok) fails++; };

  const flat = (v, n) => Array.from({ length: n }, () => ({ h: v, l: v, c: v }));

  // Rallies to exactly 100 and stops dead — the textbook "wall held".
  const holds = reactionOf(bars([...flat(98, 40), { h: 100, l: 99, c: 99.5 }, ...flat(99, 40)]), 100, 98);
  check('resistance reached', holds.reached === true);
  check('…classified as resistance', holds.side === 'above', holds.side);
  check('…held (no excursion past)', holds.held === true && holds.excursion === 0, pct(holds.excursion));
  check('…did not close beyond', holds.closedBeyond === false);
  check('…marked the day high exactly', Math.abs(holds.extremeGap) < 1e-12, pct(holds.extremeGap));

  // Blows through 100 and runs to 103.
  const breaks = reactionOf(bars([...flat(98, 40), { h: 100, l: 99, c: 100 }, ...flat(103, 40)]), 100, 98);
  check('breakout is not "held"', breaks.held === false);
  check('…excursion is measured past the level', Math.abs(breaks.excursion - 0.03) < 1e-9, pct(breaks.excursion));
  check('…closed beyond', breaks.closedBeyond === true);

  // Never gets there.
  const never = reactionOf(bars(flat(97, 80)), 100, 98);
  check('untouched level is not reached', never.reached === false);
  check('…and has zero excursion, not a negative one', never.excursion === 0);

  // Support: the mirror case.
  const sup = reactionOf(bars([...flat(99, 40), { h: 99, l: 95, c: 96 }, ...flat(96, 40)]), 95, 99);
  check('support side detected', sup.side === 'below', sup.side);
  check('…reached and held at the low', sup.reached && sup.held, pct(sup.excursion));

  // Excursion must be measured AFTER the touch, not across the whole day —
  // otherwise a plunge before the level is ever tagged counts against it.
  const late = reactionOf(bars([{ h: 98, l: 90, c: 97 }, ...flat(97, 40), { h: 100, l: 99, c: 100 }, ...flat(99.9, 20)]), 100, 98);
  check('excursion ignores action before the touch', late.excursion === 0, pct(late.excursion));

  // Pinning counts bars closing within the band, not bars that merely wick.
  const pin = reactionOf(bars([...flat(100.1, 30), ...flat(95, 30)]), 100, 98);
  check('pin counts closes inside the band', pin.pinnedBars === 30, `${pin.pinnedBars} bars`);

  // A level sitting exactly on the prior close has no side and is skipped.
  check('level at the prior close is skipped', reactionOf(bars(flat(100, 50)), 100, 100) === null);

  // levelsOf must not emit HEAVIEST when it is already a wall — that would
  // double-count one strike under two names in every total in the report.
  const ladder = [{ strike: 95, gex: -5 }, { strike: 98, gex: -2 }, { strike: 100, gex: 1 },
    { strike: 102, gex: 4 }, { strike: 105, gex: 9 }];
  const L = levelsOf(ladder, 100);
  check('heaviest is not double-counted as its own level',
    !L.levels.some((x) => x.kind === 'HEAVIEST'),
    L.levels.map((x) => x.kind).join(','));
  // For HEAVIEST to be neither wall it has to be a POSITIVE rung below spot or
  // a NEGATIVE rung above it — anything else is, by definition, one of the two
  // walls. 92 carrying +12 under a spot of 100 is the real-world case: a big
  // call-gamma strike left behind after price ran away from it.
  const L2 = levelsOf([{ strike: 92, gex: 12 }, { strike: 95, gex: -5 }, { strike: 100, gex: 1 },
    { strike: 102, gex: 4 }, { strike: 105, gex: 2 }], 100);
  check('…but IS emitted when it is neither wall',
    L2.levels.some((x) => x.kind === 'HEAVIEST'), L2.levels.map((x) => x.kind).join(','));

  console.log(`\n${fails ? `${fails} FAILED` : 'all passed'} — measurement ${fails ? 'is NOT safe to trust' : 'behaves as specified'}`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
