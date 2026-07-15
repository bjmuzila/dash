/**
 * server-v2/strategy-engine.js — generic, spec-driven strategy evaluator.
 *
 * ONE engine, shared by the backtester (scripts/backtest-strategy.mjs) and the
 * live fire path. Same pattern as signals-engine.js: plain CJS so both the .mjs
 * scripts and the server import the identical file. If you ever find yourself
 * writing a second copy of this logic for live, stop — that divergence is how
 * every "it backtested great" story ends.
 *
 * A strategy is DATA (JSON), never code. Customers author specs; we never eval
 * their JS on the VPS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * METHODOLOGY — read before trusting a number downstream.
 *
 * • NO LOOKAHEAD, structurally. Indicators are precomputed into arrays; a rule
 *   evaluated at bar i may only read index (i - offset). Reading i+1 is not
 *   expressible in the spec language. This is the [[ict-lookahead-bias]] guard —
 *   there, unconfirmed pivots made every win rate fiction. Don't reintroduce it.
 * • ENTRY FILLS AT THE NEXT BAR'S OPEN, never the signal bar's close. You do not
 *   know a bar's close until it has closed; filling there is a half-bar of free
 *   information and it is worth several points on a 3m ES fade.
 * • Bars never cross a session boundary. Resampling is anchored to the RTH open
 *   (09:30 = minute 570), so 3m buckets are 9:30/9:33/9:36 — matching TradingView.
 * • The engine records the FULL PATH of every trade (MFE/MAE on a time grid) and
 *   applies NO tp/sl by default. Exits are chosen afterward from the MFE/MAE
 *   distributions, not grid-searched for the prettiest win rate. See
 *   suggestExits().
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const RTH_OPEN = 570; // 09:30 ET in minutes
const RTH_CLOSE = 960; // 16:00 ET

/* ── parsing ──────────────────────────────────────────────────────────────── */

/**
 * Same input contract as lib/ibStats.ts parseCsv:
 *     YYYYMMDD HHMMSS,open,high,low,close,volume
 * @returns {{date:string,min:number,o:number,h:number,l:number,c:number,v:number}[]}
 */
function parseCsv(text) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const p = line.split(",");
    if (p.length < 6) continue;
    const m = p[0].trim().match(/^(\d{4})(\d{2})(\d{2})[ T](\d{2}):?(\d{2})/);
    if (!m) continue; // silently skips a header row
    const [, Y, Mo, D, H, Mi] = m;
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
    if (![o, h, l, c].every(Number.isFinite)) continue;
    rows.push({
      date: `${Y}-${Mo}-${D}`,
      min: +H * 60 + +Mi,
      o, h, l, c,
      v: Number.isFinite(v) ? v : 0,
    });
  }
  return rows;
}

/* ── resampling ───────────────────────────────────────────────────────────── */

/**
 * Resample 1m bars to `tf` minutes, anchored to the RTH open and never spanning
 * a session. Returns bars tagged with their session date + bucket-start minute.
 */
function resample(rows, tf, { session = "RTH" } = {}) {
  const out = [];
  const byDay = new Map();
  for (const r of rows) {
    if (session === "RTH" && (r.min < RTH_OPEN || r.min >= RTH_CLOSE)) continue;
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date).push(r);
  }
  for (const date of [...byDay.keys()].sort()) {
    const day = byDay.get(date).sort((a, b) => a.min - b.min);
    const buckets = new Map();
    for (const r of day) {
      // anchor: bucket boundaries fall on 09:30 + k*tf
      const k = Math.floor((r.min - RTH_OPEN) / tf);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(r);
    }
    for (const k of [...buckets.keys()].sort((a, b) => a - b)) {
      const g = buckets.get(k);
      out.push({
        date,
        min: RTH_OPEN + k * tf,
        o: g[0].o,
        h: Math.max(...g.map((x) => x.h)),
        l: Math.min(...g.map((x) => x.l)),
        c: g[g.length - 1].c,
        v: g.reduce((s, x) => s + x.v, 0),
        n: g.length, // source bars folded in; partial buckets are visible, not hidden
      });
    }
  }
  return out;
}

