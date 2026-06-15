"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";

// ── Constants ─────────────────────────────────────────────────────────────────

const TICKER_LIST = [
  "AAPL","ABNB","AFRM","AMD","AMZN","ARM","ASTS","AVGO","BA","BABA",
  "BYND","CCJ","CHWY","CMG","COIN","COST","CRCL","CRM","CRWD","CRWV",
  "CWVX","DJT","ETHA","FBL","FDX","FIG","GME","GOOGL","GS","HIMZ",
  "HIMS","HOOD","IBIT","INTC","IREN","IWM","LAC","LLY","LLYX","MA",
  "MARA","MCD","META","MRK","MRNA","MSFU","MSFT","MU","NDX","NFLX",
  "NIO","NKE","NNE","NOK","NVDA","NVDX","NXE","OKLO","OPEN","OSCR",
  "OXY","PDD","PFE","PLTR","PONY","PTON","QQQ","QBTS","QUBT","RBLX",
  "RGTI","RIOT","RIVN","RKLB","ROKU","RSP","SE","SLV","SMCI","SMH",
  "SNDK","SNOW","SOFI","SOUN","SOXL","SPX","SPY","TGT","TQQQ","TSM",
  "TTD","TSLA","TSLL","U","UNH","UPS","UPST","UUUU","V","XPEV","XYZ",
].sort();

const CALL_COLS = ["symbol","oi","vol","bid","ask","last","mid","iv","delta"] as const;
const PUT_COLS  = ["delta","iv","mid","last","bid","ask","vol","oi","symbol"] as const;
const NET_COLS  = ["gex","dex","chex","vex"] as const;

const COL_W: Record<string, string> = {
  symbol:"96px", oi:"70px", vol:"88px", bid:"62px", ask:"62px",
  last:"62px", mid:"62px", iv:"62px", delta:"60px",
  gex:"88px", dex:"88px", chex:"88px", vex:"88px",
};

const COL_LABELS: Record<string, string> = {
  symbol:"Symbol", oi:"OI", vol:"Vol", bid:"Bid", ask:"Ask",
  last:"Last", mid:"Mid", iv:"IV", delta:"Δ",
  gex:"NET GEX", dex:"NET DEX", chex:"NET CHEX", vex:"NET VEX",
};

