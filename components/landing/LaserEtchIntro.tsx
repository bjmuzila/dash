"use client";

import { useEffect, useRef, useState } from "react";
import { BRAND_LOGO_SRC } from "@/lib/brand";

// ─────────────────────────────────────────────────────────────────────────────
// LaserEtchIntro — landing-page opener (replaces the static hero image).
// Sequence: silver laser etches the chart line (fire/spark/ember trail) →
// line fades while the laser glides down → laser traces the "CB Edge" letter
// outlines → outline crossfades into the real brand lockup → everything
// fades to black → the whole section collapses out of the layout.
// Click anywhere (or reduced-motion preference) skips straight to collapse.
// NOTE: all colors in here are effect/scene colors (laser, fire, chrome),
// intentionally literal — they are not UI chrome tokens.
// ─────────────────────────────────────────────────────────────────────────────

const DW = 960;
const DH = 540;

// Chart line traced from the source video (normalized 0–1, x max .92 → rescaled)
const LINE: Array<[number, number]> = [
  [0, 0.83], [0.045, 0.85], [0.07, 0.82], [0.10, 0.895], [0.122, 0.875],
  [0.138, 0.905], [0.156, 0.85], [0.171, 0.885], [0.186, 0.83], [0.20, 0.78],
  [0.22, 0.755], [0.231, 0.80], [0.245, 0.77], [0.257, 0.76], [0.264, 0.735],
  [0.279, 0.70], [0.287, 0.715], [0.305, 0.65], [0.32, 0.61], [0.338, 0.545],
  [0.342, 0.575], [0.354, 0.56], [0.383, 0.508], [0.405, 0.61], [0.417, 0.598],
  [0.432, 0.692], [0.468, 0.582], [0.487, 0.67], [0.521, 0.72], [0.551, 0.62],
  [0.566, 0.608], [0.588, 0.57], [0.617, 0.47], [0.632, 0.458], [0.647, 0.486],
  [0.67, 0.44], [0.677, 0.447], [0.695, 0.368], [0.707, 0.352], [0.733, 0.458],
  [0.744, 0.435], [0.766, 0.357], [0.785, 0.30], [0.803, 0.268], [0.815, 0.20],
  [0.826, 0.134], [0.845, 0.095], [0.856, 0.10], [0.878, 0.229], [0.888, 0.20],
  [0.897, 0.156],
];

// Rect the real logo is drawn into — the traced outline is built from the SAME
// pixels at the SAME position, so the etch matches what it turns into.
const LOGO_W = 620;

// Phase durations (ms)
const T_ETCH = 10000;
const T_FADE = 1200;
const T_LOGO = 4500;
const T_XFADE = 1000;
const T_HOLD = 1400;
const T_BLACK = 1000;
const COLLAPSE_MS = 800;

type Particle = {
  x: number; y: number; vx: number; vy: number;
  l: number; dk: number; type: "fire" | "spark" | "smoke" | "ember"; c?: string;
};

