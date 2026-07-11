/**
 * lib/ibStats.ts — Initial Balance (09:30–10:30 ET) rule backtest engine.
 *
 * Pure functions, no DOM / no network. Feed it raw CSV text in the format:
 *     YYYYMMDD HHMMSS,open,high,low,close,volume        (RTH-only 5m bars)
 * and it returns every stat rendered by the Scanner "IB Stats" tab.
 *
 * Definitions (locked — change here, not in the UI):
 *   IB          = 09:30–10:25 bars inclusive (12 × 5m)
 *   Break       = 5m CLOSE outside the IB (wick-only touches tracked separately)
 *   Failed brk  = closes back inside the IB within 6 bars (30m) of the break
 *   Retest      = returns within 2 ticks of the broken level, close stays outside
 *   Narrow IB   = width < 0.5 × ATR14(RTH range)  OR  < 0.75 × 20d avg IB
 *   Wide IB     = width > 1.5 × ATR14(RTH range)  OR  > 1.25 × 20d avg IB
 */

export const ES_TICK = 0.25;

export type Bar = { date: string; min: number; o: number; h: number; l: number; c: number; v: number };

export type FibLeg = {
  hit: boolean;
  cont: boolean;
  fail: boolean | null;
  mfe: number | null;      // in IB widths, measured from the 0.25 entry
  lvl: number | null;
  barsToTouch: number | null;
};

export type Breakout = {
  side: "H" | "L";
  i: number;
  bar: Bar;
  breakMin: number;
  mfe: number;             // points, from the broken level
  mae: number;             // points of adverse heat
  rExt: number;            // mfe / IB width
  rAdv: number;            // mae / IB width
  volSurge: boolean;
  failed: boolean;
  peakBeforeFail: number;
  fadeMid: boolean;
  fadeOpp: boolean;
  retest: boolean;
  retestCont: boolean | null;
  hit: Record<string, boolean>;  // "0.5" | "1" | "1.5" | "2"
  fibA: FibLeg;            // 0.25 of the IB RANGE, back inside the IB
  fibB: FibLeg;            // 0.25 retrace of the post-break IMPULSE
};

export type Day = {
  date: string;
  bars: Bar[];
  ibBars: Bar[];
  post: Bar[];
  ibh: number; ibl: number; mid: number; width: number;
  ibClose: number; ibVol: number;
  first: "H" | "L";            // which IB extreme printed first
  orbH: number; orbL: number;  // 09:30–09:45
  orbDir: "H" | "L" | null;
  dayOpen: number; dayHigh: number; dayLow: number; dayClose: number;
  pdh: number | null; pdl: number | null; pdc: number | null;
  avgIB: number | null; atr: number | null;
  openType: "OAR-H" | "OAR-L" | "HIR" | "LIR" | null;
  touchedH: boolean; touchedL: boolean;
  singleBreak: boolean; bothBroke: boolean; neitherBroke: boolean;
  firstTouchSide: "H" | "L" | null;
  firstTouchBar: Bar | null;
  firstCloseBreak: Breakout | null;
  fvg: "bull" | "bear" | null;
  containedAt2: boolean;
  containedBrokeLate: boolean;
  closeLoc: number;
  closeZone: "top25" | "bot25" | "mid50";
  bias: "H" | "L" | null;
  widthBucket: "narrow" | "normal" | "wide" | null;
};

/* ── parsing ─────────────────────────────────────────────────────────────── */

