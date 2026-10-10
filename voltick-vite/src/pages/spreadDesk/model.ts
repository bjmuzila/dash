/**
 * Spread Desk · the model. Example data, Black-Scholes estimates and the rules
 * engine behind every tab. No network: every number here is synthetic and the
 * page says so.
 *
 * Copy rules hold for every string in this file: no em-dashes, and never buy,
 * sell, signal, entry, target, stop or prediction. Mechanics and locations only.
 */

export type Side = "put" | "call";
export type Lean = "bear" | "neutral" | "bull";
export type Lvl = "ok" | "good" | "watch" | "alert";

export const TICKERS = ["SPY", "QQQ", "IWM", "AAPL"] as const;
export type Ticker = (typeof TICKERS)[number];

export type Board = {
  step: number;
  iv: number;
  rv: number;
  ivr: number;
  lo: number;
  hi: number;
  /** $B of dealer gamma per unit of the bump curve, for the hover readout. */
  scale: number;
  /** True when the ticker lists same-day expirations. */
  daily: boolean;
  spot: number[];
  putWall: number[];
  callWall: number[];
  flip: number[];
  bumps: [number, number, number][];
};
type SeriesKey = "spot" | "putWall" | "callWall" | "flip";

/* Index 0 is today. 1..5 are example sessions for the monitor playback. */
export const BOARDS: Record<Ticker, Board> = {
  SPY: {
    step: 5, iv: 0.142, rv: 0.118, ivr: 42, lo: 625, hi: 710, scale: 2.4, daily: true,
    spot: [668.4, 670.1, 666.2, 664.0, 667.5, 671.3],
    putWall: [650, 650, 650, 650, 655, 655],
    callWall: [685, 685, 690, 690, 690, 695],
    flip: [661.5, 662, 662.5, 663, 663, 664],
    bumps: [[650, -1.9, 6], [640, -1.0, 6], [660, -0.7, 4], [685, 2.1, 6], [695, 1.1, 6], [670, 1.2, 4], [675, 0.6, 4]],
  },
  QQQ: {
    step: 5, iv: 0.185, rv: 0.162, ivr: 51, lo: 560, hi: 645, scale: 1.3, daily: true,
    spot: [602.1, 604.5, 607.0, 608.9, 611.2, 609.0],
    putWall: [585, 585, 590, 590, 595, 595],
    callWall: [615, 615, 621, 625, 628, 628],
    flip: [596, 596, 597, 598, 600, 600],
    bumps: [[585, -1.7, 7], [570, -0.9, 7], [615, 1.9, 6], [625, 1.0, 6], [605, 1.1, 4], [595, -0.5, 4]],
  },
  IWM: {
    step: 1, iv: 0.22, rv: 0.19, ivr: 63, lo: 222, hi: 258, scale: 0.35, daily: false,
    spot: [244.3, 243.6, 242.1, 241.0, 239.8, 237.5],
    putWall: [236, 236, 236, 236, 236, 234],
    callWall: [248, 248, 248, 248, 248, 248],
    flip: [243.2, 243.2, 243.0, 243.2, 243.2, 243.5],
    bumps: [[236, -1.8, 2], [232, -0.9, 2], [248, 1.5, 2], [252, 0.9, 2], [245, 0.7, 1.5], [240, -0.6, 1.5]],
  },
  AAPL: {
    step: 2.5, iv: 0.26, rv: 0.29, ivr: 24, lo: 212.5, hi: 290, scale: 0.42, daily: false,
    spot: [251.6, 253.0, 255.0, 254.0, 252.0, 250.0],
    putWall: [240, 240, 240, 242.5, 242.5, 242.5],
    callWall: [262.5, 262.5, 265, 265, 262.5, 260],
    flip: [247.5, 247.5, 248, 248, 249, 249],
    bumps: [[240, -1.8, 4], [230, -1.0, 4], [262.5, 1.9, 4], [270, 1.0, 4], [255, 0.9, 3], [247.5, -0.5, 3]],
  },
};
export const at = (b: Board, key: SeriesKey, i = 0) => b[key][Math.min(i, b[key].length - 1)];

