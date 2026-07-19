import Link from "next/link";
import { notFound } from "next/navigation";
import { HOME_THEME as T } from "@/components/shared/homeTheme";
import { EXPLORE, EXPLORE_SLUGS, type TeaserStat } from "@/components/explore/exploreContent";
import { ICT_CONCEPTS } from "@/components/explore/ictGlossary";
import PublicNav from "@/components/landing/PublicNav";
import NetDriftExample from "@/components/explore/NetDriftExample";

// Public marketing page for one feature. Linked from the landing-page cards.
// Sells the feature with copy + a frozen static teaser, then drives to
// /pricing?from=<slug> (the single conversion hub). Signed-out friendly.

// ISR: the confidence-score page carries a real last-7-session tracker whose
// data layer is cached per ET day, so it settles to fresh numbers once at EOD.
export const revalidate = 21600;

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
      className="explore-root"
      style={{
        // Bare LayoutShell wrapper is overflow:hidden — own the scroll here so the
        // fixed toolbar's reserved top padding doesn't get clipped.
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        background: T.bg,
        backgroundImage: T.shellGlow,
        color: T.text,
        fontFamily: "var(--font-inter),'Inter','Helvetica Neue',Arial,sans-serif",
      }}
    >
      {/* Shared public toolbar — fixed, same spot on every public page. */}
      <PublicNav active="Features" />

      <main
        style={{
          maxWidth: 920,
          margin: "0 auto",
          // PublicNav is sticky and reserves its own height — no compensation here.
          paddingTop: "clamp(28px,5vw,64px)",
          paddingLeft: "clamp(16px,4vw,40px)",
          paddingRight: "clamp(16px,4vw,40px)",
          paddingBottom: 80,
        }}
      >
        <div style={badge}>{entry.title}</div>

        <h1 style={{ fontSize: "clamp(30px,5vw,46px)", fontWeight: 800, margin: "16px 0 10px", lineHeight: 1.1 }}>
          {entry.title}
        </h1>
        <p style={{ color: T.cyan, fontSize: "clamp(15px,2.5vw,19px)", fontWeight: 600, margin: "0 0 24px" }}>
          {entry.tagline}
        </p>

        {/* No demo mode — the 2-day free trial IS the demo. Send them straight in. */}
        <div style={demoBlock}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Link href={`/pricing?from=${entry.slug}&trial=1`} style={demoBtn}>
              START MY 2-DAY FREE TRIAL ›
            </Link>
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 14, color: T.muted, opacity: 0.75 }}>
            Two days of the full live dashboard — every ticker, every tool. Cancel anytime.
          </p>
        </div>

        <div style={{ display: "grid", gap: "clamp(24px,4vw,48px)", gridTemplateColumns: "minmax(0,1fr)" }}>
          {/* Body + highlights */}
          <section>
            {entry.body.map((p, i) => (
              <p key={i} style={{ color: T.muted, fontSize: 17, lineHeight: 1.65, margin: "0 0 16px" }}>
                {p}
              </p>
            ))}

            <ul style={{ listStyle: "none", padding: 0, margin: "20px 0 0", display: "grid", gap: 10 }}>
              {entry.highlights.map((h) => (
                <li key={h} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14 }}>
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
            <p style={{ color: T.muted, fontSize: 12, margin: "14px 0 0", lineHeight: 1.4 }}>
              Illustrative sample. Live data is available inside the dashboard for members.
            </p>
          </section>
        </div>

        {/* Worked Net Drift chart (flow only) */}
        {slug === "flow" && <NetDriftExample />}

        {/* Auto-charted & auto-graded concept list (ict only) */}
        {slug === "ict" && <IctGlossary />}

        {/* Join Now CTA → single pricing hub */}
        <div style={ctaBlock}>
          <h2 style={{ fontSize: "clamp(22px,4vw,30px)", fontWeight: 800, margin: "0 0 8px" }}>
            Get full access
          </h2>
          <p style={{ color: T.muted, fontSize: 14, margin: "0 0 22px", maxWidth: 520 }}>
            Join CB Edge for live {entry.title.toLowerCase()} plus the full dashboard — GEX, flow, estimated moves and more.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href={`/pricing?from=${entry.slug}&trial=1`} style={joinBtn}>
              Start my 2-day free trial ›
            </Link>
          </div>
        </div>

        {/* Other features */}
        <div style={{ marginTop: 56, borderTop: `1px solid ${T.border}`, paddingTop: 28 }}>
          <div style={{ fontSize: 14, color: T.muted, marginBottom: 14, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
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

/* ── ICT glossary (all the info from the live /ict page) ──────────────────── */

function IctGlossary() {
  const liveCount = ICT_CONCEPTS.filter((c) => c.live).length;
  return (
    <section style={{ marginTop: "clamp(36px,6vw,56px)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h2 style={{ fontSize: "clamp(20px,3.5vw,28px)", fontWeight: 800, margin: 0 }}>
          Auto-charted &amp; auto-graded concepts
        </h2>
        <span style={{ fontSize: 14, color: T.text }}>{liveCount} of {ICT_CONCEPTS.length} auto-charted</span>
      </div>
      <p style={{ color: T.text, fontSize: 14, lineHeight: 1.6, margin: "0 0 22px", maxWidth: 700 }}>
        You draw nothing. Every concept below is detected and <strong>auto-charted</strong> on the live ES &amp; NQ 5-minute
        feed as it forms, then <strong>auto-graded</strong> once the session resolves it — so each setup carries its own
        outcome instead of a hindsight mark-up. An{" "}
        <span style={{ color: T.green, fontWeight: 700 }}>Auto</span> tag means it&apos;s charted and graded for you in real time.
      </p>
      <div style={glossaryGrid}>
        {ICT_CONCEPTS.map((c) => (
          <div key={c.id} style={glossaryCard}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{c.name}</span>
              {c.live && <span style={liveChip}>Auto</span>}
            </div>
            <p style={{ color: T.text, fontSize: 14, lineHeight: 1.55, margin: 0 }}>{c.body}</p>
            <a href={c.href} target="_blank" rel="noopener noreferrer" style={glossaryLink}>Learn more ↗</a>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */

const badge: React.CSSProperties = {
  display: "inline-block",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: T.cyan,
  border: "1px solid rgba(33,158,188,0.3)",
  background: "rgba(33,158,188,0.08)",
  padding: "5px 12px",
  borderRadius: 999,
};

const demoBlock: React.CSSProperties = {
  marginBottom: 32,
  padding: "20px 22px",
  borderRadius: 16,
  border: "1px solid rgba(33,158,188,0.3)",
  background: "linear-gradient(180deg, rgba(33,158,188,0.10), rgba(33,158,188,0.03))",
};

const demoBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "14px 24px",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 900,
  letterSpacing: "0.04em",
  color: "#fff",
  textDecoration: "none",
  background: "linear-gradient(180deg, #2CB6D6, #1A7D9B)",
  border: "1px solid rgba(140,222,244,0.55)",
  boxShadow: "0 12px 32px rgba(33,158,188,0.32)",
};

const teaserCard: React.CSSProperties = {
  background: "linear-gradient(180deg, rgba(33,158,188,0.04), rgba(255,255,255,0.02))",
  border: "1px solid rgba(33,158,188,0.12)",
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
  fontSize: 10,
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
  border: "1px solid rgba(33,158,188,0.14)",
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
  fontSize: 14,
  fontWeight: 800,
  textDecoration: "none",
  cursor: "pointer",
};

const otherLink: React.CSSProperties = {
  display: "inline-block",
  padding: "9px 16px",
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  background: "rgba(255,255,255,0.03)",
  color: T.text,
  fontSize: 14,
  fontWeight: 700,
  textDecoration: "none",
};

const legalFooter: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  flexWrap: "wrap",
  padding: "20px 16px calc(20px + env(safe-area-inset-bottom, 0px))",
  fontSize: 12,
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

const glossaryGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))",
  gap: 12,
  alignItems: "start",
};

const glossaryCard: React.CSSProperties = {
  background: "linear-gradient(180deg, rgba(33,158,188,0.04), rgba(255,255,255,0.02))",
  border: `1px solid ${T.border}`,
  borderRadius: 14,
  padding: 16,
};

const liveChip: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: T.green,
  border: "1px solid rgba(48,209,88,0.3)",
  background: "rgba(48,209,88,0.08)",
  borderRadius: 999,
  padding: "2px 7px",
};

const glossaryLink: React.CSSProperties = {
  display: "inline-block",
  marginTop: 10,
  fontSize: 12,
  fontWeight: 700,
  color: T.cyan,
  textDecoration: "none",
};