export function parseCsv(text: string): Bar[] {
  const rows: Bar[] = [];
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

/* ── day construction ────────────────────────────────────────────────────── */

export function buildDays(rows: Bar[]): Day[] {
  const byDay = new Map<string, Bar[]>();
  for (const r of rows) {
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date)!.push(r);
  }

  const days: Day[] = [];
  for (const [date, bars] of [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    bars.sort((a, b) => a.min - b.min);
    const ibBars = bars.filter((b) => b.min >= 570 && b.min < 630);
    const post = bars.filter((b) => b.min >= 630);
    if (ibBars.length < 10 || post.length < 10) continue;

    const ibh = Math.max(...ibBars.map((b) => b.h));
    const ibl = Math.min(...ibBars.map((b) => b.l));
    const width = ibh - ibl;
    if (width <= 0) continue;

    const mid = (ibh + ibl) / 2;
    const ibClose = ibBars[ibBars.length - 1].c;
    const ibVol = ibBars.reduce((s, b) => s + b.v, 0) / ibBars.length;

    let hiIdx = Infinity, loIdx = Infinity;
    ibBars.forEach((b, i) => {
      if (b.h === ibh) hiIdx = Math.min(hiIdx, i);
      if (b.l === ibl) loIdx = Math.min(loIdx, i);
    });
    const first: "H" | "L" =
      hiIdx < loIdx ? "H" : loIdx < hiIdx ? "L" : ibBars[0].c >= ibBars[0].o ? "L" : "H";

    const orb = ibBars.slice(0, 3);
    const orbH = Math.max(...orb.map((b) => b.h));
    const orbL = Math.min(...orb.map((b) => b.l));

    const loc = (ibClose - ibl) / width;

    days.push({
      date, bars, ibBars, post, ibh, ibl, mid, width, ibClose, ibVol, first,
      orbH, orbL, orbDir: null,
      dayOpen: bars[0].o,
      dayHigh: Math.max(...bars.map((b) => b.h)),
      dayLow: Math.min(...bars.map((b) => b.l)),
      dayClose: bars[bars.length - 1].c,
      pdh: null, pdl: null, pdc: null, avgIB: null, atr: null, openType: null,
      touchedH: false, touchedL: false,
      singleBreak: false, bothBroke: false, neitherBroke: false,
      firstTouchSide: null, firstTouchBar: null, firstCloseBreak: null,
      fvg: null, containedAt2: false, containedBrokeLate: false,
      closeLoc: loc,
      closeZone: loc >= 0.75 ? "top25" : loc <= 0.25 ? "bot25" : "mid50",
      bias: ibClose > mid ? "H" : ibClose < mid ? "L" : null,
      widthBucket: null,
    });
  }

  /* prior-day context, rolling IB average, ATR14 of RTH range, open type */
  for (let i = 0; i < days.length; i++) {
    const d = days[i], p = days[i - 1];
    d.pdh = p ? p.dayHigh : null;
    d.pdl = p ? p.dayLow : null;
    d.pdc = p ? p.dayClose : null;

    const prev20 = days.slice(Math.max(0, i - 20), i);
    d.avgIB = prev20.length >= 5 ? prev20.reduce((s, x) => s + x.width, 0) / prev20.length : null;

    const prev14 = days.slice(Math.max(0, i - 14), i);
    d.atr = prev14.length >= 5 ? prev14.reduce((s, x) => s + (x.dayHigh - x.dayLow), 0) / prev14.length : null;

    if (d.pdh != null && d.pdl != null) {
      d.openType =
        d.dayOpen > d.pdh ? "OAR-H"
        : d.dayOpen < d.pdl ? "OAR-L"
        : d.dayOpen > (d.pdh + d.pdl) / 2 ? "HIR"
        : "LIR";
    }

    if (d.avgIB != null && d.atr != null) {
      d.widthBucket =
        d.width < 0.5 * d.atr || d.width < 0.75 * d.avgIB ? "narrow"
        : d.width > 1.5 * d.atr || d.width > 1.25 * d.avgIB ? "wide"
        : "normal";
    }
  }

  for (const d of days) enrich(d);
  return days;
}

/* ── per-day break analysis ──────────────────────────────────────────────── */

function enrich(d: Day) {
  let tH = false, tL = false;
  let fcb: Breakout | null = null;

  for (let i = 0; i < d.post.length; i++) {
    const b = d.post[i];
    if (b.h > d.ibh) {
      if (!d.firstTouchSide) { d.firstTouchSide = "H"; d.firstTouchBar = b; }
      tH = true;
      if (b.c > d.ibh && !fcb) fcb = baseBreak("H", i, b, d);
    }
    if (b.l < d.ibl) {
      if (!d.firstTouchSide) { d.firstTouchSide = "L"; d.firstTouchBar = b; }
      tL = true;
      if (b.c < d.ibl && !fcb) fcb = baseBreak("L", i, b, d);
    }
  }

  d.touchedH = tH; d.touchedL = tL;
  d.bothBroke = tH && tL;
  d.neitherBroke = !tH && !tL;
  d.singleBreak = tH !== tL;
  d.firstCloseBreak = fcb ? analyzeBreak(fcb, d) : null;

  /* 15m FVG inside the IB (3-bar imbalance on 15m candles built from the 5m IB bars) */
  const c15: { h: number; l: number }[] = [];
  for (let i = 0; i + 2 < d.ibBars.length; i += 3) {
    const s = d.ibBars.slice(i, i + 3);
    c15.push({ h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)) });
  }
  for (let i = 0; i + 2 < c15.length; i++) {
    const a = c15[i], c = c15[i + 2];
    if (c.l > a.h) d.fvg = "bull";
    else if (c.h < a.l) d.fvg = "bear";
  }

  /* contained day — still entirely inside the IB at 14:00 ET */
  const upTo2 = d.post.filter((b) => b.min < 840);
  d.containedAt2 =
    upTo2.length > 0 &&
    Math.max(...upTo2.map((b) => b.h)) <= d.ibh &&
    Math.min(...upTo2.map((b) => b.l)) >= d.ibl;
  if (d.containedAt2) {
    const after = d.post.filter((b) => b.min >= 840);
    d.containedBrokeLate = after.length
      ? Math.max(...after.map((b) => b.h)) > d.ibh || Math.min(...after.map((b) => b.l)) < d.ibl
      : false;
  }

  /* ORB — first close outside the 09:30–09:45 range, within the IB */
  for (const b of d.ibBars.slice(3)) {
    if (b.c > d.orbH) { d.orbDir = "H"; break; }
    if (b.c < d.orbL) { d.orbDir = "L"; break; }
  }
}

