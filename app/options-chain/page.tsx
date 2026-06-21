"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoxDiscordBtn, BoxSnapBtn } from "@/components/shared/DataBox";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { HOME_THEME as HT, homeShellStyle, homeButtonStyle } from "@/components/shared/homeTheme";

// ── Custom dropdown (bypasses native OS rendering) ─────────────────────────
function CustomDropdown<T extends string | number>({
  value,
  options,
  onChange,
  formatLabel,
  accentCyan,
}: {
  value: T;
  options: T[] | readonly T[];
  onChange: (v: T) => void;
  formatLabel?: (v: T) => string;
  accentCyan?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const label = formatLabel ? formatLabel(value) : String(value);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const color = accentCyan !== false ? HT.cyan : HT.text;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          fontSize: 10, fontWeight: 800, padding: "4px 8px",
          border: `1px solid ${accentCyan !== false ? "rgba(0,229,255,.3)" : HT.border}`,
          borderRadius: 4,
          background: "rgba(0,0,0,0.4)",
          color,
          cursor: "pointer", outline: "none",
          display: "flex", alignItems: "center", gap: 5,
          whiteSpace: "nowrap",
        }}
      >
        {label}
        <span style={{ fontSize: 7, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 3px)", left: 0, zIndex: 999,
          background: "rgba(13,17,25,0.97)", backdropFilter: "blur(20px)",
          border: `1px solid ${HT.border}`, borderRadius: 6,
          padding: "3px 0", minWidth: "100%",
          boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
        }}>
          {options.map(opt => {
            const optLabel = formatLabel ? formatLabel(opt) : String(opt);
            const active = opt === value;
            return (
              <div
                key={String(opt)}
                onClick={() => { onChange(opt); setOpen(false); }}
                style={{
                  padding: "6px 12px", fontSize: 10, fontWeight: active ? 800 : 600,
                  cursor: "pointer", whiteSpace: "nowrap",
                  color: active ? HT.cyan : HT.text,
                  background: active ? "rgba(0,229,255,0.10)" : "transparent",
                  letterSpacing: "0.04em",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = active ? "rgba(0,229,255,0.15)" : "rgba(255,255,255,0.05)")}
                onMouseLeave={e => (e.currentTarget.style.background = active ? "rgba(0,229,255,0.10)" : "transparent")}
              >
                {optLabel}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
      list.push({ value, label: `${dayName}, ${mm}-${dd}-${date.getFullYear()}` });
      daysAdded++;
    }

    offset++;
  }

  return list;
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
  const n = value || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return "transparent";
  const pos = n >= 0;
  const rank = topValues.indexOf(Math.abs(n)) + 1;
  if (rank === 1) return pos ? "rgba(41,182,246,0.90)" : "rgba(255,71,87,0.90)";
  if (rank === 2) return pos ? "rgba(41,182,246,0.45)" : "rgba(255,71,87,0.45)";
  if (rank === 3) return pos ? "rgba(41,182,246,0.25)" : "rgba(255,71,87,0.25)";
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio * (intensity || 0.1), 1.4);
  const alpha = Math.min(0.18, 0.02 + eased * 0.16);
  return pos ? `rgba(41,182,246,${alpha.toFixed(2)})` : `rgba(255,71,87,${alpha.toFixed(2)})`;
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
  // Fallback calendar list (used only until/if the per-ticker expirations
  // fetch resolves). Real listings come from /api/expirations so we never
  // offer a date the ticker doesn't actually trade (e.g. NVDA has no Monday
  // weeklies — picking one returned an empty chain).
  const fallbackExpiries = useMemo(() => buildExpiries(), []);
  const [expiries, setExpiries] = useState<Array<{ value: string; label: string }>>(fallbackExpiries);
  const [tickerInput, setTickerInput] = useState("SPX");
  const [activeTicker, setActiveTicker] = useState("SPX");
  const [selectedExpiry, setSelectedExpiry] = useState(fallbackExpiries[0]?.value ?? "");
  const [displayPercent, setDisplayPercent] = useState<number>(10);
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [intensity, setIntensity] = useState(1.75);
  const [lastUpdate, setLastUpdate] = useState("--:--:--");
  const [loadProgress, setLoadProgress] = useState(0); // 0-100
  const [greekMode, setGreekMode] = useState<GreekMode>("gex");
  const pageRef = useRef<HTMLDivElement>(null);
  const [chainError, setChainError] = useState<string | null>(null);

  // Live WS data ref + batched subscription
  const liveDataRef = useRef<Record<string, LiveEntry>>({});
  const strikeRowsRef = useRef<StrikeRow[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const loadTokenRef = useRef(0);
  const subscribedSymbolsRef = useRef<string[]>([]);
  // Set by GO when the ticker changes; consumed by the expirations effect to
  // load the chain only after a valid expiry for the new ticker is resolved.
  const pendingGoRef = useRef(false);
  // Live mirror of selectedExpiry so the expirations effect (which only re-runs
  // on ticker change) always validates against the user's current choice.
  const selectedExpiryRef = useRef("");

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
    const bust = bustCache ? `&noCache=1` : "";

    try {
      setChainError(null);
      setLoadProgress(10); // Fetching chain data
      const res = await fetch(
        `/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(expDate)}&range=all${bust}`
      );
      const json = await res.json();
      if (token !== loadTokenRef.current) return;

      const items = (json.data as Record<string, unknown> | undefined)?.items as unknown[] ?? [];
      if (!items.length) {
        strikeRowsRef.current = [];
        setUnderlyingPrice(0);
        setChainError(`No live chain payload returned for ${ticker} ${expDate}.`);
        setLoadProgress(0);
        setRefreshSeed(s => s + 0.01);
        return;
      }

      setLoadProgress(30); // Parsing strikes
      const target = (items as { "expiration-date"?: string }[]).filter(i =>
        String(i["expiration-date"] ?? "").slice(0, 10) === expDate.slice(0, 10)
      );
      const strikes = buildStrikes(target.length ? target : items as unknown[]);
      if (!strikes.length) {
        strikeRowsRef.current = [];
        setUnderlyingPrice(0);
        setChainError(`No live strikes resolved for ${ticker} ${expDate}.`);
        setLoadProgress(0);
        setRefreshSeed(s => s + 0.01);
        return;
      }
      strikeRowsRef.current = strikes;

      // Extract underlying price from API response
      const underlyingPrice = parseFloat(String((json.data as Record<string, unknown> | undefined)?.underlyingPrice ?? 0));
      if (underlyingPrice > 0) {
        setUnderlyingPrice(underlyingPrice);
      } else {
        setUnderlyingPrice(0);
      }

      setLoadProgress(50); // Subscribing to symbols
      // Batch subscribe all symbols at once
      const allSymbols = new Set<string>();
      strikes.forEach(row => {
        if (row.callSym) allSymbols.add(row.callSym);
        if (row.putSym) allSymbols.add(row.putSym);
      });

      const symbolList = [...allSymbols];
      subscribedSymbolsRef.current = symbolList;
      setLoadProgress(100);
      setTimeout(() => setLoadProgress(0), 1000);

      setRefreshSeed(s => s + 0.01);
    } catch (err) {
      console.error(`[OptionsChain] Load failed for ${ticker}:`, err);
      strikeRowsRef.current = [];
      setUnderlyingPrice(0);
      setChainError(`Live chain load failed for ${ticker} ${expDate}.`);
      setLoadProgress(0);
    }
  };

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
    const tickerChanged = ticker !== activeTicker;
    setActiveTicker(ticker);
    // If the ticker changed, the expirations effect will refetch this ticker's
    // real listings and snap selectedExpiry to a valid date; the pendingGo flag
    // makes that effect fire the chain load once the expiry is confirmed valid.
    // This avoids loading against a date the new ticker may not list (e.g. a
    // Monday weekly that exists for SPX but not NVDA).
    if (tickerChanged) {
      pendingGoRef.current = true;
    } else {
      loadChain(ticker, selectedExpiry);
    }
  }, [tickerInput, selectedExpiry, activeTicker, loadChain]);

  useEffect(() => { selectedExpiryRef.current = selectedExpiry; }, [selectedExpiry]);

  // Auto-load SPX on mount
  useEffect(() => {
    const defaultExpiry = selectedExpiry || expiries[0]?.value;
    if (defaultExpiry) {
      loadChain("SPX", defaultExpiry);
    }
  }, []);

  // Fetch the ticker's REAL listed expirations whenever the active ticker
  // changes. Replaces the fabricated calendar list so the dropdown only ever
  // offers dates the symbol actually trades.
  useEffect(() => {
    let cancelled = false;
    const ticker = (activeTicker || "SPX").toUpperCase();

    (async () => {
      try {
        const json = await fetch(`/api/expirations?ticker=${encodeURIComponent(ticker)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const items: Array<Record<string, unknown>> = json?.data?.items ?? [];
        if (cancelled || !items.length) return;

        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const seen = new Set<string>();
        const list = items
          .map((it) => String(it["expiration-date"] ?? ""))
          .filter((d) => d && !seen.has(d) && (seen.add(d), true))
          .sort()
          .map((value) => {
            const dt = new Date(value + "T12:00:00");
            const mm = String(dt.getMonth() + 1).padStart(2, "0");
            const dd = String(dt.getDate()).padStart(2, "0");
            return { value, label: `${dayNames[dt.getDay()]}, ${mm}-${dd}-${dt.getFullYear()}` };
          });
        if (!list.length) return;

        setExpiries(list);
        // If the current selection isn't a real listing for this ticker, snap
        // to the nearest valid one (prefer today's 0DTE when present).
        const today = etDateKey(etToday());
        const cur = selectedExpiryRef.current;
        const validExpiry = list.some((e) => e.value === cur)
          ? cur
          : (list.find((e) => e.value === today)?.value ?? list[0].value);
        setSelectedExpiry(validExpiry);

        // A ticker-change GO is waiting on a valid expiry — load the chain now.
        if (pendingGoRef.current) {
          pendingGoRef.current = false;
          loadChain(ticker, validExpiry);
        }
      } catch {
        /* keep fallback calendar list */
      }
    })();

    return () => { cancelled = true; };
    // Only re-run on ticker change. loadChain is recreated every render, so
    // listing it here caused an infinite fetch loop (effect → setState →
    // render → new loadChain → effect …). selectedExpiry is read via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker]);

  const [underlyingPrice, setUnderlyingPrice] = useState(0);

  const { rows, spot } = useMemo(() => {
    const strikes = strikeRowsRef.current;
    if (!strikes.length) {
      return { rows: [] as MockRow[], spot: 0 };
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
      greek: 1,
      volume: 1,
      oi: 1,
    };

    visibleRows.forEach((row) => {
      const greekVal = row[greekMode as keyof MockRow] as number;
      base.greek = Math.max(base.greek, Math.abs(greekVal));
      base.volume = Math.max(base.volume, Math.abs(row.volume));
      base.oi = Math.max(base.oi, Math.abs(row.oi));
    });

    return base;
  }, [visibleRows, greekMode]);

  const top3ByColumn = useMemo(() => {
    const greekValues = visibleRows.map((row) => Math.abs(row[greekMode as keyof MockRow] as number)).filter((value) => value > 0).sort((a, b) => b - a).slice(0, 3);
    return {
      greek: greekValues,
      volume: visibleRows.map((row) => Math.abs(row.volume)).filter((value) => value > 0).sort((a, b) => b - a).slice(0, 3),
      oi: visibleRows.map((row) => Math.abs(row.oi)).filter((value) => value > 0).sort((a, b) => b - a).slice(0, 3),
    };
  }, [visibleRows, greekMode]);

  const autoPercentNote = autoDisplayPercent !== displayPercent ? `Auto ${autoDisplayPercent}%` : null;

  return (
    <div
      ref={pageRef}
      style={{
        ...homeShellStyle,
        height: "100%",
        overflow: "hidden",
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
          background: HT.panelBgStrong,
          backdropFilter: "blur(16px)",
          borderBottom: `1px solid ${HT.border}`,
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
            border: `1px solid rgba(0,229,255,.4)`,
            borderRadius: 4,
            background: "rgba(0,0,0,0.4)",
            color: HT.cyan,
            outline: "none",
            width: 88,
            textTransform: "uppercase",
          }}
        />
        <datalist id="options-chain-tickers">
          {QUOTE_PANEL_TICKERS.map((ticker) => <option key={ticker} value={ticker} />)}
        </datalist>

        <CustomDropdown
          value={selectedExpiry}
          options={expiries.map(e => e.value) as string[]}
          onChange={setSelectedExpiry}
          formatLabel={v => expiries.find(e => e.value === v)?.label ?? v}
          accentCyan={false}
        />

        <CustomDropdown
          value={displayPercent}
          options={DISPLAY_PERCENTS}
          onChange={setDisplayPercent}
          formatLabel={v => `${v}% of strikes`}
        />

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

        <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700 }}>Intensity</span>
        <input
          type="range" min={0.5} max={3} step={0.01}
          value={intensity}
          onChange={(event) => setIntensity(Number(event.target.value))}
          style={{ width: 80, height: 3, accentColor: "#00e5ff" }}
        />
        <span style={{ fontSize: 10, color: "#00e5ff", fontWeight: 700, minWidth: 36, fontFamily: "monospace" }}>
          {intensity.toFixed(2)}x
        </span>

        <span style={{ color: "#1e3050" }}>|</span>

        <div style={{ display: "flex", gap: 2, background: HT.panelBg, backdropFilter: "blur(8px)", borderRadius: 4, padding: 2 }}>
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
                textTransform: "uppercase",
                background: greekMode === m ? "rgba(0,229,255,.15)" : "transparent",
                color: greekMode === m ? HT.cyan : "#64748b",
              }}
            >
              {m}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
          <span style={{ fontSize: 11, color: "#e4e4e7", fontWeight: 700 }}>
            {activeTicker} <span style={{ color: "#00e5ff", fontFamily: "monospace" }}>{spot > 0 ? spot.toFixed(2) : "—"}</span>
          </span>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#00e676" }} />
          <span style={{ fontSize: 9, color: "#00e676", fontWeight: 800, letterSpacing: "0.08em" }}>LIVE</span>
          <span style={{ fontSize: 9, color: "#334155", fontFamily: "monospace" }}>{lastUpdate}</span>
        </div>

        <button onClick={trigger} style={{ ...homeButtonStyle }}>{refreshLabel}</button>
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
          background: HT.panelBgStrong,
          borderBottom: `1px solid ${HT.border}`,
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
              color: index === 0 ? HT.muted : HT.cyan,
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
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                {chainError ? "No Live Chain Data" : "Select ticker, expiry & % strikes"}
              </div>
              <div style={{ fontSize: 11 }}>
                {chainError ?? "Then click GO to load chain"}
              </div>
            </div>
          </div>
        ) : visibleRows.map((row) => {
          const isATM = row.strike === nearestStrike;
          const rowStyle = isATM
            ? { background: "rgba(255,179,0,.07)", outline: "1px solid rgba(255,255,255,.55)", outlineOffset: "-1px", position: "relative" as const, zIndex: 1 }
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
                      background: cell.key === "greek" ? metricBg(cell.value, maxByColumn.greek, intensity, top3ByColumn.greek) : "transparent",
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
