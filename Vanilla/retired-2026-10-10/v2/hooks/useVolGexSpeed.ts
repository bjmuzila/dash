"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Per-strike VOL-ONLY GEX "speed" — how fast gamma is being built or torn down
 * at each strike over a rolling window (30s / 1m / 5m).
 *
 * HYBRID SOURCE (see [[heatmap-vol-history]]):
 *   • Live ring buffer — every chain tick pushes a {t, strike→netVolGEX} sample.
 *     This is the only source with sub-minute resolution.
 *   • Postgres seed — /proxy/gex-history?basis=vol returns per-strike net_vol_gex
 *     baselines at N minutes ago (writer snapshots every 60s). Used ONLY until the
 *     live buffer is old enough to cover the window, so a page reload doesn't blank
 *     the column. Rows sourced this way are flagged `seeded`.
 *
 * SIGN CONVENTION: netVolGEX is dealer-signed (calls +, puts −, no ×100 rescale —
 * see [[flow-gex-sign-scaling]]). Do NOT "fix" it here.
 *   delta    = cur − prev            → signed change in dealer gamma
 *   magDelta = |cur| − |prev|        → + means the wall is GROWING, − means it is
 *                                      BLEEDING, regardless of call/put side.
 * magDelta is the actionable number (wall being built vs torn down); delta is kept
 * for tooltips.
 *
 * CAVEAT: vol-only GEX resets daily and accumulates, so magDelta skews positive for
 * the first ~30 min of RTH. Read it relatively (rank across strikes), not absolutely.
 */

export type SpeedWindow = 30 | 60 | 300;

export interface StrikeSpeed {
  strike: number;
  prev: number;
  cur: number;
  /** cur − prev (signed dealer gamma change) */
  delta: number;
  /** |cur| − |prev| — positive = wall building, negative = wall bleeding */
  magDelta: number;
  /** magDelta as % of |prev|, floored so near-zero strikes can't print ±9000% */
  pct: number;
  /** true when `prev` came from the Postgres baseline rather than the live buffer */
  seeded: boolean;
}

export type VolGexSpeedMap = Record<number, StrikeSpeed>;

export interface VolGexSpeedResult {
  speed: VolGexSpeedMap;
  /** how much history the live ring buffer currently holds, in ms */
  coverageMs: number;
  /** true when the window is being satisfied by the DB seed, not the live buffer */
  usingSeed: boolean;
}

interface SpeedSource {
  strike: number;
  netVolGEX?: number | null;
}

interface Sample {
  t: number;
  v: Map<number, number>;
}

const MAX_AGE_MS = 6 * 60_000; // keep a hair more than the largest window (5m)
const PCT_FLOOR_MIN = 1e5; // $100K — below this a strike is noise, not a wall

/** DB seed ages (minutes) we can fall back to, keyed by window seconds. */
const SEED_AGE_MIN: Record<number, number | null> = { 30: null, 60: 1, 300: 5 };

