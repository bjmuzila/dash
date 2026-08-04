"use client";

// GreeksHomePanel — self-contained home-dashboard tab panel distilled from
// app/greeks/page.tsx. Three pieces from the full Greeks page:
//   1. The 4 live greek gauges (GEX/DEX/CHEX/VEX) with zero-cross sparklines
//      (LiveGreeksGauges) — always-on OI+Vol basis, self-connecting.
//   2. "Behavior Demonstration" detail card (BehaviorDemo, detailOnly) — the
//      live GEX/VEX/DEX/CEX regime the market is in, with core behavior, expected
//      price action, and 0DTE trading implications. No simulated-price sketch.
//      Refreshes on a 30s cadence so the regime label doesn't flip every tick.
//   3. "Skew Band" — the live SPX 0DTE skew regime (LiveSkewBand).
//
// No toolbar/nav, no basis toggle, no signals feed, no vol outcome card. Zero
// required props; fills its container.

import { useEffect, useRef, useState } from "react";
import { subscribeGex } from "@/lib/gexSocket";

// Reads `totals` off snapshot/gex frames, plus spot. Without "gex" the snapshot
// arrives with totals stripped and the panel never renders a value.
const GREEKS_TOPICS = ["gex", "spot"] as const;
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import { queryGreeksToday } from "@/lib/snapdb";
import { BehaviorDemo } from "@/components/greeks/RegimeMatrix";
import LiveSkewBand from "@/components/greeks/LiveSkewBand";
import LiveGreeksGauges from "@/components/dashboard/LiveGreeksGauges";
import StateRail from "@/components/dashboard/StateRail";

// Behavior card samples the live feed on this cadence rather than every tick.
const REFRESH_MS = 30_000;

// ── Shared type (mirrors app/greeks/page.tsx GreekPoint, trimmed) ─────────────
interface GreekPoint {
  ts: number;
  gex: number;  // billions, OI+Vol basis
  dex: number;  // billions
  chex: number; // millions
  vex: number;  // millions
  spot: number;
}

// ── totals → GreekPoint (mirrors pointFromTotals in app/greeks/page.tsx) ──────
function pointFromTotals(
  t: Record<string, number> | null | undefined,
  spotVal: number | null | undefined,
  updatedAtRaw: number | null | undefined,
): GreekPoint | null {
  if (!t) return null;
  const dexOi    = Number(t.totalDeltaCall ?? 0) + Number(t.totalDeltaPut ?? 0);
  const dexOiVol = Number(t.totalDeltaOiVol ?? dexOi);
  const vexOiVol = Number(t.totalVEXOiVol ?? Number(t.totalVEX ?? 0));
  const chexOiVol = Number(t.totalCHEXOiVol ?? Number(t.totalCHEX ?? 0));
  let ts = Number(updatedAtRaw);
  if (!Number.isFinite(ts) || ts <= 0) ts = Date.now();
  else if (ts < 1e12) ts = ts * 1000;
  const gexOiVolB = Number(t.totalGEXOiVol ?? t.totalGEX ?? 0) / 1e9;
  const snap: GreekPoint = {
    ts,
    gex: gexOiVolB,
    dex: dexOiVol / 1e9,
    chex: chexOiVol / 1e6,
    vex: vexOiVol / 1e6,
    spot: Number(spotVal ?? 0) || 0,
  };
  return (snap.gex || snap.dex || snap.chex || snap.vex) ? snap : null;
}

