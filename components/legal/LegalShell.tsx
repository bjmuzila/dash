import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

// Shared chrome for the public legal pages (/terms, /risk-disclosure,
// /privacy, /disclaimer). These render full-bleed (no dashboard sidebar) via
// BARE_ROUTES in LayoutShell and are public via middleware, so visitors can
// read them before signing in. Styling mirrors HOME_THEME / the landing card.

const T = {
  bg: "#05060A",
  panel: "#0D1119",
  cyan: "#219EBC",
  muted: "#8B94A7",
  text: "#FFFFFF",
  border: "rgba(255,255,255,0.10)",
};

const LEGAL_LINKS: { href: string; label: string }[] = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/risk-disclosure", label: "Risk Disclosure" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/disclaimer", label: "Disclaimer" },
];

const shell: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  background:
    "radial-gradient(circle at top, rgba(33,158,188,0.06), transparent 42%), #05060A",
  color: T.text,
  fontFamily: "var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif",
};

const inner: CSSProperties = {
  maxWidth: 860,
  margin: "0 auto",
  padding: "clamp(20px, 4vw, 48px) clamp(16px, 4vw, 24px) 64px",
};

const card: CSSProperties = {
  border: "1px solid rgba(33,158,188,0.14)",
  borderRadius: 18,
  background: "linear-gradient(180deg, rgba(13,17,25,0.78), rgba(7,9,14,0.86))",
  boxShadow: "0 24px 70px rgba(0,0,0,0.5)",
  padding: "clamp(20px, 3.5vw, 40px)",
};

export default function LegalShell({
  title,
  subtitle,
  lastUpdated,
  currentPath,
  children,
}: {
  title: string;
  subtitle?: string;
  lastUpdated: string;
  currentPath: string;
  children: ReactNode;
}) {
  return (
    <div style={shell}>
      <div style={inner}>
        {/* Top bar: logo + back to home */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 28,
            flexWrap: "wrap",
          }}
        >
          <Link href="/" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/cb-edge-logo.png" alt="CB Edge" style={{ height: 34, width: "auto", display: "block" }} />
          </Link>
          <Link
            href="/"
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: T.cyan,
              textDecoration: "none",
              border: "1px solid rgba(33,158,188,0.28)",
              background: "rgba(33,158,188,0.06)",
              borderRadius: 8,
              padding: "7px 14px",
            }}
          >
            ← Back to site
          </Link>
        </div>

        <div style={card}>
          <div
            style={{
              fontSize: 11,
              color: T.muted,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              fontWeight: 800,
              marginBottom: 8,
            }}
          >
            CB Edge · Legal
          </div>
          <h1 style={{ fontSize: "clamp(24px, 4vw, 32px)", lineHeight: 1.12, margin: "0 0 10px", fontWeight: 800 }}>
            {title}
          </h1>
          {subtitle && (
            <p style={{ margin: "0 0 6px", fontSize: 14, color: "#B7C2D2", lineHeight: 1.5 }}>{subtitle}</p>
          )}
          <p style={{ margin: "0 0 4px", fontSize: 12.5, color: T.muted }}>
            Last updated: <span style={{ color: T.cyan, fontWeight: 600 }}>{lastUpdated}</span>
          </p>

          <div
            style={{
              height: 1,
              background: "linear-gradient(90deg, rgba(33,158,188,0.4), transparent)",
              margin: "20px 0 24px",
            }}
          />

          {/* Page body */}
          <div className="legal-body">{children}</div>
        </div>

        {/* Cross-links to the other legal pages */}
        <div
          style={{
            marginTop: 26,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {LEGAL_LINKS.map((l) => {
            const active = l.href === currentPath;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: "none",
                  color: active ? T.cyan : T.muted,
                  border: `1px solid ${active ? "rgba(33,158,188,0.4)" : T.border}`,
                  background: active ? "rgba(33,158,188,0.08)" : "rgba(255,255,255,0.02)",
                  borderRadius: 999,
                  padding: "6px 14px",
                }}
              >
                {l.label}
              </Link>
            );
          })}
        </div>

        <p style={{ marginTop: 22, textAlign: "center", fontSize: 11.5, color: T.muted, lineHeight: 1.6 }}>
          © {new Date().getFullYear()} CB Edge. All rights reserved. · cbedge.net
        </p>
      </div>

      {/* Shared typography for legal body content */}
      <style>{`
        .legal-body { font-size: 14.5px; line-height: 1.72; color: #D4DCE7; }
        .legal-body h2 {
          font-size: 18px; font-weight: 800; color: #FFFFFF;
          margin: 30px 0 10px; letter-spacing: 0.01em;
        }
        .legal-body h2:first-child { margin-top: 0; }
        .legal-body h3 {
          font-size: 15px; font-weight: 700; color: #EAF1F8; margin: 20px 0 6px;
        }
        .legal-body p { margin: 0 0 12px; }
        .legal-body ul, .legal-body ol { margin: 0 0 14px; padding-left: 22px; }
        .legal-body li { margin: 0 0 7px; }
        .legal-body strong { color: #FFFFFF; font-weight: 700; }
        .legal-body a { color: #219EBC; text-decoration: none; }
        .legal-body a:hover { text-decoration: underline; }
        .legal-body .lead {
          font-size: 13px; color: #8B94A7; background: rgba(33,158,188,0.04);
          border: 1px solid rgba(33,158,188,0.12); border-radius: 10px;
          padding: 12px 14px; margin: 0 0 22px; line-height: 1.6;
        }
        .legal-body .callout {
          border-left: 3px solid #FB8501; background: rgba(249,115,22,0.06);
          border-radius: 0 10px 10px 0; padding: 12px 16px; margin: 0 0 18px;
          color: #F4D9C4; font-size: 13.5px; line-height: 1.65;
        }
        .legal-body .callout strong { color: #FFD9BC; }
      `}</style>
    </div>
  );
}
