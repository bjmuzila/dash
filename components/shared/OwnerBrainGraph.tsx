"use client";

/**
 * OwnerBrainGraph — 3D force-directed "brain" of every CB Edge route.
 *
 * Real 3D: nodes live in (x,y,z), physics runs on a sphere around the CB core,
 * and everything is perspective-projected to the canvas each frame with
 * depth-based size/alpha and painter's-algorithm sorting.
 *
 *   • Click a leaf        → router.push(route)
 *   • ⌘/Ctrl-click a leaf → opens the route in a new tab
 *   • Click a hub         → zoom-focus that cluster (click hub / core again to reset)
 *   • Drag background     → orbit the brain (with inertia; auto-rotates when idle)
 *   • Drag a node         → moves it in the view plane, physics re-settles
 *   • Wheel               → zoom
 *
 * Colors come from OWNER_THEME — no hardcoded palette outside the cluster list,
 * which is intentionally explicit so each domain reads as its own color.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OWNER_THEME } from "./ownerTheme";

type Cluster = { id: string; name: string; color: string; pages: string[] };

// Clustered map of the live app/**/page.tsx tree. Regenerate if routes change.
export const CBEDGE_CLUSTERS: Cluster[] = [
  { id: "core", name: "GEX / Options", color: "#00E0C6", pages: ["/gex", "/gex2", "/flow", "/greeks", "/mult-greek", "/options-chain", "/es-candles", "/footprint", "/confidence-score"] },
  { id: "home", name: "Dashboards", color: "#5AA9FF", pages: ["/home", "/home-fast", "/dashboard", "/overview", "/mobile", "/traders-dashboard", "/premarket"] },
  { id: "signals", name: "Signals / Analysis", color: "#C084FC", pages: ["/ict", "/scanner", "/fails", "/stats", "/top10", "/legging", "/estimated-move", "/em", "/trading"] },
  { id: "data", name: "Data / Calendars", color: "#FB8501", pages: ["/database", "/database/etf", "/economic-calendar", "/expiry-calendar", "/insider", "/quotes", "/analytics", "/logs", "/recipes"] },
  { id: "social", name: "Social", color: "#FF6FAE", pages: ["/social-media", "/chat", "/explore"] },
  { id: "owner", name: "Owner Hub", color: "#34D399", pages: ["/owner/watch", "/owner/probe", "/owner/budget", "/owner/personal", "/owner/personal/todo", "/owner/market-scanner", "/owner/backtests", "/owner/post-studio", "/owner/admin/emails"] },
  { id: "dev", name: "Owner / Dev", color: "#EF4444", pages: ["/owner/dev", "/owner/dev/owner", "/owner/dev/admin", "/owner/dev/sales", "/owner/dev/results", "/owner/dev/tree", "/owner/dev/strike-query", "/owner/dev/bzila-alerts"] },
  { id: "public", name: "Public / Legal", color: "#94A3B8", pages: ["/", "/pricing", "/about-me", "/docs", "/whats-new", "/changelog", "/coming-soon", "/feedback", "/terms", "/privacy", "/disclaimer", "/risk-disclosure", "/unsubscribe", "/maintenance", "/sign-in", "/sign-up"] },
  { id: "lab", name: "Lab / Preview", color: "#FFB703", pages: ["/test", "/preview", "/toolbar-preview"] },
];

type NodeT = {
  id: string;          // route (leaf) / cluster name (hub) / "CB EDGE" (core)
  type: "core" | "hub" | "leaf";
  cluster: string | null;
  color: string;
  rgb: RGB;            // parsed + tinted once — re-parsing hex every frame is wasteful
  r: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  fx: number | null; fy: number | null; fz: number | null;
  // per-frame projection cache
  sx: number; sy: number; ss: number; depth: number;
  // rustic per-node character (seeded, stable)
  phase: number;       // breathing offset — nothing pulses in unison
  spd: number;         // breathing rate
  lean: number;        // specular highlight angle — light hits each ball differently
  squash: number;      // slight non-circularity
};
type LinkT = {
  s: NodeT; t: NodeT; strong: boolean;
  rest: number;        // jittered spring length — uneven branch spacing
  sag: number;         // how much the edge bows
  wob: number;         // bow drift phase
  alpha: number;       // per-edge opacity
  width: number;       // per-edge thickness
};

