"use client";

// useIbDirection — live "IB direction %" for the home gauge rail. Returns pHigh:
// the probability (0–100) that today's HIGH breaks first, scored off the ES IB
// dataset (public/data/ib-ES.json — ES ≈ SPX) against today's live initial
// balance. >50 = HIGH-break / bullish lean, <50 = LOW-break / bearish.
//
// This is the same number the Scanner "IB Stats" Live gauge shows (pHigh). It
// replicates ONLY the pHigh path from IbStatsTab's `live` memo + bestSample —
// today's IB high/low → first/bias/width-bucket/inner-ORB, then the tightest
// conditional stack with a usable sample, and the historical HIGH-first rate.

import { useEffect, useMemo, useState } from "react";
import { useEsCandles } from "@/hooks/useEsCandles";
import { avg, type IbDataset, type SlimDay } from "@/lib/ibStats";

const IB_END = 570 + 60; // 60-minute IB closes at 10:30 ET (minute-of-day)
const MIN_N = 40;        // smallest conditional sample we'll trust (mirrors IbStatsTab)

function etMin(ts: number): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ts));
  const h = +(p.find((x) => x.type === "hour")?.value ?? 0);
  const m = +(p.find((x) => x.type === "minute")?.value ?? 0);
  return (h % 24) * 60 + m;
}
function etDate(ts: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ts));
}

export function useIbDirection(enabled: boolean = true): number | null {
  const { candles } = useEsCandles(enabled, 2);
  const [ds, setDs] = useState<IbDataset | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/data/ib-ES.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setDs(j as IbDataset); })
      .catch(() => {});
    return () => { alive = false; };
  }, [enabled]);

  return useMemo(() => {
    const days = ds?.days;
    if (!days?.length || !candles?.length) return null;

    // Width-bucket thresholds — 20-session averages (mirrors IbStatsTab's hist).
    const avgIb = avg(days.slice(-20).map((d) => d.width)) ?? 0;
    const avgAtr = avg(days.slice(-20).map((d) => d.atr ?? d.dayRange)) ?? 0;

    // Today's IB from the live ES tape (RTH bars only, kept to one ET session).
    const all = candles
      .map((c) => ({ day: etDate(c.timestamp), min: etMin(c.timestamp), h: c.high, l: c.low, c: c.close }))
      .filter((b) => b.min >= 570 && b.min <= 960)
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.min - b.min));
    if (!all.length) return null;

    const today = all[all.length - 1].day;
    const ibBars = all.filter((b) => b.day === today && b.min >= 570 && b.min < IB_END);
    if (ibBars.length < 3) return null; // not enough of the IB has formed yet

    const ibh = Math.max(...ibBars.map((b) => b.h));
    const ibl = Math.min(...ibBars.map((b) => b.l));
    const width = ibh - ibl;
    if (!(width > 0)) return null;
    const mid = (ibh + ibl) / 2;
    const ibClose = ibBars[ibBars.length - 1].c;

    let hiIdx = Infinity, loIdx = Infinity;
    ibBars.forEach((b, i) => {
      if (b.h === ibh) hiIdx = Math.min(hiIdx, i);
      if (b.l === ibl) loIdx = Math.min(loIdx, i);
    });
    const first: "H" | "L" = hiIdx < loIdx ? "H" : "L";
    const bias: "H" | "L" | null = ibClose > mid ? "H" : ibClose < mid ? "L" : null;
    const bucketKey: SlimDay["widthBucket"] =
      avgAtr && avgIb
        ? width < 0.5 * avgAtr || width < 0.75 * avgIb ? "narrow"
          : width > 1.5 * avgAtr || width > 1.25 * avgIb ? "wide"
            : "normal"
        : null;

    // Inner-ORB — first close outside the 09:30–09:45 range, still inside the IB.
    const orb = ibBars.filter((b) => b.min < 585);
    let orbDir: "H" | "L" | null = null;
    if (orb.length) {
      const orbH = Math.max(...orb.map((b) => b.h));
      const orbL = Math.min(...orb.map((b) => b.l));
      for (const b of ibBars.filter((x) => x.min >= 585)) {
        if (b.c > orbH) { orbDir = "H"; break; }
        if (b.c < orbL) { orbDir = "L"; break; }
      }
    }

    // Tightest condition stack that still has a usable sample (mirrors bestSample).
    const conds: ((d: SlimDay) => boolean)[] = [];
    if (bias) conds.push((d) => d.bias === bias);
    conds.push((d) => d.first === first);
    if (bucketKey) conds.push((d) => d.widthBucket === bucketKey);
    if (orbDir) conds.push((d) => d.orbDir === orbDir);

    let group: SlimDay[] = days;
    for (let i = conds.length; i > 0; i--) {
      const sub = days.filter((d) => conds.slice(0, i).every((c) => c(d)));
      if (sub.length >= MIN_N) { group = sub; break; }
    }

    const withTouch = group.filter((d) => d.firstTouchSide);
    if (!withTouch.length) return null;
    return (100 * withTouch.filter((d) => d.firstTouchSide === "H").length) / withTouch.length;
  }, [ds, candles]);
}
