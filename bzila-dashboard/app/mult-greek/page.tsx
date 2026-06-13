"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { queryExpirationCache, saveExpirationCache } from "@/lib/snapdb";

// ── Constants ─────────────────────────────────────────────────────────────────

const TICKERS = ["SPX", "SPY", "QQQ"] as const;
type Ticker = typeof TICKERS[number];

const NET_COLS  = ["gex", "dex", "chex", "vex"] as const;
type NetCol = typeof NET_COLS[number];

const COL_LABELS: Record<NetCol, string> = {
  gex: "NET GEX", dex: "NET DEX", chex: "NET CHEX", vex: "NET VEX",
};

const STRIKES_PER_SIDE = 25;
const GRID_COLS = "64px 1fr 1fr 1fr 1fr";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LiveEntry {
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  oi?: number;
  vol?: number;
  bid?: number;
  ask?: number;
  _ws?: boolean;
}

interface StrikeRow {
  strike: number;
  callSym: string | null;
  putSym: string | null;
}

interface ComputedRow {
  strike: number;
  isATM: boolean;
  gex: number;
  dex: number;
  chex: number;
  vex: number;
}

interface ComputedResult {
  rows: ComputedRow[];
  maxAbs: Record<NetCol, number>;
  top3: Record<NetCol, Record<number, number>>;
  atmStrike: number;
}

