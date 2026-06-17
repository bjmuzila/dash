"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getClientWsUrl } from "@/lib/clientRuntime";

type FeedType = "Quote" | "Trade" | "Summary" | "Greeks";
type SymbolSource = "custom" | "0dte-calls" | "0dte-puts";

type FeedItem = Record<string, unknown> & {
  eventType: string;
  eventSymbol: string;
};

const FEED_TYPES: FeedType[] = ["Quote", "Trade", "Summary", "Greeks"];
const SOURCE_OPTIONS: Array<{ value: SymbolSource; label: string }> = [
  { value: "custom", label: "Custom symbol" },
  { value: "0dte-calls", label: "SPX 0DTE calls" },
  { value: "0dte-puts", label: "SPX 0DTE puts" },
];

function normalizeFeedData(data: unknown[]): FeedItem[] {
  if (!Array.isArray(data) || !data.length) return [];
  if (typeof data[0] === "object" && data[0] !== null && !Array.isArray(data[0])) {
    return data as FeedItem[];
  }

  const eventType = data[0] as string;
  const rows = data[1] as unknown[];
  if (typeof eventType !== "string" || !Array.isArray(rows)) return [];

  const fieldsByType: Record<string, string[]> = {
    Quote: ["bidPrice", "askPrice", "bidSize", "askSize"],
    Trade: ["price", "dayVolume", "size"],
    Summary: ["dayId", "dayOpenPrice", "dayHighPrice", "dayLowPrice", "dayClosePrice", "prevDayId", "prevDayClosePrice", "openInterest"],
    Greeks: ["volatility", "delta", "gamma", "theta", "rho", "vega"],
  };

  const fields = fieldsByType[eventType];
  if (!fields) return [];

  const hasType = rows[0] === eventType;
  const step = fields.length + (hasType ? 2 : 1);
  const out: FeedItem[] = [];

  for (let i = 0; i <= rows.length - step; i += step) {
    const base = i + (hasType ? 2 : 1);
    const item: Record<string, unknown> = {
      eventType: hasType ? rows[i] : eventType,
      eventSymbol: hasType ? rows[i + 1] : rows[i],
    };
    fields.forEach((field, index) => {
      item[field] = rows[base + index];
    });
    out.push(item as FeedItem);
  }

  return out;
}

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function DevPage() {
  const [feedType, setFeedType] = useState<FeedType>("Greeks");
  const [source, setSource] = useState<SymbolSource>("0dte-calls");
  const [symbol, setSymbol] = useState(".SPXW");
  const [expiry, setExpiry] = useState("");
  const [expiryOptions, setExpiryOptions] = useState<string[]>([]);
  const [callSymbols, setCallSymbols] = useState<string[]>([]);
  const [putSymbols, setPutSymbols] = useState<string[]>([]);
  const [loadingSymbols, setLoadingSymbols] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "found" | "not-found" | "error">("idle");
  const [result, setResult] = useState<{
    symbol: string;
    feedType: FeedType;
    found: boolean;
    elapsedMs: number;
    payload: unknown;
    note?: string;
  } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const sourceSymbols = useMemo(
    () => (source === "0dte-calls" ? callSymbols : source === "0dte-puts" ? putSymbols : []),
    [source, callSymbols, putSymbols]
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/gex/expirations", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const expirations = Array.isArray(json?.expirations) ? (json.expirations as string[]) : [];
        setExpiryOptions(expirations);
        const today = todayEt();
        const initial = expirations.includes(today) ? today : expirations[0] ?? "";
        setExpiry(initial);
      })
      .catch(() => {
        if (!cancelled) setExpiryOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!expiry) return;
    let cancelled = false;
    setLoadingSymbols(true);

    fetch(`/api/chains?ticker=SPX&expiration=${encodeURIComponent(expiry)}&range=all&noSubscribe=1`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const items: Array<Record<string, unknown>> = Array.isArray(json?.data?.items) ? json.data.items : [];
        const target = items.filter((item) => String(item["expiration-date"] ?? "").slice(0, 10) === expiry.slice(0, 10));
        const groups = target.length ? target : items;
        const nextCalls: string[] = [];
        const nextPuts: string[] = [];

        groups.forEach((group) => {
          const strikes = Array.isArray(group.strikes) ? (group.strikes as Array<Record<string, unknown>>) : [];
          strikes.forEach((strike) => {
            const call = strike.call as Record<string, unknown> | undefined;
            const put = strike.put as Record<string, unknown> | undefined;
            const callSym = String(call?.["streamer-symbol"] ?? "");
            const putSym = String(put?.["streamer-symbol"] ?? "");
            if (callSym) nextCalls.push(callSym);
            if (putSym) nextPuts.push(putSym);
          });
        });

        setCallSymbols([...new Set(nextCalls)]);
        setPutSymbols([...new Set(nextPuts)]);
      })
      .catch(() => {
        if (!cancelled) {
          setCallSymbols([]);
          setPutSymbols([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSymbols(false);
      });

    return () => {
      cancelled = true;
    };
  }, [expiry]);

  useEffect(() => {
    if (source === "custom") return;
    if (!sourceSymbols.length) return;
    setSymbol(sourceSymbols[0]);
  }, [source, sourceSymbols]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const runProbe = useCallback(async () => {
    const trimmed = symbol.trim();
    if (!trimmed) return;

    wsRef.current?.close();
    wsRef.current = null;
    setStatus("loading");
    setResult(null);

    const started = performance.now();
    const ws = new WebSocket(getClientWsUrl());
    wsRef.current = ws;

    const timeout = window.setTimeout(() => {
      if (wsRef.current === ws) {
        ws.close();
        wsRef.current = null;
      }
      setStatus("not-found");
      setResult({
        symbol: trimmed,
        feedType,
        found: false,
        elapsedMs: Math.round(performance.now() - started),
        payload: null,
        note: `No ${feedType} event arrived before timeout.`,
      });
    }, 5000);

    ws.onopen = () => {
      const feedTypesBySymbol: Record<string, string[]> = {
        [trimmed]: [feedType],
      };

      ws.send(
        JSON.stringify({
          type: "subscribe",
          symbols: [trimmed],
          feedTypesBySymbol,
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message?.type !== "FEED_DATA" || !Array.isArray(message.data)) return;
        const items = normalizeFeedData(message.data);
        const match = items.find(
          (item) => String(item.eventSymbol ?? "") === trimmed && String(item.eventType ?? "") === feedType
        );
        if (!match) return;

        clearTimeout(timeout);
        if (wsRef.current === ws) {
          ws.close();
          wsRef.current = null;
        }

        setStatus("found");
        setResult({
          symbol: trimmed,
          feedType,
          found: true,
          elapsedMs: Math.round(performance.now() - started),
          payload: match,
        });
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      if (wsRef.current === ws) {
        ws.close();
        wsRef.current = null;
      }
      setStatus("error");
      setResult({
        symbol: trimmed,
        feedType,
        found: false,
        elapsedMs: Math.round(performance.now() - started),
        payload: null,
        note: "Socket error while waiting for proxy data.",
      });
    };
  }, [feedType, symbol]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        height: "100%",
        overflow: "auto",
        padding: 24,
        background: "#05080d",
        color: "#e5eef8",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: "#00e5ff" }}>
          Dev
        </div>
        <h1 style={{ margin: "8px 0 0", fontSize: 26, fontWeight: 800 }}>Proxy Subscription Probe</h1>
        <div style={{ marginTop: 6, fontSize: 13, color: "#8da8c2" }}>
          Subscribe a symbol, wait for the first proxy socket event, and see the raw payload plus elapsed time.
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
          padding: 16,
          borderRadius: 14,
          border: "1px solid rgba(0,229,255,0.14)",
          background: "rgba(10,15,22,0.72)",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          <span style={{ color: "#8da8c2", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Feed Type</span>
          <select value={feedType} onChange={(e) => setFeedType(e.target.value as FeedType)} style={inputStyle}>
            {FEED_TYPES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          <span style={{ color: "#8da8c2", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Source</span>
          <select value={source} onChange={(e) => setSource(e.target.value as SymbolSource)} style={inputStyle}>
            {SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          <span style={{ color: "#8da8c2", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Expiry</span>
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)} style={inputStyle}>
            {!expiryOptions.length ? <option value="">No expiries</option> : null}
            {expiryOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        {source === "custom" ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
            <span style={{ color: "#8da8c2", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Symbol</span>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} style={inputStyle} placeholder=".SPXW260617C7500" />
          </label>
        ) : (
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
            <span style={{ color: "#8da8c2", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {source === "0dte-calls" ? "0DTE Call Symbol" : "0DTE Put Symbol"}
            </span>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} style={inputStyle} disabled={loadingSymbols || !sourceSymbols.length}>
              {!sourceSymbols.length ? <option value="">{loadingSymbols ? "Loading…" : "No symbols"}</option> : null}
              {sourceSymbols.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => void runProbe()} style={buttonStyle} disabled={!symbol.trim() || !expiry}>
          Run Probe
        </button>
        <div style={{ fontSize: 12, color: statusColor(status), fontWeight: 700, letterSpacing: "0.04em" }}>
          {status === "idle" ? "Ready" : status === "loading" ? "Waiting for proxy event…" : status === "found" ? "Found" : status === "not-found" ? "Not found" : "Error"}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <InfoCard label="Expiry" value={expiry || "—"} />
        <InfoCard label="Selected Symbol" value={symbol || "—"} />
        <InfoCard label="Feed Type" value={feedType} />
        <InfoCard label="Elapsed" value={result ? `${result.elapsedMs} ms` : "—"} />
      </div>

      <div
        style={{
          borderRadius: 14,
          border: "1px solid rgba(0,229,255,0.14)",
          background: "rgba(10,15,22,0.72)",
          padding: 16,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8da8c2", marginBottom: 10 }}>
          Result
        </div>
        {result ? (
          <>
            {result.note ? (
              <div style={{ marginBottom: 10, fontSize: 13, color: "#ffd166" }}>{result.note}</div>
            ) : null}
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 12,
                lineHeight: 1.5,
                color: "#d7e6f5",
                fontFamily: "Consolas, 'Courier New', monospace",
              }}
            >
              {JSON.stringify(result.payload, null, 2)}
            </pre>
          </>
        ) : (
          <div style={{ fontSize: 13, color: "#6f88a5" }}>No probe run yet.</div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        background: "rgba(10,15,22,0.72)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8da8c2" }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 14, fontWeight: 700, color: "#f5fbff", wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

function statusColor(status: "idle" | "loading" | "found" | "not-found" | "error") {
  if (status === "found") return "#00e676";
  if (status === "not-found") return "#ffb703";
  if (status === "error") return "#ff5d73";
  if (status === "loading") return "#00e5ff";
  return "#8da8c2";
}

const inputStyle: React.CSSProperties = {
  height: 40,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "#0a0f16",
  color: "#f5fbff",
  padding: "0 12px",
  fontSize: 13,
  outline: "none",
};

const buttonStyle: React.CSSProperties = {
  height: 40,
  padding: "0 16px",
  borderRadius: 10,
  border: "1px solid rgba(0,229,255,0.3)",
  background: "linear-gradient(180deg, rgba(0,229,255,0.16), rgba(0,229,255,0.08))",
  color: "#00e5ff",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};
