"use client";

// ─────────────────────────────────────────────────────────────────────────────
// /gex-3d — today's SPX GEX as a smooth-shaded 3D terrain (not box towers).
//
// The recorded per-minute grid (strikes × session minutes) is smoothed with a
// separable 1-2-1 kernel and upsampled with Catmull-Rom splines into a
// continuous mesh, lit by a fixed world-space sun (lambert + specular) with
// depth fog. Smoothing shapes the TERRAIN ONLY — every column is still one
// minute's real snapshot, and hover reads the exact raw value from the
// unsmoothed grid. +GEX rises as ice, −GEX drops as magma (or rises too via
// "Flip −GEX up"); strength reads as height AND luminance.
//
// RENDER ARCHITECTURE: the scene (mesh + ribbon + axes) is drawn once per
// camera/data change into an OFFSCREEN layer; a persistent rAF loop composites
// it and animates the FX on top every frame — pulsing wall beacons, flowing
// energy along the price ribbon, and the wall-impact effects (shockwave rings,
// sparks, deflection arrows, break shards). Effects animate at 60fps without
// re-painting ~20k mesh quads.
//
// DATA: useGexSurface → /proxy/gex-history?mode=series (session rolls 08:00 ET,
// 30-min poll + manual refresh). Defaults to 1-MIN columns. The time axis is a
// FIXED world depth (Z_EXTENT) regardless of column count, so a 390-column
// 1-min session is exactly as deep as a 30-column one — dense data makes the
// surface finer, not longer.
//
// Canvas colors are derived from HOME_THEME tokens via canvasRgba()/shade() —
// no raw literals. 2D canvas can't consume CSS vars, so tokens become locals.
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

// Two-stop ramps: weak strikes sit at the DEEP end, dominant walls climb to the
// BRIGHT end. Strength therefore reads as luminance, not just height.
const ICE_DEEP = HOME_THEME.purple;   // weak +GEX
const ICE = HOME_THEME.cyan;          // mid +GEX
const ICE_HI = LIGHT_BLUE;            // dominant call wall
const MAGMA_DEEP = "#7f1d1d";         // weak −GEX (deep ember; no theme token this dark)
const MAGMA = HOME_THEME.red;         // mid −GEX
const MAGMA_HI = HOME_THEME.orange;   // dominant put wall
const SPOT = HOME_THEME.orange;
const AXIS = HOME_THEME.text;

/** |normalized GEX| at/above which a strike counts as a "strong" wall. */
const CROSS_THRESHOLD = 0.45;
/** |normalized GEX| at/above which the newest column gets a pulsing beacon. */
const BEACON_THRESHOLD = 0.55;

// The time axis occupies a FIXED world depth no matter how many columns exist —
// this is what keeps the 1-min surface from stretching into a runway. Per-cell
// spacing still caps at 17 so a sparse 10-column morning doesn't over-stretch.
const Z_EXTENT = 520;
function xCell(nx: number) { return Math.max(10, Math.min(26, 700 / Math.max(1, nx))); }
function zCell(nz: number) { return Math.min(17, Z_EXTENT / Math.max(1, nz)); }

/** Signed GEX → ramp color at that magnitude. mag is 0…1. */
function rampFor(v: number, mag: number): [number, number, number] {
  const t = Math.min(1, mag);
  return v >= 0
    ? (t < 0.5 ? mixRgb(ICE_DEEP, ICE, t / 0.5) : mixRgb(ICE, ICE_HI, (t - 0.5) / 0.5))
    : (t < 0.5 ? mixRgb(MAGMA_DEEP, MAGMA, t / 0.5) : mixRgb(MAGMA, MAGMA_HI, (t - 0.5) / 0.5));
}

// ── data ────────────────────────────────────────────────────────────────────
/** Renderer-local shape: the live surface flattened to what the mesh needs. */
type Surface = {
  strikes: number[];
  /** Normalized (~±1) grid: rows[t][s]. null = no row recorded (≠ zero GEX). */
  rows: (number | null)[][];
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

/** Hover target at ORIGINAL grid resolution (mesh vertices are too dense). */
type Cell = { x: number; z: number; v: number; h: number; missing: boolean };

/**
 * Contrast curve applied to the normalized magnitude before it becomes height
 * and color. Everything is scaled by the DAY'S PEAK |GEX| (usually one huge ATM
 * wall), so under "linear" a real 4%-of-peak strike renders as 4% height —
 * visually nothing. √ and log lift the small end so the far ladder is legible;
 * they change the SHAPE of the height mapping, not the data.
 */
type Curve = "linear" | "sqrt" | "log";
function applyCurve(mag: number, curve: Curve): number {
  const m = Math.min(1, Math.abs(mag));
  if (curve === "sqrt") return Math.sqrt(m);
  if (curve === "log") return Math.log10(1 + 9 * m); // 0→0, 1→1
  return m;
}

// ── mesh ────────────────────────────────────────────────────────────────────
function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}

type BuiltMesh = {
  nxM: number; nzM: number; zUp: number;
  /** Original strike count — Gh is nzM × nxG. */
  nxG: number;
  /** World grid-x of each mesh column (strike-index units; NON-uniform). */
  gxPos: Float32Array;
  /** Z-processed WORLD height per strike center (nzM × nxG) — line draping. */
  Gh: Float32Array;
  /** World height per mesh vertex (profile + absMode + relief applied). */
  hs: Float32Array;
  /** Per-quad base color (pre-lighting) + |v| + face normal. */
  qR: Float32Array; qG: Float32Array; qB: Float32Array; qMag: Float32Array;
  qNx: Float32Array; qNy: Float32Array; qNz: Float32Array;
  /** Smoothed world height sampled back at ORIGINAL grid verts — hover/FX. */
  hoverH: Float32Array;
};

