import { useEffect, useRef, useState } from "react";
import { HOME_THEME as T } from "./theme";

// Hero product loop for the landing page.
// Degrades: video → poster still → reduced-motion poster.
export default function HeroVideo({
  src = "/hero-loop.mp4",
  poster = "/landing-bg.png",
  alt = "CB Edge dashboard — live gamma exposure and options flow",
}) {
  const videoRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reduced || failed) return;
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {});
  }, [reduced, failed]);

  const showVideo = !reduced && !failed && !!src;

  return (
    <div style={frame} className="hero-frame">
      <div style={{ position: "relative", width: "100%", paddingTop: "56.25%" }}>
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

        <div style={glass} aria-hidden />
      </div>

      <div style={liveBadge}>
        <span style={liveDot} /> LIVE DASHBOARD
      </div>
    </div>
  );
}

const frame = {
  position: "relative",
  width: "100%",
  marginBottom: 20,
  borderRadius: 14,
  overflow: "hidden",
  border: "1px solid rgba(33,158,188,0.28)",
  boxShadow: "0 18px 50px rgba(0,0,0,0.55), 0 0 0 1px rgba(33,158,188,0.06)",
  background: "rgba(5,6,10,0.9)",
};

const media = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const glass = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 22%), radial-gradient(circle at 50% 50%, transparent 55%, rgba(5,6,10,0.45) 100%)",
};

const liveBadge = {
  position: "absolute",
  top: 10,
  left: 10,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 9px",
  borderRadius: 999,
  fontSize: 9.5,
  fontWeight: 800,
  letterSpacing: "0.12em",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: T.text,
  background: "rgba(5,6,10,0.72)",
  border: "1px solid rgba(33,158,188,0.4)",
  backdropFilter: "blur(6px)",
};

const liveDot = {
  width: 5,
  height: 5,
  borderRadius: 999,
  background: T.green,
  boxShadow: `0 0 8px ${T.green}`,
};