const FOV = 900;        // perspective strength
const WORLD_R = 430;    // soft bound so the brain never drifts off-screen
type RGB = [number, number, number];
const FOG_RGB: RGB = [5, 7, 12];       // depth fog target — far nodes sink into the bg
const WHITE_RGB: RGB = [255, 255, 255];
const LINK = "70,150,140";             // uniform faint teal for every edge

function hex2rgb(h: string): RGB {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
/** Mix rgb a → rgb b by t (0..1). Stays in triplet space so results re-mix safely. */
function mix(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
const rgbStr = (c: RGB) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
const rgbaStr = (c: RGB, a: number) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

/* ── rustic variance ────────────────────────────────────────────────────────
 * Every irregularity below is SEEDED off the node/link id, never Math.random().
 * Same route always gets the same size, tint, wobble and lean — the graph looks
 * hand-grown but is stable across frames, re-renders and reloads.
 */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** mulberry32 — tiny deterministic PRNG. */
function rngFor(s: string) {
  let a = hash(s);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Nudge a color so no two nodes in a cluster are the exact same flat swatch. */
function tint(c: RGB, r: () => number): RGB {
  const k = (r() - 0.5) * 34;      // brightness drift
  const w = (r() - 0.5) * 18;      // slight hue skew via uneven channel shift
  return [
    Math.max(0, Math.min(255, c[0] + k + w)),
    Math.max(0, Math.min(255, c[1] + k)),
    Math.max(0, Math.min(255, c[2] + k - w)),
  ];
}

export default function OwnerBrainGraph() {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const focusRef = useRef<string | null>(null);
  focusRef.current = focus;

  // id of the cluster currently zoom-focused (null = whole graph)
  const zoomedRef = useRef<string | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const cv = canvasRef.current!;
    const tip = tipRef.current!;
    const ctx = cv.getContext("2d")!;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, raf = 0, t = 0;

    // ── graph ────────────────────────────────────────────────────────────────
    const nodes: NodeT[] = [];
    const links: LinkT[] = [];
    const mk = (id: string, type: NodeT["type"], cluster: string | null, color: string, baseR: number): NodeT => {
      const r = rngFor(id);
      // size varies a lot: some routes are boulders, some are pebbles
      const scale = type === "leaf" ? 0.55 + r() * 1.15 : 0.85 + r() * 0.4;
      return {
        id, type, cluster, color,
        rgb: type === "core" ? hex2rgb(color) : tint(hex2rgb(color), r),
        r: baseR * scale,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fx: null, fy: null, fz: null,
        sx: 0, sy: 0, ss: 1, depth: 0,
        phase: r() * Math.PI * 2,
        spd: 0.02 + r() * 0.05,
        lean: r() * Math.PI * 2,
        squash: 0.9 + r() * 0.2,
      };
    };

    const core = mk("CB EDGE", "core", null, "#FFFFFF", 20);
    nodes.push(core);
    const hubs: Record<string, NodeT> = {};

    // hubs start on a fibonacci sphere, then get knocked off-lattice so the
    // clusters never sit in a tidy ring
    const N = CBEDGE_CLUSTERS.length;
    CBEDGE_CLUSTERS.forEach((c, i) => {
      const hr = rngFor(c.id + "|hub");
      const hub = mk(c.name, "hub", c.id, c.color, 11);
      const phi = Math.acos(1 - (2 * (i + 0.5)) / N) + (hr() - 0.5) * 0.5;
      const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5) + (hr() - 0.5) * 0.7;
      const R = 150 + hr() * 110;   // clusters sit at uneven distances from the core
      hub.x = R * Math.sin(phi) * Math.cos(theta);
      hub.y = R * Math.sin(phi) * Math.sin(theta);
      hub.z = R * Math.cos(phi);
      hubs[c.id] = hub;
      nodes.push(hub);
      links.push({
        s: core, t: hub, strong: true,
        rest: 175 + hr() * 90, sag: (hr() - 0.5) * 26, wob: hr() * 6.28,
        alpha: 0.24 + hr() * 0.2, width: 0.7 + hr() * 0.5,
      });

      c.pages.forEach((p) => {
        const lr = rngFor(p);
        const n = mk(p, "leaf", c.id, c.color, 5);
        // clumpy shell — leaves bunch and straggle instead of sitting on a ring
        const a = lr() * Math.PI * 2;
        const b = Math.asin(lr() * 2 - 1);
        const rr = 42 + Math.pow(lr(), 0.6) * 78;
        n.x = hub.x + Math.cos(a) * Math.cos(b) * rr;
        n.y = hub.y + Math.sin(b) * rr;
        n.z = hub.z + Math.sin(a) * Math.cos(b) * rr;
        nodes.push(n);
        links.push({
          s: hub, t: n, strong: false,
          rest: 38 + lr() * 62, sag: (lr() - 0.5) * 20, wob: lr() * 6.28,
          alpha: 0.1 + lr() * 0.22, width: 0.3 + lr() * 0.5,
        });
      });
    });

    // ── camera ───────────────────────────────────────────────────────────────
    let rotY = 0.4, rotX = -0.25;
    let velY = 0, velX = 0;
    const cam = { zoom: 1, panX: 0, panY: 0 };
    const camT = { zoom: 1, panX: 0, panY: 0 };

    function rotate(x: number, y: number, z: number) {
      const cy = Math.cos(rotY), sy = Math.sin(rotY);
      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      const cx = Math.cos(rotX), sx = Math.sin(rotX);
      const y2 = y * cx - z1 * sx;
      const z2 = y * sx + z1 * cx;
      return { x: x1, y: y2, z: z2 };
    }
    // inverse of rotate() — screen-plane delta back into world space
    function unrotate(x: number, y: number, z: number) {
      const cx = Math.cos(-rotX), sx = Math.sin(-rotX);
      const y1 = y * cx - z * sx;
      const z1 = y * sx + z * cx;
      const cy = Math.cos(-rotY), sy = Math.sin(-rotY);
      const x2 = x * cy - z1 * sy;
      const z2 = x * sy + z1 * cy;
      return { x: x2, y: y1, z: z2 };
    }
    function project(n: NodeT) {
      const r = rotate(n.x, n.y, n.z);
      const persp = FOV / (FOV + r.z);
      n.ss = persp * cam.zoom;
      n.sx = W / 2 + r.x * n.ss + cam.panX;
      n.sy = H / 2 + r.y * n.ss + cam.panY;
      n.depth = r.z;
    }

    function resize() {
      W = wrap.clientWidth; H = wrap.clientHeight;
      cv.width = W * DPR; cv.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── interaction ───────────────────────────────────────────────────────────
    let drag: NodeT | null = null;
    let dragStart = { x: 0, y: 0, z: 0, ss: 1 };
    let orbiting = false;
    let downNode: NodeT | null = null;
    let downX = 0, downY = 0, lastX = 0, lastY = 0, moved = false, downMeta = false;
    let hover: NodeT | null = null;

    function focusCluster(id: string | null) {
      zoomedRef.current = id;
      setFocus(id);
      camT.zoom = id ? 1.9 : 1;
      if (!id) { camT.panX = 0; camT.panY = 0; }
    }
    function rel(e: PointerEvent) {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function pick(sx: number, sy: number): NodeT | null {
      let best: NodeT | null = null, bd = 1e9;
      for (const n of nodes) {
        const d = Math.hypot(n.sx - sx, n.sy - sy);
        if (d < n.r * n.ss + 7 && d < bd) { bd = d; best = n; }
      }
      return best;
    }
    function onMove(e: PointerEvent) {
      const s = rel(e);
      if (Math.hypot(s.x - downX, s.y - downY) > 4) moved = true;

      if (drag) {
        // screen-plane delta → world delta at this node's depth
        const dx = (s.x - downX) / dragStart.ss;
        const dy = (s.y - downY) / dragStart.ss;
        const w = unrotate(dx, dy, 0);
        drag.fx = dragStart.x + w.x;
        drag.fy = dragStart.y + w.y;
        drag.fz = dragStart.z + w.z;
      } else if (orbiting) {
        velY = (s.x - lastX) * 0.005;
        velX = (s.y - lastY) * 0.005;
        rotY += velY;
        rotX = Math.max(-1.3, Math.min(1.3, rotX + velX));
      }
      lastX = s.x; lastY = s.y;

      hover = drag || orbiting ? null : pick(s.x, s.y);
      if (hover) {
        tip.style.opacity = "1";
        tip.style.left = hover.sx + "px";
        tip.style.top = hover.sy + "px";
        tip.textContent =
          hover.type === "core" ? "CB EDGE · reset view"
            : hover.type === "hub" ? hover.id + " · " + (zoomedRef.current === hover.cluster ? "reset" : "focus")
              : hover.id + " · open  (⌘-click: new tab)";
        cv.style.cursor = "pointer";
      } else {
        tip.style.opacity = "0";
        cv.style.cursor = orbiting ? "grabbing" : "grab";
      }
    }
    function onDown(e: PointerEvent) {
      const s = rel(e);
      downX = lastX = s.x; downY = lastY = s.y;
      moved = false;
      downMeta = e.metaKey || e.ctrlKey;
      const n = pick(s.x, s.y);
      downNode = n;
      if (n && n.type !== "core") {
        drag = n;
        dragStart = { x: n.x, y: n.y, z: n.z, ss: n.ss };
        n.fx = n.x; n.fy = n.y; n.fz = n.z;
      } else {
        orbiting = true; velY = 0; velX = 0;
      }
      cv.setPointerCapture(e.pointerId);
    }
    function onUp() {
      if (drag) { drag.fx = null; drag.fy = null; drag.fz = null; }
      if (downNode && !moved) {
        if (downNode.type === "leaf") {
          if (downMeta) window.open(downNode.id, "_blank");
          else router.push(downNode.id);
        } else if (downNode.type === "hub" && downNode.cluster) {
          focusCluster(zoomedRef.current === downNode.cluster ? null : downNode.cluster);
        } else if (downNode.type === "core") {
          focusCluster(null);
        }
      }
      drag = null; downNode = null; orbiting = false;
      cv.style.cursor = "grab";
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      camT.zoom = Math.max(0.5, Math.min(3, camT.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    }
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("pointerleave", () => { tip.style.opacity = "0"; hover = null; });

    // ── physics (3D) ──────────────────────────────────────────────────────────
    function step() {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
          const d2 = dx * dx + dy * dy + dz * dz || 1;
          const d = Math.sqrt(d2);
          const f = Math.min(6500 / d2, 4);
          dx /= d; dy /= d; dz /= d;
          a.vx += dx * f; a.vy += dy * f; a.vz += dz * f;
          b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
        }
      }
      for (const l of links) {
        const a = l.s, b = l.t;
        let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        // per-link rest length (seeded) — branches sit at uneven lengths
        const f = (d - l.rest) * (l.strong ? 0.02 : 0.032);
        dx /= d; dy /= d; dz /= d;
        a.vx += dx * f; a.vy += dy * f; a.vz += dz * f;
        b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
      }
      core.fx = 0; core.fy = 0; core.fz = 0;
      for (const n of nodes) {
        n.vx += -n.x * 0.0012; n.vy += -n.y * 0.0012; n.vz += -n.z * 0.0012;
        if (n.fx != null) { n.x = n.fx; n.y = n.fy!; n.z = n.fz!; n.vx = n.vy = n.vz = 0; continue; }
        n.vx *= 0.86; n.vy *= 0.86; n.vz *= 0.86;
        n.x += n.vx; n.y += n.vy; n.z += n.vz;
        const d = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
        if (d > WORLD_R) { const k = WORLD_R / d; n.x *= k; n.y *= k; n.z *= k; }
      }
    }

    // ── render ────────────────────────────────────────────────────────────────
    function draw() {
      step(); t++;
      const foc = focusRef.current;

      // idle auto-rotation + orbit inertia
      if (!orbiting && !drag) {
        rotY += velY;
        rotX = Math.max(-1.3, Math.min(1.3, rotX + velX));
        velY *= 0.94; velX *= 0.94;
        if (Math.abs(velY) < 0.0008) rotY += 0.0016; // gentle drift
      }

      // keep a focused cluster centred as it moves/rotates
      const zid = zoomedRef.current;
      if (zid) {
        const group = nodes.filter((n) => n.cluster === zid);
        if (group.length) {
          const c = group.reduce((s, n) => ({ x: s.x + n.x, y: s.y + n.y, z: s.z + n.z }), { x: 0, y: 0, z: 0 });
          const r = rotate(c.x / group.length, c.y / group.length, c.z / group.length);
          const persp = FOV / (FOV + r.z);
          camT.panX = -r.x * persp * camT.zoom;
          camT.panY = -r.y * persp * camT.zoom;
        }
      }
      cam.zoom += (camT.zoom - cam.zoom) * 0.1;
      cam.panX += (camT.panX - cam.panX) * 0.1;
      cam.panY += (camT.panY - cam.panY) * 0.1;

      for (const n of nodes) project(n);

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // 0 = nearest, 1 = deepest — drives fog on both links and nodes
      const fogOf = (d: number) => Math.max(0, Math.min(1, (d + WORLD_R) / (WORLD_R * 2)));

      // links — hair-thin teal, each with its own weight and a slow organic bow
      for (const l of links) {
        const dim = foc && l.t.cluster !== foc && l.s.cluster !== foc;
        const fog = fogOf((l.s.depth + l.t.depth) / 2);
        const ss = (l.s.ss + l.t.ss) / 2;
        ctx.globalAlpha = dim ? 0.03 : l.alpha * (1 - fog * 0.85);
        ctx.strokeStyle = `rgb(${LINK})`;
        ctx.lineWidth = l.width * ss;

        // bow the edge perpendicular to its run, drifting slowly over time
        const dx = l.t.sx - l.s.sx, dy = l.t.sy - l.s.sy;
        const len = Math.hypot(dx, dy) || 1;
        const bow = l.sag * ss * (0.75 + 0.25 * Math.sin(t * 0.01 + l.wob));
        const cx = (l.s.sx + l.t.sx) / 2 + (dy / len) * bow;
        const cy = (l.s.sy + l.t.sy) / 2 - (dx / len) * bow;

        ctx.beginPath();
        ctx.moveTo(l.s.sx, l.s.sy);
        ctx.quadraticCurveTo(cx, cy, l.t.sx, l.t.sy);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // nodes — painter's algorithm: farthest first
      const order = [...nodes].sort((a, b) => b.depth - a.depth);
      for (const n of order) {
        const dim = foc && n.cluster !== foc && n.type !== "core";
        const fog = fogOf(n.depth);
        const body = mix(n.rgb, FOG_RGB, fog * 0.8);
        // each node breathes on its own phase/rate — nothing throbs in unison
        const pulse = 1 + Math.sin(t * n.spd + n.phase) * (n.type === "leaf" ? 0.03 : 0.07);
        const rad = Math.max(0.5, n.r * n.ss * pulse * (hover === n ? 1.4 : 1));
        // light comes from each ball's own angle, so highlights scatter
        const lx = Math.cos(n.lean) * 0.34, ly = Math.sin(n.lean) * 0.34;
        ctx.globalAlpha = dim ? 0.1 : 1;

        // tight bloom — only the near, larger nodes glow at all
        if (!dim && fog < 0.55) {
          const g = ctx.createRadialGradient(n.sx, n.sy, rad * 0.6, n.sx, n.sy, rad * 2.4);
          g.addColorStop(0, rgbaStr(n.rgb, 0.27)); g.addColorStop(1, rgbaStr(n.rgb, 0));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(n.sx, n.sy, rad * 2.4, 0, 7); ctx.fill();
        }

        // sphere: lit from its own angle, shaded to the fogged body color,
        // very slightly squashed so no two balls are the same perfect circle
        const sg = ctx.createRadialGradient(
          n.sx - rad * lx, n.sy - rad * ly, rad * 0.1,
          n.sx, n.sy, rad,
        );
        sg.addColorStop(0, rgbStr(mix(WHITE_RGB, body, 0.45)));
        sg.addColorStop(0.55, rgbStr(body));
        sg.addColorStop(1, rgbStr(mix(body, FOG_RGB, 0.45)));
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.ellipse(n.sx, n.sy, rad, rad * n.squash, n.lean, 0, 7);
        ctx.fill();

        // hard specular — this is what reads as "glossy 3D ball"
        if (rad > 2.2) {
          ctx.globalAlpha = (dim ? 0.1 : 1) * (1 - fog * 0.7) * 0.75;
          ctx.fillStyle = "#ffffff";
          ctx.beginPath(); ctx.arc(n.sx - rad * lx * 0.95, n.sy - rad * ly * 0.95, rad * 0.24, 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;

        // labels: hubs + core only (leaves label only while their cluster is focused)
        const labelA = (1 - fog * 0.85) * (dim ? 0.15 : 1);
        if (n.type === "core") {
          ctx.globalAlpha = labelA;
          ctx.fillStyle = "#e8f0fb";
          ctx.font = `600 ${11 * Math.max(0.85, n.ss)}px ui-sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "top";
          ctx.fillText("CB EDGE", n.sx, n.sy + rad + 4);
        } else if (n.type === "hub") {
          ctx.globalAlpha = labelA;
          ctx.fillStyle = "#aebdd2";
          ctx.font = `500 ${10 * Math.max(0.8, n.ss)}px ui-sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "top";
          ctx.fillText(n.id, n.sx, n.sy + rad + 4);
        } else if (n.type === "leaf" && foc === n.cluster) {
          ctx.globalAlpha = labelA * 0.9;
          ctx.fillStyle = "#8b9cb3";
          ctx.font = `400 ${8.5 * Math.max(0.8, n.ss)}px ui-sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "top";
          ctx.fillText(n.id, n.sx, n.sy + rad + 3);
        }
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("wheel", onWheel);
    };
  }, [router]);

  const total = CBEDGE_CLUSTERS.reduce((s, c) => s + c.pages.length, 0);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        borderRadius: 18,
        overflow: "hidden",
        border: `1px solid ${OWNER_THEME.border}`,
        background:
          "radial-gradient(circle at 50% 45%, #080b12 0%, #04060a 55%, #000000 100%)",
      }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "grab" }} />

      {/* legend / cluster filter */}
      <div style={{ position: "absolute", top: 14, left: 14, display: "flex", flexWrap: "wrap", gap: 8, maxWidth: "70%", zIndex: 5 }}>
        {CBEDGE_CLUSTERS.map((c) => (
          <button
            key={c.id}
            onMouseEnter={() => setFocus(c.id)}
            onMouseLeave={() => setFocus(zoomedRef.current)}
            style={{
              display: "flex", alignItems: "center", gap: 6, fontSize: 12,
              color: "#c7d4e8", background: "rgba(255,255,255,.04)",
              border: "1px solid rgba(255,255,255,.07)", padding: "3px 8px",
              borderRadius: 20, cursor: "pointer",
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
            {c.name} <span style={{ opacity: 0.5 }}>{c.pages.length}</span>
          </button>
        ))}
      </div>

      <div style={{ position: "absolute", top: 14, right: 16, textAlign: "right", zIndex: 5, pointerEvents: "none" }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".5px", color: "#e7f0ff" }}>CB&nbsp;EDGE&nbsp;·&nbsp;BRAIN&nbsp;3D</div>
        <div style={{ fontSize: 12, color: "#7f93b0", marginTop: 2 }}>{total} routes · drag to orbit · wheel to zoom · click to open</div>
      </div>

      <div
        ref={tipRef}
        style={{
          position: "absolute", pointerEvents: "none", zIndex: 6,
          background: "rgba(10,16,26,.92)", border: "1px solid rgba(90,170,255,.35)",
          color: "#dbe7ff", fontSize: 12, padding: "6px 9px", borderRadius: 8,
          opacity: 0, transform: "translate(-50%,-140%)", whiteSpace: "nowrap",
          boxShadow: "0 4px 18px rgba(0,0,0,.5)",
        }}
      />
    </div>
  );
}
