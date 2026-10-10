"use client";

import { useEffect, useRef, useState } from "react";

/**
 * useStrikeGexRate — per-strike net GEX RATE, in dollars per 1% move per MINUTE.
 *
 * This is the per-strike companion to the rail's "Net GEX Rate / min" tile: it
 * answers "which walls are building and which are decaying, right now" rather
 * than "how big is this wall".
 *
 * WHY THIS IS CLIENT-SIDE (and not another `useStrikeGexHistory` age bucket):
 * the stored per-strike history is written by server-v2/gex-history-writer.js on
 * a PG_WRITE_INTERVAL_MS (~60s) cadence, and each stored row is an AVERAGE of
 * the ~12 recomputes seen in that window. Asking that series for a "1 minute
 * ago" baseline gives a reference point that is anywhere from 0 to 120s old and
 * already smoothed — the resulting "per minute" figure would be neither. The
 * live rows this hook samples update every few seconds, so differencing them
 * over a measured span is both sharper and free of any server change.
 *
 * Sampling: one snapshot per SAMPLE_MS of every strike's live net GEX, capped at
 * RING_SAMPLES. The rate for a strike is (now − reference) / elapsed-minutes,
 * where the reference is the newest snapshot at least MIN_SPAN_MS old. As with
 * the rail tile, a too-short span is rejected rather than divided through —
 * dividing a small delta by a few seconds manufactures a huge rate out of feed
 * jitter.
 */

export interface StrikeRate {
  /** Dollars of net GEX per 1% move, added (+) or pulled (−), per minute. */
  d: number;
  /** The same move as a percent of the strike's own |net GEX|, per minute. */
  pct: number;
}

const MINUTE_MS = 60_000;
/** How often to snapshot the live rows. */
const SAMPLE_MS = 15_000;
/** ~2 minutes of snapshots — enough to always reach back past the 1-min mark. */
const RING_SAMPLES = 9;
/** Reject spans shorter than this; see note above. */
const MIN_SPAN_MS = 30_000;
/** Ignore references older than this (a stale tab shouldn't report a "rate"). */
const MAX_SPAN_MS = 180_000;
/** Below this |baseline| a percent is meaningless. */
const MIN_BASE = 1e-6;

type Snapshot = { ts: number; by: Record<number, number> };

export function useStrikeGexRate(
  rows: Array<{ strikeNum: number; netGexVal?: number | null }>,
  /** Pass false to park the hook (no timer, no state) when the stamps are off. */
  enabled = true,
): Record<number, StrikeRate> {
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [snaps, setSnaps] = useState<Snapshot[]>([]);

  useEffect(() => {
    if (!enabled) {
      setSnaps([]);
      return;
    }
    const sample = () => {
      const by: Record<number, number> = {};
      for (const r of rowsRef.current) {
        const v = Number(r.netGexVal ?? NaN);
        if (Number.isFinite(v)) by[r.strikeNum] = v;
      }
      if (!Object.keys(by).length) return;
      setSnaps((prev) => [...prev, { ts: Date.now(), by }].slice(-RING_SAMPLES));
    };
    sample();
    const id = setInterval(sample, SAMPLE_MS);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled || snaps.length < 2) return {};

  const now = Date.now();
  // Newest snapshot that is old enough to divide by, and not so old it's stale.
  const eligible = snaps.filter((s) => now - s.ts >= MIN_SPAN_MS && now - s.ts <= MAX_SPAN_MS);
  if (!eligible.length) return {};
  const target = now - MINUTE_MS;
  const atOrBefore = eligible.filter((s) => s.ts <= target);
  const ref = atOrBefore.length ? atOrBefore[atOrBefore.length - 1] : eligible[0];

  const spanMin = (now - ref.ts) / MINUTE_MS;
  if (!(spanMin > 0)) return {};

  const out: Record<number, StrikeRate> = {};
  for (const r of rowsRef.current) {
    const live = Number(r.netGexVal ?? NaN);
    const past = ref.by[r.strikeNum];
    if (!Number.isFinite(live) || !Number.isFinite(past)) continue;
    if (Math.abs(past) < MIN_BASE) continue;
    const d = (live - past) / spanMin;
    if (!Number.isFinite(d) || d === 0) continue;
    const pct = (d / Math.abs(past)) * 100;
    if (!Number.isFinite(pct)) continue;
    out[r.strikeNum] = { d, pct };
  }
  return out;
}
