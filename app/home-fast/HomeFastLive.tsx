"use client";

/**
 * Client island for /home-fast. The server already rendered the first paint
 * with live data; this component's ONLY job is to keep those numbers fresh
 * after hydration. It starts from the server-provided `initial` snapshot (so
 * there is never an empty flash) and then refreshes on an interval.
 *
 * In the real /home this role is played by the /ws/gex WebSocket. For the
 * prototype we poll the existing /api/gex endpoint to prove the pattern without
 * pulling in the full WS lifecycle hook.
 */

import { useEffect, useState } from "react";

type Snap = {
  spotPrice: number;
  callWall: number | null;
  putWall: number | null;
  gexFlip: number | null;
  totalNetGex: number | null;
  updatedAt: string | null;
};

function fmtGex(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v), s = v >= 0 ? "+" : "-";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(2)}K`;
  return `${s}$${a.toFixed(0)}`;
}

export default function HomeFastLive({ initial }: { initial: Snap }) {
  const [snap, setSnap] = useState<Snap>(initial);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/api/gex", { cache: "no-store" });
        if (!r.ok) return;
        const v = await r.json();
        if (!alive) return;
        setSnap({
          spotPrice: Number(v.spotPrice ?? 0),
          callWall: v.callWall ?? null,
          putWall: v.putWall ?? null,
          gexFlip: v.gexFlip ?? null,
          totalNetGex: v.totalNetGex ?? null,
          updatedAt: v.updatedAt ?? null,
        });
        setTick((t) => t + 1);
      } catch {
        /* keep last good values */
      }
    };
    const id = setInterval(pull, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div style={{ marginTop: 16, fontSize: 12, color: "#6b7689" }}>
      <span style={{ color: "#219EBC" }}>● live</span>{" "}
      Net GEX now {fmtGex(snap.totalNetGex)} · SPX{" "}
      {snap.spotPrice ? snap.spotPrice.toFixed(2) : "—"} · refreshed {tick}× since
      load (updates every 5s; real /home uses the WebSocket).
    </div>
  );
}