/**
 * Grid → flush-tower mesh. TIME gets the smoothing (1-2-1 blur + Catmull-Rom
 * upsample); STRIKES get NONE — cross-strike interpolation melted adjacent
 * walls into plateaus twice. Each strike is a flat-topped slab over its full
 * cell, flush against its neighbors, with a shared vertical wall face where
 * heights differ — the box-tower look, kept smooth along the session and lit
 * and fogged like terrain.
 */
function buildMesh(
  norm: (number | null)[][], nx: number, nz: number,
  curve: Curve, absMode: boolean, relief: number,
): BuiltMesh | null {
  if (nx < 2 || nz < 2) return null;

  let a = new Float32Array(nz * nx);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const v = norm[z]?.[x];
    a[z * nx + x] = v == null || !Number.isFinite(v) ? 0 : applyCurve(v, curve) * (v < 0 ? -1 : 1);
  }

  // Z-ONLY 1-2-1 smoothing — time is where the minute jitter lives. X is
  // never blurred: that's what merged the levels.
  const zPasses = nz > 150 ? 2 : 1;
  for (let p = 0; p < zPasses; p++) {
    const o = new Float32Array(nz * nx);
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      o[z * nx + x] =
        0.25 * a[Math.max(0, z - 1) * nx + x] + 0.5 * a[z * nx + x] + 0.25 * a[Math.min(nz - 1, z + 1) * nx + x];
    }
    a = o;
  }

  // Catmull-Rom upsample along TIME (still per strike — nothing crosses X).
  const zUp = nz <= 40 ? 4 : nz <= 100 ? 2 : 1;
  const nzM = (nz - 1) * zUp + 1;
  let G = a;
  if (zUp > 1) {
    G = new Float32Array(nzM * nx);
    for (let x = 0; x < nx; x++) for (let zm = 0; zm < nzM; zm++) {
      const zf = zm / zUp;
      const i = Math.min(nz - 2, Math.floor(zf));
      const t = zf - i;
      G[zm * nx + x] = t === 0
        ? a[i * nx + x]
        : catmull(a[Math.max(0, i - 1) * nx + x], a[i * nx + x], a[(i + 1) * nx + x], a[Math.min(nz - 1, i + 2) * nx + x], t);
    }
  }
  // World height at strike CENTERS (nzM × nx) — what the price line drapes on.
  const Gh = new Float32Array(nzM * nx);
  for (let i = 0; i < G.length; i++) Gh[i] = (absMode ? Math.abs(G[i]) : G[i]) * relief;

  // ── X: flush TOWERS. Each strike is a flat-topped slab spanning its full
  // cell [i−0.5, i+0.5], flush against its neighbors — NO grooves, NO gaps.
  // The boundary between two strikes is a pair of mesh columns at the SAME x,
  // each carrying its own side's height: the quad between them is the vertical
  // wall face, exactly like the old box towers — but tops stay smooth in time.
  const nxM = 2 * nx;
  const gxPos = new Float32Array(nxM);
  const col = new Int32Array(nxM);
  for (let i = 0; i < nx; i++) {
    gxPos[2 * i] = i - 0.5; col[2 * i] = i;
    gxPos[2 * i + 1] = i + 0.5; col[2 * i + 1] = i;
  }

  const hs = new Float32Array(nzM * nxM);
  const vs = new Float32Array(nzM * nxM);
  for (let zm = 0; zm < nzM; zm++) {
    const gr = zm * nx, mr = zm * nxM;
    for (let xm = 0; xm < nxM; xm++) {
      const v = G[gr + col[xm]];
      vs[mr + xm] = v;
      hs[mr + xm] = (absMode ? Math.abs(v) : v) * relief;
    }
  }

  const hoverH = new Float32Array(nz * nx);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) hoverH[z * nx + x] = Gh[z * zUp * nx + x];

  const nQ = (nxM - 1) * (nzM - 1);
  const qR = new Float32Array(nQ), qG = new Float32Array(nQ), qB = new Float32Array(nQ);
  const qMag = new Float32Array(nQ);
  const qNx = new Float32Array(nQ), qNy = new Float32Array(nQ), qNz = new Float32Array(nQ);
  const SXc = xCell(nx), SZm = zCell(nz) / zUp;
  let qi = 0;
  for (let zm = 0; zm < nzM - 1; zm++) for (let xm = 0; xm < nxM - 1; xm++, qi++) {
    const ia = zm * nxM + xm, ib = ia + 1, id = ia + nxM, ic = id + 1;
    // Wall quads sit between two strikes at the same x — color them by the
    // DOMINANT side so a tall wall's face isn't washed out by a weak neighbor.
    const vA = (vs[ia] + vs[id]) / 2, vB = (vs[ib] + vs[ic]) / 2;
    const v = Math.abs(vA) >= Math.abs(vB) ? vA : vB;
    const mag = Math.min(1, Math.abs(v));
    const [r, g, b] = rampFor(v, mag);
    qR[qi] = r; qG[qi] = g; qB[qi] = b; qMag[qi] = mag;
    // Face normal from height slopes in WORLD units → real lambert shading.
    // X spacing is non-uniform (groove/shoulder/center), so use the real dx.
    const dxw = Math.max(0.05, gxPos[xm + 1] - gxPos[xm]) * SXc;
    const dhdx = ((hs[ib] - hs[ia]) + (hs[ic] - hs[id])) / 2 / dxw;
    const dhdz = ((hs[id] - hs[ia]) + (hs[ic] - hs[ib])) / 2 / SZm;
    const inv = 1 / Math.hypot(dhdx, 1, dhdz);
    qNx[qi] = -dhdx * inv; qNy[qi] = inv; qNz[qi] = -dhdz * inv;
  }
  return { nxM, nzM, zUp, nxG: nx, gxPos, Gh, hs, qR, qG, qB, qMag, qNx, qNy, qNz, hoverH };
}

