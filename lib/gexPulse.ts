/**
 * GEX PULSE — single source of truth for the 15-minute SPX directional score.
 *
 * Used by:
 *   - components/dashboard/GexPulsePanel.tsx  (the home "GEX Pulse" tab)
 *   - the Discord poster (same numbers in chat and on screen — never fork this)
 *
 * The score is a signed sum of eight weighted contributions, clamped to
 * ±100. Positive = upside skew, negative = downside skew. Every contribution
 * carries its own copy-ready note so the UI never re-derives wording.
 *
 * Weights (max |contribution|):
 *   Gamma Flip 20 · Net GEX 18 · Center of Balance 16 · Δ GEX 15m 14
 *   Put Wall   14 · Net DEX 12 · Call Wall        10 · GEX %      8
 */

export interface GexPulseInput {
  /** Spot / index price. */
  spot: number;
  /** Center of balance (MVC strike). */
  cb: number | null;
  callWall: number | null;
  putWall: number | null;
  /** Gamma flip level. */
  flip: number | null;
  /** Net GEX in $B per 1% move. */
  netGex: number | null;
  /** Net DEX in $B. */
  netDex: number | null;
  /** Positive-GEX share of the chain, 0–100. */
  gexPct: number | null;
  /** Net GEX ($B) as of ~15 minutes ago, or null until the window fills. */
  netGexPrev15m: number | null;
  /** Score from the previous 15-minute stamp, for the delta line. */
  prevScore?: number | null;
}

export interface PulseRow {
  /** Row label, e.g. "Gamma Flip". */
  n: string;
  /** Formatted value, e.g. "6,368". */
  v: string;
  /** Short explanation, already arrow-prefixed. */
  note: string;
  /** Signed contribution to the score. */
  p: number;
}

export type PulseBias = "UPSIDE" | "DOWNSIDE" | "BALANCED";
export type PulseConf = "Strong" | "Moderate" | "Weak";

export interface GexPulse {
  score: number;
  bias: PulseBias;
  conf: PulseConf;
  /** "up" | "dn" | "neu" — drives every color in the card. */
  tone: "up" | "dn" | "neu";
  regime: string;
  note: string;
  levels: PulseRow[];
  flow: PulseRow[];
  tgtUp: number | null;
  tgtUpNote: string;
  tgtDn: number | null;
  tgtDnNote: string;
  invalid: number | null;
  invalidNote: string;
  prevScore: number | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const strike = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const pts = (v: number) => `${Math.abs(v).toFixed(1)} pts`;
const bn = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} B`);
const mm = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 1000).toFixed(0)} M`;
const arrow = (p: number) => (p > 0 ? "▲" : p < 0 ? "▼" : "◆");

/**
 * Distance-scaled contribution: full weight once `dist` reaches `span`
 * (a fraction of spot), with a floor so "barely above" still registers.
 */
function scaled(dist: number, spot: number, span: number, weight: number): number {
  const t = clamp(Math.abs(dist) / (spot * span), 0.25, 1);
  return Math.round(Math.sign(dist) * weight * t);
}

