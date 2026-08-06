"use client";

// HomeGaugeRail — segmented-LED gauge row for the /home right column. Replaces
// SignalsFeed. Six 0DTE SPX metrics as center-origin (signed) / left-origin
// (pct) tick meters. GEX, DEX, the Net GEX rate and the 15-min GEX change are
// wired live off the shared /ws/gex feed (same seed + permanent-socket pattern
// as LiveGreeksGauges — always on, no toggle, no idle timeout). The two
// non-greek metrics come in as props from HomeClient.
//
// "Net GEX Rate / min" replaced the old CPG (call/put gamma) ratio tile: the
// ratio described the shape of the book, but not how fast it was changing.
// The rate is $B of gamma-per-1%-move added (+) or pulled (−) per minute, and
// it is derived here rather than passed in — the rail already keeps the GEX
// history the calculation needs.
//
// Each tile also carries a 15-minute change line under its value. That line is
// driven by a per-tile ring buffer of one-minute samples (see useDelta15m) —
// NOT by value − prevValue, which would report the change since the last socket
// frame and mislabel it as a 15-minute move.

import { useEffect, useRef, useState } from "react";
import { queryGreeksToday } from "@/lib/snapdb";
import { subscribeGex, type GexMessage } from "@/lib/gexSocket";

// Only branches on snapshot/gex, and reads `totals` — which the snapshot only
// carries when "gex" is in the scope.
const RAIL_TOPICS = ["gex"] as const;
import { HOME_THEME, statTileStyle } from "@/components/shared/homeTheme";

// GEX heatmap palette — positive/calls blue, negative/puts red (see GexHeatmap cellBg).
const POS = "#29B6F6"; // rgb(41,182,246)
const NEG = "#FF4757"; // rgb(255,71,87)
const CYAN = HOME_THEME.cyan; // #219EBC — fallback tint only
const TRACK = "rgba(255,255,255,0.08)";

// HOME_THEME.muted is the muted *token*; it resolves to the same value as
// .text, so the muted role is expressed as token + this opacity rather than a
// second hex. Matches the dimmed "--" placeholder already used for empty tiles.
const MUTED_OPACITY = 0.45;

// ── 15-minute change ─────────────────────────────────────────────────────────
const MINUTE_MS = 60_000;
/** Lookback for the change line. */
const WINDOW_MS = 15 * MINUTE_MS;
/** ~16 one-minute samples: just enough to always reach back across WINDOW_MS. */
const RING_MINUTES = 16;
/** A move smaller than this share of the tile's full scale reads as flat. */
const DEADBAND_FRACTION = 0.01;

/** Stable keys for the per-tile ring buffers (also the on-screen labels). */
const LABELS = {
  gamma: "Gamma (Net GEX)",
  delta: "Delta (DEX)",
  gammaPct: "Gamma % 0DTE (Vol)",
  gexRate: "Net GEX Rate / min",
  gexChg: "0DTE GEX Δ 15m",
  ib: "IB Direction",
} as const;

interface Totals { ts: number; gex: number; dex: number } // gex/dex in billions

type Sample = { ts: number; v: number };

/**
 * Per-tile ring buffer of ~16 one-minute samples, and the 15-minute delta drawn
 * from it.
 *
 * Sampling: a 5s timer reads the latest values and appends at most one sample
 * per wall-clock minute bucket per key, capped at RING_MINUTES entries. The
 * timer (rather than the render cadence) is what makes the spacing one minute —
 * socket frames arrive far faster and irregularly.
 *
 * Delta: current value − the newest sample at or before the 15-min mark. The
 * half-minute tolerance covers the case where a full 16-slot ring's oldest
 * sample sits a few seconds shy of the mark. When no sample reaches back that
 * far — a tile that has not been on screen for 15 minutes — the delta is null
 * and the caller renders nothing rather than a short-window change mislabelled
 * as 15 minutes.
 */
