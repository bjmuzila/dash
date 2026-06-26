import Link from "next/link";
import { notFound } from "next/navigation";
import { SignInButton } from "@clerk/nextjs";
import { HOME_THEME as T } from "@/components/shared/homeTheme";
import { EXPLORE, EXPLORE_SLUGS, type TeaserStat } from "@/components/explore/exploreContent";

// Public marketing page for one feature. Linked from the landing-page cards.
// Sells the feature with copy + a frozen static teaser, then drives to
// /pricing?from=<slug> (the single conversion hub). Signed-out friendly.

export const dynamic = "force-static";

export function generateStaticParams() {
  return EXPLORE_SLUGS.map((slug) => ({ slug }));
}

const toneColor: Record<NonNullable<TeaserStat["tone"]>, string> = {
  cyan: T.cyan,
  green: T.green,
  red: T.red,
  purple: T.purple,
};

export default async function ExplorePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entry = EXPLORE[slug];
  if (!entry) notFound();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg,
        backgroundImage: T.shellGlow,
        color: T.text,
        fontFamily: "'Inter','Helvetica Neue',Arial,sans-serif",
      }}
    >
      {/* Top bar */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px clamp(16px,4vw,40px)",
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <Link href="/" style={{ color: T.muted, textDecoration: "none", fontSize: 13, fontWeight: 700 }}>
          ← Back
        </Link>
        <SignInButton forceRedirectUrl="/home">
          <button style={topSignInBtn}>Sign in</button>
        </SignInButton>
      </header>

      <main
        style={{
          maxWidth: 920,
          margin: "0 auto",
          padding: "clamp(28px,5vw,64px) clamp(16px,4vw,40px) 80px",
        }}
      >
        <div style={badge}>{entry.title}</div>

        <h1 style={{ fontSize: "clamp(30px,5vw,46px)", fontWeight: 800, margin: "16px 0 10px", lineHeight: 1.1 }}>
          {entry.title}
        </h1>
        <p style={{ color: T.cyan, fontSize: "clamp(15px,2.5vw,19px)", fontWeight: 600, margin: "0 0 28px" }}>
          {entry.tagline}
        </p>

        <div style={{ display: "grid", gap: "clamp(24px,4vw,48px)", gridTemplateColumns: "minmax(0,1fr)" }}>
          {/* Body + highlights */}
          <section>
            {entry.body.map((p, i) => (
              <p key={i} style={{ color: T.muted, fontSize: 16, lineHeight: 1.65, margin: "0 0 16px" }}>
                {p}
              </p>
            ))}

            <ul style={{ listStyle: "none", padding: 0, margin: "20px 0 0", display: "grid", gap: 10 }}>
              {entry.highlights.map((h) => (
                <li key={h} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 15 }}>
                  <span style={{ color: T.cyan, fontWeight: 800, lineHeight: 1.5 }}>✓</span>
                  <span style={{ color: T.text }}>{h}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Static teaser preview */}
          <section style={teaserCard}>
            <div style={teaserHead}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted }}>
                {entry.teaserLabel}
              </span>
              <span style={previewTag}>Preview · sample data</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {entry.teaserStats.map((s) => (
                <div key={s.label} style={statCell}>
                  <div style={{ color: T.muted, fontSize: 12, marginBottom: 6 }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: s.tone ? toneColor[s.tone] : T.text }}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
            <p style={{ color: T.muted, fontSize: 11.5, margin: "14px 0 0", lineHeight: 1.4 }}>
              Illustrative sample. Live data is available inside the dashboard for members.
            </p>
          </section>
        </div>

        {/* Join Now CTA → single pricing hub */}
        <div style={ctaBlock}>
          <h2 style={{ fontSize: "clamp(22px,4vw,30px)", fontWeight: 800, margin: "0 0 8px" }}>
            Get full access
          </h2>
          <p style={{ color: T.muted, fontSize: 15, margin: "0 0 22px", maxWidth: 520 }}>
            Join CB Edge for live {entry.title.toLowerCase()} plus the full dashboard — GEX, flow, estimated moves and more.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href={`/pricing?from=${entry.slug}`} style={joinBtn}>
              Join now
            </Link>
            <SignInButton forceRedirectUrl="/home">
              <button style={memberBtn}>Already a member? Sign in</button>
            </SignInButton>
          </div>
        </div>

        {/* Other features */}
        <div style={{ marginTop: 56, borderTop: `1px solid ${T.border}`, paddingTop: 28 }}>
          <div style={{ fontSize: 13, color: T.muted, marginBottom: 14, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Explore more
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {EXPLORE_SLUGS.filter((s) => s !== entry.slug).map((s) => (
              <Link key={s} href={`/explore/${s}`} style={otherLink}>
                {EXPLORE[s].title}
              </Link>
            ))}
          </div>
        </div>
      </main>

      <footer style={legalFooter}>
        <Link href="/terms" style={legalLink}>Terms</Link>
        <span style={legalDot}>·</span>
        <Link href="/risk-disclosure" style={legalLink}>Risk Disclosure</Link>
        <span style={legalDot}>·</span>
        <Link href="/privacy" style={legalLink}>Privacy</Link>
        <span style={legalDot}>·</span>
        <Link href="/disclaimer" style={legalLink}>Disclaimer</Link>
      </footer>
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */

const badge: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: T.cyan,
  border: "1px solid rgba(0,240,255,0.3)",
  background: "rgba(0,240,255,0.08)",
  padding: "5px 12px",
  borderRadius: 999,
};

const teaserCard: React.CSSProperties = {
  background: "linear-gradient(180deg, rgba(0,240,255,0.04), rgba(255,255,255,0.02))",
  border: "1px solid rgba(0,240,255,0.12)",
  borderRadius: 16,
  padding: "clamp(16px,3vw,24px)",
};

const teaserHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
  marginBottom: 16,
};

const previewTag: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: T.muted,
  border: `1px solid ${T.border}`,
  borderRadius: 999,
  padding: "3px 9px",
};

const statCell: React.CSSProperties = {
  background: "rgba(0,0,0,0.3)",
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  padding: 14,
};

const ctaBlock: React.CSSProperties = {
  marginTop: "clamp(36px,6vw,64px)",
  background: "linear-gradient(180deg, rgba(13,17,25,0.78), rgba(7,9,14,0.86))",
  border: "1px solid rgba(0,240,255,0.14)",
  borderRadius: 20,
  padding: "clamp(24px,4vw,40px)",
};

const joinBtn: React.CSSProperties = {
  display: "inline-block",
  padding: "14px 28px",
  borderRadius: 10,
  border: "none",
  background: `linear-gradient(180deg, ${T.cyan}, #00b8c4)`,
  color: "#04121a",
  fontSize: 15,
  fontWeight: 800,
  textDecoration: "none",
  cursor: "pointer",
};

const memberBtn: React.CSSProperties = {
  padding: "14px 22px",
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  background: "rgba(255,255,255,0.03)",
  color: T.text,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const otherLink: React.CSSProperties = {
  display: "inline-block",
  padding: "9px 16px",
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  background: "rgba(255,255,255,0.03)",
  color: T.text,
  fontSize: 13,
  fontWeight: 700,
  textDecoration: "none",
};

const topSignInBtn: React.CSSProperties = {
  padding: "9px 18px",
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  background: "rgba(13,17,25,0.7)",
  color: T.text,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const legalFooter: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  flexWrap: "wrap",
  padding: "20px 16px calc(20px + env(safe-area-inset-bottom, 0px))",
  fontSize: 11.5,
  color: T.muted,
  borderTop: `1px solid ${T.border}`,
};

const legalLink: React.CSSProperties = {
  color: T.muted,
  textDecoration: "none",
  fontWeight: 600,
  letterSpacing: "0.02em",
};

const legalDot: React.CSSProperties = { color: "rgba(139,148,167,0.5)" };
