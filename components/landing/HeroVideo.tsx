"use client";

import { useEffect, useRef, useState } from "react";
import { V3, V3_MONO, V3_RADIUS, V3_TEXT, v3CardStyle, v3a } from "@/components/landing/v3Theme";

// Product capture for the landing page's PRODUCT section.
//
// Degrades on purpose, in this order:
//   1. video plays          → best case
//   2. no file / decode err → poster still, no broken-media icon, no layout jump
//   3. reduced-motion       → poster still, video never fetched (saves the MBs too)
//
// ── 2026-09-10: v3, and no video until there is a v3 video ──────────────────
// `public/hero-loop.mp4` is a 7/14 capture of the v2 board (old wordmark, an
// ICT tab, the Owner and Test Lab tabs) and `public/landing-bg.png` is a 6/22
// one that still says "MVC". Under a badge that read "LIVE DASHBOARD". On a
// page whose whole argument is "we publish what is actually true", that was
// the one thing on it that was not. So:
//
//   • The landing passes `src=""` and `poster="/whole-board-preview.png"`
//     (the Sept 8 v3 board). No video is fetched. Drop a v3 loop at
//     /hero-loop-v3.mp4 and pass it as `src` — nothing else changes.
//   • The badge says what it is: a capture, dated by the file, not "LIVE".
//   • v3 surfaces: 8px radius, an opaque hairline, no glow, no glass. The
//     14px radius / drop-shadow / backdrop-blur frame was v2.
//   • `aspect` is the media's own ratio. The old 16:9 box would have cropped
//     the near-square board to its middle third.

interface HeroVideoProps {
  /** Public path to the loop, e.g. "/hero-loop-v3.mp4". Empty = poster only. */
  src?: string;
  /** Still shown before play, on failure, under reduced-motion, or alone. */
  poster?: string;
  alt?: string;
  /** width / height of the media. Reserves the box so nothing reflows. */
  aspect?: number;
  /** Badge text. */
  label?: string;
}

export default function HeroVideo({
  src = "",
  poster = "/whole-board-preview.png",
  alt = "CB Edge v3 board — key levels, gauge rail, GEX candles, Multi Greek, net premium, GEX chart and flow tape",
  aspect = 16 / 9,
  label = "Product capture · v3 board",
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
    if (reduced || failed || !src) return;
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => { /* poster stands in */ });
  }, [reduced, failed, src]);

  const showVideo = !reduced && !failed && !!src;

  return (
    <div style={frame} className="hero-frame">
      {/* Box reserved up front at the media's own ratio so the card never reflows. */}
      <div style={{ position: "relative", width: "100%", paddingTop: `${(100 / aspect).toFixed(3)}%` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster} alt={alt} style={media} loading="lazy" />

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
      </div>

      <div style={badge}>{label}</div>
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */
/* v3 surfaces only. No blur, no glow, no gradient sheen. */

const frame: React.CSSProperties = {
  ...v3CardStyle,
  position: "relative",
  width: "100%",
  marginBottom: 20,
  overflow: "hidden",
  background: V3.app,
};

const media: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const badge: React.CSSProperties = {
  position: "absolute",
  top: 10,
  left: 10,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 9px",
  borderRadius: V3_RADIUS.sm,
  fontSize: V3_TEXT.xs,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  fontFamily: V3_MONO,
  color: V3.fg,
  background: v3a(V3.bg, 0.85),
  border: `1px solid ${V3.line}`,
};
