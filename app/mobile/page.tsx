"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import GexChart, { type GexMode, type DataMode } from "@/components/dashboard/GexChart";
import GexHeatmap from "@/components/dashboard/GexHeatmap";
import { computeGexSummary } from "@/lib/calculations/gex";
import type { ChainRow } from "@/lib/calculations/calculations";

interface LiveEntry {
  bid?: number; ask?: number; last?: number;
  iv?: number; delta?: number; gamma?: number; theta?: number; vega?: number;
  oi?: number; vol?: number;
}

interface StrikeStruct {
  strike: number;
  callSym: string;
  putSym: string;
  callDelta?: number;
  putDelta?: number;
  callGamma?: number;
  putGamma?: number;
}

function buildChain(structs: StrikeStruct[], live: Record<string, LiveEntry>, spot: number): ChainRow[] {
  return structs.map(s => {
    const c = live[s.callSym] ?? {};
    const p = live[s.putSym] ?? {};
    const callGamma = c.gamma ?? s.callGamma ?? 0;
    const putGamma = p.gamma ?? s.putGamma ?? 0;
    const callDelta = c.delta ?? s.callDelta ?? 0;
    const putDelta = p.delta ?? s.putDelta ?? 0;
    const callOI = c.oi ?? 0;
    const putOI = p.oi ?? 0;
    const callVolume = c.vol ?? 0;
    const putVolume = p.vol ?? 0;
    const sp = spot || s.strike;
    const callPos = callOI + callVolume;
    const putPos = putOI + putVolume;
    const callGEX = callGamma * callPos * sp * sp;
    const putGEX = -putGamma * putPos * sp * sp;
    const netGEX = callGEX + putGEX;
    const netVolGEX = (callGamma * callVolume - putGamma * putVolume) * sp * sp;
    const netDEX = (callDelta * callOI - Math.abs(putDelta) * putOI) * sp * 100;
    const volNetDEX = (callDelta * callVolume - Math.abs(putDelta) * putVolume) * sp * 100;
    return {
      strike: s.strike,
      spotPrice: sp,
      callOI,
      putOI,
      callVolume,
      putVolume,
      callGamma,
      putGamma,
      callDelta,
      putDelta,
      callGEX,
      putGEX,
      netGEX,
      netVolGEX,
      netDEX,
      volNetDEX,
    };
  });
}

type ViewMode = "heatmap" | "chart";