export function computeGexPulse(i: GexPulseInput): GexPulse {
  const { spot } = i;
  const levels: PulseRow[] = [];
  const flow: PulseRow[] = [];

  // ── Center of Balance — spot above CB is upside skew. ±16
  {
    const d = i.cb == null ? 0 : spot - i.cb;
    const p = i.cb == null ? 0 : scaled(d, spot, 0.004, 16);
    const note =
      i.cb == null ? "—"
      : Math.abs(d) < spot * 0.0006 ? `${arrow(0)} spot at CB`
      : `${arrow(d)} spot ${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} ${d > 0 ? "above" : "below"} CB`;
    levels.push({ n: "Center of Bal", v: strike(i.cb), note, p });
  }

  // ── Call Wall — headroom is fuel, pinned into it is resistance. ±10
  {
    const room = i.callWall == null ? null : (i.callWall - spot) / spot;
    let p = 0, note = "—";
    if (room != null) {
      if (room < 0)            { p =  8; note = `${arrow(1)} above call wall · breakout`; }
      else if (room > 0.008)   { p = 10; note = `${arrow(1)} ${pts(i.callWall! - spot)} of room`; }
      else if (room > 0.002)   { p =  5; note = `${arrow(1)} ${pts(i.callWall! - spot)} of room`; }
      else                     { p = -4; note = `${arrow(-1)} pinned into wall`; }
    }
    levels.push({ n: "Call Wall", v: strike(i.callWall), note, p });
  }

  // ── Put Wall — cushion below is support, sitting on it is break risk. ±14
  {
    const cushion = i.putWall == null ? null : (spot - i.putWall) / spot;
    let p = 0, note = "—";
    if (cushion != null) {
      if (cushion < 0)          { p = -14; note = `${arrow(-1)} below put wall`; }
      else if (cushion > 0.008) { p =  14; note = `${arrow(1)} ${pts(spot - i.putWall!)} cushion`; }
      else if (cushion > 0.002) { p =   7; note = `${arrow(1)} ${pts(spot - i.putWall!)} cushion`; }
      else                      { p = -10; note = `${arrow(-1)} sitting on wall`; }
    }
    levels.push({ n: "Put Wall", v: strike(i.putWall), note, p });
  }

  // ── Gamma Flip — the single heaviest input. ±20
  {
    const d = i.flip == null ? 0 : spot - i.flip;
    const straddling = i.flip != null && Math.abs(d) < spot * 0.0008;
    const p = i.flip == null ? 0 : straddling ? Math.round(Math.sign(d) * 4) : scaled(d, spot, 0.005, 20);
    const note =
      i.flip == null ? "—"
      : straddling ? `${arrow(0)} straddling flip`
      : d > 0 ? `${arrow(1)} above flip · long gamma`
      : `${arrow(-1)} below flip · short gamma`;
    levels.push({ n: "Gamma Flip", v: strike(i.flip), note, p });
  }

  // ── Net GEX — sign (±12) plus direction of travel (±6). ±18
  {
    const g = i.netGex;
    const d15 = g != null && i.netGexPrev15m != null ? g - i.netGexPrev15m : null;
    let p = 0, note = "—";
    if (g != null) {
      p = Math.round(clamp(g / 2, -1, 1) * 12);
      if (d15 != null) p += d15 > 0 ? 6 : d15 < 0 ? -6 : 0;
      note = g >= 0
        ? `${arrow(1)} positive · stabilizing`
        : `${arrow(-1)} negative · unstable`;
      if (d15 != null) note += d15 > 0 ? " · rising" : " · falling";
    }
    flow.push({ n: "Net GEX", v: bn(g), note, p });
  }

  // ── Net DEX — dealer delta direction. ±12
  {
    const d = i.netDex;
    const p = d == null ? 0 : Math.round(clamp(d / 2, -1, 1) * 12);
    const note = d == null ? "—"
      : Math.abs(d) < 0.15 ? `${arrow(0)} flat · no directional bid`
      : d > 0 ? `${arrow(1)} up · dealer long delta`
      : `${arrow(-1)} down · dealer short delta`;
    flow.push({ n: "Net DEX", v: bn(d), note, p });
  }

  // ── Δ GEX 15m — momentum of the gamma build. ±14
  {
    const g = i.netGex, prev = i.netGexPrev15m;
    const d = g != null && prev != null ? g - prev : null;
    const p = d == null ? 0 : Math.round(clamp(d / 0.5, -1, 1) * 14);
    const note = d == null ? "warming up · needs 15m"
      : d > 0.25 ? `${arrow(1)} building fast`
      : d > 0 ? `${arrow(1)} building`
      : d < -0.25 ? `${arrow(-1)} draining fast`
      : d < 0 ? `${arrow(-1)} draining`
      : `${arrow(0)} flat`;
    flow.push({ n: "Δ GEX 15m", v: d == null ? "—" : mm(d), note, p });
  }

  // ── GEX % — percentile of positive gamma. Extremes cut both ways: max pin
  //    kills directional follow-through, min pin means trend/vol expansion. ±8
  {
    const q = i.gexPct;
    let p = 0, note = "—";
    if (q != null) {
      if (q >= 88)      { p = -8; note = `${arrow(-1)} ${q.toFixed(0)}% · max pin`; }
      else if (q >= 60) { p =  5; note = `${arrow(1)} ${q.toFixed(0)}% · high pin risk`; }
      else if (q >= 40) { p =  0; note = `${arrow(0)} ${q.toFixed(0)}% · neutral`; }
      else if (q >= 15) { p = -4; note = `${arrow(-1)} ${q.toFixed(0)}% · vol expanding`; }
      else              { p = -8; note = `${arrow(-1)} ${q.toFixed(0)}% · trend regime`; }
    }
    flow.push({ n: "GEX %", v: q == null ? "—" : `${q.toFixed(0)}%`, note, p });
  }

  const raw = [...levels, ...flow].reduce((s, r) => s + r.p, 0);
  const score = clamp(Math.round(raw), -100, 100);
  const a = Math.abs(score);
  const tone: GexPulse["tone"] = score > 15 ? "up" : score < -15 ? "dn" : "neu";
  const bias: PulseBias = tone === "up" ? "UPSIDE" : tone === "dn" ? "DOWNSIDE" : "BALANCED";
  const conf: PulseConf = a >= 60 ? "Strong" : a >= 30 ? "Moderate" : "Weak";

  // ── Regime + one-line read
  const aboveFlip = i.flip != null && spot > i.flip;
  const straddling = i.flip != null && Math.abs(spot - i.flip) < spot * 0.0008;
  const maxPin = (i.gexPct ?? 0) >= 88;
  let regime: string, note: string;
  if (straddling) {
    regime = "TRANSITION — spot straddling flip, gamma sign unstable";
    note = "expect expansion, size down";
  } else if (maxPin && a < 30) {
    regime = "PINNED — spot glued to CB, low realized vol";
    note = "range trade, fade the edges";
  } else if (aboveFlip) {
    regime = "POSITIVE GAMMA — dealers sell rallies / buy dips, expect pinning";
    note = i.callWall != null ? `squeeze fuel above ${strike(i.callWall)}` : "mean-revert bias";
  } else {
    regime = "NEGATIVE GAMMA — dealers sell into weakness, moves accelerate";
    note = i.putWall != null ? `air pocket to ${strike(i.putWall)}` : "trend bias";
  }

  // ── Targets: next magnet in each direction, flip is always the invalidator.
  const above = i.cb != null && spot < i.cb ? i.cb : i.callWall;
  const below = i.cb != null && spot > i.cb ? i.cb : i.putWall;

  return {
    score, bias, conf, tone, regime, note, levels, flow,
    tgtUp: above,
    tgtUpNote: above === i.cb ? "CB reclaim" : "call wall magnet",
    tgtDn: below,
    tgtDnNote: below === i.cb ? "CB reversion" : "put wall support",
    invalid: i.flip,
    invalidNote: aboveFlip ? "lose flip → regime break" : "reclaim flip → invalid",
    prevScore: i.prevScore ?? null,
  };
}
