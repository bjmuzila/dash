import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGapFill, extremeToward, gapDir } from "../lib/esGapMath.js";

// Run with:  npm test   (tsx --test tests/**/*.test.ts)

test("gapDir classifies sign", () => {
  assert.equal(gapDir(20), "up");
  assert.equal(gapDir(-20), "down");
  assert.equal(gapDir(0), "flat");
});

test("gap up — no retrace yet is 0%", () => {
  // close 5000, open 5020 (gap +20). Price hasn't moved off the open.
  const { pct, filled } = computeGapFill(5000, 5020, 5020);
  assert.equal(pct, 0);
  assert.equal(filled, false);
});

test("gap up — partial fill (40%)", () => {
  // dipped to 5012 → traveled 8 of 20.
  const { pct, filled } = computeGapFill(5000, 5020, 5012);
  assert.equal(pct, 40);
  assert.equal(filled, false);
});

test("gap up — exact touch of prior close is 100% + filled", () => {
  const { pct, filled } = computeGapFill(5000, 5020, 5000);
  assert.equal(pct, 100);
  assert.equal(filled, true);
});

test("gap up — overshoot past prior close clamps at 100% + filled", () => {
  const { pct, filled } = computeGapFill(5000, 5020, 4998);
  assert.equal(pct, 100);
  assert.equal(filled, true);
});

test("gap down — partial fill (75%)", () => {
  // close 5000, open 4980 (gap -20). Rallied to 4995 → traveled 15 of 20.
  const { pct, filled } = computeGapFill(5000, 4980, 4995);
  assert.equal(pct, 75);
  assert.equal(filled, false);
});

test("gap down — touch fills", () => {
  const { pct, filled } = computeGapFill(5000, 4980, 5000);
  assert.equal(pct, 100);
  assert.equal(filled, true);
});

test("flat gap counts as already filled", () => {
  const { pct, filled } = computeGapFill(5000, 5000, 5000);
  assert.equal(pct, 100);
  assert.equal(filled, true);
});

test("extremeToward picks low for gap up, high for gap down", () => {
  // gap up → session low is the extreme toward the (lower) prior close.
  assert.equal(extremeToward(5020, 5000, 5008, 5025), 5008);
  // gap down → session high is the extreme toward the (higher) prior close.
  assert.equal(extremeToward(4980, 5000, 4975, 4996), 4996);
});

test("a wrong-direction move never registers fill", () => {
  // gap up but price ran HIGHER (away from close). Low never dipped below open.
  const { pct, filled } = computeGapFill(5000, 5020, 5020); // extreme == open
  assert.equal(pct, 0);
  assert.equal(filled, false);
});
