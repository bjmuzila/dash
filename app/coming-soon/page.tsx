"use client";

import { useEffect, useRef, useState } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";

// Beta signups open Wed Jul 1 2026, 9:30 AM ET (EDT = UTC-4 → 13:30 UTC).
const TARGET = Date.parse("2026-07-01T13:30:00Z");
const pad = (n: number) => String(Math.max(0, n)).padStart(2, "0");

function useCountdown() {
  const [t, setT] = useState({ d: "00", h: "00", m: "00", s: "00" });
  useEffect(() => {
    const tick = () => {
      let diff = Math.max(0, TARGET - Date.now());
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

function Fireworks() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const cx = cv.getContext("2d");
    if (!cx) return;
    let W = 0, H = 0, raf = 0;
    const resize = () => { W = cv.width = window.innerWidth; H = cv.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    const COLORS = [HOME_THEME.cyan, HOME_THEME.purple, HOME_THEME.red, HOME_THEME.text, "#FFD166", HOME_THEME.green];
    type P = { x: number; y: number; vx: number; vy: number; life: number; col: string; size: number };
    let parts: P[] = [];
    const burst = (x: number, y: number) => {
      const n = 70 + Math.random() * 40;
      const hue = COLORS[Math.floor(Math.random() * COLORS.length)];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = Math.random() * 5 + 1.5;
        parts.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1,
          col: Math.random() < 0.3 ? HOME_THEME.text : hue, size: Math.random() * 2 + 1.2,
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
  return <canvas ref={ref} style={{ position: "fixed", inset: 0, zIndex: 1 }} />;
}

const C = HOME_THEME.cyan;
const Unit = ({ v, label }: { v: string; label: string }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 60 }}>
    <span style={{
      fontSize: "clamp(30px,6vw,58px)", fontWeight: 900, color: HOME_THEME.text, lineHeight: 1,
      fontVariantNumeric: "tabular-nums",
      textShadow: `0 0 16px rgba(255,255,255,.85), 0 0 40px rgba(33,158,188,.55)`,
    }}>{v}</span>
    <span style={{ fontSize: "clamp(9px,1.4vw,13px)", letterSpacing: ".3em", color: C, marginTop: 8, fontWeight: 700 }}>{label}</span>
  </div>
);

export default function ComingSoonPage() {
  const t = useCountdown();
  return (
    <div style={{
      position: "relative", height: "100%", width: "100%", overflow: "hidden",
      background: HOME_THEME.bg, backgroundImage: HOME_THEME.shellGlow,
      fontFamily: "var(--font-inter), 'Inter', Arial, sans-serif",
    }}>
      <style>{`
        @keyframes cbLogoPulse{50%{text-shadow:0 0 26px rgba(33,158,188,1),0 0 70px rgba(33,158,188,.7),0 0 120px rgba(33,158,188,.45)}}
        @keyframes cbBoxGlow{50%{filter:blur(22px);opacity:.9}}
        @keyframes cbSpin{to{transform:rotate(360deg)}}
        @keyframes cbLaunch{50%{transform:scale(1.04)}}
      `}</style>
      <Fireworks />

      <div style={{
        position: "relative", zIndex: 2, height: "100%",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: 24, gap: 34,
      }}>
        <div style={{
          fontSize: "clamp(60px,13vw,150px)", fontWeight: 900, letterSpacing: ".06em",
          color: HOME_THEME.text, lineHeight: 1,
          textShadow: `0 0 18px rgba(33,158,188,.85), 0 0 46px rgba(33,158,188,.55), 0 0 90px rgba(33,158,188,.35)`,
          animation: "cbLogoPulse 3.2s ease-in-out infinite",
        }}>CB EDGE</div>

        <div style={{ fontSize: "clamp(14px,2.6vw,26px)", letterSpacing: ".55em", color: C, fontWeight: 700, textShadow: `0 0 14px rgba(33,158,188,.6)` }}>
          C O M I N G&nbsp;&nbsp;S O O N . . .
        </div>

        <div style={{ position: "relative", display: "inline-block" }}>
          <div style={{
            content: "", position: "absolute", inset: -14, borderRadius: 60, zIndex: -1,
            background: "radial-gradient(ellipse at center, rgba(255,255,255,.45), rgba(255,255,255,.12) 55%, transparent 75%)",
            filter: "blur(14px)", animation: "cbBoxGlow 2.6s ease-in-out infinite",
          }} />
          <div style={{
            display: "flex", alignItems: "center", gap: 14,
            background: HOME_THEME.panelBgStrong, border: `1px solid rgba(255,255,255,.22)`,
            borderRadius: 54, padding: "18px 34px", backdropFilter: "blur(4px)",
            boxShadow: "0 0 30px rgba(255,255,255,.25)",
          }}>
            <span style={{
              display: "inline-block", width: 34, height: 34, borderRadius: "50%", flex: "none",
              background: `radial-gradient(circle at 35% 30%, #fff, ${C})`,
              boxShadow: `0 0 16px ${C}`, animation: "cbSpin 4s linear infinite",
            }} />
            <span style={{
              fontSize: "clamp(15px,2.4vw,24px)", fontWeight: 900, letterSpacing: ".04em",
              color: HOME_THEME.text, textShadow: "0 0 10px rgba(255,255,255,.7)", whiteSpace: "nowrap",
            }}>BETA SIGNUPS&nbsp;&nbsp;WEDNESDAY JULY 1&nbsp;&nbsp;9:30 AM ET</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: "clamp(10px,2.2vw,26px)", marginTop: 4 }}>
          <Unit v={t.d} label="DAYS" />
          <Unit v={t.h} label="HOURS" />
          <Unit v={t.m} label="MINUTES" />
          <Unit v={t.s} label="SECONDS" />
        </div>

        <div style={{
          fontSize: "clamp(16px,3vw,34px)", fontWeight: 900, letterSpacing: ".08em",
          color: HOME_THEME.text, marginTop: 6,
          textShadow: `0 0 18px rgba(18,103,131,.8), 0 0 42px rgba(239,68,68,.5)`,
          animation: "cbLaunch 2.4s ease-in-out infinite",
        }}>
          🎆 FULL LAUNCH <span style={{ color: HOME_THEME.purple, textShadow: `0 0 18px rgba(18,103,131,.9)` }}>JULY 4TH WEEKEND</span> 🎆
        </div>
      </div>
    </div>
  );
}
