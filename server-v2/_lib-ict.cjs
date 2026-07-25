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

// ../../mnt/user-data/uploads/spx-gex-dashboard-tt-fixed/lib/calculations/ictConcepts.ts
var ictConcepts_exports = {};
__export(ictConcepts_exports, {
  ICT_WINDOWS: () => ICT_WINDOWS,
  activeWindows: () => activeWindows,
  analyzeICT: () => analyzeICT,
  dailyBias: () => dailyBias,
  dealingRange: () => dealingRange,
  detect2022Model: () => detect2022Model,
  detectBreakers: () => detectBreakers,
  detectCISD: () => detectCISD,
  detectCRT: () => detectCRT,
  detectDisplacement: () => detectDisplacement,
  detectFVGs: () => detectFVGs,
  detectInducement: () => detectInducement,
  detectJudas: () => detectJudas,
  detectLiquidity: () => detectLiquidity,
  detectOrderBlocks: () => detectOrderBlocks,
  detectPO3: () => detectPO3,
  detectPivots: () => detectPivots,
  detectRangeLiquidity: () => detectRangeLiquidity,
  detectStructure: () => detectStructure,
  detectTurtleSoup: () => detectTurtleSoup,
  etDate: () => etDate,
  etMinutes: () => etMinutes,
  liquiditySweepTimes: () => liquiditySweepTimes
});
module.exports = __toCommonJS(ictConcepts_exports);
var SWEEP_WINDOW_MS = 15 * 6e4;
function sweptWithin(sweeps, ts, windowMs) {
  for (const s of sweeps) if (s <= ts && ts - s <= windowMs) return true;
  return false;
}
function etMinutes(ts) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(ts));
  const m = {};
  p.forEach((x) => {
    m[x.type] = x.value;
  });
  return Number(m.hour) % 24 * 60 + Number(m.minute);
}
function etDate(ts) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ts));
}
function detectFVGs(candles, opts = {}) {
  const {
    minWidth = 4,
    widthMode = "ticks",
    tick = 0.25,
    requireCloseConfirm = true,
    mitigation = "wick",
    mitigationPct = 0.5,
    sweepTimes = /* @__PURE__ */ new Set()
  } = opts;
  const wideEnough = (top, bottom) => {
    const dist = top - bottom;
    if (widthMode === "percent") return bottom > 0 && dist / bottom * 100 >= minWidth;
    if (widthMode === "points") return dist >= minWidth;
    return dist >= minWidth * tick;
  };
  const out = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2], b = candles[i - 1], c = candles[i];
    if (c.low > a.high && (!requireCloseConfirm || b.close > a.high) && wideEnough(c.low, a.high)) {
      out.push(mkFvg("bull", c.low, a.high, a.timestamp, c.timestamp));
    } else if (c.high < a.low && (!requireCloseConfirm || b.close < a.low) && wideEnough(a.low, c.high)) {
      out.push(mkFvg("bear", a.low, c.high, a.timestamp, c.timestamp));
    }
  }
  for (const f of out) {
    for (let j = 0; j < candles.length; j++) {
      const k = candles[j];
      if (k.timestamp <= f.ts) continue;
      if (f.inverted) {
        if (f.invertedTs != null && k.timestamp <= f.invertedTs) continue;
        const brokeBack = f.activeDir === "bull" ? k.close < f.bottom : k.close > f.top;
        if (brokeBack) {
          f.endTs = k.timestamp;
          break;
        }
        continue;
      }
      const through = f.dir === "bull" ? k.close < f.bottom : k.close > f.top;
      if (through) {
        f.spent = true;
        if (sweptWithin(sweepTimes, k.timestamp, SWEEP_WINDOW_MS)) {
          f.inverted = true;
          f.invertedTs = k.timestamp;
          f.activeDir = f.dir === "bull" ? "bear" : "bull";
          f.endTs = null;
          continue;
        }
        if (f.endTs == null) f.endTs = k.timestamp;
        break;
      }
      const fillLevel = f.dir === "bull" ? f.top - (f.top - f.bottom) * mitigationPct : f.bottom + (f.top - f.bottom) * mitigationPct;
      const probe = f.dir === "bull" ? mitigation === "close" ? k.close : k.low : mitigation === "close" ? k.close : k.high;
      const into = f.dir === "bull" ? probe <= fillLevel : probe >= fillLevel;
      if (into) {
        if (!f.mitigated) {
          f.mitigated = true;
          f.mitigatedTs = k.timestamp;
        } else if (f.mitigatedTs != null && k.timestamp > f.mitigatedTs && !f.retouched) {
          f.retouched = true;
          f.retouchedTs = k.timestamp;
          f.endTs = k.timestamp;
          break;
        }
      }
    }
  }
  return out;
}
function mkFvg(dir, top, bottom, startTs, ts) {
  return {
    dir,
    top,
    bottom,
    startTs,
    ts,
    mitigated: false,
    mitigatedTs: null,
    retouched: false,
    retouchedTs: null,
    endTs: null,
    spent: false,
    inverted: false,
    invertedTs: null,
    activeDir: dir
  };
}
function detectDisplacement(candles, lookback = 14, mult = 1.6) {
  if (candles.length < lookback + 2) return [];
  const ranges = candles.map((c) => c.high - c.low);
  const out = [];
  let cur = null;
  for (let i = lookback; i < candles.length; i++) {
    const c = candles[i];
    let avg = 0;
    for (let j = i - lookback; j < i; j++) avg += ranges[j];
    avg /= lookback;
    const body = Math.abs(c.close - c.open);
    const dir = c.close >= c.open ? "bull" : "bear";
    const strong = avg > 0 && body >= avg * mult;
    if (strong) {
      if (cur && cur.dir === dir) {
        cur.endTs = c.timestamp;
        cur.endPrice = c.close;
        cur.bodyRatio = Math.max(cur.bodyRatio, body / avg);
      } else {
        if (cur) out.push(cur);
        cur = {
          dir,
          startTs: candles[i - 1].timestamp,
          endTs: c.timestamp,
          startPrice: candles[i - 1].open,
          endPrice: c.close,
          bodyRatio: body / avg
        };
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}
function detectOrderBlocks(candles, disp) {
  const byTs = /* @__PURE__ */ new Map();
  candles.forEach((c, i) => byTs.set(c.timestamp, i));
  const out = [];
  for (const d of disp) {
    const startIdx = byTs.get(d.startTs);
    if (startIdx == null) continue;
    let obIdx = -1;
    for (let k = startIdx; k >= Math.max(0, startIdx - 6); k--) {
      const c = candles[k];
      const cDir = c.close >= c.open ? "bull" : "bear";
      if (cDir !== d.dir) {
        obIdx = k;
        break;
      }
    }
    if (obIdx < 0) continue;
    const ob = candles[obIdx];
    const prev = candles[obIdx - 1];
    const swept = !prev ? false : d.dir === "bull" ? ob.low < prev.low : ob.high > prev.high;
    const a = candles[obIdx + 1], c3 = candles[obIdx + 3];
    const hasImbalance = !!a && !!c3 && (d.dir === "bull" ? c3.low > a.high : c3.high < a.low);
    const confirmTs = Math.max(d.endTs, c3 ? c3.timestamp : d.endTs);
    out.push({
      dir: d.dir,
      top: ob.high,
      bottom: ob.low,
      ts: ob.timestamp,
      confirmTs,
      mitigated: candles.slice(obIdx + 2).some((c) => d.dir === "bull" ? c.low <= ob.high && c.low >= ob.low : c.high >= ob.low && c.high <= ob.high),
      // Price traded fully THROUGH the block: a later candle CLOSED beyond its
      // far side (bull OB violated on a close below its low; bear OB on a close
      // above its high). Spent blocks are dropped from the chart.
      violated: candles.slice(obIdx + 2).some((c) => d.dir === "bull" ? c.close < ob.low : c.close > ob.high),
      swept,
      hasImbalance,
      valid: swept && hasImbalance
    });
  }
  const seen = /* @__PURE__ */ new Set();
  return out.filter((o) => seen.has(o.ts) ? false : (seen.add(o.ts), true));
}
function detectPivots(candles, k = 2) {
  const out = [];
  for (let i = k; i < candles.length - k; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    const confirmIdx = i + k;
    const confirmTs = candles[confirmIdx].timestamp;
    if (isHigh) out.push({ type: "high", price: candles[i].high, ts: candles[i].timestamp, idx: i, confirmIdx, confirmTs });
    if (isLow) out.push({ type: "low", price: candles[i].low, ts: candles[i].timestamp, idx: i, confirmIdx, confirmTs });
  }
  return out.sort((a, b) => a.idx - b.idx);
}
function detectStructure(candles, pivots) {
  const events = [];
  if (!pivots.length) return events;
  let trend = null;
  let lastHigh = null;
  let lastLow = null;
  const avgBody = candles.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / Math.max(1, candles.length);
  const byConfirm = [...pivots].sort((a, b) => a.confirmIdx - b.confirmIdx);
  let pi = 0;
  for (let i = 0; i < candles.length; i++) {
    while (pi < byConfirm.length && byConfirm[pi].confirmIdx <= i) {
      const p = byConfirm[pi];
      if (p.type === "high") lastHigh = p;
      else lastLow = p;
      pi++;
    }
    const c = candles[i];
    const body = Math.abs(c.close - c.open);
    if (lastHigh && c.close > lastHigh.price && lastHigh.confirmIdx <= i) {
      const kind = trend === "bear" ? body >= avgBody * 1.6 ? "MSS" : "CHOCH" : "BOS";
      events.push({ kind, dir: "bull", price: lastHigh.price, ts: c.timestamp });
      trend = "bull";
      lastHigh = null;
    } else if (lastLow && c.close < lastLow.price && lastLow.confirmIdx <= i) {
      const kind = trend === "bull" ? body >= avgBody * 1.6 ? "MSS" : "CHOCH" : "BOS";
      events.push({ kind, dir: "bear", price: lastLow.price, ts: c.timestamp });
      trend = "bear";
      lastLow = null;
    }
  }
  return events;
}
function detectLiquidity(candles, pivots, tolTicks = 4, tick = 0.25) {
  const tol = tolTicks * tick;
  const highs = pivots.filter((p) => p.type === "high");
  const lows = pivots.filter((p) => p.type === "low");
  const lastTs = candles.length ? candles[candles.length - 1].timestamp : 0;
  const cluster = (ps, side) => {
    const used = new Array(ps.length).fill(false);
    const pools2 = [];
    for (let i = 0; i < ps.length; i++) {
      if (used[i]) continue;
      const group = [ps[i]];
      used[i] = true;
      for (let j = i + 1; j < ps.length; j++) {
        if (!used[j] && Math.abs(ps[j].price - ps[i].price) <= tol) {
          group.push(ps[j]);
          used[j] = true;
        }
      }
      const price = group.reduce((s, g) => s + g.price, 0) / group.length;
      const ts = Math.max(...group.map((g) => g.ts));
      const confirmTs = Math.max(...group.map((g) => g.confirmTs));
      const swept = candles.some((c) => c.timestamp > confirmTs && (side === "BSL" ? c.high > price + tol : c.low < price - tol));
      pools2.push({ side, price, ts, confirmTs, count: group.length, swept });
    }
    return pools2;
  };
  const pools = [...cluster(highs, "BSL"), ...cluster(lows, "SSL")];
  return pools.sort((a, b) => b.count - a.count || b.ts - a.ts).filter((p) => lastTs - p.ts < 30 * 60 * 60 * 1e3);
}
function liquiditySweepTimes(candles, pools, tolTicks = 4, tick = 0.25) {
  const tol = tolTicks * tick;
  const sweeps = /* @__PURE__ */ new Set();
  for (const p of pools) {
    for (const c of candles) {
      if (c.timestamp <= p.confirmTs) continue;
      const pierced = p.side === "BSL" ? c.high > p.price + tol : c.low < p.price - tol;
      if (pierced) {
        sweeps.add(c.timestamp);
        break;
      }
    }
  }
  return sweeps;
}
function dealingRange(pivots) {
  const hi = [...pivots].reverse().find((p) => p.type === "high");
  const lo = [...pivots].reverse().find((p) => p.type === "low");
  if (!hi || !lo) return null;
  const high = hi.price, low = lo.price;
  if (!(high > low)) return null;
  const eq = (high + low) / 2;
  const span = high - low;
  const dir = hi.idx > lo.idx ? "bull" : "bear";
  const ote = dir === "bull" ? { from: high - span * 0.62, to: high - span * 0.79 } : { from: low + span * 0.62, to: low + span * 0.79 };
  return { high, low, eq, premiumFrom: eq, discountTo: eq, ote, dir };
}
var ICT_WINDOWS = [
  { id: "asia", label: "Asian Killzone", startMin: 20 * 60, endMin: 24 * 60, kind: "killzone" },
  { id: "london", label: "London Killzone", startMin: 2 * 60, endMin: 5 * 60, kind: "killzone" },
  { id: "nyam", label: "NY AM Killzone", startMin: 7 * 60, endMin: 10 * 60, kind: "killzone" },
  { id: "nypm", label: "NY PM Killzone", startMin: 13 * 60 + 30, endMin: 16 * 60, kind: "killzone" },
  { id: "silver1", label: "Silver Bullet (AM)", startMin: 10 * 60, endMin: 11 * 60, kind: "silver" },
  { id: "silver2", label: "Silver Bullet (PM)", startMin: 14 * 60, endMin: 15 * 60, kind: "silver" },
  { id: "macroAm", label: "NY AM Macro", startMin: 9 * 60 + 50, endMin: 10 * 60 + 10, kind: "macro" },
  { id: "macroPm", label: "NY PM Macro", startMin: 13 * 60 + 10, endMin: 13 * 60 + 40, kind: "macro" }
];
function activeWindows(ts) {
  const m = etMinutes(ts);
  return ICT_WINDOWS.filter((w) => w.startMin <= w.endMin ? m >= w.startMin && m < w.endMin : m >= w.startMin || m < w.endMin);
}
function dailyBias(candles) {
  if (!candles.length) return { dir: "neutral", reason: "no data", prevHigh: null, prevLow: null };
  const days = [...new Set(candles.map((c) => c.date || etDate(c.timestamp)))].sort();
  if (days.length < 2) return { dir: "neutral", reason: "need prior session", prevHigh: null, prevLow: null };
  const today = days[days.length - 1], prev = days[days.length - 2];
  let ph = -Infinity, pl = Infinity;
  for (const c of candles) {
    const d = c.date || etDate(c.timestamp);
    if (d === prev) {
      if (c.high > ph) ph = c.high;
      if (c.low < pl) pl = c.low;
    }
  }
  const todays = candles.filter((c) => (c.date || etDate(c.timestamp)) === today);
  if (!todays.length || !Number.isFinite(ph)) return { dir: "neutral", reason: "session forming", prevHigh: null, prevLow: null };
  const last = todays[todays.length - 1].close;
  const mid = (ph + pl) / 2;
  if (last > mid) return { dir: "bull", reason: "trading above prior-day midpoint \u2192 draw on PDH / BSL", prevHigh: ph, prevLow: pl };
  if (last < mid) return { dir: "bear", reason: "trading below prior-day midpoint \u2192 draw on PDL / SSL", prevHigh: ph, prevLow: pl };
  return { dir: "neutral", reason: "at prior-day equilibrium", prevHigh: ph, prevLow: pl };
}
function detectInducement(candles, pivots) {
  const out = [];
  const byIdx = pivots;
  for (const p of byIdx) {
    for (let i = p.confirmIdx + 1; i < Math.min(candles.length, p.confirmIdx + 12); i++) {
      const c = candles[i];
      if (p.type === "high") {
        if (c.high > p.price && c.close < p.price) {
          out.push({ kind: "inducement", dir: "bear", price: p.price, ts: c.timestamp, note: "buy-side swept" });
          break;
        }
      } else {
        if (c.low < p.price && c.close > p.price) {
          out.push({ kind: "inducement", dir: "bull", price: p.price, ts: c.timestamp, note: "sell-side swept" });
          break;
        }
      }
    }
  }
  return dedupeByTs(out);
}
function detectTurtleSoup(candles, pools, tolTicks = 4, tick = 0.25) {
  const tol = tolTicks * tick;
  const out = [];
  for (const p of pools) {
    if (p.count < 2) continue;
    for (const c of candles) {
      if (c.timestamp <= p.confirmTs) continue;
      if (p.side === "BSL" && c.high > p.price + tol && c.close < p.price) {
        out.push({ kind: "turtleSoup", dir: "bear", price: p.price, ts: c.timestamp, note: "EQH swept, failed" });
        break;
      }
      if (p.side === "SSL" && c.low < p.price - tol && c.close > p.price) {
        out.push({ kind: "turtleSoup", dir: "bull", price: p.price, ts: c.timestamp, note: "EQL swept, failed" });
        break;
      }
    }
  }
  return dedupeByTs(out);
}
function detectJudas(candles) {
  const out = [];
  const opens = [120, 570];
  const days = [...new Set(candles.map((c) => c.date || etDate(c.timestamp)))];
  for (const day of days) {
    const dayBars = candles.filter((c) => (c.date || etDate(c.timestamp)) === day);
    for (const openMin of opens) {
      const win = dayBars.filter((c) => {
        const m = etMinutes(c.timestamp);
        return m >= openMin && m < openMin + 60;
      });
      if (win.length < 3) continue;
      const openPx = win[0].open;
      let hi = -Infinity, lo = Infinity, hiTs = 0, loTs = 0;
      for (const c of win) {
        if (c.high > hi) {
          hi = c.high;
          hiTs = c.timestamp;
        }
        if (c.low < lo) {
          lo = c.low;
          loTs = c.timestamp;
        }
      }
      const lastBar = win[win.length - 1];
      const last = lastBar.close;
      const ts = lastBar.timestamp;
      if (hiTs < loTs && last < openPx) out.push({ kind: "judas", dir: "bear", price: hi, ts, note: "false high at open" });
      else if (loTs < hiTs && last > openPx) out.push({ kind: "judas", dir: "bull", price: lo, ts, note: "false low at open" });
    }
  }
  return dedupeByTs(out);
}
function detectBreakers(candles, obs, structure) {
  const out = [];
  for (const s of structure) {
    const ob = obs.filter((o) => o.ts < s.ts && o.dir !== s.dir).sort((a, b) => b.ts - a.ts)[0];
    if (!ob) continue;
    const retestBar = candles.find((c) => c.timestamp > s.ts && c.low <= ob.top && c.high >= ob.bottom);
    if (retestBar) {
      out.push({
        kind: "breaker",
        dir: s.dir,
        price: s.dir === "bull" ? ob.top : ob.bottom,
        ts: retestBar.timestamp,
        note: "OB flipped on BOS, retested"
      });
    }
  }
  return dedupeByTs(out);
}
function detectCISD(candles, minRun = 3) {
  const out = [];
  let i = 0;
  while (i < candles.length) {
    const dir = candles[i].close >= candles[i].open ? "bull" : "bear";
    let j = i;
    while (j + 1 < candles.length && (candles[j + 1].close >= candles[j + 1].open ? "bull" : "bear") === dir) j++;
    const runLen = j - i + 1;
    if (runLen >= minRun && j + 1 < candles.length) {
      const runOpen = candles[i].open;
      const next = candles[j + 1];
      if (dir === "bull" && next.close < runOpen) out.push({ kind: "cisd", dir: "bear", price: runOpen, ts: next.timestamp, note: "delivery flipped down" });
      if (dir === "bear" && next.close > runOpen) out.push({ kind: "cisd", dir: "bull", price: runOpen, ts: next.timestamp, note: "delivery flipped up" });
    }
    i = j + 1;
  }
  return dedupeByTs(out);
}
function detect2022Model(turtle, structure, fvgs) {
  const out = [];
  for (const ts of turtle) {
    const mss = structure.find((s) => s.kind === "MSS" && s.dir === ts.dir && s.ts > ts.ts && s.ts - ts.ts <= 10 * 3e5);
    if (!mss) continue;
    const fvg = fvgs.find((f) => {
      const activeTs = f.inverted && f.invertedTs != null ? f.invertedTs : f.ts;
      return f.activeDir === ts.dir && activeTs >= mss.ts && activeTs - mss.ts <= 10 * 3e5;
    });
    if (fvg) out.push({ kind: "model2022", dir: ts.dir, price: mss.price, ts: mss.ts, note: "sweep\u2192MSS\u2192FVG" });
  }
  return dedupeByTs(out);
}
function detectPO3(candles) {
  const out = [];
  const days = [...new Set(candles.map((c) => c.date || etDate(c.timestamp)))].sort();
  const dayOf = (c) => c.date || etDate(c.timestamp);
  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    const bars = candles.filter((c) => dayOf(c) === day);
    const prevDay = di > 0 ? days[di - 1] : null;
    const asia = candles.filter((c) => {
      const m = etMinutes(c.timestamp);
      const d = dayOf(c);
      return prevDay != null && d === prevDay && m >= 1200 || d === day && m < 120;
    });
    const london = bars.filter((c) => {
      const m = etMinutes(c.timestamp);
      return m >= 120 && m < 420;
    });
    const ny = bars.filter((c) => {
      const m = etMinutes(c.timestamp);
      return m >= 570 && m < 960;
    });
    if (!asia.length) continue;
    const accLow = Math.min(...asia.map((c) => c.low));
    const accHigh = Math.max(...asia.map((c) => c.high));
    let manipExtreme = null, manipDir = null;
    for (const c of london) {
      if (c.high > accHigh && (manipExtreme == null || c.high > manipExtreme)) {
        manipExtreme = c.high;
        manipDir = "bull";
      }
      if (c.low < accLow && (manipExtreme == null || c.low < manipExtreme)) {
        manipExtreme = c.low;
        manipDir = "bear";
      }
    }
    let distDir = null;
    if (ny.length) {
      const close = ny[ny.length - 1].close;
      distDir = close > (accHigh + accLow) / 2 ? "bull" : "bear";
    }
    out.push({ date: day, accLow, accHigh, manipExtreme, manipDir, distDir });
  }
  return out;
}
function detectRangeLiquidity(range, fvgs, obs) {
  if (!range) return { erlHigh: null, erlLow: null, internal: [] };
  const inRange = (top, bottom) => bottom >= range.low && top <= range.high;
  const internal = [];
  for (const f of fvgs) if ((!f.spent || f.inverted) && inRange(f.top, f.bottom)) internal.push({ top: f.top, bottom: f.bottom, kind: "fvg" });
  for (const o of obs) if (!o.mitigated && !o.violated && inRange(o.top, o.bottom)) internal.push({ top: o.top, bottom: o.bottom, kind: "ob" });
  return { erlHigh: range.high, erlLow: range.low, internal };
}
function detectCRT(candles) {
  if (candles.length < 14) return null;
  const hourKey = (ts2) => `${etDate(ts2)}-${Math.floor(etMinutes(ts2) / 60)}`;
  const groups = /* @__PURE__ */ new Map();
  for (const c of candles) {
    const k = hourKey(c.timestamp);
    const arr = groups.get(k);
    if (arr) arr.push(c);
    else groups.set(k, [c]);
  }
  const keys = [...groups.keys()];
  if (keys.length < 2) return null;
  const rangeKey = keys[keys.length - 2];
  const bars = groups.get(rangeKey);
  const hi = Math.max(...bars.map((c) => c.high));
  const lo = Math.min(...bars.map((c) => c.low));
  const eq = (hi + lo) / 2;
  const ts = bars[0].timestamp;
  const after = candles.filter((c) => c.timestamp > bars[bars.length - 1].timestamp);
  let sweep = null;
  for (const c of after) {
    if (c.high > hi) {
      sweep = "bull";
      break;
    }
    if (c.low < lo) {
      sweep = "bear";
      break;
    }
  }
  return { hi, lo, eq, ts, sweep };
}
function dedupeByTs(arr) {
  const seen = /* @__PURE__ */ new Set();
  return arr.filter((x) => {
    const k = `${x.kind ?? ""}:${x.ts}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}
function analyzeICT(candles) {
  const pivots = detectPivots(candles, 2);
  const displacement = detectDisplacement(candles);
  const liquidity = detectLiquidity(candles, pivots);
  const sweepTimes = liquiditySweepTimes(candles, liquidity);
  const fvgs = detectFVGs(candles, {
    minWidth: 4,
    widthMode: "ticks",
    tick: 0.25,
    // 1.00 ES pt — NOT the Pine 9% default
    requireCloseConfirm: true,
    // close[1] beyond high[2]/low[2]
    mitigation: "wick",
    mitigationPct: 0.5,
    // 50% fill, by wick
    sweepTimes
  });
  const orderBlocks = detectOrderBlocks(candles, displacement);
  const structure = detectStructure(candles, pivots);
  const range = dealingRange(pivots);
  const turtleSoup = detectTurtleSoup(candles, liquidity);
  return {
    fvgs,
    displacement,
    orderBlocks,
    pivots,
    structure,
    liquidity,
    range,
    bias: dailyBias(candles),
    inducement: detectInducement(candles, pivots),
    turtleSoup,
    judas: detectJudas(candles),
    breakers: detectBreakers(candles, orderBlocks, structure),
    cisd: detectCISD(candles),
    model2022: detect2022Model(turtleSoup, structure, fvgs),
    po3: detectPO3(candles),
    rangeLiquidity: detectRangeLiquidity(range, fvgs, orderBlocks),
    crt: detectCRT(candles)
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ICT_WINDOWS,
  activeWindows,
  analyzeICT,
  dailyBias,
  dealingRange,
  detect2022Model,
  detectBreakers,
  detectCISD,
  detectCRT,
  detectDisplacement,
  detectFVGs,
  detectInducement,
  detectJudas,
  detectLiquidity,
  detectOrderBlocks,
  detectPO3,
  detectPivots,
  detectRangeLiquidity,
  detectStructure,
  detectTurtleSoup,
  etDate,
  etMinutes,
  liquiditySweepTimes
});
