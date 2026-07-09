"use client";

// CompactOptionChain — a trimmed-down, embeddable GEX matrix for dashboard
// grids (built for /new-home). Same data source + math as the full
// /options-chain page (parseExpiration's GEX formula, live expirations from
// /api/expirations, per-expiration chains from /api/chains), but with none of
// that page's own chrome: no ticker input, no GO button, no mode toggles.
// Driven entirely by props — `ticker` is expected to come from a page-level
// ticker switcher. Always GEX / OI+Vol / live (no flow, no Δ-vs-time).

import { useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME as HT, LIGHT_BLUE } from "@/components/shared/homeTheme";

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

// ── date/session helpers (copied from /options-chain, trimmed) ─────────────
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
  const holidays: Array<[number, number]> = [[1, 1], [7, 4], [12, 25]];
  if (holidays.some(([m, d]) => month === m && day === d)) return true;
  const dow = date.getDay();
  if (dow === 5) {
    const sat = new Date(date.getFullYear(), date.getMonth(), day + 1);
    if (holidays.some(([m, d]) => sat.getMonth() + 1 === m && sat.getDate() === d)) return true;
  }
  if (dow === 1) {
    const sun = new Date(date.getFullYear(), date.getMonth(), day - 1);
    if (holidays.some(([m, d]) => sun.getMonth() + 1 === m && sun.getDate() === d)) return true;
  }
  return false;
}
function isTradingDay(date: Date): boolean {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false;
  if (isHoliday(date)) return false;
  return true;
}
function isSessionLive(): boolean {
  const et = etToday();
  if (!isTradingDay(et)) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}
