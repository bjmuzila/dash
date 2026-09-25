/**
 * OwnerBrainGraph — the "second brain" map of every live CB Edge source file.
 *
 * Every file in cbedge-v3/src, server-v2 and owner-vite/src is a node; every
 * import/require between them is an edge; folders are gold hub nodes that
 * their files hang off, so each folder reads as its own star-cluster. Client
 * files that call /api/ or open the socket get a bridge edge to the server.
 *
 * Data is a committed snapshot (lib/brainMap.json) — the owners image is built
 * with context ./owner-vite and can't see the other trees. Refresh it with:
 *
 *   node owner-vite/scripts/gen-brain-map.mjs
 *
 *   • Hover            → highlights the file and everything it touches
 *   • Click            → pins it + opens the detail panel (imports / used by)
 *   • Drag background  → pan        • Wheel → zoom at cursor
 *   • Drag a node      → move it, the layout re-settles around it
 *   • Search           → jump to any file
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { OWNER_THEME, LIGHT_BLUE, TYPE, rgba } from "../lib/theme";
import { HUB_LINKS, type HubLink } from "../lib/hubPrefs";
import CBEDGE_RAW from "../lib/brainMap.json";
import VOLTICK_RAW from "../lib/voltickMap.json";

// ── data ─────────────────────────────────────────────────────────────────────
type BrainMap = {
  name?: string;
  generated: string;
  apps: { id: string; label: string; dir: string }[];
  nodes: [string, number, number][];
  links: [number, number, number][];
};

type Kind = "root" | "dir" | "file";
type GNode = {
  i: number;
  id: string;          // repo-relative path (dirs end without slash)
  name: string;        // basename
  kind: Kind;
  app: number;
  area: string;        // colour bucket
  lines: number;
  r: number;
  rgb: RGB;
  x: number; y: number; vx: number; vy: number;
  fixed: boolean;
  deg: number;
  imports: number[];   // file → files it imports
  usedBy: number[];    // files that import it
};
type GLink = { s: GNode; t: GNode; kind: 0 | 1 | 2; rest: number; k: number }; // 0 import · 1 bridge · 2 folder

type RGB = [number, number, number];
const hex2rgb = (h: string): RGB => {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

const HUB_GOLD = hex2rgb(OWNER_THEME.gold);
const ROOT_RGB = hex2rgb(OWNER_THEME.text);
const BG_RGB = hex2rgb(OWNER_THEME.bg);
const IMPORT_RGB = hex2rgb("#3FAF8F");   // the green web in the reference shot
const BRIDGE_RGB = hex2rgb(LIGHT_BLUE);

/**
 * One config per brain. Areas are the colour clouds; colours are explicit on
 * purpose (like the v2 cluster list) — the owner theme only has ~6 accents.
 * Area order here is also the legend order.
 */
type BrainCfg = {
  title: string;
  map: BrainMap;
  areas: { id: string; label: string; color: string }[];
  areaOf: (appId: string, sub: string) => string;
  shortPath: RegExp;   // prefix trimmed in lists
};

const CBEDGE: BrainCfg = {
  title: "CB Edge · Second Brain",
  map: CBEDGE_RAW as unknown as BrainMap,
  shortPath: /^(cbedge-v3\/src|owner-vite\/src|server-v2)\//,
  areas: [
    { id: "v3/board", label: "v3 · Board cards", color: "#5AA9FF" },
    { id: "v3/pages", label: "v3 · Pages", color: "#4C7DF0" },
    { id: "v3/data", label: "v3 · Data", color: "#2DD4BF" },
    { id: "v3/design", label: "v3 · Design", color: "#C084FC" },
    { id: "v3/shell", label: "v3 · Shell", color: "#FF6FAE" },
    { id: "v3/mobile", label: "v3 · Mobile", color: "#F472B6" },
    { id: "v3/core", label: "v3 · Boot", color: "#93C5FD" },
    { id: "server/core", label: "Server · Core", color: "#FB923C" },
    { id: "server/lib", label: "Server · _lib", color: "#F97316" },
    { id: "server/computation", label: "Server · Compute", color: "#FACC15" },
    { id: "server/state", label: "Server · State", color: "#A3E635" },
    { id: "server/scripts", label: "Server · Scripts", color: "#94A3B8" },
    { id: "server/config", label: "Server · Config", color: "#CBD5E1" },
    { id: "owner/pages", label: "Owner · Pages", color: "#34D399" },
    { id: "owner/components", label: "Owner · Components", color: "#10B981" },
    { id: "owner/lib", label: "Owner · Lib", color: "#6EE7B7" },
    { id: "owner/other", label: "Owner · Other", color: "#86EFAC" },
  ],
  areaOf(appId, sub) {
    const top = sub.split("/")[0];
    const isFile = !sub.includes("/");
    if (appId === "v3") {
      if (["board", "pages", "data", "design", "shell", "mobile"].includes(top)) return `v3/${top}`;
      return "v3/core";
    }
    if (appId === "server") {
      if (isFile) return sub.startsWith("_lib") ? "server/lib" : "server/core";
      if (["computation", "state", "scripts", "config"].includes(top)) return `server/${top}`;
      return "server/core";
    }
    if (["pages", "components", "lib"].includes(top) && !isFile) return `owner/${top}`;
    return "owner/other";
  },
};

