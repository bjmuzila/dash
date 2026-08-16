/**
 * Option-chain math shared by every surface that renders a chain.
 *
 * This lived inside app/options-chain/page.tsx, which was fine while that route
 * was the only consumer. The ES Candles page's 0DTE side panel is the second
 * one, and it must derive GEX/DEX/VEX/CHEX by exactly the same formulas and
 * tint them on exactly the same ramp — otherwise the same strike reads one
 * number on the chain page and a different one in the panel beside the chart,
 * and there is no way to tell which is right.
 *
 * Pulled into lib/ rather than imported across pages so the side panel doesn't
 * drag a 3,000-line route component into its bundle for two functions.
 */

const DATA_MODES = ["oi-vol", "vol-only", "flow"] as const;
export type DataMode = (typeof DATA_MODES)[number];

// Per-strike, per-expiration greek values.
export type GreekCell = {
  gex: number;
  dex: number;
  chex: number;
  vex: number;
  /**
   * Net open interest = callOI − putOI. Signed on purpose: it is what the OI
   * tab's heat scale, per-column totals and ⅀ Total column read through
   * valueAt(), so a call-heavy strike colors blue and a put-heavy one red,
   * exactly like the greeks. The two-line call/put breakdown the OI cell
   * actually displays comes from callOI/putOI below.
   */
  oi: number;
  /** Pure volume-only GEX (volume-weighted gamma), independent of dataMode. */
  volGex: number;
  /** Raw per-side book stats for the hover card. */
  callOI: number;
  putOI: number;
  callVol: number;
  putVol: number;
  /** Net premium traded per side = mark × volume × 100. */
  callPrem: number;
  putPrem: number;
};

/**
 * The three fixed rank floors the heat scale reserves for a column's dominant
 * strikes. Hue is the SIGN of the value (+GEX cyan, −GEX red); the alpha is the
 * rank. Exported because two things paint with them:
 *
 *   1. metricBg() below, for the top-3 magnitudes of a normal heated column.
 *   2. Levels-only mode (an Intensity slider at its minimum stop), where the
 *      gamma field is off and CB / CW / PW are painted at ranks 1 / 2 / 3 — see
 *      lib/calculations/heatLevels. Those cells must read as HEAT, in the same
 *      blue/red language as every other cell on the grid, not in the gold/blue/
 *      red of the level BADGES. The badge says which level it is; the fill says
 *      how much gamma is there and which way it points.
 */
export const RANK_FLOOR_ALPHA = [0.90, 0.45, 0.25] as const;

/** Heat fill for a cell being painted at a fixed rank floor. */
export function rankBg(value: number, rank: 1 | 2 | 3): string {
  const a = RANK_FLOOR_ALPHA[rank - 1];
  return (value || 0) >= 0 ? `rgba(41,182,246,${a})` : `rgba(255,71,87,${a})`;
}

/**
 * Intensity-scaled heat tint for a chain cell. The three largest magnitudes get
 * fixed rank floors so the dominant strikes always stand out; everything else
 * follows a curve scaled by `intensity`.
 */
export function metricBg(value: number, maxValue: number, intensity: number, topValues: number[]) {
  const n = value || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return "transparent";
  const pos = n >= 0;
  const rank = topValues.indexOf(Math.abs(n)) + 1;
  if (rank === 1 || rank === 2 || rank === 3) return rankBg(n, rank);
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio * Math.max(intensity || 0.1, 1), 1.4);
  const alpha = Math.min(0.18, 0.02 + eased * 0.16);
  return pos ? `rgba(41,182,246,${alpha.toFixed(2)})` : `rgba(255,71,87,${alpha.toFixed(2)})`;
}