/**
 * Surface height for the draped price line. The towers are flat slabs, so the
 * line LAYS FLAT on whichever tower spot is over (no cross-cell averaging —
 * that clipped the line into the taller slab at every boundary). Near a wall
 * (outer 20% of the cell) it blends up to the taller neighbor, so crossings
 * climb/descend the wall face instead of teleporting.
 */
function sampleH(mesh: BuiltMesh, gx: number, gz: number): number {
  const nx = mesh.nxG;
  const zm = Math.max(0, Math.min(mesh.nzM - 1.001, gz * mesh.zUp));
  const z0 = Math.floor(zm), tz = zm - z0;
  const hAt = (x: number) => {
    const i = Math.max(0, Math.min(nx - 1, x));
    return mesh.Gh[z0 * nx + i] * (1 - tz) + mesh.Gh[(z0 + 1) * nx + i] * tz;
  };
  const i = Math.max(0, Math.min(nx - 1, Math.round(gx)));
  const u = gx - i; // −0.5…0.5 within the tower's cell
  const hi = hAt(i);
  const w = Math.max(0, (Math.abs(u) - 0.3) / 0.2); // 0 on the cap → 1 at the wall
  return w === 0 ? hi : hi * (1 - w) + Math.max(hi, hAt(u >= 0 ? i + 1 : i - 1)) * w;
}

// ── FX records (world-space; projected fresh every animation frame) ─────────
type ImpactFx = {
  kind: "reject" | "break";
  z: number; x: number; v: number; force: number; seed: number;
  gx: number;       // spot grid-x at the touch column
  yHit: number;     // world y of the contact point
  topWorld: number; // signed wall top (world units) — barrier pane height
  away: number;     // side price came from (sign)
  z2: number; gx2: number; // one step later in time — arrow / shard direction
};
type BeaconFx = { x: number; y: number; v: number };
type FxState = {
  gx: Float32Array;
  /** World y of the DRAPED price line per column (surface height + lift). */
  yPath: Float32Array;
  headZ: number; impacts: ImpactFx[]; beacons: BeaconFx[];
};

// Fixed world-space sun (unit vector). Faces are lambert-shaded against it
// after rotating their normals by yaw, so orbiting 360° reads as walking
// around solid geometry, not paint that follows the camera.
const SUN_LEN = Math.hypot(-0.45, 0.62, -0.64);
const SUNX = -0.45 / SUN_LEN, SUNY = 0.62 / SUN_LEN, SUNZ = -0.64 / SUN_LEN;

