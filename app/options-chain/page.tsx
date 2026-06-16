"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoxDiscordBtn, BoxSnapBtn } from "@/components/shared/DataBox";
import { useRefreshButton } from "@/hooks/useRefreshButton";

const QUOTE_PANEL_TICKERS = [
  "VIX",
  "SPX",
  "SPCX",
  "QQQ",
  "SMH",
  "AAPL",
  "AMD",
  "AMZN",
  "GOOGL",
  "META",
  "MSFT",
  "NVDA",
  "TSLA",
];

const DISPLAY_PERCENTS = [5, 10, 15, 20, 25, 30, 50, 100] as const;
const GREEK_MODES = ["gex", "dex", "chex", "vex"] as const;
type GreekMode = typeof GREEK_MODES[number];
const CHAIN_COLUMNS = ["Strike", "Greek", "Volume", "OI"] as const;

type ChainColumn = (typeof CHAIN_COLUMNS)[number];

type MockRow = {
  strike: number;
  gex: number;
  dex: number;
  chex: number;
  vex: number;
  premium: number;
  volume: number;
  oi: number;
};

function etToday(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function etDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isHoliday(date: Date): boolean {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();

  // US market holidays (non-exhaustive, add more as needed)
  const holidays: Array<[number, number]> = [
    [1, 1],    // New Year's Day
    [7, 4],    // Independence Day
    [12, 25],  // Christmas
  ];

  // Check fixed holidays
  if (holidays.some(([m, d]) => month === m && day === d)) return true;

  // MLK Day (3rd Monday in January)
  if (month === 1) {
    const firstDay = new Date(year, 0, 1).getDay();
    const mlkDay = 15 + ((8 - firstDay) % 7);
    if (day === mlkDay) return true;
  }

  // Presidents Day (3rd Monday in February)
  if (month === 2) {
    const firstDay = new Date(year, 1, 1).getDay();
    const presDay = 15 + ((8 - firstDay) % 7);
    if (day === presDay) return true;
  }

  // Memorial Day (last Monday in May)
  if (month === 5) {
    const lastDay = new Date(year, 5, 0).getDate();
    const lastMonday = lastDay - ((new Date(year, 4, lastDay).getDay() + 1) % 7);
    if (day === lastMonday) return true;
  }

  // Labor Day (1st Monday in September)
  if (month === 9) {
    const firstDay = new Date(year, 8, 1).getDay();
    const laborDay = 1 + ((8 - firstDay) % 7);
    if (day === laborDay) return true;
  }

  // Thanksgiving (4th Thursday in November)
  if (month === 11) {
    const firstDay = new Date(year, 10, 1).getDay();
    const thanksgiving = 22 + ((5 - firstDay) % 7);
    if (day === thanksgiving) return true;
  }

  return false;
}

function isTradingDay(date: Date): boolean {
  const dayOfWeek = date.getDay();
  // Skip weekends (0 = Sunday, 6 = Saturday)
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  // Skip holidays
  if (isHoliday(date)) return false;
  return true;
}

function buildExpiries() {
  const today = etToday();
  const list: Array<{ value: string; label: string }> = [];
  let daysAdded = 0;
  let offset = 0;

  // Day abbreviations
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Find next 12 trading days
  while (daysAdded < 12 && offset < 30) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);

    if (isTradingDay(date)) {
      const value = etDateKey(date);
      const dayName = dayNames[date.getDay()];
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      list.push({ value, label: `${dayName}, ${mm}-${dd}` });
      daysAdded++;
    }

    offset++;
  }

  return list;
}

function tickerSeed(input: string) {
  return input
    .toUpperCase()
    .split("")
    .reduce((sum, ch, index) => sum + ch.charCodeAt(0) * (index + 3), 0);
}

function expirySeed(input: string) {
  return input.replaceAll("-", "").split("").reduce((sum, ch, index) => sum + Number(ch) * (index + 1), 0);
}

