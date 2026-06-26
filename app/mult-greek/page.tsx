"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";
import { HOME_THEME as HT, homeShellStyle, homeButtonStyle } from "@/components/shared/homeTheme";
// expirations always fetched fresh — no cache import needed

// ── Constants ─────────────────────────────────────────────────────────────────

const TICKERS = ["SPX", "SPY", "QQQ"] as const;
type Ticker = typeof TICKERS[number];

const NET_COLS  = ["gex", "dex", "chex", "vex"] as const;
type NetCol = typeof NET_COLS[number];

const COL_LABELS: Record<NetCol, string> = {
  gex: "NET GEX", dex: "NET DEX", chex: "NET CHEX", vex: "NET VEX",
};

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
  mvcStrike: number | null;
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

// True when `iso` (YYYY-MM-DD) is in the CURRENT trading week (Mon–Fri, ET).
// The DB-stored weekly EM only applies to current-week expirations.
function isCurrentWeekExp(iso: string): boolean {
  if (!iso) return false;
  const now = new Date(todayETStr() + "T12:00:00");
  const dow = now.getDay(); // 0=Sun..6=Sat
  const monday = new Date(now);
  const toMon = dow === 0 ? 1 : 1 - dow;
  monday.setDate(now.getDate() + toMon);
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);
  const d = new Date(iso + "T12:00:00");
  return d >= monday && d <= friday;
}

// Snap a target price to the nearest value present in `strikes`.
function nearestStrikeTo(target: number, strikes: number[]): number | null {
  if (!Number.isFinite(target) || !strikes.length) return null;
  let best = strikes[0];
  let bestD = Math.abs(strikes[0] - target);
  for (const s of strikes) {
    const dd = Math.abs(s - target);
    if (dd < bestD) { bestD = dd; best = s; }
  }
  return best;
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
      gex:  (Math.abs(cd.gamma ?? 0) * cc - Math.abs(pd.gamma ?? 0) * pc) * spot * spot * 0.01 * 100,
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

  // MVC = strike with the highest ABSOLUTE net GEX. Gets the gold star.
  let mvcStrike: number | null = null;
  let mvcAbs = 0;
  out.forEach(r => {
    const a = Math.abs(r.gex);
    if (a > mvcAbs) { mvcAbs = a; mvcStrike = r.strike; }
  });

  return { rows: out, maxAbs, top3, atmStrike, mvcStrike };
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
    totals.gex  += (Math.abs(cd.gamma ?? 0) * cc - Math.abs(pd.gamma ?? 0) * pc) * spot * spot * 0.01 * 100;
    totals.dex  += (Math.abs(cd.delta ?? 0) * cc - Math.abs(pd.delta ?? 0) * pc) * spot * 100;
    totals.chex += (-(cd.theta ?? 0) * cc + (pd.theta ?? 0) * pc) * spot * 100;
    totals.vex  += ((cd.vega ?? 0) * cc - (pd.vega ?? 0) * pc) * spot * 100;
  });
  return totals;
}

// ── Ticker Panel ──────────────────────────────────────────────────────────────