// Voltick's server is ~250 flat files in one folder, so its areas come from
// the file-name families (agent*, flow*, *cal/*rec …) rather than folders.
const VT_SERVER_GROUPS: [string, RegExp][] = [
  ["server/engine", /^(server|engine|engine-worker|compute-pool|thetadata|tradier|simulate|history|chainbank|ohlc|prevcloses|ticks|streamprices|datafetch|db|tallysql|hotset|watchdog|wsguard|boot-runway|bootmark|barrier|restartlog|backup|s3put|marketdays|nyfmt|geometry|operator|actuator)\.js$/],
  ["server/accounts", /^(billing|auth|authlimit|affiliates|trial-.*|winback|member|tiers|churn|email|emailevents|passhash|apikeys|account-delete|native-auth|seedaccount|make-subscriber|usage|fairuse|mcpaccess|feedaccess|hashworker|journey|support)\.js$/],
  ["server/agents", /^(agent|assistant|siteagent|liveagent|mcpserver|idealab|idearec)/],
  ["server/flow", /^(flow|dark|streamflow|repeat|unusual|oi|spreads|structures|struct|trades|tradeshape|brokercash|snaptrade|brokermap|brokertime)/],
  ["server/records", /(cal|rec|record|bank)\.js$|^(calibrate|conviction|edgeminer|baserate|bandstreak|conditional-edge|ledger|recordbank|reports|autopsy|dataaudit|recorder-census)/],
  ["server/alerts", /^(discord|social|push|nativepush|alertbus|news|.*alerts|scorealerts|structalert|heatmap-|reel|flyer|shots|embed|badge|blog|levels-letter|feed|jpeg|guidepdf|seo-)/],
];
const VOLTICK: BrainCfg = {
  title: "Voltick · Second Brain",
  map: VOLTICK_RAW as unknown as BrainMap,
  shortPath: /^(web\/src|server|theta-proxy|theta-stream)\//,
  areas: [
    { id: "web/components", label: "Web · Components", color: "#5AA9FF" },
    { id: "web/lib", label: "Web · Helpers", color: "#93C5FD" },
    { id: "web/pages", label: "Web · Pages", color: "#4C7DF0" },
    { id: "web/native", label: "Web · Native stubs", color: "#C084FC" },
    { id: "server/engine", label: "Server · Engine & data", color: "#FACC15" },
    { id: "server/flow", label: "Server · Flow & OI", color: "#FB923C" },
    { id: "server/records", label: "Server · Track record", color: "#F97316" },
    { id: "server/alerts", label: "Server · Alerts & social", color: "#FF6FAE" },
    { id: "server/accounts", label: "Server · Accounts & billing", color: "#34D399" },
    { id: "server/agents", label: "Server · Agents & bot", color: "#2DD4BF" },
    { id: "server/features", label: "Server · Features", color: "#FDBA74" },
    { id: "server/scripts", label: "Server · Scripts", color: "#94A3B8" },
    { id: "root/modules", label: "Root modules", color: "#A3E635" },
    { id: "theta", label: "Theta proxy + stream", color: "#CBD5E1" },
  ],
  areaOf(appId, sub) {
    if (appId === "web") {
      if (sub.startsWith("pages/")) return "web/pages";
      if (sub.startsWith("native-stubs/")) return "web/native";
      return /\.jsx$/.test(sub) ? "web/components" : "web/lib";
    }
    if (appId === "server") {
      if (sub.includes("/")) return "server/scripts";
      for (const [id, re] of VT_SERVER_GROUPS) if (re.test(sub)) return id;
      return "server/features";
    }
    if (appId === "engine") return "root/modules";
    return "theta";
  },
};

export const BRAINS = { cbedge: CBEDGE, voltick: VOLTICK } as const;
export type BrainId = keyof typeof BRAINS;

/** Owner page files that map to a live route → open it from the panel. */
const LINK_BY_FILE = new Map<string, HubLink>(
  HUB_LINKS.map((l) => [`owner-vite/src/pages/${l.key}.tsx`, l]),
);

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

