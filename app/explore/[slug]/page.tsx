import Link from "next/link";
import { notFound } from "next/navigation";
import {
  V3,
  V3_MONO,
  V3_RADIUS,
  V3_SANS,
  V3_TEXT,
  v3Chip,
} from "@/components/landing/v3Theme";
import { EXPLORE, EXPLORE_SLUGS, type ExploreExample, type TeaserStat } from "@/components/explore/exploreContent";
import PublicNav from "@/components/landing/PublicNav";
import NetDriftExample from "@/components/explore/NetDriftExample";
import Confidence7dTracker from "@/components/explore/Confidence7dTracker";
import DelayedLiveView from "@/components/explore/DelayedLiveView";

// Public marketing page for one feature. Linked from the landing-page cards.
// Sells the feature with copy + a frozen static teaser + a delayed-LIVE real
// data view, then drives to /pricing?from=<slug> (the single conversion hub).
// Signed-out friendly.
//
// ── 2026-09-05 ───────────────────────────────────────────────────────────────
// • v3 THEME. Surfaces, radii and type come from components/landing/v3Theme.ts,
//   which transcribes cbedge-v3/src/design/tokens.css (the Next tree cannot
//   import from that app — see that file's header). Flat #0f1117 plates with
//   #23272e hairlines; no gradients, no cyan bloom. Every colour literal this
//   file used to type inline ("rgba(33,158,188,0.3)", "#2CB6D6", "#04121a") is
//   gone; do not add another.
// • WHITE TEXT. v3's --color-fg / --color-muted / --color-faint are all
//   #ffffff. Body copy that used to render in T.muted now renders in V3.fg and
//   nothing on the page carries a text `opacity`.
// • THE ICT GLOSSARY IS GONE, with the /explore/ict page. `ICT_CONCEPTS` and
//   the IctGlossary component it fed were the only readers of
//   components/explore/ictGlossary.ts, which is now unreferenced. /explore/tpo
//   went the same way — the scanner dropped that tab on 2026-09-03, so the page
//   was selling a screen that no longer exists. Both slugs now 404 through the
//   notFound() below, which is the correct answer for a page that was removed.
//
// Render at REQUEST time — do not prerender. The Docker build stage has no
// .env.local (secrets are mounted at runtime), so DATABASE_URL is undefined
// during `next build`: every delayed-live query throws and the "populates at
// the end of each trading day" empty state gets baked into the prerendered
// HTML and served to visitors forever. The DB only exists at runtime.
// Cost is bounded: each fetcher in DelayedLiveView is unstable_cache'd for
// 15 min and Confidence7dTracker is cached per ET day — one DB round-trip per
// window, not per visitor.
export const dynamic = "force-dynamic";

