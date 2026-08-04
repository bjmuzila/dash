/**
 * gexLevels — CB / CW / PW for the phone build.
 *
 * These are the three markers Multi Greek shows, computed by the SAME rule so a
 * strike cannot be the Call Wall on a monitor and the Core Bullseye on a phone:
 *
 *   CB — Core Bullseye: the strike with the largest |net GEX|, sign-blind.
 *   CW — Call Wall:     the largest POSITIVE net GEX.
 *   PW — Put Wall:      the most NEGATIVE net GEX.
 *
 * The rule that matters is the de-duplication. CB is very often also the
 * strongest strike on its own side, so a naive ranking labels one strike twice
 * and drops a level the trader actually wanted. `cbAware` makes CW/PW take the
 * runner-up on the side CB occupies, giving three DISTINCT strikes — and
 * returns null rather than repeating CB when there is no runner-up.
 *
 * WHY NOT THE FEED'S callWall / putWall
 * -------------------------------------
 * The socket publishes both, and useMobileGex exposes them, but the server
 * ranks them plainly — it has no concept of CB. Mixing a locally-computed CB
 * with the feed's walls is exactly how you get CB and CW pointing at the same
 * strike. So all three are derived here, together, from one chain snapshot.
 *
 * The math is `deriveColumnLevels` from the ES-candles chart helpers — a pure,
 * React-free module. Imported rather than reimplemented; its own header notes
 * it exists precisely so three callers "cannot drift into three different
 * definitions of the wall". This is the fourth.
 */

import { deriveColumnLevels, type GexColumn } from "@/components/dashboard/es-candles/chartMath";
import type { ChainRow } from "@/lib/calculations/calculations";

export type MobileLevels = {
  cb: number | null;
  callWall: number | null;
  putWall: number | null;
  gexFlip: number | null;
};

const EMPTY: MobileLevels = { cb: null, callWall: null, putWall: null, gexFlip: null };

/**
 * @param metric "oi-vol" uses gamma×(OI+volume); "vol-only" uses volume alone —
 *        the same two bases the GEX chart's toggle switches between, so the
 *        markers follow whichever the user is looking at.
 */
export function deriveMobileLevels(
  chain: ChainRow[],
  spot: number,
  metric: "oi-vol" | "vol-only" = "oi-vol",
): MobileLevels {
  if (!chain.length) return EMPTY;
  const col: GexColumn = {
    slotTs: 0,
    spot,
    cells: chain.map((r) => ({
      strike: r.strike,
      // netGEX is OI-only and netVolGEX is volume-only; their sum is the
      // canonical "OI+Vol" number the chart and heatmap both display.
      netOiVol: (r.netGEX ?? 0) + (r.netVolGEX ?? 0),
      netVol: r.netVolGEX ?? 0,
    })),
  };
  const out = deriveColumnLevels(col, metric === "vol-only" ? "vol" : "voloi", { cbAware: true });
  if (!out) return EMPTY;
  return { cb: out.cb, callWall: out.callWall, putWall: out.putWall, gexFlip: out.gexFlip };
}
