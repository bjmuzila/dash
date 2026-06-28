"use client";

import { useEffect, useState } from "react";
import { HOME_THEME as T } from "@/components/shared/homeTheme";

const APP_NAME = (process.env.NEXT_PUBLIC_APP_NAME || "CB Edge").toUpperCase();

// Timing (ms)
const HOLD = 3500; // how long the splash stays fully visible
const FADE = 650; // fade-out duration

export default function SplashScreen() {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), HOLD);
    const t2 = setTimeout(() => setGone(true), HOLD + FADE);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (gone) return null;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at 50% 45%, #0a0e16 0%, #05060A 70%, #000 100%)",
        fontFamily: "var(--font-inter),'Inter','Helvetica Neue',Arial,sans-serif",
        opacity: leaving ? 0 : 1,
        transition: `opacity ${FADE}ms ease`,
        pointerEvents: leaving ? "none" : "auto",
      }}
    >
      <style>{`
        @keyframes cbSplashIn {
          0%   { opacity: 0; transform: translateY(14px); letter-spacing: 0.5em; }
          100% { opacity: 1; transform: translateY(0);    letter-spacing: 0.18em; }
        }
        @keyframes cbSplashSub {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes cbSplashPulse {
          0%, 100% { opacity: 0.65; }
          50%      { opacity: 1; }
        }
        @keyframes cbSplashGlow {
          0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); }
          50%      { opacity: 0.85; transform: translate(-50%, -50%) scale(1.08); }
        }
        .splash-fw { position: absolute; width: 4px; height: 4px; border-radius: 50%; opacity: 0; }
        .splash-fw1 { top: 50%; left: 16px; box-shadow: 0 0 0 #E0162B, 11px -11px 0 #FFFFFF, -11px -11px 0 #3C6FE0, 13px 0 0 #FFFFFF, -13px 0 0 #E0162B, 11px 11px 0 #3C6FE0, -11px 11px 0 #FFFFFF; animation: splashFw 1.8s ease-out infinite; }
        .splash-fw2 { top: 30%; left: 30px; box-shadow: 0 0 0 #3C6FE0, 10px -10px 0 #E0162B, -10px -10px 0 #FFFFFF, 12px 0 0 #E0162B, -12px 0 0 #3C6FE0, 10px 10px 0 #FFFFFF, -10px 10px 0 #E0162B; animation: splashFw 1.8s ease-out infinite; animation-delay: .9s; }
        .splash-fw3 { top: 72%; left: 26px; box-shadow: 0 -12px 0 #FFFFFF, 10px -6px 0 #E0162B, -10px -6px 0 #3C6FE0; animation: splashFw 1.8s ease-out infinite; animation-delay: 1.4s; }
        @keyframes splashFw {
          0%   { opacity: 0; transform: scale(0.2); }
          15%  { opacity: 1; }
          60%  { opacity: 1; transform: scale(1.1); }
          100% { opacity: 0; transform: scale(1.3); }
        }
        @media (prefers-reduced-motion: reduce) { .splash-fw { animation: none !important; opacity: .9; } }
      `}</style>

      {/* accent glow behind the wordmark */}
      <div
        style={{
          position: "absolute",
          top: "45%",
          left: "50%",
          width: 520,
          height: 260,
          maxWidth: "90vw",
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(circle, rgba(33,158,188,0.18) 0%, rgba(18,103,131,0.08) 45%, transparent 70%)",
          filter: "blur(12px)",
          pointerEvents: "none",
          animation: "cbSplashGlow 2.4s ease-in-out infinite",
        }}
      />

      <div
        style={{
          position: "relative",
          fontSize: "clamp(40px, 11vw, 96px)",
          fontWeight: 900,
          color: T.text,
          letterSpacing: "0.18em",
          textShadow: "0 0 28px rgba(33,158,188,0.45)",
          animation: "cbSplashIn 900ms cubic-bezier(0.16,1,0.3,1) both",
        }}
      >
        {APP_NAME}
      </div>

      <div
        style={{
          position: "relative",
          marginTop: "clamp(12px, 2.5vw, 22px)",
          fontSize: "clamp(13px, 3vw, 18px)",
          fontWeight: 700,
          letterSpacing: "0.42em",
          textIndent: "0.42em",
          color: T.cyan,
          animation: "cbSplashSub 700ms ease 350ms both, cbSplashPulse 1.8s ease-in-out 1.1s infinite",
        }}
      >
        COMING SOON...
      </div>

      <div
        className="splash-launch"
        style={{
          position: "relative",
          marginTop: "clamp(18px, 3.5vw, 30px)",
          fontSize: "clamp(15px, 3.4vw, 22px)",
          fontWeight: 800,
          letterSpacing: "0.08em",
          padding: "10px 22px",
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.25)",
          background: "rgba(255,255,255,0.04)",
          overflow: "visible",
          animation: "cbSplashSub 700ms ease 600ms both",
        }}
      >
        <span className="splash-fw splash-fw1" aria-hidden />
        <span className="splash-fw splash-fw2" aria-hidden />
        <span className="splash-fw splash-fw3" aria-hidden />
        <span style={{ color: T.muted, marginRight: 8, marginLeft: 34 }}>BETA SIGNUPS</span>
        <span style={{ color: "#E0162B" }}>MONDAY</span>{" "}
        <span style={{ color: "#FFFFFF" }}>JUNE 30</span>{" "}
        <span style={{ color: "#3C6FE0" }}>9:30 AM ET</span>
      </div>
    </div>
  );
}