export default function LaserEtchIntro() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [gone, setGone] = useState(false);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setCollapsed(true);
    setTimeout(() => {
      setGone(true);
      document
        .getElementById("hero-content")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, COLLAPSE_MS + 50);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let stop = false;

    // ── sizing (cover-fit design space onto viewport) ──
    let scale = 1, offX = 0, offY = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = cv.clientWidth, ch = cv.clientHeight;
      cv.width = cw * dpr;
      cv.height = ch * dpr;
      scale = Math.max(cw / DW, ch / DH) * dpr;
      offX = (cw * dpr - DW * scale) / 2;
      offY = (ch * dpr - DH * scale) / 2;
    };
    resize();
    window.addEventListener("resize", resize);

    // ── chart line geometry ──
    const PAD = 30;
    const pts = LINE.map((p) => [PAD + (p[0] * (DW - 2 * PAD)) / 0.92, 40 + p[1] * (DH - 140)]);
    const seg = [0];
    for (let i = 1; i < pts.length; i++)
      seg.push(seg[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = seg[seg.length - 1];
    const ptAt = (len: number): [number, number] => {
      let i = 1;
      while (i < seg.length && seg[i] < len) i++;
      if (i >= seg.length) return pts[pts.length - 1] as [number, number];
      const t = (len - seg[i - 1]) / (seg[i] - seg[i - 1]);
      return [
        pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
        pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
      ];
    };

    // ── logo outline points — edge pixels of the REAL logo png, traced at the
    //    exact rect it is later drawn into, so the outline matches the logo ──
    type Tp = { p: [number, number]; jump: boolean };
    const letterPaths: Tp[][] = [];
    let logoTotalPts = 0;
    const logoImg = new window.Image();
    logoImg.onload = () => {
      const w = LOGO_W;
      const h = (logoImg.naturalHeight / logoImg.naturalWidth) * w;
      const x0 = DW / 2 - w / 2, y0 = DH / 2 - h / 2;
      const mc = document.createElement("canvas");
      mc.width = DW; mc.height = DH;
      const m = mc.getContext("2d")!;
      m.drawImage(logoImg, x0, y0, w, h);
      const d = m.getImageData(0, 0, DW, DH).data;
      const a = (xx: number, yy: number) =>
        xx < 0 || yy < 0 || xx >= DW || yy >= DH ? 0 : d[(yy * DW + xx) * 4 + 3];
      const raw: Array<[number, number]> = [];
      const STEP = 2, TH = 40;
      for (let yy = Math.floor(y0); yy < y0 + h; yy += STEP)
        for (let xx = Math.floor(x0); xx < x0 + w; xx += STEP) {
          if (a(xx, yy) <= TH) continue;
          // edge = opaque pixel with a transparent neighbor
          if (a(xx - STEP, yy) <= TH || a(xx + STEP, yy) <= TH || a(xx, yy - STEP) <= TH || a(xx, yy + STEP) <= TH)
            raw.push([xx, yy]);
        }
      if (!raw.length) return;
      // nearest-neighbor trace order
      let cur = 0;
      for (let i = 1; i < raw.length; i++)
        if (raw[i][0] < raw[cur][0] || (raw[i][0] === raw[cur][0] && raw[i][1] < raw[cur][1])) cur = i;
      const used = new Array(raw.length).fill(false);
      used[cur] = true;
      const ord: Tp[] = [{ p: raw[cur], jump: true }];
      for (let k = 1; k < raw.length; k++) {
        let best = -1, bd = Infinity;
        const c = raw[cur];
        for (let i = 0; i < raw.length; i++) {
          if (used[i]) continue;
          const dx = raw[i][0] - c[0], dy = raw[i][1] - c[1];
          const dist = dx * dx + dy * dy;
          if (dist < bd) { bd = dist; best = i; }
        }
        used[best] = true;
        ord.push({ p: raw[best], jump: bd > 400 });
        cur = best;
      }
      letterPaths.push(ord);
      logoTotalPts = ord.length;
    };
    // NOTE: the etch animation traces whatever this resolves to. The 3.0
    // lockup is a different shape (≈3.39:1 vs ≈1.83:1) and carries a tagline,
    // so the traced outline is wider and busier than the one this was first
    // tuned against. Worth an eyeball on the landing page after a deploy.
    logoImg.src = BRAND_LOGO_SRC;

    // ── persistent etched-outline layer ──
    const layer = document.createElement("canvas");
    layer.width = DW; layer.height = DH;
    const lx = layer.getContext("2d")!;
    let traced = 0;
    const burnTo = (count: number) => {
      let n = 0;
      lx.save();
      lx.shadowColor = "rgba(220,232,248,.9)";
      lx.shadowBlur = 6;
      lx.fillStyle = "#e8eef6";
      for (const path of letterPaths) {
        for (let i = 0; i < path.length; i++) {
          if (n >= count) { lx.restore(); return; }
          if (n >= traced) {
            const q = path[i];
            lx.beginPath(); lx.arc(q.p[0], q.p[1], 1.6, 0, 7); lx.fill();
          }
          n++;
        }
      }
      lx.restore();
    };
    const currentPt = (count: number): [number, number] => {
      let n = 0;
      for (const path of letterPaths) {
        if (count < n + path.length) return path[count - n].p;
        n += path.length;
      }
      const lp = letterPaths[letterPaths.length - 1];
      return lp[lp.length - 1].p;
    };

    // ── particles ──
    let particles: Particle[] = [];
    const addFire = (x: number, y: number) => {
      for (let k = 0; k < 4; k++) {
        const t = Math.random();
        particles.push({
          x: x + (Math.random() - 0.5) * 5, y: y + (Math.random() - 0.5) * 3,
          vx: (Math.random() - 0.5) * 1.2, vy: -Math.random() * 1.6 - 0.4,
          l: 1, dk: 0.025 + Math.random() * 0.02, type: "fire",
          c: t < 0.5 ? "#ff9a3d" : t < 0.8 ? "#ff5f2e" : "#ffd76e",
        });
      }
      for (let k = 0; k < 3; k++)
        particles.push({ x, y, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 3 - 0.5, l: 1, dk: 0.03, type: "spark", c: "#fff1c4" });
      if (Math.random() < 0.5)
        particles.push({ x, y, vx: (Math.random() - 0.5) * 0.4, vy: -0.5 - Math.random() * 0.5, l: 1, dk: 0.008, type: "smoke" });
      if (Math.random() < 0.6)
        particles.push({ x: x + (Math.random() - 0.5) * 4, y: y + (Math.random() - 0.5) * 4, vx: 0, vy: 0, l: 1, dk: 0.006 + Math.random() * 0.006, type: "ember", c: Math.random() < 0.5 ? "#ff7a30" : "#ffb45e" });
    };
    const addSilverSparks = (x: number, y: number) => {
      for (let k = 0; k < 4; k++)
        particles.push({ x, y, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 3 - 0.5, l: 1, dk: 0.03, type: "spark", c: "#eaf1fa" });
      if (Math.random() < 0.4)
        particles.push({ x, y, vx: (Math.random() - 0.5) * 0.4, vy: -0.6, l: 1, dk: 0.01, type: "smoke" });
      if (Math.random() < 0.5)
        particles.push({ x, y, vx: 0, vy: 0, l: 1, dk: 0.01, type: "ember", c: "#dfe9f5" });
    };
    const drawParticles = () => {
      particles = particles.filter((p) => p.l > 0);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy; p.l -= p.dk;
        if (p.type === "spark") {
          p.vy += 0.12;
          ctx.globalAlpha = Math.max(p.l, 0);
          ctx.fillStyle = p.c!;
          ctx.fillRect(p.x, p.y, 2, 2);
        } else if (p.type === "fire") {
          ctx.globalAlpha = Math.max(p.l, 0) * 0.8;
          ctx.fillStyle = p.c!;
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.6 * p.l + 0.6, 0, 7); ctx.fill();
        } else if (p.type === "ember") {
          ctx.globalAlpha = Math.max(p.l, 0) * 0.9;
          ctx.shadowColor = p.c!; ctx.shadowBlur = 8;
          ctx.fillStyle = p.c!;
          ctx.beginPath(); ctx.arc(p.x, p.y, 1.4, 0, 7); ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.globalAlpha = Math.max(p.l, 0) * 0.14;
          ctx.fillStyle = "#aab6c2";
          ctx.beginPath(); ctx.arc(p.x, p.y, 7 * (1.6 - p.l), 0, 7); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const silvGrad = (y0: number, y1: number) => {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.4, "#cfd6df");
      g.addColorStop(0.6, "#8d97a5");
      g.addColorStop(1, "#e8edf3");
      return g;
    };
    const laser = (x: number, y: number) => {
      ctx.save();
      ctx.strokeStyle = "rgba(180,220,255,.35)";
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x, -offY / scale); ctx.lineTo(x, y); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.8)";
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(x, -offY / scale); ctx.lineTo(x, y); ctx.stroke();
      const g = ctx.createRadialGradient(x, y, 0, x, y, 28);
      g.addColorStop(0, "rgba(255,255,255,.95)");
      g.addColorStop(0.25, "rgba(215,230,250,.85)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 28, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(x, y, 3.4, 0, 7); ctx.fill();
      ctx.restore();
    };
    // gridAlpha 0 = clean backdrop (chart-etch part), 1 = grid visible (logo part)
    const bg = (gridAlpha: number) => {
      const ex = DW + (2 * offX) / scale, ey = DH + (2 * offY) / scale;
      const g = ctx.createLinearGradient(0, -offY / scale, 0, ey);
      g.addColorStop(0, "#0a1218");
      g.addColorStop(1, "#0c161e");
      ctx.fillStyle = g;
      ctx.fillRect(-offX / scale - 2, -offY / scale - 2, ex + 4, ey + 4);
      if (gridAlpha > 0) {
        ctx.strokeStyle = `rgba(90,140,160,${0.08 * gridAlpha})`;
        ctx.lineWidth = 1;
        for (let x = -64; x <= DW + 64; x += 64) { ctx.beginPath(); ctx.moveTo(x, -offY / scale); ctx.lineTo(x, ey); ctx.stroke(); }
        for (let y = -54; y <= DH + 54; y += 54) { ctx.beginPath(); ctx.moveTo(-offX / scale, y); ctx.lineTo(ex, y); ctx.stroke(); }
      }
    };
    const drawLine = (len: number, alpha: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = "rgba(210,225,245,.65)";
      ctx.shadowBlur = 14;
      ctx.strokeStyle = silvGrad(40, DH - 100);
      ctx.lineWidth = 5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      let i = 1;
      while (i < seg.length && seg[i] <= len) { ctx.lineTo(pts[i][0], pts[i][1]); i++; }
      if (i < seg.length) { const p = ptAt(len); ctx.lineTo(p[0], p[1]); }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,.5)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    };
    const drawRealLogo = (alpha: number) => {
      if (!logoImg.complete || !logoImg.naturalWidth) return;
      const w = LOGO_W;
      const h = (logoImg.naturalHeight / logoImg.naturalWidth) * w;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(logoImg, DW / 2 - w / 2, DH / 2 - h / 2, w, h);
      ctx.restore();
    };

    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    let t0: number | null = null;

    const frame = (ts: number) => {
      if (stop) return;
      if (t0 === null) t0 = ts;
      const t = ts - t0;
      ctx.setTransform(scale, 0, 0, scale, offX, offY);

      const A = T_ETCH, B = A + T_FADE, C = B + T_LOGO, D = C + T_XFADE, E = D + T_HOLD, F = E + T_BLACK;
      // grid hidden during the chart etch, fades in with the logo phase
      bg(t < A ? 0 : t < B ? (t - A) / T_FADE : 1);

      if (t < A) {
        const len = total * ease(Math.min(t / A, 1));
        drawLine(len, 1);
        const p = ptAt(len);
        addFire(p[0], p[1]);
        drawParticles();
        laser(p[0], p[1]);
      } else if (t < B) {
        const f = (t - A) / T_FADE;
        drawLine(total, 1 - f);
        const end = pts[pts.length - 1];
        const s = letterPaths.length ? letterPaths[0][0].p : [DW / 2 - LOGO_W / 2, DH / 2];
        const x = end[0] + (s[0] - end[0]) * ease(f);
        const y = end[1] + (s[1] - end[1]) * ease(f);
        drawParticles();
        laser(x, y);
      } else if (t < C && logoTotalPts > 0) {
        const pr = Math.min((t - B) / T_LOGO, 1);
        const target = Math.floor(logoTotalPts * pr);
        burnTo(target);
        traced = Math.max(traced, target);
        ctx.drawImage(layer, 0, 0);
        const p = currentPt(Math.max(target - 1, 0));
        addSilverSparks(p[0], p[1]);
        drawParticles();
        laser(p[0], p[1]);
      } else if (t < D) {
        // traced outline crossfades into the real logo
        const f = (t - C) / T_XFADE;
        burnTo(logoTotalPts);
        traced = logoTotalPts;
        ctx.save(); ctx.globalAlpha = 1 - f; ctx.drawImage(layer, 0, 0); ctx.restore();
        drawRealLogo(f);
        drawParticles();
      } else if (t < E) {
        drawRealLogo(1);
        drawParticles();
      } else if (t < F) {
        // fade to black
        const f = (t - E) / T_BLACK;
        drawRealLogo(1 - f * 0.4);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = `rgba(0,0,0,${f})`;
        ctx.fillRect(0, 0, cv.width, cv.height);
      } else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, cv.width, cv.height);
        finish();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (gone) return null;

  return (
    <section
      aria-hidden
      onClick={finish}
      style={{
        height: collapsed ? 0 : "100vh",
        overflow: "hidden",
        transition: `height ${COLLAPSE_MS}ms ease`,
        background: "#000",
        cursor: "pointer",
        position: "relative",
        zIndex: 5,
      }}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100vh", display: "block" }} />
    </section>
  );
}