export default function Gex3DPage() {
  const [basis, setBasis] = useState<"net" | "vol">("net");
  // Column resolution. DEFAULT IS 1-MIN (400): the smooth mesh keeps ~390
  // columns readable, and the fixed Z_EXTENT keeps them from stretching the map.
  const [buckets, setBuckets] = useState(400);
  const live = useGexSurface(basis, buckets);

  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<HTMLCanvasElement | null>(null); // offscreen scene layer
  const tipRef = useRef<HTMLDivElement | null>(null);
  const surfRef = useRef<Surface>(EMPTY_SURFACE);
  const dimsRef = useRef({ nx: 0, nz: 0 });
  const meshRef = useRef<BuiltMesh | null>(null);
  const fxRef = useRef<FxState | null>(null);
  const cellsRef = useRef<Cell[]>([]);
  const needsRef = useRef(true); // scene layer dirty flag
  const dprRef = useRef(1);
  const bufRef = useRef<{ px: Float32Array; py: Float32Array; pd: Float32Array; depths: Float32Array; order: Int32Array } | null>(null);
  const camRef = useRef({ yaw: -0.62, pitch: (34 * Math.PI) / 180, zoom: 1, panX: 0, panY: 0 });
  /** mode "orbit" = left-drag; "pan" = right/middle-drag or shift+left-drag. */
  const dragRef = useRef<
    { mode: "orbit" | "pan"; x: number; y: number; yaw: number; pitch: number; panX: number; panY: number } | null
  >(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  const [relief, setRelief] = useState(120);
  const [tilt, setTilt] = useState(34);
  const [heading, setHeading] = useState(-36); // degrees, wrapped to [-180, 180]
  const [absMode, setAbsMode] = useState(false);
  // Default √: with linear scaling everything but the ATM wall is a smear on
  // the floor, which reads as missing data. See applyCurve.
  const [curve, setCurve] = useState<Curve>("sqrt");
  // Newest column at the NEAR edge of the Z axis: the freshest walls face you.
  const [newestFront, setNewestFront] = useState(true);
  const [spin, setSpin] = useState(false);

  const reliefRef = useRef(relief);
  const absRef = useRef(absMode);
  const curveRef = useRef(curve);
  const newestFrontRef = useRef(newestFront);
  const spinRef = useRef(spin);
  reliefRef.current = relief;
  absRef.current = absMode;
  curveRef.current = curve;
  newestFrontRef.current = newestFront;
  spinRef.current = spin;

  const flipIdx = useRef<number | null>(null);

  const invalidate = useCallback(() => { needsRef.current = true; }, []);

  const proj = useCallback((gx: number, gy: number, gz: number) => {
    const { yaw, pitch, zoom, panX, panY } = camRef.current;
    const { w: W, h: H } = sizeRef.current;
    const { nx, nz } = dimsRef.current;
    const SXc = xCell(nx);
    const SZc = zCell(nz); // fixed total depth — see Z_EXTENT
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

  // ── rebuild: data/settings → mesh + hover cells + FX records ──────────────
  // Camera-independent, so it runs on data or control changes only — never
  // per frame. Everything here is what the render + FX layers consume.
  const rebuild = useCallback(() => {
    const { rows, spotPath, strikes } = surfRef.current;
    const { nx: NX, nz: NZ } = dimsRef.current;
    const curve = curveRef.current, absMode = absRef.current, rel = reliefRef.current;
    if (!NX || !NZ) { meshRef.current = null; fxRef.current = null; cellsRef.current = []; needsRef.current = true; return; }

    meshRef.current = buildMesh(rows, NX, NZ, curve, absMode, rel);

    // hover cells at original resolution, heights from the SMOOTHED surface so
    // the tooltip anchors to what's actually on screen.
    const hoverH = meshRef.current?.hoverH;
    const cells: Cell[] = [];
    for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
      const v = rows[z]?.[x];
      const missing = v == null || !Number.isFinite(v);
      cells.push({ x, z, v: missing ? 0 : (v as number), h: hoverH ? hoverH[z * NX + x] : 0, missing });
    }
    cellsRef.current = cells;

    // spot → fractional grid index per column (step read from the ladder).
    const step = strikes.length > 1 ? strikes[1] - strikes[0] : 5;
    const gx = new Float32Array(NZ);
    for (let z = 0; z < NZ; z++) gx[z] = Math.max(-0.5, Math.min(NX - 0.5, (spotPath[z] - strikes[0]) / (step || 5)));
    const headZ = newestFrontRef.current ? 0 : NZ - 1;

    // The price line LAYS ON the terrain (2D drape, not an extruded rail):
    // sample the smoothed surface at spot's strike per column, lifted a hair
    // so it rides the skin instead of z-fighting with it.
    const mesh = meshRef.current;
    const yPath = new Float32Array(NZ);
    for (let z = 0; z < NZ; z++) yPath[z] = (mesh ? sampleH(mesh, gx[z], z) : 0) + 5;

    // ── wall impacts: rejection vs break-through ─────────────────────────
    // REJECTION = price closed on a strong strike, touched, turned back the
    // side it came from. BREAK = went straight through. Array order follows
    // the Z axis, which reverses with `newestFront` — so "one step earlier in
    // time" is z+1 when reversed; reading z-1 blindly would run the physics
    // backwards and swap rejections for breaks.
    const impacts: ImpactFx[] = [];
    const stepPts = Math.abs(step) || 5;
    const back = newestFrontRef.current ? 1 : -1;
    const fwd = -back;
    for (let z = 1; z < NZ - 1; z++) {
      const xi = Math.round(gx[z]);
      if (xi < 0 || xi >= NX) continue;
      const v = rows[z]?.[xi] ?? 0;
      if (Math.abs(v) < CROSS_THRESHOLD) continue; // only STRONG walls

      const k = strikes[xi];
      const d0 = spotPath[z + back] - k;
      const d1 = spotPath[z] - k;
      const d2 = spotPath[z + fwd] - k;
      if (Math.abs(d1) > stepPts) continue;            // never actually reached it
      if (!(Math.abs(d1) < Math.abs(d0))) continue;    // wasn't approaching

      const crossed = Math.sign(d0) !== 0 && Math.sign(d2) !== 0 && Math.sign(d0) !== Math.sign(d2);
      const turned = Math.abs(d2) > Math.abs(d1);
      if (!crossed && !turned) continue;

      const shaped = applyCurve(v, curve) * (v < 0 ? -1 : 1);
      const topWorld = (absMode ? Math.abs(shaped) : shaped) * rel;
      impacts.push({
        kind: crossed ? "break" : "reject",
        z, x: xi, v, force: Math.min(1, Math.abs(v)),
        seed: ((z * 0.37 + xi * 0.61) % 1),
        gx: gx[z],
        yHit: yPath[z], // the draped line's own height — impact sits ON the line
        topWorld,
        away: Math.sign(spotPath[z + back] - k) || 1,
        z2: z + fwd, gx2: gx[z + fwd],
      });
    }
    // strongest first; cap so a churny day doesn't become a fireworks show.
    impacts.sort((p, q) => q.force - p.force);
    impacts.length = Math.min(impacts.length, 14);

    // ── beacons: the newest column's dominant walls get a pulsing marker ──
    const beacons: BeaconFx[] = [];
    for (let x = 0; x < NX; x++) {
      const v = rows[headZ]?.[x];
      if (v == null || Math.abs(v) < BEACON_THRESHOLD) continue;
      const shaped = applyCurve(v, curve) * (v < 0 ? -1 : 1);
      beacons.push({ x, y: (absMode ? Math.abs(shaped) : shaped) * rel, v });
    }
    beacons.sort((p, q) => Math.abs(q.v) - Math.abs(p.v));
    beacons.length = Math.min(beacons.length, 8);

    fxRef.current = { gx, yPath, headZ, impacts, beacons };
    needsRef.current = true;
  }, []);

  // ── scene render: mesh + ribbon + panes + axes → offscreen layer ──────────
  const renderScene = useCallback(() => {
    const scene = sceneRef.current;
    const ctx = scene?.getContext("2d");
    if (!scene || !ctx) return;
    const { w: W, h: H } = sizeRef.current;
    const dpr = dprRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // deep-space background: subtle vertical falloff instead of a flat fill.
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, shade(HOME_THEME.bg, 1.4));
    bgGrad.addColorStop(0.55, HOME_THEME.bg);
    bgGrad.addColorStop(1, shade(HOME_THEME.bg, 0.7));
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    const { strikes, times } = surfRef.current;
    const { nx: NX, nz: NZ } = dimsRef.current;
    if (!NX || !NZ) return; // overlay handles the empty message

    const poly = (pts: { x: number; y: number }[], fill: string, stroke?: string) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.5; ctx.stroke(); }
    };

    // floor grid — strides scale with density so 1-min doesn't paint 390 lines.
    ctx.strokeStyle = canvasRgba(ICE, 0.1);
    ctx.lineWidth = 1;
    for (let x = 0; x < NX; x += 2) {
      const a = proj(x, 0, 0), b = proj(x, 0, NZ - 1);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    const zStride = Math.max(1, Math.round(NZ / 24));
    for (let z = 0; z < NZ; z += zStride) {
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

    const mesh = meshRef.current;
    const fx = fxRef.current;

    // ── price line: a flat 2D stroke DRAPED on the terrain ─────────────────
    // Not an extruded 3D rail — the line follows the surface height at spot's
    // strike (fx.yPath), so it visibly climbs the walls it's trading against.
    // Still depth-merged per segment with the mesh: canvas 2D has no depth
    // buffer, so the merge IS the depth test — a wall nearer the camera than a
    // stretch of track occludes it, like a wall should.
    type Seg = { d: number; x0: number; y0: number; x1: number; y1: number };
    const segs: Seg[] = [];
    if (fx) {
      for (let z = 0; z < NZ - 1; z++) {
        const a = proj(fx.gx[z], fx.yPath[z], z);
        const b = proj(fx.gx[z + 1], fx.yPath[z + 1], z + 1);
        segs.push({
          d: proj((fx.gx[z] + fx.gx[z + 1]) / 2, (fx.yPath[z] + fx.yPath[z + 1]) / 2, z + 0.5).depth,
          x0: a.x, y0: a.y, x1: b.x, y1: b.y,
        });
      }
      segs.sort((p, q) => q.d - p.d);
    }
    const drawSeg = (s: Seg) => {
      ctx.lineCap = "round";
      // dark halo first so the line separates from same-hue terrain beneath it
      ctx.strokeStyle = canvasRgba(HOME_THEME.bg, 0.7);
      ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); ctx.stroke();
      ctx.strokeStyle = canvasRgba(SPOT, 0.95);
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); ctx.stroke();
    };

    // ── terrain mesh, depth-sorted and merged with the ribbon ─────────────
    if (mesh) {
      const { nxM, nzM, zUp, gxPos, hs } = mesh;
      const nV = nxM * nzM, nQ = (nxM - 1) * (nzM - 1);
      let buf = bufRef.current;
      if (!buf || buf.px.length !== nV || buf.depths.length !== nQ) {
        buf = {
          px: new Float32Array(nV), py: new Float32Array(nV), pd: new Float32Array(nV),
          depths: new Float32Array(nQ), order: new Int32Array(nQ),
        };
        bufRef.current = buf;
      }
      const { px, py, pd, depths, order } = buf;

      let minD = Infinity, maxD = -Infinity;
      for (let zm = 0; zm < nzM; zm++) {
        const r = zm * nxM, gz = zm / zUp;
        for (let xm = 0; xm < nxM; xm++) {
          const i = r + xm;
          const p = proj(gxPos[xm], hs[i], gz);
          px[i] = p.x; py[i] = p.y; pd[i] = p.depth;
          if (p.depth < minD) minD = p.depth;
          if (p.depth > maxD) maxD = p.depth;
        }
      }
      let qi = 0;
      for (let zm = 0; zm < nzM - 1; zm++) {
        const r0 = zm * nxM, r1 = r0 + nxM;
        for (let xm = 0; xm < nxM - 1; xm++, qi++) {
          depths[qi] = (pd[r0 + xm] + pd[r0 + xm + 1] + pd[r1 + xm] + pd[r1 + xm + 1]) * 0.25;
          order[qi] = qi;
        }
      }
      order.sort((A, B) => depths[B] - depths[A]);

      const { yaw } = camRef.current;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const bgRgb = hexToRgb(HOME_THEME.bg);
      const fogSpan = Math.max(1, maxD - minD);
      const qW = nxM - 1;
      let si = 0;
      for (let k = 0; k < nQ; k++) {
        const q = order[k];
        const qd = depths[q];
        while (si < segs.length && segs[si].d >= qd) drawSeg(segs[si++]);
        const zm = (q / qW) | 0, xm = q - zm * qW;
        const ia = zm * nxM + xm, ib = ia + 1, id = ia + nxM, ic = id + 1;
        // lambert + a specular kiss on strong walls, faded into bg with depth.
        const wx = mesh.qNx[q] * cy - mesh.qNz[q] * sy;
        const wz = mesh.qNx[q] * sy + mesh.qNz[q] * cy;
        const dot = Math.max(0, wx * SUNX + mesh.qNy[q] * SUNY + wz * SUNZ);
        const f = 0.4 + 0.72 * dot + Math.pow(dot, 12) * 0.5 * mesh.qMag[q];
        const fog = Math.max(0, Math.min(1, (qd - minD) / fogSpan)) * 0.42;
        const r = Math.min(255, mesh.qR[q] * f) * (1 - fog) + bgRgb[0] * fog;
        const g = Math.min(255, mesh.qG[q] * f) * (1 - fog) + bgRgb[1] * fog;
        const b = Math.min(255, mesh.qB[q] * f) * (1 - fog) + bgRgb[2] * fog;
        const fill = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
        ctx.beginPath();
        ctx.moveTo(px[ia], py[ia]);
        ctx.lineTo(px[ib], py[ib]);
        ctx.lineTo(px[ic], py[ic]);
        ctx.lineTo(px[id], py[id]);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        // hairline stroke in the same color seals AA seams between quads —
        // without it the mesh shows a faint grid of background-colored cracks.
        ctx.strokeStyle = fill;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
      while (si < segs.length) drawSeg(segs[si++]);
    } else {
      for (const s of segs) drawSeg(s);
    }

    // ── barrier panes on rejections (static part; the FX layer animates) ───
    // A translucent pane across the rejecting strike, spanning the columns
    // around the touch and the wall's height — price visibly runs into a
    // surface and turns. Rendered from the same strike + height as the
    // terrain: it's the wall that's already there, not an invented one.
    if (fx) {
      const zPad = Math.max(1.6, 10 / zCell(NZ));
      for (const im of fx.impacts) {
        if (im.kind === "reject") {
          const z0 = Math.max(0, im.z - zPad), z1 = Math.min(NZ - 1, im.z + zPad);
          const yTop = Math.max(Math.abs(im.topWorld), 30);
          const sgn = im.v >= 0 || absRef.current ? 1 : -1;
          const col = im.v >= 0 ? ICE_HI : MAGMA_HI;
          poly(
            [proj(im.x, 0, z0), proj(im.x, sgn * yTop, z0), proj(im.x, sgn * yTop, z1), proj(im.x, 0, z1)],
            canvasRgba(col, 0.14), canvasRgba(col, 0.45),
          );
        } else {
          // break: dashed breach line straight up the pierced tower
          const a = proj(im.x, 0, im.z), b = proj(im.x, im.topWorld, im.z);
          ctx.save();
          ctx.strokeStyle = canvasRgba(SPOT, 0.45);
          ctx.lineWidth = 1.2;
          ctx.setLineDash([2, 4]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.restore();
        }
      }
    }

    // ── axes ────────────────────────────────────────────────────────────────
    ctx.font = "10px var(--font-inter), Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = canvasRgba(AXIS, 0.6);
    // Labels ride the edge CURRENTLY nearest the camera; pinned to a fixed edge
    // they'd bury behind the terrain past 90° of orbit. Pads are converted to
    // grid units so they hold a constant SCREEN gap at any column density.
    const padZ = Math.max(1.6, 22 / zCell(NZ));
    const strikeEdgeFar = proj(0, 0, NZ - 1).depth < proj(0, 0, 0).depth;
    const strikeEdgeZ = strikeEdgeFar ? NZ - 1 + padZ : -padZ;
    const labelStride = Math.max(1, Math.round(NX / 7));
    for (let x = 0; x < NX; x += labelStride) {
      const p = proj(x, 0, strikeEdgeZ);
      ctx.fillText(String(strikes[x]), p.x, p.y);
    }
    if (times.length) {
      const padX = Math.max(1.2, 30 / xCell(NX));
      const timeEdgeRight = proj(NX - 1, 0, 0).depth < proj(0, 0, 0).depth;
      const timeEdgeX = timeEdgeRight ? NX - 1 + padX : -padX;
      ctx.textAlign = timeEdgeRight ? "left" : "right";
      ctx.fillStyle = canvasRgba(AXIS, 0.5);
      const a = proj(timeEdgeX, 0, 0);
      const b = proj(timeEdgeX, 0, NZ - 1);
      ctx.fillText(fmtClock(times[0]), a.x, a.y);
      ctx.fillText(fmtClock(times[times.length - 1]), b.x, b.y);
    }
  }, [proj]);

  // ── FX compositor: scene blit + animated effects, every frame ─────────────
  const paint = useCallback((now: number) => {
    const cv = cvRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const scene = sceneRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (scene && scene.width) ctx.drawImage(scene, 0, 0);
    const dpr = dprRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { nx: NX, nz: NZ } = dimsRef.current;
    const fx = fxRef.current;
    if (!NX || !NZ || !fx) return;
    const { spotPath } = surfRef.current;

    // NO animated dash/flow on the price line — the solid draped stroke in the
    // scene layer is the whole line. (The moving dashes read as broken/glitchy.)

    // pulsing beacons on the newest column's dominant walls — the "huge GEX
    // levels" announce themselves without hunting.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const bc of fx.beacons) {
      const c = proj(bc.x, bc.y, fx.headZ);
      const col = bc.v >= 0 ? ICE_HI : MAGMA_HI;
      const a = 0.14 + 0.12 * (0.5 + 0.5 * Math.sin(now / 420 + bc.x));
      const up = bc.y >= 0 ? -1 : 1; // pillar rises off the crest, away from the floor
      const g = ctx.createLinearGradient(c.x, c.y, c.x, c.y + up * 52 * c.s);
      g.addColorStop(0, canvasRgba(col, a * 2.2));
      g.addColorStop(1, canvasRgba(col, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x, c.y + up * 52 * c.s); ctx.stroke();
      ctx.beginPath();
      ctx.arc(c.x, c.y, (4 + 1.6 * Math.sin(now / 380 + bc.x)) * Math.max(0.5, c.s), 0, Math.PI * 2);
      ctx.fillStyle = canvasRgba(col, a);
      ctx.fill();
    }
    ctx.restore();

    // ── wall impacts ────────────────────────────────────────────────────────
    for (const im of fx.impacts) {
      const hit = proj(im.gx, im.yHit, im.z);
      const col = im.v >= 0 ? ICE_HI : MAGMA_HI;
      const s = Math.max(0.5, hit.s);

      if (im.kind === "reject") {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        // shockwave: staggered half-rings radiating back the way price came
        const a0 = im.away > 0 ? -Math.PI / 2 : Math.PI / 2;
        ctx.lineWidth = 1.6;
        for (let i = 0; i < 3; i++) {
          const ph = ((now / 1500) + im.seed + i / 3) % 1;
          const r = (5 + 24 * ph * (0.5 + im.force)) * s;
          ctx.strokeStyle = canvasRgba(col, (1 - ph) * 0.55);
          ctx.beginPath();
          ctx.arc(hit.x, hit.y, r, a0, a0 + Math.PI);
          ctx.stroke();
        }
        // sparks kicking off the face, with a little gravity
        const base = im.away > 0 ? 0 : Math.PI;
        for (let i = 0; i < 7; i++) {
          const ph = ((now / 1100) + i * 0.143 + im.seed * 3.7) % 1;
          const ang = base + (i - 3) * 0.3 + Math.sin(im.seed * 99 + i) * 0.12;
          const L = (10 + 18 * im.force) * s * ph;
          ctx.beginPath();
          ctx.arc(hit.x + Math.cos(ang) * L, hit.y + Math.sin(ang) * L * 0.6 + ph * ph * 6 * s, 1.7, 0, Math.PI * 2);
          ctx.fillStyle = canvasRgba(SPOT, (1 - ph) * 0.8);
          ctx.fill();
        }
        // hot core at the point of contact
        ctx.shadowColor = canvasRgba(col, 0.9);
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, (2.6 + 0.9 * Math.sin(now / 180 + im.seed * 10)) * s, 0, Math.PI * 2);
        ctx.fillStyle = canvasRgba(SPOT, 0.95);
        ctx.fill();
        ctx.restore();

        // deflection arrow: contact → where price actually went next. SOLID —
        // dashed/animated strokes on the track read as broken. Drawn from the
        // real spot track — it can't claim a bounce that didn't happen.
        if (im.z2 >= 0 && im.z2 < NZ) {
          const q = proj(im.gx2, fx.yPath[im.z2] + 1, im.z2);
          ctx.save();
          ctx.strokeStyle = canvasRgba(SPOT, 0.85);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(hit.x, hit.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          const ang = Math.atan2(q.y - hit.y, q.x - hit.x);
          const hl = 6 * Math.max(0.6, q.s);
          ctx.beginPath();
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(q.x - hl * Math.cos(ang - 0.4), q.y - hl * Math.sin(ang - 0.4));
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(q.x - hl * Math.cos(ang + 0.4), q.y - hl * Math.sin(ang + 0.4));
          ctx.stroke();
          ctx.restore();
        }
      } else {
        // BREAK: expanding pierced rings + shards carrying on through
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.lineWidth = 1.6;
        for (let i = 0; i < 2; i++) {
          const ph = ((now / 1300) + im.seed + i * 0.5) % 1;
          ctx.strokeStyle = canvasRgba(col, (1 - ph) * 0.5);
          ctx.beginPath();
          ctx.arc(hit.x, hit.y, (4 + 30 * ph * (0.5 + im.force)) * s, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (im.z2 >= 0 && im.z2 < NZ) {
          const q = proj(im.gx2, fx.yPath[im.z2] + 1, im.z2);
          const dx = q.x - hit.x, dy = q.y - hit.y;
          const len = Math.hypot(dx, dy) || 1;
          for (let i = 0; i < 5; i++) {
            const ph = ((now / 1000) + i * 0.2 + im.seed) % 1;
            const spread = ((i - 2) * 3 * s * ph);
            ctx.beginPath();
            ctx.arc(hit.x + dx * ph - (dy / len) * spread, hit.y + dy * ph + (dx / len) * spread, 1.6, 0, Math.PI * 2);
            ctx.fillStyle = canvasRgba(SPOT, (1 - ph) * 0.7);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }

    // live spot marker at the head of the track, breathing
    {
      const p = proj(fx.gx[fx.headZ], fx.yPath[fx.headZ] + 1, fx.headZ);
      const pulse = 1 + 0.18 * Math.sin(now / 260);
      ctx.save();
      ctx.shadowColor = canvasRgba(SPOT, 0.9);
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(3, 5 * p.s) * pulse, 0, Math.PI * 2);
      ctx.fillStyle = shade(SPOT, 1.25);
      ctx.fill();
      ctx.restore();
      ctx.font = "10px var(--font-inter), Inter, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = canvasRgba(SPOT, 0.95);
      if (Number.isFinite(spotPath[fx.headZ])) ctx.fillText(spotPath[fx.headZ].toFixed(0), p.x + 8, p.y - 6);
    }
  }, [proj]);

  // resize + the ONE persistent frame loop (scene re-render only when dirty)
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    if (!sceneRef.current) sceneRef.current = document.createElement("canvas");
    const scene = sceneRef.current;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      dprRef.current = dpr;
      sizeRef.current = { w: cv.clientWidth, h: cv.clientHeight };
      cv.width = cv.clientWidth * dpr;
      cv.height = cv.clientHeight * dpr;
      scene.width = cv.width;
      scene.height = cv.height;
      needsRef.current = true;
    });
    ro.observe(cv);
    let raf = 0;
    const loop = (now: number) => {
      if (spinRef.current && !dragRef.current) {
        camRef.current.yaw += 0.004;
        needsRef.current = true;
      }
      if (needsRef.current) {
        needsRef.current = false;
        renderScene();
      }
      paint(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [renderScene, paint]);

  // Live surface → renderer. Kept in refs so the frame loop never re-subscribes.
  useEffect(() => {
    if (live.loading || !live.strikes.length || !live.rows.length) {
      surfRef.current = EMPTY_SURFACE;
      dimsRef.current = { nx: 0, nz: 0 };
      flipIdx.current = null;
      rebuild();
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
      if (last[i - 1] != null && last[i] != null && (last[i - 1] as number) < 0 && (last[i] as number) >= 0) {
        fi = i - 1 + (0 - (last[i - 1] as number)) / ((last[i] as number) - (last[i - 1] as number));
        break;
      }
    }
    flipIdx.current = fi;

    // Time direction is flipped by reversing the arrays ONCE here rather than
    // inverting z at every proj() call site — mesh, ribbon, impacts and axis
    // labels all walk these arrays in lockstep.
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
    rebuild();
  }, [live, newestFront, rebuild]);

  // Control changes that reshape the mesh (camera-only changes just invalidate).
  useEffect(() => { rebuild(); }, [relief, absMode, curve, rebuild]);
  useEffect(() => { camRef.current.pitch = (tilt * Math.PI) / 180; invalidate(); }, [tilt, invalidate]);

  // Orbit drag is wired with NATIVE window listeners (see useEffect below), not
  // React synthetic handlers: the pointer routinely leaves the canvas mid-drag,
  // and no React state is written per-move. Tilt state syncs on pointerup.
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
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      if (d.mode === "pan") {
        // 1:1 with the cursor — pan lives in screen space (see proj).
        camRef.current.panX = d.panX + (e.clientX - d.x);
        camRef.current.panY = d.panY + (e.clientY - d.y);
      } else {
        // Yaw is deliberately UNBOUNDED — lap the map freely; it's normalized
        // to [-π, π] on release. Pitch spans −88°…88°: NEGATIVE pitch puts the
        // camera under the floor plane looking up.
        camRef.current.yaw = d.yaw + (e.clientX - d.x) * 0.006;
        camRef.current.pitch = Math.max(-1.535, Math.min(1.535, d.pitch - (e.clientY - d.y) * 0.005));
      }
      needsRef.current = true; // frame loop re-renders the scene layer
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
    };
  }, []);

  // Wheel must be a native non-passive listener to cancel page scroll.
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camRef.current;
      const prev = cam.zoom;
      const next = Math.max(0.2, Math.min(8, prev * (e.deltaY > 0 ? 0.9 : 1.111)));
      if (next === prev) return;

      // Zoom toward the CURSOR: scale the pan offset about the pointer so
      // whatever is under the mouse stays under the mouse.
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left - (sizeRef.current.w / 2 + cam.panX);
      const my = e.clientY - r.top - (sizeRef.current.h / 2 + 40 + cam.panY);
      const k = next / prev;
      cam.panX -= mx * (k - 1);
      cam.panY -= my * (k - 1);
      cam.zoom = next;
      needsRef.current = true;
    };
    cv.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onNativeWheel);
  }, []);

  const legendDot = (color: string, round = false) => ({
    width: 11, height: 11, background: color, borderRadius: round ? "50%" : 2, display: "inline-block",
  } as const);
  const legendItem = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: HOME_THEME.text } as const;

  return (
    <PageShell>
      <Card
        variant="dissolve"
        title="GEX 3D Terrain"
        subtitle={
          live.loading
            ? "Loading today's recorded surface…"
            : live.error
            ? `History unavailable — ${live.error}`
            : (live.stale ? "Last session · " : "") +
              `${live.expiry || "—"} · ${live.times.length} columns` +
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
          <span style={legendItem}><span style={legendDot(HOME_THEME.orange, true)} />Spot track / wall impact</span>

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

          {/* Height curve — lifts the far ladder out of the ATM wall's shadow. */}
          <span style={{ display: "inline-flex", gap: 6 }}>
            {([
              { label: "Linear", c: "linear" },
              { label: "√", c: "sqrt" },
              { label: "Log", c: "log" },
            ] as const).map((r) => (
              <button
                key={r.c}
                title="How magnitude maps to height. Linear = true proportions; √/Log lift small strikes so they're visible next to the ATM wall."
                onClick={() => setCurve(r.c)}
                style={curve === r.c ? { ...homeButtonStyle, padding: "5px 12px" } : { ...homeSecondaryButtonStyle, padding: "5px 12px" }}
              >
                {r.label}
              </button>
            ))}
          </span>

          {/* Column resolution — every column is one minute either way; this only
              controls how many of those minutes survive. 1-min is the default. */}
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
            style={{
              display: "block", width: "100%", height: "min(72vh, 900px)",
              cursor: "grab", touchAction: "none", userSelect: "none",
            }}
          />
          {/* CB watermark — top-left of the chart, above the canvas, out of the
              pointer path so it never eats a drag. */}
          <img
            src="/cb-edge-logo.png"
            alt="CB Edge"
            style={{
              position: "absolute", top: 10, left: 12, height: 42, width: "auto",
              opacity: 0.55, pointerEvents: "none", userSelect: "none", zIndex: 2,
              filter: `drop-shadow(0 0 6px ${canvasRgba(HOME_THEME.bg, 0.7)})`,
            }}
          />
          {live.stale && !!live.times.length && (
            <div
              style={{
                position: "absolute", top: 10, right: 10, fontSize: 10, fontWeight: 700,
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
            {/* negative = camera below the floor plane, looking up at the walls */}
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
                invalidate();
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
                invalidate();
              }}
            >
              {v.label}
            </button>
          ))}

          <button
            style={{ ...homeButtonStyle, padding: "6px 12px" }}
            onClick={() => {
              camRef.current = { yaw: -0.62, pitch: (34 * Math.PI) / 180, zoom: 1, panX: 0, panY: 0 };
              setRelief(120);
              setTilt(34);
              setHeading(-36);
              invalidate();
            }}
          >
            Reset view
          </button>
        </div>

        <p style={{ fontSize: 12, color: HOME_THEME.green, marginTop: 14, marginBottom: 0, lineHeight: 1.6 }}>
          Live from <code>/proxy/gex-history?mode=series</code> — today&apos;s recorded per-strike net GEX
          ({basis === "net" ? "OI+Vol composite" : "volume-only"}), RTH only (9:30–16:00 ET), ±13 strikes
          around spot, <b>1-minute columns by default</b>. The surface is a Catmull-Rom–smoothed mesh
          over that grid — smoothing shapes the terrain only; <b>hover reads the exact raw value</b>,
          nothing is averaged into the data. Height/color are normalized to the day&apos;s peak |GEX|;
          <b> √/Log</b> lift the far ladder next to a giant ATM wall. Pulsing beacons mark the newest
          column&apos;s walls at |GEX| ≥ {BEACON_THRESHOLD}× peak. Where spot reached a strike holding
          |GEX| ≥ {CROSS_THRESHOLD}× peak: a <b>barrier pane + animated shockwave, sparks and a
          deflection arrow</b> means price hit it and turned (rejection); <b>expanding rings + shards
          punching through</b> mean it broke.
        </p>
      </Card>
    </PageShell>
  );
}