export default function MobileGexPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("heatmap");
  const [dataMode, setDataMode] = useState<DataMode>("oi-vol");
  const [chain, setChain] = useState<ChainRow[]>([]);
  const [spotPrice, setSpotPrice] = useState(0);
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [expirations, setExpirations] = useState<string[]>([]);
  const [wsStatus, setWsStatus] = useState<"connecting" | "live" | "err" | "idle">("connecting");
  const [gexProfile, setGexProfile] = useState<{ levels: number[]; values: number[]; flipPoint: number | null } | null>(null);

  const liveRef = useRef<Record<string, LiveEntry>>({});
  const structsRef = useRef<StrikeStruct[]>([]);
  const spotRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subSymsRef = useRef<string[]>([]);

  const scheduleRender = useCallback(() => {
    if (renderTimer.current) return;
    renderTimer.current = setTimeout(() => {
      renderTimer.current = null;
      const built = buildChain(structsRef.current, liveRef.current, spotRef.current);
      setChain(built);
      if (typeof window !== "undefined" && window.__gexAppState) {
        window.__gexAppState.chain = built as unknown as Array<Record<string, number>>;
        window.__gexAppState.spotPrice = spotRef.current;
      }
    }, 200);
  }, []);


  const loadStructure = useCallback(
    async (expiry: string) => {
      try {
        const url = `/api/chains?ticker=SPX&expiration=${encodeURIComponent(expiry)}&range=all&strikeWindow=20`;
        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json();

        const spot = parseFloat(String(json.data?.underlyingPrice ?? 0));
        if (isFinite(spot) && spot > 100) {
          spotRef.current = spot;
          setSpotPrice(spot);
        }

        const items: Array<Record<string, unknown>> = json.data?.items ?? [];
        const target = items.filter((i) => String(i["expiration-date"] ?? "").slice(0, 10) === expiry.slice(0, 10));
        if (!target.length) {
          console.warn(`[Mobile GEX] No matching expiry for ${expiry}, skipping load`);
          return;
        }

        const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        const is0DTE = expiry.slice(0, 10) === today;
        console.log(`[Mobile GEX] Loading ${is0DTE ? "0DTE (all strikes)" : "DTE (capped window)"}: ${expiry}`);

        const groups = target;

        const structMap = new Map<number, StrikeStruct>();
        const allSyms: string[] = [];

        groups.forEach((group) => {
          let strikes = (group.strikes as Array<Record<string, unknown>>) ?? [];

          if (!is0DTE && spotRef.current > 0) {
            strikes = strikes.filter((st) => {
              const strike = parseFloat(String(st["strike-price"] ?? 0));
              return Math.abs(strike - spotRef.current) <= 50;
            });
          }

          strikes.forEach((st) => {
            const strike = parseFloat(String(st["strike-price"] ?? 0));
            if (!strike) return;
            if (!structMap.has(strike)) structMap.set(strike, { strike, callSym: "", putSym: "" });
            const row = structMap.get(strike)!;
            const call = st.call as Record<string, unknown> | undefined;
            const put = st.put as Record<string, unknown> | undefined;
            if (call) {
              const sym = String(call["streamer-symbol"] ?? "");
              if (sym) {
                row.callSym = sym;
                if (!allSyms.includes(sym)) allSyms.push(sym);
              }
              row.callGamma = parseFloat(String(call.gamma ?? "")) || undefined;
              row.callDelta = parseFloat(String(call.delta ?? "")) || undefined;
              if (sym && !liveRef.current[sym]) liveRef.current[sym] = {};
              if (sym) {
                const d = liveRef.current[sym];
                if (call.gamma != null) d.gamma = Math.abs(parseFloat(String(call.gamma)));
                if (call.delta != null) d.delta = parseFloat(String(call.delta));
                const oi = Number(call["open-interest"] ?? call.openInterest ?? 0);
                if (oi > 0) d.oi = oi;
                const vol = Number(call.volume ?? 0);
                if (vol > 0) d.vol = vol;
              }
            }
            if (put) {
              const sym = String(put["streamer-symbol"] ?? "");
              if (sym) {
                row.putSym = sym;
                if (!allSyms.includes(sym)) allSyms.push(sym);
              }
              row.putGamma = parseFloat(String(put.gamma ?? "")) || undefined;
              row.putDelta = parseFloat(String(put.delta ?? "")) || undefined;
              if (sym && !liveRef.current[sym]) liveRef.current[sym] = {};
              if (sym) {
                const d = liveRef.current[sym];
                if (put.gamma != null) d.gamma = Math.abs(parseFloat(String(put.gamma)));
                if (put.delta != null) d.delta = parseFloat(String(put.delta));
                const oi = Number(put["open-interest"] ?? put.openInterest ?? 0);
                if (oi > 0) d.oi = oi;
                const vol = Number(put.volume ?? 0);
                if (vol > 0) d.vol = vol;
              }
            }
          });
        });

        const structs = [...structMap.values()].sort((a, b) => a.strike - b.strike);
        structsRef.current = structs;
        subSymsRef.current = allSyms;

        console.log(`[Mobile GEX] Loaded ${structs.length} strikes, subscribing to ${allSyms.length} symbols`);

        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN && allSyms.length) {
          const feedTypes = allSyms.reduce((acc, s) => {
            acc[s] = ["Greeks", "Summary", "Quote", "Trade"];
            return acc;
          }, {} as Record<string, string[]>);
          try {
            ws.send(JSON.stringify({ type: "subscribe", symbols: allSyms, feedTypesBySymbol: feedTypes }));
          } catch {}
        }

        scheduleRender();

        if (typeof window !== "undefined") {
          window.__gexAppState = {
            chain: [] as Array<Record<string, number>>,
            spotPrice: spot,
            esPrice: spot,
            expiration: expiry,
            gexFlip: null,
          };
        }
      } catch (err) {
        console.error("[Mobile GEX] loadStructure error:", err);
      }
    },
    [scheduleRender]
  );

  useEffect(() => {
    const trySubscribe = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(
          JSON.stringify({
            type: "subscribe",
            symbols: ["$SPX", "SPX"],
            feedTypesBySymbol: { $SPX: ["Quote", "Trade"], SPX: ["Quote", "Trade"] },
          })
        );
      } catch {}
    };
    trySubscribe();
    const t = setInterval(trySubscribe, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const loadExpirations = async () => {
      let json = await fetch("/api/gex/expirations")
        .then((r) => r.json())
        .catch(() => null);

      if (!json) return;

      const exps: string[] = Array.isArray((json as { expirations?: unknown }).expirations)
        ? ((json as { expirations?: string[] }).expirations ?? [])
        : [];
      setExpirations(exps);
      if (exps.length) {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        const initial = exps.includes(today) ? today : exps[0];
        setSelectedExpiry(initial);
        loadStructure(initial).catch(() => {});
      }
    };

    loadExpirations().catch(() => {});
  }, [loadStructure]);

  const handleExpiry = useCallback(
    (exp: string) => {
      setSelectedExpiry(exp);
      liveRef.current = {};
      loadStructure(exp).catch(() => {});
    },
    [loadStructure]
  );

  useEffect(() => {
    if (!selectedExpiry) return;
    let cancelled = false;
    const url = `/api/gex${selectedExpiry ? `?expiry=${encodeURIComponent(selectedExpiry)}` : ""}`;
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json?.profile) setGexProfile(json.profile);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedExpiry]);

  const summary = computeGexSummary(chain, spotPrice);

  useEffect(() => {
    if (typeof window !== "undefined" && window.__gexAppState) {
      window.__gexAppState.gexFlip = summary.gexFlip ?? null;
      window.__gexAppState.spotPrice = spotPrice;
      window.__gexAppState.expiration = selectedExpiry;
    }
  }, [summary.gexFlip, spotPrice, selectedExpiry]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear all refs
      liveRef.current = {};
      structsRef.current = [];
      spotRef.current = 0;
      subSymsRef.current = [];
      if (renderTimer.current) clearTimeout(renderTimer.current);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, []);

  const wsDot = wsStatus === "live" ? "#00e676" : wsStatus === "err" ? "#ef4444" : "#faad14";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100vh",
        background: "#05080d",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontWeight: 700,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: "#070c14",
          borderBottom: "1px solid #0d1f30",
          flexShrink: 0,
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: wsDot }} />
          <select
            value={selectedExpiry}
            onChange={(e) => handleExpiry(e.target.value)}
            style={{
              background: "#0a0f16",
              border: "1px solid #1a2a3a",
              color: "#00e5ff",
              padding: "4px 8px",
              borderRadius: 2,
              fontSize: 11,
              fontWeight: 700,
              flex: 1,
              minWidth: 0,
              fontFamily: "inherit",
            }}
          >
            {expirations.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          {spotPrice > 0 && (
            <span style={{ fontSize: 11, color: "#00e5ff", fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>
              {spotPrice.toFixed(2)}
            </span>
          )}
        </div>

        {/* View mode toggle */}
        <div style={{ display: "flex", gap: 4, background: "#0a0f16", borderRadius: 2, padding: "2px", flexShrink: 0 }}>
          {(["heatmap", "chart"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: "4px 10px",
                border: "none",
                borderRadius: 2,
                background: viewMode === mode ? "#1a2a3a" : "transparent",
                color: viewMode === mode ? "#00e5ff" : "#3a5570",
                fontSize: 9,
                fontWeight: 700,
                cursor: "pointer",
                textTransform: "uppercase",
                transition: "all 0.2s ease",
                fontFamily: "inherit",
              }}
            >
              {mode === "heatmap" ? "HEAT" : "GEX"}
            </button>
          ))}
        </div>

        {/* GEX basis toggle: OI+Vol (default) / Vol only */}
        <div style={{ display: "flex", gap: 4, background: "#0a0f16", borderRadius: 2, padding: "2px", flexShrink: 0 }}>
          {([["oi-vol", "OI+V"], ["vol-only", "VOL"]] as [DataMode, string][]).map(([m, lbl]) => (
            <button
              key={m}
              onClick={() => setDataMode(m)}
              style={{
                padding: "4px 10px",
                border: "none",
                borderRadius: 2,
                background: dataMode === m ? "#1a2a3a" : "transparent",
                color: dataMode === m ? "#00e5ff" : "#3a5570",
                fontSize: 9,
                fontWeight: 700,
                cursor: "pointer",
                textTransform: "uppercase",
                transition: "all 0.2s ease",
                fontFamily: "inherit",
              }}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {chain.length === 0 ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              fontSize: 12,
              color: "#3a5570",
              zIndex: 10,
            }}
          >
            <div style={{ fontSize: 24, color: "#00e5ff" }}>⬡</div>
            <div style={{ color: "#fff" }}>Connecting…</div>
            <div style={{ color: "#3a5570", fontSize: 10 }}>
              WS: <span style={{ color: wsDot }}>●</span> {wsStatus}
            </div>
          </div>
        ) : viewMode === "heatmap" ? (
          <GexHeatmap chain={chain} spotPrice={spotPrice} dataMode={dataMode} intensity={0.8} window={20} />
        ) : (
          <GexChart
            chain={chain}
            spotPrice={spotPrice}
            flipPoint={gexProfile?.flipPoint ?? summary.gexFlip}
            gexProfile={gexProfile}
            expiry={selectedExpiry}
            mode="net"
            dataMode={dataMode}
            chartMode="line"
            showOI={false}
            showDex={false}
            showFlipCurve={false}
          />
        )}
      </div>
    </div>
  );
}
