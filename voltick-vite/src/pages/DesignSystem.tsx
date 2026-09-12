/**
 * The design system, rendered from src/theme.ts rather than described. If a
 * token changes, this page changes with it, which is the only way a reference
 * page stays true.
 */
import type { CSSProperties, ReactNode } from "react";
import {
  ACCENT,
  ACCENT_TEXT,
  BP_MOBILE,
  BP_WIDE,
  CARD_SHADOW,
  CONTENT_MAX,
  ELEV,
  LINE,
  MONO,
  PANEL,
  PAPER,
  PAPER_DISPLAY,
  PAPER_QUIET,
  RAIL_W,
  RAIL_W_COLLAPSED,
  R_LG,
  R_MD,
  R_PILL,
  R_SM,
  SANS,
  W_BOLD,
  W_DATA,
  W_MED,
  W_REG,
  rgba,
} from "../theme";
import { Card, PageShell } from "../components/PageCard";

export default function DesignSystem() {
  return (
    <PageShell
      title="Design system"
      lede={
        <>
          Calm surfaces, loud data. A dark, dense, data-first terminal read by people looking at numbers all
          day, often on a phone, often in a hurry, frequently while the market is moving. Every value below
          comes from <Mono>src/theme.ts</Mono>.
        </>
      }
      maxWidth={1000}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <Card title="The non-negotiables" subtitle="Five rules. Breaking any of them is a defect, not a style disagreement.">
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 9, color: PAPER }}>
            <li>
              The reserved colours mean one thing each. A colour is a word in this product, and a test fails
              the build on a near-miss hex.
            </li>
            <li>No grey text, ever.</li>
            <li>
              No em-dashes in anything a user reads. Middle dot, comma, colon or parentheses. Code comments
              are exempt.
            </li>
            <li>
              Never buy, sell, signal, entry, target or prediction. The product describes mechanics and
              locations. It does not advise.
            </li>
            <li>Dark only. There is no light theme.</li>
          </ol>
        </Card>

        <Card title="Typography" subtitle="Every number is mono. A column of proportional digits does not line up, and this product is columns of digits.">
          <div style={{ display: "grid", gap: 16 }}>
            <Specimen label="Display · Inter 700 · PAPER_DISPLAY">
              <span style={{ fontFamily: SANS, fontSize: 26, fontWeight: W_BOLD, color: PAPER_DISPLAY }}>
                Dealer positioning across 1,000+ tickers
              </span>
            </Specimen>
            <Specimen label="Body · Inter 400 · PAPER">
              <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: W_REG, color: PAPER }}>
                Levels are sticky when hedging fights moves, slippery when hedging chases them.
              </span>
            </Specimen>
            <Specimen label="Quiet · Inter 400 · PAPER_QUIET">
              <span style={{ fontFamily: SANS, fontSize: 13, color: PAPER_QUIET }}>
                The caption under a number, and the units beside it.
              </span>
            </Specimen>
            <Specimen label="Hero number · JetBrains Mono 800 · W_DATA">
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 38,
                  fontWeight: W_DATA,
                  color: PAPER,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "-0.02em",
                }}
              >
                6,412.75
              </span>
            </Specimen>
            <Specimen label="Uppercase label · Mono 600 · .09em">
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  fontWeight: W_MED,
                  letterSpacing: "0.09em",
                  textTransform: "uppercase",
                  color: PAPER_QUIET,
                }}
              >
                Expected move · Put · Call
              </span>
            </Specimen>
          </div>
          <p style={{ margin: "16px 0 0", fontSize: 13, color: PAPER_QUIET }}>
            Weight 800 is reserved for a headline figure in mono. Prose never goes above 700.
          </p>
        </Card>

        <Card title="Shape and elevation" subtitle="Not everything is a card. Border, fill, radius and shadow each say 'separate object'. Spend them by role.">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <RadiusBox r={R_SM} name="R_SM" use="Chips, badges" />
            <RadiusBox r={R_MD} name="R_MD" use="Buttons, inputs, tiles" />
            <RadiusBox r={R_LG} name="R_LG" use="Cards, panels, modals" />
            <RadiusBox r={R_PILL} name="R_PILL" use="Fully round" />
          </div>
          <div
            style={{
              marginTop: 18,
              background: ELEV,
              border: `1px solid ${LINE}`,
              borderRadius: R_LG,
              boxShadow: CARD_SHADOW,
              padding: 16,
            }}
          >
            <div style={{ fontFamily: MONO, fontSize: 11, color: PAPER, letterSpacing: "0.06em" }}>
              CARD_SHADOW
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: PAPER_QUIET }}>
              The inset top highlight is doing real work. On surfaces this close in value, a 1px light line
              along the top edge is what separates a raised card from the panel behind it. Drop it and cards
              go flat.
            </div>
          </div>
        </Card>

        <Card title="The lit pill" subtitle="The house CTA. A dark face with a gradient rim and a soft halo.">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <button type="button" className="vk-pill">
              Open the board
            </button>
            <span style={{ fontSize: 13, color: PAPER_QUIET, maxWidth: 460 }}>
              Two backgrounds in one declaration: the face paints to the padding box, the aurora to the
              border box. The face must stay near opaque and dark, or the halo shines through and the pill
              renders as a solid blue slab.
            </span>
          </div>
        </Card>

        <Card title="Layout" subtitle="Two breakpoints, from the layout. Avoid inventing a third.">
          <div className="vk-xscroll">
            <table style={{ borderCollapse: "collapse", minWidth: 420, width: "100%" }}>
              <tbody>
                <TokenRow name="BP_MOBILE" value={`${BP_MOBILE}px`} note="Above it desktop, at or below mobile" />
                <TokenRow name="BP_WIDE" value={`${BP_WIDE}px`} note="Whether the board carries the inline watchlist row" />
                <TokenRow name="RAIL_W" value={`${RAIL_W}px`} note="Left rail expanded" />
                <TokenRow name="RAIL_W_COLLAPSED" value={`${RAIL_W_COLLAPSED}px`} note="Left rail collapsed to icons" />
                <TokenRow name="CONTENT_MAX" value={`${CONTENT_MAX}px`} note="Centred content container" />
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="The aurora" subtitle="A shared static gradient sky. It is what stops a dark product reading as a black rectangle.">
          <div className="vk-aurora vk-aurora-panel" style={{ borderRadius: R_MD, border: `1px solid ${LINE}`, padding: 18, background: PANEL }}>
            <div style={{ fontFamily: MONO, fontSize: 11, color: ACCENT_TEXT, letterSpacing: "0.06em" }}>
              .vk-aurora-panel
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: PAPER_QUIET }}>
              Every variant's height is pinned in pixels. Percentage heights drift on a tall page: the sky
              stretches until its gradient stops fall outside the viewport and it draws nothing at all,
              unnoticed. <Mono>isolation: isolate</Mono> is load bearing, because the bloom is a z-index -1
              pseudo-element and without a stacking context it paints behind its own parent's background.
            </div>
          </div>
          <div className="vk-aurora vk-aurora-band" style={{ marginTop: 12, borderRadius: R_MD, border: `1px solid ${LINE}`, padding: 18, background: PANEL }}>
            <div style={{ fontFamily: MONO, fontSize: 11, color: ACCENT_TEXT, letterSpacing: "0.06em" }}>
              .vk-aurora-band
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: PAPER_QUIET }}>Pinned to 240px.</div>
          </div>
        </Card>

        <Card title="Motion" subtitle="One thing moves at a time.">
          <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8, color: PAPER_QUIET }}>
            <li>The hero CTA breathes. Nothing around it does.</li>
            <li>Nothing strobes, and nothing cycles faster than about 1.5Hz.</li>
            <li>
              <Mono>prefers-reduced-motion</Mono> parks every animation on a composed still frame, not on
              opacity zero.
            </li>
            <li>
              Everything meant to be read is visible at rest. A page whose content depends on script is a
              page that shows nothing when script fails.
            </li>
          </ul>
        </Card>

        <Card title="Accessibility" subtitle="Contrast is measured, not eyeballed.">
          <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8, color: PAPER_QUIET }}>
            <li>PAPER ~14.5:1, PAPER_QUIET 10.76:1 on panel.</li>
            <li>
              Keyboard focus always has a visible state. Hover and focus cannot be inline styles in React,
              so they live in <Mono>index.css</Mono>.
            </li>
            <li>Every illustration carries a real desc describing what it shows.</li>
            <li>Touch targets 44px minimum.</li>
          </ul>
        </Card>
      </div>
    </PageShell>
  );
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: W_MED,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: ACCENT_TEXT,
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function RadiusBox({ r, name, use }: { r: number; name: string; use: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          width: 92,
          height: 62,
          borderRadius: r,
          background: ELEV,
          border: `1px solid ${rgba(ACCENT, 0.5)}`,
        }}
        aria-hidden
      />
      <div style={{ marginTop: 7, fontFamily: MONO, fontSize: 11, color: PAPER, fontVariantNumeric: "tabular-nums" }}>
        {name} · {r}
      </div>
      <div style={{ fontSize: 11, color: PAPER_QUIET }}>{use}</div>
    </div>
  );
}

function TokenRow({ name, value, note }: { name: string; value: string; note: string }) {
  const td: CSSProperties = { padding: "9px 14px 9px 0", borderBottom: `1px solid ${LINE}`, fontSize: 13 };
  return (
    <tr>
      <td style={{ ...td, fontFamily: MONO, color: PAPER, whiteSpace: "nowrap" }}>{name}</td>
      <td style={{ ...td, fontFamily: MONO, color: ACCENT_TEXT, fontVariantNumeric: "tabular-nums" }}>{value}</td>
      <td style={{ ...td, color: PAPER_QUIET }}>{note}</td>
    </tr>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span style={{ fontFamily: MONO, color: PAPER }}>{children}</span>;
}
