// lib/ibDaily.ts — EOD Initial Balance results engine (server-side).
//
// Mirrors the LIVE computation in components/scanner/IbStatsTab.tsx (LiveToday /
// buildRules) but runs once at 16:30 ET over the finished session's 5m bars and
// grades every one of the 14 rules: was it IN PLAY today, which side did it
// point to, and did the prediction pay. Consumed by /api/ib-results, which the
// server-v2 ib-results-recorder pokes daily.
//
// IB = 09:30–10:30 ET (60m window only — the ORB variants are not recorded).
// A "break" is a bar CLOSE outside the IB; wick-only touches are tracked
// separately, exactly like the backtest dataset semantics.

export type IbBar = { min: number; o: number; h: number; l: number; c: number; v: number };

export type IbRuleResult = {
  id: string;
  name: string;
  state: "in" | "off";        // in-play vs not-in-play at EOD
  side: "H" | "L" | null;     // direction the rule pointed, if any
  hit: boolean | null;        // did the prediction pay (null = unscoreable)
  note: string;               // short human read of the trigger
};

export type IbDailyRecord = {
  ibHigh: number; ibLow: number; ibMid: number; ibWidth: number;
  widthBucket: "narrow" | "normal" | "wide" | null;
  bias: "H" | "L" | null;
  first: "H" | "L";
  closeZone: "top25" | "mid50" | "bot25";
  openType: "OAR-H" | "OAR-L" | "HIR" | "LIR" | null;
  orbDir: "H" | "L" | null;
  fvg: "bull" | "bear" | null;
  touchedH: boolean; touchedL: boolean;
  brokeH: boolean; brokeL: boolean;
  singleBreak: boolean; bothBroke: boolean; neitherBroke: boolean;
  breakSide: "H" | "L" | null; breakMin: number | null;
  failed: boolean | null; fadeMid: boolean | null; fadeOpp: boolean | null;
  retest: boolean | null; retestCont: boolean | null;
  volSurge: boolean | null;
  ext05: boolean; ext10: boolean; ext15: boolean; ext20: boolean;
  firstTouchSide: "H" | "L" | null; firstTouchMin: number | null;
  containedAt2: boolean; containedBrokeLate: boolean;
  dayHigh: number; dayLow: number; dayClose: number;
  rules: IbRuleResult[];
};

const IB_END = 630;   // 10:30 ET (minutes-of-day)
const RTH_OPEN = 570; // 09:30
const RTH_CLOSE = 960;// 16:00
const TICK = 0.25;    // ES + NQ

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

/** Trailing width bucket — same thresholds as the tab's deriveWidthBuckets. */
export function classifyWidth(
  width: number,
  trailing: { date: string; dayRange: number; ibWidth: number }[]
): "narrow" | "normal" | "wide" | null {
  if (trailing.length < 14) return null;
  const atr = mean(trailing.slice(-14).map((t) => t.dayRange));
  const avgIb = mean(trailing.slice(-20).map((t) => t.ibWidth));
  if (atr == null || avgIb == null) return null;
  if (width < 0.5 * atr || width < 0.75 * avgIb) return "narrow";
  if (width > 1.5 * atr || width > 1.25 * avgIb) return "wide";
  return "normal";
}

/**
 * Compute the finished session's IB record + 14-rule scoreboard.
 * @param bars      today's RTH bars (ET min 570–959), sorted ascending
 * @param priorRth  prior session's RTH high/low (for rule 11 open type), or null
 * @param bucket    trailing width bucket (classifyWidth), or null when history is thin
 */
