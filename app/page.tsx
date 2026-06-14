"use client";

import { useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import GexChart, { type GexMode, type DataMode, type ChartMode } from "@/components/dashboard/GexChart";
import GexToolbar from "@/components/dashboard/GexToolbar";
import GexHeatmap from "@/components/dashboard/GexHeatmap";
import EsStatsLadder from "@/components/dashboard/EsStatsLadder";
import EconCalendarPanel from "@/components/dashboard/EconCalendarPanel";
import SnapshotPanel from "@/components/dashboard/SnapshotPanel";
import { computeGexSummary } from "@/lib/math/gex";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { queryExpirationCache, saveExpirationCache } from "@/lib/snapdb";
import type { ChainRow } from "@/lib/math/calculations";

type FeedTab = "signal" | "snapshot";

// ── Live data entry from dxLink WS (same shape as options-chain page) ──────────
interface LiveEntry {
  bid?: number; ask?: number; last?: number;
  iv?: number; delta?: number; gamma?: number; theta?: number; vega?: number;
  oi?: number; vol?: number;
}

// ── Strike structure (symbols + static data from REST) ────────────────────────
interface StrikeStruct {
  strike:    number;
  callSym:   string;
  putSym:    string;
  callDelta?: number; // fallback delta from REST if WS not yet populated
  putDelta?:  number;
  callGamma?: number;
  putGamma?:  number;
}

/** Build ChainRow[] by merging strike structure with live WS data. */
function buildChain(structs: StrikeStruct[], live: Record<string, LiveEntry>, spot: number): ChainRow[] {
  return structs.map(s => {
    const c = live[s.callSym] ?? {};
    const p = live[s.putSym]  ?? {};
    const callGamma  = c.gamma  ?? s.callGamma ?? 0;
    const putGamma   = p.gamma  ?? s.putGamma  ?? 0;
    const callDelta  = c.delta  ?? s.callDelta ?? 0;
    const putDelta   = p.delta  ?? s.putDelta  ?? 0;
    const callOI     = c.oi  ?? 0;
    const putOI      = p.oi  ?? 0;
    const callVolume = c.vol ?? 0;
    const putVolume  = p.vol ?? 0;
    const sp = spot || s.strike;
    // netGEX uses OI+Volume (same as calculateNetGEX "net" mode)
    const callPos   = callOI + callVolume;
    const putPos    = putOI  + putVolume;
    const callGEX   =  callGamma * callPos * sp * sp;
    const putGEX    = -putGamma  * putPos  * sp * sp;
    const netGEX    = callGEX + putGEX;
    // volGEX uses volume only
    const netVolGEX = (callGamma * callVolume - putGamma * putVolume) * sp * sp;
    const netDEX    = (callDelta * callOI  - Math.abs(putDelta) * putOI)  * sp * 100;
    const volNetDEX = (callDelta * callVolume - Math.abs(putDelta) * putVolume) * sp * 100;
    return {
      strike: s.strike, spotPrice: sp,
      callOI, putOI, callVolume, putVolume,
      callGamma, putGamma, callDelta, putDelta,
      callGEX, putGEX, netGEX, netVolGEX, netDEX, volNetDEX,
    };
  });
}

export default function OverviewPage() {
  const [chain, setChain]             = useState<ChainRow[]>([]);
  const [spotPrice, setSpotPrice]     = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [wsStatus, setWsStatus]       = useState<"connecting"|"live"|"err"|"idle">("connecting");

  // Expirations
  const [expirations, setExpirations]       = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState("");

  const [gexMode, setGexMode]             = useState<GexMode>("net");
  const [dataMode, setDataMode]           = useState<DataMode>("oi-vol");
  const [chartMode, setChartMode]         = useState<ChartMode>("line");
  const [showOI, setShowOI]               = useState(false);
  const [showDex, setShowDex]             = useState(false);
  const [showFlipCurve, setShowFlipCurve] = useState(false);
  const [feedTab, setFeedTab]             = useState<FeedTab>("snapshot");
  const [heatmapIntensity, setHeatmapIntensity] = useState(0.4);
  const [heatmapOpen, setHeatmapOpen] = useState(true);

  // Live data refs — mutated in WS handler, never trigger renders directly
  const liveRef    = useRef<Record<string, LiveEntry>>({});
  const structsRef = useRef<StrikeStruct[]>([]);
  const spotRef    = useRef(0);
  const wsRef      = useRef<WebSocket | null>(null);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subSymsRef  = useRef<string[]>([]);

  // Throttled render — rebuilds chain from live data, at most every 200ms
  const scheduleRender = useCallback(() => {
    if (renderTimer.current) return;
    renderTimer.current = setTimeout(() => {
      renderTimer.current = null;
      const built = buildChain(structsRef.current, liveRef.current, spotRef.current);
      setChain(built);
      setLastUpdated(new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false }));
      if (typeof window !== "undefined" && window.__gexAppState) {
        window.__gexAppState.chain     = built as unknown as Array<Record<string, number>>;
        window.__gexAppState.spotPrice = spotRef.current;
      }
    }, 200);
  }, []);

  // ── WebSocket connection ─────────────────────────────────────────────────────
  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL
      ? process.env.NEXT_PUBLIC_WS_URL + "/ws/dxlink"
      : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/dxlink`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus("live");
      // Always subscribe $SPX index for live spot price
      try {
        ws.send(JSON.stringify({
          type: "subscribe",
          symbols: ["$SPX", "SPX"],
          feedTypesBySymbol: { "$SPX": ["Quote", "Trade"], "SPX": ["Quote", "Trade"] },
        }));
      } catch {}
      // Re-subscribe any option symbols we already have
      const syms = subSymsRef.current;
      if (syms.length) {
        const feedTypes = syms.reduce((acc, s) => {
          acc[s] = ["Quote", "Greeks", "Summary", "Trade"];
          return acc;
        }, {} as Record<string, string[]>);
        try { ws.send(JSON.stringify({ type: "subscribe", symbols: syms, feedTypesBySymbol: feedTypes })); } catch {}
      }
    };

    ws.onmessage = (e) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type !== "FEED_DATA") return;
      const data = msg.data as unknown[];
      if (!Array.isArray(data)) return;
      let changed = false;
      data.forEach(ev => {
        const event = ev as Record<string, unknown>;
        const sym = String(event.eventSymbol ?? "");
        if (!sym) return;
        if (!liveRef.current[sym]) liveRef.current[sym] = {};
        const d = liveRef.current[sym];
        const t = event.eventType;
        if (t === "Greeks") {
          if (event.delta      != null) d.delta = event.delta as number;
          if (event.gamma      != null) d.gamma = event.gamma as number;
          if (event.theta      != null) d.theta = event.theta as number;
          if (event.vega       != null) d.vega  = event.vega  as number;
          if (event.volatility != null) d.iv    = event.volatility as number;
          changed = true;
        } else if (t === "Summary") {
          if (event.openInterest      != null) d.oi  = event.openInterest as number;
          if (event["open-interest"]  != null) d.oi  = event["open-interest"] as number;
          if (event.dayVolume         != null) d.vol = event.dayVolume as number;
          changed = true;
        } else if (t === "Quote") {
          if (event.bidPrice  != null) d.bid  = event.bidPrice  as number;
          if (event.askPrice  != null) d.ask  = event.askPrice  as number;
          changed = true;
        } else if (t === "Trade") {
          if (event.dayVolume != null && (event.dayVolume as number) > 0) d.vol  = event.dayVolume as number;
          if (event.price     != null && (event.price     as number) > 0) d.last = event.price     as number;
          changed = true;
        }
        // Update spot from $SPX / SPX index quote
        if (sym === "$SPX" || sym === "SPX") {
          const bid = Number(event.bidPrice ?? 0);
          const ask = Number(event.askPrice ?? 0);
          const last = Number(event.price ?? 0);
          const price = t === "Quote"
            ? ((bid + ask) / 2 || bid || ask)
            : t === "Trade" ? last : 0;
          if (price > 100) { spotRef.current = price; setSpotPrice(price); }
        }
      });
      if (changed) scheduleRender();
    };

    ws.onclose = () => setWsStatus("idle");
    ws.onerror = () => setWsStatus("err");

    return () => { ws.close(); };
  }, [scheduleRender]);

  // ── Load chain structure (strike list + symbols) for expiry ─────────────────
  const loadStructure = useCallback(async (expiry: string) => {
    try {
      const url = `/api/chains?ticker=SPX&expiration=${encodeURIComponent(expiry)}&range=all&awaitDX=1`;
      const res = await fetch(url);
      if (!res.ok) return;
      const json = await res.json();

      const spot = parseFloat(String(json.data?.underlyingPrice ?? 0));
      if (isFinite(spot) && spot > 100) { spotRef.current = spot; setSpotPrice(spot); }

      const items: Array<Record<string, unknown>> = json.data?.items ?? [];
      // Filter to just the selected expiry group
      const target = items.filter(i =>
        String(i["expiration-date"] ?? "").slice(0, 10) === expiry.slice(0, 10)
      );
      const groups = target.length ? target : items;

      // Build strike structure map
      const structMap = new Map<number, StrikeStruct>();
      const allSyms: string[] = [];

      groups.forEach(group => {
        const strikes = (group.strikes as Array<Record<string, unknown>>) ?? [];
        strikes.forEach(st => {
          const strike = parseFloat(String(st["strike-price"] ?? 0));
          if (!strike) return;
          if (!structMap.has(strike)) structMap.set(strike, { strike, callSym: "", putSym: "" });
          const row = structMap.get(strike)!;
          const call = st.call as Record<string, unknown> | undefined;
          const put  = st.put  as Record<string, unknown> | undefined;
          if (call) {
            const sym = String(call["streamer-symbol"] ?? "");
            if (sym) { row.callSym = sym; if (!allSyms.includes(sym)) allSyms.push(sym); }
            row.callGamma = parseFloat(String(call.gamma ?? "")) || undefined;
            row.callDelta = parseFloat(String(call.delta ?? "")) || undefined;
            // Seed live data with REST values so chart shows immediately
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
            if (sym) { row.putSym = sym; if (!allSyms.includes(sym)) allSyms.push(sym); }
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

      // Subscribe new symbols to WS
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && allSyms.length) {
        const feedTypes = allSyms.reduce((acc, s) => {
          acc[s] = ["Greeks", "Summary", "Quote", "Trade"];
          return acc;
        }, {} as Record<string, string[]>);
        try { ws.send(JSON.stringify({ type: "subscribe", symbols: allSyms, feedTypesBySymbol: feedTypes })); } catch {}
      }

      // Render immediately with REST data, then WS updates will flow in
      scheduleRender();

      // Expose for SnapButton
      if (typeof window !== "undefined") {
        window.__gexAppState = {
          chain:      [] as Array<Record<string, number>>,
          spotPrice:  spot,
          esPrice:    spot,
          expiration: expiry,
          gexFlip:    null,
        };
      }
    } catch (err) {
      console.error("[GEX page] loadStructure error:", err);
    }
  }, [scheduleRender]);

  // ── Subscribe $SPX index to WS for live spot updates ────────────────────────
  useEffect(() => {
    const trySubscribe = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({
          type: "subscribe",
          symbols: ["$SPX", "SPX"],
          feedTypesBySymbol: { "$SPX": ["Quote","Trade"], "SPX": ["Quote","Trade"] },
        }));
      } catch {}
    };
    // Try immediately and again after WS opens
    trySubscribe();
    const t = setInterval(trySubscribe, 3000);
    return () => clearInterval(t);
  }, []);

  // ── Load expirations (from cache or API) then auto-select nearest ────────────
  useEffect(() => {
    const loadExpirations = async () => {
      // Always fetch fresh from API (cache caused stale-data bugs)
      let json = await fetch("/api/gex/expirations")
        .then(r => r.json())
        .catch(() => null);

      // Fall back to cache if API fails
      if (!json) {
        json = await queryExpirationCache("SPX");
      } else {
        saveExpirationCache("SPX", [], json).catch(() => {});
      }

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── When user picks a different expiry ───────────────────────────────────────
  const handleExpiry = useCallback((exp: string) => {
    setSelectedExpiry(exp);
    liveRef.current = {}; // clear stale live data for old expiry
    loadStructure(exp).catch(() => {});
  }, [loadStructure]);

  // ── Manual refresh: reload structure + resubscribe ───────────────────────────
  const handleRefresh = useCallback(async () => {
    if (selectedExpiry) await loadStructure(selectedExpiry);
  }, [selectedExpiry, loadStructure]);

  const { trigger: hmRefresh, label: hmBtnLabel, style: hmBtnStyle } = useRefreshButton(handleRefresh);

  const summary = computeGexSummary(chain, spotPrice);

  // Keep window.__gexAppState in sync
  useEffect(() => {
    if (typeof window !== "undefined" && window.__gexAppState) {
      window.__gexAppState.gexFlip    = summary.gexFlip ?? null;
      window.__gexAppState.spotPrice  = spotPrice;
      window.__gexAppState.expiration = selectedExpiry;
    }
  }, [summary.gexFlip, spotPrice, selectedExpiry]);

  // WS status dot color
  const wsDot = wsStatus === "live" ? "#00e676" : wsStatus === "err" ? "#ef4444" : "#faad14";
  const overviewTheme = {
    "--overview-bg": "#05080d",
    "--overview-header-bg": "#070c14",
    "--overview-control-bg": "#0a0f16",
    "--overview-card-bg": "#05080d",
    "--overview-border": "#1a2a3a",
    "--overview-border-soft": "#0d1f30",
  } as CSSProperties;

  return (
    <div className="overview-root" style={{ ...overviewTheme, display: "flex", flexDirection: "row", flex: 1, minHeight: 0, overflow: "hidden", height: "100%", fontFamily: "Arial, Helvetica, sans-serif", fontWeight: 700, background: "var(--overview-bg)" }}>

      {/* ══ LEFT COLUMN: Chart (top 50%) + Bottom panels (bottom 50%) ══ */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>

        {/* TOP: Chart + toolbar */}
        <div style={{ display: "flex", flexDirection: "column", flex: "0 0 50%", minHeight: 0, overflow: "hidden" }}>
          <GexToolbar
            gexMode={gexMode}
            dataMode={dataMode}
            chartMode={chartMode}
            showOI={showOI}
            showDex={showDex}
            showFlipCurve={showFlipCurve}
            flipPoint={summary.gexFlip}
            callWall={summary.callWall}
            putWall={summary.putWall}
            netGex={summary.totalNetGEXFormatted}
            expirations={expirations}
            selectedExpiry={selectedExpiry}
            onExpiry={handleExpiry}
            onGexMode={setGexMode}
            onDataMode={setDataMode}
            onChartMode={setChartMode}
            onToggleOI={() => setShowOI(p => !p)}
            onToggleDex={() => setShowDex(p => !p)}
            onToggleFlip={() => setShowFlipCurve(p => !p)}
            onRefresh={handleRefresh}
          />
          <div style={{ flex: 1, minHeight: 0, position: "relative", background: "var(--overview-bg)" }}>
            {chain.length === 0 && (
              <div style={{
                position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 12, fontSize: 12,
                color: "#3a5570", zIndex: 10,
              }}>
                <div style={{ fontSize: 24, color: "#00e5ff" }}>⬡</div>
                <div style={{ color: "#fff" }}>Connecting to dxLink stream…</div>
                <div style={{ color: "#3a5570", fontSize: 10 }}>
                  WS: <span style={{ color: wsDot }}>●</span> {wsStatus}
                </div>
              </div>
            )}
            <GexChart
              chain={chain}
              spotPrice={spotPrice}
              flipPoint={summary.gexFlip}
              mode={gexMode}
              dataMode={dataMode}
              chartMode={chartMode}
              showOI={showOI}
              showDex={showDex}
              showFlipCurve={showFlipCurve}
            />
          </div>
        </div>

        {/* BOTTOM: Calendar | ES Stats | Signal/Snapshot feed */}
        <div style={{ display: "flex", flexDirection: "row", flex: 1, minHeight: 0, borderTop: "2px solid var(--overview-border)", overflow: "hidden", background: "var(--overview-bg)" }}>

          {/* Economic Calendar */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid var(--overview-border)", overflow: "hidden", background: "var(--overview-bg)" }}>
            <EconCalendarPanel />
          </div>

          {/* ES Stats Ladder */}
          <div style={{ flex: "0 0 220px", minWidth: 180, maxWidth: 240, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid var(--overview-border)", background: "var(--overview-bg)" }}>
            <EsStatsLadder esSpot={spotPrice} />
          </div>

          {/* Signal Feed / Snapshot — tabbed */}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid var(--overview-border)", background: "var(--overview-bg)" }}>
            <div style={{ padding: "4px 10px", background: "var(--overview-header-bg)", borderBottom: "1px solid var(--overview-border)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, display: "inline-block", background: wsDot, animation: wsStatus === "live" ? "feedPulse 2s infinite" : "none" }} />
              <style>{`@keyframes feedPulse{0%,100%{opacity:1}50%{opacity:.2}}`}</style>
              <div style={{ display: "flex", gap: 2, background: "var(--overview-header-bg)", borderRadius: 2, padding: 0, flexShrink: 0 }}>
                {(["signal","snapshot"] as FeedTab[]).map(t => (
                  <button key={t} onClick={() => setFeedTab(t)} style={{
                    fontSize: 8, padding: "4px 8px", border: "none", borderRadius: 2,
                    background: feedTab === t ? "#1a2a3a" : "transparent",
                    color: feedTab === t ? "#00e5ff" : "#3a5570",
                    cursor: "pointer", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
                  }}>
                    {t === "signal" ? "SIGNAL FEED" : "SNAPSHOT"}
                  </button>
                ))}
              </div>
              {lastUpdated && (
                <span style={{ marginLeft: "auto", fontSize: 8, color: "#1e3050" }}>{lastUpdated}</span>
              )}
            </div>

            {feedTab === "signal" && (
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 6, display: "flex", flexDirection: "column", gap: 4, background: "var(--overview-bg)" }}>
                <div style={{ color: "#3a5570", fontSize: 11, textAlign: "center", marginTop: 20 }}>Signal feed loading…</div>
              </div>
            )}
            {feedTab === "snapshot" && (
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                <SnapshotPanel />
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ══ RIGHT: Collapse tab + Full-height Heatmap ══ */}
      {/* Vertical tab button on the border */}
      <div style={{ width: 16, flexShrink: 0, position: "relative", background: "var(--overview-border)", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <button
          onClick={() => setHeatmapOpen(v => !v)}
          title={heatmapOpen ? "Collapse heatmap" : "Expand heatmap"}
          style={{
            position: "absolute",
            top: "50%",
            transform: "translateY(-50%)",
            width: 16,
            height: 48,
            background: "#0d1f30",
            border: "1px solid #1e3050",
            borderRadius: 3,
            color: "#00e5ff",
            fontSize: 10,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            zIndex: 30,
          }}
        >
          {heatmapOpen ? "▶" : "◀"}
        </button>
      </div>

      <div style={{ width: heatmapOpen ? 530 : 0, minWidth: heatmapOpen ? 160 : 0, maxWidth: 900, flexShrink: 0, display: "flex", flexDirection: "column", borderLeft: heatmapOpen ? "1px solid var(--overview-border)" : "none", background: "var(--overview-bg)", overflow: "hidden", transition: "width 0.2s ease" }}>

        {/* Heatmap top controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", background: "var(--overview-control-bg)", borderBottom: "1px solid var(--overview-border)", flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: "#fff", textTransform: "uppercase", fontWeight: 700 }}>Intensity</span>
          <input
            type="range" min={0.1} max={3.0} step={0.1}
            value={heatmapIntensity}
            onChange={e => setHeatmapIntensity(Number(e.target.value))}
            style={{ flex: 1, height: 3, accentColor: "#00e5ff" }}
          />
          <span style={{ fontSize: 11, color: "#00e5ff", fontWeight: 700, minWidth: 36, fontFamily: "inherit" }}>
            {heatmapIntensity.toFixed(2)}x
          </span>
          <button onClick={hmRefresh} style={{ ...hmBtnStyle }}>
            {hmBtnLabel}
          </button>
        </div>

        {/* Heatmap secondary toolbar with GEX summary */}
        <div style={{ display: "none", gap: 6, alignItems: "center", background: "var(--overview-header-bg)", borderBottom: "1px solid var(--overview-border)", padding: "3px 8px", flexShrink: 0 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#00e5ff", textTransform: "uppercase", letterSpacing: "0.1em" }}>GEX Heatmap</span>
          {selectedExpiry && <span style={{ fontSize: 8, color: "#faad14", fontFamily: "inherit" }}>{selectedExpiry}</span>}
          {spotPrice > 0 && (
            <div style={{ marginLeft: "auto", display: "flex", gap: 10, fontSize: 9, fontFamily: "inherit" }}>
              <span style={{ color: "#3a5570" }}>Flip: <b style={{ color: "#faad14" }}>{summary.gexFlip?.toFixed(0) ?? "—"}</b></span>
              <span style={{ color: "#3a5570" }}>CW: <b style={{ color: "#22c55e" }}>{summary.callWall?.toLocaleString() ?? "—"}</b></span>
              <span style={{ color: "#3a5570" }}>PW: <b style={{ color: "#f97316" }}>{summary.putWall?.toLocaleString() ?? "—"}</b></span>
              <span style={{ color: "#3a5570" }}>Net: <b style={{ color: summary.isPositiveGamma ? "#00e676" : "#ef4444" }}>{summary.totalNetGEXFormatted}</b></span>
            </div>
          )}
        </div>

        {/* Heatmap body */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          <GexHeatmap chain={chain} spotPrice={spotPrice} dataMode={dataMode} intensity={heatmapIntensity} window={20} />
        </div>
      </div>
    </div>
  );
}
