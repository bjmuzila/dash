"use client";

/**
 * DailyEmPanel — port of the vanilla index.html Daily Estimated Moves panel.
 *
 * Shows ESM6 and NQM6 daily estimated moves (1UP, 1DN, EM range, %MOVE).
 *
 * Logic matches vanilla:
 *   - Computed window: 4–6pm ET (EM is captured for *tomorrow*)
 *   - Outside window: render from localStorage cache only
 *   - Cache key: nav_daily_em_v1
 *   - Data: chains/SPX + chains/NDX for IV straddle, em-closes for futures close
 */

import { useEffect, useRef, useState, useCallback } from "react";

const PROXY = process.env.NEXT_PUBLIC_PROXY_URL ?? "https://vanila-8zn1.onrender.com";
const CACHE_KEY = "nav_daily_em_v1";

// ─── helpers ─────────────────────────────────────────────────────────────────
function getEtNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function isInEmWindow(): boolean {
  const now = getEtNow();
  const dow = now.getDay();
  if (dow === 0 || dow === 6) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= 16 * 60 && mins <= 18 * 60;
}

function isMarketHours(): boolean {
  const now = getEtNow();
  const dow = now.getDay();
  if (dow === 0 || dow === 6) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= 9.5 * 60 && mins < 16 * 60;
}