export function computeIbDaily(
  bars: IbBar[],
  priorRth: { high: number; low: number } | null,
  bucket: "narrow" | "normal" | "wide" | null
): IbDailyRecord | null {
  const ibBars = bars.filter((b) => b.min >= RTH_OPEN && b.min < IB_END);
  const post = bars.filter((b) => b.min >= IB_END && b.min < RTH_CLOSE);
  if (ibBars.length < 3) return null; // no usable IB — skip the day

  const ibHigh = Math.max(...ibBars.map((b) => b.h));
  const ibLow = Math.min(...ibBars.map((b) => b.l));
  const ibWidth = ibHigh - ibLow;
  const ibMid = (ibHigh + ibLow) / 2;
  const ibClose = ibBars[ibBars.length - 1].c;

  // formation order — which extreme printed first
  let hiIdx = Infinity, loIdx = Infinity;
  ibBars.forEach((b, i) => {
    if (b.h === ibHigh) hiIdx = Math.min(hiIdx, i);
    if (b.l === ibLow) loIdx = Math.min(loIdx, i);
  });
  const first: "H" | "L" = hiIdx < loIdx ? "H" : "L";
  const bias: "H" | "L" | null = ibClose > ibMid ? "H" : ibClose < ibMid ? "L" : null;
  const loc = ibWidth > 0 ? (ibClose - ibLow) / ibWidth : 0.5;
  const closeZone: IbDailyRecord["closeZone"] = loc >= 0.75 ? "top25" : loc <= 0.25 ? "bot25" : "mid50";

  // touches + close-confirmed breaks
  const touchedH = post.some((b) => b.h > ibHigh);
  const touchedL = post.some((b) => b.l < ibLow);
  const brokeH = post.some((b) => b.c > ibHigh);
  const brokeL = post.some((b) => b.c < ibLow);
  const singleBreak = (touchedH && !touchedL) || (touchedL && !touchedH);
  const bothBroke = touchedH && touchedL;
  const neitherBroke = !touchedH && !touchedL;

  // first wick touch (side + minute)
  let firstTouchSide: "H" | "L" | null = null, firstTouchMin: number | null = null;
  for (const b of post) {
    const overH = b.h > ibHigh, underL = b.l < ibLow;
    if (!overH && !underL) continue;
    firstTouchSide = overH && underL ? (b.h - ibHigh >= ibLow - b.l ? "H" : "L") : overH ? "H" : "L";
    firstTouchMin = b.min;
    break;
  }

  // first close-confirmed break
  let breakSide: "H" | "L" | null = null, breakMin: number | null = null, bIdx = -1;
  for (let i = 0; i < post.length; i++) {
    if (post[i].c > ibHigh) { breakSide = "H"; breakMin = post[i].min; bIdx = i; break; }
    if (post[i].c < ibLow) { breakSide = "L"; breakMin = post[i].min; bIdx = i; break; }
  }
  const brk = bIdx >= 0 ? post[bIdx] : null;
  const after = bIdx >= 0 ? post.slice(bIdx + 1) : [];
  const lvl = breakSide === "H" ? ibHigh : breakSide === "L" ? ibLow : null;

  // rule 5 — break-bar volume vs avg IB bar volume
  const ibVol = mean(ibBars.map((b) => b.v)) ?? 0;
  const volSurge = brk && ibVol > 0 ? brk.v > ibVol : null;

  // rule 6 — closes back inside the IB within 30 min of the break
  const failed = brk
    ? after.filter((b) => b.min <= brk.min + 30)
        .some((b) => (breakSide === "H" ? b.c < ibHigh : b.c > ibLow))
    : null;
  let fadeMid: boolean | null = null, fadeOpp: boolean | null = null;
  if (failed) {
    const failIdx = after.findIndex((b) =>
      b.min <= (brk as IbBar).min + 30 && (breakSide === "H" ? b.c < ibHigh : b.c > ibLow));
    const rest = after.slice(failIdx);
    fadeMid = rest.some((b) => (breakSide === "H" ? b.l <= ibMid : b.h >= ibMid));
    fadeOpp = rest.some((b) => (breakSide === "H" ? b.l <= ibLow : b.h >= ibHigh));
  } else if (failed === false) { fadeMid = false; fadeOpp = false; }

  // rule 8 — retest of the broken level (within 2 ticks), then continuation
  let retest: boolean | null = null, retestCont: boolean | null = null;
  if (brk && lvl != null) {
    const rtIdx = after.findIndex((b) =>
      breakSide === "H" ? b.l <= lvl + 2 * TICK : b.h >= lvl - 2 * TICK);
    retest = rtIdx >= 0;
    retestCont = retest
      ? after.slice(rtIdx + 1).some((b) => (breakSide === "H" ? b.c > lvl : b.c < lvl))
      : null;
  }

  // rule 9 — extension targets, measured from the broken level, post-break extremes
  const postBrkBars = brk ? [brk, ...after] : [];
  const runHigh = postBrkBars.length ? Math.max(...postBrkBars.map((b) => b.h)) : null;
  const runLow = postBrkBars.length ? Math.min(...postBrkBars.map((b) => b.l)) : null;
  const extHit = (t: number) =>
    lvl != null && breakSide
      ? breakSide === "H" ? (runHigh as number) >= lvl + t * ibWidth : (runLow as number) <= lvl - t * ibWidth
      : false;
  const ext05 = extHit(0.5), ext10 = extHit(1), ext15 = extHit(1.5), ext20 = extHit(2);

  // rule 12 — inner 09:30–09:45 ORB break direction inside the IB
  const orb = ibBars.filter((b) => b.min < 585);
  let orbDir: "H" | "L" | null = null;
  if (orb.length) {
    const orbH = Math.max(...orb.map((b) => b.h));
    const orbL = Math.min(...orb.map((b) => b.l));
    for (const b of ibBars.filter((x) => x.min >= 585)) {
      if (b.c > orbH) { orbDir = "H"; break; }
      if (b.c < orbL) { orbDir = "L"; break; }
    }
  }

  // rule 11 — open type vs the prior RTH range
  const dayOpen = bars[0]?.o ?? 0;
  const openType: IbDailyRecord["openType"] =
    priorRth == null || !(dayOpen > 0) ? null
      : dayOpen > priorRth.high ? "OAR-H"
        : dayOpen < priorRth.low ? "OAR-L"
          : dayOpen > (priorRth.high + priorRth.low) / 2 ? "HIR"
            : "LIR";

  // rule 7 — 15m FVG inside the IB, rebuilt from the 5m bars
  const b15: { h: number; l: number }[] = [];
  for (let s = RTH_OPEN; s < IB_END; s += 15) {
    const g = ibBars.filter((b) => b.min >= s && b.min < s + 15);
    if (g.length) b15.push({ h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)) });
  }
  let fvg: "bull" | "bear" | null = null;
  for (let i = 2; i < b15.length; i++) {
    if (b15[i].l > b15[i - 2].h) fvg = "bull";
    else if (b15[i].h < b15[i - 2].l) fvg = "bear";
  }

  // rule 14 — fully inside the IB at 14:00 ET; broke late?
  const containedAt2 = !post.some((b) => b.min < 840 && (b.c > ibHigh || b.c < ibLow));
  const containedBrokeLate =
    containedAt2 && post.some((b) => b.min >= 840 && (b.c > ibHigh || b.c < ibLow));

  const dayHigh = Math.max(...bars.map((b) => b.h));
  const dayLow = Math.min(...bars.map((b) => b.l));
  const dayClose = bars[bars.length - 1].c;

  const rec: Omit<IbDailyRecord, "rules"> = {
    ibHigh, ibLow, ibMid, ibWidth, widthBucket: bucket, bias, first, closeZone, openType,
    orbDir, fvg, touchedH, touchedL, brokeH, brokeL, singleBreak, bothBroke, neitherBroke,
    breakSide, breakMin, failed, fadeMid, fadeOpp, retest, retestCont, volSurge,
    ext05, ext10, ext15, ext20, firstTouchSide, firstTouchMin,
    containedAt2, containedBrokeLate, dayHigh, dayLow, dayClose,
  };

  return { ...rec, rules: gradeRules(rec) };
}

