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

// Lock the client GEX formula (lib/calculations) to the server one
// (server-v2/computation/gex-calculator.js) so the two implementations of the
// same math can't silently diverge. Single source of truth in spirit: if these
// drift, this test fails.
//   client OI+Vol  === server netGEX (OI) + netVolGEX (vol)
//   client Vol-only === server netVolGEX
test("client GEX matches server gex-calculator (basis parity)", async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { computeGexRows } = require("../server-v2/computation/gex-calculator");

  const spot = 7400;
  const serverRows = [
    { strike: 7400, side: "call", oi: 120, volume: 5200, gamma: 0.0011, delta: 0.42, theta: 0, vega: 0, iv: 0.2, dte: 0 },
    { strike: 7400, side: "put",  oi: 4100, volume: 240, gamma: 0.0013, delta: -0.55, theta: 0, vega: 0, iv: 0.2, dte: 0 },
  ];
  const [srv] = computeGexRows(serverRows, spot);

  const clientRow: ChainRow = {
    strike: 7400, spotPrice: spot,
    callOI: 120, callVolume: 5200, putOI: 4100, putVolume: 240,
    callGamma: 0.0011, putGamma: 0.0013,
  };

  const approx = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  // OI+Vol (client "net") must equal server's OI net + vol net.
  assert.ok(approx(calculateNetGEX(clientRow, "net"), srv.netGEX + srv.netVolGEX),
    `OI+Vol mismatch: client ${calculateNetGEX(clientRow, "net")} vs server ${srv.netGEX + srv.netVolGEX}`);
  // Vol-only must equal server netVolGEX.
  assert.ok(approx(calculateNetGEX(clientRow, "vol"), srv.netVolGEX),
    `Vol-only mismatch: client ${calculateNetGEX(clientRow, "vol")} vs server ${srv.netVolGEX}`);
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