export function useVolGexSpeed(
  rows: SpeedSource[],
  expiry: string,
  windowSec: SpeedWindow = 60,
  opts: { sampleMs?: number; seed?: boolean } = {}
): VolGexSpeedResult {
  const sampleMs = opts.sampleMs ?? 2_000;
  const seedEnabled = opts.seed !== false;

  const bufRef = useRef<Sample[]>([]);
  const lastPushRef = useRef(0);
  const seedRef = useRef<Record<number, Record<string, number>>>({});
  // `tick` is the recompute trigger: bumped on every accepted sample AND on a 1s
  // interval, so the rolling window keeps sliding between chain frames.
  const [tick, bump] = useState(0);

  // ── live ring buffer ─────────────────────────────────────────────────────
  // Pushed straight from the render pass (rows change on every WS chain frame);
  // throttled to sampleMs so a 10Hz feed doesn't balloon the buffer.
  useEffect(() => {
    if (!rows?.length) return;
    const now = Date.now();
    if (now - lastPushRef.current < sampleMs) return;
    const v = new Map<number, number>();
    for (const r of rows) {
      const s = Number(r.strike);
      const val = Number(r.netVolGEX);
      if (!Number.isFinite(s) || !Number.isFinite(val)) continue;
      v.set(s, val);
    }
    if (!v.size) return;
    lastPushRef.current = now;
    const buf = bufRef.current;
    buf.push({ t: now, v });
    while (buf.length && now - buf[0].t > MAX_AGE_MS) buf.shift();
    bump((n) => n + 1);
  }, [rows, sampleMs]);

  // Expiry change invalidates every strike series.
  useEffect(() => {
    bufRef.current = [];
    lastPushRef.current = 0;
    seedRef.current = {};
  }, [expiry]);

  // ── Postgres seed ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!seedEnabled || !expiry) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(
          `/proxy/gex-history?expiry=${encodeURIComponent(expiry)}&basis=vol&ages=1,5`,
          { cache: "no-store" }
        );
        if (!r.ok) return;
        const json = await r.json();
        if (!cancelled) seedRef.current = json?.baselines ?? {};
      } catch {
        /* seed is best-effort — the live buffer takes over within a minute */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [expiry, seedEnabled]);

  // Recompute on a 1s cadence even when no new chain frame arrives, so the
  // window keeps sliding (and stale speeds decay toward 0 instead of freezing).
  useEffect(() => {
    const id = setInterval(() => bump((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    const buf = bufRef.current;
    const now = Date.now();
    const coverageMs = buf.length ? now - buf[0].t : 0;
    const target = now - windowSec * 1_000;

    // Newest sample at or before the target time = the "then" snapshot.
    let base: Sample | null = null;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= target) { base = buf[i]; break; }
    }
    const seedAge = SEED_AGE_MIN[windowSec];
    const usingSeed = !base && seedAge != null && Object.keys(seedRef.current).length > 0;

    const cur = new Map<number, number>();
    for (const r of rows ?? []) {
      const s = Number(r.strike);
      const v = Number(r.netVolGEX);
      if (Number.isFinite(s) && Number.isFinite(v)) cur.set(s, v);
    }

    const prevOf = (strike: number): number | null => {
      if (base) {
        const v = base.v.get(strike);
        return Number.isFinite(v as number) ? (v as number) : null;
      }
      if (usingSeed && seedAge != null) {
        const v = seedRef.current[strike]?.[String(seedAge)];
        return Number.isFinite(v) ? Number(v) : null;
      }
      return null;
    };

    // Percentage floor: 5% of the median |prev| across the window, so a strike
    // sitting near zero can't dominate the ranking with a meaningless % move.
    const prevAbs: number[] = [];
    for (const strike of cur.keys()) {
      const p = prevOf(strike);
      if (p != null) prevAbs.push(Math.abs(p));
    }
    prevAbs.sort((a, b) => a - b);
    const median = prevAbs.length ? prevAbs[Math.floor(prevAbs.length / 2)] : 0;
    const floor = Math.max(PCT_FLOOR_MIN, median * 0.05);

    const speed: VolGexSpeedMap = {};
    for (const [strike, c] of cur) {
      const p = prevOf(strike);
      if (p == null) continue;
      const magDelta = Math.abs(c) - Math.abs(p);
      speed[strike] = {
        strike,
        prev: p,
        cur: c,
        delta: c - p,
        magDelta,
        pct: (magDelta / Math.max(Math.abs(p), floor)) * 100,
        seeded: !base,
      };
    }

    return { speed, coverageMs, usingSeed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, windowSec, tick]);
}

/** Top N builders and bleeders, ranked by |magDelta|. Used by the movers rail. */
export function topSpeedMovers(speed: VolGexSpeedMap, n = 5) {
  const all = Object.values(speed).filter((s) => Number.isFinite(s.magDelta) && s.magDelta !== 0);
  const builders = all.filter((s) => s.magDelta > 0).sort((a, b) => b.magDelta - a.magDelta).slice(0, n);
  const bleeders = all.filter((s) => s.magDelta < 0).sort((a, b) => a.magDelta - b.magDelta).slice(0, n);
  return { builders, bleeders };
}
