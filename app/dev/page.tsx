"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getClientWsUrl } from "@/lib/clientRuntime";

type FeedType = "Quote" | "Trade" | "Summary" | "Greeks";
type OptionSide = "call" | "put";
type ProbeStatus = "idle" | "loading" | "found" | "not-found" | "error";

type FeedItem = Record<string, unknown> & {
  eventType: string;
  eventSymbol: string;
};

type ChainStrike = {
  strike: number;
  callSymbol: string;
  putSymbol: string;
};

const FEED_TYPES: FeedType[] = ["Quote", "Trade", "Summary", "Greeks"];
const TICKERS = ["SPX", "SPY", "QQQ", "NVDA", "AAPL", "TSLA", "SMH"] as const;
const SIDES: Array<{ value: OptionSide; label: string }> = [
  { value: "call", label: "Call" },
  { value: "put", label: "Put" },
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

function extractExpirations(payload: unknown): string[] {
  const json = payload as {
    expirations?: unknown;
    items?: Array<Record<string, unknown>>;
    data?: { items?: Array<Record<string, unknown>> };
  };

  const out = new Set<string>();
  const add = (value: unknown) => {
    const date = String(value ?? "");
    if (date.length === 10) out.add(date);
  };

  if (Array.isArray(json?.expirations)) {
    json.expirations.forEach(add);
  }

  if (Array.isArray(json?.items)) {
    json.items.forEach((item) => add(item.date ?? item["expiration-date"]));
  }

  if (Array.isArray(json?.data?.items)) {
    json.data.items.forEach((item) => add(item.date ?? item["expiration-date"]));
  }

  const today = todayEt();
  return [...out].filter((date) => date >= today).sort();
}

function formatStrikeValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function buildStrikeLabel(strike: ChainStrike, side: OptionSide): string {
  const sym = side === "call" ? strike.callSymbol : strike.putSymbol;
  return sym ? `${formatStrikeValue(strike.strike)}  |  ${sym}` : formatStrikeValue(strike.strike);
}

export default function DevPage() {
  const pageIdRef = useRef(`dev-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [ticker, setTicker] = useState<(typeof TICKERS)[number]>("SPX");
  const [feedType, setFeedType] = useState<FeedType>("Greeks");
  const [expiry, setExpiry] = useState("");
  const [expiryOptions, setExpiryOptions] = useState<string[]>([]);
  const [optionSide, setOptionSide] = useState<OptionSide>("put");
  const [strikes, setStrikes] = useState<ChainStrike[]>([]);
  const [selectedStrike, setSelectedStrike] = useState("");
  const [manualSymbol, setManualSymbol] = useState("");
  const [status, setStatus] = useState<ProbeStatus>("idle");
  const [loadingExpirations, setLoadingExpirations] = useState(false);
  const [loadingStrikes, setLoadingStrikes] = useState(false);
  const [chainRootSymbol, setChainRootSymbol] = useState("");
  const [result, setResult] = useState<{
    symbol: string;
    feedType: FeedType;
    found: boolean;
    elapsedMs: number;
    payload: unknown;
    note?: string;
  } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const selectedStrikeRow = useMemo(
    () => strikes.find((strike) => String(strike.strike) === selectedStrike) ?? null,
    [selectedStrike, strikes]
  );

  const builtSymbol = useMemo(() => {
    if (!selectedStrikeRow) return "";
    return optionSide === "call" ? selectedStrikeRow.callSymbol : selectedStrikeRow.putSymbol;
  }, [optionSide, selectedStrikeRow]);

  const effectiveSymbol = useMemo(() => manualSymbol.trim() || builtSymbol, [builtSymbol, manualSymbol]);

  useEffect(() => {
    let cancelled = false;
    const loadExpirations = async () => {
      setLoadingExpirations(true);
      try {
        let expirations: string[] = [];
        const primary = ticker === "SPX"
          ? await fetch("/api/gex/expirations", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
          : null;
        expirations = extractExpirations(primary);

        if (!expirations.length) {
          const fallback = await fetch(`/api/expirations?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
          expirations = extractExpirations(fallback);
        }

        if (cancelled) return;
        setExpiryOptions(expirations);
        const today = todayEt();
        setExpiry((current) => {
          if (current && expirations.includes(current)) return current;
          if (expirations.includes(today)) return today;
          return expirations[0] ?? "";
        });
      } catch {
        if (!cancelled) {
          setExpiryOptions([]);
          setExpiry("");
        }
      } finally {
        if (!cancelled) setLoadingExpirations(false);
      }
    };

    setStrikes([]);
    setSelectedStrike("");
    setManualSymbol("");
    setChainRootSymbol("");
    loadExpirations().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  useEffect(() => {
    if (!expiry) {
      setStrikes([]);
      setSelectedStrike("");
      setChainRootSymbol("");
      return;
    }

    let cancelled = false;
    const loadStrikes = async () => {
      setLoadingStrikes(true);
      try {
        const json = await fetch(
          `/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(expiry)}&range=all&noSubscribe=1`,
          { cache: "no-store" }
        ).then((r) => r.json());

        if (cancelled) return;

        const rootSymbol = String(json?.data?.rootSymbol ?? json?.rootSymbol ?? "");
        const items: Array<Record<string, unknown>> = Array.isArray(json?.data?.items) ? json.data.items : [];
        const targetGroups = items.filter((item) => String(item["expiration-date"] ?? "").slice(0, 10) === expiry.slice(0, 10));
        const groups = targetGroups.length ? targetGroups : items;
        const nextStrikes: ChainStrike[] = [];

        groups.forEach((group) => {
          const groupStrikes = Array.isArray(group.strikes) ? (group.strikes as Array<Record<string, unknown>>) : [];
          groupStrikes.forEach((strikeRow) => {
            const call = strikeRow.call as Record<string, unknown> | undefined;
            const put = strikeRow.put as Record<string, unknown> | undefined;
            const strike = Number(strikeRow["strike-price"] ?? strikeRow.strikePrice ?? strikeRow.strike ?? 0);
            if (!(strike > 0)) return;

            nextStrikes.push({
              strike,
              callSymbol: String(call?.["streamer-symbol"] ?? call?.symbol ?? ""),
              putSymbol: String(put?.["streamer-symbol"] ?? put?.symbol ?? ""),
            });
          });
        });

        nextStrikes.sort((a, b) => a.strike - b.strike);
        setChainRootSymbol(rootSymbol);
        setStrikes(nextStrikes);
        setSelectedStrike((current) => {
          if (current && nextStrikes.some((row) => String(row.strike) === current)) return current;
          return nextStrikes.length ? String(nextStrikes[Math.floor(nextStrikes.length / 2)].strike) : "";
        });
      } catch {
        if (!cancelled) {
          setChainRootSymbol("");
          setStrikes([]);
          setSelectedStrike("");
        }
      } finally {
        if (!cancelled) setLoadingStrikes(false);
      }
    };

    setManualSymbol("");
    loadStrikes().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [expiry, ticker]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const runProbe = useCallback(async () => {
    const trimmed = effectiveSymbol.trim();
    if (!trimmed) return;

    wsRef.current?.close();
    wsRef.current = null;
    setStatus("loading");
    setResult(null);

    const started = performance.now();
    try {
      await fetch("/api/proxy/subscription-ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId: pageIdRef.current,
          symbols: [trimmed],
          timeout: 8000,
          threshold: 1,
        }),
      });
    } catch {
      // allow the direct probe to continue
    }

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
    }, 10000);

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
  }, [effectiveSymbol, feedType]);

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
          Build the option symbol from dropdowns, subscribe it through the proxy, and inspect the first raw event that comes back.
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
          <span style={labelStyle}>Ticker</span>
          <select value={ticker} onChange={(e) => setTicker(e.target.value as (typeof TICKERS)[number])} style={inputStyle}>
            {TICKERS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          <span style={labelStyle}>Feed Type</span>
          <select value={feedType} onChange={(e) => setFeedType(e.target.value as FeedType)} style={inputStyle}>
            {FEED_TYPES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          <span style={labelStyle}>Expiry</span>
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)} style={inputStyle} disabled={loadingExpirations || !expiryOptions.length}>
            {!expiryOptions.length ? <option value="">{loadingExpirations ? "Loading..." : "No expiries"}</option> : null}
            {expiryOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          <span style={labelStyle}>Side</span>
          <select value={optionSide} onChange={(e) => setOptionSide(e.target.value as OptionSide)} style={inputStyle}>
            {SIDES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          <span style={labelStyle}>Strike</span>
          <select
            value={selectedStrike}
            onChange={(e) => setSelectedStrike(e.target.value)}
            style={inputStyle}
            disabled={loadingStrikes || !strikes.length}
          >
            {!strikes.length ? <option value="">{loadingStrikes ? "Loading..." : "No strikes"}</option> : null}
            {strikes.map((item) => (
              <option key={item.strike} value={String(item.strike)}>
                {buildStrikeLabel(item, optionSide)}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          <span style={labelStyle}>Manual Override</span>
          <input
            value={manualSymbol}
            onChange={(e) => setManualSymbol(e.target.value)}
            style={inputStyle}
            placeholder="Optional exact symbol"
          />
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => void runProbe()} style={buttonStyle} disabled={!effectiveSymbol.trim()}>
          Run Probe
        </button>
        <div style={{ fontSize: 12, color: statusColor(status), fontWeight: 700, letterSpacing: "0.04em" }}>
          {status === "idle" ? "Ready" : status === "loading" ? "Waiting for proxy event..." : status === "found" ? "Found" : status === "not-found" ? "Not found" : "Error"}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <InfoCard label="Root" value={chainRootSymbol || "-"} />
        <InfoCard label="Expiry" value={expiry || "-"} />
        <InfoCard label="Side" value={optionSide.toUpperCase()} />
        <InfoCard label="Strike" value={selectedStrike || "-"} />
        <InfoCard label="Built Symbol" value={builtSymbol || "-"} />
        <InfoCard label="Selected Symbol" value={effectiveSymbol || "-"} />
        <InfoCard label="Feed Type" value={feedType} />
        <InfoCard label="Elapsed" value={result ? `${result.elapsedMs} ms` : "-"} />
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
            {result.note ? <div style={{ marginBottom: 10, fontSize: 13, color: "#ffd166" }}>{result.note}</div> : null}
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

function statusColor(status: ProbeStatus) {
  if (status === "found") return "#00e676";
  if (status === "not-found") return "#ffb703";
  if (status === "error") return "#ff5d73";
  if (status === "loading") return "#00e5ff";
  return "#8da8c2";
}

const labelStyle: React.CSSProperties = {
  color: "#8da8c2",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const inputStyle: React.CSSProperties = {
  height: 40,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "#0a0f16",
  color: "#f5fbff",
  padding: "0 12px",
  outline: "none",
};

const buttonStyle: React.CSSProperties = {
  height: 42,
  padding: "0 16px",
  borderRadius: 10,
  border: "1px solid rgba(0,229,255,0.24)",
  background: "linear-gradient(180deg, #0fe6ff 0%, #00a7d6 100%)",
  color: "#03131a",
  fontWeight: 800,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  cursor: "pointer",
};