/* ── rules ──────────────────────────────────────────────────────────────── */
export type Rules = {
  acct: number;
  riskPct: number;
  width: number;
  deltaLo: number;
  deltaHi: number;
  dte: number;
  minCredit: number;
  minIVR: number;
  outsideEM: boolean;
  needWall: boolean;
  needPos: boolean;
  profitPct: number;
  timeRule: number;
  lossX: number;
  maxUnd: number;
  maxWeek: number;
  maxTotal: number;
  zProfit: number;
  zLoss: number;
  zRisk: number;
};
export const RULE_DEFAULTS: Rules = {
  acct: 50000, riskPct: 2, width: 5, deltaLo: 16, deltaHi: 20, dte: 45, minCredit: 33, minIVR: 30,
  outsideEM: true, needWall: true, needPos: true, profitPct: 50, timeRule: 21, lossX: 2,
  maxUnd: 5, maxWeek: 15, maxTotal: 25, zProfit: 40, zLoss: 1.75, zRisk: 0.5,
};

/* ── dates (the mock's today is Fri Oct 9 2026) ─────────────────────────── */
const TODAY = new Date(2026, 9, 9);
export const SESSIONS = ["Today · Fri Oct 9", "Mon Oct 12", "Tue Oct 13", "Wed Oct 14", "Thu Oct 15", "Fri Oct 16"];
export const SESSIONS_SHORT = ["Fri 9", "Mon 12", "Tue 13", "Wed 14", "Thu 15", "Fri 16"];
const CAL = [0, 3, 4, 5, 6, 7];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function expDate(dte: number) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + dte);
  while (d.getDay() !== 5 && dte > 0) d.setDate(d.getDate() - 1);
  return d;
}
export const expLabel = (dte: number) => {
  const d = expDate(dte);
  return `${MON[d.getMonth()]} ${d.getDate()}`;
};
const weekKey = (dte: number) => {
  const d = expDate(dte);
  const m = new Date(d);
  m.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `wk ${MON[m.getMonth()]} ${m.getDate()}`;
};
export const dteAt = (dte: number, i: number) => Math.max(0, dte - CAL[i]);

/* ── formatting ─────────────────────────────────────────────────────────── */
export const f2 = (n: number, d = 2) => Number(n).toFixed(d);
export const fk = (k: number) => (Number.isInteger(+k) ? String(+k) : f2(k, 1));
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

