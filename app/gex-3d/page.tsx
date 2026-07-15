"use client";

// ─────────────────────────────────────────────────────────────────────────────
// /gex-3d — GEX heatmap + bubbles rendered as a 3D perspective terrain map.
// Positive (call-wall) GEX extrudes UP as blue "ice walls"; negative (put) GEX
// extrudes DOWN as red "magma cliffs". Strikes on X, session time on Z.
//
// DATA: live, via useGexSurface → /proxy/gex-history?mode=series (today's ET
// session out of option_strike_gex_history, one column per 60s snapshot).
// Basis follows the dashboard convention: OI+Vol default + a Vol-only toggle.
// The grid is normalized by the DAY's peak |GEX| in the hook, so terrain height
// is comparable across the session but NOT across days.
//
// Canvas colors are derived from HOME_THEME tokens via canvasRgba() — no raw
// literals. 2D canvas can't consume CSS vars, so tokens are read into locals.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { HOME_THEME, LIGHT_BLUE, homeButtonStyle, homeSecondaryButtonStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { useGexSurface } from "@/hooks/useGexSurface";

// ── theme → canvas plumbing ─────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function canvasRgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
/** Multiply a theme hex by a light factor for face shading. */
function shade(hex: string, f: number, a = 1): string {
  const [r, g, b] = hexToRgb(hex);
  const c = (v: number) => Math.round(Math.min(255, v * f));
  return `rgba(${c(r)},${c(g)},${c(b)},${a})`;
}

const ICE = HOME_THEME.cyan;      // +GEX call walls
const ICE_HI = LIGHT_BLUE;        // glint on tall call walls
const MAGMA = HOME_THEME.red;     // −GEX put cliffs
const MAGMA_HI = HOME_THEME.orange;
const SPOT = HOME_THEME.orange;
const AXIS = HOME_THEME.text;

// ── data ────────────────────────────────────────────────────────────────────
/** Renderer-local shape: the live surface flattened to what draw() needs. */
type Surface = {
  strikes: number[];
  /** Normalized (~±1) grid: rows[t][s]. */
  rows: number[][];
  /** Raw net GEX per cell — tooltip only. */
  raw: (number | null)[][];
  /** Spot per column; nulls carried forward so the ribbon never breaks. */
  spotPath: number[];
  /** Epoch ms per column. */
  times: number[];
  peak: number;
};