function useDelta15m(values: Record<string, number | null>): Record<string, number | null> {
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const [rings, setRings] = useState<Record<string, Sample[]>>({});

  useEffect(() => {
    const sample = () => {
      const now = Date.now();
      const bucket = Math.floor(now / MINUTE_MS);
      setRings((prev) => {
        const next: Record<string, Sample[]> = { ...prev };
        let changed = false;
        for (const [k, v] of Object.entries(valuesRef.current)) {
          if (v == null || !Number.isFinite(v)) continue;
          const buf = prev[k] ?? [];
          const last = buf[buf.length - 1];
          if (last && Math.floor(last.ts / MINUTE_MS) === bucket) continue; // one per minute
          next[k] = [...buf, { ts: now, v }].slice(-RING_MINUTES);
          changed = true;
        }
        return changed ? next : prev;
      });
    };
    sample();
    const id = setInterval(sample, 5_000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  const target = now - WINDOW_MS + MINUTE_MS / 2;
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(values)) {
    const buf = rings[k];
    if (v == null || !Number.isFinite(v) || !buf?.length) {
      out[k] = null;
      continue;
    }
    const reachable = buf.filter((s) => s.ts <= target);
    const ref = reachable.length ? reachable[reachable.length - 1] : null;
    out[k] = ref ? v - ref.v : null;
  }
  return out;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

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
        <rect
          x={midX - 0.9}
          y={y - 3}
          width={1.8}
          height={segH + 6}
          rx={0.9}
          fill="rgba(255,255,255,0.92)"
          style={{ filter: "drop-shadow(0 0 3px rgba(255,255,255,0.55))" }}
        />
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
  /** Full scale of the meter — the deadband is DEADBAND_FRACTION of this. */
  scale: number;
  /** Formats an unsigned magnitude for the change line (the arrow carries sign). */
  fmtAbs: (v: number) => string;
  /** Change over the last 15 min, or null when there is no history that far back. */
  delta15m: number | null;
}

/**
 * 15-minute change line — text only, directly under the tile value. Never
 * touches the meter. Renders nothing until the ring buffer reaches back 15 min.
 * Only the magnitude carries the up/down accent; "/ 15m" stays muted so the
 * colour reads as the direction of the move, not as a label.
 */
function Delta15m({ g }: { g: GaugeDef }) {
  const d = g.delta15m;
  if (d == null || !Number.isFinite(d)) return null;
  const flat = Math.abs(d) < g.scale * DEADBAND_FRACTION;
  const up = d > 0;
  return (
    <div style={{ fontSize: 11, fontWeight: 700, marginTop: 3, whiteSpace: "nowrap" }}>
      <span
        style={{
          color: flat ? HOME_THEME.muted : up ? HOME_THEME.green : HOME_THEME.red,
          opacity: flat ? MUTED_OPACITY : 1,
        }}
      >
        {flat ? "—" : `${up ? "▲" : "▼"} ${g.fmtAbs(Math.abs(d))}`}
      </span>
      <span style={{ color: HOME_THEME.muted, opacity: MUTED_OPACITY, fontWeight: 600 }}>
        {" / 15m"}
      </span>
    </div>
  );
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
          color: "#FFFFFF",
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
      {/* Value + change line share a wrapper so the tile's 6px column gap sits
          above the value and the change line hangs off it at marginTop: 3. */}
      <div style={{ textAlign: "center", minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
            color: has ? "#FFFFFF" : "rgba(255,255,255,0.45)",
          }}
        >
          {has ? g.fmt(g.value as number) : "--"}
        </div>
        <Delta15m g={g} />
      </div>
    </div>
  );
}

// ── formatters ───────────────────────────────────────────────────────────────
const fmtB = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}B`;
const fmtDex = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}B`;
const fmtPct = (v: number) => `${v.toFixed(0)}%`;
const fmtIb = (v: number) => `${v >= 50 ? "▲ " : "▼ "}${v.toFixed(0)}%`;
// Net GEX rate — $B of gamma-per-1% per minute. Two decimals would read as
// noise at this magnitude, so sub-0.01B/m collapses to a flat zero rather than
// flickering between ±0.00.
const fmtRate = (v: number) =>
  Math.abs(v) < 0.005 ? "0.00B/m" : `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}B/m`;

// Unsigned magnitudes for the change line — the ▲/▼ carries the sign.
const fmtAbsB = (v: number) => `$${v.toFixed(2)}B`;
const fmtAbsPct = (v: number) => `${v.toFixed(0)}%`;
const fmtAbsRate = (v: number) => `$${v.toFixed(2)}B/m`;

export interface HomeGaugeRailProps {
  /** Vol-only 0DTE gamma as a share of total gamma, 0–100. */
  gammaPctVol?: number | null;
  /** Initial Balance direction, 0–100 (>50 = up-day lean). */
  ibDirection?: number | null;
}

