"use client";

// ChainStatsBar — sits above CompactOptionChain on /new-home. Two rows:
//   1. "Now" tiles: Call Wall, Put Wall, Flip, CB, Max Pain — derived from the
//      ticker's nearest (0DTE-style) expiry chain, same math /gex2 and /test's
//      Positioning tab use (net GEX per strike, zero-crossing flip, payout-
//      minimizing max pain).
//   2. 5m / 15m / 30m wall history — call+put wall strikes as of N minutes
//      ago. SPX reads /proxy/gex-history (option_strike_gex_history, the same
//      source /test's Walls & Flows tab uses for SPX); every other ticker
//      reads /proxy/wall-history (ticker-wall-recorder), same as /test uses
//      for NDX/SPY/QQQ.
// Independent fetch from CompactOptionChain (small extra /api/chains call for
// one expiry) — kept separate so this bar doesn't couple to the matrix's
// internal multi-expiry state.

import { useEffect, useState } from "react";
import { HOME_THEME as HT, LIGHT_BLUE } from "@/components/shared/homeTheme";

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

const WALL_AGES = ["5", "15", "30"] as const;

async function resolveNearestExpiry(ticker: string): Promise<string | null> {
  const json = await fetch(`/api/expirations?ticker=${encodeURIComponent(ticker)}`).then((r) => r.json()).catch(() => null);
  const items: Record<string, unknown>[] = json?.data?.items ?? [];
  const dates = Array.from(new Set(items.map((it) => String(it["expiration-date"] ?? "").slice(0, 10)).filter(Boolean))).sort();
  return dates[0] ?? null;
}

type FrontStats = {
  spot: number;
  callWall: number | null;
  putWall: number | null;
  flip: number | null;
  cb: number | null;
  maxPain: number | null;
};

// Front-expiry stats: call/put wall (strike with the largest positive / most
// negative net GEX), flip (nearest-to-spot zero-crossing of net GEX, linearly
// interpolated between the two straddling strikes), CB (strike with the
// largest |net GEX| — "Core Bullseye", formerly labeled MVC), and max pain
// (expiry price minimizing total holder payout — same formula as /gex2).
async function fetchFrontStats(ticker: string): Promise<FrontStats | null> {
  const expiry = await resolveNearestExpiry(ticker);
  if (!expiry) return null;
  const json = await fetch(`/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(expiry)}`)
    .then((r) => r.json()).catch(() => null);
  const items: Record<string, unknown>[] = json?.data?.items ?? [];
  const spot = parseFloat(String(json?.data?.underlyingPrice ?? 0)) || 0;
  if (!items.length || !(spot > 0)) return null;

  type Row = { strike: number; gex: number; callOI: number; putOI: number };
  const rows: Row[] = [];
  const num = (o: Record<string, unknown> | undefined, k: string) => (o ? parseFloat(String(o[k])) || 0 : 0);
  const oi = (o: Record<string, unknown> | undefined) => (o ? parseInt(String(o["open-interest"] ?? o.openInterest ?? 0), 10) || 0 : 0);
  const vol = (o: Record<string, unknown> | undefined) => (o ? parseInt(String(o.volume ?? 0), 10) || 0 : 0);

  items.forEach((group) => {
    const groupExp = String(group["expiration-date"] ?? "").slice(0, 10);
    if (groupExp && groupExp !== expiry) return;
    (group.strikes as unknown[] | undefined ?? []).forEach((raw) => {
      const it = raw as Record<string, unknown>;
      const strike = parseFloat(String(it["strike-price"] ?? 0));
      if (!strike) return;
      const c = it.call as Record<string, unknown> | undefined;
      const p = it.put as Record<string, unknown> | undefined;
      const callOI = oi(c), putOI = oi(p);
      const cc = callOI + vol(c), pc = putOI + vol(p);
      const gex = cc || pc ? (num(c, "gamma") * cc - num(p, "gamma") * pc) * spot * spot * 0.01 * 100 : 0;
      rows.push({ strike, gex, callOI, putOI });
    });
  });
  if (!rows.length) return null;
  rows.sort((a, b) => a.strike - b.strike);

  let callWall: number | null = null, callWallV = -Infinity;
  let putWall: number | null = null, putWallV = Infinity;
  let cb: number | null = null, cbAbs = -1;
  for (const r of rows) {
    if (r.gex > 0 && r.gex > callWallV) { callWallV = r.gex; callWall = r.strike; }
    if (r.gex < 0 && r.gex < putWallV) { putWallV = r.gex; putWall = r.strike; }
    if (Math.abs(r.gex) > cbAbs) { cbAbs = Math.abs(r.gex); cb = r.strike; }
  }

  // Flip: interpolated zero-crossing of net GEX nearest to spot.
  let flip: number | null = null, flipDist = Infinity;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if ((a.gex < 0 && b.gex > 0) || (a.gex > 0 && b.gex < 0)) {
      const t = a.gex / (a.gex - b.gex);
      const x = a.strike + t * (b.strike - a.strike);
      const d = Math.abs(x - spot);
      if (d < flipDist) { flipDist = d; flip = x; }
    }
  }

  // Max pain: expiry price minimizing total intrinsic payout to OI holders.
  let maxPain = spot, best = Infinity;
  for (const k of rows) {
    let pain = 0;
    for (const r of rows) {
      if (r.strike < k.strike) pain += r.callOI * (k.strike - r.strike);
      else if (r.strike > k.strike) pain += r.putOI * (r.strike - k.strike);
    }
    if (pain < best) { best = pain; maxPain = k.strike; }
  }

  return { spot, callWall, putWall, flip, cb, maxPain };
}

