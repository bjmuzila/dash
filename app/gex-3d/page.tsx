"use client";

// ─────────────────────────────────────────────────────────────────────────────
// /gex-3d — GEX heatmap rendered as a 3D perspective terrain of towers.
// Positive (call-wall) GEX extrudes UP as blue "ice walls"; negative (put) GEX
// extrudes DOWN as red "magma cliffs" — or up too, via "Flip −GEX up", which
// raises both signs from a common baseline and lets color carry the sign.
// Strikes on X, session time on Z. Strength reads as BOTH height and luminance
// (two-stop color ramps), so a dominant wall is obvious even end-on or flat.
//
// DATA: useGexSurface → /proxy/gex-history?mode=series, out of
// option_strike_gex_history. The session ROLLS AT 08:00 ET, not midnight: the
// finished session's terrain stays up all night and hands over to the new
// contract in the morning, rather than blanking at midnight. Polls every 30
// MINUTES on purpose — this is a session-shape view, not a live tape — with a
// manual Refresh for when you want it now.
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
/** Blend two theme hexes; t=0 → a, t=1 → b. Returns [r,g,b]. */
function mixRgb(a: string, b: string, t: number): [number, number, number] {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return [r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k];
}
/** Apply a light factor to an [r,g,b] and return a css rgb string. */
function litRgb([r, g, b]: [number, number, number], f: number, a = 1): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v * f)));
  return `rgba(${c(r)},${c(g)},${c(b)},${a})`;
}

// Two-stop ramps: weak strikes sit at the DEEP end, dominant walls climb to the
// BRIGHT end. Strength therefore reads as luminance, not just height — which is
// what makes the big walls pop when the map is tilted flat or viewed end-on.
const ICE_DEEP = HOME_THEME.purple;   // weak +GEX
const ICE = HOME_THEME.cyan;          // mid +GEX
const ICE_HI = LIGHT_BLUE;            // dominant call wall
const MAGMA_DEEP = "#7f1d1d";         // weak −GEX (deep ember; no theme token this dark)
const MAGMA = HOME_THEME.red;         // mid −GEX
const MAGMA_HI = HOME_THEME.orange;   // dominant put wall (white-hot magma)
const SPOT = HOME_THEME.orange;
const AXIS = HOME_THEME.text;

/** |normalized GEX| at/above which a strike counts as a "strong" wall. */
const CROSS_THRESHOLD = 0.45;