/* ── model ──────────────────────────────────────────────────────────────── */
export function Phi(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
export const gexAt = (b: Board, k: number) => b.bumps.reduce((g, [c, a, w]) => g + a * Math.exp(-((k - c) * (k - c)) / (2 * w * w)), 0);
export function strikes(b: Board) {
  const out: number[] = [];
  for (let k = b.lo; k <= b.hi + 1e-9; k += b.step) out.push(+k.toFixed(2));
  return out;
}
const yrs = (dte: number) => Math.max(dte, 0.25) / 365;
export const emOf = (spot: number, iv: number, dte: number) => spot * iv * Math.sqrt(yrs(dte));
export const touchP = (spot: number, k: number, s: number) => Math.min(1, 2 * (1 - Phi(Math.abs(k - spot) / s)));
const d1Of = (S: number, K: number, T: number, sig: number) => (Math.log(S / K) + (0.045 + (sig * sig) / 2) * T) / (sig * Math.sqrt(T));
function bs(S: number, K: number, T: number, sig: number, call: boolean) {
  const sq = sig * Math.sqrt(T), d1 = d1Of(S, K, T, sig), d2 = d1 - sq, disc = Math.exp(-0.045 * T);
  return call ? S * Phi(d1) - K * disc * Phi(d2) : K * disc * Phi(-d2) - S * Phi(-d1);
}
export function deltaOf(S: number, K: number, T: number, sig: number, call: boolean) {
  const d = Phi(d1Of(S, K, T, sig));
  return call ? d : d - 1;
}
const vert = (b: Board, spot: number, s: number, l: number, call: boolean, dte: number) => {
  const T = yrs(dte);
  return Math.max(0, bs(spot, s, T, b.iv, call) - bs(spot, l, T, b.iv, call));
};
export const snap = (b: Board, k: number) => +(Math.round(k / b.step) * b.step).toFixed(2);
export const widthFor = (b: Board, w: number) => Math.max(b.step, Math.round(w / b.step) * b.step);

function strikeForDelta(b: Board, target: number, call: boolean, dte: number) {
  const S = at(b, "spot"), T = yrs(dte);
  let best: number | null = null, bd = 9;
  for (const k of strikes(b)) {
    if (call ? k <= S : k >= S) continue;
    const d = Math.abs(deltaOf(S, k, T, b.iv, call));
    if (Math.abs(d - target / 100) < bd) {
      bd = Math.abs(d - target / 100);
      best = k;
    }
  }
  return best;
}

export function conditions(R: Rules, b: Board) {
  const sticky = at(b, "spot") > at(b, "flip"), vrp = b.iv - b.rv, ivrOk = b.ivr >= R.minIVR;
  return { sticky, vrp, ivrOk, score: (sticky ? 1 : 0) + (ivrOk ? 1 : 0) + (vrp > 0 ? 1 : 0) };
}

export type Check = { ok: boolean; t: string };
export type Eval = {
  shortK: number; longK: number; call: boolean; w: number; wall: number;
  behind: boolean; onWall: boolean; itm: boolean; gap: number; sd: number;
  touch: number; pop: number; cr: number; risk: number; be: number; delta: number;
  ratio: number; qty: number; checks: Check[]; passN: number;
};
export type Cand = Eval & { tags: string[] };

export function evalStrike(R: Rules, b: Board, shortK: number, call: boolean, dte: number, w: number): Eval {
  const spot = at(b, "spot"), s = emOf(spot, b.iv, dte), T = yrs(dte);
  const wall = call ? at(b, "callWall") : at(b, "putWall");
  const longK = call ? shortK + w : shortK - w;
  const cr = Math.max(0.01, vert(b, spot, shortK, longK, call, dte));
  const be = call ? shortK + cr : shortK - cr;
  const risk = Math.max(0.01, w - cr);
  const riskPct = dte === 0 ? R.zRisk : R.riskPct;
  const e: Eval = {
    shortK, longK, call, w, wall,
    behind: call ? shortK > wall : shortK < wall,
    onWall: shortK === wall,
    itm: call ? shortK <= spot : shortK >= spot,
    gap: Math.abs(shortK - wall),
    sd: Math.abs(shortK - spot) / s,
    touch: touchP(spot, shortK, s),
    pop: call ? Phi((be - spot) / s) : Phi((spot - be) / s),
    cr, risk, be,
    delta: Math.abs(deltaOf(spot, shortK, T, b.iv, call)) * 100,
    ratio: cr / w,
    qty: Math.max(0, Math.floor((R.acct * riskPct) / 100 / (risk * 100))),
    checks: [],
    passN: 0,
  };
  const c = conditions(R, b);
  e.checks.push({ ok: e.delta >= R.deltaLo - 0.5 && e.delta <= R.deltaHi + 0.5, t: `${R.deltaLo}-${R.deltaHi}Δ` });
  e.checks.push({ ok: e.ratio * 100 >= R.minCredit, t: `credit ≥ ${R.minCredit}% of width` });
  if (R.outsideEM) e.checks.push({ ok: e.sd >= 1, t: "outside 1σ" });
  if (R.needWall) e.checks.push({ ok: e.behind, t: "behind a wall" });
  e.checks.push({ ok: c.ivrOk, t: `IV rank ≥ ${R.minIVR}` });
  if (R.needPos) e.checks.push({ ok: c.sticky, t: "positive gamma" });
  e.passN = e.checks.filter((x) => x.ok).length;
  return e;
}

export type SideGroup = { side: Side; rows: Cand[]; wallRow?: Cand };
export function buildCands(R: Rules, b: Board, lean: Lean, dte: number, width: number, cushion: number): SideGroup[] {
  const w = widthFor(b, width), c = cushion * b.step;
  const sides: Side[] = lean === "neutral" ? ["put", "call"] : lean === "bull" ? ["put"] : ["call"];
  return sides.map((side) => {
    const call = side === "call", wall = call ? at(b, "callWall") : at(b, "putWall");
    const map = new Map<number, Cand>();
    const add = (k: number | null, tag: string) => {
      if (k == null) return;
      const have = map.get(k);
      if (have) have.tags.push(tag);
      else map.set(k, { ...evalStrike(R, b, k, call, dte, w), tags: [tag] });
    };
    add(call ? wall + c : wall - c, "wall");
    [15, 20, 25].forEach((t) => add(strikeForDelta(b, t, call, dte), `${t}Δ`));
    const rows = [...map.values()].filter((r) => !r.itm).sort((a, z) => z.sd - a.sd);
    return { side, rows, wallRow: rows.find((r) => r.tags.includes("wall")) };
  });
}

/* ── positions ──────────────────────────────────────────────────────────── */
export type PosType = Side | "condor";
export type PositionInput = {
  tk: Ticker; type: PosType; short: number; long: number; short2?: number; long2?: number;
  dte: number; qty?: number; cr?: number | null;
};
export type Position = PositionInput & { id: number; qty: number; cr: number; m0: number; width: number };

export const DEFAULT_POSITIONS: PositionInput[] = [
  { tk: "SPY", type: "put", short: 645, long: 640, dte: 27 },
  { tk: "QQQ", type: "call", short: 630, long: 635, dte: 14 },
  { tk: "IWM", type: "condor", short: 235, long: 231, short2: 250, long2: 254, dte: 30 },
];

function legsOf(p: PositionInput): [number, number, boolean][] {
  return p.type === "condor"
    ? [[p.short, p.long, false], [p.short2 ?? 0, p.long2 ?? 0, true]]
    : [[p.short, p.long, p.type === "call"]];
}
export const shortsOf = (p: PositionInput) => legsOf(p).map(([s]) => s);

function markOf(p: PositionInput, i: number, dteOverride?: number) {
  const b = BOARDS[p.tk], spot = at(b, "spot", i), dte = dteOverride ?? dteAt(p.dte, i);
  return legsOf(p).reduce((m, [s, l, c]) => m + vert(b, spot, s, l, c, dte), 0);
}

let seq = 0;
export function prep(R: Rules, p: PositionInput): Position {
  const m0 = Math.max(0.01, markOf(p, 0));
  const cr = p.cr != null && isFinite(p.cr) && p.cr > 0 ? +p.cr : +f2(m0);
  const width = p.type === "condor"
    ? Math.max(p.short - p.long, (p.long2 ?? 0) - (p.short2 ?? 0))
    : Math.abs(p.short - p.long);
  const sized = Math.max(1, Math.floor((R.acct * (p.dte === 0 ? R.zRisk : R.riskPct)) / 100 / ((width - cr) * 100)));
  return { ...p, id: ++seq, m0, cr, qty: p.qty || sized, width };
}

export function pnlOf(p: Position, i: number) {
  const mark = markOf(p, i), share = (p.m0 - mark) / p.m0, perShare = p.cr * share;
  return { pctMax: share, dollars: perShare * 100 * p.qty, lossX: -perShare / p.cr, mark };
}

export type Item = { lvl: Lvl; t: string; ev?: boolean; key?: string; label?: string; note?: string };
const RANK: Record<Lvl, number> = { alert: 3, watch: 2, good: 1, ok: 0 };

export function readPos(R: Rules, p: Position, i: number) {
  const b = BOARDS[p.tk], spot = at(b, "spot", i), flip = at(b, "flip", i), dteNow = dteAt(p.dte, i);
  const s = emOf(spot, b.iv, dteNow);
  const zero = p.dte === 0, profitPct = zero ? R.zProfit : R.profitPct, lossX = zero ? R.zLoss : R.lossX;
  const items: Item[] = [];
  legsOf(p).forEach(([k, , call]) => {
    const key: SeriesKey = call ? "callWall" : "putWall";
    const w = at(b, key, i), w0 = at(b, key, 0), side = call ? "Call" : "Put";
    const gap = call ? k - w : w - k, gap0 = call ? k - w0 : w0 - k;
    const through = call ? spot >= k : spot <= k;
    if (through)
      items.push({ lvl: "alert", ev: true, key: `thr${k}`, label: "Price through your short", t: `Price ${f2(spot)} is through your ${fk(k)} short`, note: "Price has crossed your short strike." });
    else if (Math.abs(spot - k) / s < 0.25)
      items.push({ lvl: "watch", ev: true, key: `test${k}`, label: "Short strike tested", t: `Price within 0.25σ of your ${fk(k)} short`, note: "Price is close to your short strike." });
    if (gap <= 0)
      items.push({ lvl: "alert", ev: true, key: `air${k}|${w}`, label: "Short now in open air", t: `${side} wall now ${fk(w)}, ${gap === 0 ? "on" : "past"} your ${fk(k)} short`, note: "Nothing structural now stands between price and your short." });
    else if (w !== w0 && gap < gap0)
      items.push({ lvl: "watch", ev: true, key: `wt${k}|${w}`, label: "Wall moving toward your short", t: `${side} wall moved ${fk(w0)} → ${fk(w)}, ${fk(gap)} pts in front of your ${fk(k)} (was ${fk(gap0)})`, note: "The wall standing between price and your short has moved closer. If it keeps moving it would sit on or past your short." });
    else if (w !== w0)
      items.push({ lvl: "ok", ev: true, key: `wa${k}|${w}`, t: `${side} wall moved ${fk(w0)} → ${fk(w)}, away from your ${fk(k)}`, note: "Moved away from your short. More room between price and the wall." });
    else items.push({ lvl: "ok", t: `${side} wall ${fk(w)} in front of your ${fk(k)} short (${fk(gap)} pts)` });
  });
  const sticky = spot > flip, sticky0 = at(b, "spot", 0) > at(b, "flip", 0);
  if (sticky0 && !sticky)
    items.push({ lvl: "alert", ev: true, key: "flipdn", label: "Price crossed below the flip", t: `Price below the flip ${fk(flip)} · slippery tape`, note: "Dealers flipped to short gamma. In this regime moves tend to extend rather than stall, so your short has less structure behind it than when you opened." });
  else if (!sticky0 && sticky)
    items.push({ lvl: "ok", ev: true, key: "flipup", t: `Price back above the flip ${fk(flip)} · sticky tape`, note: "Dealers are long gamma again." });
  else items.push({ lvl: sticky ? "ok" : "watch", t: `Price ${sticky ? "above" : "below"} the flip ${fk(flip)} · ${sticky ? "sticky" : "slippery"} tape` });
  const pn = pnlOf(p, i);
  if (pn.pctMax * 100 >= profitPct)
    items.push({ lvl: "good", ev: true, key: "pl", label: "Your profit level reached", t: `${Math.round(pn.pctMax * 100)}% of max profit · your ${profitPct}% level`, note: `This position reached the ${profitPct}% profit level set in My rules. What you do with that is your call.` });
  if (pn.lossX >= lossX)
    items.push({ lvl: "alert", ev: true, key: "ll", label: "Your loss level reached", t: `Loss is ${f2(pn.lossX, 1)}× credit · your ${lossX}× level`, note: `The loss reached the ${lossX}× credit level set in My rules.` });
  if (!zero && p.dte > R.timeRule && dteNow <= R.timeRule)
    items.push({ lvl: "watch", ev: true, key: "tr", label: "Your time rule reached", t: `${dteNow} DTE · your ${R.timeRule}-DTE time rule`, note: `Under ${R.timeRule} DTE, gamma grows faster than theta. This is the time rule set in My rules.` });
  let top: Item | null = null;
  items.forEach((it) => {
    if (it.label && (!top || RANK[it.lvl] > RANK[top.lvl])) top = it;
  });
  const t = top as Item | null;
  return {
    items, spot, dteNow, pn, s,
    lvl: (t?.lvl ?? "ok") as Lvl,
    label: t?.label ?? "Structure intact",
    note: t ? `${t.label}. ${t.note}` : "No structure change at your strikes and none of your rules reached since you opened.",
  };
}

export type LogRow = { d: number; lvl: Lvl; t: string; det: string };
export function buildLog(R: Rules, positions: Position[], i: number): LogRow[] {
  const out: LogRow[] = [{ d: 0, lvl: "ok", t: `Tracking ${positions.length} position${positions.length === 1 ? "" : "s"}`, det: "Voltick checks walls, flip, regime and your rules around each short strike on every board recompute." }];
  positions.forEach((p) => {
    let prev = new Set(readPos(R, p, 0).items.filter((x) => x.ev).map((x) => x.key));
    for (let d = 1; d <= i; d++) {
      const cur = readPos(R, p, d).items.filter((x) => x.ev);
      cur.forEach((it) => {
        if (!prev.has(it.key)) out.push({ d, lvl: it.lvl, t: `${p.tk} · ${it.t}`, det: it.note ?? "" });
      });
      prev = new Set(cur.map((x) => x.key));
    }
  });
  return out.sort((a, z) => z.d - a.d || RANK[z.lvl] - RANK[a.lvl]);
}

export function portfolio(R: Rules, positions: Position[], i: number) {
  const rows = positions.map((p) => {
    const b = BOARDS[p.tk], spot = at(b, "spot", i), dte = dteAt(p.dte, i), T = yrs(dte);
    const pn = pnlOf(p, i), risk = (p.width - p.cr) * 100 * p.qty;
    const delta = legsOf(p).reduce((a, [s, l, c]) => a + (-deltaOf(spot, s, T, b.iv, c) + deltaOf(spot, l, T, b.iv, c)) * 100 * p.qty, 0);
    const theta = (pn.mark - markOf(p, i, Math.max(0, dte - 1))) * (p.cr / p.m0) * 100 * p.qty;
    return { p, risk, pn, delta, theta, week: weekKey(p.dte) };
  });
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const group = (f: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(f(r), (m.get(f(r)) ?? 0) + r.risk));
    return [...m.entries()].sort((a, z) => z[1] - a[1]);
  };
  const tot = sum((r) => r.risk);
  return {
    tot, totPct: (tot / R.acct) * 100, pnl: sum((r) => r.pn.dollars), delta: sum((r) => r.delta), theta: sum((r) => r.theta),
    overN: rows.filter((r) => (r.risk / R.acct) * 100 > (r.p.dte === 0 ? R.zRisk : R.riskPct) + 1e-9).length,
    byUnd: group((r) => r.p.tk), byWeek: group((r) => r.week),
  };
}

