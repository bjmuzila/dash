"use client";

// HomeGaugeRail — segmented-LED gauge row for the /home right column. Replaces
// SignalsFeed. Six 0DTE SPX metrics as center-origin (signed) / left-origin
// (pct) tick meters. GEX, DEX and the 15-min GEX change are wired live off the
// shared /ws/gex feed (same seed + permanent-socket pattern as
// LiveGreeksGauges — always on, no toggle, no idle timeout). The three
// non-greek metrics come in as props from HomeClient.

import { useEffect, useRef, useState } from "react";
import { queryGreeksToday } from "@/lib/snapdb";
import { HOME_THEME, statTileStyle } from "@/components/shared/homeTheme";

const POS = "#1FD98A";
const NEG = "#f4948e";
const CYAN = HOME_THEME.cyan; // #219EBC
const TRACK = "rgba(255,255,255,0.08)";

interface Totals { ts: number; gex: number; dex: number } // gex/dex in billions

function totalsToPoint(
  t: Record<string, number> | null | undefined,
  updatedAtRaw: number | null | undefined,
): Totals | null {
  if (!t) return null;
  const dexOi = Number(t.totalDeltaCall ?? 0) + Number(t.totalDeltaPut ?? 0);
  const dex = Number(t.totalDeltaOiVol ?? dexOi) / 1e9;
  const gex = Number(t.totalGEXOiVol ?? t.totalGEX ?? 0) / 1e9;
  let ts = Number(updatedAtRaw);
  if (!Number.isFinite(ts) || ts <= 0) ts = Date.now();
  else if (ts < 1e12) ts *= 1000;
  return gex || dex ? { ts, gex, dex } : null;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// ── Segmented LED meter ──────────────────────────────────────────────────────
// t / midT are 0..1 normalized positions. kind "signed" fills from mid outward
// and draws a center tick; "pct" fills from the left edge.
function SegMeter({
  t,
  midT,
  color,
  kind,
  n = 20,
}: {
  t: number | null;
  midT: number;
  color: string;
  kind: "signed" | "pct";
  n?: number;
}) {
  const W = 118, H = 30, pad = 5, gap = 2.2;
  const segW = (W - pad * 2 - gap * (n - 1)) / n;
  const segH = 22, y = 4;
  const has = t != null && Number.isFinite(t);
  const tv = has ? clamp(t as number, 0, 1) : midT;
  const litFrom = kind === "pct" ? 0 : Math.min(tv, midT);
  const litTo = kind === "pct" ? tv : Math.max(tv, midT);
  const rects: JSX.Element[] = [];
  for (let i = 0; i < n; i++) {
    const s = i / n, e = (i + 1) / n;
    const on = has && e > litFrom + 1e-6 && s < litTo - 1e-6;
    const x = pad + i * (segW + gap);
    rects.push(
      <rect
        key={i}
        x={x}
        y={y}
        width={segW}
        height={segH}
        rx={2}
        fill={on ? color : "rgba(255,255,255,0.07)"}
        style={on ? { filter: `drop-shadow(0 0 3px ${color}cc)` } : undefined}
      />,
    );
  }
  // center tick for signed meters
  const midX = pad + midT * (W - pad * 2);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {rects}
      {kind === "signed" && (
        <rect x={midX - 0.6} y={y - 2} width={1.2} height={segH + 4} fill="rgba(255,255,255,0.4)" />
      )}
    </svg>
  );
}

interface GaugeDef {
  label: string;
  value: number | null;
  t: number | null;         // normalized 0..1
  midT: number;             // normalized center
  kind: "signed" | "pct";
  color: string;
  fmt: (v: number) => string;
}

function Cell({ g }: { g: GaugeDef }) {
  const has = g.value != null && Number.isFinite(g.value);
  return (
    <div
      style={{
        ...statTileStyle,
        padding: "10px 8px 9px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 9.5,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.45)",
          textAlign: "center",
          minHeight: 22,
          display: "flex",
          alignItems: "center",
          lineHeight: 1.15,
        }}
      >
        {g.label}
      </div>
      <SegMeter t={g.t} midT={g.midT} color={g.color} kind={g.kind} />
      <div
        style={{
          fontSize: 14,
          fontWeight: 800,
          fontVariantNumeric: "tabular-nums",
          color: has ? g.color : "rgba(255,255,255,0.35)",
        }}
      >
        {has ? g.fmt(g.value as number) : "--"}
      </div>
    </div>
  );
}

// ── formatters ───────────────────────────────────────────────────────────────
const fmtB = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}B`;
const fmtDex = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}B`;
const fmtPct = (v: number) => `${v.toFixed(0)}%`;
const fmtRatio = (v: number) => `${v.toFixed(2)}x`;
const fmtIb = (v: number) => `${v >= 50 ? "▲ " : "▼ "}${v.toFixed(0)}%`;

export interface HomeGaugeRailProps {
  /** Vol-only 0DTE gamma as a share of total gamma, 0–100. */
  gammaPctVol?: number | null;
  /** Call/put gamma ratio (1.0 = balanced). */
  cpg?: number | null;
  /** Initial Balance direction, 0–100 (>50 = up-day lean). */
  ibDirection?: number | null;
}

