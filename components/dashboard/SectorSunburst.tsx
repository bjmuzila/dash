"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME as HT } from "@/components/shared/homeTheme";

/**
 * S&P sector wheel — sector → industry → ticker.
 *
 * Angle is market cap. Every bar grows OUTWARD from the zero ring; bar length
 * is the size of the move and color is the direction (HT.green up / HT.red
 * down, which is also the red↔blue diverging pair the rest of the dashboard
 * uses). Nothing grows inward, so the hub stays free for the index number and
 * the back-out affordance.
 *
 * Sized for the dashboard's right column, so it is deliberately quiet: sector
 * labels only, tickers printed inside a bar when it is both wide and long
 * enough, and everything else in the hover tooltip. Click a sector to zoom in,
 * click the middle to come back out.
 *
 * Data: /api/spx-sunburst (cached server-side, see that route).
 * No chart library — the arcs are plain SVG paths, so this adds no dependency.
 */

interface Row { t: string; s: string; i: string; w: number; c: number }
interface Payload { rows: Row[]; updatedAt: number; covered: number; universe: number; stale?: boolean }

const POLL_MS = 5 * 60_000;      // server caches for 15 min; this just keeps the tab fresh
const VB = 440;                  // viewBox — scales to the column via width:100%
const R = 208;
// Zoomed in there is only one sector, and the hub already names it — so the
// sector ring collapses to a thin accent band and the industry ring takes the
// space (which is also what makes industry labels fit at this size).
const RING_ALL   = { holeOut: 0.30, secOut: 0.44,  indOut: 0.52 };
const RING_FOCUS = { holeOut: 0.30, secOut: 0.325, indOut: 0.52 };
const R0 = R * 0.56;             // zero ring
const AMP = R * 0.40;            // bar length at the full-scale move
const CLAMP = 1.06;
const CAPS = [2, 3, 5];

/** Progressively shorter forms, tried in order until one fits the sector arc. */
const SECTOR_SHORT: Record<string, string[]> = {
  "Information Technology": ["Technology", "Tech"],
  "Communication Services": ["Communications", "Comms"],
  "Consumer Discretionary": ["Cons. Disc.", "Disc."],
  "Consumer Staples": ["Staples"],
  "Health Care": ["Health"],
  "Financials": ["Fins"],
  "Industrials": ["Indus."],
  "Real Estate": ["REITs"],
  "Materials": ["Matls"],
  "Utilities": ["Utils"],
  "Energy": ["Enrgy"],
};
const nameForms = (n: string) => [n, ...(SECTOR_SHORT[n] ?? [])];

// ── color helpers — everything derives from HOME_THEME, no local hex ──────────
function toRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = toRgb(a);
  const [r2, g2, b2] = toRgb(b);
  const k = Math.max(0, Math.min(1, t));
  const c = (x: number, y: number) => Math.round(x + (y - x) * k).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
/** Neutral midpoint of the diverging scale — the panel, lifted toward the ink. */
const MID = mix(HT.panel, HT.text, 0.16);
/** Pick black or white ink for whatever we just painted. */
function inkOn(hex: string): string {
  const [r, g, b] = toRgb(hex);
  const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.32 ? HT.bg : HT.text;
}

// ── geometry ─────────────────────────────────────────────────────────────────
const pt = (r: number, a: number) => `${(r * Math.sin(a)).toFixed(2)},${(-r * Math.cos(a)).toFixed(2)}`;