/* ── indicators ───────────────────────────────────────────────────────────── */
/* Every fn returns a full-length array aligned to `bars`, null where undefined.
   Values at index i use ONLY bars[0..i]. That invariant is the whole ballgame. */

const series = {
  close: (b) => b.map((x) => x.c),
  open: (b) => b.map((x) => x.o),
  high: (b) => b.map((x) => x.h),
  low: (b) => b.map((x) => x.l),
  volume: (b) => b.map((x) => x.v),
  hl2: (b) => b.map((x) => (x.h + x.l) / 2),
  typical: (b) => b.map((x) => (x.h + x.l + x.c) / 3),
};

function sma(src, len) {
  const out = new Array(src.length).fill(null);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= len) sum -= src[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

function stdev(src, len) {
  const out = new Array(src.length).fill(null);
  for (let i = len - 1; i < src.length; i++) {
    const w = src.slice(i - len + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / len;
    // population stdev — matches TradingView's ta.stdev, NOT sample stdev.
    out[i] = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / len);
  }
  return out;
}

function ema(src, len) {
  const out = new Array(src.length).fill(null);
  const k = 2 / (len + 1);
  let prev = null;
  for (let i = 0; i < src.length; i++) {
    if (i === len - 1) {
      prev = src.slice(0, len).reduce((a, b) => a + b, 0) / len;
      out[i] = prev;
    } else if (i >= len) {
      prev = src[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function rsi(bars, len) {
  const c = series.close(bars);
  const out = new Array(c.length).fill(null);
  let ag = 0, al = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    const g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= len) {
      ag += g / len; al += l / len;
      if (i === len) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    } else {
      ag = (ag * (len - 1) + g) / len;
      al = (al * (len - 1) + l) / len;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
  }
  return out;
}

function atr(bars, len) {
  const tr = bars.map((b, i) =>
    i === 0
      ? b.h - b.l
      : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))
  );
  return ema(tr, len); // Wilder-ish; close enough and monotone in len
}

/**
 * Resolve one spec node into an aligned array.
 * Node forms:
 *   { "ind":"close" }                          → price series
 *   { "ind":"close", "offset":1 }              → same, shifted (reads i-1)
 *   { "ind":"bb", "len":20, "mult":2.3, "band":"upper"|"lower"|"mid", "src":"close" }
 *   { "ind":"sma"|"ema"|"rsi"|"atr"|"stdev", "len":n, "src":"close" }
 *   { "value": 70 }                            → constant
 */
function resolve(node, bars, cache) {
  if (node == null) throw new Error("null spec node");
  if (typeof node === "number") return bars.map(() => node);
  if ("value" in node) return bars.map(() => node.value);

  const key = JSON.stringify({ ...node, offset: 0 });
  let arr = cache.get(key);
  if (!arr) {
    const srcName = node.src || "close";
    const src = series[srcName] ? series[srcName](bars) : null;
    switch (node.ind) {
      case "close": case "open": case "high": case "low": case "volume":
      case "hl2": case "typical":
        arr = series[node.ind](bars);
        break;
      case "sma": arr = sma(src, node.len); break;
      case "ema": arr = ema(src, node.len); break;
      case "stdev": arr = stdev(src, node.len); break;
      case "rsi": arr = rsi(bars, node.len); break;
      case "atr": arr = atr(bars, node.len); break;
      case "bb": {
        const mid = sma(src, node.len);
        const sd = stdev(src, node.len);
        const band = node.band || "upper";
        arr = mid.map((m, i) =>
          m == null || sd[i] == null
            ? null
            : band === "mid" ? m
            : band === "upper" ? m + node.mult * sd[i]
            : m - node.mult * sd[i]
        );
        break;
      }
      default:
        throw new Error(`unknown indicator: ${node.ind}`);
    }
    cache.set(key, arr);
  }

  const off = node.offset || 0;
  if (!off) return arr;
  // shift right: index i sees the value from i-off. Never i+off.
  const sh = new Array(arr.length).fill(null);
  for (let i = off; i < arr.length; i++) sh[i] = arr[i - off];
  return sh;
}

/* ── rule evaluation ──────────────────────────────────────────────────────── */

const CMP = {
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
};

function evalNode(node, bars, i, cache) {
  if (node.op === "and") return node.rules.every((r) => evalNode(r, bars, i, cache));
  if (node.op === "or") return node.rules.some((r) => evalNode(r, bars, i, cache));
  if (node.op === "not") return !evalNode(node.rule, bars, i, cache);
  const L = resolve(node.left, bars, cache)[i];
  const R = resolve(node.right, bars, cache)[i];
  if (L == null || R == null) return false; // warmup — not a signal
  const f = CMP[node.cmp];
  if (!f) throw new Error(`unknown cmp: ${node.cmp}`);
  return f(L, R);
}

/* ── the run ──────────────────────────────────────────────────────────────── */

/** Minute offsets at which MFE/MAE are sampled. */
const GRID = [1, 3, 5, 10, 15, 20, 30, 45, 60];

/**
 * Record MFE/MAE from `signalIdx` forward, same session only. Shared by both
 * runStrategy() and runPattern() — one path walker, so the two entry styles can
 * never drift in how they measure an outcome.
 */
function walkPath(bars, signalIdx, entry, side, tf) {
  let mfe = 0, mae = 0;
  const path = {};
  let gi = 0;
  for (let j = signalIdx + 1; j < bars.length && bars[j].date === bars[signalIdx].date; j++) {
    const fav = side === 1 ? bars[j].h - entry : entry - bars[j].l;
    const adv = side === 1 ? entry - bars[j].l : bars[j].h - entry;
    mfe = Math.max(mfe, fav);
    mae = Math.max(mae, adv);
    const elapsed = (j - signalIdx) * tf;
    while (gi < GRID.length && GRID[gi] <= elapsed) { path[GRID[gi]] = { mfe, mae }; gi++; }
    if (gi >= GRID.length) break;
  }
  // pad unfilled grid points (trade ran into the session close)
  while (gi < GRID.length) { path[GRID[gi]] = { mfe, mae }; gi++; }
  return { mfe, mae, path };
}

/**
 * Run a spec over 1m rows. Returns trades with their full excursion path and
 * NO exits applied.
 *
 * @param {object[]} rows   1-minute bars from parseCsv
 * @param {object} spec     strategy spec (see scripts/strategies/*.json)
 */
function runStrategy(rows, spec) {
  const tf = spec.tf ? parseInt(spec.tf, 10) : 5;
  const bars = resample(rows, tf, { session: spec.session || "RTH" });
  const cache = new Map();
  const side = spec.side === "short" ? -1 : 1;
  const trades = [];

  const cooldownBars = Math.ceil((spec.cooldownMin ?? 0) / tf);
  let lastFire = -Infinity;

  for (let i = 0; i < bars.length - 1; i++) {
    // next bar must exist AND be in the same session — we fill at its open.
    const nxt = bars[i + 1];
    if (!nxt || nxt.date !== bars[i].date) continue;
    if (i - lastFire < cooldownBars) continue;

    let fire;
    try {
      fire = evalNode(spec.entry, bars, i, cache);
    } catch (e) {
      throw new Error(`spec error at bar ${i}: ${e.message}`);
    }
    if (!fire) continue;
    lastFire = i;

    const entry = nxt.o; // fill at next open. Not bars[i].c. See header.
    const p = walkPath(bars, i, entry, side, tf);

    trades.push({
      date: bars[i].date,
      min: bars[i].min,
      i,
      entry,
      side: spec.side || "long",
      ...p,
    });
  }
  return { bars, trades, tf };
}

/* ── pattern engine (stateful sequences) ──────────────────────────────────── */
/**
 * Per-bar boolean rules can't express "X happened, now wait for Y" — the setup
 * bar is at an unknown distance, so no fixed `offset` reaches it. This is the
 * state machine for multi-bar patterns, which is what most discretionary setups
 * actually are.
 *
 *   IDLE ──setup──► ARMED ──oppositeColor──► REVERSAL ──trigger──► FILL
 *                     │                          │
 *                     └── expire                 ├── expire
 *                                                └── invalidate
 *
 * Spec shape (see scripts/strategies/bb-reversal-3m.json):
 *   pattern: {
 *     setup:      <rule node>                     // arms the pattern
 *     reversal:   { type:"firstOppositeColor", withinBars:n }
 *     trigger:    { type:"closeBeyond", ref:"reversal.close" }
 *     withinBars: n                               // trigger deadline, from reversal bar
 *     invalidate: { type:"beyond", ref:"reversal.low" }
 *   }
 *
 * Emits `diag` counts at every stage. When a pattern produces few trades you
 * need to know WHICH gate ate them — otherwise you tune blind.
 */
function runPattern(rows, spec) {
  const tf = spec.tf ? parseInt(spec.tf, 10) : 5;
  const bars = resample(rows, tf, { session: spec.session || "RTH" });
  const cache = new Map();
  const side = spec.side === "short" ? -1 : 1;
  const P = spec.pattern;
  if (!P || !P.setup) throw new Error("spec.pattern.setup is required for runPattern");

  const trades = [];
  const diag = {
    setups: 0, noReversal: 0, reversalFound: 0,
    invalidated: 0, noTrigger: 0, triggered: 0, filled: 0,
  };

  const revWithin = (P.reversal && P.reversal.withinBars) || 3;
  const trigWithin = P.withinBars || 3;

  let i = 0;
  while (i < bars.length - 1) {
    if (!evalNode(P.setup, bars, i, cache)) { i++; continue; }
    diag.setups++;
    const pen = bars[i];
    const penColor = Math.sign(pen.c - pen.o); // -1 red, +1 green, 0 doji

    /* ── find the reversal bar: first candle of the OPPOSITE color ────────── */
    let revIdx = -1;
    for (let j = i + 1; j <= i + revWithin && j < bars.length; j++) {
      if (bars[j].date !== pen.date) break;
      const col = Math.sign(bars[j].c - bars[j].o);
      if (col !== 0 && col !== penColor) { revIdx = j; break; } // dojis are neither
    }
    if (revIdx < 0) { diag.noReversal++; i++; continue; }
    diag.reversalFound++;
    const rev = bars[revIdx];

    /* ── wait for the trigger: close beyond the reversal bar's close ──────── */
    let trigIdx = -1, killed = false;
    for (let j = revIdx + 1; j <= revIdx + trigWithin && j < bars.length; j++) {
      if (bars[j].date !== rev.date) break;
      // invalidate FIRST: a new low is checked before the trigger on the same
      // bar. A bar that takes out the low and closes above the reversal close is
      // a stop-run, not a confirmation. Ordering here is not cosmetic.
      if (P.invalidate) {
        const broke = side === 1 ? bars[j].l < rev.l : bars[j].h > rev.h;
        if (broke) { killed = true; break; }
      }
      const beyond = side === 1 ? bars[j].c > rev.c : bars[j].c < rev.c;
      if (beyond) { trigIdx = j; break; }
    }
    if (killed) { diag.invalidated++; i = revIdx + 1; continue; }
    if (trigIdx < 0) { diag.noTrigger++; i = revIdx + 1; continue; }
    diag.triggered++;

    const nxt = bars[trigIdx + 1];
    if (!nxt || nxt.date !== bars[trigIdx].date) { i = trigIdx + 1; continue; }
    diag.filled++;

    const entry = nxt.o; // fill at next open, never the trigger bar's close
    const p = walkPath(bars, trigIdx, entry, side, tf);

    trades.push({
      date: bars[trigIdx].date,
      min: bars[trigIdx].min,
      i: trigIdx,
      entry,
      side: spec.side || "long",
      penIdx: i,
      revIdx,
      // The pattern HANDS you a stop — no percentile fitting needed. Distance
      // from entry to the reversal bar's low is the natural structural risk,
      // and it's per-trade adaptive (wide in vol, tight in chop) in a way a
      // single fitted number can never be.
      structStop: side === 1 ? entry - rev.l : rev.h - entry,
      ...p,
    });

    i = trigIdx + 1; // no overlapping trades from one setup
  }
  return { bars, trades, tf, diag };
}

/**
 * Score the pattern's OWN structural stop (reversal bar low) at a fixed R
 * multiple, instead of a fitted TP/SL. This is the honest first test: does the
 * setup work on its own terms, before any optimization touches it?
 */
function scoreStructural(trades, rMultiple = 2, horizonMin = 20) {
  const scored = trades.map((t) => {
    const g = t.path[horizonMin] || t;
    const risk = t.structStop;
    if (!(risk > 0)) return { ...t, outcome: "skip", r: 0 };
    const tp = risk * rMultiple;
    const hitSl = g.mae >= risk;
    const hitTp = g.mfe >= tp;
    if (hitSl && hitTp) return { ...t, outcome: "loss", r: -1 }; // pessimistic
    if (hitTp) return { ...t, outcome: "win", r: rMultiple };
    if (hitSl) return { ...t, outcome: "loss", r: -1 };
    return { ...t, outcome: "flat", r: 0 };
  });
  return scored.filter((t) => t.outcome !== "skip");
}

/* ── stats ────────────────────────────────────────────────────────────────── */

function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/**
 * Apply a tp/sl to already-recorded trades. Intrabar tp+sl on the same bar is
 * resolved PESSIMISTICALLY (stop first) — we can't know the intrabar sequence
 * from OHLC, and assuming the good fill is how backtests lie.
 */
function applyExits(trades, tp, sl, horizonMin) {
  return trades.map((t) => {
    const g = horizonMin ? t.path[horizonMin] || t : t;
    const hitSl = sl != null && g.mae >= sl;
    const hitTp = tp != null && g.mfe >= tp;
    let r, outcome;
    if (hitSl && hitTp) { r = -1; outcome = "loss"; }        // pessimistic
    else if (hitTp) { r = tp / (sl || tp); outcome = "win"; }
    else if (hitSl) { r = -1; outcome = "loss"; }
    else {
      // timed out — mark to the excursion we actually had at the horizon
      r = 0; outcome = "flat";
    }
    return { ...t, r, outcome };
  });
}

function summarize(scored) {
  const n = scored.length;
  const wins = scored.filter((t) => t.outcome === "win");
  const losses = scored.filter((t) => t.outcome === "loss");
  const winRate = n ? wins.length / n : 0;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.r, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.r, 0) / losses.length) : 0;
  const expectancy = winRate * avgWin - (losses.length / (n || 1)) * avgLoss;
  return {
    n,
    wins: wins.length,
    losses: losses.length,
    flat: n - wins.length - losses.length,
    winRate,
    avgWin,
    avgLoss,
    expectancy, // THIS is the number that matters, not winRate
  };
}