function fmtMoney(value: number) {
  const sign = value >= 0 ? "+" : "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtInt(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function metricBg(value: number, maxValue: number, intensity: number, topValues: number[]) {
  if (!value) return "transparent";

  const abs = Math.abs(value);
  const ratio = Math.min(abs / Math.max(maxValue, 1), 1);
  const rank = topValues.indexOf(abs) + 1;

  let opacity: number;
  if (rank === 1) {
    opacity = Math.max(0.82, intensity * 0.92);
  } else if (rank === 2) {
    opacity = Math.max(0.6, intensity * 0.78);
  } else if (rank === 3) {
    opacity = Math.max(0.4, intensity * 0.62);
  } else {
    opacity = Math.pow(ratio, 0.65) * intensity * 0.55;
  }

  const finalOpacity = Math.min(opacity, 0.95).toFixed(3);

  return value > 0
    ? `rgba(32,178,220,${finalOpacity})`
    : `rgba(220,50,60,${finalOpacity})`;
}

function buildMockRows(ticker: string, expiry: string, refreshSeed: number) {
  const seed = tickerSeed(ticker) + expirySeed(expiry) + Math.floor(refreshSeed) * 17;
  const baseSpot = ticker === "SPX" ? 6050 : ticker === "QQQ" ? 530 : ticker === "SMH" ? 290 : 100 + (seed % 240);
  const step = baseSpot > 1000 ? 5 : baseSpot > 300 ? 2.5 : 1;
  const count = 41;
  const center = Math.round(baseSpot / step) * step;
  const start = center - step * Math.floor(count / 2);

  const rows: MockRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const strike = Number((start + step * index).toFixed(step % 1 === 0 ? 0 : 2));
    const distance = index - Math.floor(count / 2);
    const wave = Math.sin((seed + index * 11) / 7.5);
    const alt = Math.cos((seed + index * 9) / 5.25);
    const decay = 1 - Math.min(Math.abs(distance) / 24, 0.82);

    rows.push({
      strike,
      gex: Math.round((wave * 5.2 + alt * 2.4) * 1_100_000 * decay),
      dex: Math.round((Math.cos((seed + index * 13) / 8.2) * 4.6 - distance * 0.11) * 760_000 * decay),
      chex: Math.round((Math.sin((seed + index * 5) / 4.1) * 3.2 + distance * 0.08) * 420_000 * decay),
      vex: Math.round((Math.cos((seed + index * 7) / 6.4) * 2.6 - Math.sin(index / 3)) * 360_000 * decay),
      premium: Math.round((850_000 + Math.abs(wave) * 2_400_000 + Math.abs(distance) * 31_000) * decay),
      volume: Math.round((1_100 + Math.abs(alt) * 6_400 + Math.abs(distance) * 120) * decay),
      oi: Math.round((3_000 + Math.abs(wave + alt) * 18_000 + Math.abs(distance) * 180) * decay),
    });
  }

  return { rows, spot: center };
}

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