const toneColor: Record<NonNullable<TeaserStat["tone"]>, string> = {
  cyan: V3.levelCw,
  green: V3.up,
  red: V3.down,
  purple: V3.violet,
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
        background: V3.bg,
        color: V3.fg,
        fontFamily: V3_SANS,
      }}
    >
      {/* Shared public toolbar — same band on every public page. */}
      <PublicNav active="Features" />

      <main
        style={{
          maxWidth: 920,
          margin: "0 auto",
          // PublicNav is sticky and reserves its own height — no compensation here.
          paddingTop: "clamp(28px,5vw,56px)",
          paddingLeft: "clamp(16px,4vw,40px)",
          paddingRight: "clamp(16px,4vw,40px)",
          paddingBottom: 80,
        }}
      >
        <span style={v3Chip(V3.cyan)}>{entry.title}</span>

        <h1 style={{ fontSize: "clamp(28px,4.6vw,42px)", fontWeight: 800, margin: "16px 0 10px", lineHeight: 1.1, letterSpacing: "-0.03em" }}>
          {entry.title}
        </h1>
        <p style={{ color: V3.cyan, fontSize: "clamp(15px,2.4vw,18px)", fontWeight: 600, margin: "0 0 24px" }}>
          {entry.tagline}
        </p>

        {/* No demo mode — the 2-day free trial IS the demo. Send them straight in. */}
        <div style={demoBlock}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Link href={`/pricing?from=${entry.slug}&trial=1`} style={demoBtn}>
              START MY 2-DAY FREE TRIAL ›
            </Link>
          </div>
          <p style={{ margin: "12px 0 0", fontSize: V3_TEXT.body, color: V3.fg }}>
            Two days of the full live dashboard — every ticker, every tool. Cancel anytime.
          </p>
        </div>

        <div style={{ display: "grid", gap: "clamp(20px,3.4vw,36px)", gridTemplateColumns: "minmax(0,1fr)" }}>
          {/* Body + highlights */}
          <section>
            {entry.body.map((p, i) => (
              <p key={i} style={{ color: V3.fg, fontSize: 16, lineHeight: 1.7, margin: "0 0 16px" }}>
                {p}
              </p>
            ))}

            <ul style={{ listStyle: "none", padding: 0, margin: "20px 0 0", display: "grid", gap: 10 }}>
              {entry.highlights.map((h) => (
                <li key={h} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: V3_TEXT.body }}>
                  <span style={{ color: V3.cyan, fontWeight: 800, lineHeight: 1.5 }}>✓</span>
                  <span style={{ color: V3.fg }}>{h}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Static teaser preview */}
          <section style={teaserCard}>
            <div style={teaserHead}>
              <span style={{ fontSize: V3_TEXT.xs, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: V3.fg }}>
                {entry.teaserLabel}
              </span>
              <span style={previewTag}>Preview · sample data</span>
            </div>
            <div style={{ padding: "clamp(14px,2.4vw,20px)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {entry.teaserStats.map((s) => (
                  <div key={s.label} style={statCell}>
                    <div style={{ color: V3.fg, fontSize: V3_TEXT.base, marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontSize: V3_TEXT.xl, fontWeight: 700, color: s.tone ? toneColor[s.tone] : V3.fg }}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ color: V3.fg, fontSize: V3_TEXT.base, margin: "14px 0 0", lineHeight: 1.5 }}>
                Illustrative sample. Live data is available inside the dashboard for members.
              </p>
            </div>
          </section>
        </div>

        {/* THE REAL BOARDS, transcribed. Only the two scanner pages carry these
            today — see ExploreExample in exploreContent.ts for why they are
            tables and not screenshots. */}
        {entry.examples?.map((ex) => <ExampleBoard key={ex.title} ex={ex} />)}

        {/* Delayed-LIVE real-data view (gex, estimated-moves, initial-balance).
            flow + confidence-score render their own richer live blocks below. */}
        <DelayedLiveView slug={slug} />

        {/* Worked Net Drift chart (flow only) */}
        {slug === "flow" && <NetDriftExample />}

        {/* Real last-7-session CB accuracy tracker (confidence-score only) */}
        {slug === "confidence-score" && <Confidence7dTracker />}

        {/* Join Now CTA → single pricing hub. Call to arms: stakes, one action,
            risk reversal — no second competing button. */}
        <div style={ctaBlock}>
          <div style={ctaKicker}>2-DAY FREE TRIAL · NO CHARGE UP FRONT</div>
          <h2 style={{ fontSize: "clamp(22px,4vw,32px)", fontWeight: 800, margin: "0 0 10px", lineHeight: 1.15, letterSpacing: "-0.03em" }}>
            Stop trading blind. See it live for two days.
          </h2>
          <p style={{ color: V3.fg, fontSize: V3_TEXT.body, margin: "0 0 22px", maxWidth: 560, lineHeight: 1.65 }}>
            The preview above is real — just delayed. Your trial unlocks the live, tick-by-tick {entry.title.toLowerCase()}
            {" "}<strong style={{ color: V3.fg }}>plus the entire dashboard</strong>: GEX, flow, premarket prep, estimated moves,
            IB stats and both scanners. Full access, nothing held back.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Link href={`/pricing?from=${entry.slug}&trial=1`} style={joinBtn}>
              Start my 2-day free trial ›
            </Link>
            <span style={{ color: V3.fg, fontSize: V3_TEXT.base }}>Cancel anytime · no charge up front</span>
          </div>
        </div>

        {/* Other features — framed as "all of this is in your trial", not a passive menu */}
        <div style={{ marginTop: 48, borderTop: `1px solid ${V3.line}`, paddingTop: 26 }}>
          <div style={{ fontSize: V3_TEXT.body, color: V3.fg, marginBottom: 14, fontWeight: 700, letterSpacing: "0.04em" }}>
            Your trial unlocks all of these — live
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

