'use strict';
/**
 * server-v2/_lib-ibstats.cjs — GENERATED from lib/ibStats.ts. Do not hand-edit.
 *
 * The IB engine (buildDays / enrich / analyzeBreak) the Stat Prompter's
 * datasets are built with, in plain CommonJS so the Node server can run it —
 * server-v2 has no TypeScript step. Logic is lib/ibStats.ts verbatim, types
 * stripped by esbuild. Used by server-v2/ib-dataset-builder.cjs.
 *
 * If lib/ibStats.ts changes, regenerate (from the repo root):
 *   npx esbuild lib/ibStats.ts --format=cjs --target=es2020 --outfile=server-v2/_lib-ibstats.cjs
 * then put this header back.
 */
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
var ibStats_exports = {};
__export(ibStats_exports, {
  ES_TICK: () => ES_TICK,
  avg: () => avg,
  buildDays: () => buildDays,
  clock: () => clock,
  failOutcome: () => failOutcome,
  med: () => med,
  parseCsv: () => parseCsv,
  rate: () => rate
});
module.exports = __toCommonJS(ibStats_exports);
const ES_TICK = 0.25;
function parseCsv(text) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const p = line.split(",");
    if (p.length < 6) continue;
    const m = p[0].trim().match(/^(\d{4})(\d{2})(\d{2})[ T](\d{2}):?(\d{2})/);
    if (!m) continue;
    const [, Y, Mo, D, H, Mi] = m;
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
    if (![o, h, l, c].every(Number.isFinite)) continue;
    rows.push({
      date: `${Y}-${Mo}-${D}`,
      min: +H * 60 + +Mi,
      o,
      h,
      l,
      c,
      v: Number.isFinite(v) ? v : 0
    });
  }
  return rows;
}
function buildDays(rows) {
  const byDay = /* @__PURE__ */ new Map();
  for (const r of rows) {
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date).push(r);
  }
  const days = [];
  for (const [date, bars] of [...byDay.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
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
    const first = hiIdx < loIdx ? "H" : loIdx < hiIdx ? "L" : ibBars[0].c >= ibBars[0].o ? "L" : "H";
    const orb = ibBars.slice(0, 3);
    const orbH = Math.max(...orb.map((b) => b.h));
    const orbL = Math.min(...orb.map((b) => b.l));
    const loc = (ibClose - ibl) / width;
    days.push({
      date,
      bars,
      ibBars,
      post,
      ibh,
      ibl,
      mid,
      width,
      ibClose,
      ibVol,
      first,
      orbH,
      orbL,
      orbDir: null,
      dayOpen: bars[0].o,
      dayHigh: Math.max(...bars.map((b) => b.h)),
      dayLow: Math.min(...bars.map((b) => b.l)),
      dayClose: bars[bars.length - 1].c,
      pdh: null,
      pdl: null,
      pdc: null,
      avgIB: null,
      atr: null,
      openType: null,
      touchedH: false,
      touchedL: false,
      singleBreak: false,
      bothBroke: false,
      neitherBroke: false,
      firstTouchSide: null,
      firstTouchBar: null,
      firstCloseBreak: null,
      fvg: null,
      containedAt2: false,
      containedBrokeLate: false,
      closeLoc: loc,
      closeZone: loc >= 0.75 ? "top25" : loc <= 0.25 ? "bot25" : "mid50",
      bias: ibClose > mid ? "H" : ibClose < mid ? "L" : null,
      widthBucket: null
    });
  }
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
      d.openType = d.dayOpen > d.pdh ? "OAR-H" : d.dayOpen < d.pdl ? "OAR-L" : d.dayOpen > (d.pdh + d.pdl) / 2 ? "HIR" : "LIR";
    }
    if (d.avgIB != null && d.atr != null) {
      d.widthBucket = d.width < 0.5 * d.atr || d.width < 0.75 * d.avgIB ? "narrow" : d.width > 1.5 * d.atr || d.width > 1.25 * d.avgIB ? "wide" : "normal";
    }
  }
  for (const d of days) enrich(d);
  return days;
}
function enrich(d) {
  let tH = false, tL = false;
  let fcb = null;
  for (let i = 0; i < d.post.length; i++) {
    const b = d.post[i];
    if (b.h > d.ibh) {
      if (!d.firstTouchSide) {
        d.firstTouchSide = "H";
        d.firstTouchBar = b;
      }
      tH = true;
      if (b.c > d.ibh && !fcb) fcb = baseBreak("H", i, b, d);
    }
    if (b.l < d.ibl) {
      if (!d.firstTouchSide) {
        d.firstTouchSide = "L";
        d.firstTouchBar = b;
      }
      tL = true;
      if (b.c < d.ibl && !fcb) fcb = baseBreak("L", i, b, d);
    }
  }
  d.touchedH = tH;
  d.touchedL = tL;
  d.bothBroke = tH && tL;
  d.neitherBroke = !tH && !tL;
  d.singleBreak = tH !== tL;
  d.firstCloseBreak = fcb ? analyzeBreak(fcb, d) : null;
  const c15 = [];
  for (let i = 0; i + 2 < d.ibBars.length; i += 3) {
    const s = d.ibBars.slice(i, i + 3);
    c15.push({ h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)) });
  }
  for (let i = 0; i + 2 < c15.length; i++) {
    const a = c15[i], c = c15[i + 2];
    if (c.l > a.h) d.fvg = "bull";
    else if (c.h < a.l) d.fvg = "bear";
  }
  const upTo2 = d.post.filter((b) => b.min < 840);
  d.containedAt2 = upTo2.length > 0 && Math.max(...upTo2.map((b) => b.h)) <= d.ibh && Math.min(...upTo2.map((b) => b.l)) >= d.ibl;
  if (d.containedAt2) {
    const after = d.post.filter((b) => b.min >= 840);
    d.containedBrokeLate = after.length ? Math.max(...after.map((b) => b.h)) > d.ibh || Math.min(...after.map((b) => b.l)) < d.ibl : false;
  }
  for (const b of d.ibBars.slice(3)) {
    if (b.c > d.orbH) {
      d.orbDir = "H";
      break;
    }
    if (b.c < d.orbL) {
      d.orbDir = "L";
      break;
    }
  }
}
function baseBreak(side, i, bar, d) {
  return {
    side,
    i,
    bar,
    breakMin: bar.min,
    mfe: 0,
    mae: 0,
    rExt: 0,
    rAdv: 0,
    volSurge: bar.v > d.ibVol,
    failed: false,
    peakBeforeFail: 0,
    fadeMid: false,
    fadeOpp: false,
    retest: false,
    retestCont: null,
    hit: {},
    fibA: { hit: false, cont: false, fail: null, mfe: null, lvl: null, barsToTouch: null },
    fibB: { hit: false, cont: false, fail: null, mfe: null, lvl: null, barsToTouch: null }
  };
}
function analyzeBreak(fb, d) {
  const dir = fb.side === "H" ? 1 : -1;
  const lvl = fb.side === "H" ? d.ibh : d.ibl;
  const rest = d.post.slice(fb.i + 1);
  let mfe = 0, mae = 0;
  let failIdx = null;
  let retestIdx = null;
  for (let j = 0; j < rest.length; j++) {
    const b = rest[j];
    const fav = dir > 0 ? b.h - lvl : lvl - b.l;
    const adv = dir > 0 ? lvl - b.l : b.h - lvl;
    if (fav > mfe) mfe = fav;
    if (adv > mae) mae = adv;
    if (failIdx == null && j < 6) {
      const inside = dir > 0 ? b.c < d.ibh : b.c > d.ibl;
      if (inside) {
        failIdx = j;
        fb.peakBeforeFail = mfe;
      }
    }
    if (retestIdx == null && failIdx == null && j > 0) {
      const near = dir > 0 ? b.l <= lvl + 2 * ES_TICK && b.c > lvl : b.h >= lvl - 2 * ES_TICK && b.c < lvl;
      if (near) retestIdx = j;
    }
  }
  fb.mfe = mfe;
  fb.mae = mae;
  fb.rExt = mfe / d.width;
  fb.rAdv = mae / d.width;
  fb.failed = failIdx != null;
  fb.retest = retestIdx != null;
  for (const t of [0.5, 1, 1.5, 2]) fb.hit[String(t)] = mfe >= t * d.width;
  if (retestIdx != null) {
    const preExt = dir > 0 ? Math.max(...rest.slice(0, retestIdx + 1).map((b) => b.h)) : Math.min(...rest.slice(0, retestIdx + 1).map((b) => b.l));
    const after = rest.slice(retestIdx + 1);
    fb.retestCont = after.length ? dir > 0 ? Math.max(...after.map((b) => b.h)) > preExt : Math.min(...after.map((b) => b.l)) < preExt : false;
  }
  if (failIdx != null) {
    const after = rest.slice(failIdx + 1);
    fb.fadeMid = after.length ? dir > 0 ? Math.min(...after.map((b) => b.l)) <= d.mid : Math.max(...after.map((b) => b.h)) >= d.mid : false;
    fb.fadeOpp = after.length ? dir > 0 ? Math.min(...after.map((b) => b.l)) <= d.ibl : Math.max(...after.map((b) => b.h)) >= d.ibh : false;
  }
  const fibALvl = dir > 0 ? d.ibh - 0.25 * d.width : d.ibl + 0.25 * d.width;
  let aIdx = null, aExt = null;
  let bIdx = null, bExt = null;
  let running = lvl;
  for (let j = 0; j < rest.length; j++) {
    const b = rest[j];
    if (aIdx == null) {
      const touch = dir > 0 ? b.l <= fibALvl : b.h >= fibALvl;
      if (touch) {
        aIdx = j;
        aExt = dir > 0 ? Math.max(...rest.slice(0, j + 1).map((x) => x.h)) : Math.min(...rest.slice(0, j + 1).map((x) => x.l));
      }
    }
    if (bIdx == null) {
      const imp = Math.abs(running - lvl);
      if (imp > 0.25 * d.width) {
        const pb = dir > 0 ? running - 0.25 * imp : running + 0.25 * imp;
        const touch = dir > 0 ? b.l <= pb : b.h >= pb;
        if (touch) {
          bIdx = j;
          bExt = running;
        }
      }
      running = dir > 0 ? Math.max(running, b.h) : Math.min(running, b.l);
    }
  }
  if (aIdx != null && aExt != null) {
    const after = rest.slice(aIdx + 1);
    fb.fibA = {
      hit: true,
      cont: after.length ? dir > 0 ? Math.max(...after.map((b) => b.h)) > aExt : Math.min(...after.map((b) => b.l)) < aExt : false,
      fail: after.length ? dir > 0 ? Math.min(...after.map((b) => b.l)) <= d.mid : Math.max(...after.map((b) => b.h)) >= d.mid : false,
      mfe: after.length ? (dir > 0 ? Math.max(...after.map((b) => b.h)) - fibALvl : fibALvl - Math.min(...after.map((b) => b.l))) / d.width : 0,
      lvl: fibALvl,
      barsToTouch: aIdx + 1
    };
  }
  if (bIdx != null && bExt != null) {
    const after = rest.slice(bIdx + 1);
    fb.fibB = {
      hit: true,
      cont: after.length ? dir > 0 ? Math.max(...after.map((b) => b.h)) > bExt : Math.min(...after.map((b) => b.l)) < bExt : false,
      fail: null,
      mfe: null,
      lvl: null,
      barsToTouch: bIdx + 1
    };
  }
  return fb;
}
function failOutcome(fcb, width) {
  if (!fcb.failed) return null;
  const mfePts = fcb.rExt * width;
  if (mfePts > fcb.peakBeforeFail + 1e-9) return "recovered";
  if (fcb.fadeOpp) return "full_rotation";
  if (fcb.fadeMid) return "to_mid";
  return "chop";
}
const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const med = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const clock = (min) => {
  if (min == null || !Number.isFinite(min)) return "\u2014";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const rate = (n, d) => d ? 100 * n / d : null;
