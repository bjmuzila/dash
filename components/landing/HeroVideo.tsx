"use client";

import { useEffect, useRef, useState } from "react";
import { HOME_THEME as T } from "@/components/shared/homeTheme";

// Hero product loop for the landing page.
//
// The landing sold a real-time visual dashboard while showing zero pixels of
// it. This is the fix: a short, silent, looping capture of the live product,
// framed like a screen.
//
// Degrades on purpose, in this order:
//   1. video plays          → best case
//   2. no file / decode err → poster still, no broken-media icon, no layout jump
//   3. reduced-motion       → poster still, video never fetched (saves the MBs too)
//
// So this ships and looks right BEFORE the capture exists — drop the file at
// `src` later and it upgrades itself with no code change.

interface HeroVideoProps {
  /** Public path to the loop, e.g. "/hero-loop.mp4". */
  src?: string;
  /** Still shown before play, on failure, and under reduced-motion. */
  poster?: string;
  alt?: string;
}

export default function HeroVideo({
  src = "/hero-loop.mp4",
  poster = "/landing-bg.png",
  alt = "CB Edge dashboard — live gamma exposure and options flow",
}: HeroVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Some mobile browsers reject autoplay even when muted+playsInline. Failing
  // that promise is fine — the poster is already underneath.
  useEffect(() => {
    if (reduced || failed) return;
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => { /* poster stands in */ });
  }, [reduced, failed]);

  const showVideo = !reduced && !failed && !!src;

  return (
    <div style={frame} className="hero-frame">
      {/* 16:9 box reserved up front so the card never reflows when media lands. */}
      <div style={{ position: "relative", width: "100%", paddingTop: "56.25%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster} alt={alt} style={media} />

        {showVideo && (
          <video
            ref={videoRef}
            src={src}
            poster={poster}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={alt}
            onError={() => setFailed(true)}
            style={media}
          />
        )}

        {/* Screen-glass: vignette + top sheen so a raw capture reads as product. */}
        <div style={glass} aria-hidden />
      </div>

      <div style={liveBadge}>
        <span style={liveDot} /> LIVE DASHBOARD
      </div>
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */

const frame: React.CSSProperties = {
  position: "relative",
  width: "100%",
  marginBottom: 20,
  borderRadius: 14,
  overflow: "hidden",
  border: "1px solid rgba(33,158,188,0.28)",
  boxShadow: "0 18px 50px rgba(0,0,0,0.55), 0 0 0 1px rgba(33,158,188,0.06)",
  background: "rgba(5,6,10,0.9)",
};

const media: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const glass: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 22%), radial-gradient(circle at 50% 50%, transparent 55%, rgba(5,6,10,0.45) 100%)",
};

const liveBadge: React.CSSProperties = {
  position: "absolute",
  top: 10,
  left: 10,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 9px",
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.12em",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: T.text,
  background: "rgba(5,6,10,0.72)",
  border: "1px solid rgba(33,158,188,0.4)",
  backdropFilter: "blur(6px)",
};

const liveDot: React.CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: 999,
  background: T.green,
  boxShadow: `0 0 8px ${T.green}`,
};