function TickerPanel({
  ticker, strikes, liveData, spot, contractMode, intensity, emLevels, showEm,
}: {
  ticker: Ticker;
  strikes: StrikeRow[];
  liveData: Record<string, LiveEntry>;
  spot: number;
  contractMode: "oivol" | "vol";
  intensity: number;
  emLevels: { close: number; em: number } | null;
  showEm: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  const computed = strikes.length
    ? computeRows(strikes, liveData, spot, contractMode)
    : null;

  // EM band strikes (snapped to this panel's strikes). Only when current-week.
  const emStrikes = (showEm && emLevels && computed)
    ? (() => {
        const ss = computed.rows.map(r => r.strike);
        const { close, em } = emLevels;
        return {
          d1: nearestStrikeTo(close - em, ss),
          u1: nearestStrikeTo(close + em, ss),
          d2: nearestStrikeTo(close - 2 * em, ss),
          u2: nearestStrikeTo(close + 2 * em, ss),
        };
      })()
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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: HT.panelBg, backdropFilter: "blur(16px)", border: `1px solid ${HT.border}`, borderRadius: 16, overflow: "hidden" }}>
      <style>{`@keyframes mvcGlow{0%,100%{box-shadow:0 0 3px rgba(255,255,255,.35)}50%{box-shadow:0 0 10px rgba(255,255,255,.85)}}.mvc-peak-cell{animation:mvcGlow 2.4s ease-in-out infinite}`}</style>

      {/* Panel header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "rgba(0,240,255,0.04)", borderBottom: `1px solid ${HT.border}`, flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: HT.cyan, letterSpacing: "0.1em" }}>{ticker}</span>
        <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 10, fontFamily: "monospace", color: "#94a3b8" }}>
          {spot > 0 && (
            <>
              <span style={{ color: "#00e5ff", fontWeight: 700 }}>{spot.toFixed(2)}</span>
            </>
          )}
          {spot === 0 && <span style={{ color: "#475569" }}>--</span>}
        </div>
      </div>

      {/* Column headers */}
      <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, background: HT.panelBgStrong, borderBottom: `1px solid ${HT.border}`, flexShrink: 0 }}>
        <div style={{ padding: "5px 4px", textAlign: "center", color: HT.muted, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>STRIKE</div>
        {NET_COLS.map(c => (
          <div key={c} style={{ padding: "5px 4px", textAlign: "center", color: HT.cyan, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>{COL_LABELS[c]}</div>
        ))}
      </div>

      {/* Totals row */}
      <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, background: "rgba(0,240,255,0.02)", borderBottom: `1px solid ${HT.border}`, flexShrink: 0 }}>
        <div style={{ padding: "4px 4px", fontSize: 9, fontWeight: 800, textAlign: "center", color: HT.muted, letterSpacing: "0.06em" }}>TOTAL</div>
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, fontSize: 11, color: "#475569", }}>
            Select an expiry and click GO
          </div>
        ) : computed.rows.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, fontSize: 11, color: "#475569", }}>
            No strikes in range
          </div>
        ) : computed.rows.map(r => {
          const strikeColor = r.isATM ? "#ffb300" : "#94a3b8";
          const rowBg = r.isATM ? "rgba(255,179,0,.07)" : "transparent";
          const atmOutline = r.isATM
            ? { outline: "1px solid rgba(255,255,255,.55)", outlineOffset: "-1px", position: "relative" as const, zIndex: 1 }
            : { borderBottom: "1px solid rgba(30,48,80,.35)" };
          const is1x = emStrikes != null && (r.strike === emStrikes.d1 || r.strike === emStrikes.u1);
          const is2x = emStrikes != null && (r.strike === emStrikes.d2 || r.strike === emStrikes.u2);
          const emBorder = is1x
            ? { borderTop: "2px solid rgba(255,255,255,.92)" }
            : is2x
            ? { borderTop: "2px dashed rgba(255,255,255,.85)" }
            : null;
          return (
            <div
              key={r.strike}
              data-strike={r.strike}
              style={{ display: "grid", gridTemplateColumns: GRID_COLS, background: rowBg, position: "relative", ...atmOutline, ...(emBorder ?? {}) }}
            >
              {(is1x || is2x) && (
                <span style={{
                  position: "absolute", top: -7, left: 3, zIndex: 3,
                  fontSize: 7, fontWeight: 800, letterSpacing: "0.04em",
                  color: "#0b0f1a", background: "rgba(255,255,255,.92)",
                  padding: "0 3px", borderRadius: 2, pointerEvents: "none",
                  fontFamily: "sans-serif",
                }}>{is1x ? "EM" : "2× EM"}</span>
              )}
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
                const isGexPeak = c === "gex" && r.strike === computed.mvcStrike;
                return (
                  <div key={c} className={isGexPeak ? "mvc-peak-cell" : undefined} style={{
                    padding: "4px 4px", fontSize: 11, fontFamily: "monospace",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    textAlign: "center", color: "#ffffff",
                    background: metricBg(r[c], computed.maxAbs[c], topRank, intensity),
                    fontWeight: weight,
                    position: "relative",
                    ...(topRank === 1 ? { outline: `1px solid ${r[c] >= 0 ? "rgba(41,182,246,.9)" : "rgba(255,71,87,.9)"}`, outlineOffset: "-1px", zIndex: 1 } : {}),
                    ...(isGexPeak ? { outline: "3px solid #ffffff", outlineOffset: "-3px", zIndex: 2 } : {}),
                  }}>
                    {topRank === 1 && (
                      <span style={{
                        position: "absolute", top: 1, left: 2, fontSize: 9, lineHeight: 1,
                        color: "#ffd600", textShadow: "0 0 2px rgba(0,0,0,.8)", pointerEvents: "none",
                      }}>★</span>
                    )}
                    {c === "gex" && r.strike === computed.mvcStrike && (
                      <span title="MVC — highest |net GEX|" style={{
                        position: "absolute", top: 1, right: 2, fontSize: 12, lineHeight: 1,
                        color: "#ffd600", textShadow: "0 0 3px rgba(0,0,0,.9)", pointerEvents: "none",
                      }}>★</span>
                    )}
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
  const [intensity, setIntensity] = useState(1.75);
  const [status, setStatus] = useState<{ state: "live" | "loading" | "err" | "idle"; msg: string }>({ state: "idle", msg: "READY" });
  const [lastUpdate, setLastUpdate] = useState("");

  // Per-ticker state
  const [strikes, setStrikes]   = useState<Record<Ticker, StrikeRow[]>>({ SPX: [], SPY: [], QQQ: [] });
  const [spots, setSpots]       = useState<Record<Ticker, number>>({ SPX: 0, SPY: 0, QQQ: 0 });
  // Per-ticker weekly EM (DB-backed via /api/levels) for the EM bands.
  const [emByTicker, setEmByTicker] = useState<Record<Ticker, { close: number; em: number } | null>>({ SPX: null, SPY: null, QQQ: null });
  const liveDataRef = useRef<Record<string, LiveEntry>>({});

  const loadTokenRef = useRef(0);
  const activeExpiryRef = useRef<string | null>(null);

  // Fetch weekly EM for all three tickers. Refreshes when the active expiry
  // changes so the bands stay in sync with each (cache-busted) chain reload.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(TICKERS.map(async (tk) => {
        const row = await fetch(`/api/levels?ticker=${encodeURIComponent(tk)}`)
          .then(r => r.json()).catch(() => null);
        const em = parseFloat(String(row?.em ?? ""));
        const close = parseFloat(String(row?.close ?? ""));
        const val = Number.isFinite(em) && em > 0 && Number.isFinite(close) && close > 0
          ? { close, em } : null;
        return [tk, val] as const;
      }));
      if (cancelled) return;
      setEmByTicker(prev => {
        const next = { ...prev };
        entries.forEach(([tk, val]) => { next[tk] = val; });
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [activeExpiry]);


  // Fetch expirations (from cache or API)
  useEffect(() => {
    const loadExpirations = async () => {
      // Primary: /api/expirations (TT format: { data: { items: [...] } }).
      // Fallback: derive expirations from the chain itself — the expirations
      // endpoint can return empty when the proxy's TT session is cold while the
      // market is closed; the chain endpoint stays populated (0DTE prewarmed).
      const collect = (items: Record<string, unknown>[]): Expiry[] => {
        const seen = new Set<string>();
        const list: Expiry[] = [];
        items.forEach((item) => {
          const d = String(item["expiration-date"] ?? "");
          if (!d || seen.has(d)) return;
          seen.add(d);
          const dt = daysTo(d);
          if (dt < 0) return;
          const expType = String(item["expiration-type"] ?? "").toLowerCase();
          const keep = dt <= 7 || expType === "weekly" || expType === "monthly" || new Date(d + "T12:00:00").getDay() === 5;
          if (!keep) return;
          list.push({ date: d, daysTo: dt, label: `${dt}DTE  ${d.slice(5)}` });
        });
        return list.sort((a, b) => a.daysTo - b.daysTo);
      };

      let list: Expiry[] = [];
      const json = await fetch("/api/expirations?ticker=SPX").then(r => r.json()).catch(() => null);
      if (json?.data?.items?.length) list = collect(json.data.items);

      if (!list.length) {
        const cj = await fetch("/api/chains?ticker=SPX&range=all").then(r => r.json()).catch(() => null);
        const items = (cj?.data?.items ?? []) as Record<string, unknown>[];
        if (items.length) list = collect(items);
      }

      if (!list.length) return;
      setExpirations(list);
      const dte0 = list.find(e => e.daysTo === 0) ?? list[0];
      if (dte0) { setSelectedExpiry(dte0.date); }
    };

    loadExpirations().catch(() => {});
  }, []);

  // Fetch chain for all tickers
  const loadAll = useCallback(async (expDate: string, bustCache = false) => {
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    setStatus({ state: "loading", msg: "LOADING..." });

    const bust = bustCache ? `&noCache=1` : "";
    const results = await Promise.allSettled(
      TICKERS.map(ticker =>
        fetch(`/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(expDate)}&range=all${bust}`)
          .then(async r => {
            const json = await r.json();
            return { ticker, json, ok: r.ok, status: r.status };
          })
      )
    );

    if (token !== loadTokenRef.current) return;

    const newStrikes: Partial<Record<Ticker, StrikeRow[]>> = {};
    const newSpots: Partial<Record<Ticker, number>> = {};
    const allSymbols = new Set<string>();
    let successCount = 0;
    const errStatuses: number[] = [];

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { ticker, json, ok, status } = result.value as { ticker: Ticker; json: Record<string, unknown>; ok: boolean; status: number };
      if (!ok || json.error) {
        errStatuses.push(status);
        console.error(`[MultGreek] ${ticker} chains failed: HTTP ${status}`, json);
        continue;
      }
      const items = (json.data as Record<string, unknown> | undefined)?.items as unknown[] ?? [];
      if (!items.length) continue;
      const target = (items as { "expiration-date"?: string }[]).filter(i =>
        String(i["expiration-date"] ?? "").slice(0, 10) === expDate.slice(0, 10)
      );
      const parsed = buildStrikes(target.length ? target : items as unknown[], liveDataRef.current);
      parsed.forEach(row => {
        if (row.callSym) allSymbols.add(row.callSym);
        if (row.putSym) allSymbols.add(row.putSym);
      });
      if (parsed.length) { newStrikes[ticker] = parsed; successCount++; }
      const rawSpot = parseFloat(String((json.data as Record<string, unknown> | undefined)?.underlyingPrice ?? 0));
      if (isFinite(rawSpot) && rawSpot > 0) newSpots[ticker] = rawSpot;
    }

    activeExpiryRef.current = expDate;
    setActiveExpiry(expDate);
    if (successCount > 0) {
      setStrikes(prev => ({ ...prev, ...newStrikes }));
      setSpots(prev => {
        const merged = { ...prev };
        (Object.keys(newSpots) as Ticker[]).forEach(tk => {
          const v = newSpots[tk as Ticker];
          if (v && v > 0) merged[tk as Ticker] = v;
        });
        return merged;
      });
    }

    if (successCount === 0) {
      const code = errStatuses[0] ?? "?";
      setStatus({ state: "err", msg: `PROXY ERR ${code}` });
    } else if (successCount < TICKERS.length) {
      setStatus({ state: "live", msg: `PARTIAL (${successCount}/${TICKERS.length})` });
    } else {
      setStatus({ state: isMarketOpen() ? "live" : "idle", msg: isMarketOpen() ? "LIVE" : "CLOSED" });
    }
    setLastUpdate(etTimeNow());
  }, []);


  const doGo = useCallback(() => {
    if (!selectedExpiry) return;
    loadAll(selectedExpiry);
  }, [selectedExpiry, loadAll]);

  // Auto-load when expirations are ready
  useEffect(() => {
    if (selectedExpiry && strikes.SPX.length === 0 && strikes.SPY.length === 0 && strikes.QQQ.length === 0) {
      loadAll(selectedExpiry);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExpiry]);

  // Safety net: if expirations never resolved (cold proxy / market closed),
  // still auto-load the prewarmed 0DTE SPX/SPY/QQQ chains by deriving the
  // nearest expiration from the chain response itself.
  useEffect(() => {
    const t = setTimeout(async () => {
      if (selectedExpiry || activeExpiryRef.current) return;
      const cj = await fetch("/api/chains?ticker=SPX&range=all").then(r => r.json()).catch(() => null);
      const items = (cj?.data?.items ?? []) as { "expiration-date"?: string }[];
      const dates = items.map(i => String(i["expiration-date"] ?? "")).filter(Boolean).sort();
      const nearest = dates.find(d => daysTo(d) >= 0) ?? dates[0];
      if (nearest) { setSelectedExpiry(nearest); }
    }, 2500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doRefresh = useCallback(async () => {
    const exp = activeExpiryRef.current;
    if (!exp) throw new Error("No expiry selected");
    await loadAll(exp, true);
  }, [loadAll]);

  // Auto-refresh: TT REST per-strike volume accumulates through the session and
  // resets stale at the open, so the one-shot load lands volume=0 for SPY/QQQ
  // (SPX is the only live-streamed underlying). Re-pull (cache-busted) every 60s
  // while the market is open so volume fills in for all three tickers.
  useEffect(() => {
    const id = setInterval(() => {
      const exp = activeExpiryRef.current;
      if (exp && isMarketOpen()) loadAll(exp, true);
    }, 60000);
    return () => clearInterval(id);
  }, [loadAll]);

  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(doRefresh);

  const statusColors: Record<string, string> = {
    live: "#00e676", loading: "#ffb300", err: "#ff4757", idle: "#475569",
  };

  const pageRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={pageRef} style={{ ...homeShellStyle, height: "100%", overflow: "hidden" }}>

      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
        background: HT.panelBgStrong, backdropFilter: "blur(16px)", borderBottom: `1px solid ${HT.border}`, flexShrink: 0, flexWrap: "wrap",
      }}>

        {/* Status dot */}
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColors[status.state] ?? "#475569", flexShrink: 0, display: "inline-block" }} />
        <span style={{ fontSize: 9, fontWeight: 800, color: statusColors[status.state] ?? "#e4e4e7", letterSpacing: "0.1em" }}>{status.msg}</span>

        <span style={{ color: HT.border }}>|</span>

        {/* Expiry select */}
        <select
          value={selectedExpiry}
          onChange={e => setSelectedExpiry(e.target.value)}
          style={{
            background: "rgba(0,0,0,0.4)", color: HT.text, border: `1px solid ${HT.border}`,
            borderRadius: 4, padding: "3px 8px", fontSize: 11, cursor: "pointer",
            fontFamily: "monospace", colorScheme: "dark",
          }}
        >
          <option value="" style={{ background: "#0b0f1a", color: HT.text }}>-- Expiry --</option>
          {expirations.map(exp => (
            <option key={exp.date} value={exp.date} style={{ background: "#0b0f1a", color: HT.text }}>{exp.label}</option>
          ))}
        </select>

        {/* GO button */}
        <button
          onClick={doGo}
          disabled={!selectedExpiry}
          style={{
            ...homeButtonStyle,
            padding: "3px 14px", fontSize: 10,
          }}
        >
          GO
        </button>

        <span style={{ color: HT.border }}>|</span>

        {/* Contract basis toggle: OI+VOL (default) or VOL-only. */}
        <div style={{ display: "flex", gap: 2, background: HT.panelBg, backdropFilter: "blur(8px)", borderRadius: 4, padding: 2 }}>
          {(["oivol", "vol"] as const).map(m => (
            <button
              key={m}
              onClick={() => setContractMode(m)}
              style={{
                padding: "2px 10px", fontSize: 9, fontWeight: 800, borderRadius: 3,
                border: "none", cursor: "pointer",
                background: contractMode === m ? "rgba(0,229,255,.15)" : "transparent",
                color: contractMode === m ? HT.cyan : "#64748b",
              }}
            >
              {m === "oivol" ? "OI+VOL" : "VOL"}
            </button>
          ))}
        </div>

        <span style={{ color: HT.border }}>|</span>

        {/* Intensity slider */}
        <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700 }}>Intensity</span>
        <input
          type="range" min={0.5} max={3} step={0.01}
          value={intensity}
          onChange={e => setIntensity(Number(e.target.value))}
          style={{ width: 80, height: 3, accentColor: "#00e5ff" }}
        />
        <span style={{ fontSize: 10, color: "#00e5ff", fontWeight: 700, minWidth: 36, fontFamily: "monospace" }}>
          {intensity.toFixed(2)}x
        </span>

        {/* Refresh / Snap / Discord */}
        <button onClick={trigger} style={{ marginLeft: "auto", ...homeButtonStyle }}>{btnLabel}</button>
        <BoxSnapBtn targetRef={pageRef} label="📷" />
        <BoxDiscordBtn targetRef={pageRef} message={`📊 Multi-Greek Exposure — ${new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false})} ET`} />

        {lastUpdate && (
          <span style={{ fontSize: 9, color: "#334155", fontFamily: "monospace" }}>{lastUpdate} ET</span>
        )}
      </div>

      {/* Panels */}
      <div className="mg-panels" style={{ flex: 1, display: "flex", gap: 8, padding: 8, overflow: "hidden", minHeight: 0 }}>
        {TICKERS.map(ticker => (
          <TickerPanel
            key={ticker}
            ticker={ticker}
            strikes={strikes[ticker]}
            liveData={liveDataRef.current}
            spot={spots[ticker]}
            contractMode={contractMode}
            intensity={intensity}
            emLevels={emByTicker[ticker]}
            showEm={!!activeExpiry && isCurrentWeekExp(activeExpiry)}
          />
        ))}
      </div>
    </div>
  );
}