interface Expiry {
  date: string;
  daysTo: number;
  label: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayETStr(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const m: Record<string, string> = {};
  parts.forEach(p => { m[p.type] = p.value; });
  return `${m.year}-${m.month}-${m.day}`;
}

function daysTo(dateStr: string): number {
  return Math.round((new Date(dateStr).getTime() - new Date(todayETStr()).getTime()) / 86400000);
}

function etTimeNow(): string {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function isMarketOpen(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(new Date());
  const m: Record<string, string> = {};
  parts.forEach(p => { m[p.type] = p.value; });
  if (m.weekday === "Sat" || m.weekday === "Sun") return false;
  const mins = parseInt(m.hour) * 60 + parseInt(m.minute);
  return mins >= 570 && mins < 960;
}

function fmtMoney(v: number): { sign: string; value: string } {
  const n = parseFloat(String(v));
  if (!isFinite(n) || n === 0) return { sign: "", value: "--" };
  const s = n >= 0 ? "+" : "-";
  const a = Math.abs(n);
  return { sign: s, value: "$" + (a / 1e6).toFixed(2) + "M" };
}

function metricBg(value: number, maxValue: number, topRank: number, intensity: number): string {
  const n = parseFloat(String(value)) || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return "transparent";
  const pos = n >= 0;
  if (topRank === 1) return pos ? "rgba(41,182,246,0.90)" : "rgba(255,71,87,0.90)";
  if (topRank === 2) return pos ? "rgba(41,182,246,0.45)" : "rgba(255,71,87,0.45)";
  if (topRank === 3) return pos ? "rgba(41,182,246,0.25)" : "rgba(255,71,87,0.25)";
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio * (intensity || 0.1), 1.4);
  const alpha = Math.min(0.18, 0.02 + eased * 0.16);
  return pos ? `rgba(41,182,246,${alpha.toFixed(2)})` : `rgba(255,71,87,${alpha.toFixed(2)})`;
}

// ── Build strikes from chain JSON ─────────────────────────────────────────────

function buildStrikes(expGroups: unknown[], liveData: Record<string, LiveEntry>): StrikeRow[] {
  const map: Record<string, StrikeRow> = {};
  (expGroups as { strikes?: unknown[] }[]).forEach(expGroup => {
    (expGroup.strikes || []).forEach((item: unknown) => {
      const it = item as Record<string, unknown>;
      const strike = parseFloat(String(it["strike-price"] || 0));
      if (!strike) return;
      const key = strike.toFixed(2);
      if (!map[key]) map[key] = { strike, callSym: null, putSym: null };
      const r = map[key];
      for (const side of ["call", "put"] as const) {
        const o = it[side] as Record<string, unknown> | undefined;
        if (!o) continue;
        const sym = String(o["streamer-symbol"] || o.symbol || "");
        if (side === "call") r.callSym = sym; else r.putSym = sym;
        if (sym && !(liveData[sym]?._ws)) {
          liveData[sym] = {
            iv:    parseFloat(String(o["implied-volatility"])) || undefined,
            delta: parseFloat(String(o.delta)) || undefined,
            gamma: parseFloat(String(o.gamma)) || undefined,
            theta: parseFloat(String(o.theta)) || undefined,
            vega:  parseFloat(String(o.vega))  || undefined,
            oi:    parseInt(String(o["open-interest"] || o.openInterest || 0), 10) || 0,
            vol:   parseInt(String(o.volume || 0), 10) || 0,
          };
        }
      }
    });
  });
  return Object.values(map).sort((a, b) => a.strike - b.strike);
}

function computeRows(
  strikes: StrikeRow[],
  liveData: Record<string, LiveEntry>,
  spot: number,
  contractMode: "oivol" | "vol",
): ComputedResult {
  let rows = strikes.slice().sort((a, b) => b.strike - a.strike);
  let atmStrike = 0;
  if (spot > 0 && rows.length) {
    let atmIdx = 0, minDist = Infinity;
    rows.forEach((r, i) => {
      const d = Math.abs(r.strike - spot);
      if (d < minDist) { minDist = d; atmIdx = i; }
    });
    atmStrike = rows[atmIdx].strike;
    let start = Math.max(0, atmIdx - STRIKES_PER_SIDE);
    let end   = Math.min(rows.length, atmIdx + STRIKES_PER_SIDE + 1);
    const want = STRIKES_PER_SIDE * 2 + 1;
    if (end - start < want) {
      if (start === 0) end = Math.min(rows.length, want);
      else if (end === rows.length) start = Math.max(0, rows.length - want);
    }
    rows = rows.slice(start, end);
  }

  const out: ComputedRow[] = rows.map(r => {
    const cd = liveData[r.callSym ?? ""] || {};
    const pd = liveData[r.putSym  ?? ""] || {};
    const volOnly = contractMode === "vol";
    const cc = (volOnly ? 0 : (cd.oi ?? 0)) + (cd.vol ?? 0);
    const pc = (volOnly ? 0 : (pd.oi ?? 0)) + (pd.vol ?? 0);
    return {
      strike: r.strike,
      isATM: r.strike === atmStrike,
      gex:  ((cd.gamma ?? 0) * cc - (pd.gamma ?? 0) * pc) * spot * spot * 0.01 * 100,
      dex:  (Math.abs(cd.delta ?? 0) * cc - Math.abs(pd.delta ?? 0) * pc) * spot * 100,
      chex: (-(cd.theta ?? 0) * cc + (pd.theta ?? 0) * pc) * spot * 100,
      vex:  ((cd.vega ?? 0) * cc - (pd.vega ?? 0) * pc) * spot * 100,
    };
  });

  const maxAbs = { gex: 1, dex: 1, chex: 1, vex: 1 } as Record<NetCol, number>;
  out.forEach(r => {
    NET_COLS.forEach(c => { if (Math.abs(r[c]) > maxAbs[c]) maxAbs[c] = Math.abs(r[c]); });
  });

  const top3 = {} as Record<NetCol, Record<number, number>>;
  NET_COLS.forEach(c => {
    top3[c] = {};
    [...out].sort((a, b) => Math.abs(b[c]) - Math.abs(a[c]))
      .slice(0, 3)
      .forEach((row, idx) => { top3[c][row.strike] = idx + 1; });
  });

  return { rows: out, maxAbs, top3, atmStrike };
}

function computeTotals(
  strikes: StrikeRow[],
  liveData: Record<string, LiveEntry>,
  spot: number,
  contractMode: "oivol" | "vol",
): Record<NetCol, number> {
  const totals = { gex: 0, dex: 0, chex: 0, vex: 0 } as Record<NetCol, number>;
  const volOnly = contractMode === "vol";
  strikes.forEach(r => {
    const cd = liveData[r.callSym ?? ""] || {};
    const pd = liveData[r.putSym  ?? ""] || {};
    const cc = (volOnly ? 0 : (cd.oi ?? 0)) + (cd.vol ?? 0);
    const pc = (volOnly ? 0 : (pd.oi ?? 0)) + (pd.vol ?? 0);
    totals.gex  += ((cd.gamma ?? 0) * cc - (pd.gamma ?? 0) * pc) * spot * spot * 0.01 * 100;
    totals.dex  += (Math.abs(cd.delta ?? 0) * cc - Math.abs(pd.delta ?? 0) * pc) * spot * 100;
    totals.chex += (-(cd.theta ?? 0) * cc + (pd.theta ?? 0) * pc) * spot * 100;
    totals.vex  += ((cd.vega ?? 0) * cc - (pd.vega ?? 0) * pc) * spot * 100;
  });
  return totals;
}

// ── Ticker Panel ──────────────────────────────────────────────────────────────

function TickerPanel({
  ticker, strikes, liveData, spot, contractMode, intensity,
}: {
  ticker: Ticker;
  strikes: StrikeRow[];
  liveData: Record<string, LiveEntry>;
  spot: number;
  contractMode: "oivol" | "vol";
  intensity: number;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  const computed = strikes.length
    ? computeRows(strikes, liveData, spot, contractMode)
    : null;

  const totals = strikes.length && spot > 0
    ? computeTotals(strikes, liveData, spot, contractMode)
    : null;

  // Auto-scroll to ATM
  useEffect(() => {
    if (!bodyRef.current || !computed?.atmStrike || userScrolledRef.current) return;
    const el = bodyRef.current.querySelector(`[data-strike="${computed.atmStrike}"]`) as HTMLElement | null;
    if (el) {
      const top = el.offsetTop - bodyRef.current.clientHeight / 2 + el.offsetHeight / 2;
      bodyRef.current.scrollTop = Math.max(0, top);
    }
  });

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const mark = () => { userScrolledRef.current = true; };
    body.addEventListener("wheel", mark, { passive: true });
    body.addEventListener("touchstart", mark, { passive: true });
    return () => { body.removeEventListener("wheel", mark); body.removeEventListener("touchstart", mark); };
  }, []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: "#0d1117", border: "1px solid #1e3050", borderRadius: 6, overflow: "hidden" }}>

      {/* Panel header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#111822", borderBottom: "1px solid #2a4060", flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#00e5ff", letterSpacing: "0.1em", fontFamily: "Arial" }}>{ticker}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#00e5ff", fontFamily: "monospace" }}>
          {spot > 0 ? spot.toFixed(2) : "--"}
        </span>
      </div>

      {/* Column headers */}
      <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, background: "#111822", borderBottom: "2px solid #2a4060", flexShrink: 0 }}>
        <div style={{ padding: "5px 4px", textAlign: "center", color: "#e4e4e7", fontFamily: "Arial", fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>STRIKE</div>
        {NET_COLS.map(c => (
          <div key={c} style={{ padding: "5px 4px", textAlign: "center", color: "#a78bfa", fontFamily: "Arial", fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>{COL_LABELS[c]}</div>
        ))}
      </div>

      {/* Totals row */}
      <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, background: "#0a1220", borderBottom: "2px solid #2a4060", flexShrink: 0 }}>
        <div style={{ padding: "4px 4px", fontSize: 9, fontWeight: 800, textAlign: "center", color: "#475569", fontFamily: "Arial", letterSpacing: "0.06em" }}>TOTAL</div>
        {NET_COLS.map(c => {
          const v = totals?.[c] ?? 0;
          const fmt = totals ? fmtMoney(v) : { sign: "", value: "--" };
          return (
            <div key={c} style={{
              padding: "4px 4px", fontSize: 10, fontWeight: 800, fontFamily: "monospace",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              textAlign: "center",
              color: v > 0 ? "#29b6f6" : v < 0 ? "#ff4757" : "#94a3b8",
            }}>
              <span style={{ color: v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : "#ffffff" }}>{fmt.sign}</span>{fmt.value}
            </div>
          );
        })}
      </div>

      {/* Body */}
      <div ref={bodyRef} style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {!computed ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, fontSize: 11, color: "#475569", fontFamily: "Arial" }}>
            Select an expiry and click GO
          </div>
        ) : computed.rows.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, fontSize: 11, color: "#475569", fontFamily: "Arial" }}>
            No strikes in range
          </div>
        ) : computed.rows.map(r => {
          const strikeColor = r.isATM ? "#ffb300" : "#94a3b8";
          const rowBg = r.isATM ? "rgba(255,179,0,.07)" : "transparent";
          const rowBorder = r.isATM ? "1px solid rgba(255,179,0,.25)" : "1px solid rgba(30,48,80,.35)";
          return (
            <div
              key={r.strike}
              data-strike={r.strike}
              style={{ display: "grid", gridTemplateColumns: GRID_COLS, background: rowBg, borderBottom: rowBorder }}
            >
              <div style={{
                padding: "4px 4px", fontSize: 11, fontWeight: 800, fontFamily: "monospace",
                textAlign: "center", color: strikeColor, borderRight: "1px solid rgba(255,255,255,.06)",
                background: r.isATM ? "rgba(255,179,0,.12)" : "transparent",
              }}>
                {Number.isInteger(r.strike) ? r.strike : r.strike.toFixed(2)}
              </div>
              {NET_COLS.map(c => {
                const topRank = (computed.top3[c]?.[r.strike]) || 0;
                const weight = topRank === 1 ? 900 : topRank ? 800 : 700;
                const border = topRank === 1
                  ? `outline:1px solid ${r[c] >= 0 ? "rgba(41,182,246,.9)" : "rgba(255,71,87,.9)"};outline-offset:-1px`
                  : "";
                const formatted = fmtMoney(r[c]);
                const signColor = r[c] > 0 ? "#22c55e" : r[c] < 0 ? "#ef4444" : "#ffffff";
                return (
                  <div key={c} style={{
                    padding: "4px 4px", fontSize: 11, fontFamily: "monospace",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    textAlign: "center", color: "#ffffff",
                    background: metricBg(r[c], computed.maxAbs[c], topRank, intensity),
                    fontWeight: weight,
                    ...(topRank === 1 ? { outline: `1px solid ${r[c] >= 0 ? "rgba(41,182,246,.9)" : "rgba(255,71,87,.9)"}`, outlineOffset: "-1px", position: "relative", zIndex: 1 } : {}),
                  }}>
                    <span style={{ color: signColor }}>{formatted.sign}</span>{formatted.value}
                  </div>
                );
                void border;
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MultGreekPage() {
  const [expirations, setExpirations] = useState<Expiry[]>([]);
  const [activeExpiry, setActiveExpiry] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [contractMode, setContractMode] = useState<"oivol" | "vol">("oivol");
  const [intensity, setIntensity] = useState(0.4);
  const [status, setStatus] = useState<{ state: "live" | "loading" | "err" | "idle"; msg: string }>({ state: "idle", msg: "READY" });
  const [lastUpdate, setLastUpdate] = useState("");

  // Per-ticker state
  const [strikes, setStrikes]   = useState<Record<Ticker, StrikeRow[]>>({ SPX: [], SPY: [], QQQ: [] });
  const [spots, setSpots]       = useState<Record<Ticker, number>>({ SPX: 0, SPY: 0, QQQ: 0 });
  const liveDataRef = useRef<Record<string, LiveEntry>>({});

  // WS ref
  const wsRef = useRef<WebSocket | null>(null);
  const loadTokenRef = useRef(0);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [renderTick, setRenderTick] = useState(0);

  const scheduleRender = useCallback(() => {
    if (renderTimerRef.current) return;
    renderTimerRef.current = setTimeout(() => {
      renderTimerRef.current = null;
      setRenderTick(t => t + 1);
      setLastUpdate(etTimeNow());
    }, 150);
  }, []);

  // Fetch expirations (from cache or API)
  useEffect(() => {
    const loadExpirations = async () => {
      // Try cache first
      const cached = await queryExpirationCache("SPX");
      const json = cached || (await fetch("/api/expirations?ticker=SPX").then(r => r.json()).catch(() => null));

      if (!json) return;

      // Cache if we got fresh data from API
      if (!cached) {
        saveExpirationCache("SPX", [], json).catch(() => {});
      }

      const items = json.data?.items ?? [];
      const seen = new Set<string>();
      const list: Expiry[] = [];
      items.forEach((item: Record<string, unknown>) => {
        const d = String(item["expiration-date"] ?? "");
        if (!d || seen.has(d)) return;
        seen.add(d);
        const dt = daysTo(d);
        const expType = String(item["expiration-type"] ?? "").toLowerCase();
        const keep = dt <= 7 || expType === "weekly" || expType === "monthly" || new Date(d).getDay() === 5;
        if (!keep) return;
        list.push({ date: d, daysTo: dt, label: `${dt}DTE  ${d.slice(5)}` });
      });
      list.sort((a, b) => a.daysTo - b.daysTo);
      setExpirations(list);
      const dte0 = list.find(e => e.daysTo === 0) ?? list[0];
      if (dte0) { setSelectedExpiry(dte0.date); }
    };

    loadExpirations().catch(() => {});
  }, []);

  // Fetch chain for all tickers
  const loadAll = useCallback(async (expDate: string) => {
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    setStatus({ state: "loading", msg: "LOADING..." });
    setActiveExpiry(expDate);

    const results = await Promise.allSettled(
      TICKERS.map(ticker =>
        fetch(`/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(expDate)}&range=all`)
          .then(r => r.json())
          .then(json => ({ ticker, json }))
      )
    );

    if (token !== loadTokenRef.current) return;

    const newStrikes = { ...strikes };
    const newSpots   = { ...spots };

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { ticker, json } = result.value as { ticker: Ticker; json: Record<string, unknown> };
      const items = (json.data as Record<string, unknown> | undefined)?.items as unknown[] ?? [];
      const target = (items as { "expiration-date"?: string }[]).filter(i =>
        String(i["expiration-date"] ?? "").slice(0, 10) === expDate.slice(0, 10)
      );
      const parsed = buildStrikes(target.length ? target : items as unknown[], liveDataRef.current);
      newStrikes[ticker] = parsed;
      const rawSpot = parseFloat(String((json.data as Record<string, unknown> | undefined)?.underlyingPrice ?? 0));
      if (isFinite(rawSpot) && rawSpot > 0) newSpots[ticker] = rawSpot;
    }

    setStrikes(newStrikes);
    setSpots(newSpots);
    setStatus({ state: isMarketOpen() ? "live" : "idle", msg: isMarketOpen() ? "LIVE" : "CLOSED" });
    setRenderTick(t => t + 1);
    setLastUpdate(etTimeNow());
  }, [strikes, spots]);

  // Connect dxlink WS
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/dxlink`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus({ state: "live", msg: "LIVE" });
    };

    ws.onmessage = (e) => {
      if (!isMarketOpen()) return;
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
        if (!liveDataRef.current[sym]) liveDataRef.current[sym] = {};
        const d = liveDataRef.current[sym];
        d._ws = true;
        const t = event.eventType;
        if (t === "Greeks") {
          if (event.volatility != null) d.iv    = event.volatility as number;
          if (event.delta      != null) d.delta = event.delta as number;
          if (event.gamma      != null) d.gamma = event.gamma as number;
          if (event.theta      != null) d.theta = event.theta as number;
          if (event.vega       != null) d.vega  = event.vega as number;
          changed = true;
        } else if (t === "Summary") {
          if (event.openInterest != null) d.oi = event.openInterest as number;
          if (event.dayVolume    != null) d.vol = event.dayVolume as number;
          changed = true;
        } else if (t === "Trade") {
          if (event.dayVolume != null && (event.dayVolume as number) > 0) d.vol = event.dayVolume as number;
          // spot updates
          const SPOT_MAP: Record<string, Ticker> = { "$SPX": "SPX", "SPX": "SPX", "SPY": "SPY", "QQQ": "QQQ" };
          const tk = SPOT_MAP[sym];
          if (tk && (event.price as number) > 0) {
            setSpots(prev => ({ ...prev, [tk]: event.price as number }));
          }
          changed = true;
        } else if (t === "Quote") {
          d.bid = event.bidPrice as number;
          d.ask = event.askPrice as number;
          const SPOT_MAP: Record<string, Ticker> = { "$SPX": "SPX", "SPX": "SPX", "SPY": "SPY", "QQQ": "QQQ" };
          const tk = SPOT_MAP[sym];
          if (tk && (event.bidPrice as number) > 0 && (event.askPrice as number) > 0) {
            const mid = ((event.bidPrice as number) + (event.askPrice as number)) / 2;
            setSpots(prev => ({ ...prev, [tk]: mid }));
          }
          changed = true;
        }
      });
      if (changed) scheduleRender();
    };

    ws.onclose = () => setStatus({ state: "idle", msg: "DISCONNECTED" });
    ws.onerror = () => setStatus({ state: "err", msg: "WS ERR" });

    return () => { ws.close(); };
  }, [scheduleRender]);

  const doGo = useCallback(() => {
    if (!selectedExpiry) return;
    loadAll(selectedExpiry);
  }, [selectedExpiry, loadAll]);

  const doRefresh = useCallback(async () => {
    if (!activeExpiry) throw new Error("No expiry selected");
    await loadAll(activeExpiry);
  }, [activeExpiry, loadAll]);

  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(doRefresh);

  const statusColors: Record<string, string> = {
    live: "#00e676", loading: "#ffb300", err: "#ff4757", idle: "#475569",
  };

  // Suppress unused warning
  void renderTick;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#05080d", overflow: "hidden" }}>

      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
        background: "#0a0e14", borderBottom: "1px solid #1e3050", flexShrink: 0, flexWrap: "wrap",
      }}>

        {/* Status dot */}
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColors[status.state] ?? "#475569", flexShrink: 0, display: "inline-block" }} />
        <span style={{ fontSize: 9, fontWeight: 800, color: statusColors[status.state] ?? "#e4e4e7", letterSpacing: "0.1em" }}>{status.msg}</span>

        <span style={{ color: "#1e3050" }}>|</span>

        {/* Expiry select */}
        <select
          value={selectedExpiry}
          onChange={e => setSelectedExpiry(e.target.value)}
          style={{
            background: "#0a1220", color: "#e4e4e7", border: "1px solid #1e3050",
            borderRadius: 4, padding: "3px 8px", fontSize: 11, cursor: "pointer",
            fontFamily: "monospace",
          }}
        >
          <option value="">-- Expiry --</option>
          {expirations.map(exp => (
            <option key={exp.date} value={exp.date}>{exp.label}</option>
          ))}
        </select>

        {/* GO button */}
        <button
          onClick={doGo}
          disabled={!selectedExpiry}
          style={{
            padding: "3px 14px", fontSize: 10, fontWeight: 800, fontFamily: "Arial",
            background: "rgba(0,229,255,.12)", border: "1px solid rgba(0,229,255,.45)",
            color: "#00e5ff", borderRadius: 4, cursor: "pointer", letterSpacing: "0.1em",
          }}
        >
          GO
        </button>

        <span style={{ color: "#1e3050" }}>|</span>

        {/* Contract mode toggle */}
        <div style={{ display: "flex", gap: 2, background: "#070c14", borderRadius: 4, padding: 2 }}>
          {(["oivol", "vol"] as const).map(m => (
            <button
              key={m}
              onClick={() => setContractMode(m)}
              style={{
                padding: "2px 10px", fontSize: 9, fontWeight: 800, borderRadius: 3,
                border: "none", cursor: "pointer", fontFamily: "Arial",
                background: contractMode === m ? "rgba(0,229,255,.15)" : "transparent",
                color: contractMode === m ? "#00e5ff" : "#64748b",
              }}
            >
              {m === "oivol" ? "OI+VOL" : "VOL"}
            </button>
          ))}
        </div>

        <span style={{ color: "#1e3050" }}>|</span>

        {/* Intensity slider */}
        <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700 }}>Intensity</span>
        <input
          type="range" min={0.01} max={3} step={0.01}
          value={intensity}
          onChange={e => setIntensity(Number(e.target.value))}
          style={{ width: 80, height: 3, accentColor: "#00e5ff" }}
        />
        <span style={{ fontSize: 10, color: "#00e5ff", fontWeight: 700, minWidth: 36, fontFamily: "monospace" }}>
          {intensity.toFixed(2)}x
        </span>

        {/* Refresh */}
        <button onClick={trigger} style={{ marginLeft: "auto", ...btnStyle }}>{btnLabel}</button>

        {lastUpdate && (
          <span style={{ fontSize: 9, color: "#334155", fontFamily: "monospace" }}>{lastUpdate} ET</span>
        )}
      </div>

      {/* Panels */}
      <div style={{ flex: 1, display: "flex", gap: 8, padding: 8, overflow: "hidden", minHeight: 0 }}>
        {TICKERS.map(ticker => (
          <TickerPanel
            key={ticker}
            ticker={ticker}
            strikes={strikes[ticker]}
            liveData={liveDataRef.current}
            spot={spots[ticker]}
            contractMode={contractMode}
            intensity={intensity}
          />
        ))}
      </div>
    </div>
  );
}
