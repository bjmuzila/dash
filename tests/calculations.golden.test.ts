/**
 * Golden-fixture regression tests for the GEX/DEX calculation surface.
 *
 * These lock the *conventions* that have repeatedly regressed (see project
 * memory: "label says OI+Vol but computes OI-only", "raw vs abs gamma flips a
 * side", flip-sign bugs). Unlike calculations.test.ts (toy values that net to
 * zero), these use realistic SPX-scale inputs with hand-computed expected
 * numbers so a magnitude or sign drift fails loudly.
 *
 * Convention under test (single source of truth in lib/calculations):
 *   callGEX = +abs(callGamma) * (callOI[+callVol]) * spot^2
 *   putGEX  = -abs(putGamma)  * (putOI[+putVol])  * spot^2
 *   net     = callGEX + putGEX
 *   "net" basis = OI + Volume ; "vol" basis = Volume only
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  callGEXOf,
  putGEXOf,
  netGEXOf,
  callPosOf,
  putPosOf,
  calculateNetGEX,
  type ChainRow,
} from "../lib/calculations/calculations";

const approx = (a: number, b: number, tol = 1) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ~${b}, got ${a}`);

// A single realistic 0DTE SPX strike. Hand-computed expectations below.
const SPOT = 7400;
const ROW: ChainRow = {
  strike: 7400,
  spotPrice: SPOT,
  callOI: 1200,
  callVolume: 8000,
  putOI: 3000,
  putVolume: 1500,
  callGamma: 0.0011,
  putGamma: 0.0009,
};

test("GOLDEN: call/put position respects OI+Vol vs Vol-only basis", () => {
  // OI+Vol
  assert.equal(callPosOf(ROW, "net"), 1200 + 8000);
  assert.equal(putPosOf(ROW, "net"), 3000 + 1500);
  // Vol-only
  assert.equal(callPosOf(ROW, "vol"), 8000);
  assert.equal(putPosOf(ROW, "vol"), 1500);
});

test("GOLDEN: callGEX is positive, putGEX is negative (sign convention)", () => {
  assert.ok(callGEXOf(ROW, "net", SPOT) > 0, "call GEX must be positive");
  assert.ok(putGEXOf(ROW, "net", SPOT) < 0, "put GEX must be negative");
});

test("GOLDEN: a negative gamma must NOT flip a side's sign (abs gamma)", () => {
  const dirty: ChainRow = { ...ROW, callGamma: -0.0011, putGamma: -0.0009 };
  // Same magnitude as ROW; sign of each side unchanged despite negative gamma.
  approx(callGEXOf(dirty, "net", SPOT), callGEXOf(ROW, "net", SPOT));
  approx(putGEXOf(dirty, "net", SPOT), putGEXOf(ROW, "net", SPOT));
});

test("GOLDEN: OI+Vol net GEX magnitude is correct", () => {
  // callGEX = 0.0011 * 9200 * 7400^2  = 554,074,720
  // putGEX  = -0.0009 * 4500 * 7400^2 = -221,778,000
  // net     = 332,296,720
  const callExpected = 0.0011 * 9200 * SPOT * SPOT;
  const putExpected = -0.0009 * 4500 * SPOT * SPOT;
  approx(callGEXOf(ROW, "net", SPOT), callExpected, 10);
  approx(putGEXOf(ROW, "net", SPOT), putExpected, 10);
  approx(netGEXOf(ROW, "net", SPOT), callExpected + putExpected, 10);
});

test("GOLDEN: Vol-only differs from OI+Vol (catches OI-only-when-labeled-OIVol bug)", () => {
  const oiVol = calculateNetGEX(ROW, "net");
  const volOnly = calculateNetGEX(ROW, "vol");
  // They must NOT be equal — if some refactor makes "net" compute vol-only (or
  // vice versa) this guard trips.
  assert.notEqual(oiVol, volOnly);
  // Vol-only call leg uses 8000 contracts, OI+Vol uses 9200 → OI+Vol call leg
  // is strictly larger in magnitude.
  assert.ok(callGEXOf(ROW, "net", SPOT) > callGEXOf(ROW, "vol", SPOT));
});

test("GOLDEN: spot override beats row spot fields (chart-spot precedence)", () => {
  const noSpotRow: ChainRow = { ...ROW, spotPrice: undefined, spot: undefined };
  // With no row spot and no override → 0 (gamma * pos * 0^2).
  assert.equal(callGEXOf(noSpotRow, "net"), 0);
  // Passing the live chart spot restores the value.
  approx(callGEXOf(noSpotRow, "net", SPOT), callGEXOf(ROW, "net", SPOT));
});