type WallLevel = { strike: number; value: number } | null;
type WallWindow = { age: string; callWall: WallLevel; putWall: WallLevel };

async function fetchWallHistory(ticker: string, expiry: string | null): Promise<WallWindow[]> {
  const agesParam = WALL_AGES.join(",");
  if (ticker.toUpperCase() === "SPX") {
    if (!expiry) return WALL_AGES.map((age) => ({ age, callWall: null, putWall: null }));
    const json = await fetch(`/proxy/gex-history?expiry=${encodeURIComponent(expiry)}&ages=${agesParam}`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const baselines: Record<string, Record<string, number>> = json?.baselines ?? {};
    return WALL_AGES.map((age) => {
      let callWall: WallLevel = null, putWall: WallLevel = null;
      for (const [strikeStr, byAge] of Object.entries(baselines)) {
        const v = Number((byAge as Record<string, number>)[age]);
        if (!Number.isFinite(v)) continue;
        const strike = Number(strikeStr);
        if (v > 0 && (!callWall || v > callWall.value)) callWall = { strike, value: v };
        if (v < 0 && (!putWall || v < putWall.value)) putWall = { strike, value: v };
      }
      return { age, callWall, putWall };
    });
  }
  const json = await fetch(`/proxy/wall-history?ticker=${encodeURIComponent(ticker)}&ages=${agesParam}`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const windows: Array<{ age: string; callWall: WallLevel; putWall: WallLevel }> = Array.isArray(json?.windows) ? json.windows : [];
  return WALL_AGES.map((age) => {
    const w = windows.find((x) => String(x.age) === age);
    return { age, callWall: w?.callWall ?? null, putWall: w?.putWall ?? null };
  });
}

function fmtStrike(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "--";
  return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2);
}

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        background: `radial-gradient(circle at 50% 0%, ${rgba(LIGHT_BLUE, 0.10)} 0%, transparent 60%), rgba(13,17,25,0.20)`,
        backdropFilter: "blur(20px)",
        borderRadius: 14,
        padding: "10px 8px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
      }}
    >
      <div style={{ fontSize: 15, letterSpacing: "0.1em", color: HT.text, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "var(--font-mono, monospace)", color: color ?? HT.text }}>{value}</div>
    </div>
  );
}

export default function ChainStatsBar({ ticker }: { ticker: string }) {
  const [stats, setStats] = useState<FrontStats | null>(null);
  const [windows, setWindows] = useState<WallWindow[]>(WALL_AGES.map((age) => ({ age, callWall: null, putWall: null })));

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const expiry = await resolveNearestExpiry(ticker).catch(() => null);
      const [front, wallHist] = await Promise.all([
        fetchFrontStats(ticker).catch(() => null),
        fetchWallHistory(ticker, expiry).catch(() => WALL_AGES.map((age) => ({ age, callWall: null, putWall: null }))),
      ]);
      if (cancelled) return;
      setStats(front);
      setWindows(wallHist);
    };
    load();
    const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [ticker]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 8 }}>
        <StatTile label="Call wall" value={fmtStrike(stats?.callWall ?? null)} color={HT.green} />
        <StatTile label="Put wall" value={fmtStrike(stats?.putWall ?? null)} color={HT.red} />
        <StatTile label="Flip" value={fmtStrike(stats?.flip ?? null)} color={HT.orange} />
        <StatTile label="CB" value={fmtStrike(stats?.cb ?? null)} color={LIGHT_BLUE} />
        <StatTile label="Max pain" value={fmtStrike(stats?.maxPain ?? null)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
        {windows.map((w) => (
          <div
            key={w.age}
            style={{
              background: `radial-gradient(circle at 50% 0%, ${rgba(LIGHT_BLUE, 0.06)} 0%, transparent 60%), rgba(13,17,25,0.18)`,
              backdropFilter: "blur(16px)",
              borderRadius: 12,
              padding: "8px 10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 15,
            }}
          >
            <span style={{ color: HT.text, opacity: 0.6, fontWeight: 700 }}>{w.age}m</span>
            <span style={{ color: HT.green, fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}>
              {fmtStrike(w.callWall?.strike ?? null)}
            </span>
            <span style={{ color: HT.text, opacity: 0.3 }}>/</span>
            <span style={{ color: HT.red, fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}>
              {fmtStrike(w.putWall?.strike ?? null)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