/** Grade the 14 rules against the finished session — same triggers/questions as
 *  the live RuleBoard, answered with the day's actual outcome. */
function gradeRules(d: Omit<IbDailyRecord, "rules">): IbRuleResult[] {
  const W = (s: "H" | "L") => (s === "H" ? "HIGH" : "LOW");
  const confluent = !!d.bias && ((d.first === "L" && d.bias === "H") || (d.first === "H" && d.bias === "L"));
  const R: IbRuleResult[] = [];

  // 1 · Midpoint Close Bias → bias side breaks first
  R.push(d.bias
    ? { id: "1", name: "Midpoint Close Bias", state: "in", side: d.bias,
        hit: d.firstTouchSide === d.bias, note: `close ${d.bias === "H" ? ">" : "<"} mid → ${W(d.bias)} first` }
    : { id: "1", name: "Midpoint Close Bias", state: "off", side: null, hit: null, note: "closed on mid" });

  // 2 · Formation Order + Midpoint (confluent only)
  R.push(d.bias && confluent
    ? { id: "2", name: "Formation Order + Midpoint", state: "in", side: d.bias,
        hit: d.firstTouchSide === d.bias, note: `${W(d.first)} first + bias — confluent` }
    : { id: "2", name: "Formation Order + Midpoint", state: "off", side: null, hit: null,
        note: d.bias ? "discordant" : "no bias" });

  // 3 · Single Break Continuation → opposite side never touched
  R.push(d.breakSide
    ? { id: "3", name: "Single Break Continuation", state: "in", side: d.breakSide,
        hit: d.breakSide === "H" ? !d.touchedL : !d.touchedH, note: `broke ${W(d.breakSide)}` }
    : { id: "3", name: "Single Break Continuation", state: "off", side: null, hit: null, note: "no close break" });

  // 4 · Width → Day Type (wide → both sides; narrow/normal → single break)
  R.push(d.widthBucket
    ? { id: "4", name: "IB Width → Day Type", state: "in", side: null,
        hit: d.widthBucket === "wide" ? d.bothBroke : d.singleBreak, note: `${d.widthBucket.toUpperCase()} IB` }
    : { id: "4", name: "IB Width → Day Type", state: "off", side: null, hit: null, note: "bucket n/a" });

  // 5 · Breakout Entry + volume → runs ≥1× width
  R.push(d.breakSide
    ? { id: "5", name: "Breakout Entry + Volume", state: "in", side: d.breakSide, hit: d.ext10,
        note: d.volSurge == null ? "vol n/a" : d.volSurge ? "vol surge" : "no vol surge" }
    : { id: "5", name: "Breakout Entry + Volume", state: "off", side: null, hit: null, note: "no close break" });

  // 6 · Failed Breakout Fade — in-play only when the break failed; hit = fade reached opposite extreme
  R.push(d.breakSide && d.failed
    ? { id: "6", name: "Failed Breakout Fade", state: "in", side: d.breakSide === "H" ? "L" : "H",
        hit: !!d.fadeOpp, note: `${W(d.breakSide)} break failed ≤30m` }
    : { id: "6", name: "Failed Breakout Fade", state: "off", side: null, hit: null,
        note: d.breakSide ? "break held" : "no close break" });

  // 7 · 15m FVG inside IB → FVG side touched first
  R.push(d.fvg
    ? { id: "7", name: "15m FVG inside IB", state: "in", side: d.fvg === "bull" ? "H" : "L",
        hit: d.firstTouchSide === (d.fvg === "bull" ? "H" : "L"), note: `${d.fvg} FVG` }
    : { id: "7", name: "15m FVG inside IB", state: "off", side: null, hit: null, note: "no FVG" });

  // 8 · Retest Continuation
  R.push(d.breakSide && d.retest
    ? { id: "8", name: "Retest Continuation", state: "in", side: d.breakSide,
        hit: !!d.retestCont, note: "retested broken level" }
    : { id: "8", name: "Retest Continuation", state: "off", side: null, hit: null,
        note: d.breakSide ? "no retest" : "no close break" });

  // 9 · Extension Targets → ≥1× width
  R.push(d.breakSide
    ? { id: "9", name: "Extension ≥1× Width", state: "in", side: d.breakSide, hit: d.ext10,
        note: `0.5×:${d.ext05 ? "✓" : "✗"} 1×:${d.ext10 ? "✓" : "✗"} 1.5×:${d.ext15 ? "✓" : "✗"} 2×:${d.ext20 ? "✓" : "✗"}` }
    : { id: "9", name: "Extension ≥1× Width", state: "off", side: null, hit: null, note: "no close break" });

  // 10 · Close Location (strong zone only)
  const strongZone = (d.closeZone === "top25" && d.first === "L") || (d.closeZone === "bot25" && d.first === "H");
  R.push(strongZone
    ? { id: "10", name: "Close Location (strong)", state: "in", side: d.closeZone === "top25" ? "H" : "L",
        hit: d.firstTouchSide === (d.closeZone === "top25" ? "H" : "L"),
        note: `${d.closeZone} + ${W(d.first)} first` }
    : { id: "10", name: "Close Location (strong)", state: "off", side: null, hit: null,
        note: d.closeZone === "mid50" ? "mid close" : "zone vs order disagree" });

  // 11 · Open Type + Width → single break
  R.push(d.openType && d.widthBucket
    ? { id: "11", name: "Open Type + IB Width", state: "in", side: null,
        hit: d.singleBreak, note: `${d.openType} + ${d.widthBucket}` }
    : { id: "11", name: "Open Type + IB Width", state: "off", side: null, hit: null,
        note: d.openType ? "bucket n/a" : "prior RTH n/a" });

  // 12 · Inner ORB + IB alignment → bias side breaks first
  R.push(d.orbDir && d.bias
    ? { id: "12", name: "Inner ORB + Alignment", state: "in", side: d.bias,
        hit: d.firstTouchSide === d.bias,
        note: d.orbDir === d.bias ? "aligned" : "conflicted" }
    : { id: "12", name: "Inner ORB + Alignment", state: "off", side: null, hit: null,
        note: d.orbDir ? "no bias" : "ORB never broke" });

  // 13 · Time Filter — break timing → runs ≥1× width
  R.push(d.breakSide && d.breakMin != null
    ? { id: "13", name: "Time Filter", state: "in", side: d.breakSide, hit: d.ext10,
        note: d.breakMin <= 660 ? "early break" : d.breakMin <= 780 ? "midday break" : "late break" }
    : { id: "13", name: "Time Filter", state: "off", side: null, hit: null, note: "no close break" });

  // 14 · Contained Day → stays contained into the close
  R.push(d.containedAt2
    ? { id: "14", name: "Contained Day", state: "in", side: null,
        hit: !d.containedBrokeLate, note: "inside IB at 14:00" }
    : { id: "14", name: "Contained Day", state: "off", side: null, hit: null, note: "broke before 14:00" });

  return R;
}
