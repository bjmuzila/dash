"use client";

import type { ReactNode } from "react";
import { HOME_THEME, homeShellStyle, homeButtonStyle, homeSecondaryButtonStyle } from "./homeTheme";
import ChaseScene from "./ChaseScene";

/**
 * Shared visual shell for every error page (404, runtime error, global error).
 * Renders the Bzila chase animation + a code, headline, subline and actions.
 */
export default function ErrorShell({
  code,
  title,
  subtitle,
  primary,
  secondary,
}: {
  code: string;
  title: string;
  subtitle: string;
  primary?: { label: string; onClick?: () => void; href?: string };
  secondary?: { label: string; href: string };
}) {
  const PrimaryBtn = primary?.href ? "a" : "button";
  return (
    <div
      style={{
        ...homeShellStyle,
        height: "100vh",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 24,
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
        {code}
      </div>

      <h1 style={{ fontSize: "clamp(18px, 3vw, 26px)", fontWeight: 700, margin: "12px 0 6px" }}>{title}</h1>
      <p style={{ color: "rgba(255,255,255,0.55)", maxWidth: 460, margin: "0 auto 24px", fontSize: 14, lineHeight: 1.6 }}>
        {subtitle}
      </p>

      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        {primary && (
          <PrimaryBtn
            href={primary.href}
            onClick={primary.onClick}
            style={{ ...homeButtonStyle, fontSize: 12, padding: "10px 20px", textDecoration: "none", display: "inline-block" }}
          >
            {primary.label}
          </PrimaryBtn>
        )}
        {secondary && (
          <a
            href={secondary.href}
            style={{ ...homeSecondaryButtonStyle, fontSize: 12, padding: "10px 20px", textDecoration: "none", display: "inline-block" }}
          >
            {secondary.label}
          </a>
        )}
      </div>
    </div>
  );
}