const EMPTY_SURFACE: Surface = { strikes: [], rows: [], raw: [], spotPath: [], times: [], peak: 0 };

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
  });
}
/** Compact $B/$M label for raw net GEX. */
function fmtGex(v: number): string {
  const a = Math.abs(v);
  const s = v > 0 ? "+" : "-";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`;
  return `${s}${a.toFixed(0)}`;
}

type Cell = { x: number; z: number; v: number; h: number; depth: number };

export default function Gex3DPage() {
  const [basis, setBasis] = useState<"net" | "vol">("net");
  const live = useGexSurface(basis);

  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const surfRef = useRef<Surface>(EMPTY_SURFACE);
  const dimsRef = useRef({ nx: 0, nz: 0 });
  const cellsRef = useRef<Cell[]>([]);
  const camRef = useRef({ yaw: -0.62, pitch: (34 * Math.PI) / 180, zoom: 1 });
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  const [relief, setRelief] = useState(110);
  const [tilt, setTilt] = useState(34);
  const [bubbles, setBubbles] = useState(true);
  const [spin, setSpin] = useState(false);

  const reliefRef = useRef(relief);
  const bubblesRef = useRef(bubbles);
  const spinRef = useRef(spin);
  reliefRef.current = relief;
  bubblesRef.current = bubbles;
  spinRef.current = spin;

  const flipIdx = useRef<number | null>(null);

  const proj = useCallback((gx: number, gy: number, gz: number) => {
    const { yaw, pitch, zoom } = camRef.current;
    const { w: W, h: H } = sizeRef.current;
    const { nx, nz } = dimsRef.current;
    // Grid spacing shrinks as the ladder widens so a 40-strike day still fits.
    const SXc = Math.max(10, Math.min(26, 700 / Math.max(1, nx)));
    const SZc = Math.max(8, Math.min(17, 520 / Math.max(1, nz)));
    const x = (gx - (nx - 1) / 2) * SXc;
    const z = (gz - (nz - 1) / 2) * SZc;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const rx = x * cy - z * sy;
    const rz = x * sy + z * cy;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const ry = gy * cp - rz * sp;
    const rz2 = gy * sp + rz * cp;
    const d = 1400;
    const s = (d / (d + rz2 * 0.9)) * zoom;
    return { x: W / 2 + rx * s, y: H / 2 + 40 - ry * s, s, depth: rz2 };
  }, []);

  const draw = useCallback(() => {
    const cv = cvRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const { w: W, h: H } = sizeRef.current;
    const { strikes, rows, spotPath } = surfRef.current;
    const { nx: NX, nz: NZ } = dimsRef.current;
    const rel = reliefRef.current;

    ctx.fillStyle = HOME_THEME.bg;
    ctx.fillRect(0, 0, W, H);
    if (!NX || !NZ) return; // nothing recorded yet today — overlay handles the message

    // floor grid
    ctx.strokeStyle = canvasRgba(ICE, 0.12);
    ctx.lineWidth = 1;
    for (let x = 0; x < NX; x += 2) {
      const a = proj(x, 0, 0), b = proj(x, 0, NZ - 1);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let z = 0; z < NZ; z += 3) {
      const a = proj(0, 0, z), b = proj(NX - 1, 0, z);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // zero-gamma flip plane (from the newest column)
    if (flipIdx.current != null) {
      const a = proj(flipIdx.current, 0, 0), b = proj(flipIdx.current, 0, NZ - 1);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = canvasRgba(SPOT, 0.55);
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
    }

    // build + depth-sort columns
    const cells: Cell[] = [];
    for (let z = 0; z < NZ; z++)
      for (let x = 0; x < NX; x++) {
        const v = rows[z]?.[x] ?? 0;
        cells.push({ x, z, v, h: v * rel, depth: proj(x, 0, z).depth });
      }
    cells.sort((a, b) => b.depth - a.depth);
    cellsRef.current = cells;

    const poly = (pts: { x: number; y: number }[], fill: string, stroke?: string) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.5; ctx.stroke(); }
    };

    const w = 0.46;
    for (const c of cells) {
      if (Math.abs(c.v) < 0.035) continue;
      const base = c.v >= 0 ? ICE : MAGMA;
      // intensity ramp: weak strikes wash out, dominant walls saturate
      const mag = Math.min(1, Math.abs(c.v));
      const lift = 0.75 + mag * 0.65;
      const x0 = c.x - w, x1 = c.x + w, z0 = c.z - w, z1 = c.z + w;
      const tA = proj(x0, c.h, z0), tB = proj(x1, c.h, z0), tC = proj(x1, c.h, z1), tD = proj(x0, c.h, z1);
      const bA = proj(x0, 0, z0), bB = proj(x1, 0, z0), bC = proj(x1, 0, z1), bD = proj(x0, 0, z1);
      const faces = [
        { p: [tA, tB, bB, bA], d: (tA.depth + tB.depth) / 2, f: 0.62 },
        { p: [tB, tC, bC, bB], d: (tB.depth + tC.depth) / 2, f: 0.78 },
        { p: [tC, tD, bD, bC], d: (tC.depth + tD.depth) / 2, f: 0.55 },
        { p: [tD, tA, bA, bD], d: (tD.depth + tA.depth) / 2, f: 0.7 },
      ].sort((a, b) => b.d - a.d);
      for (const f of faces) poly(f.p, shade(base, f.f * lift), canvasRgba(HOME_THEME.bg, 0.35));
      poly([tA, tB, tC, tD], shade(base, 1.1 * lift), canvasRgba(AXIS, 0.16));

      if (c.v > 0.55) { ctx.save(); ctx.globalAlpha = 0.18; poly([tA, tB, tC, tD], ICE_HI); ctx.restore(); }
      if (c.v < -0.5) {
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.shadowColor = canvasRgba(MAGMA_HI, 0.9);
        ctx.shadowBlur = 14;
        poly([tA, tB, tC, tD], MAGMA_HI);
        ctx.restore();
      }
    }

    // ── spot track: a real 3D ribbon, not a flat polyline ───────────────────
    // Built as three parts so it reads as a solid object in the terrain:
    //   1. floor shadow (where price actually sits on the strike axis)
    //   2. a vertical fin dropping from the ribbon to the floor
    //   3. an extruded top rail with a lit face + highlight edge
    const RIBBON_Y = 34;   // ride height above the floor plane
    const RIBBON_W = 0.34; // half-width in grid units (across strikes)
    // Spot → fractional grid index on the live strike ladder (step is read from
    // the ladder itself: SPX records 5s and 10s, never assume one).
    const step = strikes.length > 1 ? strikes[1] - strikes[0] : 5;
    const gxAt = (z: number) =>
      Math.max(-0.5, Math.min(NX - 0.5, (spotPath[z] - strikes[0]) / (step || 5)));

    // 1. floor shadow
    ctx.save();
    ctx.strokeStyle = canvasRgba(HOME_THEME.bg, 0.85);
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let z = 0; z < NZ; z++) {
      const p = proj(gxAt(z), 0, z);
      if (z) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();

    // 2. vertical fin — quads from ribbon down to the floor, depth-sorted
    const fins: { p: { x: number; y: number }[]; d: number }[] = [];
    for (let z = 0; z < NZ - 1; z++) {
      const a = proj(gxAt(z), RIBBON_Y, z);
      const b = proj(gxAt(z + 1), RIBBON_Y, z + 1);
      const af = proj(gxAt(z), 0, z);
      const bf = proj(gxAt(z + 1), 0, z + 1);
      fins.push({ p: [a, b, bf, af], d: (a.depth + b.depth) / 2 });
    }
    fins.sort((a, b) => b.d - a.d);
    for (const f of fins) poly(f.p, canvasRgba(SPOT, 0.14));

    // 3. extruded top rail — side face + cap, drawn back-to-front
    const rails: { side: { x: number; y: number }[]; cap: { x: number; y: number }[]; d: number }[] = [];
    for (let z = 0; z < NZ - 1; z++) {
      const g0 = gxAt(z), g1 = gxAt(z + 1);
      const tL0 = proj(g0 - RIBBON_W, RIBBON_Y + 5, z);
      const tR0 = proj(g0 + RIBBON_W, RIBBON_Y + 5, z);
      const tL1 = proj(g1 - RIBBON_W, RIBBON_Y + 5, z + 1);
      const tR1 = proj(g1 + RIBBON_W, RIBBON_Y + 5, z + 1);
      const bR0 = proj(g0 + RIBBON_W, RIBBON_Y - 5, z);
      const bR1 = proj(g1 + RIBBON_W, RIBBON_Y - 5, z + 1);
      rails.push({
        cap: [tL0, tR0, tR1, tL1],
        side: [tR0, tR1, bR1, bR0],
        d: (tL0.depth + tL1.depth) / 2,
      });
    }
    rails.sort((a, b) => b.d - a.d);
    for (const r of rails) {
      poly(r.side, shade(SPOT, 0.6));
      poly(r.cap, shade(SPOT, 1.12));
    }

    // glowing crest line along the top of the ribbon
    ctx.save();
    ctx.strokeStyle = canvasRgba(SPOT, 0.95);
    ctx.lineWidth = 1.6;
    ctx.shadowColor = canvasRgba(SPOT, 0.7);
    ctx.shadowBlur = 12;
    ctx.beginPath();
    for (let z = 0; z < NZ; z++) {
      const p = proj(gxAt(z) - RIBBON_W, RIBBON_Y + 5, z);
      if (z) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();

    // live spot marker at the head of the track
    {
      const p = proj(gxAt(NZ - 1), RIBBON_Y + 5, NZ - 1);
      ctx.save();
      ctx.shadowColor = canvasRgba(SPOT, 0.9);
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(3, 5 * p.s), 0, Math.PI * 2);
      ctx.fillStyle = shade(SPOT, 1.2);
      ctx.fill();
      ctx.restore();
      ctx.font = "10px var(--font-inter), Inter, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = canvasRgba(SPOT, 0.95);
      ctx.fillText(spotPath[NZ - 1].toFixed(0), p.x + 8, p.y - 6);
    }

    // per-strike |GEX| bubbles floating above the terrain
    if (bubblesRef.current) {
      const bl: { p: ReturnType<typeof proj>; r: number; v: number }[] = [];
      for (let z = 0; z < NZ; z += 2)
        for (let x = 0; x < NX; x++) {
          const v = rows[z]?.[x] ?? 0;
          if (Math.abs(v) < 0.28) continue;
          const p = proj(x, v * rel + 22, z);
          bl.push({ p, r: Math.sqrt(Math.abs(v)) * 7 * p.s, v });
        }
      bl.sort((a, b) => b.p.depth - a.p.depth);
      for (const b of bl) {
        ctx.beginPath();
        ctx.arc(b.p.x, b.p.y, Math.max(1.2, b.r), 0, Math.PI * 2);
        ctx.fillStyle = b.v > 0 ? canvasRgba(ICE_HI, 0.3) : canvasRgba(MAGMA_HI, 0.3);
        ctx.fill();
        ctx.strokeStyle = b.v > 0 ? canvasRgba(ICE_HI, 0.55) : canvasRgba(MAGMA_HI, 0.55);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }

    // axes
    ctx.font = "10px var(--font-inter), Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = canvasRgba(AXIS, 0.6);
    const labelStride = Math.max(1, Math.round(NX / 7)); // ~7 strike labels, any ladder width
    for (let x = 0; x < NX; x += labelStride) {
      const p = proj(x, 0, NZ + 0.6);
      ctx.fillText(String(strikes[x]), p.x, p.y);
    }
    // time axis — real recorded clock times, not an assumed 9:30→16:00 span
    const { times } = surfRef.current;
    if (times.length) {
      ctx.textAlign = "left";
      ctx.fillStyle = canvasRgba(AXIS, 0.5);
      const a = proj(NX + 1.2, 0, 0);
      const b = proj(NX + 1.2, 0, NZ - 1);
      ctx.fillText(fmtClock(times[0]), a.x, a.y);
      ctx.fillText(fmtClock(times[times.length - 1]), b.x, b.y);
    }
  }, [proj]);

  // resize + render loop
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: cv.clientWidth, h: cv.clientHeight };
      cv.width = cv.clientWidth * dpr;
      cv.height = cv.clientHeight * dpr;
      cv.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    });
    ro.observe(cv);
    let raf = 0;
    const loop = () => {
      if (spinRef.current && !dragRef.current) {
        camRef.current.yaw += 0.004;
        draw();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [draw]);

  // Live surface → renderer. Kept in a ref (not state) so the draw loop never
  // re-subscribes; the effect pushes and redraws once per poll.
  useEffect(() => {
    if (live.loading || !live.strikes.length || !live.rows.length) {
      surfRef.current = EMPTY_SURFACE;
      dimsRef.current = { nx: 0, nz: 0 };
      flipIdx.current = null;
      draw();
      return;
    }
    // Carry spot forward across any null column so the ribbon stays continuous.
    let lastSpot = live.spotPath.find((v) => v != null) ?? live.strikes[Math.floor(live.strikes.length / 2)];
    const spotPath = live.spotPath.map((v) => {
      if (v != null && Number.isFinite(v)) lastSpot = v;
      return lastSpot as number;
    });

    surfRef.current = {
      strikes: live.strikes,
      rows: live.norm,
      raw: live.rows,
      spotPath,
      times: live.times,
      peak: live.peak,
    };
    dimsRef.current = { nx: live.strikes.length, nz: live.norm.length };

    // Zero-gamma flip from the NEWEST column, interpolated between strikes.
    const last = live.norm[live.norm.length - 1] || [];
    let fi: number | null = null;
    for (let i = 1; i < last.length; i++) {
      if (last[i - 1] < 0 && last[i] >= 0) { fi = i - 1 + (0 - last[i - 1]) / (last[i] - last[i - 1]); break; }
    }
    flipIdx.current = fi;
    draw();
  }, [live, draw]);

  useEffect(() => { draw(); }, [relief, bubbles, draw]);
  useEffect(() => { camRef.current.pitch = (tilt * Math.PI) / 180; draw(); }, [tilt, draw]);

  // Orbit drag is wired with NATIVE window listeners (see useEffect below), not
  // React synthetic handlers: the pointer routinely leaves the canvas mid-drag,
  // and no React state is written per-move (that re-rendered the whole page on
  // every mousemove and fought the draw loop). Tilt state syncs on pointerup.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault(); // stop text-selection / native image-drag swallowing it
    dragRef.current = { x: e.clientX, y: e.clientY, yaw: camRef.current.yaw, pitch: camRef.current.pitch };
    e.currentTarget.style.cursor = "grabbing";
    if (tipRef.current) tipRef.current.style.opacity = "0";
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) return; // handled by the window listener
    const tip = tipRef.current;
    if (!tip) return;
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best: Cell | null = null, bd = Infinity;
    for (const c of cellsRef.current) {
      if (Math.abs(c.v) < 0.035) continue;
      const p = proj(c.x, c.h, c.z);
      const dd = (p.x - mx) ** 2 + (p.y - my) ** 2;
      if (dd < bd) { bd = dd; best = c; }
    }
    if (best && bd < 420) {
      const s = surfRef.current;
      const rawV = s.raw[best.z]?.[best.x];
      const ts = s.times[best.z];
      tip.innerHTML =
        `<b>${s.strikes[best.x]}</b> &nbsp;·&nbsp; ${ts ? fmtClock(ts) : "—"}<br>` +
        `Net GEX <b style="color:${best.v > 0 ? ICE_HI : MAGMA_HI}">` +
        `${rawV != null && Number.isFinite(rawV) ? fmtGex(rawV) : "—"}</b>`;
      tip.style.left = `${mx + 12}px`;
      tip.style.top = `${my - 6}px`;
      tip.style.opacity = "1";
    } else tip.style.opacity = "0";
  };
  // Native drag listeners on window — survive the cursor leaving the canvas.
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      camRef.current.yaw = d.yaw + (e.clientX - d.x) * 0.006;
      camRef.current.pitch = Math.max(0.12, Math.min(1.35, d.pitch - (e.clientY - d.y) * 0.005));
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
    };
    const up = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      cv.style.cursor = "grab";
      setTilt(Math.round((camRef.current.pitch * 180) / Math.PI)); // sync slider once
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [draw]);

  // Wheel must be a native non-passive listener to cancel page scroll.
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      camRef.current.zoom = Math.max(0.5, Math.min(2.4, camRef.current.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
      draw();
    };
    cv.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onNativeWheel);
  }, [draw]);

  const legendDot = (color: string, round = false) => ({
    width: 11, height: 11, background: color, borderRadius: round ? "50%" : 2, display: "inline-block",
  } as const);
  const legendItem = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: HOME_THEME.text } as const;

  return (
    <PageShell>
      <Card
        variant="dissolve"
        title="GEX 3D Perspective Map"
        subtitle={
          live.loading
            ? "Loading today's recorded surface…"
            : live.error
            ? `History unavailable — ${live.error}`
            : `${live.expiry || "—"} · ${live.times.length} snapshots · ${live.date} · peak ${fmtGex(live.peak)}`
        }
        padding={20}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginBottom: 12 }}>
          <span style={legendItem}><span style={legendDot(HOME_THEME.cyan)} />Call wall (+GEX)</span>
          <span style={legendItem}><span style={legendDot(HOME_THEME.red)} />Put wall (−GEX)</span>
          <span style={legendItem}><span style={legendDot(HOME_THEME.orange, true)} />Spot track</span>

          {/* Basis toggle — every GEX surface is OI+Vol default + Vol-only. */}
          <span style={{ display: "inline-flex", gap: 6, marginLeft: 8 }}>
            {(["net", "vol"] as const).map((b) => (
              <button
                key={b}
                onClick={() => setBasis(b)}
                style={basis === b ? { ...homeButtonStyle, padding: "5px 12px" } : { ...homeSecondaryButtonStyle, padding: "5px 12px" }}
              >
                {b === "net" ? "OI+Vol" : "Vol only"}
              </button>
            ))}
          </span>

          <span style={{ ...legendItem, opacity: 0.6, marginLeft: "auto" }}>drag to orbit · scroll to zoom</span>
        </div>

        <div
          style={{
            position: "relative",
            border: `1px solid ${HOME_THEME.border}`,
            borderRadius: 12,
            overflow: "hidden",
            background: HOME_THEME.bg,
          }}
        >
          <canvas
            ref={cvRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerLeave={() => { if (tipRef.current) tipRef.current.style.opacity = "0"; }}
            style={{ display: "block", width: "100%", height: 560, cursor: "grab", touchAction: "none", userSelect: "none" }}
          />
          {!live.loading && !live.error && !live.times.length && (
            <div
              style={{
                position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                textAlign: "center", fontSize: 13, color: HOME_THEME.text, opacity: 0.7, padding: 24,
              }}
            >
              No GEX snapshots recorded for today yet — the writer persists one column per
              minute during RTH. The terrain fills in as the session runs.
            </div>
          )}
          <div
            ref={tipRef}
            style={{
              position: "absolute",
              pointerEvents: "none",
              opacity: 0,
              transition: "opacity .12s",
              background: HOME_THEME.panelBgStrong,
              border: `1px solid ${HOME_THEME.border}`,
              color: HOME_THEME.text,
              fontSize: 11,
              padding: "6px 8px",
              borderRadius: 6,
              whiteSpace: "nowrap",
            }}
          />
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", marginTop: 14, fontSize: 12, color: HOME_THEME.text }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Relief
            <input type="range" min={20} max={260} value={relief} onChange={(e) => setRelief(+e.target.value)} style={{ width: 120, accentColor: HOME_THEME.cyan }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Tilt
            <input type="range" min={8} max={75} value={tilt} onChange={(e) => setTilt(+e.target.value)} style={{ width: 120, accentColor: HOME_THEME.cyan }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={bubbles} onChange={(e) => setBubbles(e.target.checked)} style={{ accentColor: HOME_THEME.cyan }} />
            Bubbles
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} style={{ accentColor: HOME_THEME.cyan }} />
            Auto-orbit
          </label>
          <button
            style={{ ...homeButtonStyle, padding: "6px 12px" }}
            onClick={() => {
              camRef.current = { yaw: -0.62, pitch: (34 * Math.PI) / 180, zoom: 1 };
              setRelief(110);
              setTilt(34);
              draw();
            }}
          >
            Reset view
          </button>
        </div>

        <p style={{ fontSize: 12, color: HOME_THEME.green, marginTop: 14, marginBottom: 0, lineHeight: 1.6 }}>
          Live from <code>/proxy/gex-history?mode=series</code> — today&apos;s recorded per-strike net GEX
          ({basis === "net" ? "OI+Vol composite" : "volume-only"}), one column per snapshot, ±13 strikes
          around spot. Terrain height is normalized to the day&apos;s peak |GEX|, so heights compare
          within the session but not across days.
        </p>
      </Card>
    </PageShell>
  );
}
