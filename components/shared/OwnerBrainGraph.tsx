"use client";

/**
 * OwnerBrainGraph — force-directed "brain" of every CB Edge route, rendered on a
 * canvas. CB EDGE is the root; 9 domain clusters hang off it; each page is a leaf.
 *
 *   • Click a leaf        → router.push(route)  (navigates)
 *   • ⌘/Ctrl-click a leaf → opens the route in a new tab
 *   • Click a hub         → zoom-focus that cluster (click hub again / core to reset)
 *   • Drag any node       → physics re-settles around it
 *   • Hover               → tooltip with the route / cluster name
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
  { id: "core", name: "GEX / Options", color: "#00E0C6", pages: ["/gex", "/gex2", "/flow", "/flow-gex-history", "/greeks", "/mult-greek", "/options-chain", "/es-candles", "/footprint", "/confidence-score"] },
  { id: "home", name: "Dashboards", color: "#5AA9FF", pages: ["/home", "/home-fast", "/new-home", "/dashboard", "/overview", "/mobile", "/traders-dashboard", "/premarket"] },
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
  r: number;
  x: number; y: number; vx: number; vy: number;
  fx: number | null; fy: number | null;
};
type LinkT = { s: NodeT; t: NodeT; strong: boolean };

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

    const nodes: NodeT[] = [];
    const links: LinkT[] = [];
    const core: NodeT = { id: "CB EDGE", type: "core", cluster: null, color: "#FFFFFF", r: 22, x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null };
    nodes.push(core);
    const hubs: Record<string, NodeT> = {};
    CBEDGE_CLUSTERS.forEach((c) => {
      const hub: NodeT = { id: c.name, type: "hub", cluster: c.id, color: c.color, r: 12, x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null };
      hubs[c.id] = hub;
      nodes.push(hub);
      links.push({ s: core, t: hub, strong: true });
      c.pages.forEach((p) => {
        const n: NodeT = { id: p, type: "leaf", cluster: c.id, color: c.color, r: 5.5, x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null };
        nodes.push(n);
        links.push({ s: hub, t: n, strong: false });
      });
    });

    // camera (CSS-pixel space, applied on top of the DPR base transform)
    const cam = { scale: 1, x: 0, y: 0 };
    const camTarget = { scale: 1, x: 0, y: 0 };

    function resize() {
      W = wrap.clientWidth; H = wrap.clientHeight;
      cv.width = W * DPR; cv.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // seed radial positions
    core.x = W / 2 || 400; core.y = H / 2 || 300;
    CBEDGE_CLUSTERS.forEach((c, i) => {
      const a = (i / CBEDGE_CLUSTERS.length) * Math.PI * 2 - Math.PI / 2;
      const hub = hubs[c.id];
      hub.x = core.x + Math.cos(a) * 180; hub.y = core.y + Math.sin(a) * 150;
      let j = 0;
      nodes.filter((n) => n.type === "leaf" && n.cluster === c.id).forEach((n) => {
        const aa = a + (j - 2) * 0.16; j++;
        n.x = core.x + Math.cos(aa) * (250 + ((j * 37) % 70));
        n.y = core.y + Math.sin(aa) * (220 + ((j * 29) % 70));
      });
    });

    // ── interaction ───────────────────────────────────────────────────────────
    let drag: NodeT | null = null;
    let downNode: NodeT | null = null;
    let downX = 0, downY = 0, moved = false, downMeta = false;
    let hover: NodeT | null = null;

    // screen (CSS px) → world coords
    function toWorld(sx: number, sy: number) {
      return { x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale };
    }
    // world → screen (CSS px)
    function toScreen(wx: number, wy: number) {
      return { x: wx * cam.scale + cam.x, y: wy * cam.scale + cam.y };
    }

    function focusCluster(id: string | null) {
      zoomedRef.current = id;
      setFocus(id);
      if (!id) { camTarget.scale = 1; camTarget.x = 0; camTarget.y = 0; return; }
      const group = nodes.filter((n) => n.cluster === id);
      if (!group.length) return;
      const cx = group.reduce((s, n) => s + n.x, 0) / group.length;
      const cy = group.reduce((s, n) => s + n.y, 0) / group.length;
      const s = 1.8;
      camTarget.scale = s;
      camTarget.x = W / 2 - cx * s;
      camTarget.y = H / 2 - cy * s;
    }

    function pick(wx: number, wy: number): NodeT | null {
      let best: NodeT | null = null, bd = 1e9;
      for (const n of nodes) {
        const d = Math.hypot(n.x - wx, n.y - wy);
        if (d < n.r + 7 && d < bd) { bd = d; best = n; }
      }
      return best;
    }
    function rel(e: PointerEvent) {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function onMove(e: PointerEvent) {
      const s = rel(e);
      const w = toWorld(s.x, s.y);
      if (Math.hypot(s.x - downX, s.y - downY) > 4) moved = true;
      if (drag) { drag.fx = w.x; drag.fy = w.y; }
      hover = pick(w.x, w.y);
      if (hover) {
        const sc = toScreen(hover.x, hover.y);
        tip.style.opacity = "1";
        tip.style.left = sc.x + "px";
        tip.style.top = sc.y + "px";
        tip.textContent =
          hover.type === "core" ? "CB EDGE · reset view"
            : hover.type === "hub" ? hover.id + " · " + (zoomedRef.current === hover.cluster ? "reset" : "focus")
              : hover.id + " · open  (⌘-click: new tab)";
        cv.style.cursor = "pointer";
      } else {
        tip.style.opacity = "0";
        cv.style.cursor = "default";
      }
    }
    function onDown(e: PointerEvent) {
      const s = rel(e);
      const w = toWorld(s.x, s.y);
      downX = s.x; downY = s.y; moved = false;
      downMeta = e.metaKey || e.ctrlKey;
      const n = pick(w.x, w.y);
      downNode = n;
      if (n && n.type !== "core") { drag = n; n.fx = w.x; n.fy = w.y; }
      cv.setPointerCapture(e.pointerId);
    }
    function onUp() {
      if (drag && drag.type !== "core") { drag.fx = null; drag.fy = null; }
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
      drag = null; downNode = null;
    }
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointerleave", () => { tip.style.opacity = "0"; hover = null; });

    // ── physics + render ────────────────────────────────────────────────────────
    function step() {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy || 1;
          const d = Math.sqrt(d2);
          const f = Math.min(1500 / d2, 4);
          dx /= d; dy /= d;
          a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
        }
      }
      for (const l of links) {
        const a = l.s, b = l.t;
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const rest = l.strong ? 155 : 72;
        const f = (d - rest) * 0.02;
        dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      for (const n of nodes) {
        n.vx += (W / 2 - n.x) * 0.0015;
        n.vy += (H / 2 - n.y) * 0.0015;
      }
      core.fx = W / 2; core.fy = H / 2;
      for (const n of nodes) {
        if (n.fx != null) { n.x = n.fx; n.y = n.fy!; n.vx = 0; n.vy = 0; continue; }
        n.vx *= 0.86; n.vy *= 0.86; n.x += n.vx; n.y += n.vy;
        n.x = Math.max(n.r, Math.min(W - n.r, n.x));
        n.y = Math.max(n.r + 8, Math.min(H - n.r, n.y));
      }
    }

    function draw() {
      step(); t++;
      const foc = focusRef.current;

      // while a cluster is zoomed, keep the camera locked on its (moving) centroid
      const zid = zoomedRef.current;
      if (zid) {
        const group = nodes.filter((n) => n.cluster === zid);
        if (group.length) {
          const cx = group.reduce((s, n) => s + n.x, 0) / group.length;
          const cy = group.reduce((s, n) => s + n.y, 0) / group.length;
          camTarget.x = W / 2 - cx * camTarget.scale;
          camTarget.y = H / 2 - cy * camTarget.scale;
        }
      }
      // ease camera toward target
      cam.scale += (camTarget.scale - cam.scale) * 0.12;
      cam.x += (camTarget.x - cam.x) * 0.12;
      cam.y += (camTarget.y - cam.y) * 0.12;

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.setTransform(DPR * cam.scale, 0, 0, DPR * cam.scale, cam.x * DPR, cam.y * DPR);

      for (const l of links) {
        const dim = foc && l.t.cluster !== foc && l.s.cluster !== foc;
        ctx.strokeStyle = dim ? "rgba(120,140,170,.05)" : (l.strong ? "rgba(150,190,255,.28)" : l.t.color + "55");
        ctx.lineWidth = (l.strong ? 1.6 : 0.8) / cam.scale;
        ctx.beginPath();
        ctx.moveTo(l.s.x, l.s.y);
        const mx = (l.s.x + l.t.x) / 2, my = (l.s.y + l.t.y) / 2 + Math.sin(t * 0.02 + l.t.x) * 3;
        ctx.quadraticCurveTo(mx, my, l.t.x, l.t.y);
        ctx.stroke();
      }
      for (const n of nodes) {
        const dim = foc && n.cluster !== foc && n.type !== "core";
        const pulse = n.type !== "leaf" ? 1 + Math.sin(t * 0.05 + n.x) * 0.12 : 1;
        ctx.globalAlpha = dim ? 0.18 : 1;
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 3.2);
        g.addColorStop(0, n.color); g.addColorStop(0.25, n.color + "aa"); g.addColorStop(1, n.color + "00");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 3.2 * pulse, 0, 7); ctx.fill();
        ctx.fillStyle = n.type === "core" ? "#fff" : n.color;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r * (hover === n ? 1.35 : 1), 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
        if (n.type === "core") {
          ctx.fillStyle = "#04070d"; ctx.font = "700 11px ui-sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("CB", n.x, n.y);
        } else if (n.type === "hub" && !dim) {
          ctx.fillStyle = "#dfeaff"; ctx.font = `600 ${10 / cam.scale}px ui-sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(n.id, n.x, n.y + n.r + 3);
        } else if (n.type === "leaf" && foc === n.cluster) {
          // when a cluster is focused, label its leaves with the route
          ctx.fillStyle = "#c7d4e8"; ctx.font = `500 ${9 / cam.scale}px ui-sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(n.id, n.x, n.y + n.r + 2);
        }
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
          "radial-gradient(circle at 50% 45%, #0b1220 0%, #060a12 70%, #04070d 100%)",
      }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />

      {/* legend / cluster filter */}
      <div style={{ position: "absolute", top: 14, left: 14, display: "flex", flexWrap: "wrap", gap: 8, maxWidth: "70%", zIndex: 5 }}>
        {CBEDGE_CLUSTERS.map((c) => (
          <button
            key={c.id}
            onMouseEnter={() => setFocus(c.id)}
            onMouseLeave={() => setFocus(zoomedRef.current)}
            style={{
              display: "flex", alignItems: "center", gap: 6, fontSize: 11,
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
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: ".5px", color: "#e7f0ff" }}>CB&nbsp;EDGE&nbsp;·&nbsp;BRAIN</div>
        <div style={{ fontSize: 11, color: "#7f93b0", marginTop: 2 }}>{total} routes · click to open · ⌘-click new tab · click hub to focus</div>
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
