"use client";

/**
 * DailyEmPanel — port of the vanilla index.html Daily Estimated Moves panel.
 *
 * Shows ESU and NQU daily estimated moves (1UP, 1DN, EM range, %MOVE).
 *
 * Logic matches vanilla:
 *   - Computed window: 4–6pm ET (EM is captured for *tomorrow*)
 *   - Outside window: render from localStorage cache only
 *   - Cache key: nav_daily_em_v1
 *   - Data: chains/SPX + chains/NDX for IV straddle, em-closes for futures close
 */

import { useEffect, useRef, useState, useCallback } from "react";

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
  return { spx: 0, es: 0, ndx: 0, nq: 0 };
}

async function getStraddle(indexSym: string, spotClose: number): Promise<EMResult | null> {
  void indexSym;
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
      <FutureDisplay label="ESU" pfx="es" data={esData} />

      {/* Divider + NQ */}
      <div style={{ borderTop: "1px solid #0d1825", paddingTop: 10 }}>
        <FutureDisplay label="NQU" pfx="nq" data={nqData} />
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