function arcPath(a0: number, a1: number, r0: number, r1: number): string {
  if (r1 <= r0 || a1 <= a0) return "";
  // A single sector zoomed in spans the whole circle; one arc command can't
  // close a 360° sweep, so draw it as two half-circles.
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    return `M ${pt(r1, 0)} A${r1},${r1} 0 1 1 ${pt(r1, Math.PI)} A${r1},${r1} 0 1 1 ${pt(r1, 0)} Z ` +
           `M ${pt(r0, 0)} A${r0},${r0} 0 1 0 ${pt(r0, Math.PI)} A${r0},${r0} 0 1 0 ${pt(r0, 0)} Z`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${pt(r1, a0)} A${r1},${r1} 0 ${large} 1 ${pt(r1, a1)} ` +
         `L ${pt(r0, a1)} A${r0},${r0} 0 ${large} 0 ${pt(r0, a0)} Z`;
}
/** Rough text width — good enough to decide whether a label fits at this size. */
const textW = (s: string, fs: number) => s.length * fs * 0.6;

interface Node { name: string; a0: number; a1: number; rows: Row[]; chg: number }

export default function SectorSunburst() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState(false);
  const [cap, setCap] = useState(3);
  const [focus, setFocus] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; title: string; sub: string; val: number } | null>(null);
  const RING = focus ? RING_FOCUS : RING_ALL;
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/spx-sunburst", { cache: "no-store" });
      if (!r.ok) { setErr(true); return; }
      const j: Payload = await r.json();
      if (Array.isArray(j.rows) && j.rows.length) { setData(j); setErr(false); }
    } catch { setErr(true); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // ── hierarchy + angles ──
  const { sectors, industries, leaves, net, up, down } = useMemo(() => {
    const all = data?.rows ?? [];
    const rows = focus ? all.filter((r) => r.s === focus) : all;
    const total = rows.reduce((a, r) => a + r.w, 0);
    const wavg = (rs: Row[]) => {
      const tw = rs.reduce((a, r) => a + r.w, 0);
      return tw ? rs.reduce((a, r) => a + r.c * r.w, 0) / tw : 0;
    };

    const secs: Node[] = [];
    const inds: Node[] = [];
    const lvs: (Node & { row: Row })[] = [];
    if (!total) return { sectors: secs, industries: inds, leaves: lvs, net: 0, up: 0, down: 0 };

    // Sectors by weight, industries by weight, tickers by weight — biggest first
    // so the wheel's shape stays stable between refreshes.
    const bySector = new Map<string, Row[]>();
    rows.forEach((r) => { const l = bySector.get(r.s) ?? []; l.push(r); bySector.set(r.s, l); });
    const secList = [...bySector.entries()].sort(
      (a, b) => b[1].reduce((x, r) => x + r.w, 0) - a[1].reduce((x, r) => x + r.w, 0)
    );

    let a = 0;
    for (const [name, secRows] of secList) {
      const span = (secRows.reduce((x, r) => x + r.w, 0) / total) * Math.PI * 2;
      secs.push({ name, a0: a, a1: a + span, rows: secRows, chg: wavg(secRows) });

      const byInd = new Map<string, Row[]>();
      secRows.forEach((r) => { const l = byInd.get(r.i) ?? []; l.push(r); byInd.set(r.i, l); });
      const indList = [...byInd.entries()].sort(
        (x, y) => y[1].reduce((v, r) => v + r.w, 0) - x[1].reduce((v, r) => v + r.w, 0)
      );

      let ai = a;
      for (const [iName, indRows] of indList) {
        const iSpan = (indRows.reduce((x, r) => x + r.w, 0) / total) * Math.PI * 2;
        inds.push({ name: iName, a0: ai, a1: ai + iSpan, rows: indRows, chg: wavg(indRows) });
        let al = ai;
        for (const row of [...indRows].sort((x, y) => y.w - x.w)) {
          const lSpan = (row.w / total) * Math.PI * 2;
          lvs.push({ name: row.t, a0: al, a1: al + lSpan, rows: [row], chg: row.c, row });
          al += lSpan;
        }
        ai += iSpan;
      }
      a += span;
    }
    return {
      sectors: secs, industries: inds, leaves: lvs, net: wavg(rows),
      up: rows.filter((r) => r.c > 0).length, down: rows.filter((r) => r.c < 0).length,
    };
  }, [data, focus]);

  // ── color by direction, length by magnitude ──
  const fillFor = useCallback((v: number) => {
    const k = Math.max(0.24, Math.min(1, Math.abs(v) / cap));
    return mix(MID, v >= 0 ? HT.green : HT.red, k);
  }, [cap]);
  // Sector/industry averages are small by construction (they wash out), so the
  // ring ramp starts well above zero — otherwise every inner arc is panel-colored.
  const ringFill = useCallback((v: number, strength: number) => {
    const k = 0.34 + 0.66 * Math.min(1, Math.abs(v) / cap);
    return mix(HT.panel, v >= 0 ? HT.green : HT.red, k * strength);
  }, [cap]);
  const barLen = useCallback(
    (v: number) => Math.max(Math.min(Math.abs(v) / cap, CLAMP) * AMP, 1.5),
    [cap]
  );

  const movers = useMemo(() => {
    const rs = [...(data?.rows ?? [])].sort((a, b) => b.c - a.c);
    return { top: rs.slice(0, 3), bottom: rs.slice(-3).reverse() };
  }, [data]);

  const showTip = (e: React.MouseEvent, title: string, sub: string, val: number) => {
    const b = boxRef.current?.getBoundingClientRect();
    if (!b) return;
    setHover({ x: e.clientX - b.left, y: e.clientY - b.top, title, sub, val });
  };
  const fmt = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;

  const asOf = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })
    : null;

  const label = { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: HT.muted };
  const capBtn = (active: boolean) => ({
    padding: "2px 7px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontWeight: 700,
    border: `1px solid ${active ? HT.cyan : HT.border}`,
    background: active ? rgba(HT.cyan, 0.14) : "transparent",
    color: active ? HT.cyan : HT.muted, opacity: active ? 1 : 0.6,
  });

  return (
    <div>
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: HT.cyan }}>🌐 S&amp;P Sector Wheel</div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {CAPS.map((c) => (
            <button key={c} onClick={() => setCap(c)} style={capBtn(cap === c)}>{c}%</button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 12, color: HT.muted, opacity: 0.65, marginBottom: 10 }}>
        {focus
          ? <>Showing <strong style={{ color: HT.text }}>{focus}</strong> — click the middle to go back.</>
          : <>Bar length = size of move, color = direction. Click a sector to zoom.</>}
      </div>

      <div ref={boxRef} style={{ position: "relative" }}>
        {!data && !err && (
          <div style={{ padding: "48px 12px", textAlign: "center", color: HT.muted, opacity: 0.6, fontSize: 12 }}>
            Loading sector data…
          </div>
        )}
        {err && !data && (
          <div style={{ padding: "36px 12px", textAlign: "center", color: HT.muted, opacity: 0.7, fontSize: 12, border: `1px dashed ${HT.border}`, borderRadius: 8 }}>
            Sector feed unavailable. Retrying every 5 minutes.
          </div>
        )}

        {data && (
          <svg viewBox={`${-VB / 2} ${-VB / 2} ${VB} ${VB}`} style={{ display: "block", width: "100%", height: "auto" }}>
            {/* scale rings */}
            {[0.5, 1].map((f) => (
              <circle key={f} r={R0 + f * AMP} fill="none" stroke={HT.border} strokeWidth={1} />
            ))}

            {/* sector ring */}
            {sectors.map((s) => (
              <path
                key={`s-${s.name}`}
                d={arcPath(s.a0, s.a1, R * RING.holeOut, R * RING.secOut - 1.5)}
                fill={ringFill(s.chg, 0.62)}
                stroke={HT.bg}
                strokeWidth={1}
                fillRule="evenodd"
                style={{ cursor: focus ? "default" : "pointer" }}
                onClick={() => { if (!focus) setFocus(s.name); }}
                onMouseMove={(e) => showTip(e, s.name, `${s.rows.length} names · cap-weighted`, s.chg)}
                onMouseLeave={() => setHover(null)}
              />
            ))}

            {/* industry ring */}
            {industries.map((n, k) => (
              <path
                key={`i-${n.name}-${k}`}
                d={arcPath(n.a0, n.a1, R * RING.secOut, R * RING.indOut - 1.5)}
                fill={ringFill(n.chg, 0.9)}
                stroke={HT.bg}
                strokeWidth={0.8}
                fillRule="evenodd"
                onMouseMove={(e) => showTip(e, n.name, `${n.rows.length} names · cap-weighted`, n.chg)}
                onMouseLeave={() => setHover(null)}
              />
            ))}

            {/* bars — all outward from the zero ring */}
            {leaves.map((l, k) => (
              <path
                key={`l-${l.name}-${k}`}
                d={arcPath(l.a0, l.a1, R0, R0 + barLen(l.chg))}
                fill={fillFor(l.chg)}
                stroke={HT.bg}
                strokeWidth={0.6}
                onMouseMove={(e) => showTip(e, l.name, `${l.row.s} › ${l.row.i}`, l.chg)}
                onMouseLeave={() => setHover(null)}
              />
            ))}

            {/* zero ring, above the feet of the bars */}
            <circle r={R0} fill="none" stroke={rgba(HT.text, 0.28)} strokeWidth={1.4} />

            {/* hub */}
            <circle r={R * RING.holeOut - 3} fill={HT.panel} />

            {/* sector labels — tangential, only where the arc genuinely fits one */}
            {sectors.map((s) => {
              const fs = 9;
              const ri = R * RING.holeOut, ro = R * RING.secOut - 1.5;
              const rr = (ri + ro) / 2;
              if (ro - ri < fs + 3) return null;      // thin accent band — no room
              const arcLen = (s.a1 - s.a0) * rr - 8;
              let text: string | null = null;
              for (const cand of nameForms(s.name)) {
                const w = textW(cand, fs);
                // must fit the arc, and the straight chord it sits on must not
                // bulge past the ring's outer edge
                if (w <= arcLen && Math.hypot(rr, w / 2) + fs * 0.45 <= ro) { text = cand; break; }
              }
              if (!text) return null;
              const mid = (s.a0 + s.a1) / 2;
              const deg = (mid * 180) / Math.PI;
              const flip = Math.cos(mid) < 0 ? " rotate(180)" : "";
              return (
                <text
                  key={`sl-${s.name}`}
                  transform={`rotate(${deg}) translate(0,${-rr})${flip}`}
                  textAnchor="middle" dy="0.34em" fontSize={fs} fontWeight={700}
                  fill={inkOn(ringFill(s.chg, 0.62))} style={{ pointerEvents: "none" }}
                >{text}</text>
              );
            })}

            {/* industry labels — only ever fit in the zoomed layout, and the fit
                test is what decides that, so there is no special case here */}
            {industries.map((n, k) => {
              const fs = 8;
              const ri = R * RING.secOut, ro = R * RING.indOut - 1.5;
              const rr = (ri + ro) / 2;
              if (ro - ri < fs + 3) return null;
              const arcLen = (n.a1 - n.a0) * rr - 8;
              const w = textW(n.name, fs);
              if (w > arcLen || Math.hypot(rr, w / 2) + fs * 0.45 > ro) return null;
              const mid = (n.a0 + n.a1) / 2;
              const flip = Math.cos(mid) < 0 ? " rotate(180)" : "";
              return (
                <text
                  key={`il-${n.name}-${k}`}
                  transform={`rotate(${(mid * 180) / Math.PI}) translate(0,${-rr})${flip}`}
                  textAnchor="middle" dy="0.34em" fontSize={fs} fontWeight={600}
                  fill={inkOn(ringFill(n.chg, 0.9))} style={{ pointerEvents: "none" }}
                >{n.name}</text>
              );
            })}

            {/* tickers, printed inside a bar that is both wide and long enough */}
            {leaves.map((l, k) => {
              const fs = 7.5;
              const len = barLen(l.chg);
              const w = textW(l.name, fs);
              if (w > len - 7) return null;
              if (fs * 1.35 > (l.a1 - l.a0) * R0) return null;
              const mid = (l.a0 + l.a1) / 2;
              const rr = R0 + len / 2;
              const rot = (mid * 180) / Math.PI - 90;
              const flip = rot > 90 || rot < -90 ? " rotate(180)" : "";
              return (
                <text
                  key={`tl-${l.name}-${k}`}
                  transform={`rotate(${rot}) translate(${rr},0)${flip}`}
                  textAnchor="middle" dy="0.34em" fontSize={fs} fontWeight={700}
                  fill={inkOn(fillFor(l.chg))} style={{ pointerEvents: "none" }}
                >{l.name}</text>
              );
            })}

            {/* hero + back-out target */}
            <text textAnchor="middle" dy="-0.5em" fontSize={22} fontWeight={800} fill={net >= 0 ? HT.green : HT.red} style={{ pointerEvents: "none" }}>
              {fmt(net)}
            </text>
            <text textAnchor="middle" dy="1.5em" fontSize={9.5} fill={HT.muted} opacity={0.7} style={{ pointerEvents: "none" }}>
              {up} up · {down} down
            </text>
            {focus && (
              <>
                <text textAnchor="middle" dy="3.5em" fontSize={9} fontWeight={700} fill={HT.cyan} style={{ pointerEvents: "none" }}>
                  ← all sectors
                </text>
                <circle
                  r={R * RING.holeOut - 3} fill="transparent" style={{ cursor: "pointer" }}
                  onClick={() => setFocus(null)}
                />
              </>
            )}
          </svg>
        )}

        {hover && (
          <div style={{
            position: "absolute", left: Math.min(hover.x + 12, 240), top: hover.y + 12, pointerEvents: "none", zIndex: 5,
            background: HT.panelBgStrong, backdropFilter: "blur(10px)", border: `1px solid ${HT.border}`,
            borderRadius: 8, padding: "7px 9px", minWidth: 120,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: HT.text }}>{hover.title}</div>
            <div style={{ fontSize: 10, color: HT.muted, opacity: 0.6, marginTop: 1 }}>{hover.sub}</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4, color: hover.val >= 0 ? HT.green : HT.red }}>
              {fmt(hover.val)}
            </div>
          </div>
        )}
      </div>

      {/* biggest movers — the wheel is too small for callouts, so name them here */}
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          {([["Top", movers.top], ["Bottom", movers.bottom]] as const).map(([head, list]) => (
            <div key={head}>
              <div style={{ ...label, fontSize: 10, marginBottom: 5, opacity: 0.55 }}>{head}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {list.map((m) => (
                  <div key={m.t} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ fontWeight: 700, color: HT.text }}>{m.t}</span>
                    <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: m.c >= 0 ? HT.green : HT.red }}>{fmt(m.c)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {data && (
        <div style={{ marginTop: 10, fontSize: 10, color: HT.muted, opacity: 0.5, display: "flex", justifyContent: "space-between" }}>
          <span>{data.covered}/{data.universe} names{data.stale ? " · cached" : ""}</span>
          {asOf && <span>as of {asOf} ET</span>}
        </div>
      )}
    </div>
  );
}
