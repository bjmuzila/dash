/**
 * Seasonality · the S&P 500 almanac, in Voltick.
 *
 * A port of cbedge.net/explore/seasonality — the one page on that site that
 * gives a complete tool away to a signed-out visitor. It is here to answer one
 * question: what does CB Edge's single biggest public surface look like once it
 * is drawn in Voltick's system rather than its own?
 *
 * WHAT IS THE SAME. Everything the reader touches. Nineteen sections, the same
 * rail, the same charts, the same tables, the same copy, the same numbers.
 * SeasonalityView and SeasonalityAlmanac are byte-for-byte the CB Edge
 * components apart from their import paths: neither one was recoloured by hand.
 *
 * WHAT IS DIFFERENT. Two files:
 *   seasonality/homeTheme.ts   the palette, remapped onto Voltick tokens
 *   seasonality/seaTheme.ts    the surface ladder, ditto
 * Read those two to see the whole of the retheme. That is the point of keeping
 * the port a port — a change to the CB Edge originals drops straight in, and
 * the palette swap stays one file you can read in a minute.
 *
 * STATIC. seasonality/useLiveYear.ts has had its freshness call removed, so
 * nothing extends the current-year line and the page makes no request for it.
 * Every number here is compiled into seasonalityData.ts. What it shows today is
 * what it shows next month, which is what a reference copy should do.
 *
 * The page chrome below (masthead, the two CTA bands) is the shape the public
 * page carries, retyped in Voltick surfaces and type. The links leave for
 * cbedge.net as real navigations: there is no /pricing in this SPA, and a
 * client-side Link to one would land on NotFound.
 */
import {
  ACCENT,
  ACCENT_TEXT,
  ELEV,
  INK_ON_SURGE,
  LINE,
  MONO,
  PAPER,
  PAPER_DISPLAY,
  PAPER_QUIET,
  R_MD,
  R_PILL,
  SKY,
  W_BOLD,
  W_MED,
  rgba,
} from "../theme";
import SeasonalityView from "./seasonality/SeasonalityView";
import { ALMANAC } from "./seasonality/seasonalityData";

const START_YEAR = ALMANAC.meta.start.slice(0, 4);
const END_YEAR = ALMANAC.meta.end.slice(0, 4);
const SESSIONS = ALMANAC.meta.trading_days.toLocaleString("en-US");

export default function Seasonality() {
  return (
    <main
      style={{
        // Full bleed, no CONTENT_MAX. The rail plus pane layout wants the
        // width: a 1240px cap leaves the year x month heat grid scrolling
        // inside its own box on a display wide enough to show all of it. Same
        // call the public page makes, for the same reason.
        boxSizing: "border-box",
        width: "100%",
        minWidth: 0,
        padding: "24px 20px 72px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      {/* ═══ Masthead and the offer, ONE band ══════════════════════════════
          Compressed on purpose, the way the public page is: identity left, the
          offer right, the tool immediately under. A reader who scrolls past
          the thing they came for has been charged for chrome. */}
      <header
        style={{
          display: "grid",
          gap: "clamp(14px,2vw,26px)",
          gridTemplateColumns: "repeat(auto-fit,minmax(min(340px,100%),1fr))",
          alignItems: "center",
          padding: "clamp(14px,1.8vw,20px)",
          borderRadius: R_MD,
          border: `1px solid ${LINE}`,
          background: ELEV,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <span
            style={{
              display: "inline-block",
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: W_MED,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: ACCENT_TEXT,
              border: `1px solid ${rgba(ACCENT, 0.45)}`,
              background: rgba(ACCENT, 0.1),
              borderRadius: R_PILL,
              padding: "3px 10px",
            }}
          >
            Static copy · Voltick palette
          </span>
          <h1
            style={{
              margin: "10px 0 6px",
              fontSize: "clamp(22px,3vw,30px)",
              fontWeight: W_BOLD,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              color: PAPER_DISPLAY,
            }}
          >
            S&amp;P 500 Seasonality Almanac
          </h1>
          <p style={{ margin: 0, fontSize: 14, fontWeight: W_MED, color: SKY }}>
            {START_YEAR}&#8211;{END_YEAR} · {SESSIONS} sessions of SPX, recomputed from the raw daily
            closes
          </p>
        </div>

        <div
          style={{
            padding: "clamp(12px,1.6vw,16px)",
            borderRadius: R_MD,
            border: `1px solid ${LINE}`,
            background: rgba(PAPER, 0.045),
          }}
        >
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: PAPER, marginBottom: 10 }}>
            <b style={{ fontSize: 14.5 }}>This page is history. The dashboard is today.</b>
            <br />
            Live SPX gamma, flip levels and option flow sit on cbedge.net. This copy is the almanac
            only, frozen at its build.
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <a href="https://www.cbedge.net/explore/seasonality" style={ctaPrimary}>
              The live page &#8594;
            </a>
            <a href="https://www.cbedge.net/" style={ctaQuiet}>
              cbedge.net
            </a>
          </div>
        </div>
      </header>

      {/* ═══ The tool ═══════════════════════════════════════════════════════ */}
      <SeasonalityView />

      {/* ═══ Close ══════════════════════════════════════════════════════════ */}
      <section
        style={{
          marginTop: 4,
          padding: "clamp(16px,2vw,22px)",
          borderRadius: R_MD,
          border: `1px solid ${LINE}`,
          background: ELEV,
        }}
      >
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit,minmax(min(320px,100%),1fr))",
            alignItems: "center",
          }}
        >
          <div>
            <h2
              style={{
                margin: "0 0 6px",
                fontSize: "clamp(17px,2vw,21px)",
                fontWeight: W_BOLD,
                letterSpacing: "-0.01em",
                color: PAPER_DISPLAY,
              }}
            >
              Seasonality tells you the weather. It doesn&apos;t tell you the day.
            </h2>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: PAPER }}>
              A ninety-eight-year average is a weak prior about a distribution. Where price actually
              goes tomorrow needs the order flow.
            </p>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <a href="https://www.cbedge.net/explore/seasonality" style={ctaPrimary}>
              The live page &#8594;
            </a>
            <a href="/" style={ctaGhost}>
              Contents
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

/* ── the two button shapes, Voltick's ─────────────────────────────────────── */

const ctaPrimary = {
  display: "inline-block",
  padding: "11px 20px",
  borderRadius: R_MD,
  background: ACCENT,
  border: `1px solid ${ACCENT}`,
  // Ink on a filled accent, not PAPER: white type on Volt Blue at this size
  // vibrates. This is the token that exists for text sitting ON the accent.
  color: INK_ON_SURGE,
  fontSize: 13.5,
  fontWeight: W_BOLD,
  whiteSpace: "nowrap" as const,
};

const ctaGhost = {
  display: "inline-block",
  padding: "11px 18px",
  borderRadius: R_MD,
  border: `1px solid ${rgba(ACCENT, 0.45)}`,
  background: rgba(ACCENT, 0.1),
  color: ACCENT_TEXT,
  fontSize: 13.5,
  fontWeight: W_MED,
  whiteSpace: "nowrap" as const,
};

const ctaQuiet = {
  display: "inline-block",
  padding: "6px 2px",
  color: PAPER_QUIET,
  fontSize: 13.5,
  fontWeight: W_MED,
  textDecoration: "underline",
  textUnderlineOffset: 3,
};