function isSpxFeedLive(): boolean {
  const et = etToday();
  const dow = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  if (mins >= 16 * 60 && mins < 18 * 60) return false;
  if (dow === 6) return false;
  if (dow === 0) return mins >= 20 * 60;
  if (dow === 5) return mins < 16 * 60;
  return true;
}
function fmtExpHeader(iso: string): string {
  const dt = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(dt.getTime())) return iso;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${days[dt.getUTCDay()]} ${mm}-${dd}`;
}
function fmtMoney(value: number) {
  const sign = value >= 0 ? "+" : "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
function metricBg(value: number, maxValue: number, topValues: number[]) {
  const n = value || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return "transparent";
  const pos = n >= 0;
  const rank = topValues.indexOf(Math.abs(n)) + 1;
  if (rank === 1) return pos ? "rgba(41,182,246,0.85)" : "rgba(255,71,87,0.85)";
  if (rank === 2) return pos ? "rgba(41,182,246,0.42)" : "rgba(255,71,87,0.42)";
  if (rank === 3) return pos ? "rgba(41,182,246,0.24)" : "rgba(255,71,87,0.24)";
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio * 1.75, 1.4);
  const alpha = Math.min(0.18, 0.02 + eased * 0.16);
  return pos ? `rgba(41,182,246,${alpha.toFixed(2)})` : `rgba(255,71,87,${alpha.toFixed(2)})`;
}

type GreekCell = { gex: number };
type ExpColumn = { expiration: string; cells: Map<number, GreekCell>; underlying: number };

// Parse one expiration's raw chain payload into strike→GEX. Same formula as
// /options-chain's parseExpiration (OI+Vol contracts, live formula only).
function parseExpiration(items: unknown[], expDate: string, spot: number): Map<number, GreekCell> {
  const cells = new Map<number, GreekCell>();
  const target = (items as { "expiration-date"?: string; strikes?: unknown[] }[]).filter(
    (i) => String(i["expiration-date"] ?? "").slice(0, 10) === expDate.slice(0, 10),
  );
  const groups = target.length ? target : (items as { strikes?: unknown[] }[]);
  const S = spot > 0 ? spot : 0;

  groups.forEach((group) => {
    (group.strikes || []).forEach((item: unknown) => {
      const it = item as Record<string, unknown>;
      const strike = parseFloat(String(it["strike-price"] || 0));
      if (!strike) return;
      const c = it.call as Record<string, unknown> | undefined;
      const p = it.put as Record<string, unknown> | undefined;
      const num = (o: Record<string, unknown> | undefined, k: string) => (o ? parseFloat(String(o[k])) || 0 : 0);
      const cnt = (o: Record<string, unknown> | undefined) =>
        o
          ? (parseInt(String(o["open-interest"] ?? o.openInterest ?? 0), 10) || 0) +
            (parseInt(String(o.volume ?? 0), 10) || 0)
          : 0;
      const cc = cnt(c);
      const pc = cnt(p);
      const live = cc > 0 || pc > 0;
      const gex = live ? (num(c, "gamma") * cc - num(p, "gamma") * pc) * S * S * 0.01 * 100 : 0;
      cells.set(strike, { gex });
    });
  });

  return cells;
}

export default function CompactOptionChain({
  ticker,
  maxExpirations = 5,
  rows = 9,
}: {
  ticker: string;
  maxExpirations?: number;
  rows?: number;
}) {
  const [expiries, setExpiries] = useState<Array<{ value: string; label: string }>>([]);
  const [columns, setColumns] = useState<ExpColumn[]>([]);
  const [underlying, setUnderlying] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshSeed, setRefreshSeed] = useState(0);
  const loadTokenRef = useRef(0);

  // Real listed expirations for this ticker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await fetch(`/api/expirations?ticker=${encodeURIComponent(ticker)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const items: Array<Record<string, unknown>> = json?.data?.items ?? [];
        if (cancelled) return;
        if (!items.length) { setExpiries([]); return; }
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
        setExpiries(list);
      } catch {
        if (!cancelled) setExpiries([]);
      }
    })();
    return () => { cancelled = true; };
  }, [ticker]);

  // Load the front N expirations' chains once we know the real listings.
  useEffect(() => {
    if (!expiries.length) return;
    let cancelled = false;
    const token = ++loadTokenRef.current;

    (async () => {
      setLoading(true);
      setError(null);
      const today = etDateKey(etToday());
      const startIdx = Math.max(0, expiries.findIndex((e) => e.value === today));
      const targets = expiries.slice(startIdx, startIdx + maxExpirations);
      try {
        const results = await Promise.all(
          targets.map(async (t) => {
            const res = await fetch(`/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(t.value)}&range=all`);
            const json = await res.json().catch(() => null);
            const data = (json?.data as Record<string, unknown> | undefined) ?? undefined;
            const items = (data?.items as unknown[]) ?? [];
            const spot = parseFloat(String(data?.underlyingPrice ?? 0)) || 0;
            return { expiration: t.value, underlying: spot, cells: parseExpiration(items, t.value, spot) } as ExpColumn;
          }),
        );
        if (cancelled || token !== loadTokenRef.current) return;
        const withData = results.filter((c) => c.cells.size > 0);
        if (!withData.length) {
          setColumns([]);
          setUnderlying(0);
          setError(`No live chain data for ${ticker}.`);
        } else {
          setColumns(results);
          setUnderlying(withData.find((c) => c.underlying > 0)?.underlying ?? 0);
        }
      } catch {
        if (!cancelled) { setColumns([]); setUnderlying(0); setError(`Chain load failed for ${ticker}.`); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiries, ticker, maxExpirations, refreshSeed]);

  // Poll every 60s while the relevant feed is live — bumps refreshSeed, which
  // is in the load effect's deps above, so it actually refetches.
  useEffect(() => {
    const id = setInterval(() => {
      const isSpx = ticker.toUpperCase() === "SPX";
      const live = isSpx ? isSpxFeedLive() : isSessionLive();
      if (live && expiries.length) setRefreshSeed((s) => s + 1);
    }, 60000);
    return () => clearInterval(id);
  }, [ticker, expiries.length]);

  const allStrikes = useMemo(() => {
    const set = new Set<number>();
    columns.forEach((c) => c.cells.forEach((_v, k) => set.add(k)));
    return [...set].sort((a, b) => a - b);
  }, [columns]);

  const nearestStrike = useMemo(() => {
    if (!allStrikes.length) return 0;
    const ref = underlying > 0 ? underlying : allStrikes[Math.floor(allStrikes.length / 2)];
    return allStrikes.reduce((best, s) => (Math.abs(s - ref) < Math.abs(best - ref) ? s : best), allStrikes[0]);
  }, [allStrikes, underlying]);

  const visibleStrikes = useMemo(() => {
    if (!allStrikes.length) return [] as (number | null)[];
    const atmIndex = allStrikes.findIndex((s) => s === nearestStrike);
    if (atmIndex < 0) return [...allStrikes].sort((a, b) => b - a) as (number | null)[];
    const wing = Math.floor((rows - 1) / 2);
    const out: (number | null)[] = [];
    for (let k = wing; k >= 1; k--) {
      const idx = atmIndex + k;
      out.push(idx < allStrikes.length ? allStrikes[idx] : null);
    }
    out.push(nearestStrike);
    for (let k = 1; k <= wing; k++) {
      const idx = atmIndex - k;
      out.push(idx >= 0 ? allStrikes[idx] : null);
    }
    return out;
  }, [allStrikes, nearestStrike, rows]);

  const colScales = useMemo(() => {
    return columns.map((col) => {
      const vals: number[] = [];
      visibleStrikes.forEach((s) => {
        if (s == null) return;
        const v = col.cells.get(s)?.gex;
        if (v != null && v !== 0) vals.push(Math.abs(v));
      });
      const sorted = [...vals].sort((a, b) => b - a);
      return { max: sorted[0] ?? 1, top3: sorted.slice(0, 3) };
    });
  }, [columns, visibleStrikes]);

  const gridCols = Math.max(columns.length, maxExpirations);

  if (loading && !columns.length) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: HT.text, opacity: 0.5, fontSize: 15 }}>
        Loading {ticker} chain…
      </div>
    );
  }

  if (error || !visibleStrikes.length) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: HT.text, opacity: 0.5, fontSize: 15, textAlign: "center" }}>
        {error ?? `No chain data for ${ticker}.`}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `56px repeat(${gridCols}, minmax(0,1fr))`,
          fontSize: 15,
          letterSpacing: "0.06em",
          color: HT.text,
          borderBottom: `1px solid ${HT.border}`,
          paddingBottom: 8,
          marginBottom: 6,
        }}
      >
        <div />
        {Array.from({ length: gridCols }).map((_, i) => (
          <div key={i} style={{ textAlign: "center", fontWeight: 800 }}>
            {columns[i] ? fmtExpHeader(columns[i].expiration) : "—"}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, overflow: "auto" }}>
        {visibleStrikes.map((strike, r) => {
          if (strike == null) {
            return <div key={`pad-${r}`} style={{ display: "grid", gridTemplateColumns: `56px repeat(${gridCols}, minmax(0,1fr))`, padding: "4px 0" }} />;
          }
          const isAtm = strike === nearestStrike;
          return (
            <div
              key={strike}
              style={{
                display: "grid",
                gridTemplateColumns: `56px repeat(${gridCols}, minmax(0,1fr))`,
                alignItems: "center",
                borderRadius: 6,
                background: isAtm ? rgba(LIGHT_BLUE, 0.1) : "transparent",
                boxShadow: isAtm ? `inset 0 1px 0 ${rgba(LIGHT_BLUE, 0.4)}, inset 0 -1px 0 ${rgba(LIGHT_BLUE, 0.4)}` : undefined,
                padding: "4px 0",
              }}
            >
              <div style={{ fontSize: 15, textAlign: "center", fontWeight: 800, color: isAtm ? LIGHT_BLUE : HT.text, fontFamily: "var(--font-mono, monospace)" }}>
                {Number.isInteger(strike) ? strike.toFixed(0) : strike.toFixed(2)}
              </div>
              {Array.from({ length: gridCols }).map((_, colIdx) => {
                const col = columns[colIdx];
                const value = col?.cells.get(strike)?.gex ?? null;
                const scale = colScales[colIdx] ?? { max: 1, top3: [] as number[] };
                return (
                  <div
                    key={colIdx}
                    style={{
                      textAlign: "center",
                      fontSize: 15,
                      fontWeight: 700,
                      color: value == null ? HT.text : "#fff",
                      opacity: value == null ? 0.3 : 1,
                      fontFamily: "var(--font-mono, monospace)",
                      background: value != null ? metricBg(value, scale.max, scale.top3) : "transparent",
                      borderRadius: 4,
                      padding: "2px 0",
                    }}
                  >
                    {value == null ? "·" : fmtMoney(value)}
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