function nextWeekday(from: Date): string {
  const base = from.toISOString().slice(0, 10);
  const d = new Date(base + "T12:00:00Z");
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

function getCacheKeyDate(): string {
  const now = getEtNow();
  if (isInEmWindow()) return nextWeekday(now);
  const dow = now.getDay();
  if (dow === 0 || dow === 6) return nextWeekday(now);
  return now.toISOString().slice(0, 10);
}

function calcDTE(expDateStr: string): number {
  return Math.ceil((new Date(expDateStr + "T16:00:00").getTime() - Date.now()) / 86400000);
}

function optMid(leg: Record<string, unknown> | null | undefined): number {
  if (!leg) return 0;
  const bid = parseFloat(String(leg.bid || leg["bid-price"] || 0));
  const ask = parseFloat(String(leg.ask || leg["ask-price"] || 0));
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  const mark = parseFloat(String(leg.mark || leg["mark-price"] || leg["mid-price"] || 0));
  if (mark > 0) return mark;
  const last = parseFloat(String(leg.last || leg["last-price"] || 0));
  return last > 0 ? last : 0;
}

function fmtFut(n: number): string {
  if (!isFinite(n) || n <= 0) return "x";
  return (Math.round(n * 4) / 4).toFixed(2);
}

function fmtPct(n: number): string {
  if (!isFinite(n) || n <= 0) return "x";
  return (n * 100).toFixed(2) + "%";
}

// ─── types ───────────────────────────────────────────────────────────────────
interface EMResult {
  close: number;
  em: number;
  exp: string;
}

interface CachedEM {
  date: string;
  esClose: number;
  esEm: number;
  esExp: string;
  nqClose: number;
  nqEm: number;
}

// ─── data fetching ────────────────────────────────────────────────────────────
async function getCloses(): Promise<{ spx: number; es: number; ndx: number; nq: number }> {
  if (isMarketHours()) {
    try {
      const r = await fetch(`${PROXY}/proxy/api/tt/quotes-batch?symbols=SPX,NDX,/ES:XCME,/NQ:XCME`);
      if (r.ok) {
        const d = await r.json();
        const items: Record<string, unknown>[] = d?.data?.items || d?.items || [];
        const bySymbol: Record<string, Record<string, unknown>> = {};
        items.forEach((item) => { if (item?.symbol) bySymbol[String(item.symbol)] = item; });
        const getPrice = (...keys: string[]) => {
          for (const k of keys) {
            const v = parseFloat(String(bySymbol[k]?.last || bySymbol[k]?.mid || bySymbol[k]?.bid || 0));
            if (v > 0) return v;
          }
          return 0;
        };
        const spx = getPrice("SPX", "$SPX");
        const ndx = getPrice("NDX", "$NDX");
        const es = getPrice("/ES:XCME", "/ESM6", "/ESM26");
        const nq = getPrice("/NQ:XCME", "/NQM6", "/NQM26");
        if (spx > 0 && ndx > 0) return { spx, es: es || spx, ndx, nq: nq || ndx };
      }
    } catch (_) {}
  }

  // Outside market hours — use em-closes
  const etNow = getEtNow();
  const todayStr = etNow.toISOString().slice(0, 10);
  const url = `${PROXY}/proxy/api/tt/em-closes` + (isInEmWindow() ? `?closeDate=${todayStr}` : "");
  const r = await fetch(url);
  if (!r.ok) throw new Error("em-closes failed: " + r.status);
  const d = await r.json();
  const data = d?.data || d || {};
  if (!data.spx) throw new Error("SPX close = 0");
  if (!data.ndx) throw new Error("NDX close = 0");
  return { spx: data.spx, es: data.es || data.spx, ndx: data.ndx, nq: data.nq || data.ndx };
}

async function getStraddle(indexSym: string, spotClose: number): Promise<EMResult | null> {
  const ny = getEtNow();
  const today = ny.toISOString().slice(0, 10);
  const dow = ny.getDay();

  function nextTradingDay(): string {
    const d = new Date(today + "T12:00:00Z");
    do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    return d.toISOString().slice(0, 10);
  }

  let expirations: string[];
  if (dow === 0 || dow === 6) {
    expirations = [nextTradingDay()];
  } else if (isInEmWindow()) {
    expirations = [nextTradingDay()];
  } else {
    const d1 = new Date(today + "T12:00:00Z");
    d1.setUTCDate(d1.getUTCDate() + 1);
    const tomorrow = d1.toISOString().slice(0, 10);
    const monday = nextTradingDay();
    expirations = [...new Set([today, tomorrow, monday])];
  }

  for (const expStr of expirations) {
    try {
      const chainUrl = `${PROXY}/proxy/api/tt/chains/${encodeURIComponent(indexSym)}?range=all&expiration=${encodeURIComponent(expStr)}&noSubscribe=1`;
      const r = await fetch(chainUrl);
      if (!r.ok) continue;
      const j = await r.json();

      type StrikeGroup = { "expiration-date"?: string; strikes?: Record<string, unknown>[] };
      const sortedGroups: Array<{ dateStr: string; group: StrikeGroup }> = ((j.data?.items || []) as StrikeGroup[])
        .map((g) => ({ dateStr: String(g["expiration-date"] || "").trim(), group: g }))
        .filter((x) => x.dateStr)
        .sort((a, b) => a.dateStr.localeCompare(b.dateStr));

      const candidateGroups = sortedGroups
        .filter((x) => x.dateStr >= expStr).map((x) => x.group)
        .concat(sortedGroups.filter((x) => x.dateStr < expStr).map((x) => x.group));

      for (const expGroup of candidateGroups) {
        const groupExp = String(expGroup["expiration-date"] || "").trim();
        const strikes = expGroup.strikes || [];
        if (!strikes.length) continue;

        // Find ATM strike closest to spotClose
        let atm = strikes[0];
        let minDist = Infinity;
        for (const s of strikes) {
          const dist = Math.abs(parseFloat(String(s["strike-price"])) - spotClose);
          if (dist < minDist) { minDist = dist; atm = s; }
        }

        const call = atm?.call as Record<string, unknown> | undefined;
        const put = atm?.put as Record<string, unknown> | undefined;
        let callMid = optMid(call);
        let putMid = optMid(put);
        const dte = calcDTE(groupExp);
        let em = 0;

        if (indexSym === "NDX") {
          // NDX: straddle-based
          if ((callMid <= 0 || putMid <= 0)) {
            const callSym = String(call?.["streamer-symbol"] || call?.symbol || "");
            const putSym = String(put?.["streamer-symbol"] || put?.symbol || "");
            if (callSym || putSym) {
              try {
                const syms = [callSym, putSym].filter(Boolean);
                const mr = await fetch(`${PROXY}/proxy/api/tt/option-marks?symbols=${encodeURIComponent(syms.join(","))}`);
                if (mr.ok) {
                  const md = await mr.json();
                  const marks: Record<string, Record<string, unknown>> = {};
                  (md?.data?.items || []).forEach((m: Record<string, unknown>) => { if (m?.symbol) marks[String(m.symbol)] = m; });
                  if (callSym && marks[callSym] && callMid <= 0) callMid = optMid(marks[callSym]);
                  if (putSym && marks[putSym] && putMid <= 0) putMid = optMid(marks[putSym]);
                }
              } catch (_) {}
            }
          }
          const straddle = callMid + putMid;
          em = straddle > 0 ? straddle * 0.85 : spotClose * 0.02 * 0.85;
        } else {
          // SPX: IV formula primary, straddle fallback
          let callIV = parseFloat(String(call?.["implied-volatility"] || call?.iv || 0));
          let putIV = parseFloat(String(put?.["implied-volatility"] || put?.iv || 0));

          // option-marks fallback
          const callSym = String(call?.["streamer-symbol"] || call?.symbol || "");
          const putSym = String(put?.["streamer-symbol"] || put?.symbol || "");
          if ((callMid <= 0 || putMid <= 0 || callIV <= 0 || putIV <= 0) && (callSym || putSym)) {
            try {
              const syms = [callSym, putSym].filter(Boolean);
              const mr = await fetch(`${PROXY}/proxy/api/tt/option-marks?symbols=${encodeURIComponent(syms.join(","))}`);
              if (mr.ok) {
                const md = await mr.json();
                const marks: Record<string, Record<string, unknown>> = {};
                (md?.data?.items || []).forEach((m: Record<string, unknown>) => { if (m?.symbol) marks[String(m.symbol)] = m; });
                if (callSym && marks[callSym]) {
                  if (callMid <= 0) callMid = optMid(marks[callSym]);
                  if (callIV <= 0) callIV = parseFloat(String(marks[callSym]?.["implied-volatility"] || marks[callSym]?.iv || 0));
                }
                if (putSym && marks[putSym]) {
                  if (putMid <= 0) putMid = optMid(marks[putSym]);
                  if (putIV <= 0) putIV = parseFloat(String(marks[putSym]?.["implied-volatility"] || marks[putSym]?.iv || 0));
                }
              }
            } catch (_) {}
          }

          const avgIV = (callIV + putIV) / 2;
          if (avgIV > 0 && dte > 0) {
            em = 0.84 * avgIV * spotClose * Math.sqrt(dte / 365);
          } else {
            const straddle = callMid + putMid;
            em = straddle > 0 ? straddle * 0.85 : spotClose * 0.02 * 0.85;
          }
        }

        if (em > 0) return { close: spotClose, em, exp: groupExp };
      }
    } catch (_) {}
  }

  // Fallback: 2% historical estimate
  return { close: spotClose, em: spotClose * 0.02 * 0.85, exp: getCacheKeyDate() };
}

// ─── sub-panel for one future ─────────────────────────────────────────────────
interface FutureDisplayProps {
  label: string;
  pfx: string;
  data: { close: number; em: number } | null;
}

function FutureDisplay({ label, pfx, data }: FutureDisplayProps) {
  const close = data?.close ?? 0;
  const em = data?.em ?? 0;
  const hasData = close > 0 && em > 0;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#00e5ff", letterSpacing: ".1em" }}>{label}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }} id={`em-${pfx}-grid`}>
        {[
          { id: "1up",   label: "1 UP",   val: hasData ? fmtFut(close + em) : "x", color: "#00e676" },
          { id: "1dn",   label: "1 DN",   val: hasData ? fmtFut(close - em) : "x", color: "#ff5252" },
          { id: "range", label: "EM",     val: hasData ? fmtFut(em)          : "x", color: "#e8c060" },
          { id: "pct",   label: "%MOVE",  val: hasData ? fmtPct(em / close)  : "x", color: "#a0d4ff" },
        ].map(({ id, label: cellLabel, val, color }) => (
          <div
            key={id}
            id={`em-${pfx}-${id}`}
            style={{
              background: "#060f1a",
              border: "1px solid #1a2a3a",
              borderRadius: 2,
              padding: "4px 6px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 9, color: "#ffffff", letterSpacing: ".08em", marginBottom: 2 }}>{cellLabel}</div>
            <div style={{ fontSize: id === "1up" || id === "1dn" ? 14 : 13, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
              {val}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────
export default function DailyEmPanel() {
  const [esData, setEsData] = useState<{ close: number; em: number } | null>(null);
  const [nqData, setNqData] = useState<{ close: number; em: number } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "live" | "cached">("idle");
  const busyRef = useRef(false);

  const loadEM = useCallback(async (forceRefresh = false) => {
    if (busyRef.current) return;

    // Try cache first
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached: CachedEM = JSON.parse(raw);
        if (cached.date === getCacheKeyDate()) {
          setEsData({ close: cached.esClose, em: cached.esEm });
          setNqData({ close: cached.nqClose, em: cached.nqEm });
          setStatus("cached");
          // Outside EM window: cache read only, no recompute
          if (!forceRefresh && !isInEmWindow()) return;
        }
      }
    } catch (_) {}

    // Outside EM window and no cache → show waiting state
    if (!forceRefresh && !isInEmWindow()) {
      setStatus("idle");
      return;
    }

    busyRef.current = true;
    setStatus("loading");
    try {
      const closes = await getCloses();
      const [esResult, nqResult] = await Promise.allSettled([
        getStraddle("SPX", closes.spx),
        getStraddle("NDX", closes.ndx),
      ]);

      const esR = esResult.status === "fulfilled" ? esResult.value : null;
      const nqR = nqResult.status === "fulfilled" ? nqResult.value : null;

      if (esR) setEsData({ close: closes.es, em: esR.em });
      if (nqR) setNqData({ close: closes.nq, em: nqR.em });

      if (esR && nqR) {
        const record: CachedEM = {
          date: getCacheKeyDate(),
          esClose: closes.es,
          esEm: esR.em,
          esExp: esR.exp,
          nqClose: closes.nq,
          nqEm: nqR.em,
        };
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(record)); } catch (_) {}
      }
      setStatus("live");
    } catch (e) {
      console.error("[DailyEM]", e);
      setStatus("idle");
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadEM();
    // Re-run every 5 minutes — if we're in the EM window it will recompute
    const interval = setInterval(() => loadEM(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadEM]);

  const statusColor = status === "live" ? "#00e676" : status === "cached" ? "#29b6f6" : status === "loading" ? "#00e5ff" : "#3a5570";
  const statusText  = status === "live" ? "LIVE" : status === "cached" ? "CACHED" : status === "loading" ? "..." : "WAITING";

  return (
    <div
      style={{
        borderTop: "1px solid #0d1825",
        background: "rgba(4,7,12,.6)",
        padding: "10px 10px 12px",
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "#ffb300", fontWeight: 700 }}>
          Daily Est. Moves
        </span>
        <span style={{ fontSize: 9, color: statusColor, fontWeight: 700, letterSpacing: ".08em" }}>{statusText}</span>
      </div>

      {/* ES */}
      <FutureDisplay label="ESM6" pfx="es" data={esData} />

      {/* Divider + NQ */}
      <div style={{ borderTop: "1px solid #0d1825", paddingTop: 10 }}>
        <FutureDisplay label="NQM6" pfx="nq" data={nqData} />
      </div>

      {/* Buttons */}
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button
          onClick={() => loadEM(true)}
          disabled={status === "loading"}
          style={{
            flex: 1,
            padding: "3px 0",
            background: "transparent",
            border: "1px solid #1e3050",
            color: "#3a5570",
            fontSize: 9,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            cursor: "pointer",
            fontFamily: "Arial, sans-serif",
            borderRadius: 2,
          }}
        >
          REFRESH
        </button>
      </div>
    </div>
  );
}