export default function OptionsChainPage() {
  const expiries = useMemo(() => buildExpiries(), []);
  const [tickerInput, setTickerInput] = useState("SPX");
  const [activeTicker, setActiveTicker] = useState("SPX");
  const [selectedExpiry, setSelectedExpiry] = useState(expiries[0]?.value ?? "");
  const [displayPercent, setDisplayPercent] = useState<number>(10);
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [intensity, setIntensity] = useState(0.4);
  const [lastUpdate, setLastUpdate] = useState("--:--:--");
  const [useRealData, setUseRealData] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0); // 0-100
  const [greekMode, setGreekMode] = useState<GreekMode>("gex");
  const pageRef = useRef<HTMLDivElement>(null);

  // Live WS data ref + batched subscription
  const liveDataRef = useRef<Record<string, LiveEntry>>({});
  const strikeRowsRef = useRef<StrikeRow[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const loadTokenRef = useRef(0);
  const pageIdRef = useRef(`options-chain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  // Build strikes from chain JSON
  const buildStrikes = (expGroups: unknown[]): StrikeRow[] => {
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
          if (sym && !(liveDataRef.current[sym]?._ws)) {
            liveDataRef.current[sym] = {
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
  };

  // Load chain + batch subscribe symbols
  const loadChain = async (ticker: string, expDate: string, bustCache = false) => {
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    const pageId = pageIdRef.current;
    const bust = bustCache ? `&noCache=1` : "";

    try {
      setLoadProgress(10); // Fetching chain data
      const res = await fetch(
        `/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(expDate)}&range=all&pageId=${encodeURIComponent(pageId)}${bust}`
      );
      const json = await res.json();
      if (token !== loadTokenRef.current) return;

      const items = (json.data as Record<string, unknown> | undefined)?.items as unknown[] ?? [];
      if (!items.length) return;

      setLoadProgress(30); // Parsing strikes
      const target = (items as { "expiration-date"?: string }[]).filter(i =>
        String(i["expiration-date"] ?? "").slice(0, 10) === expDate.slice(0, 10)
      );
      const strikes = buildStrikes(target.length ? target : items as unknown[]);
      strikeRowsRef.current = strikes;

      // Extract underlying price from API response
      const underlyingPrice = parseFloat(String((json.data as Record<string, unknown> | undefined)?.underlyingPrice ?? 0));
      if (underlyingPrice > 0) {
        setUnderlyingPrice(underlyingPrice);
      }

      setLoadProgress(50); // Subscribing to symbols
      // Batch subscribe all symbols at once
      const allSymbols = new Set<string>();
      strikes.forEach(row => {
        if (row.callSym) allSymbols.add(row.callSym);
        if (row.putSym) allSymbols.add(row.putSym);
      });

      if (allSymbols.size > 0) {
        fetch("/api/proxy/subscription-ready", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageId, symbols: [...allSymbols], timeout: 6000, threshold: 0.5 }),
        }).catch(() => {}).then(() => {
          setLoadProgress(100); // Complete
          setTimeout(() => setLoadProgress(0), 1000); // Hide after 1s
        });
      } else {
        setLoadProgress(100);
        setTimeout(() => setLoadProgress(0), 1000);
      }

      setRefreshSeed(s => s + 0.01);
    } catch (err) {
      console.error(`[OptionsChain] Load failed for ${ticker}:`, err);
      setLoadProgress(0);
    }
  };

  // Connect WS for live updates
  useEffect(() => {
    const wsBase = process.env.NEXT_PUBLIC_WS_URL ?? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
    const ws = new WebSocket(`${wsBase}/ws/dxlink`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type !== "FEED_DATA") return;
      const data = msg.data as unknown[];
      if (!Array.isArray(data)) return;
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
        } else if (t === "Summary") {
          if (event.openInterest != null) d.oi = event.openInterest as number;
          if (event.dayVolume    != null) d.vol = event.dayVolume as number;
        } else if (t === "Trade") {
          if (event.dayVolume != null && (event.dayVolume as number) > 0) d.vol = event.dayVolume as number;
        }
      });
      setRefreshSeed(s => s + 0.01); // trigger re-render without full refresh
    };

    return () => { ws.close(); };
  }, []);

  useEffect(() => {
    setLastUpdate(
      new Date().toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    );
  }, [activeTicker, selectedExpiry, displayPercent, refreshSeed]);

  const doRefresh = async () => {
    await loadChain(activeTicker, selectedExpiry, true);
    setRefreshSeed((value) => value + 1);
  };

  const { trigger, label: refreshLabel, style: refreshStyle } = useRefreshButton(doRefresh);

  // Manual load via GO button (no auto-load)
  const doGo = useCallback(() => {
    if (!tickerInput || !selectedExpiry) return;
    const ticker = (tickerInput || "SPX").toUpperCase();
    setActiveTicker(ticker);
    loadChain(ticker, selectedExpiry);
  }, [tickerInput, selectedExpiry, loadChain]);

  const [underlyingPrice, setUnderlyingPrice] = useState(0);

  const { rows, spot } = useMemo(() => {
    const strikes = strikeRowsRef.current;
    if (!strikes.length) {
      return buildMockRows(activeTicker, selectedExpiry || expiries[0]?.value || etDateKey(etToday()), refreshSeed);
    }

    // Use underlying price from chain data, fallback to middle strike
    const atmStrike = underlyingPrice > 0 ? underlyingPrice : (strikes.length ? strikes[Math.floor(strikes.length / 2)].strike : 100);
    const realRows: MockRow[] = strikes.map(r => {
      const cd = liveDataRef.current[r.callSym ?? ""] || {};
      const pd = liveDataRef.current[r.putSym ?? ""] || {};
      const cc = ((cd.oi ?? 0) + (cd.vol ?? 0)) || 0;
      const pc = ((pd.oi ?? 0) + (pd.vol ?? 0)) || 0;
      return {
        strike: r.strike,
        gex: cc > 0 || pc > 0 ? ((cd.gamma ?? 0) * cc - (pd.gamma ?? 0) * pc) * atmStrike * atmStrike * 0.01 * 100 : 0,
        dex: cc > 0 || pc > 0 ? (Math.abs(cd.delta ?? 0) * cc - Math.abs(pd.delta ?? 0) * pc) * atmStrike * 100 : 0,
        chex: cc > 0 || pc > 0 ? (-(cd.theta ?? 0) * cc + (pd.theta ?? 0) * pc) * atmStrike * 100 : 0,
        vex: cc > 0 || pc > 0 ? ((cd.vega ?? 0) * cc - (pd.vega ?? 0) * pc) * atmStrike * 100 : 0,
        premium: Math.round(((cd.bid ?? 0) + (cd.ask ?? 0)) / 2 * 100) || 0,
        volume: (cd.vol ?? 0) + (pd.vol ?? 0),
        oi: (cd.oi ?? 0) + (pd.oi ?? 0),
      };
    });

    return { rows: realRows, spot: atmStrike };
  }, [activeTicker, expiries, refreshSeed, selectedExpiry, underlyingPrice]);

  const nearestStrike = useMemo(() => {
    if (!rows.length) return 0;
    return rows.reduce((best, row) => (
      Math.abs(row.strike - spot) < Math.abs(best - spot) ? row.strike : best
    ), rows[0].strike);
  }, [rows, spot]);

  const totalRows = rows.length;
  const autoDisplayPercent = useMemo(() => {
    const requestedCount = Math.max(1, Math.round(totalRows * (displayPercent / 100)));
    if (displayPercent === 10 && requestedCount < 10) return 20;
    return displayPercent;
  }, [displayPercent, totalRows]);

  const visibleRows = useMemo(() => {
    if (!rows.length) return [];
    if (autoDisplayPercent >= 100) return rows;

    const targetCount = Math.min(
      rows.length,
      Math.max(10, Math.round(rows.length * (autoDisplayPercent / 100))),
    );
    const atmIndex = rows.findIndex((row) => row.strike === nearestStrike);
    const half = Math.floor(targetCount / 2);
    let start = Math.max(0, atmIndex - half);
    let end = Math.min(rows.length, start + targetCount);

    if (end - start < targetCount) {
      start = Math.max(0, end - targetCount);
    }

    return rows.slice(start, end).sort((a, b) => a.strike - b.strike); // High to low
  }, [autoDisplayPercent, nearestStrike, rows]);

  const maxByColumn = useMemo(() => {
    const base: Record<Lowercase<ChainColumn>, number> = {
      strike: 1,
      gex: 1,
      dex: 1,
      chex: 1,
      vex: 1,
      premium: 1,
      volume: 1,
      oi: 1,
    };

    visibleRows.forEach((row) => {
      base.gex = Math.max(base.gex, Math.abs(row.gex));
      base.dex = Math.max(base.dex, Math.abs(row.dex));
      base.chex = Math.max(base.chex, Math.abs(row.chex));
      base.vex = Math.max(base.vex, Math.abs(row.vex));
      base.premium = Math.max(base.premium, Math.abs(row.premium));
      base.volume = Math.max(base.volume, Math.abs(row.volume));
      base.oi = Math.max(base.oi, Math.abs(row.oi));
    });

    return base;
  }, [visibleRows]);

  const top3ByColumn = useMemo(() => {
    return {
      gex: visibleRows.map((row) => Math.abs(row.gex)).filter((value) => value > 0).sort((a, b) => b - a).slice(0, 3),
      dex: visibleRows.map((row) => Math.abs(row.dex)).filter((value) => value > 0).sort((a, b) => b - a).slice(0, 3),
      chex: visibleRows.map((row) => Math.abs(row.chex)).filter((value) => value > 0).sort((a, b) => b - a).slice(0, 3),
      vex: visibleRows.map((row) => Math.abs(row.vex)).filter((value) => value > 0).sort((a, b) => b - a).slice(0, 3),
      premium: visibleRows.map((row) => Math.abs(row.premium)).filter((value) => value > 0).sort((a, b) => b - a).slice(0, 3),
      volume: visibleRows.map((row) => Math.abs(row.volume)).filter((value) => value > 0).sort((a, b) => b - a).slice(0, 3),
      oi: visibleRows.map((row) => Math.abs(row.oi)).filter((value) => value > 0).sort((a, b) => b - a).slice(0, 3),
    };
  }, [visibleRows]);

  const autoPercentNote = autoDisplayPercent !== displayPercent ? `Auto ${autoDisplayPercent}%` : null;

  return (
    <div
      ref={pageRef}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#05080d",
        overflow: "hidden",
        fontFamily: "Arial, sans-serif",
      }}
    >
      {loadProgress > 0 && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#05080d", zIndex: 10 }}>
          <div style={{ height: "100%", width: `${loadProgress}%`, background: "#00e5ff", transition: "width 0.3s ease" }} />
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          background: "#0a0e14",
          borderBottom: "1px solid #1e3050",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 800, color: "#00e5ff", letterSpacing: "0.14em", textTransform: "uppercase" }}>
          Options Chain
        </span>

        <input
          list="options-chain-tickers"
          value={tickerInput}
          onChange={(event) => setTickerInput(event.target.value.toUpperCase())}
          onBlur={() => setActiveTicker((tickerInput || "SPX").toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === "Enter") setActiveTicker((tickerInput || "SPX").toUpperCase());
          }}
          autoComplete="off"
          spellCheck={false}
          style={{
            fontSize: 10,
            fontWeight: 800,
            padding: "4px 8px",
            border: "1px solid rgba(0,229,255,.4)",
            borderRadius: 4,
            background: "#0a0e14",
            color: "#00e5ff",
            fontFamily: "Arial",
            outline: "none",
            width: 88,
            textTransform: "uppercase",
          }}
        />
        <datalist id="options-chain-tickers">
          {QUOTE_PANEL_TICKERS.map((ticker) => <option key={ticker} value={ticker} />)}
        </datalist>

        <select
          value={selectedExpiry}
          onChange={(event) => setSelectedExpiry(event.target.value)}
          style={{
            fontSize: 10,
            fontWeight: 800,
            padding: "4px 8px",
            border: "1px solid rgba(255,255,255,.18)",
            borderRadius: 4,
            background: "#0a0e14",
            color: "#e4e4e7",
            cursor: "pointer",
            fontFamily: "Arial",
            outline: "none",
          }}
        >
          {expiries.map((expiry) => (
            <option key={expiry.value} value={expiry.value}>{expiry.label}</option>
          ))}
        </select>

        <select
          value={String(displayPercent)}
          onChange={(event) => setDisplayPercent(Number(event.target.value))}
          style={{
            fontSize: 10,
            fontWeight: 800,
            padding: "4px 8px",
            border: "1px solid rgba(0,229,255,.3)",
            borderRadius: 4,
            background: "#0a0e14",
            color: "#00e5ff",
            cursor: "pointer",
            fontFamily: "Arial",
            outline: "none",
          }}
        >
          {DISPLAY_PERCENTS.map((percent) => (
            <option key={percent} value={percent}>{percent}% of strikes</option>
          ))}
        </select>

        <button
          onClick={doGo}
          disabled={!tickerInput || !selectedExpiry}
          style={{
            fontSize: 10,
            fontWeight: 800,
            padding: "4px 12px",
            border: "1px solid rgba(0,229,255,.5)",
            borderRadius: 4,
            background: tickerInput && selectedExpiry ? "rgba(0,229,255,.12)" : "rgba(0,229,255,.04)",
            color: tickerInput && selectedExpiry ? "#00e5ff" : "#4a6a88",
            cursor: tickerInput && selectedExpiry ? "pointer" : "not-allowed",
            fontFamily: "Arial",
            outline: "none",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          GO
        </button>

        {autoPercentNote ? (
          <span style={{ fontSize: 9, fontWeight: 800, color: "#ffb300", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {autoPercentNote}
          </span>
        ) : null}

        <div style={{ flex: 1 }} />

        <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 800 }}>
          Intensity
        </span>
        <input
          type="range"
          min={0.2}
          max={3}
          step={0.01}
          value={intensity}
          onChange={(event) => setIntensity(Number(event.target.value))}
          style={{ width: 100, accentColor: "#00e5ff", cursor: "pointer" }}
        />
        <span style={{ fontSize: 10, color: "#00e5ff", fontWeight: 700, minWidth: 36, textAlign: "right", fontFamily: "monospace" }}>
          {intensity.toFixed(2)}x
        </span>

        <span style={{ color: "#1e3050" }}>|</span>

        <div style={{ display: "flex", gap: 2, background: "#070c14", borderRadius: 4, padding: 2 }}>
          {GREEK_MODES.map(m => (
            <button
              key={m}
              onClick={() => setGreekMode(m)}
              style={{
                padding: "2px 8px",
                fontSize: 9,
                fontWeight: 800,
                borderRadius: 3,
                border: "none",
                cursor: "pointer",
                fontFamily: "Arial",
                textTransform: "uppercase",
                background: greekMode === m ? "rgba(0,229,255,.15)" : "transparent",
                color: greekMode === m ? "#00e5ff" : "#64748b",
              }}
            >
              {m}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
          <span style={{ fontSize: 11, color: "#e4e4e7", fontWeight: 700 }}>
            {activeTicker} <span style={{ color: "#00e5ff", fontFamily: "monospace" }}>{spot.toFixed(2)}</span>
          </span>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#00e676" }} />
          <span style={{ fontSize: 9, color: "#00e676", fontWeight: 800, letterSpacing: "0.08em" }}>LIVE</span>
          <span style={{ fontSize: 9, color: "#334155", fontFamily: "monospace" }}>{lastUpdate}</span>
        </div>

        <button onClick={trigger} style={refreshStyle}>{refreshLabel}</button>
        <BoxSnapBtn targetRef={pageRef} />
        <BoxDiscordBtn
          targetRef={pageRef}
          message={`📊 Options Chain — ${activeTicker} ${selectedExpiry}`}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "80px repeat(3, minmax(80px, 1fr))",
          background: "#0a0f18",
          borderBottom: "2px solid #1e3050",
          flexShrink: 0,
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {["Strike", greekMode.toUpperCase(), "Volume", "OI"].map((column, index) => (
          <div
            key={column}
            style={{
              padding: "5px 8px",
              textAlign: index === 0 ? "left" : "right",
              color: index === 0 ? "#e4e4e7" : "#a78bfa",
            }}
          >
            {column}
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {!strikeRowsRef.current.length ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 12, color: "#4a6a88" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Select ticker, expiry & % strikes</div>
              <div style={{ fontSize: 11 }}>Then click GO to load chain</div>
            </div>
          </div>
        ) : visibleRows.map((row) => {
          const isATM = row.strike === nearestStrike;
          const rowStyle = isATM
            ? { background: "rgba(255,179,0,.07)", borderTop: "1px solid rgba(255,179,0,.25)", borderBottom: "1px solid rgba(255,179,0,.25)" }
            : { borderBottom: "1px solid rgba(30,48,80,.35)" };

          const greekValue = row[greekMode];
          const numericCells: Array<{ key: string; value: number; text: string }> = [
            { key: "greek", value: greekValue, text: fmtMoney(greekValue) },
            { key: "volume", value: row.volume, text: fmtInt(row.volume) },
            { key: "oi", value: row.oi, text: fmtInt(row.oi) },
          ];

          return (
            <div
              key={row.strike}
              style={{
                display: "grid",
                gridTemplateColumns: "80px repeat(3, minmax(80px, 1fr))",
                ...rowStyle,
              }}
            >
              <div
                style={{
                  padding: "4px 6px",
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: "monospace",
                  textAlign: "left",
                  color: isATM ? "#ffb300" : "#e4e4e7",
                  background: isATM ? "rgba(255,179,0,.12)" : "transparent",
                  borderRight: "1px solid rgba(255,255,255,.06)",
                }}
              >
                {Number.isInteger(row.strike) ? row.strike.toFixed(0) : row.strike.toFixed(2)}
              </div>

              {numericCells.map((cell) => {
                return (
                  <div
                    key={cell.key}
                    style={{
                      padding: "4px 6px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      textAlign: "right",
                      color: "#ffffff",
                      background: cell.key === "greek" ? metricBg(cell.value, maxByColumn[greekMode], intensity, top3ByColumn[greekMode]) : "transparent",
                      fontWeight: 700,
                    }}
                  >
                    {cell.text}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