export default function HomeGaugeRail({
  gammaPctVol = null,
  cpg = null,
  ibDirection = null,
}: HomeGaugeRailProps) {
  const [latest, setLatest] = useState<Totals | null>(null);
  const [history, setHistory] = useState<Totals[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Seed today's persisted greeks so the rail paints instantly (and so the
  // 15-min lookback has history the moment the socket connects).
  useEffect(() => {
    queryGreeksToday()
      .then((rows) => {
        if (!mountedRef.current || !rows.length) return;
        const pts = rows
          .map((r) => ({ ts: Number(r.timestamp), gex: Number(r.gex), dex: Number(r.dex) }))
          .filter((p) => Number.isFinite(p.ts) && p.ts > 0)
          .sort((a, b) => a.ts - b.ts);
        setHistory(pts);
        setLatest(pts[pts.length - 1] ?? null);
      })
      .catch(() => {});
  }, []);

  // Permanent /ws/gex socket — always on (mirrors LiveGreeksGauges).
  useEffect(() => {
    let unmounted = false;
    let ws: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    const frame: { totals: Record<string, number> | null; updatedAt: number } = { totals: null, updatedAt: 0 };

    const apply = () => {
      if (!frame.totals || !mountedRef.current) return;
      const p = totalsToPoint(frame.totals, frame.updatedAt || Date.now());
      if (!p) return;
      setLatest(p);
      setHistory((prev) => {
        const bucket = Math.floor(p.ts / 15000);
        const filtered = prev.filter((r) => Math.floor(r.ts / 15000) !== bucket);
        return [...filtered, p].sort((a, b) => a.ts - b.ts).slice(-1500);
      });
    };

    const handle = (raw: string) => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      const type = String(m.type ?? "");
      const d = (m.data && typeof m.data === "object" ? m.data : m) as Record<string, unknown>;
      if (type === "snapshot" || type === "gex") {
        if (d.totals) frame.totals = d.totals as Record<string, number>;
        if (d.updatedAt) frame.updatedAt = Number(d.updatedAt);
        apply();
      }
    };

    const scheduleReconnect = () => {
      if (unmounted) return;
      if (reconnect) clearTimeout(reconnect);
      reconnect = setTimeout(connect, 2000);
    };

    function connect() {
      if (unmounted) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      try {
        ws = new WebSocket(`${proto}//${window.location.host}/ws/gex`);
      } catch {
        scheduleReconnect();
        return;
      }
      ws.onmessage = (evt) => handle(String(evt.data));
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {}
      };
      ws.onclose = () => {
        if (!unmounted) scheduleReconnect();
      };
    }

    connect();
    return () => {
      unmounted = true;
      if (reconnect) clearTimeout(reconnect);
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        try {
          ws.close();
        } catch {}
      }
    };
  }, []);

  const gex = latest?.gex ?? null;
  const dex = latest?.dex ?? null;

  // 15-min GEX change (all strikes): current − the earliest sample within the
  // last 15 min (nearest to the 15-min-ago mark).
  const gexChg = (() => {
    if (gex == null || !history.length) return null;
    const now = latest?.ts ?? history[history.length - 1].ts;
    const cutoff = now - 15 * 60_000;
    const past = history.filter((p) => p.ts <= cutoff);
    const ref = past.length ? past[past.length - 1] : history[0];
    if (!ref) return null;
    return gex - ref.gex;
  })();

  // Self-scaling for the signed greek meters (today's max |value|).
  const scaleOf = (sel: (p: Totals) => number, cur: number | null) => {
    const m = Math.max(0, ...history.map((p) => Math.abs(sel(p))), Math.abs(cur ?? 0));
    return m > 0 ? m : 1;
  };
  const gexScale = scaleOf((p) => p.gex, gex);
  const dexScale = scaleOf((p) => p.dex, dex);
  const chgScale = Math.max(
    0.05,
    ...history.map((p, i) => (i > 0 ? Math.abs(p.gex - history[i - 1].gex) : 0)),
    Math.abs(gexChg ?? 0),
  );

  // signed → normalized 0..1 with 0.5 = center
  const signedT = (v: number | null, scale: number) => (v == null ? null : clamp(0.5 + v / (2 * scale), 0, 1));

  const gauges: GaugeDef[] = [
    { label: "Gamma (Net GEX)", value: gex, t: signedT(gex, gexScale), midT: 0.5, kind: "signed", color: gex == null ? CYAN : gex >= 0 ? POS : NEG, fmt: fmtB },
    { label: "Delta (DEX)", value: dex, t: signedT(dex, dexScale), midT: 0.5, kind: "signed", color: dex == null ? CYAN : dex >= 0 ? POS : NEG, fmt: fmtDex },
    { label: "Gamma % 0DTE (Vol)", value: gammaPctVol, t: gammaPctVol == null ? null : clamp(gammaPctVol / 100, 0, 1), midT: 0, kind: "pct", color: CYAN, fmt: fmtPct },
    { label: "CPG Ratio", value: cpg, t: cpg == null ? null : clamp(cpg / 2, 0, 1), midT: 0.5, kind: "signed", color: cpg == null ? CYAN : cpg >= 1 ? POS : NEG, fmt: fmtRatio },
    { label: "IB Direction", value: ibDirection, t: ibDirection == null ? null : clamp(ibDirection / 100, 0, 1), midT: 0.5, kind: "signed", color: ibDirection == null ? CYAN : ibDirection >= 50 ? POS : NEG, fmt: fmtIb },
    { label: "0DTE GEX Δ 15m", value: gexChg, t: signedT(gexChg, chgScale), midT: 0.5, kind: "signed", color: gexChg == null ? CYAN : gexChg >= 0 ? POS : NEG, fmt: fmtB },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 8 }}>
      {gauges.map((g) => (
        <Cell key={g.label} g={g} />
      ))}
    </div>
  );
}