function buildGraph(cfg: BrainCfg) {
  const BRAIN = cfg.map;
  const COLOR = new Map(cfg.areas.map((a) => [a.id, a.color]));
  const areaOf = cfg.areaOf;
  const nodes: GNode[] = [];
  const links: GLink[] = [];
  const byId = new Map<string, GNode>();
  const mk = (id: string, name: string, kind: Kind, app: number, area: string, lines = 0): GNode => {
    const n: GNode = {
      i: nodes.length, id, name, kind, app, area, lines, r: 3,
      rgb: kind === "root" ? ROOT_RGB : kind === "dir" ? HUB_GOLD : hex2rgb(COLOR.get(area) ?? "#8B9CB3"),
      x: 0, y: 0, vx: 0, vy: 0, fixed: false, deg: 0, imports: [], usedBy: [],
    };
    nodes.push(n); byId.set(id, n);
    return n;
  };

  // app roots — spread on a wide triangle so the three trees start apart
  const roots = BRAIN.apps.map((a, i) => {
    const n = mk("app:" + (a.dir || a.id), a.label, "root", i, "root");
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / BRAIN.apps.length;
    n.x = Math.cos(ang) * 700; n.y = Math.sin(ang) * 700;
    return n;
  });

  const ensureDir = (appIdx: number, dirPath: string): GNode => {
    const hit = byId.get(dirPath);
    if (hit) return hit;
    const app = BRAIN.apps[appIdx];
    const sub = dirPath.slice(app.dir.length + 1);
    const parentPath = dirPath.slice(0, dirPath.lastIndexOf("/"));
    const parent = parentPath.length <= app.dir.length ? roots[appIdx] : ensureDir(appIdx, parentPath);
    const n = mk(dirPath, sub.split("/").pop() || sub, "dir", appIdx, areaOf(app.id, sub + "/x"));
    const a = hash(dirPath) * Math.PI * 2;
    n.x = parent.x + Math.cos(a) * 260; n.y = parent.y + Math.sin(a) * 260;
    links.push({ s: parent, t: n, kind: 2, rest: 240, k: 0.02 });
    return n;
  };

  // Flat app roots (Voltick's server, server-v2) would be one giant ball, so
  // when a root holds many loose files they hang off a gold hub per area.
  const looseCount = new Map<number, number>();
  for (const [path, appIdx] of BRAIN.nodes) {
    const d = BRAIN.apps[appIdx].dir;
    const rest = d ? path.slice(d.length + 1) : path;
    if (!rest.includes("/")) looseCount.set(appIdx, (looseCount.get(appIdx) ?? 0) + 1);
  }
  const LABEL = new Map(cfg.areas.map((a) => [a.id, a.label]));
  const areaHub = (appIdx: number, area: string): GNode => {
    const id = `area:${appIdx}:${area}`;
    const hit = byId.get(id);
    if (hit) return hit;
    const root = roots[appIdx];
    const label = (LABEL.get(area) ?? area).split("·").pop()!.trim();
    const n = mk(id, label, "dir", appIdx, area);
    const a = hash(id) * Math.PI * 2;
    n.x = root.x + Math.cos(a) * 260; n.y = root.y + Math.sin(a) * 260;
    links.push({ s: root, t: n, kind: 2, rest: 240, k: 0.02 });
    return n;
  };

  const fileNodes: GNode[] = [];
  for (const [path, appIdx, lines] of BRAIN.nodes) {
    const app = BRAIN.apps[appIdx];
    const sub = app.dir ? path.slice(app.dir.length + 1) : path;
    const slash = path.lastIndexOf("/");
    const dirPath = slash < 0 ? "" : path.slice(0, slash);
    const area = areaOf(app.id, sub);
    const loose = dirPath.length <= app.dir.length;
    const parent = !loose ? ensureDir(appIdx, dirPath) : (looseCount.get(appIdx) ?? 0) > 40 ? areaHub(appIdx, area) : roots[appIdx];
    const n = mk(path, path.slice(slash + 1), "file", appIdx, area, lines);
    const a = hash(path) * Math.PI * 2;
    const d = 40 + hash(path + "|d") * 120;
    n.x = parent.x + Math.cos(a) * d; n.y = parent.y + Math.sin(a) * d;
    links.push({ s: parent, t: n, kind: 2, rest: 30 + hash(path + "|r") * 45, k: 0.09 });
    fileNodes.push(n);
  }

  for (const [si, ti, kind] of BRAIN.links) {
    const s = fileNodes[si], t = fileNodes[ti];
    if (!s || !t) continue;
    links.push({ s, t, kind: kind === 1 ? 1 : 0, rest: 260, k: kind === 1 ? 0.0002 : 0.0007 });
    s.imports.push(t.i); t.usedBy.push(s.i);
  }

  for (const l of links) { l.s.deg++; l.t.deg++; }
  for (const n of nodes) {
    if (n.kind === "root") n.r = 16;
    else if (n.kind === "dir") n.r = 7 + Math.min(9, Math.sqrt(n.deg) * 1.5);
    else n.r = 3.6 + Math.min(8, Math.sqrt(n.lines) / 8 + Math.sqrt(n.usedBy.length) * 1.0);
  }
  return { nodes, links };
}