/* ── the transcribed board ────────────────────────────────────────────────── */

/**
 * Grades and statuses are the two columns that carry meaning in COLOUR on the
 * real screen, so they carry it here too. Everything else is white — see the v3
 * THEME note above.
 *
 * Matched on the leading token, not on equality: the watch board's status cell
 * is "TOUCHED 2026-09-03", a value with a date glued to it.
 */
function pillTone(v: string): string {
  const t = v.trim().toUpperCase();
  if (t.startsWith("A")) return V3.up;
  if (t.startsWith("B") || t.startsWith("C")) return V3.warn;
  if (t.startsWith("D") || t.startsWith("F")) return V3.down;
  if (t.startsWith("TOUCHED")) return V3.up;
  if (t.startsWith("OPEN")) return V3.levelCw;
  if (t.startsWith("EXPIRED")) return V3.flat;
  return V3.fg;
}

function ExampleBoard({ ex }: { ex: ExploreExample }) {
  const numeric = new Set(ex.numeric ?? []);
  const pills = new Set(ex.pills ?? []);
  return (
    <section style={boardCard}>
      <div style={boardHead}>
        <span style={{ fontSize: V3_TEXT.base, fontWeight: 600, color: V3.fg }}>{ex.title}</span>
        <span style={previewTag}>From the live page</span>
      </div>

      {ex.note && (
        <p style={{ margin: 0, padding: "12px 14px 0", color: V3.fg, fontSize: V3_TEXT.body, lineHeight: 1.6 }}>
          {ex.note}
        </p>
      )}

      {/* The board's own header strip. Wraps rather than scrolls — these are
          short pairs and a scrolling summary hides the count that matters. */}
      {ex.summary && (
        <div style={summaryStrip}>
          {ex.summary.map((kv) => (
            <span key={kv.k} style={summaryChip}>
              <span style={{ fontFamily: V3_MONO, fontSize: V3_TEXT.xs, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {kv.k}
              </span>
              <b style={{ fontWeight: 700 }}>{kv.v}</b>
            </span>
          ))}
        </div>
      )}

      {/* Twelve columns do not fit a phone and never will. The table scrolls
          inside its own box so the PAGE never scrolls sideways. */}
      <div style={{ overflowX: "auto", padding: "12px 14px 0" }}>
        <table style={boardTable}>
          <thead>
            <tr>
              {ex.columns.map((c, i) => (
                <th key={c} style={{ ...boardTh, textAlign: numeric.has(i) ? "right" : "left" }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ex.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      ...boardTd,
                      textAlign: numeric.has(ci) ? "right" : "left",
                      fontFamily: numeric.has(ci) ? V3_MONO : undefined,
                      fontWeight: ci === 0 && !pills.has(0) ? 700 : undefined,
                      whiteSpace: numeric.has(ci) || ci === 0 ? "nowrap" : undefined,
                    }}
                  >
                    {pills.has(ci) ? <span style={v3Chip(pillTone(cell))}>{cell}</span> : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ex.footnote && (
        <p style={{ margin: 0, padding: "12px 14px 14px", color: V3.fg, fontSize: V3_TEXT.base, lineHeight: 1.6 }}>
          {ex.footnote}
        </p>
      )}
    </section>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */
/* Colours: V3 only. No literal may appear below — see the header note. */

const boardCard: React.CSSProperties = {
  marginTop: "clamp(20px,3.4vw,32px)",
  background: V3.surface,
  border: `1px solid ${V3.line}`,
  borderRadius: V3_RADIUS.md,
  overflow: "hidden",
};

const boardHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
  padding: "10px 14px",
  borderBottom: `1px solid ${V3.line}`,
  background: V3.surface2,
};

const summaryStrip: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  padding: "12px 14px 0",
};

const summaryChip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: 7,
  padding: "5px 10px",
  borderRadius: V3_RADIUS.sm,
  border: `1px solid ${V3.line}`,
  background: V3.surface2,
  color: V3.fg,
  fontSize: V3_TEXT.base,
};

const boardTable: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: V3_TEXT.base,
};

const boardTh: React.CSSProperties = {
  fontFamily: V3_MONO,
  fontSize: V3_TEXT.xs,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: V3.fg,
  padding: "8px 10px",
  borderBottom: `1px solid ${V3.line}`,
  whiteSpace: "nowrap",
};

const boardTd: React.CSSProperties = {
  padding: "9px 10px",
  borderBottom: `1px solid ${V3.line}`,
  color: V3.fg,
  verticalAlign: "top",
};

const demoBlock: React.CSSProperties = {
  marginBottom: 28,
  padding: "18px 20px",
  borderRadius: V3_RADIUS.md,
  border: `1px solid ${V3.line}`,
  background: V3.surface,
};

const demoBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "13px 22px",
  borderRadius: V3_RADIUS.md,
  fontSize: V3_TEXT.base,
  fontWeight: 700,
  letterSpacing: "0.05em",
  color: V3.fg,
  textDecoration: "none",
  background: V3.cyan,
  border: `1px solid ${V3.cyan}`,
};

const teaserCard: React.CSSProperties = {
  background: V3.surface,
  border: `1px solid ${V3.line}`,
  borderRadius: V3_RADIUS.md,
  overflow: "hidden",
};

const teaserHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
  padding: "10px 14px",
  borderBottom: `1px solid ${V3.line}`,
  background: V3.surface2,
};