function colsCSS(): string {
  const p = [...CALL_COLS.map(c => COL_W[c]), ...NET_COLS.map(c => COL_W[c]), "72px", ...PUT_COLS.map(c => COL_W[c])];
  return p.join(" ");
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface LiveEntry {
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  oi?: number;
  vol?: number;
  size?: number | null;
  _ws?: boolean;
}

interface StrikeRow {
  strike: number;
  callSym: string;
  putSym: string;
  callTT: Record<string, unknown> | null;
  putTT: Record<string, unknown> | null;
}

interface Expiry {
  date: string;
  daysTo: number;
  label: string;
  type: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayETStr(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
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
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function fp(v: number | null | undefined, d = 2): string {
  const n = parseFloat(String(v ?? ""));
  return isFinite(n) ? n.toFixed(d) : "--";
}

function fpPct(v: number | null | undefined): string {
  const n = parseFloat(String(v ?? ""));
  return isFinite(n) ? (n * 100).toFixed(1) + "%" : "--";
}

function fmtDelta(v: number | null | undefined): string {
  const n = parseFloat(String(v ?? ""));
  return isFinite(n) ? (n >= 0 ? "+" : "") + n.toFixed(3) : "--";
}

function fmtWhole(v: number | null | undefined): string {
  const n = parseFloat(String(v ?? ""));
  return isFinite(n) ? Math.round(n).toLocaleString("en-US") : "--";
}

function fmtMoney(v: number): string {
  if (!isFinite(v)) return "--";
  const s = v >= 0 ? "+" : "-";
  const a = Math.abs(v);
  return s + "$" + (a / 1e6).toFixed(2) + "M";
}

function metricBg(value: number, maxValue: number, intensity: number): string {
  const n = value || 0;
  if (!n) return "transparent";
  const ratio = Math.min(Math.abs(n) / Math.max(maxValue, 1) * (0.35 + intensity * 0.65), 1);
  const alpha = 0.08 + Math.pow(ratio, 1.45) * 0.82;
  return n >= 0
    ? `rgba(0,229,255,${alpha.toFixed(2)})`
    : `rgba(255,71,87,${alpha.toFixed(2)})`;
}

function buildStrikes(expGroups: unknown[], liveData: Record<string, LiveEntry>): StrikeRow[] {
  const map: Record<string, StrikeRow> = {};

  // First pass: collect all strikes
  (expGroups as { strikes?: unknown[] }[]).forEach(expGroup => {
    (expGroup.strikes || []).forEach((item: unknown) => {
      const it = item as Record<string, unknown>;
      const strike = parseFloat(String(it["strike-price"] || 0));
      if (!strike) return;
      const key = strike.toFixed(2);
      if (!map[key]) map[key] = { strike, callSym: "", putSym: "", callTT: null, putTT: null };
    });
  });

  // Second pass: fill data
  (expGroups as { strikes?: unknown[] }[]).forEach(expGroup => {
    (expGroup.strikes || []).forEach((item: unknown) => {
      const it = item as Record<string, unknown>;
      const strike = parseFloat(String(it["strike-price"] || 0));
      if (!strike) return;
      const key = strike.toFixed(2);
      if (!map[key]) return;
      const r = map[key];

      function sf(v: unknown): number | null { const n = parseFloat(String(v)); return isFinite(n) ? n : null; }
      function si(v: unknown): number { const n = parseInt(String(v), 10); return isFinite(n) ? n : 0; }

      const call = it.call as Record<string, unknown> | undefined;
      const put  = it.put  as Record<string, unknown> | undefined;

      if (call) {
        r.callTT  = call;
        r.callSym = String(call["streamer-symbol"] || call.symbol || "");
        if (r.callSym) liveData[r.callSym] = {
          bid: sf(call.bid), ask: sf(call.ask), last: sf(call.last),
          iv: sf(call["implied-volatility"]), delta: sf(call.delta),
          gamma: sf(call.gamma), theta: sf(call.theta), vega: sf(call.vega),
          oi: si(call["open-interest"] ?? call.openInterest ?? 0),
          vol: si(call.volume ?? 0), size: null,
        };
      }
      if (put) {
        r.putTT  = put;
        r.putSym = String(put["streamer-symbol"] || put.symbol || "");
        if (r.putSym) liveData[r.putSym] = {
          bid: sf(put.bid), ask: sf(put.ask), last: sf(put.last),
          iv: sf(put["implied-volatility"]), delta: sf(put.delta),
          gamma: sf(put.gamma), theta: sf(put.theta), vega: sf(put.vega),
          oi: si(put["open-interest"] ?? put.openInterest ?? 0),
          vol: si(put.volume ?? 0), size: null,
        };
      }
    });
  });

  const rows = Object.values(map).sort((a, b) => a.strike - b.strike);
  if (!rows.length) return rows;

  const step = 5;
  const byStrike = new Map(rows.map(r => [r.strike.toFixed(2), r] as const));
  const minStrike = rows[0].strike;
  const maxStrike = rows[rows.length - 1].strike;
  const start = Math.floor(minStrike / step) * step;
  const end = Math.ceil(maxStrike / step) * step;

  const dense: StrikeRow[] = [];
  for (let strike = start; strike <= end; strike += step) {
    const key = strike.toFixed(2);
    const existing = byStrike.get(key);
    if (existing) {
      dense.push(existing);
      continue;
    }
    dense.push({ strike, callSym: "", putSym: "", callTT: null, putTT: null });
  }

  return dense;
}

// ── Chain Table ───────────────────────────────────────────────────────────────

function ChainTable({
  strikes, liveData, spot, intensity, rangePercent, renderTick,
}: {
  strikes: StrikeRow[];
  liveData: Record<string, LiveEntry>;
  spot: number;
  intensity: number;
  rangePercent: number | "all";
  renderTick: number;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const autoCenterBlockedRef = useRef(false);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const block = () => { autoCenterBlockedRef.current = true; };
    ["wheel","touchstart","pointerdown","mousedown","scroll"].forEach(t =>
      body.addEventListener(t, block, { passive: true })
    );
    return () => {
      ["wheel","touchstart","pointerdown","mousedown","scroll"].forEach(t =>
        body.removeEventListener(t, block)
      );
    };
  }, []);

  const cols = colsCSS();

  const atmStrike = useMemo(() => {
    if (spot <= 0 || !strikes.length) return 0;
    return strikes.reduce((best, r) =>
      Math.abs(r.strike - spot) < Math.abs(best - spot) ? r.strike : best, strikes[0].strike
    );
  }, [strikes, spot]);

  // Filter strikes by range — include renderTick so re-runs when WS data arrives
  const filtered = useMemo(() => {
    const hasData = (r: StrikeRow) => {
      const cd = liveData[r.callSym] || r.callTT as LiveEntry || {};
      const pd = liveData[r.putSym]  || r.putTT  as LiveEntry || {};
      return (cd.bid ?? 0) > 0 || (cd.ask ?? 0) > 0 || (cd.last ?? 0) > 0 || (cd.oi ?? 0) > 0 || (cd.vol ?? 0) > 0
          || (pd.bid ?? 0) > 0 || (pd.ask ?? 0) > 0 || (pd.last ?? 0) > 0 || (pd.oi ?? 0) > 0 || (pd.vol ?? 0) > 0;
    };
    let rows = strikes.slice().sort((a, b) => b.strike - a.strike);
    if (rangePercent === "all") {
      const withData = rows.filter(hasData);
      if (withData.length) rows = withData;
    } else if (spot > 0) {
      const lo = spot * (1 - rangePercent / 100);
      const hi = spot * (1 + rangePercent / 100);
      const r2 = rows.filter(r => r.strike >= lo && r.strike <= hi && hasData(r));
      if (r2.length) rows = r2;
    }
    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strikes, spot, rangePercent, renderTick]);

  // Compute maxAbs for net columns
  const maxAbs = useMemo(() => {
    const m = { gex: 1, dex: 1, chex: 1, vex: 1 };
    filtered.forEach(row => {
      const cd = { ...(liveData[row.callSym] || {}), ...(liveData[row.callSym]?.bid == null ? (row.callTT as LiveEntry || {}) : {}) };
      const pd = { ...(liveData[row.putSym]  || {}), ...(liveData[row.putSym]?.bid == null  ? (row.putTT  as LiveEntry || {}) : {}) };
      const cc = (parseFloat(String(cd.oi ?? 0)) || 0) + (parseFloat(String(cd.vol ?? 0)) || 0);
      const pc = (parseFloat(String(pd.oi ?? 0)) || 0) + (parseFloat(String(pd.vol ?? 0)) || 0);
      const s = spot;
      const gex  = Math.abs(((cd.gamma ?? 0) * cc - (pd.gamma ?? 0) * pc) * s * s * 0.01 * 100);
      const dex  = Math.abs((Math.abs(cd.delta ?? 0) * cc - Math.abs(pd.delta ?? 0) * pc) * s * 100);
      const chex = Math.abs((-(cd.theta ?? 0) * cc + (pd.theta ?? 0) * pc) * s * 100);
      const vex  = Math.abs(((cd.vega ?? 0) * cc - (pd.vega ?? 0) * pc) * s * 100);
      if (gex  > m.gex)  m.gex  = gex;
      if (dex  > m.dex)  m.dex  = dex;
      if (chex > m.chex) m.chex = chex;
      if (vex  > m.vex)  m.vex  = vex;
    });
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, spot, renderTick]);

  // Auto-scroll to ATM on first load
  useEffect(() => {
    if (!bodyRef.current || !atmStrike || autoCenterBlockedRef.current) return;
    const el = bodyRef.current.querySelector(`[data-strike="${atmStrike}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ block: "center" });
  }, [atmStrike]);

  if (!strikes.length) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, fontSize: 12, color: "#475569", fontFamily: "Arial" }}>
      Select a ticker + expiry and click GO
    </div>
  );

  return (
    <div ref={bodyRef} style={{ flex: 1, overflowY: "auto", overflowX: "auto", minHeight: 0 }}>
      {filtered.map(row => {
        const isATM = row.strike === atmStrike;
        let cd = { ...(liveData[row.callSym] || {}) };
        let pd = { ...(liveData[row.putSym]  || {}) };
        // Fall back to REST snapshot if live data missing
        if (!cd.bid && !cd.ask && !cd.last && !cd.vol && !cd.oi && row.callTT)
          cd = { ...cd, ...(row.callTT as LiveEntry) };
        if (!pd.bid && !pd.ask && !pd.last && !pd.vol && !pd.oi && row.putTT)
          pd = { ...pd, ...(row.putTT as LiveEntry) };

        const s = spot;
        const cc = (parseFloat(String(cd.oi ?? 0)) || 0) + (parseFloat(String(cd.vol ?? 0)) || 0);
        const pc = (parseFloat(String(pd.oi ?? 0)) || 0) + (parseFloat(String(pd.vol ?? 0)) || 0);
        const netGex  = ((cd.gamma ?? 0) * cc - (pd.gamma ?? 0) * pc) * s * s * 0.01 * 100;
        const netDex  = (Math.abs(cd.delta ?? 0) * cc - Math.abs(pd.delta ?? 0) * pc) * s * 100;
        const netChex = (-(cd.theta ?? 0) * cc + (pd.theta ?? 0) * pc) * s * 100;
        const netVex  = ((cd.vega ?? 0) * cc - (pd.vega ?? 0) * pc) * s * 100;

        const hasAnyData = (cd.bid ?? 0) > 0 || (cd.ask ?? 0) > 0 || (cd.last ?? 0) > 0 || (cd.oi ?? 0) > 0 || (cd.vol ?? 0) > 0
          || (pd.bid ?? 0) > 0 || (pd.ask ?? 0) > 0 || (pd.last ?? 0) > 0 || (pd.oi ?? 0) > 0 || (pd.vol ?? 0) > 0;
        const netVals = { gex: netGex, dex: netDex, chex: netChex, vex: netVex };

        const mid = (cd.bid != null && cd.ask != null && isFinite(Number(cd.bid)) && isFinite(Number(cd.ask)))
          ? ((Number(cd.bid) + Number(cd.ask)) / 2) : null;
        const putMid = (pd.bid != null && pd.ask != null && isFinite(Number(pd.bid)) && isFinite(Number(pd.ask)))
          ? ((Number(pd.bid) + Number(pd.ask)) / 2) : null;

        const callData: Record<string, string | undefined> = {
          symbol: (Number.isInteger(row.strike) ? row.strike.toFixed(0) : row.strike.toFixed(2)) + " C",
          oi: fmtWhole(cd.oi), vol: fmtWhole(cd.vol),
          bid: fp(cd.bid), ask: fp(cd.ask), last: fp(cd.last),
          mid: fp(mid), iv: fpPct(cd.iv), delta: fmtDelta(cd.delta),
        };
        const putData: Record<string, string | undefined> = {
          symbol: (Number.isInteger(row.strike) ? row.strike.toFixed(0) : row.strike.toFixed(2)) + " P",
          oi: fmtWhole(pd.oi), vol: fmtWhole(pd.vol),
          bid: fp(pd.bid), ask: fp(pd.ask), last: fp(pd.last),
          mid: fp(putMid), iv: fpPct(pd.iv), delta: fmtDelta(pd.delta),
        };

        function callColor(col: string): string {
          if (col === "symbol") return "#4db8ff";
          if (col === "bid") return "#f87171";
          if (col === "ask") return "#4ade80";
          if (col === "iv") return "#7278ca";
          if (col === "delta") return (parseFloat(String(cd.delta ?? "0")) >= 0) ? "#00e676" : "#ff4757";
          if (col === "oi") return "#94a3b8";
          return "#e4e4e7";
        }
        function putColor(col: string): string {
          if (col === "symbol") return "#ff7c88";
          if (col === "bid") return "#f87171";
          if (col === "ask") return "#4ade80";
          if (col === "iv") return "#7278ca";
          if (col === "delta") return (parseFloat(String(pd.delta ?? "0")) >= 0) ? "#00e676" : "#ff4757";
          if (col === "oi") return "#94a3b8";
          return "#e4e4e7";
        }

        const rowBg = isATM
          ? { background: "rgba(255,179,0,.07)", borderTop: "1px solid rgba(255,179,0,.25)", borderBottom: "1px solid rgba(255,179,0,.25)" }
          : { borderBottom: "1px solid rgba(30,48,80,.35)" };

        return (
          <div
            key={row.strike}
            data-strike={row.strike}
            style={{ display: "grid", gridTemplateColumns: cols, ...rowBg }}
          >
            {/* Call cells */}
            {CALL_COLS.map(col => (
              <div key={col} style={{
                padding: "5px 8px", fontSize: 13, fontFamily: "monospace",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                textAlign: col === "symbol" ? "left" : "right",
                color: callColor(col),
              }}>
                {callData[col] ?? "--"}
              </div>
            ))}

            {/* Net greek cells */}
            {NET_COLS.map(col => {
              const val = netVals[col as keyof typeof netVals];
              return (
                <div key={col} style={{
                  padding: "5px 8px", fontSize: 12, fontFamily: "monospace",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  textAlign: "center", color: "#ffffff", fontWeight: 700,
                  background: hasAnyData ? metricBg(val, maxAbs[col as keyof typeof maxAbs], intensity) : "transparent",
                }}>
                  {hasAnyData ? fmtMoney(val) : "--"}
                </div>
              );
            })}

            {/* Strike */}
            <div style={{
              padding: "4px 6px", fontSize: 13, fontWeight: 800, fontFamily: "monospace",
              textAlign: "center",
              color: isATM ? "#ffb300" : "#94a3b8",
              borderLeft: "1px solid rgba(255,255,255,.06)",
              borderRight: "1px solid rgba(255,255,255,.06)",
              background: isATM ? "rgba(255,179,0,.12)" : "transparent",
            }}>
              {Number.isInteger(row.strike) ? row.strike.toFixed(0) : row.strike.toFixed(2)}
            </div>

            {/* Put cells */}
            {PUT_COLS.map(col => (
              <div key={col} style={{
                padding: "5px 8px", fontSize: 13, fontFamily: "monospace",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                textAlign: "right",
                color: putColor(col),
              }}>
                {putData[col] ?? "--"}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function OptionsChainPage() {
  const [ticker, setTicker]     = useState("SPX");
  const [activeTicker, setActiveTicker] = useState("SPX");
  const [expirations, setExpirations]   = useState<Expiry[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [activeExpiry, setActiveExpiry]     = useState("");
  const [strikes, setStrikes]   = useState<StrikeRow[]>([]);
  const [spot, setSpot]         = useState(0);
  const [intensity, setIntensity] = useState(0.4);
  const [rangePercent, setRangePercent] = useState<number | "all">(10);
  const [status, setStatus]     = useState<{ state: "live"|"loading"|"err"|"idle"; msg: string }>({ state: "idle", msg: "--" });
  const [lastUpdate, setLastUpdate] = useState("--:--:--");
  const [renderTick, setRenderTick] = useState(0);

  const liveDataRef  = useRef<Record<string, LiveEntry>>({});
  const wsRef        = useRef<WebSocket | null>(null);
  const subSymsRef   = useRef<string[]>([]);
  const loadTokenRef = useRef(0);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRender = useCallback(() => {
    if (renderTimerRef.current) return;
    renderTimerRef.current = setTimeout(() => {
      renderTimerRef.current = null;
      setRenderTick(t => t + 1);
      setLastUpdate(etTimeNow());
    }, 120);
  }, []);

  // WS connection
  useEffect(() => {
    const wsBase = process.env.NEXT_PUBLIC_WS_URL ?? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
    const ws = new WebSocket(`${wsBase}/ws/dxlink`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus({ state: "live", msg: "LIVE" });
      const syms = subSymsRef.current;
      if (syms.length) {
        const feedTypes = syms.reduce((acc, s) => { acc[s] = ["Quote","Greeks","Summary","Trade"]; return acc; }, {} as Record<string, string[]>);
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
        if (!liveDataRef.current[sym]) liveDataRef.current[sym] = {};
        const d = liveDataRef.current[sym];
        d._ws = true;
        const t = event.eventType;
        if (t === "Quote") {
          if (event.bidPrice  != null) d.bid  = event.bidPrice as number;
          if (event.askPrice  != null) d.ask  = event.askPrice as number;
          if (event.lastPrice != null) d.last = event.lastPrice as number;
          changed = true;
        } else if (t === "Greeks") {
          if (event.volatility != null) d.iv    = event.volatility as number;
          if (event.delta      != null) d.delta = event.delta as number;
          if (event.gamma      != null) d.gamma = event.gamma as number;
          if (event.theta      != null) d.theta = event.theta as number;
          if (event.vega       != null) d.vega  = event.vega as number;
          changed = true;
        } else if (t === "Summary") {
          if (event.openInterest != null) d.oi  = event.openInterest as number;
          if (event["open-interest"] != null) d.oi = event["open-interest"] as number;
          if (event.dayVolume    != null) d.vol = event.dayVolume as number;
          changed = true;
        } else if (t === "Trade") {
          if (event.dayVolume != null && (event.dayVolume as number) > 0) d.vol  = event.dayVolume as number;
          if (event.price     != null && (event.price as number)     > 0) d.last = event.price as number;
          changed = true;
        }
      });
      if (changed) scheduleRender();
    };

    ws.onclose = () => setStatus({ state: "idle", msg: "DISCONNECTED" });
    ws.onerror = () => setStatus({ state: "err",  msg: "WS ERR" });

    return () => { ws.close(); };
  }, [scheduleRender]);

  // Fetch expirations when ticker changes
  const fetchExpirations = useCallback(async (t: string) => {
    setStatus({ state: "loading", msg: "LOADING..." });
    try {
      const res = await fetch(`/api/expirations?ticker=${encodeURIComponent(t)}`);
      const json = await res.json();
      const items = json.data?.items ?? [];
      const seen = new Set<string>();
      const list: Expiry[] = [];
      items.forEach((item: Record<string, unknown>) => {
        const d = String(item["expiration-date"] ?? "");
        if (!d || seen.has(d)) return;
        seen.add(d);
        const dt = daysTo(d);
        const expType = String(item["expiration-type"] ?? "").toLowerCase();
        const holidayExcl: Record<string, boolean> = { "2026-06-19": true };
        const holidayIncl: Record<string, boolean> = { "2026-06-18": true };
        if (holidayExcl[d] && !holidayIncl[d]) return;
        const keep = dt <= 7 || holidayIncl[d] || expType === "weekly" || expType === "monthly" || new Date(d).getDay() === 5;
        if (!keep) return;
        list.push({ date: d, daysTo: dt, label: `${dt}DTE  ${d.slice(5)}`, type: expType });
      });
      list.sort((a, b) => a.daysTo - b.daysTo);
      setExpirations(list);
      const dte0 = list.find(e => e.daysTo === 0) ?? list[0];
      if (dte0) setSelectedExpiry(dte0.date);
      setStatus({ state: "idle", msg: "READY" });
    } catch {
      setStatus({ state: "err", msg: "EXPIRY ERR" });
    }
  }, []);

  // Load chain
  const loadChain = useCallback(async (t: string, expDate: string) => {
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    setStatus({ state: "loading", msg: "LOADING..." });
    setStrikes([]);

    try {
      const pageId = `options-chain-${Date.now()}`;
      const res = await fetch(`/api/chains?ticker=${encodeURIComponent(t)}&expiration=${encodeURIComponent(expDate)}&range=all&pageId=${encodeURIComponent(pageId)}`);
      if (token !== loadTokenRef.current) return;
      const json = await res.json();

      const items = json.data?.items ?? [];
      let target = items.filter((i: Record<string, unknown>) =>
        String(i["expiration-date"] ?? "").slice(0, 10) === expDate.slice(0, 10)
      );
      if (!target.length) target = items;

      // Clear old sub symbols from live data
      subSymsRef.current.forEach(sym => { delete liveDataRef.current[sym]; });

      const parsed = buildStrikes(target, liveDataRef.current);
      const rawSpot = parseFloat(String(json.data?.underlyingPrice ?? 0));
      if (isFinite(rawSpot) && rawSpot > 10) setSpot(rawSpot);

      const syms: string[] = [];
      parsed.forEach(r => {
        if (r.callSym) syms.push(r.callSym);
        if (r.putSym)  syms.push(r.putSym);
      });
      subSymsRef.current = syms;

      // Subscribe via WS
      if (wsRef.current?.readyState === 1 && syms.length) {
        const feedTypes = syms.reduce((acc, s) => { acc[s] = ["Quote","Greeks","Summary","Trade"]; return acc; }, {} as Record<string, string[]>);
        try { wsRef.current.send(JSON.stringify({ type: "subscribe", symbols: syms, feedTypesBySymbol: feedTypes })); } catch {}
      }

      // Also POST to subscribe endpoint (handles non-SPXW symbols)
      if (syms.length) {
        const feedTypes = syms.reduce((acc, s) => { acc[s] = ["Quote","Greeks","Summary","Trade"]; return acc; }, {} as Record<string, string[]>);
        fetch("/api/proxy/dxlink-subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: syms, feedTypesBySymbol: feedTypes }),
        }).catch(() => {});
      }

      setStrikes(parsed);
      setActiveExpiry(expDate);
      setActiveTicker(t);
      setRenderTick(n => n + 1);
      setLastUpdate(etTimeNow());

      // Wait for subscription-ready
      if (syms.length) {
        try {
          await fetch("/api/proxy/subscription-ready", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pageId, symbols: syms, timeout: 10000, threshold: 0.5 }),
          });
        } catch {}
      }

      if (token === loadTokenRef.current) {
        setStatus({ state: "live", msg: "LIVE" });
        setRenderTick(n => n + 1);
      }
    } catch (err) {
      if (token === loadTokenRef.current)
        setStatus({ state: "err", msg: "ERR: " + String(err).slice(0, 40) });
    }
  }, []);

  const doGo = useCallback(() => {
    const t = ticker.trim().toUpperCase() || "SPX";
    const e = selectedExpiry;
    if (!e) { setStatus({ state: "err", msg: "SELECT EXPIRY" }); return; }
    if (t !== activeTicker || !expirations.length) {
      fetchExpirations(t).then(() => {
        // expiry will be auto-selected; user should click GO again, or we auto-load
        loadChain(t, e);
      });
    } else {
      loadChain(t, e);
    }
  }, [ticker, selectedExpiry, activeTicker, expirations.length, fetchExpirations, loadChain]);

  // Bump renderTick when rangePercent changes so ChainTable filtered useMemo re-runs
  useEffect(() => { setRenderTick(t => t + 1); }, [rangePercent]);

  // Auto-fetch expirations for default ticker on mount
  useEffect(() => { fetchExpirations("SPX"); }, [fetchExpirations]);

  // Handle ticker input change → reload expirations
  const handleTickerChange = useCallback((val: string) => {
    const v = val.toUpperCase();
    setTicker(v);
    if (v.length >= 1) {
      // Debounce: don't fetch until user stops typing or selects from list
    }
  }, []);

  const handleTickerConfirm = useCallback(() => {
    const t = ticker.trim().toUpperCase();
    if (!t || t === activeTicker) return;
    fetchExpirations(t);
  }, [ticker, activeTicker, fetchExpirations]);

  const doRefresh = useCallback(async () => {
    if (!activeTicker || !activeExpiry) throw new Error("no chain loaded");
    await loadChain(activeTicker, activeExpiry);
  }, [activeTicker, activeExpiry, loadChain]);

  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(doRefresh);

  const statusColors: Record<string, string> = {
    live: "#00e676", loading: "#ffb300", err: "#ff4757", idle: "#475569",
  };

  const cols = colsCSS();
  const pageRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={pageRef} style={{ display: "flex", flexDirection: "column", height: "100%", background: "#05080d", overflow: "hidden", fontFamily: "Arial, sans-serif" }}>

      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 12px", background: "#0a0e14",
        borderBottom: "1px solid #1e3050", flexShrink: 0, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#00e5ff", letterSpacing: "0.14em", textTransform: "uppercase" }}>
          Options Chain
        </span>

        {/* Ticker input */}
        <input
          list="chain-ticker-list"
          value={ticker}
          onChange={e => handleTickerChange(e.target.value)}
          onBlur={handleTickerConfirm}
          onKeyDown={e => e.key === "Enter" && handleTickerConfirm()}
          autoComplete="off"
          spellCheck={false}
          style={{
            fontSize: 10, fontWeight: 800, padding: "4px 8px",
            border: "1px solid rgba(0,229,255,.4)", borderRadius: 4,
            background: "#0a0e14", color: "#00e5ff", fontFamily: "Arial",
            outline: "none", width: 72, textTransform: "uppercase",
          }}
        />
        <datalist id="chain-ticker-list">
          {TICKER_LIST.map(t => <option key={t} value={t} />)}
        </datalist>

        {/* Expiry select */}
        <select
          value={selectedExpiry}
          onChange={e => setSelectedExpiry(e.target.value)}
          style={{
            fontSize: 10, fontWeight: 800, padding: "4px 8px",
            border: "1px solid rgba(255,255,255,.18)", borderRadius: 4,
            background: "#0a0e14", color: "#e4e4e7",
            cursor: "pointer", fontFamily: "Arial", outline: "none",
          }}
        >
          <option value="">-- Expiry --</option>
          {expirations.map(exp => (
            <option key={exp.date} value={exp.date}>{exp.label}</option>
          ))}
        </select>

        {/* GO */}
        <button
          onClick={doGo}
          style={{
            fontSize: 10, fontWeight: 800, padding: "4px 14px",
            border: "1px solid rgba(0,229,255,.6)", borderRadius: 4,
            background: "rgba(0,229,255,.15)", color: "#00e5ff",
            cursor: "pointer", letterSpacing: "0.06em",
          }}
        >
          GO
        </button>

        {/* Range */}
        <select
          value={String(rangePercent)}
          onChange={e => setRangePercent(e.target.value === "all" ? "all" : parseFloat(e.target.value))}
          style={{
            fontSize: 10, fontWeight: 800, padding: "4px 8px",
            border: "1px solid rgba(0,229,255,.3)", borderRadius: 4,
            background: "#0a0e14", color: "#00e5ff",
            cursor: "pointer", fontFamily: "Arial", outline: "none",
          }}
        >
          {["3","5","10","15","20"].map(v => <option key={v} value={v}>±{v}%</option>)}
          <option value="all">All</option>
        </select>

        <div style={{ flex: 1 }} />

        {/* Intensity */}
        <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>Intensity</span>
        <input
          type="range" min={0.2} max={3} step={0.01}
          value={intensity}
          onChange={e => setIntensity(Number(e.target.value))}
          style={{ width: 100, accentColor: "#00e5ff", cursor: "pointer" }}
        />
        <span style={{ fontSize: 10, color: "#00e5ff", fontWeight: 700, minWidth: 36, textAlign: "right", fontFamily: "monospace" }}>
          {intensity.toFixed(2)}x
        </span>

        {/* Status / spot */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
          {activeTicker && spot > 0 && (
            <span style={{ fontSize: 11, color: "#e4e4e7", fontWeight: 700 }}>
              {activeTicker} <span style={{ color: "#00e5ff", fontFamily: "monospace" }}>{spot.toFixed(2)}</span>
            </span>
          )}
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: statusColors[status.state] ?? "#475569", transition: "background .3s" }} />
          <span style={{ fontSize: 9, color: statusColors[status.state], fontWeight: 800, letterSpacing: "0.08em" }}>{status.msg}</span>
          <span style={{ fontSize: 9, color: "#334155", fontFamily: "monospace" }}>{lastUpdate}</span>
        </div>

        {/* Refresh / Snap / Discord */}
        <button onClick={trigger} style={{ ...btnStyle }}>{btnLabel}</button>
        <BoxSnapBtn targetRef={pageRef} label="📷" />
        <BoxDiscordBtn targetRef={pageRef} message={`📊 Options Chain${activeTicker ? ` — ${activeTicker}` : ""}${activeExpiry ? ` ${activeExpiry}` : ""} — ${new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false})} ET`} />
      </div>

      {/* Column headers */}
      {strikes.length > 0 && (
        <div style={{
          display: "grid", gridTemplateColumns: cols,
          background: "#0a0f18", borderBottom: "2px solid #1e3050",
          flexShrink: 0, fontSize: 10, fontWeight: 800,
          letterSpacing: "0.1em", textTransform: "uppercase",
        }}>
          {CALL_COLS.map(c => (
            <div key={c} style={{ padding: "5px 6px", textAlign: c === "symbol" ? "left" : "right", color: "#2298cf" }}>
              {COL_LABELS[c]}
            </div>
          ))}
          {NET_COLS.map(c => (
            <div key={c} style={{ padding: "5px 6px", textAlign: "center", color: "#a78bfa" }}>
              {COL_LABELS[c]}
            </div>
          ))}
          <div style={{ padding: "5px 6px", textAlign: "center", color: "#e4e4e7" }}>Strike</div>
          {PUT_COLS.map(c => (
            <div key={c} style={{ padding: "5px 6px", textAlign: "right", color: "#ff7c88" }}>
              {COL_LABELS[c]}
            </div>
          ))}
        </div>
      )}

      {/* Chain body */}
      <ChainTable
        strikes={strikes}
        liveData={liveDataRef.current}
        spot={spot}
        intensity={intensity}
        rangePercent={rangePercent}
        renderTick={renderTick}
      />
    </div>
  );
}
