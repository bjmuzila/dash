"use client";

// LiveSkewBand — compact live read of SPX 0DTE volatility skew for the Greeks
// home tab. Reuses the skew derivation + regime bands from SkewCalculator so
// there is a single source of truth; shows ONLY the band SPX is currently in
// (label + range + if-this / then-that), not the full 5-row matrix or the
// manual IV inputs.

import { useCallback, useEffect, useRef, useState } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { derivePick, bandFor, COLORS, type ChainRow, type SkewPick } from "@/components/greeks/SkewCalculator";

export default function LiveSkewBand() {
  const [pick, setPick] = useState<SkewPick | null>(null);
  const [feedErr, setFeedErr] = useState(false);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Same 0DTE chain feed the Vol Skew Calculator uses.
  const fetchLive = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/gex", { cache: "no-store" });
      const j = res.ok ? await res.json() : null;
      const sp = j ? derivePick(
        (Array.isArray(j.chain) ? j.chain : []) as ChainRow[],
        Number(j.spotPrice ?? 0),
        j.expiration ?? null,
      ) : null;
      if (!mounted.current) return;
      if (sp) { setPick(sp); setFeedErr(false); } else setFeedErr(true);
    } catch { if (mounted.current) setFeedErr(true); }
    finally { if (mounted.current) setLoading(false); }
  }, []);

  useEffect(() => {
    fetchLive();
    const t = setInterval(fetchLive, 60_000);
    return () => clearInterval(t);
  }, [fetchLive]);

  const skewPct = pick && pick.atm > 0 ? ((pick.put - pick.call) / pick.atm) * 100 : null;
  const band = skewPct != null ? bandFor(skewPct) : null;
  const tone = band ? COLORS[band.tone] : "#9fb3c8";

  const rangeStr = band
    ? (band.lo === -Infinity ? "< 0%" : band.hi === Infinity ? `> ${band.lo}%` : `${band.lo}–${band.hi}%`)
    : "";

  return (
    <section style={{
      border: `1px solid ${HOME_THEME.border}`, borderRadius: 14, padding: 12,
      background: `radial-gradient(circle at 50% 0%, ${tone}14 0%, transparent 60%), rgba(13,17,25,0.45)`,
    }}>
      {/* Header: title + live status + live skew % */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 24, height: 24, borderRadius: 7, border: `1px solid ${tone}66`,
            display: "flex", alignItems: "center", justifyContent: "center", color: tone, fontWeight: 800, fontSize: 14,
          }}>◱</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#eef7ff", letterSpacing: ".03em" }}>Skew Band</div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: feedErr ? "#ff5252" : "#60a5fa" }}>
              {feedErr ? "Feed err" : loading && !pick ? "Syncing…" : "Live SPX 0DTE"}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 26, fontWeight: 900, fontFamily: "var(--font-mono)", color: tone, lineHeight: 1 }}>
            {skewPct != null ? `${skewPct >= 0 ? "+" : ""}${skewPct.toFixed(1)}%` : "--"}
          </div>
          {pick && (
            <div style={{ fontSize: 10, color: "#7e8ea0", fontFamily: "var(--font-mono)", marginTop: 2 }}>
              spot {pick.spot.toFixed(0)} · 25Δ {pick.putK}/{pick.callK}
            </div>
          )}
        </div>
      </div>

      {/* Only the band SPX is currently in */}
      {band ? (
        <div style={{ background: `${tone}12`, borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: tone }}>{band.label}</span>
            <span style={{ fontSize: 12, color: "#7e8ea0", fontFamily: "var(--font-mono)" }}>{rangeStr}</span>
          </div>
          <div style={{ fontSize: 12, color: "#c9d7db", lineHeight: 1.45, marginBottom: 5 }}>{band.ifThis}</div>
          <div style={{ fontSize: 12, color: "#d7e6e8", lineHeight: 1.5 }}>{band.thenThat}</div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#7e8ea0", padding: "10px 12px" }}>
          {feedErr ? "Skew feed unavailable." : "Awaiting live SPX 0DTE IVs…"}
        </div>
      )}
    </section>
  );
}
