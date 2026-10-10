"use client";

import { M_COLOR, MONO, TYPE, gridCols, mTile } from "./mobileTheme";
import { fmtPrice } from "./mobileTheme";

/**
 * LevelsBar — the four numbers a trader checks before anything else: spot, the
 * gamma flip, and the two walls. Shared by the GEX chart and heatmap pages so
 * they agree exactly (they read the same hook, but a second layout would be a
 * second chance to format a number differently).
 *
 * Each cell is its own tile rather than a text row: at 390px a run of four
 * space-separated labelled numbers reads as one blob, and tiles give the eye a
 * boundary without spending a pixel on borders.
 */

function Cell({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <div style={{ ...mTile, padding: "6px 8px" }}>
      <div
        style={{
          fontSize: TYPE.micro - 2,
          fontWeight: 800,
          letterSpacing: "0.08em",
          color: M_COLOR.faint,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      <div
        style={{
          ...MONO,
          fontSize: TYPE.value,
          fontWeight: 700,
          lineHeight: 1.2,
          color: accent ?? M_COLOR.text,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ ...MONO, fontSize: TYPE.micro - 2, fontWeight: 700, color: accent ?? M_COLOR.faint, lineHeight: 1.2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export default function LevelsBar({
  spot,
  prevClose,
  flip,
  callWall,
  putWall,
}: {
  spot: number;
  prevClose: number;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
}) {
  const chg = prevClose > 0 && spot > 0 ? spot - prevClose : null;
  const chgPct = chg != null && prevClose > 0 ? (chg / prevClose) * 100 : null;
  const up = (chg ?? 0) >= 0;

  // Above the flip = long gamma (dealers dampen moves); below = short gamma.
  const aboveFlip = flip != null && spot > 0 ? spot >= flip : null;

  return (
    <div style={{ display: "grid", ...gridCols("repeat(4, minmax(0, 1fr))"), gap: 6 }}>
      <Cell
        label="SPOT"
        value={fmtPrice(spot)}
        sub={chgPct != null ? `${up ? "+" : "−"}${Math.abs(chgPct).toFixed(2)}%` : undefined}
        accent={chgPct == null ? undefined : up ? M_COLOR.up : M_COLOR.down}
      />
      <Cell
        label="FLIP"
        value={fmtPrice(flip, 0)}
        accent={M_COLOR.orange}
        sub={aboveFlip == null ? undefined : aboveFlip ? "long γ" : "short γ"}
      />
      <Cell label="CALL W" value={fmtPrice(callWall, 0)} accent={M_COLOR.pos} />
      <Cell label="PUT W" value={fmtPrice(putWall, 0)} accent={M_COLOR.neg} />
    </div>
  );
}