// ── component ────────────────────────────────────────────────────────────────
export default function OwnerBrainGraph({
  brain = "cbedge",
  onOpen,
  pinned,
}: {
  brain?: BrainId;
  onOpen: (link: HubLink) => void;
  pinned?: Set<string>;
}) {
  const cfg = BRAINS[brain];
  const BRAIN = cfg.map;
  const AREA = useMemo(() => new Map(cfg.areas.map((a) => [a.id, a])), [cfg]);
  const graph = useMemo(() => buildGraph(cfg), [cfg]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  const [selected, setSelected] = useState<GNode | null>(null);
  const [query, setQuery] = useState("");
  const [hiddenAreas, setHiddenAreas] = useState<Set<string>>(() => new Set());
  const [showFolders, setShowFolders] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

  // bridge React state → the imperative render loop
  const api = useRef<{ fit: () => void; focus: (n: GNode) => void; redraw: () => void } | null>(null);
  const selRef = useRef<GNode | null>(null); selRef.current = selected;
  const hiddenRef = useRef(hiddenAreas); hiddenRef.current = hiddenAreas;
  const foldersRef = useRef(showFolders); foldersRef.current = showFolders;
  const labelsRef = useRef(showLabels); labelsRef.current = showLabels;
  const pinnedRef = useRef(pinned); pinnedRef.current = pinned;
  const setSelRef = useRef(setSelected); setSelRef.current = setSelected;

  useEffect(() => { api.current?.redraw(); }, [selected, hiddenAreas, showFolders, showLabels, pinned]);

  useEffect(() => {
    const { nodes, links } = graph;
    const wrap = wrapRef.current!;
    const cv = canvasRef.current!;
    const tip = tipRef.current!;
    const ctx = cv.getContext("2d")!;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, raf = 0;
    let alpha = 1;           // simulation heat — cools to 0 and the loop idles
    let dirty = true;
    const cam = { x: 0, y: 0, z: 0.35 };

    const visible = (n: GNode) => n.kind === "root" || !hiddenRef.current.has(n.area);
    const toScreen = (x: number, y: number) => [W / 2 + (x - cam.x) * cam.z, H / 2 + (y - cam.y) * cam.z] as const;
    const toWorld = (sx: number, sy: number) => [(sx - W / 2) / cam.z + cam.x, (sy - H / 2) / cam.z + cam.y] as const;

    function resize() {
      W = wrap.clientWidth; H = wrap.clientHeight;
      cv.width = Math.max(1, W * DPR); cv.height = Math.max(1, H * DPR);
      dirty = true;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── physics: grid-bucketed repulsion + springs ──────────────────────────
    const CELL = 140;
    function step() {
      const grid = new Map<number, GNode[]>();
      for (const n of nodes) {
        const k = ((Math.floor(n.x / CELL) + 5000) * 10000) + (Math.floor(n.y / CELL) + 5000);
        const b = grid.get(k); if (b) b.push(n); else grid.set(k, [n]);
      }
      for (const n of nodes) {
        const gx = Math.floor(n.x / CELL), gy = Math.floor(n.y / CELL);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const b = grid.get(((gx + dx + 5000) * 10000) + (gy + dy + 5000));
          if (!b) continue;
          for (const m of b) {
            if (m.i <= n.i) continue;
            let ddx = n.x - m.x, ddy = n.y - m.y;
            let d2 = ddx * ddx + ddy * ddy;
            if (d2 < 0.01) { ddx = hash(n.id) - 0.5; ddy = hash(m.id) - 0.5; d2 = 0.5; }
            if (d2 > CELL * CELL) continue;
            const minD = n.r + m.r + 6;
            const f = (1800 / d2 + (d2 < minD * minD ? 0.6 : 0)) * alpha;
            const d = Math.sqrt(d2);
            const fx = (ddx / d) * f, fy = (ddy / d) * f;
            n.vx += fx; n.vy += fy; m.vx -= fx; m.vy -= fy;
          }
        }
      }
      // long-range: roots and dir hubs push each other apart so clusters spread
      const hubs = nodes.filter((n) => n.kind !== "file");
      for (let i = 0; i < hubs.length; i++) for (let j = i + 1; j < hubs.length; j++) {
        const a = hubs[i], b = hubs[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 1;
        const f = (a.kind === "root" || b.kind === "root" ? 160000 : 60000) / d2 * alpha;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      for (const l of links) {
        const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - l.rest) * l.k * alpha;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        l.s.vx += fx; l.s.vy += fy; l.t.vx -= fx; l.t.vy -= fy;
      }
      for (const n of nodes) {
        n.vx -= n.x * 0.0004 * alpha; n.vy -= n.y * 0.0004 * alpha;   // weak gravity
        if (n.fixed) { n.vx = n.vy = 0; continue; }
        n.vx *= 0.82; n.vy *= 0.82;
        const sp = Math.hypot(n.vx, n.vy);
        if (sp > 30) { n.vx *= 30 / sp; n.vy *= 30 / sp; }
        n.x += n.vx; n.y += n.vy;
      }
      alpha *= 0.992;
      if (alpha < 0.02) alpha = 0;
    }
    // pre-settle a little so the first paint isn't a pile at the origin
    for (let i = 0; i < 120; i++) step();

    function fit() {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of nodes) {
        if (!visible(n)) continue;
        x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y);
      }
      if (!isFinite(x0)) return;
      cam.x = (x0 + x1) / 2; cam.y = (y0 + y1) / 2;
      cam.z = Math.max(0.05, Math.min(2, Math.min((W - 80) / (x1 - x0 + 1), (H - 120) / (y1 - y0 + 1))));
      dirty = true;
    }
    let camAnim: { x: number; y: number; z: number } | null = null;
    function focus(n: GNode) {
      camAnim = { x: n.x, y: n.y, z: Math.max(cam.z, 1.4) };
      setSelRef.current(n);
    }
    fit();

    // ── interaction ────────────────────────────────────────────────────────
    let hover: GNode | null = null;
    let drag: GNode | null = null;
    let panning = false;
    let downX = 0, downY = 0, lastX = 0, lastY = 0, moved = false;
    let downNode: GNode | null = null;

    const rel = (e: PointerEvent | WheelEvent) => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    function pick(sx: number, sy: number): GNode | null {
      const [wx, wy] = toWorld(sx, sy);
      let best: GNode | null = null, bd = Infinity;
      for (const n of nodes) {
        if (!visible(n) || (n.kind === "dir" && !foldersRef.current)) continue;
        const d = Math.hypot(n.x - wx, n.y - wy);
        const hit = n.r + 5 / cam.z;
        if (d < hit && d < bd) { bd = d; best = n; }
      }
      return best;
    }
    function tipText(n: GNode) {
      if (n.kind === "root") return `${n.name} · ${nodes.filter((m) => m.app === n.app && m.kind === "file").length} files`;
      if (n.kind === "dir") return `${n.id}/`;
      return `${n.id} · ${n.lines} lines · imports ${n.imports.length} · used by ${n.usedBy.length}`;
    }
    function onMove(e: PointerEvent) {
      const [sx, sy] = rel(e);
      if (Math.hypot(sx - downX, sy - downY) > 4) moved = true;
      if (drag) {
        const [wx, wy] = toWorld(sx, sy);
        drag.x = wx; drag.y = wy; drag.fixed = true;
        alpha = Math.max(alpha, 0.25);
      } else if (panning) {
        cam.x -= (sx - lastX) / cam.z; cam.y -= (sy - lastY) / cam.z;
        camAnim = null;
      }
      lastX = sx; lastY = sy;
      const h = drag || panning ? null : pick(sx, sy);
      if (h !== hover) { hover = h; dirty = true; }
      if (hover) {
        tip.style.opacity = "1";
        tip.style.left = sx + "px"; tip.style.top = sy + "px";
        tip.textContent = tipText(hover);
        cv.style.cursor = "pointer";
      } else {
        tip.style.opacity = "0";
        cv.style.cursor = panning ? "grabbing" : "grab";
      }
      if (drag || panning) dirty = true;
    }
    function onDown(e: PointerEvent) {
      const [sx, sy] = rel(e);
      downX = lastX = sx; downY = lastY = sy; moved = false;
      const n = pick(sx, sy);
      downNode = n;
      if (n) drag = n; else panning = true;
      cv.setPointerCapture(e.pointerId);
    }
    function onUp() {
      if (drag) drag.fixed = false;
      if (!moved) {
        if (downNode) {
          setSelRef.current(selRef.current === downNode ? null : downNode);
        } else {
          setSelRef.current(null);
        }
      }
      drag = null; panning = false; downNode = null;
      cv.style.cursor = "grab";
      dirty = true;
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const [sx, sy] = rel(e);
      const [wx, wy] = toWorld(sx, sy);
      const k = Math.exp(-e.deltaY * 0.0015);
      cam.z = Math.max(0.05, Math.min(6, cam.z * k));
      // keep the world point under the cursor fixed
      cam.x = wx - (sx - W / 2) / cam.z;
      cam.y = wy - (sy - H / 2) / cam.z;
      camAnim = null;
      dirty = true;
    }
    function onLeave() { tip.style.opacity = "0"; if (hover) { hover = null; dirty = true; } }
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("pointerleave", onLeave);

    // ── render ─────────────────────────────────────────────────────────────
    const FONT = "'Inter', ui-sans-serif, system-ui, sans-serif";
    function draw() {
      raf = requestAnimationFrame(draw);
      if (alpha > 0) { step(); dirty = true; }
      if (camAnim) {
        cam.x += (camAnim.x - cam.x) * 0.15; cam.y += (camAnim.y - cam.y) * 0.15; cam.z += (camAnim.z - cam.z) * 0.15;
        if (Math.abs(camAnim.z - cam.z) < 0.002 && Math.hypot(camAnim.x - cam.x, camAnim.y - cam.y) < 0.5) camAnim = null;
        dirty = true;
      }
      if (!dirty || document.hidden) return;
      dirty = false;

      const sel = selRef.current;
      const folders = foldersRef.current;
      const pins = pinnedRef.current;
      const focusNode = hover || sel;
      // neighbourhood of the focused node (imports, used-by, its folder)
      let hot: Set<number> | null = null;
      if (focusNode) {
        hot = new Set([focusNode.i]);
        for (const l of links) {
          if (l.kind === 2 && !(folders && focusNode.kind !== "file")) { if (l.t === focusNode) hot.add(l.s.i); continue; }
          if (l.s === focusNode) hot.add(l.t.i); else if (l.t === focusNode) hot.add(l.s.i);
        }
      }

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const z = cam.z;
      const lw = Math.max(0.35, Math.min(1.2, z * 0.9));

      // edges, batched by style
      const batch = (kind: 0 | 1 | 2, col: string, width: number, onlyHot: boolean | null) => {
        ctx.beginPath();
        for (const l of links) {
          if (l.kind !== kind) continue;
          if (!visible(l.s) || !visible(l.t)) continue;
          if (kind === 2 && !folders) continue;
          const isHot = !!hot && hot.has(l.s.i) && hot.has(l.t.i) && (l.s === focusNode || l.t === focusNode);
          if (onlyHot === true && !isHot) continue;
          if (onlyHot === false && isHot) continue;
          const [x1, y1] = toScreen(l.s.x, l.s.y);
          const [x2, y2] = toScreen(l.t.x, l.t.y);
          if ((x1 < -50 && x2 < -50) || (x1 > W + 50 && x2 > W + 50) || (y1 < -50 && y2 < -50) || (y1 > H + 50 && y2 > H + 50)) continue;
          ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        }
        ctx.strokeStyle = col; ctx.lineWidth = width; ctx.stroke();
      };
      const dimK = hot ? 0.35 : 1;
      batch(2, css(HUB_GOLD, 0.10 * dimK), lw * 0.8, hot ? false : null);
      batch(0, css(IMPORT_RGB, 0.22 * dimK), lw, hot ? false : null);
      ctx.setLineDash([4, 4]);
      batch(1, css(BRIDGE_RGB, 0.12 * dimK), lw, hot ? false : null);
      ctx.setLineDash([]);
      if (hot) {
        batch(2, css(HUB_GOLD, 0.55), lw * 1.3, true);
        batch(0, css(mix(IMPORT_RGB, ROOT_RGB, 0.35), 0.9), lw * 1.6, true);
        batch(1, css(BRIDGE_RGB, 0.8), lw * 1.4, true);
      }

      // nodes — files first, then hubs on top
      const order = nodes.filter((n) => visible(n) && (folders || n.kind !== "dir"));
      order.sort((a, b) => (a.kind === "file" ? 0 : a.kind === "dir" ? 1 : 2) - (b.kind === "file" ? 0 : b.kind === "dir" ? 1 : 2));
      for (const n of order) {
        const [sx, sy] = toScreen(n.x, n.y);
        const rad = Math.max(1.2, n.r * z * (hover === n ? 1.35 : 1));
        if (sx < -rad - 20 || sx > W + rad + 20 || sy < -rad - 20 || sy > H + rad + 20) continue;
        const dim = hot && !hot.has(n.i);
        ctx.globalAlpha = dim ? 0.16 : 1;
        if (rad > 2.5) {
          const g = ctx.createRadialGradient(sx - rad * 0.35, sy - rad * 0.4, rad * 0.1, sx, sy, rad);
          g.addColorStop(0, css(mix(ROOT_RGB, n.rgb, 0.35)));
          g.addColorStop(0.6, css(n.rgb));
          g.addColorStop(1, css(mix(n.rgb, BG_RGB, 0.45)));
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle = css(n.rgb);
        }
        ctx.beginPath(); ctx.arc(sx, sy, rad, 0, Math.PI * 2); ctx.fill();
        if (n === sel) {
          ctx.strokeStyle = OWNER_THEME.text; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(sx, sy, rad + 3, 0, Math.PI * 2); ctx.stroke();
        }
        const link = n.kind === "file" ? LINK_BY_FILE.get(n.id) : undefined;
        if (link && pins?.has(link.href)) {
          ctx.strokeStyle = OWNER_THEME.gold; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(sx, sy, rad + 2, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // labels
      if (labelsRef.current) {
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        for (const n of order) {
          const isHot = hot?.has(n.i);
          const show =
            n.kind === "root" ||
            (n.kind === "dir" && z > 0.28) ||
            (n.kind === "file" && (z > 1.5 || (isHot && z > 0.5) || n === focusNode || (n.usedBy.length >= 12 && z > 0.45)));
          if (!show) continue;
          if (hot && !isHot && n.kind !== "root") continue;
          const [sx, sy] = toScreen(n.x, n.y);
          if (sx < -80 || sx > W + 80 || sy < -20 || sy > H + 20) continue;
          const rad = n.r * z;
          const size = n.kind === "root" ? 13 : n.kind === "dir" ? 11 : 10;
          ctx.font = `${n.kind === "file" ? 500 : 700} ${size}px ${FONT}`;
          ctx.fillStyle = n.kind === "root" ? OWNER_THEME.text : n.kind === "dir" ? css(mix(HUB_GOLD, ROOT_RGB, 0.45), 0.9) : css(ROOT_RGB, 0.75);
          ctx.fillText(n.kind === "root" ? n.name.toUpperCase() : n.name, sx, sy + rad + 3);
        }
      }
    }
    draw();

    api.current = {
      fit: () => { camAnim = null; fit(); },
      focus,
      redraw: () => { dirty = true; },
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointercancel", onUp);
      cv.removeEventListener("wheel", onWheel);
      cv.removeEventListener("pointerleave", onLeave);
      api.current = null;
    };
  }, [graph]);

  // ── search ─────────────────────────────────────────────────────────────────
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return graph.nodes
      .filter((n) => n.kind === "file" && n.id.toLowerCase().includes(q))
      .sort((a, b) => a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q) || b.usedBy.length - a.usedBy.length)
      .slice(0, 8);
  }, [query, graph]);

  const areas = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of graph.nodes) if (n.kind === "file") c.set(n.area, (c.get(n.area) ?? 0) + 1);
    return cfg.areas.filter((a) => c.has(a.id)).map((a) => ({ id: a.id, n: c.get(a.id)! }));
  }, [graph, cfg]);

  const fileCount = BRAIN.nodes.length;
  const importCount = BRAIN.links.filter((l) => l[2] === 0).length;
  const sel = selected;
  const selLink = sel ? LINK_BY_FILE.get(sel.id) : undefined;

  const chip = (on: boolean, color: string): CSSProperties => ({
    display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
    fontSize: TYPE.micro, fontWeight: 700, letterSpacing: "0.04em",
    color: OWNER_THEME.text, opacity: on ? 1 : 0.38,
    background: rgba(color, on ? 0.1 : 0.03), border: `1px solid ${rgba(color, on ? 0.35 : 0.12)}`,
    padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap",
  });
  const toolBtn = (active: boolean): CSSProperties => ({
    display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
    fontSize: TYPE.label, fontWeight: 700, letterSpacing: "0.04em",
    color: active ? OWNER_THEME.bg : OWNER_THEME.text,
    background: active ? LIGHT_BLUE : rgba(OWNER_THEME.panel, 0.9),
    border: `1px solid ${active ? LIGHT_BLUE : OWNER_THEME.borderStrong}`,
    padding: "7px 14px", borderRadius: 10,
  });
  const rowBtn: CSSProperties = {
    display: "block", width: "100%", textAlign: "left", background: "none", border: "none",
    padding: "3px 0", cursor: "pointer", color: OWNER_THEME.text, opacity: 0.85,
    fontSize: TYPE.micro, fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap",
    overflow: "hidden", textOverflow: "ellipsis",
  };

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative", flex: 1, minHeight: 420, borderRadius: 18, overflow: "hidden",
        border: `1px solid ${OWNER_THEME.border}`, background: OWNER_THEME.bg, touchAction: "none",
      }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "grab" }} />

      {/* legend / area filter */}
      <div style={{ position: "absolute", top: 12, left: 12, display: "flex", flexWrap: "wrap", gap: 6, maxWidth: "min(620px, 62%)", zIndex: 5 }}>
        {areas.map((a) => {
          const on = !hiddenAreas.has(a.id);
          return (
            <button
              key={a.id}
              style={chip(on, AREA.get(a.id)!.color)}
              onClick={() => setHiddenAreas((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })}
              title={on ? "Hide" : "Show"}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: AREA.get(a.id)!.color }} />
              {AREA.get(a.id)!.label}
              <span style={{ opacity: 0.5 }}>{a.n}</span>
            </button>
          );
        })}
      </div>

      {/* search + title */}
      <div style={{ position: "absolute", top: 12, right: 12, width: 280, zIndex: 6, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ textAlign: "right", pointerEvents: "none" }}>
          <div style={{ fontSize: TYPE.label, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE }}>
            {cfg.title}
          </div>
          <div style={{ fontSize: TYPE.micro, color: OWNER_THEME.text, opacity: 0.5, marginTop: 2 }}>
            {fileCount} files · {importCount} imports · snapshot {BRAIN.generated}
          </div>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) { api.current?.focus(matches[0]); setQuery(""); }
            if (e.key === "Escape") setQuery("");
          }}
          placeholder="Find a file…"
          spellCheck={false}
          style={{
            background: rgba(OWNER_THEME.panel, 0.92), border: `1px solid ${OWNER_THEME.borderStrong}`,
            borderRadius: 10, padding: "8px 11px", color: OWNER_THEME.text, fontSize: TYPE.body, outline: "none",
          }}
        />
        {matches.length > 0 && (
          <div style={{ background: rgba(OWNER_THEME.panel, 0.96), border: `1px solid ${OWNER_THEME.border}`, borderRadius: 10, padding: "4px 10px" }}>
            {matches.map((m) => (
              <button key={m.i} style={rowBtn} onClick={() => { api.current?.focus(m); setQuery(""); }} title={m.id}>
                <span style={{ color: css(m.rgb) }}>●</span> {m.id.replace(cfg.shortPath, "")}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* detail panel */}
      {sel && (
        <div
          style={{
            position: "absolute", right: 12, top: matches.length ? 250 : 110, bottom: 70, width: 280, zIndex: 5,
            background: rgba(OWNER_THEME.panel, 0.94), border: `1px solid ${OWNER_THEME.border}`, borderRadius: 14,
            padding: "12px 14px", overflowY: "auto", color: OWNER_THEME.text,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: css(sel.rgb), flexShrink: 0 }} />
            <span style={{ fontSize: TYPE.body, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis" }}>{sel.name}</span>
            <button onClick={() => setSelected(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: OWNER_THEME.text, opacity: 0.5, cursor: "pointer" }} aria-label="Close">✕</button>
          </div>
          <div style={{ fontSize: TYPE.micro, opacity: 0.55, fontFamily: "ui-monospace, monospace", margin: "4px 0 10px", wordBreak: "break-all" }}>{sel.id}</div>
          {sel.kind === "file" && (
            <div style={{ fontSize: TYPE.micro, opacity: 0.75, marginBottom: 10 }}>
              {AREA.get(sel.area)?.label} · {sel.lines.toLocaleString()} lines
            </div>
          )}
          {selLink && (
            <button onClick={() => onOpen(selLink)} style={{ ...toolBtn(true), marginBottom: 12 }}>
              Open {selLink.label} <span aria-hidden>→</span>
            </button>
          )}
          {sel.kind !== "file" ? (
            <NodeList title="Contains" ids={graph.links.filter((l) => l.kind === 2 && l.s === sel).map((l) => l.t.i)} graph={graph} short={cfg.shortPath} rowBtn={rowBtn} onPick={(n) => api.current?.focus(n)} />
          ) : (
            <>
              <NodeList title="Imports" ids={sel.imports} graph={graph} short={cfg.shortPath} rowBtn={rowBtn} onPick={(n) => api.current?.focus(n)} />
              <NodeList title="Used by" ids={sel.usedBy} graph={graph} short={cfg.shortPath} rowBtn={rowBtn} onPick={(n) => api.current?.focus(n)} />
            </>
          )}
        </div>
      )}

      {/* bottom toolbar */}
      <div style={{ position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 8, zIndex: 5 }}>
        <button style={toolBtn(false)} onClick={() => api.current?.fit()}>⊙ Fit</button>
        <button style={toolBtn(showFolders)} onClick={() => setShowFolders((v) => !v)}>Folders</button>
        <button style={toolBtn(showLabels)} onClick={() => setShowLabels((v) => !v)}>Labels</button>
      </div>

      <div
        ref={tipRef}
        style={{
          position: "absolute", pointerEvents: "none", zIndex: 7,
          background: rgba(OWNER_THEME.panel, 0.95), border: `1px solid ${rgba(LIGHT_BLUE, 0.35)}`,
          color: OWNER_THEME.text, fontSize: TYPE.micro, padding: "5px 9px", borderRadius: 8,
          opacity: 0, transform: "translate(-50%, calc(-100% - 12px))", whiteSpace: "nowrap",
          boxShadow: "0 4px 18px rgba(0,0,0,.5)", fontFamily: "ui-monospace, monospace",
        }}
      />
    </div>
  );
}

function NodeList({
  title, ids, graph, rowBtn, onPick, short,
}: {
  title: string;
  ids: number[];
  graph: { nodes: GNode[] };
  short: RegExp;
  rowBtn: CSSProperties;
  onPick: (n: GNode) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: TYPE.micro, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE, marginBottom: 4 }}>
        {title} <span style={{ opacity: 0.5 }}>{ids.length}</span>
      </div>
      {ids.length === 0 && <div style={{ fontSize: TYPE.micro, opacity: 0.4 }}>—</div>}
      {ids.map((i) => {
        const n = graph.nodes[i];
        return (
          <button key={i} style={rowBtn} onClick={() => onPick(n)} title={n.id}>
            <span style={{ color: css(n.rgb) }}>●</span> {n.id.replace(short, "")}
          </button>
        );
      })}
    </div>
  );
}
