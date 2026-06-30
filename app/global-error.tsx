"use client";

import { useEffect } from "react";
import ChaseScene from "@/components/shared/ChaseScene";
import { HOME_THEME, homeButtonStyle } from "@/components/shared/homeTheme";

/**
 * global-error replaces the ROOT layout when the layout itself throws, so it
 * must render its own <html>/<body>. We can't use app fonts/providers here.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: 24,
          background: HOME_THEME.bg,
          backgroundImage: HOME_THEME.shellGlow,
          color: HOME_THEME.text,
          fontFamily: "'Inter','Helvetica Neue',Arial,sans-serif",
        }}
      >
        <ChaseScene />
        <div
          style={{
            fontSize: "clamp(64px, 14vw, 132px)",
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: "-0.04em",
            background: `linear-gradient(180deg, ${HOME_THEME.cyan}, ${HOME_THEME.purple})`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            marginTop: 8,
          }}
        >
          500
        </div>
        <h1 style={{ fontSize: "clamp(18px,3vw,26px)", fontWeight: 700, margin: "12px 0 6px" }}>
          The whole floor went dark
        </h1>
        <p style={{ color: "rgba(255,255,255,0.55)", maxWidth: 460, margin: "0 auto 24px", fontSize: 14, lineHeight: 1.6 }}>
          A critical error took down the page. Bzila stabbed the red arrow — now hit reload to bring the lights back.
        </p>
        <button
          onClick={() => reset()}
          style={{ ...homeButtonStyle, fontSize: 12, padding: "10px 20px" }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