/* ── journal (example trades) ───────────────────────────────────────────── */
export type Trade = {
  date: string; tk: string; strat: string; delta: number; dte: number; regime: "Positive" | "Negative";
  ivr: number; wall: boolean; cr: number; width: number; exit: string; pnl: number; maxp: number; maxl: number;
};
const RAW: [string, string, string, number, number, "Positive" | "Negative", number, boolean, number, number, string, number][] = [
  ["Aug 04", "SPY", "Put spread", 20, 45, "Positive", 48, true, 1.72, 5, "Profit level", 86],
  ["Aug 06", "QQQ", "Condor", 16, 45, "Positive", 52, true, 2.1, 5, "Profit level", 105],
  ["Aug 11", "IWM", "Put spread", 25, 30, "Negative", 61, false, 1.95, 5, "Loss level", -390],
  ["Aug 13", "SPY", "Call spread", 18, 45, "Positive", 44, true, 1.15, 5, "Time rule", 41],
  ["Aug 18", "AAPL", "Put spread", 20, 30, "Positive", 27, false, 1.4, 5, "Profit level", 70],
  ["Aug 20", "SPY", "Condor", 16, 45, "Positive", 39, true, 1.9, 5, "Profit level", 95],
  ["Aug 25", "QQQ", "Put spread", 25, 21, "Negative", 58, false, 2.05, 5, "Profit level", 100],
  ["Aug 27", "SPY", "Put spread", 16, 45, "Positive", 35, true, 1.3, 5, "Profit level", 65],
  ["Sep 02", "IWM", "Condor", 20, 30, "Negative", 66, false, 2.3, 4, "Time rule", 60],
  ["Sep 04", "SPY", "Put spread", 20, 45, "Positive", 41, true, 1.65, 5, "Profit level", 83],
  ["Sep 09", "QQQ", "Call spread", 20, 30, "Positive", 47, true, 1.55, 5, "Profit level", 78],
  ["Sep 11", "AAPL", "Call spread", 25, 21, "Negative", 31, false, 1.85, 5, "Loss level", -370],
  ["Sep 15", "SPY", "Condor", 18, 45, "Positive", 45, true, 2.05, 5, "Profit level", 103],
  ["Sep 17", "IWM", "Put spread", 16, 45, "Positive", 57, true, 1.25, 4, "Profit level", 63],
  ["Sep 22", "QQQ", "Put spread", 20, 30, "Positive", 50, false, 1.7, 5, "Loss level", -340],
  ["Sep 24", "SPY", "Put spread", 25, 21, "Negative", 38, false, 1.95, 5, "Profit level", 55],
  ["Sep 29", "SPY", "Call spread", 16, 45, "Positive", 40, true, 1.2, 5, "Profit level", 60],
  ["Oct 01", "QQQ", "Condor", 18, 45, "Positive", 54, true, 2.15, 5, "Profit level", 108],
];
export const TRADES: Trade[] = RAW.map(([date, tk, strat, delta, dte, regime, ivr, wall, cr, width, exit, pnl]) => ({
  date, tk, strat, delta, dte, regime, ivr, wall, cr, width, exit, pnl, maxp: cr * 100, maxl: (width - cr) * 100,
}));
export function stats(list: Trade[]) {
  const n = list.length, wins = list.filter((t) => t.pnl > 0), loss = list.filter((t) => t.pnl <= 0);
  const gw = wins.reduce((a, t) => a + t.pnl, 0), gl = -loss.reduce((a, t) => a + t.pnl, 0);
  let streak = 0, maxStreak = 0;
  list.forEach((t) => {
    if (t.pnl <= 0) maxStreak = Math.max(maxStreak, ++streak);
    else streak = 0;
  });
  return {
    n, win: n ? wins.length / n : 0, pf: gl ? gw / gl : Infinity, exp: n ? (gw - gl) / n : 0,
    capt: wins.length ? wins.reduce((a, t) => a + t.pnl / t.maxp, 0) / wins.length : 0,
    ror: list.reduce((a, t) => a + t.pnl, 0) / list.reduce((a, t) => a + t.maxl, 0), maxStreak,
  };
}
export const GROUPS: Record<string, { label: string; f: (t: Trade) => string; note: string }> = {
  regime: { label: "By gamma regime", f: (t) => `${t.regime} gamma`, note: "In this example journal, trades opened in positive gamma held up better, and each loss cost several wins." },
  wall: { label: "By wall position", f: (t) => (t.wall ? "Behind a wall" : "Open air"), note: "Shorts parked behind a wall against shorts in open air. The live version fills this from your closed trades." },
  delta: { label: "By short delta", f: (t) => (t.delta <= 16 ? "16Δ or less" : t.delta <= 20 ? "17-20Δ" : "21-25Δ"), note: "Higher delta paid more credit and lost more often here." },
  dte: { label: "By DTE when opened", f: (t) => `${t.dte} DTE`, note: "Days to expiration when the trade was opened." },
  exit: { label: "By how it closed", f: (t) => t.exit, note: "How each trade ended under the management rules." },
  ivr: { label: "By IV rank", f: (t) => (t.ivr >= 50 ? "IV rank 50+" : t.ivr >= 30 ? "IV rank 30-49" : "IV rank under 30"), note: "IV rank when the trade was opened." },
};
