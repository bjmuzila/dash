import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateDailyEstimatedMove,
  calculateNetDEX,
  calculateNetGEX,
  findCallWall,
  findGEXFlip,
  findPutWall,
  formatGEX,
  type ChainRow,
} from "../lib/calculations/calculations";
import { computeFlowSummary, filterRecentFlow } from "../lib/calculations/flow";
import { calcEstimatedMove } from "../lib/calculations/estimated-moves";
import { computeGexSummary } from "../lib/calculations/gex";

test("calculateNetGEX combines call and put gamma exposure", () => {
  const row: ChainRow = {
    strike: 5000,
    spotPrice: 5000,
    callOI: 10,
    callVolume: 2,
    putOI: 5,
    putVolume: 1,
    callGamma: 0.001,
    putGamma: 0.002,
  };

  assert.equal(calculateNetGEX(row), 0);
  assert.equal(calculateNetGEX(row, "vol"), 0);
});

test("calculateNetDEX respects net and volume-only modes", () => {
  const row: ChainRow = {
    strike: 5000,
    callOI: 10,
    callVolume: 5,
    putOI: 4,
    putVolume: 2,
    callDelta: 0.6,
    putDelta: -0.4,
  };

  assert.equal(calculateNetDEX(row, 5000), 5_700_000);
  assert.equal(calculateNetDEX(row, 5000, "vol"), 1_900_000);
});

test("GEX helpers find flip and walls", () => {
  const chain: ChainRow[] = [
    { strike: 4950, netGEX: -10, callGEX: 100, putGEX: -900 },
    { strike: 5000, netGEX: 10, callGEX: 300, putGEX: -100 },
    { strike: 5050, netGEX: 20, callGEX: 1_000, putGEX: -200 },
  ];

  assert.equal(findGEXFlip(chain, 5000), 4975);
  assert.equal(findCallWall(chain), 5050);
  assert.equal(findPutWall(chain), 4950);
  assert.equal(formatGEX(1_250_000), "+$1.25M");
});

test("computeGexSummary annotates rows and totals net gamma", () => {
  const chain: ChainRow[] = [
    { strike: 4950, spotPrice: 5000, callOI: 1, putOI: 2, callGamma: 0.001, putGamma: 0.001 },
    { strike: 5000, spotPrice: 5000, callOI: 4, putOI: 1, callGamma: 0.001, putGamma: 0.001 },
  ];

  const summary = computeGexSummary(chain, 5000);

  assert.equal(summary.totalNetGEX, 50_000);
  assert.equal(summary.isPositiveGamma, true);
  assert.equal(summary.callWall, 4950);
});

test("estimated move helpers calculate display bounds", () => {
  assert.deepEqual(calcEstimatedMove(5000, 50, 70), {
    straddleMid: 60,
    estimatedMove: 50.4,
    estimatedMovePct: 1.01,
    upperBound: 5050.4,
    lowerBound: 4949.6,
  });

  const chain: ChainRow[] = [
    { strike: 5000, type: "call", bid: 50, ask: 54 },
    { strike: 5000, type: "put", bid: 60, ask: 64 },
  ];

  assert.equal(calculateDailyEstimatedMove(chain, 5001), 47.88);
});

test("flow summary handles recent windows and side dominance", () => {
  const now = Date.now();
  const entries = [
    { timestamp: now, ticker: "SPX", side: "call" as const, premium: 120, size: 1, strike: 5000, expiration: "2026-06-19" },
    { timestamp: now - 10_000, ticker: "SPX", side: "put" as const, premium: 80, size: 1, strike: 4950, expiration: "2026-06-19" },
    { timestamp: now - 600_000, ticker: "SPX", side: "put" as const, premium: 500, size: 1, strike: 4900, expiration: "2026-06-19" },
  ];

  assert.equal(filterRecentFlow(entries, 60_000).length, 2);
  assert.deepEqual(computeFlowSummary(entries), {
    totalCallPremium: 120,
    totalPutPremium: 580,
    ratio: 120 / 580,
    dominantSide: "puts",
  });
});