// Parse one expiration's chain payload into strike→greek cells.
// GEX/DEX/CHEX/VEX use the same formulas the single-expiry view used:
//   contracts = OI + volume (per side); GEX = (γc·cc − γp·pc)·S²·0.01·100, etc.
// When dataMode is "flow", the gex cell uses flowGEX from flowGexMap instead.
export function parseExpiration(items: unknown[], expDate: string, spot: number, dataMode: DataMode = "oi-vol", flowGexMap: Map<number, number> = new Map()): Map<number, GreekCell> {
  const cells = new Map<number, GreekCell>();
  const target = (items as { "expiration-date"?: string; strikes?: unknown[] }[]).filter(
    i => String(i["expiration-date"] ?? "").slice(0, 10) === expDate.slice(0, 10),
  );
  const groups = target.length ? target : (items as { strikes?: unknown[] }[]);
  const S = spot > 0 ? spot : 0;

  groups.forEach(group => {
    (group.strikes || []).forEach((item: unknown) => {
      const it = item as Record<string, unknown>;
      const strike = parseFloat(String(it["strike-price"] || 0));
      if (!strike) return;

      const c = it.call as Record<string, unknown> | undefined;
      const p = it.put as Record<string, unknown> | undefined;
      const num = (o: Record<string, unknown> | undefined, k: string) =>
        o ? parseFloat(String(o[k])) || 0 : 0;
      const cnt = (o: Record<string, unknown> | undefined) =>
        o ? (dataMode === "vol-only" ? 0 : (parseInt(String(o["open-interest"] ?? o.openInterest ?? 0), 10) || 0)) +
            (parseInt(String(o.volume ?? 0), 10) || 0)
          : 0;

      const cc = cnt(c);
      const pc = cnt(p);
      const live = cc > 0 || pc > 0;

      // Volume-only GEX — always computed from raw call/put volume regardless of
      // dataMode, so the OI+Vol view can flag the biggest pure-volume gamma peak.
      const cVol = c ? (parseInt(String(c.volume ?? 0), 10) || 0) : 0;
      const pVol = p ? (parseInt(String(p.volume ?? 0), 10) || 0) : 0;
      const volGexValue = (cVol > 0 || pVol > 0)
        ? (num(c, "gamma") * cVol - num(p, "gamma") * pVol) * S * S * 0.01 * 100
        : 0;

      // Raw per-side book stats for the hover card. OI is always the settled
      // open interest (independent of the Vol-only toggle, which only affects
      // the GEX basis). Mark falls back through bid/ask mid → last → close.
      const cOI = c ? (parseInt(String(c["open-interest"] ?? c.openInterest ?? 0), 10) || 0) : 0;
      const pOI = p ? (parseInt(String(p["open-interest"] ?? p.openInterest ?? 0), 10) || 0) : 0;
      const markOf = (o: Record<string, unknown> | undefined) => {
        if (!o) return 0;
        const m = num(o, "mark") || num(o, "mark-price");
        if (m > 0) return m;
        const b = num(o, "bid") || num(o, "bid-price");
        const a = num(o, "ask") || num(o, "ask-price");
        if (b > 0 || a > 0) return (b + a) / 2;
        return num(o, "last") || num(o, "last-price") || num(o, "close") || num(o, "price") || num(o, "mid");
      };
      const callPremValue = markOf(c) * cVol * 100;
      const putPremValue = markOf(p) * pVol * 100;

      let gexValue = 0;
      if (dataMode === "flow") {
        gexValue = flowGexMap.get(strike) ?? 0;
      } else {
        gexValue = live ? (num(c, "gamma") * cc - num(p, "gamma") * pc) * S * S * 0.01 * 100 : 0;
      }

      cells.set(strike, {
        gex:  gexValue,
        dex:  live ? (Math.abs(num(c, "delta")) * cc - Math.abs(num(p, "delta")) * pc) * S * 100 : 0,
        chex: live ? (-num(c, "theta") * cc + num(p, "theta") * pc) * S * 100 : 0,
        vex:  live ? (num(c, "vega") * cc - num(p, "vega") * pc) * S * 100 : 0,
        // Net OI is always the settled book (cOI/pOI), never the Vol-only
        // basis — the OI tab is about positioning, so the "Vol Only" toggle
        // must not blank it out the way it zeroes the greeks' contract counts.
        oi: cOI - pOI,
        volGex: volGexValue,
        callOI: cOI, putOI: pOI,
        callVol: cVol, putVol: pVol,
        callPrem: callPremValue, putPrem: putPremValue,
      });
    });
  });

  return cells;
}
