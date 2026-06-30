"use client";

import { useEffect, useRef, useState } from "react";
import { HOME_THEME as T } from "@/components/shared/homeTheme";

const APP_NAME = (process.env.NEXT_PUBLIC_APP_NAME || "CB Edge").toUpperCase();

// Beta signups open Wed Jul 1 2026, 9:30 AM ET (EDT = UTC-4 → 13:30 UTC).
const TARGET = Date.parse("2026-07-01T13:30:00Z");
const FADE = 650; // fade-out duration (ms)
const pad = (n: number) => String(Math.max(0, n)).padStart(2, "0");

function useCountdown() {
  const [t, setT] = useState({ d: "00", h: "00", m: "00", s: "00" });
  useEffect(() => {
    const tick = () => {
      const diff = Math.max(0, TARGET - Date.now());
      const s = Math.floor(diff / 1000);
      setT({
        d: pad(Math.floor(s / 86400)),
        h: pad(Math.floor((s % 86400) / 3600)),
        m: pad(Math.floor((s % 3600) / 60)),
        s: pad(s % 60),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

// Lightweight canvas fireworks. Cleans itself up on unmount.
function Fireworks() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const cx = cv.getContext("2d");
    if (!cx) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let W = 0, H = 0, raf = 0;
    const resize = () => { W = cv.width = window.innerWidth; H = cv.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    const COLORS = [T.cyan, T.purple, T.red, T.text, "#FFD166", T.green];
    type P = { x: number; y: number; vx: number; vy: number; life: number; col: string; size: number };
    let parts: P[] = [];
    const burst = (x: number, y: number) => {
      const n = 70 + Math.random() * 40;
      const hue = COLORS[Math.floor(Math.random() * COLORS.length)];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = Math.random() * 5 + 1.5;
        parts.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1,
          col: Math.random() < 0.3 ? T.text : hue, size: Math.random() * 2 + 1.2,
        });
      }
    };
    const loop = () => {
      cx.globalCompositeOperation = "source-over";
      cx.fillStyle = "rgba(5,6,10,0.22)";
      cx.fillRect(0, 0, W, H);
      cx.globalCompositeOperation = "lighter";
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.045; p.vx *= 0.99; p.life -= 0.012;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        cx.globalAlpha = Math.max(0, p.life);
        cx.fillStyle = p.col;
        cx.beginPath(); cx.arc(p.x, p.y, p.size, 0, Math.PI * 2); cx.fill();
      }
      cx.globalAlpha = 1;
      raf = requestAnimationFrame(loop);
    };
    loop();
    const id = setInterval(() => burst(Math.random() * W * 0.8 + W * 0.1, Math.random() * H * 0.45 + H * 0.08), 900);
    burst(W * 0.3, H * 0.3); burst(W * 0.7, H * 0.25);
    return () => { cancelAnimationFrame(raf); clearInterval(id); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }} aria-hidden />;
}

const Unit = ({ v, label }: { v: string; label: string }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 56 }}>
    <span style={{
      fontSize: "clamp(26px,5.5vw,52px)", fontWeight: 900, color: T.text, lineHeight: 1,
      fontVariantNumeric: "tabular-nums",
      textShadow: "0 0 16px rgba(255,255,255,.85), 0 0 40px rgba(33,158,188,.55)",
    }}>{v}</span>
    <span style={{ fontSize: "clamp(9px,1.4vw,12px)", letterSpacing: ".3em", color: T.cyan, marginTop: 7, fontWeight: 700 }}>{label}</span>
  </div>
);