const previewTag: React.CSSProperties = {
  fontSize: V3_TEXT.xs,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: V3.fg,
  border: `1px solid ${V3.line}`,
  borderRadius: V3_RADIUS.sm,
  padding: "3px 9px",
};

const statCell: React.CSSProperties = {
  background: V3.surface2,
  border: `1px solid ${V3.line}`,
  borderRadius: V3_RADIUS.sm,
  padding: 14,
};

const ctaBlock: React.CSSProperties = {
  marginTop: "clamp(32px,5vw,56px)",
  background: V3.surface,
  border: `1px solid ${V3.line}`,
  borderRadius: V3_RADIUS.md,
  padding: "clamp(22px,3.6vw,36px)",
};

const ctaKicker: React.CSSProperties = {
  display: "inline-block",
  fontSize: V3_TEXT.xs,
  fontWeight: 700,
  letterSpacing: "0.12em",
  color: V3.cyan,
  marginBottom: 14,
  fontFamily: V3_MONO,
};

const joinBtn: React.CSSProperties = {
  display: "inline-block",
  padding: "13px 26px",
  borderRadius: V3_RADIUS.md,
  border: `1px solid ${V3.cyan}`,
  background: V3.cyan,
  color: V3.fg,
  fontSize: V3_TEXT.base,
  fontWeight: 700,
  textDecoration: "none",
  cursor: "pointer",
};

const otherLink: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 14px",
  borderRadius: V3_RADIUS.md,
  border: `1px solid ${V3.line}`,
  background: V3.surface2,
  color: V3.fg,
  fontSize: V3_TEXT.base,
  fontWeight: 600,
  textDecoration: "none",
};

const legalFooter: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  flexWrap: "wrap",
  padding: "20px 16px calc(20px + env(safe-area-inset-bottom, 0px))",
  fontSize: V3_TEXT.base,
  color: V3.fg,
  borderTop: `1px solid ${V3.line}`,
};

const legalLink: React.CSSProperties = {
  color: V3.fg,
  textDecoration: "none",
  fontWeight: 600,
  letterSpacing: "0.02em",
};

const legalDot: React.CSSProperties = { color: V3.fg };