export default function HomeGaugeRail({
  gammaPctVol = null,
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

  // Permanent /ws/gex subscription — always on (mirrors LiveGreeksGauges).
  // Shares the app-wide socket (lib/gexSocket) rather than opening its own; on
  // /home this component, LiveGreeksGauges and the toolbar ticker were three
  // separate connections to the same broadcast.
  useEffect(() => {
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

    // Frames arrive pre-parsed from the shared socket.
    const handle = (m: GexMessage) => {
      const type = String(m.type ?? "");
      const d = (m.data && typeof m.data === "object" ? m.data : m) as Record<string, unknown>;
      if (type === "snapshot" || type === "gex") {
        if (d.totals) frame.totals = d.totals as Record<string, number>;
        if (d.updatedAt) frame.updatedAt = Number(d.updatedAt);
        apply();
      }
    };

    return subscribeGex({ onMessage: handle, topics: RAIL_TOPICS });
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

  // Net GEX RATE — how fast dealer gamma is being added or pulled, in $B of
  // gamma-per-1%-move per MINUTE. Replaces the old CPG ratio tile.
  //
  // Δ is taken against the newest sample at least MIN_RATE_SPAN_MS old and no
  // older than MAX_RATE_SPAN_MS, then normalised to a per-minute figure by the
  // ACTUAL elapsed time. Normalising (rather than assuming the reference sample
  // sits exactly 60s back) is what keeps the number honest: `history` is bucketed
  // at 15s and the feed's cadence drifts, so a raw last-minus-reference would
  // silently scale with however stale the reference happened to be. A too-short
  // span is rejected outright — dividing a small Δ by a few seconds manufactures
  // an enormous rate out of ordinary feed jitter.
  const gexRate = (() => {
    if (gex == null || history.length < 2) return null;
    const now = latest?.ts ?? history[history.length - 1].ts;
    const MIN_RATE_SPAN_MS = 30_000;
    const MAX_RATE_SPAN_MS = 180_000;
    const target = now - MINUTE_MS;
    // Newest sample at or before the 1-min mark; fall back to the newest sample
    // that still clears the minimum span when the ring hasn't reached back yet.
    const eligible = history.filter((p) => now - p.ts >= MIN_RATE_SPAN_MS && now - p.ts <= MAX_RATE_SPAN_MS);
    if (!eligible.length) return null;
    const atOrBefore = eligible.filter((p) => p.ts <= target);
    const ref = atOrBefore.length ? atOrBefore[atOrBefore.length - 1] : eligible[0];
    const spanMs = now - ref.ts;
    if (!(spanMs >= MIN_RATE_SPAN_MS)) return null;
    return (gex - ref.gex) / (spanMs / MINUTE_MS);
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
  // Rate meter scale: today's fastest observed per-minute move, floored so a
  // quiet tape doesn't make normal noise swing the needle end to end. Samples
  // are 15s-bucketed, so each consecutive pair is scaled up to per-minute before
  // being considered.
  const rateScale = (() => {
    let peak = 0;
    for (let i = 1; i < history.length; i++) {
      const spanMs = history[i].ts - history[i - 1].ts;
      if (spanMs < 5_000) continue;
      const perMin = Math.abs(history[i].gex - history[i - 1].gex) / (spanMs / MINUTE_MS);
      if (Number.isFinite(perMin)) peak = Math.max(peak, perMin);
    }
    return Math.max(0.1, peak, Math.abs(gexRate ?? 0));
  })();

  // One ring buffer per tile, keyed by label. Feeds the change line only — the
  // meters keep reading `latest`/props exactly as before.
  const delta15m = useDelta15m({
    [LABELS.gamma]: gex,
    [LABELS.delta]: dex,
    [LABELS.gammaPct]: gammaPctVol,
    [LABELS.gexRate]: gexRate,
    [LABELS.gexChg]: gexChg,
    [LABELS.ib]: ibDirection,
  });

  // signed → normalized 0..1 with 0.5 = center
  const signedT = (v: number | null, scale: number) => (v == null ? null : clamp(0.5 + v / (2 * scale), 0, 1));

  const gauges: GaugeDef[] = [
    { label: LABELS.gamma, value: gex, t: signedT(gex, gexScale), midT: 0.5, kind: "signed", color: gex == null ? CYAN : gex >= 0 ? POS : NEG, fmt: fmtB, scale: gexScale, fmtAbs: fmtAbsB, delta15m: delta15m[LABELS.gamma] },
    { label: LABELS.delta, value: dex, t: signedT(dex, dexScale), midT: 0.5, kind: "signed", color: dex == null ? CYAN : dex >= 0 ? POS : NEG, fmt: fmtDex, scale: dexScale, fmtAbs: fmtAbsB, delta15m: delta15m[LABELS.delta] },
    { label: LABELS.gammaPct, value: gammaPctVol, t: gammaPctVol == null ? null : clamp(gammaPctVol / 100, 0, 1), midT: 0, kind: "pct", color: gammaPctVol == null ? CYAN : gammaPctVol >= 50 ? POS : NEG, fmt: fmtPct, scale: 100, fmtAbs: fmtAbsPct, delta15m: delta15m[LABELS.gammaPct] },
    { label: LABELS.gexRate, value: gexRate, t: signedT(gexRate, rateScale), midT: 0.5, kind: "signed", color: gexRate == null ? CYAN : gexRate >= 0 ? POS : NEG, fmt: fmtRate, scale: rateScale, fmtAbs: fmtAbsRate, delta15m: delta15m[LABELS.gexRate] },
    { label: LABELS.gexChg, value: gexChg, t: signedT(gexChg, chgScale), midT: 0.5, kind: "signed", color: gexChg == null ? CYAN : gexChg >= 0 ? POS : NEG, fmt: fmtB, scale: chgScale, fmtAbs: fmtAbsB, delta15m: delta15m[LABELS.gexChg] },
    { label: LABELS.ib, value: ibDirection, t: ibDirection == null ? null : clamp(ibDirection / 100, 0, 1), midT: 0.5, kind: "signed", color: ibDirection == null ? CYAN : ibDirection >= 50 ? POS : NEG, fmt: fmtIb, scale: 100, fmtAbs: fmtAbsPct, delta15m: delta15m[LABELS.ib] },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 8 }}>
      {gauges.map((g) => (
        <Cell key={g.label} g={g} />
      ))}
    </div>
  );
}