export default function SplashScreen() {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const t = useCountdown();

  const enter = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => setGone(true), FADE);
  };

  // Auto-enter the site after 10s; clicking ENTER SITE skips early.
  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 10000);
    const t2 = setTimeout(() => setGone(true), 10000 + FADE);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (gone) return null;

  return (
    <div
      role="dialog"
      aria-label="CB Edge coming soon"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: "clamp(22px, 3vw, 34px)",
        padding: 24,
        background: "radial-gradient(circle at 50% 45%, #0a0e16 0%, #05060A 70%, #000 100%)",
        fontFamily: "var(--font-inter),'Inter','Helvetica Neue',Arial,sans-serif",
        opacity: leaving ? 0 : 1,
        transition: `opacity ${FADE}ms ease`,
        pointerEvents: leaving ? "none" : "auto",
      }}
    >
      <style>{`
        @keyframes cbLogoPulse{50%{filter:drop-shadow(0 0 30px rgba(33,158,188,.85)) drop-shadow(0 0 80px rgba(33,158,188,.5))}}
        @keyframes cbBoxGlow{50%{filter:blur(22px);opacity:.9}}
        @keyframes cbDotSpin{to{transform:rotate(360deg)}}
        @keyframes cbLaunch{50%{transform:scale(1.04)}}
        @keyframes cbSplashSub{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:translateY(0)}}
        @media (prefers-reduced-motion: reduce){
          .cb-anim{animation:none !important}
        }
      `}</style>

      <Fireworks />

      <img
        src="/cb-edge-logo.png"
        alt={APP_NAME}
        className="cb-anim"
        style={{
          position: "relative", zIndex: 2,
          width: "clamp(360px, 78vw, 860px)", height: "auto", maxWidth: "96vw",
          objectFit: "contain",
          filter: "drop-shadow(0 0 22px rgba(33,158,188,.55)) drop-shadow(0 0 60px rgba(33,158,188,.35))",
          animation: "cbLogoPulse 3.2s ease-in-out infinite",
        }}
      />

      <div className="cb-anim" style={{
        position: "relative", zIndex: 2,
        marginTop: "clamp(-90px, -10vw, -56px)",
        fontSize: "clamp(13px,2.6vw,24px)", letterSpacing: ".5em", textIndent: ".5em",
        color: T.cyan, fontWeight: 700, textShadow: "0 0 14px rgba(33,158,188,.6)",
        animation: "cbSplashSub 700ms ease 250ms both",
      }}>COMING SOON...</div>

      {/* beta-signup pill — glow lives behind the pill only, never the text */}
      <div style={{ position: "relative", display: "inline-block", zIndex: 2 }}>
        <div className="cb-anim" style={{
          position: "absolute", inset: -4, borderRadius: 60, zIndex: -1,
          background: "rgba(255,255,255,0.9)",
          boxShadow: "0 0 34px 6px rgba(255,255,255,.55)",
          filter: "blur(8px)", animation: "cbBoxGlow 2.6s ease-in-out infinite",
        }} />
        <div style={{
          position: "relative",
          display: "flex", alignItems: "center", gap: 14,
          background: T.panelBgStrong, border: "1px solid rgba(255,255,255,.22)",
          borderRadius: 54, padding: "16px 30px", backdropFilter: "blur(4px)",
          flexWrap: "wrap", justifyContent: "center",
        }}>
          <span className="cb-anim" style={{
            display: "inline-block", width: 30, height: 30, borderRadius: "50%", flex: "none",
            background: `radial-gradient(circle at 35% 30%, #fff, ${T.cyan})`,
            boxShadow: `0 0 16px ${T.cyan}`, animation: "cbDotSpin 4s linear infinite",
          }} />
          <span style={{
            fontSize: "clamp(14px,2.2vw,22px)", fontWeight: 900, letterSpacing: ".03em",
            color: "#FFFFFF",
          }}>
            BETA SIGNUPS&nbsp;&nbsp;WEDNESDAY JULY 1&nbsp;&nbsp;9:30 AM ET
          </span>
        </div>
      </div>

      {/* live countdown */}
      <div style={{ position: "relative", zIndex: 2, display: "flex", gap: "clamp(10px,2.2vw,24px)" }}>
        <Unit v={t.d} label="DAYS" />
        <Unit v={t.h} label="HOURS" />
        <Unit v={t.m} label="MINUTES" />
        <Unit v={t.s} label="SECONDS" />
      </div>

      {/* full launch line */}
      <div className="cb-anim" style={{
        position: "relative", zIndex: 2,
        fontSize: "clamp(15px,3vw,32px)", fontWeight: 900, letterSpacing: ".08em",
        animation: "cbLaunch 2.4s ease-in-out infinite",
      }}>
        🎆 <span style={{ color: "#E0162B" }}>FULL</span>{" "}
        <span style={{ color: "#FFFFFF" }}>LAUNCH</span>{" "}
        <span style={{ color: "#3C6FE0" }}>JULY</span>{" "}
        <span style={{ color: "#E0162B" }}>4TH</span>{" "}
        <span style={{ color: "#FFFFFF" }}>WEEKEND</span> 🎆
      </div>

      {/* enter the site */}
      <button
        onClick={enter}
        style={{
          position: "relative", zIndex: 2, marginTop: 4, cursor: "pointer",
          fontSize: "clamp(12px,1.8vw,15px)", fontWeight: 700, letterSpacing: ".18em",
          color: T.text, background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.25)", borderRadius: 999,
          padding: "11px 26px", transition: "background 160ms ease, border-color 160ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(33,158,188,0.18)"; e.currentTarget.style.borderColor = T.cyan; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)"; }}
      >
        ENTER SITE →
      </button>
    </div>
  );
}
