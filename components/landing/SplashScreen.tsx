"use client";

import { useEffect, useState } from "react";
import { HOME_THEME as T } from "@/components/shared/homeTheme";

const APP_NAME = (process.env.NEXT_PUBLIC_APP_NAME || "CB Edge").toUpperCase();
const LAUNCH_DATE = "7/13/26";

// Bump this key (e.g. "...-v2") to re-show the splash for everyone.
const SEEN_KEY = "cb-edge-splash-seen-v1";

// Timing (ms)
const HOLD = 1600; // how long the splash stays fully visible
const FADE = 650; // fade-out duration

export default function SplashScreen() {
  const [leaving, setLeaving] = useState(false);
  // Start "gone" until we've checked localStorage, so we never flash it on repeat visits.
  const [gone, setGone] = useState(true);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      seen = false; // private mode / storage blocked — just show it
    }
    if (seen) return;

    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }

    setGone(false);
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
        fontFamily: "'Inter','Helvetica Neue',Arial,sans-serif",
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
            "radial-gradient(circle, rgba(0,240,255,0.18) 0%, rgba(139,92,246,0.08) 45%, transparent 70%)",
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
          textShadow: "0 0 28px rgba(0,240,255,0.45)",
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
        style={{
          position: "relative",
          marginTop: "clamp(18px, 3.5vw, 30px)",
          fontSize: "clamp(15px, 3.4vw, 22px)",
          fontWeight: 800,
          letterSpacing: "0.08em",
          color: T.muted,
          animation: "cbSplashSub 700ms ease 600ms both",
        }}
      >
        {LAUNCH_DATE}
      </div>
    </div>
  );
}