/**
 * Derive tp/sl from the excursion distributions instead of grid-searching for
 * the best-looking win rate. Grid search over the same data you report is how
 * you manufacture an edge that doesn't exist.
 *
 *   SL = ~85th pct of MAE among trades that eventually worked — loose enough to
 *        not stop out the trades that would have paid, tight enough to cut the rest.
 *   TP = median MFE among those same trades, at the horizon where median MFE
 *        stops growing materially (the plateau).
 */
/** Median/p75 MFE + median MAE across the whole time grid. The real product. */
function excursionCurve(trades) {
  return GRID.map((g) => ({
    min: g,
    medMfe: pct(trades.map((t) => (t.path[g] || t).mfe), 0.5),
    medMae: pct(trades.map((t) => (t.path[g] || t).mae), 0.5),
    p75Mfe: pct(trades.map((t) => (t.path[g] || t).mfe), 0.75),
  }));
}

function suggestExits(trades, { horizonMin = 20, workedAt = 0.5 } = {}) {
  const mfes = trades.map((t) => (t.path[horizonMin] || t).mfe);
  const medMfe = pct(mfes, 0.5) || 0;
  const thresh = medMfe * workedAt;
  const worked = trades.filter((t) => (t.path[horizonMin] || t).mfe >= thresh);
  if (!worked.length) return { tp: null, sl: null, note: "no trades cleared the threshold" };
  const sl = pct(worked.map((t) => (t.path[horizonMin] || t).mae), 0.85);
  const tp = pct(worked.map((t) => (t.path[horizonMin] || t).mfe), 0.5);

  // ── EDGE GUARD ──────────────────────────────────────────────────────────
  // If median MFE ≈ median MAE, the post-signal path is symmetric: a random
  // walk. There is no drift to harvest and NO tp/sl can create one — the best
  // you can do is pay the spread more efficiently. Emitting a confident-looking
  // TP/SL here invites the user to tune parameters against noise, which is the
  // exact failure this engine exists to prevent. Refuse instead.
  const medMae = pct(trades.map((t) => (t.path[horizonMin] || t).mae), 0.5) || 0;
  const edgeRatio = medMae > 0 ? medMfe / medMae : 0;
  if (edgeRatio < 1.15) {
    return {
      tp: null,
      sl: null,
      edgeRatio,
      horizonMin,
      nWorked: worked.length,
      note:
        `NO EDGE: median MFE (${medMfe.toFixed(2)}) ≈ median MAE (${medMae.toFixed(2)}) ` +
        `at ${horizonMin}m — ratio ${edgeRatio.toFixed(2)}. The path after this signal is ` +
        `symmetric (random walk). No exit rule fixes that. Do not tune parameters to ` +
        `chase it; change the hypothesis.`,
      curve: excursionCurve(trades),
    };
  }

  // A TP below its own SL is not a strategy. If the fit produces R:R < 1 the
  // distribution isn't supporting the trade — surface it rather than let a 0.5
  // R:R through and hope the win rate covers it. It won't.
  const rr = sl > 0 ? tp / sl : 0;
  return {
    tp,
    sl,
    rr,
    edgeRatio,
    horizonMin,
    nWorked: worked.length,
    note: rr < 1 ? `R:R ${rr.toFixed(2)} — risking more than the median winner pays. Needs >${(100 / (1 + rr)).toFixed(0)}% win rate just to break even.` : null,
    curve: excursionCurve(trades),
  };
}

/**
 * Walk-forward: fit exits on the first `trainFrac` of SESSIONS, report on the
 * rest. An in-sample number is not a result. If train and test diverge badly,
 * the spec is curve-fit and you say so out loud.
 */
function walkForward(trades, { trainFrac = 0.67, horizonMin = 20 } = {}) {
  const dates = [...new Set(trades.map((t) => t.date))].sort();
  const cut = dates[Math.floor(dates.length * trainFrac)];
  const train = trades.filter((t) => t.date < cut);
  const test = trades.filter((t) => t.date >= cut);
  if (!train.length || !test.length) return null;
  const fit = suggestExits(train, { horizonMin });
  return {
    cutDate: cut,
    fit,
    train: summarize(applyExits(train, fit.tp, fit.sl, horizonMin)),
    test: summarize(applyExits(test, fit.tp, fit.sl, horizonMin)), // the only honest column
  };
}

module.exports = {
  parseCsv,
  resample,
  resolve,
  evalNode,
  runStrategy,
  runPattern,
  walkPath,
  scoreStructural,
  applyExits,
  summarize,
  suggestExits,
  excursionCurve,
  walkForward,
  pct,
  GRID,
  RTH_OPEN,
  RTH_CLOSE,
};