function baseBreak(side: "H" | "L", i: number, bar: Bar, d: Day): Breakout {
  return {
    side, i, bar, breakMin: bar.min,
    mfe: 0, mae: 0, rExt: 0, rAdv: 0,
    volSurge: bar.v > d.ibVol,
    failed: false, peakBeforeFail: 0, fadeMid: false, fadeOpp: false,
    retest: false, retestCont: null,
    hit: {},
    fibA: { hit: false, cont: false, fail: null, mfe: null, lvl: null, barsToTouch: null },
    fibB: { hit: false, cont: false, fail: null, mfe: null, lvl: null, barsToTouch: null },
  };
}

function analyzeBreak(fb: Breakout, d: Day): Breakout {
  const dir = fb.side === "H" ? 1 : -1;
  const lvl = fb.side === "H" ? d.ibh : d.ibl;
  const rest = d.post.slice(fb.i + 1);

  let mfe = 0, mae = 0;
  let failIdx: number | null = null;
  let retestIdx: number | null = null;

  for (let j = 0; j < rest.length; j++) {
    const b = rest[j];
    const fav = dir > 0 ? b.h - lvl : lvl - b.l;
    const adv = dir > 0 ? lvl - b.l : b.h - lvl;
    if (fav > mfe) mfe = fav;
    if (adv > mae) mae = adv;

    // failed breakout — closes back inside the IB within 6 bars
    if (failIdx == null && j < 6) {
      const inside = dir > 0 ? b.c < d.ibh : b.c > d.ibl;
      if (inside) { failIdx = j; fb.peakBeforeFail = mfe; }
    }
    // retest — back to within 2 ticks of the level but close holds outside
    if (retestIdx == null && failIdx == null && j > 0) {
      const near = dir > 0
        ? b.l <= lvl + 2 * ES_TICK && b.c > lvl
        : b.h >= lvl - 2 * ES_TICK && b.c < lvl;
      if (near) retestIdx = j;
    }
  }

  fb.mfe = mfe; fb.mae = mae;
  fb.rExt = mfe / d.width; fb.rAdv = mae / d.width;
  fb.failed = failIdx != null;
  fb.retest = retestIdx != null;
  for (const t of [0.5, 1, 1.5, 2]) fb.hit[String(t)] = mfe >= t * d.width;

  if (retestIdx != null) {
    const preExt = dir > 0
      ? Math.max(...rest.slice(0, retestIdx + 1).map((b) => b.h))
      : Math.min(...rest.slice(0, retestIdx + 1).map((b) => b.l));
    const after = rest.slice(retestIdx + 1);
    fb.retestCont = after.length
      ? dir > 0 ? Math.max(...after.map((b) => b.h)) > preExt
                : Math.min(...after.map((b) => b.l)) < preExt
      : false;
  }

  if (failIdx != null) {
    const after = rest.slice(failIdx + 1);
    fb.fadeMid = after.length
      ? dir > 0 ? Math.min(...after.map((b) => b.l)) <= d.mid
                : Math.max(...after.map((b) => b.h)) >= d.mid
      : false;
    fb.fadeOpp = after.length
      ? dir > 0 ? Math.min(...after.map((b) => b.l)) <= d.ibl
                : Math.max(...after.map((b) => b.h)) >= d.ibh
      : false;
  }

  /* ── Rule B — 0.25 fib pullback, two readings ─────────────────────────── */

  // Variant A — 0.25 of the IB RANGE, measured back into the IB from the broken level
  const fibALvl = dir > 0 ? d.ibh - 0.25 * d.width : d.ibl + 0.25 * d.width;
  let aIdx: number | null = null, aExt: number | null = null;
  // Variant B — 0.25 retrace of the post-break impulse (break level → running extreme)
  let bIdx: number | null = null, bExt: number | null = null;
  let running = lvl;

  for (let j = 0; j < rest.length; j++) {
    const b = rest[j];
    if (aIdx == null) {
      const touch = dir > 0 ? b.l <= fibALvl : b.h >= fibALvl;
      if (touch) {
        aIdx = j;
        aExt = dir > 0
          ? Math.max(...rest.slice(0, j + 1).map((x) => x.h))
          : Math.min(...rest.slice(0, j + 1).map((x) => x.l));
      }
    }
    if (bIdx == null) {
      const imp = Math.abs(running - lvl);
      if (imp > 0.25 * d.width) {
        const pb = dir > 0 ? running - 0.25 * imp : running + 0.25 * imp;
        const touch = dir > 0 ? b.l <= pb : b.h >= pb;
        if (touch) { bIdx = j; bExt = running; }
      }
      running = dir > 0 ? Math.max(running, b.h) : Math.min(running, b.l);
    }
  }

  if (aIdx != null && aExt != null) {
    const after = rest.slice(aIdx + 1);
    fb.fibA = {
      hit: true,
      cont: after.length
        ? dir > 0 ? Math.max(...after.map((b) => b.h)) > aExt
                  : Math.min(...after.map((b) => b.l)) < aExt
        : false,
      fail: after.length
        ? dir > 0 ? Math.min(...after.map((b) => b.l)) <= d.mid
                  : Math.max(...after.map((b) => b.h)) >= d.mid
        : false,
      mfe: after.length
        ? (dir > 0 ? Math.max(...after.map((b) => b.h)) - fibALvl
                   : fibALvl - Math.min(...after.map((b) => b.l))) / d.width
        : 0,
      lvl: fibALvl,
      barsToTouch: aIdx + 1,
    };
  }

  if (bIdx != null && bExt != null) {
    const after = rest.slice(bIdx + 1);
    fb.fibB = {
      hit: true,
      cont: after.length
        ? dir > 0 ? Math.max(...after.map((b) => b.h)) > bExt
                  : Math.min(...after.map((b) => b.l)) < bExt
        : false,
      fail: null, mfe: null, lvl: null,
      barsToTouch: bIdx + 1,
    };
  }

  return fb;
}

/* ── small stat helpers used by the UI ───────────────────────────────────── */

export const avg = (a: number[]): number | null => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export const med = (a: number[]): number | null => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
export const clock = (min: number | null): string => {
  if (min == null || !Number.isFinite(min)) return "—";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
export const rate = (n: number, d: number): number | null => (d ? (100 * n) / d : null);