/** Signed GEX → ramp color at that magnitude. mag is 0…1. */
function rampFor(v: number, mag: number): [number, number, number] {
  const t = Math.min(1, mag);
  return v >= 0
    ? (t < 0.5 ? mixRgb(ICE_DEEP, ICE, t / 0.5) : mixRgb(ICE, ICE_HI, (t - 0.5) / 0.5))
    : (t < 0.5 ? mixRgb(MAGMA_DEEP, MAGMA, t / 0.5) : mixRgb(MAGMA, MAGMA_HI, (t - 0.5) / 0.5));
}

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
  // Column resolution. 30 = every ~13th minute (fast, readable); 400 = every
  // recorded minute (~390 towers × 27 strikes — heavier, but nothing dropped).
  const [buckets, setBuckets] = useState(30);
  const live = useGexSurface(basis, buckets);

  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const surfRef = useRef<Surface>(EMPTY_SURFACE);
  const dimsRef = useRef({ nx: 0, nz: 0 });
  const cellsRef = useRef<Cell[]>([]);
  const camRef = useRef({ yaw: -0.62, pitch: (34 * Math.PI) / 180, zoom: 1, panX: 0, panY: 0 });
  /** mode "orbit" = left-drag; "pan" = right/middle-drag or shift+left-drag. */
  const dragRef = useRef<
    { mode: "orbit" | "pan"; x: number; y: number; yaw: number; pitch: number; panX: number; panY: number } | null
  >(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  const [relief, setRelief] = useState(110);
  const [tilt, setTilt] = useState(34);
  const [heading, setHeading] = useState(-36); // degrees, wrapped to [-180, 180]
  const [absMode, setAbsMode] = useState(false);
  // Newest column at the NEAR edge of the Z axis. End-of-day carries the day's
  // biggest walls, and with time running away from the camera those walls sat at
  // the back, facing away — the tall stuff hid behind the morning's terrain and
  // you read it side-on. Defaults ON: the freshest surface faces you.
  const [newestFront, setNewestFront] = useState(true);
  const [spin, setSpin] = useState(false);

  const reliefRef = useRef(relief);
  const absRef = useRef(absMode);
  const newestFrontRef = useRef(newestFront);
  const spinRef = useRef(spin);
  reliefRef.current = relief;
  absRef.current = absMode;
  newestFrontRef.current = newestFront;
  spinRef.current = spin;

  const flipIdx = useRef<number | null>(null);

  const proj = useCallback((gx: number, gy: number, gz: number) => {
    const { yaw, pitch, zoom, panX, panY } = camRef.current;
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
    // pan is applied in SCREEN space (after projection) so dragging the map
    // moves it 1:1 under the cursor at any yaw/pitch/zoom.
    return { x: W / 2 + panX + rx * s, y: H / 2 + 40 + panY - ry * s, s, depth: rz2 };
  }, []);

  const draw = useCallback(() => {
    const cv = cvRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const { w: W, h: H } = sizeRef.current;
    const { strikes, rows, spotPath, times } = surfRef.current;
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
    // "abs" mode raises BOTH signs above the floor at their magnitude — put
    // walls stop hanging below the plane where they're hard to compare against
    // call walls. Sign still drives color, so nothing is lost; it's the same
    // data, just measured from a common baseline.
    const absMode = absRef.current;
    const cells: Cell[] = [];
    for (let z = 0; z < NZ; z++)
      for (let x = 0; x < NX; x++) {
        const v = rows[z]?.[x] ?? 0;
        cells.push({ x, z, v, h: (absMode ? Math.abs(v) : v) * rel, depth: proj(x, 0, z).depth });
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

    // Fixed WORLD-SPACE sun. Faces used to carry constant shade factors keyed on
    // face index, which meant the light rode along with the camera — orbit past
    // 90° and the lit face was still the one facing you, so the terrain looked
    // painted-on instead of solid. Now each side's normal is rotated by yaw and
    // lambert-shaded against a sun that stays put, so going 360° reads as
    // walking around real geometry.
    const { yaw } = camRef.current;
    const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
    const SUN = { x: -0.55, z: -0.83 }; // horizontal sun direction, unit-ish
    const lambert = (nx: number, nz: number) => {
      const wx = nx * cyaw - nz * syaw;   // rotate the face normal into world space
      const wz = nx * syaw + nz * cyaw;
      const d = wx * SUN.x + wz * SUN.z;  // −1 (facing away) … 1 (facing the sun)
      return 0.42 + 0.46 * Math.max(0, d);
    };

    const w = 0.46;
    for (const c of cells) {
      if (Math.abs(c.v) < 0.035) continue;
      const mag = Math.min(1, Math.abs(c.v));
      const rgb = rampFor(c.v, mag);
      const x0 = c.x - w, x1 = c.x + w, z0 = c.z - w, z1 = c.z + w;
      const tA = proj(x0, c.h, z0), tB = proj(x1, c.h, z0), tC = proj(x1, c.h, z1), tD = proj(x0, c.h, z1);
      const bA = proj(x0, 0, z0), bB = proj(x1, 0, z0), bC = proj(x1, 0, z1), bD = proj(x0, 0, z1);
      const faces = [
        { p: [tA, tB, bB, bA], t: tA, b: bA, d: (tA.depth + tB.depth) / 2, f: lambert(0, -1) },
        { p: [tB, tC, bC, bB], t: tB, b: bB, d: (tB.depth + tC.depth) / 2, f: lambert(1, 0) },
        { p: [tC, tD, bD, bC], t: tC, b: bC, d: (tC.depth + tD.depth) / 2, f: lambert(0, 1) },
        { p: [tD, tA, bA, bD], t: tD, b: bD, d: (tD.depth + tA.depth) / 2, f: lambert(-1, 0) },
      ].sort((a, b) => b.d - a.d);

      // Each side face carries a base→crest gradient: the tower darkens into the
      // floor and brightens at the cap, so height and strength reinforce each
      // other instead of every tower being one flat slab of color.
      for (const f of faces) {
        let fill: string | CanvasGradient;
        if (Math.abs(f.t.y - f.b.y) > 1) {
          const g = ctx.createLinearGradient(f.b.x, f.b.y, f.t.x, f.t.y);
          g.addColorStop(0, litRgb(rgb, f.f * 0.5));
          g.addColorStop(1, litRgb(rgb, f.f * 1.25));
          fill = g;
        } else {
          fill = litRgb(rgb, f.f);
        }
        poly(f.p, fill, canvasRgba(HOME_THEME.bg, 0.35));
      }
      // Cap: brightest surface, scaled by strength.
      poly([tA, tB, tC, tD], litRgb(rgb, 1.15 + mag * 0.2), canvasRgba(AXIS, 0.16));

      // Dominant walls get a bloom so they're unmistakable at any angle.
      if (mag > 0.55) {
        ctx.save();
        ctx.globalAlpha = 0.1 + (mag - 0.55) * 0.5;
        ctx.shadowColor = canvasRgba(c.v >= 0 ? ICE_HI : MAGMA_HI, 0.9);
        ctx.shadowBlur = 10 + mag * 14;
        poly([tA, tB, tC, tD], c.v >= 0 ? ICE_HI : MAGMA_HI);
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

    // live spot marker at the head of the track — the NEWEST column, which is
    // z=0 when the axis is reversed, not NZ-1.
    const headZ = newestFrontRef.current ? 0 : NZ - 1;
    {
      const p = proj(gxAt(headZ), RIBBON_Y + 5, headZ);
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
      ctx.fillText(spotPath[headZ].toFixed(0), p.x + 8, p.y - 6);
    }

    // ── wall impacts: rejection vs break-through ───────────────────────────
    // Two very different events, so they get two very different marks:
    //
    //   REJECTION — price closed on a strong strike, touched it, and turned
    //     back the SAME side it came from. Drawn as an impact splash on the
    //     wall face: concentric shockwave arcs + spall lines, sized by |GEX|.
    //     This is price hitting something solid and bouncing off it.
    //
    //   BREAK — price went straight through to the other side. Drawn as a
    //     pierced ring + a breach line through the tower. The wall failed.
    //
    // Detected on the spot ribbon vs the strike nearest it at each column.
    const impacts: { z: number; x: number; v: number; kind: "reject" | "break"; force: number }[] = [];
    const stepPts = strikes.length > 1 ? Math.abs(strikes[1] - strikes[0]) : 5;
    // Array order follows the Z axis, which reverses with `newestFront` — so
    // "the column before this one IN TIME" is z+1 when reversed. Reading z-1
    // blindly would run the physics backwards and swap rejections for breaks.
    const back = newestFrontRef.current ? 1 : -1;   // one step earlier in time
    const fwd = -back;                              // one step later in time
    for (let z = 1; z < NZ - 1; z++) {
      const xi = Math.round(gxAt(z));
      if (xi < 0 || xi >= NX) continue;
      const v = rows[z]?.[xi] ?? 0;
      if (Math.abs(v) < CROSS_THRESHOLD) continue; // only STRONG walls count

      const k = strikes[xi];
      const d0 = spotPath[z + back] - k;  // signed distance to the wall, before
      const d1 = spotPath[z] - k;         //                              at
      const d2 = spotPath[z + fwd] - k;   //                              after
      if (Math.abs(d1) > stepPts) continue; // never actually reached the wall

      const closed = Math.abs(d1) < Math.abs(d0); // was approaching
      if (!closed) continue;

      const crossed = Math.sign(d0) !== 0 && Math.sign(d2) !== 0 && Math.sign(d0) !== Math.sign(d2);
      const turned = Math.abs(d2) > Math.abs(d1); // moving back away
      if (crossed) impacts.push({ z, x: xi, v, kind: "break", force: Math.min(1, Math.abs(v)) });
      else if (turned) impacts.push({ z, x: xi, v, kind: "reject", force: Math.min(1, Math.abs(v)) });
    }

    for (const im of impacts) {
      const top = (absMode ? Math.abs(im.v) : im.v) * rel;
      // Contact point: where the ribbon meets the tower, not the tower's crest —
      // the impact reads as price hitting the wall's FACE.
      const contactY = Math.max(0, Math.min(Math.abs(top), RIBBON_Y));
      const hit = proj(gxAt(im.z), im.v >= 0 ? contactY : -contactY, im.z);
      const wallCol = im.v >= 0 ? ICE_HI : MAGMA_HI;

      ctx.save();
      if (im.kind === "reject") {
        // shockwave: 3 arcs radiating back the way price came from
        const away = Math.sign(spotPath[im.z + back] - strikes[im.x]) || 1;
        const baseR = (4 + im.force * 7) * hit.s;
        ctx.lineWidth = 1.4;
        ctx.shadowColor = canvasRgba(wallCol, 0.9);
        ctx.shadowBlur = 12;
        for (let i = 0; i < 3; i++) {
          const r = baseR * (1 + i * 0.55);
          ctx.strokeStyle = canvasRgba(wallCol, 0.75 - i * 0.2);
          ctx.beginPath();
          // half-arc opening back toward the side price came from
          const a0 = away > 0 ? -Math.PI / 2 : Math.PI / 2;
          ctx.arc(hit.x, hit.y, r, a0, a0 + Math.PI);
          ctx.stroke();
        }
        // spall: short spikes kicking off the face
        ctx.strokeStyle = canvasRgba(SPOT, 0.85);
        ctx.lineWidth = 1;
        for (let i = -2; i <= 2; i++) {
          const ang = (i * 0.32) + (away > 0 ? 0 : Math.PI);
          const L = baseR * (1.1 + Math.abs(i) * 0.12);
          ctx.beginPath();
          ctx.moveTo(hit.x, hit.y);
          ctx.lineTo(hit.x + Math.cos(ang) * L, hit.y + Math.sin(ang) * L * 0.6);
          ctx.stroke();
        }
        // hot core at the point of contact
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, Math.max(1.6, 2.6 * hit.s), 0, Math.PI * 2);
        ctx.fillStyle = canvasRgba(SPOT, 0.95);
        ctx.fill();
      } else {
        // BREAK: pierced ring + breach line straight through the tower
        const a = proj(im.x, 0, im.z);
        const b = proj(im.x, top, im.z);
        ctx.strokeStyle = canvasRgba(SPOT, 0.45);
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = canvasRgba(SPOT, 0.9);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, Math.max(2.5, (3 + im.force * 4) * hit.s), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // axes
    ctx.font = "10px var(--font-inter), Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = canvasRgba(AXIS, 0.6);
    // Axis labels ride the edge CURRENTLY nearest the camera. Pinned to a fixed
    // edge they'd end up buried behind the terrain the moment you orbit past 90°.
    // Lower depth = closer to the viewer (see proj).
    const strikeEdgeFar = proj(0, 0, NZ - 1).depth < proj(0, 0, 0).depth;
    const strikeEdgeZ = strikeEdgeFar ? NZ + 0.6 : -1.6;

    const labelStride = Math.max(1, Math.round(NX / 7)); // ~7 strike labels, any ladder width
    for (let x = 0; x < NX; x += labelStride) {
      const p = proj(x, 0, strikeEdgeZ);
      ctx.fillText(String(strikes[x]), p.x, p.y);
    }
    // time axis — real recorded clock times, on whichever X edge faces us
    if (times.length) {
      const timeEdgeRight = proj(NX - 1, 0, 0).depth < proj(0, 0, 0).depth;
      const timeEdgeX = timeEdgeRight ? NX + 1.2 : -2.2;
      ctx.textAlign = timeEdgeRight ? "left" : "right";
      ctx.fillStyle = canvasRgba(AXIS, 0.5);
      const a = proj(timeEdgeX, 0, 0);
      const b = proj(timeEdgeX, 0, NZ - 1);
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

    // Zero-gamma flip from the NEWEST column — taken BEFORE any reversal, since
    // "newest" is the last element of the server's ascending-time arrays.
    const last = live.norm[live.norm.length - 1] || [];
    let fi: number | null = null;
    for (let i = 1; i < last.length; i++) {
      if (last[i - 1] < 0 && last[i] >= 0) { fi = i - 1 + (0 - last[i - 1]) / (last[i] - last[i - 1]); break; }
    }
    flipIdx.current = fi;

    // Time direction is flipped by reversing the arrays ONCE here rather than
    // inverting z at every proj() call site — the towers, ribbon, crossings and
    // axis labels all walk these arrays in lockstep, so one reversal keeps them
    // consistent and there's no z-mapping to forget in a later edit.
    const flip = <T,>(a: T[]) => (newestFront ? [...a].reverse() : a);

    surfRef.current = {
      strikes: live.strikes,
      rows: flip(live.norm),
      raw: flip(live.rows),
      spotPath: flip(spotPath),
      times: flip(live.times),
      peak: live.peak,
    };
    dimsRef.current = { nx: live.strikes.length, nz: live.norm.length };
    draw();
  }, [live, newestFront, draw]);

  useEffect(() => { draw(); }, [relief, absMode, draw]);
  useEffect(() => { camRef.current.pitch = (tilt * Math.PI) / 180; draw(); }, [tilt, draw]);

  // Orbit drag is wired with NATIVE window listeners (see useEffect below), not
  // React synthetic handlers: the pointer routinely leaves the canvas mid-drag,
  // and no React state is written per-move (that re-rendered the whole page on
  // every mousemove and fought the draw loop). Tilt state syncs on pointerup.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault(); // stop text-selection / native image-drag swallowing it
    // Left = orbit. Right / middle / shift+left = pan.
    const mode: "orbit" | "pan" = e.button === 2 || e.button === 1 || e.shiftKey ? "pan" : "orbit";
    dragRef.current = {
      mode,
      x: e.clientX,
      y: e.clientY,
      yaw: camRef.current.yaw,
      pitch: camRef.current.pitch,
      panX: camRef.current.panX,
      panY: camRef.current.panY,
    };
    e.currentTarget.style.cursor = mode === "pan" ? "move" : "grabbing";
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
      if (d.mode === "pan") {
        // 1:1 with the cursor — pan lives in screen space (see proj).
        camRef.current.panX = d.panX + (e.clientX - d.x);
        camRef.current.panY = d.panY + (e.clientY - d.y);
      } else {
        // Yaw is deliberately UNBOUNDED — you can lap the map as many times as
        // you like; it's normalized to [-π, π] on release. Pitch spans −88°…88°:
        // NEGATIVE pitch puts the camera under the floor plane looking up, which
        // is the only way to read +GEX towers from below. The old 2° floor was
        // what made the map feel like it wouldn't actually rotate all the way.
        camRef.current.yaw = d.yaw + (e.clientX - d.x) * 0.006;
        camRef.current.pitch = Math.max(-1.535, Math.min(1.535, d.pitch - (e.clientY - d.y) * 0.005));
      }
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
    };
    const up = () => {
      if (!dragRef.current) return;
      const wasPan = dragRef.current.mode === "pan";
      dragRef.current = null;
      cv.style.cursor = "grab";
      if (wasPan) return; // pan doesn't touch yaw/pitch — nothing to sync
      // Wrap yaw into [-π, π] so repeated 360° laps don't accumulate an
      // ever-growing float (and so the heading readout stays sane).
      const TAU = Math.PI * 2;
      camRef.current.yaw = ((camRef.current.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
      setTilt(Math.round((camRef.current.pitch * 180) / Math.PI)); // sync slider once
      setHeading(Math.round((camRef.current.yaw * 180) / Math.PI));
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
      const cam = camRef.current;
      const prev = cam.zoom;
      // Wide range: 0.2× (whole session in frame) to 8× (single strike filling
      // the view). The old 0.5–2.4 clamp made "full zoom" impossible.
      const next = Math.max(0.2, Math.min(8, prev * (e.deltaY > 0 ? 0.9 : 1.111)));
      if (next === prev) return;

      // Zoom toward the CURSOR, not the canvas center: scale the pan offset
      // about the pointer so whatever is under the mouse stays under the mouse.
      // Without this, zooming in on an off-center wall walks it off screen and
      // you have to re-pan after every scroll.
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left - (sizeRef.current.w / 2 + cam.panX);
      const my = e.clientY - r.top - (sizeRef.current.h / 2 + 40 + cam.panY);
      const k = next / prev;
      cam.panX -= mx * (k - 1);
      cam.panY -= my * (k - 1);
      cam.zoom = next;
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
            : (live.stale ? "Last session · " : "") +
              `${live.expiry || "—"} · ${live.times.length} towers` +
              (live.strideMin > 1 ? ` (every ${live.strideMin}th min of ${live.minutesAvailable})` : " (every min)") +
              ` · ${live.date} · peak ${fmtGex(live.peak)}` +
              (live.fetchedAt ? ` · pulled ${fmtClock(live.fetchedAt)}` : "")
        }
        padding={20}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginBottom: 12 }}>
          <span style={legendItem}>
            <span style={{ ...legendDot(HOME_THEME.cyan), width: 26, background: `linear-gradient(90deg, ${HOME_THEME.purple}, ${HOME_THEME.cyan}, ${LIGHT_BLUE})` }} />
            +GEX (weak → strong)
          </span>
          <span style={legendItem}>
            <span style={{ ...legendDot(HOME_THEME.red), width: 26, background: `linear-gradient(90deg, ${MAGMA_DEEP}, ${HOME_THEME.red}, ${HOME_THEME.orange})` }} />
            −GEX (weak → strong)
          </span>
          <span style={legendItem}><span style={legendDot(HOME_THEME.orange, true)} />Spot track / wall crossing</span>

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

          {/* Column resolution — every tower is one minute either way; this only
              controls how many of those minutes survive. */}
          <span style={{ display: "inline-flex", gap: 6 }}>
            {([
              { label: "30 cols", n: 30 },
              { label: "5-min", n: 80 },
              { label: "1-min", n: 400 },
            ] as const).map((r) => (
              <button
                key={r.n}
                onClick={() => setBuckets(r.n)}
                style={buckets === r.n ? { ...homeButtonStyle, padding: "5px 12px" } : { ...homeSecondaryButtonStyle, padding: "5px 12px" }}
              >
                {r.label}
              </button>
            ))}
          </span>

          <button
            style={{ ...homeSecondaryButtonStyle, padding: "5px 10px", marginLeft: "auto" }}
            onClick={live.refresh}
            disabled={live.loading}
          >
            Refresh
          </button>
          <span style={{ ...legendItem, opacity: 0.6 }}>
            drag = orbit 360° · right/shift-drag = pan · scroll = zoom
          </span>
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
            onContextMenu={(e) => e.preventDefault()} // right-drag is pan, not a menu
            style={{ display: "block", width: "100%", height: 560, cursor: "grab", touchAction: "none", userSelect: "none" }}
          />
          {live.stale && !!live.times.length && (
            <div
              style={{
                position: "absolute", top: 10, left: 10, fontSize: 10, fontWeight: 700,
                letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 8px",
                borderRadius: 4, color: HOME_THEME.orange,
                border: `1px solid ${HOME_THEME.border}`, background: HOME_THEME.panelBgStrong,
                pointerEvents: "none",
              }}
            >
              Last session · rolls at 8:00 AM ET
            </div>
          )}
          {!live.loading && !live.error && !live.times.length && (
            <div
              style={{
                position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                textAlign: "center", fontSize: 13, color: HOME_THEME.text, opacity: 0.7, padding: 24,
              }}
            >
              No GEX snapshots recorded for this session yet — the writer persists one column per
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
            {/* negative = camera below the floor plane, looking up at the towers */}
            <input type="range" min={-88} max={88} value={tilt} onChange={(e) => setTilt(+e.target.value)} style={{ width: 120, accentColor: HOME_THEME.cyan }} />
            <span style={{ width: 34, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>{tilt}°</span>
          </label>
          {/* Full 360° orbit — the drag already wraps; this is the scrub version. */}
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Orbit
            <input
              type="range"
              min={-180}
              max={180}
              value={heading}
              onChange={(e) => {
                const deg = +e.target.value;
                setHeading(deg);
                camRef.current.yaw = (deg * Math.PI) / 180;
                draw();
              }}
              style={{ width: 140, accentColor: HOME_THEME.cyan }}
            />
            <span style={{ width: 34, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>{heading}°</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }} title="Raise put walls above the floor too — sign still drives color">
            <input type="checkbox" checked={absMode} onChange={(e) => setAbsMode(e.target.checked)} style={{ accentColor: HOME_THEME.cyan }} />
            Flip −GEX up
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }} title="Put the newest (end-of-day) columns at the front, facing you">
            <input type="checkbox" checked={newestFront} onChange={(e) => setNewestFront(e.target.checked)} style={{ accentColor: HOME_THEME.cyan }} />
            Newest in front
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} style={{ accentColor: HOME_THEME.cyan }} />
            Auto-orbit
          </label>

          {/* Preset camera stations around the map. */}
          {([
            { label: "Front", yaw: 0, pitch: 24 },
            { label: "Side", yaw: -90, pitch: 22 },
            { label: "Behind", yaw: 180, pitch: 24 },
            { label: "Top", yaw: -36, pitch: 82 },
            { label: "Under", yaw: -36, pitch: -40 }, // below the floor, looking up
          ] as const).map((v) => (
            <button
              key={v.label}
              style={{ ...homeSecondaryButtonStyle, padding: "5px 10px" }}
              onClick={() => {
                camRef.current.yaw = (v.yaw * Math.PI) / 180;
                camRef.current.pitch = (v.pitch * Math.PI) / 180;
                camRef.current.panX = 0; // recenter — a preset with stale pan can land off-screen
                camRef.current.panY = 0;
                setHeading(v.yaw);
                setTilt(v.pitch);
                draw();
              }}
            >
              {v.label}
            </button>
          ))}

          <button
            style={{ ...homeButtonStyle, padding: "6px 12px" }}
            onClick={() => {
              camRef.current = { yaw: -0.62, pitch: (34 * Math.PI) / 180, zoom: 1, panX: 0, panY: 0 };
              setRelief(110);
              setTilt(34);
              setHeading(-36);
              draw();
            }}
          >
            Reset view
          </button>
        </div>

        <p style={{ fontSize: 12, color: HOME_THEME.green, marginTop: 14, marginBottom: 0, lineHeight: 1.6 }}>
          Live from <code>/proxy/gex-history?mode=series</code> — today&apos;s recorded per-strike net GEX
          ({basis === "net" ? "OI+Vol composite" : "volume-only"}), RTH only (9:30–16:00 ET), ±13 strikes
          around spot. <b>Every tower is one minute&apos;s snapshot</b> — the resolution buttons only
          change how many of those minutes survive (30 cols ≈ every 13th minute; 1-min drops
          nothing). Nothing is averaged. Height and color ramp are normalized to the day&apos;s peak
          |GEX| — comparable within the session, not across days. Where spot reached a strike holding
          |GEX| ≥ {CROSS_THRESHOLD}× peak: a <b>shockwave splash</b> means price turned back
          (rejection), a <b>pierced ring</b> means it broke through.
        </p>
      </Card>
    </PageShell>
  );
}
