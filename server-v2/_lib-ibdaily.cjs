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

// ../mnt/user-data/uploads/spx-gex-dashboard-tt-fixed/lib/ibDaily.ts
var ibDaily_exports = {};
__export(ibDaily_exports, {
  classifyWidth: () => classifyWidth,
  computeIbDaily: () => computeIbDaily
});
module.exports = __toCommonJS(ibDaily_exports);
var IB_END = 630;
var RTH_OPEN = 570;
var RTH_CLOSE = 960;
var TICK = 0.25;
var mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
function classifyWidth(width, trailing) {
  if (trailing.length < 14) return null;
  const atr = mean(trailing.slice(-14).map((t) => t.dayRange));
  const avgIb = mean(trailing.slice(-20).map((t) => t.ibWidth));
  if (atr == null || avgIb == null) return null;
  if (width < 0.5 * atr || width < 0.75 * avgIb) return "narrow";
  if (width > 1.5 * atr || width > 1.25 * avgIb) return "wide";
  return "normal";
}
function computeIbDaily(bars, priorRth, bucket) {
  const ibBars = bars.filter((b) => b.min >= RTH_OPEN && b.min < IB_END);
  const post = bars.filter((b) => b.min >= IB_END && b.min < RTH_CLOSE);
  if (ibBars.length < 3) return null;
  const ibHigh = Math.max(...ibBars.map((b) => b.h));
  const ibLow = Math.min(...ibBars.map((b) => b.l));
  const ibWidth = ibHigh - ibLow;
  const ibMid = (ibHigh + ibLow) / 2;
  const ibClose = ibBars[ibBars.length - 1].c;
  let hiIdx = Infinity, loIdx = Infinity;
  ibBars.forEach((b, i) => {
    if (b.h === ibHigh) hiIdx = Math.min(hiIdx, i);
    if (b.l === ibLow) loIdx = Math.min(loIdx, i);
  });
  const first = hiIdx < loIdx ? "H" : "L";
  const bias = ibClose > ibMid ? "H" : ibClose < ibMid ? "L" : null;
  const loc = ibWidth > 0 ? (ibClose - ibLow) / ibWidth : 0.5;
  const closeZone = loc >= 0.75 ? "top25" : loc <= 0.25 ? "bot25" : "mid50";
  const touchedH = post.some((b) => b.h > ibHigh);
  const touchedL = post.some((b) => b.l < ibLow);
  const brokeH = post.some((b) => b.c > ibHigh);
  const brokeL = post.some((b) => b.c < ibLow);
  const singleBreak = touchedH && !touchedL || touchedL && !touchedH;
  const bothBroke = touchedH && touchedL;
  const neitherBroke = !touchedH && !touchedL;
  let firstTouchSide = null, firstTouchMin = null;
  for (const b of post) {
    const overH = b.h > ibHigh, underL = b.l < ibLow;
    if (!overH && !underL) continue;
    firstTouchSide = overH && underL ? b.h - ibHigh >= ibLow - b.l ? "H" : "L" : overH ? "H" : "L";
    firstTouchMin = b.min;
    break;
  }
  let breakSide = null, breakMin = null, bIdx = -1;
  for (let i = 0; i < post.length; i++) {
    if (post[i].c > ibHigh) {
      breakSide = "H";
      breakMin = post[i].min;
      bIdx = i;
      break;
    }
    if (post[i].c < ibLow) {
      breakSide = "L";
      breakMin = post[i].min;
      bIdx = i;
      break;
    }
  }
  const brk = bIdx >= 0 ? post[bIdx] : null;
  const after = bIdx >= 0 ? post.slice(bIdx + 1) : [];
  const lvl = breakSide === "H" ? ibHigh : breakSide === "L" ? ibLow : null;
  const ibVol = mean(ibBars.map((b) => b.v)) ?? 0;
  const volSurge = brk && ibVol > 0 ? brk.v > ibVol : null;
  const failed = brk ? after.filter((b) => b.min <= brk.min + 30).some((b) => breakSide === "H" ? b.c < ibHigh : b.c > ibLow) : null;
  let fadeMid = null, fadeOpp = null;
  if (failed) {
    const failIdx = after.findIndex((b) => b.min <= brk.min + 30 && (breakSide === "H" ? b.c < ibHigh : b.c > ibLow));
    const rest = after.slice(failIdx);
    fadeMid = rest.some((b) => breakSide === "H" ? b.l <= ibMid : b.h >= ibMid);
    fadeOpp = rest.some((b) => breakSide === "H" ? b.l <= ibLow : b.h >= ibHigh);
  } else if (failed === false) {
    fadeMid = false;
    fadeOpp = false;
  }
  let retest = null, retestCont = null;
  if (brk && lvl != null) {
    const rtIdx = after.findIndex((b) => breakSide === "H" ? b.l <= lvl + 2 * TICK : b.h >= lvl - 2 * TICK);
    retest = rtIdx >= 0;
    retestCont = retest ? after.slice(rtIdx + 1).some((b) => breakSide === "H" ? b.c > lvl : b.c < lvl) : null;
  }
  const postBrkBars = brk ? [brk, ...after] : [];
  const runHigh = postBrkBars.length ? Math.max(...postBrkBars.map((b) => b.h)) : null;
  const runLow = postBrkBars.length ? Math.min(...postBrkBars.map((b) => b.l)) : null;
  const extHit = (t) => lvl != null && breakSide ? breakSide === "H" ? runHigh >= lvl + t * ibWidth : runLow <= lvl - t * ibWidth : false;
  const ext05 = extHit(0.5), ext10 = extHit(1), ext15 = extHit(1.5), ext20 = extHit(2);
  const orb = ibBars.filter((b) => b.min < 585);
  let orbDir = null;
  if (orb.length) {
    const orbH = Math.max(...orb.map((b) => b.h));
    const orbL = Math.min(...orb.map((b) => b.l));
    for (const b of ibBars.filter((x) => x.min >= 585)) {
      if (b.c > orbH) {
        orbDir = "H";
        break;
      }
      if (b.c < orbL) {
        orbDir = "L";
        break;
      }
    }
  }
  const dayOpen = bars[0]?.o ?? 0;
  const openType = priorRth == null || !(dayOpen > 0) ? null : dayOpen > priorRth.high ? "OAR-H" : dayOpen < priorRth.low ? "OAR-L" : dayOpen > (priorRth.high + priorRth.low) / 2 ? "HIR" : "LIR";
  const b15 = [];
  for (let s = RTH_OPEN; s < IB_END; s += 15) {
    const g = ibBars.filter((b) => b.min >= s && b.min < s + 15);
    if (g.length) b15.push({ h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)) });
  }
  let fvg = null;
  for (let i = 2; i < b15.length; i++) {
    if (b15[i].l > b15[i - 2].h) fvg = "bull";
    else if (b15[i].h < b15[i - 2].l) fvg = "bear";
  }
  const containedAt2 = !post.some((b) => b.min < 840 && (b.c > ibHigh || b.c < ibLow));
  const containedBrokeLate = containedAt2 && post.some((b) => b.min >= 840 && (b.c > ibHigh || b.c < ibLow));
  const dayHigh = Math.max(...bars.map((b) => b.h));
  const dayLow = Math.min(...bars.map((b) => b.l));
  const dayClose = bars[bars.length - 1].c;
  const rec = {
    ibHigh,
    ibLow,
    ibMid,
    ibWidth,
    widthBucket: bucket,
    bias,
    first,
    closeZone,
    openType,
    orbDir,
    fvg,
    touchedH,
    touchedL,
    brokeH,
    brokeL,
    singleBreak,
    bothBroke,
    neitherBroke,
    breakSide,
    breakMin,
    failed,
    fadeMid,
    fadeOpp,
    retest,
    retestCont,
    volSurge,
    ext05,
    ext10,
    ext15,
    ext20,
    firstTouchSide,
    firstTouchMin,
    containedAt2,
    containedBrokeLate,
    dayHigh,
    dayLow,
    dayClose
  };
  return { ...rec, rules: gradeRules(rec) };
}
function gradeRules(d) {
  const W = (s) => s === "H" ? "HIGH" : "LOW";
  const confluent = !!d.bias && (d.first === "L" && d.bias === "H" || d.first === "H" && d.bias === "L");
  const R = [];
  R.push(d.bias ? {
    id: "1",
    name: "Midpoint Close Bias",
    state: "in",
    side: d.bias,
    hit: d.firstTouchSide === d.bias,
    note: `close ${d.bias === "H" ? ">" : "<"} mid \u2192 ${W(d.bias)} first`
  } : { id: "1", name: "Midpoint Close Bias", state: "off", side: null, hit: null, note: "closed on mid" });
  R.push(d.bias && confluent ? {
    id: "2",
    name: "Formation Order + Midpoint",
    state: "in",
    side: d.bias,
    hit: d.firstTouchSide === d.bias,
    note: `${W(d.first)} first + bias \u2014 confluent`
  } : {
    id: "2",
    name: "Formation Order + Midpoint",
    state: "off",
    side: null,
    hit: null,
    note: d.bias ? "discordant" : "no bias"
  });
  R.push(d.breakSide ? {
    id: "3",
    name: "Single Break Continuation",
    state: "in",
    side: d.breakSide,
    hit: d.breakSide === "H" ? !d.touchedL : !d.touchedH,
    note: `broke ${W(d.breakSide)}`
  } : { id: "3", name: "Single Break Continuation", state: "off", side: null, hit: null, note: "no close break" });
  R.push(d.widthBucket ? {
    id: "4",
    name: "IB Width \u2192 Day Type",
    state: "in",
    side: null,
    hit: d.widthBucket === "wide" ? d.bothBroke : d.singleBreak,
    note: `${d.widthBucket.toUpperCase()} IB`
  } : { id: "4", name: "IB Width \u2192 Day Type", state: "off", side: null, hit: null, note: "bucket n/a" });
  R.push(d.breakSide ? {
    id: "5",
    name: "Breakout Entry + Volume",
    state: "in",
    side: d.breakSide,
    hit: d.ext10,
    note: d.volSurge == null ? "vol n/a" : d.volSurge ? "vol surge" : "no vol surge"
  } : { id: "5", name: "Breakout Entry + Volume", state: "off", side: null, hit: null, note: "no close break" });
  R.push(d.breakSide && d.failed ? {
    id: "6",
    name: "Failed Breakout Fade",
    state: "in",
    side: d.breakSide === "H" ? "L" : "H",
    hit: !!d.fadeOpp,
    note: `${W(d.breakSide)} break failed \u226430m`
  } : {
    id: "6",
    name: "Failed Breakout Fade",
    state: "off",
    side: null,
    hit: null,
    note: d.breakSide ? "break held" : "no close break"
  });
  R.push(d.fvg ? {
    id: "7",
    name: "15m FVG inside IB",
    state: "in",
    side: d.fvg === "bull" ? "H" : "L",
    hit: d.firstTouchSide === (d.fvg === "bull" ? "H" : "L"),
    note: `${d.fvg} FVG`
  } : { id: "7", name: "15m FVG inside IB", state: "off", side: null, hit: null, note: "no FVG" });
  R.push(d.breakSide && d.retest ? {
    id: "8",
    name: "Retest Continuation",
    state: "in",
    side: d.breakSide,
    hit: !!d.retestCont,
    note: "retested broken level"
  } : {
    id: "8",
    name: "Retest Continuation",
    state: "off",
    side: null,
    hit: null,
    note: d.breakSide ? "no retest" : "no close break"
  });
  R.push(d.breakSide ? {
    id: "9",
    name: "Extension \u22651\xD7 Width",
    state: "in",
    side: d.breakSide,
    hit: d.ext10,
    note: `0.5\xD7:${d.ext05 ? "\u2713" : "\u2717"} 1\xD7:${d.ext10 ? "\u2713" : "\u2717"} 1.5\xD7:${d.ext15 ? "\u2713" : "\u2717"} 2\xD7:${d.ext20 ? "\u2713" : "\u2717"}`
  } : { id: "9", name: "Extension \u22651\xD7 Width", state: "off", side: null, hit: null, note: "no close break" });
  const strongZone = d.closeZone === "top25" && d.first === "L" || d.closeZone === "bot25" && d.first === "H";
  R.push(strongZone ? {
    id: "10",
    name: "Close Location (strong)",
    state: "in",
    side: d.closeZone === "top25" ? "H" : "L",
    hit: d.firstTouchSide === (d.closeZone === "top25" ? "H" : "L"),
    note: `${d.closeZone} + ${W(d.first)} first`
  } : {
    id: "10",
    name: "Close Location (strong)",
    state: "off",
    side: null,
    hit: null,
    note: d.closeZone === "mid50" ? "mid close" : "zone vs order disagree"
  });
  R.push(d.openType && d.widthBucket ? {
    id: "11",
    name: "Open Type + IB Width",
    state: "in",
    side: null,
    hit: d.singleBreak,
    note: `${d.openType} + ${d.widthBucket}`
  } : {
    id: "11",
    name: "Open Type + IB Width",
    state: "off",
    side: null,
    hit: null,
    note: d.openType ? "bucket n/a" : "prior RTH n/a"
  });
  R.push(d.orbDir && d.bias ? {
    id: "12",
    name: "Inner ORB + Alignment",
    state: "in",
    side: d.bias,
    hit: d.firstTouchSide === d.bias,
    note: d.orbDir === d.bias ? "aligned" : "conflicted"
  } : {
    id: "12",
    name: "Inner ORB + Alignment",
    state: "off",
    side: null,
    hit: null,
    note: d.orbDir ? "no bias" : "ORB never broke"
  });
  R.push(d.breakSide && d.breakMin != null ? {
    id: "13",
    name: "Time Filter",
    state: "in",
    side: d.breakSide,
    hit: d.ext10,
    note: d.breakMin <= 660 ? "early break" : d.breakMin <= 780 ? "midday break" : "late break"
  } : { id: "13", name: "Time Filter", state: "off", side: null, hit: null, note: "no close break" });
  R.push(d.containedAt2 ? {
    id: "14",
    name: "Contained Day",
    state: "in",
    side: null,
    hit: !d.containedBrokeLate,
    note: "inside IB at 14:00"
  } : { id: "14", name: "Contained Day", state: "off", side: null, hit: null, note: "broke before 14:00" });
  return R;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  classifyWidth,
  computeIbDaily
});
