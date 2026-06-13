// GEX-specific helpers — higher-level than calculations.ts
import {
  type ChainRow,
  type CalcMode,
  calculateNetGEX,
  findGEXFlip,
  findCallWall,
  findPutWall,
  formatGEX,
} from "./calculations";

export interface GexSummary {
  gexFlip: number | null;
  callWall: number | undefined;
  putWall: number | undefined;
  totalNetGEX: number;
  totalNetGEXFormatted: string;
  isPositiveGamma: boolean;
}

export function computeGexSummary(
  chain: ChainRow[],
  spotPrice: number,
  mode: CalcMode = "net"
): GexSummary {
  // Use pre-computed netGEX from proxy if available, otherwise calculate
  const annotated = chain.map((row) => ({
    ...row,
    netGEX: row.netGEX != null && row.netGEX !== 0
      ? row.netGEX
      : calculateNetGEX(row, mode),
  }));

  const totalNetGEX = annotated.reduce((sum, r) => sum + (r.netGEX ?? 0), 0);

  return {
    gexFlip: findGEXFlip(annotated, spotPrice),
    callWall: findCallWall(annotated),
    putWall: findPutWall(annotated),
    totalNetGEX,
    totalNetGEXFormatted: formatGEX(totalNetGEX),
    isPositiveGamma: totalNetGEX >= 0,
  };
}
