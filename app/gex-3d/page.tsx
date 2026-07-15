"use client";

// ─────────────────────────────────────────────────────────────────────────────
// /gex-3d — GEX heatmap + bubbles rendered as a 3D perspective terrain map.
// Positive (call-wall) GEX extrudes UP as blue "ice walls"; negative (put) GEX
// extrudes DOWN as red "magma cliffs". Strikes on X, session time on Z.
//
// NOTE: the surface is currently SYNTHETIC (see buildSyntheticSurface). Swap
// that one function for a /proxy/gex-history fetch to make it live — everything
// downstream reads the same { strikes, rows, spotPath } shape.
//
// Canvas colors are derived from HOME_THEME tokens via canvasRgba() — no raw
// literals. 2D canvas can't consume CSS vars, so tokens are read into locals.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { HOME_THEME, LIGHT_BLUE, homeButtonStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

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
const NX = 26; // strikes
const NZ = 30; // 5-min-ish session buckets
const STEP = 10;
const CENTER = 5400;

type Surface = { strikes: number[]; rows: number[][]; spotPath: number[] };

function hash(s: number) {
  const x = Math.sin(s * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** REPLACE ME with a /proxy/gex-history pull to go live. */
function buildSyntheticSurface(): Surface {
  const strikes = Array.from({ length: NX }, (_, i) => CENTER - Math.floor(NX / 2) * STEP + i * STEP);
  const anchors = [
    { k: 5450, amp: 1.0, w: 1.4 },
    { k: 5430, amp: 0.52, w: 1.1 },
    { k: 5410, amp: 0.3, w: 1.0 },
    { k: 5400, amp: 0.18, w: 1.2 },
    { k: 5380, amp: -0.44, w: 1.1 },
    { k: 5360, amp: -0.78, w: 1.3 },
    { k: 5330, amp: -0.36, w: 1.0 },
  ];
  const rows: number[][] = [];
  for (let z = 0; z < NZ; z++) {
    const t = z / (NZ - 1);
    const row: number[] = [];
    for (let x = 0; x < NX; x++) {
      let v = 0;
      for (const a of anchors) {
        const d = (strikes[x] - a.k) / (STEP * a.w);
        const grow = a.amp > 0 ? 0.45 + 0.55 * t : 0.95 - 0.35 * t;
        v += a.amp * grow * Math.exp(-d * d * 0.9);
      }
      v += (hash(x * 7.3 + z * 3.1) - 0.5) * 0.09;
      row.push(v);
    }
    rows.push(row);
  }
  const spotPath = Array.from({ length: NZ }, (_, z) => {
    const t = z / (NZ - 1);
    return CENTER + 22 * Math.sin(t * 3.4) + 14 * t + (hash(z * 5.7) - 0.5) * 5;
  });
  return { strikes, rows, spotPath };
}

type Cell = { x: number; z: number; v: number; h: number; depth: number };

export default function Gex3DPage() {
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const surfRef = useRef<Surface>(buildSyntheticSurface());
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

  const flipIdx = useRef(
    (() => {
      const r = surfRef.current.rows[NZ - 1];
      for (let i = 1; i < NX; i++) if (r[i - 1] < 0 && r[i] >= 0) return i - 1 + (0 - r[i - 1]) / (r[i] - r[i - 1]);
      return NX / 2;
    })()
  );

  const proj = useCallback((gx: number, gy: number, gz: number) => {
    const { yaw, pitch, zoom } = camRef.current;
    const { w: W, h: H } = sizeRef.current;
    const SXc = 26, SZc = 17;
    const x = (gx - (NX - 1) / 2) * SXc;
    const z = (gz - (NZ - 1) / 2) * SZc;
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
    const rel = reliefRef.current;

    ctx.fillStyle = HOME_THEME.bg;
    ctx.fillRect(0, 0, W, H);

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

    // zero-gamma flip plane
    {
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
        const v = rows[z][x];
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

    // spot track
    ctx.save();
    ctx.strokeStyle = canvasRgba(SPOT, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let z = 0; z < NZ; z++) {
      const gx = (spotPath[z] - strikes[0]) / STEP;
      const p = proj(gx, 16, z);
      if (z) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
    }
    ctx.shadowColor = canvasRgba(SPOT, 0.6);
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.restore();

    // per-strike |GEX| bubbles floating above the terrain
    if (bubblesRef.current) {
      const bl: { p: ReturnType<typeof proj>; r: number; v: number }[] = [];
      for (let z = 0; z < NZ; z += 2)
        for (let x = 0; x < NX; x++) {
          const v = rows[z][x];
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
    for (let x = 0; x < NX; x += 4) {
      const p = proj(x, 0, NZ + 0.6);
      ctx.fillText(String(strikes[x]), p.x, p.y);
    }
    const tl = proj(NX + 1.2, 0, NZ / 2);
    ctx.textAlign = "left";
    ctx.fillStyle = canvasRgba(AXIS, 0.5);
    ctx.fillText("9:30 → 16:00", tl.x, tl.y);
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

  useEffect(() => { draw(); }, [relief, bubbles, draw]);
  useEffect(() => { camRef.current.pitch = (tilt * Math.PI) / 180; draw(); }, [tilt, draw]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY, yaw: camRef.current.yaw, pitch: camRef.current.pitch };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerUp = () => { dragRef.current = null; };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (d) {
      camRef.current.yaw = d.yaw + (e.clientX - d.x) * 0.006;
      const p = Math.max(0.12, Math.min(1.35, d.pitch - (e.clientY - d.y) * 0.005));
      camRef.current.pitch = p;
      setTilt(Math.round((p * 180) / Math.PI));
      draw();
      return;
    }
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
      const hh = 9.5 + (best.z / (NZ - 1)) * 6.5;
      const hr = Math.floor(hh);
      const mn = Math.round(((hh - hr) * 60) / 5) * 5;
      tip.innerHTML =
        `<b>${surfRef.current.strikes[best.x]}</b> &nbsp;·&nbsp; ${hr}:${String(mn).padStart(2, "0")}<br>` +
        `Net GEX <b style="color:${best.v > 0 ? ICE_HI : MAGMA_HI}">${best.v > 0 ? "+" : ""}${(best.v * 1.4).toFixed(2)}B</b>`;
      tip.style.left = `${mx + 12}px`;
      tip.style.top = `${my - 6}px`;
      tip.style.opacity = "1";
    } else tip.style.opacity = "0";
  };
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    camRef.current.zoom = Math.max(0.5, Math.min(2.4, camRef.current.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
    draw();
  };

  const legendDot = (color: string, round = false) => ({
    width: 11, height: 11, background: color, borderRadius: round ? "50%" : 2, display: "inline-block",
  } as const);
  const legendItem = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: HOME_THEME.text } as const;

  return (
    <PageShell>
      <Card
        variant="dissolve"
        title="GEX 3D Perspective Map"
        subtitle="Call walls extrude up as ice; put walls sink as magma cliffs. Strikes × session time."
        padding={20}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginBottom: 12 }}>
          <span style={legendItem}><span style={legendDot(HOME_THEME.cyan)} />Call wall (+GEX)</span>
          <span style={legendItem}><span style={legendDot(HOME_THEME.red)} />Put wall (−GEX)</span>
          <span style={legendItem}><span style={legendDot(HOME_THEME.orange, true)} />Spot track</span>
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
            onPointerUp={onPointerUp}
            onPointerMove={onPointerMove}
            onPointerLeave={() => { if (tipRef.current) tipRef.current.style.opacity = "0"; }}
            onWheel={onWheel}
            style={{ display: "block", width: "100%", height: 560, cursor: dragRef.current ? "grabbing" : "grab", touchAction: "none" }}
          />
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
          Surface is synthetic placeholder data — swap <code>buildSyntheticSurface()</code> for a{" "}
          <code>/proxy/gex-history</code> pull (same {"{ strikes, rows, spotPath }"} shape) to go live.
        </p>
      </Card>
    </PageShell>
  );
}