// ── Panel ──────────────────────────────────────────────────────────────────────
export default function GreeksHomePanel() {
  const [latest, setLatest] = useState<GreekPoint | null>(null);
  // Spot samples for the StateRail's realized-vol leg. Seeded from today's
  // persisted snapshots, then appended on each live tick that moves the price.
  const [spots, setSpots] = useState<{ ts: number; px: number }[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Seed from persisted snapshots so the card isn't blank on first paint.
  useEffect(() => {
    queryGreeksToday().then(rows => {
      if (!mountedRef.current || !rows.length) return;
      const pts: GreekPoint[] = rows.map(r => ({
        ts: Number(r.timestamp), gex: Number(r.gex), dex: Number(r.dex),
        chex: Number(r.chex), vex: Number(r.vex), spot: Number(r.price ?? 0),
      })).filter(p => Number.isFinite(p.ts) && p.ts > 0).sort((a, b) => a.ts - b.ts);
      setLatest(pts[pts.length - 1] ?? null);
      setSpots(pts.filter(p => p.spot > 0).map(p => ({ ts: p.ts, px: p.spot })));
    }).catch(() => {});
  }, []);

  // Live greeks over the shared /ws/gex socket.
  //
  // Previously this opened its OWN WebSocket, and — unlike every other consumer
  // — did so unconditionally, with no useWsLifecycle() gate. So a backgrounded
  // or idle tab kept a third connection to the broadcast alive purely for a card
  // nobody was looking at. Now it subscribes to lib/gexSocket behind the same
  // bandwidth gate as everyone else; the shared socket's replay hands us the
  // last snapshot immediately, so the card still fills on mount.
  const shouldConnect = useWsLifecycle();
  useEffect(() => {
    const state: { totals: Record<string, number> | null; spot: number | null; updatedAt: number } =
      { totals: null, spot: null, updatedAt: 0 };

    const tryApply = () => {
      if (!state.totals || !mountedRef.current) return;
      const snap = pointFromTotals(state.totals, state.spot, state.updatedAt || Date.now());
      if (snap) setLatest(snap);
    };

    const handle = (m: Record<string, unknown>) => {
      const type = String(m.type ?? "");
      const d = (m.data && typeof m.data === "object" ? m.data : m) as Record<string, unknown>;
      if (type === "snapshot" || type === "gex") {
        if (d.totals) state.totals = d.totals as Record<string, number>;
        // Take spot off ANY frame that carries it — not just `snapshot`. Gating it
        // to snapshot froze spot at its seed value during a stream of `gex` deltas,
        // which zeroed realized vol in the StateRail.
        if (d.spot != null && Number(d.spot) > 0) state.spot = Number(d.spot);
        if (d.updatedAt) state.updatedAt = Number(d.updatedAt);
        tryApply();
      } else if (type === "spot") {
        if (d.spot != null) { state.spot = Number(d.spot); tryApply(); }
      }
    };

    if (!shouldConnect) return;
    return subscribeGex({ onMessage: (m) => handle(m as Record<string, unknown>), topics: GREEKS_TOPICS });
  }, [shouldConnect]);

  // ── Behavior card is sampled every 30s (not on every WS tick) so the regime
  // label stays stable. Snapshot the live reading on the interval, plus once as
  // soon as the first reading lands so it isn't blank for the first 30s. ──
  const latestRef = useRef<GreekPoint | null>(null);
  latestRef.current = latest;
  const [snap, setSnap] = useState<GreekPoint | null>(null);
  const seededRef = useRef(false);
  useEffect(() => {
    const id = setInterval(() => setSnap(latestRef.current), REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!seededRef.current && latest) { seededRef.current = true; setSnap(latest); }
  }, [latest]);

  // Append each 30s sample's spot to the RV series (regular dt = clean realized
  // vol). Dedupe on ts; cap the buffer at one RTH session of 30s bars.
  useEffect(() => {
    if (!snap || !(snap.spot > 0)) return;
    setSpots(prev => {
      const last = prev[prev.length - 1];
      if (last && Math.abs(last.ts - snap.ts) < 1_000) return prev;
      return [...prev, { ts: snap.ts, px: snap.spot }].slice(-800);
    });
  }, [snap]);

  return (
    <div style={{ width: "100%", height: "100%", overflowY: "auto", overflowX: "hidden", padding: 4 }}>
      {/* ── 0. State rail — regime / convexity / dex lean / skew + current play.
             Uses the 30s-sampled snapshot (not every tick) so the rail and the
             behavior card below it never disagree. ── */}
      <div style={{ marginBottom: 14 }}>
        <StateRail
          gex={snap?.gex ?? null}
          dex={snap?.dex ?? null}
          vex={snap?.vex ?? null}
          spots={spots}
          hasData={!!snap}
        />
      </div>

      {/* ── 1. The 4 live greek gauges (GEX/DEX/CHEX/VEX) ── */}
      <div style={{ marginBottom: 14 }}>
        <LiveGreeksGauges />
      </div>

      {/* ── 2. Live regime behavior card (no simulated-price sketch) ── */}
      <BehaviorDemo
        detailOnly
        gex={snap?.gex ?? null}
        dex={snap?.dex ?? null}
        chex={snap?.chex ?? null}
        vex={snap?.vex ?? null}
        hasData={!!snap}
      />

      {/* ── 3. Live skew band (the SPX 0DTE regime we're currently in) ── */}
      <div style={{ marginTop: 14 }}>
        <LiveSkewBand />
      </div>
    </div>
  );
}
