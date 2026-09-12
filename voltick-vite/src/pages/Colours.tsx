/**
 * The colour vocabulary, drawn from the tokens rather than described. A member
 * learns these in the first session and then reads the whole product by colour,
 * so using one for anything else does not look slightly wrong, it says
 * something false.
 */
import type { CSSProperties, ReactNode } from "react";
import {
  ACCENT,
  ACCENT_TEXT,
  COIL,
  COIL_MARK,
  ELEV,
  FLIP,
  FLIP_MARK,
  GOOD,
  BAD,
  INK,
  INK_ON_REVERSAL,
  INK_ON_SURGE,
  INK_ON_VOLT,
  LINE,
  MONO,
  PANEL,
  PAPER,
  PAPER_DISPLAY,
  PAPER_QUIET,
  PREMARKET,
  REVERSAL,
  REVERSAL_MARK,
  R_MD,
  SKY,
  SURGE,
  SURGE_MARK,
  VOLT,
  VOLT_MARK,
  WALL_MARK,
  rgba,
} from "../theme";
import { Card, Chip, PageShell } from "../components/PageCard";

type Row = { hex: string; mark?: string; name: string; means: string; mayBeUsedFor: string };

const RESERVED: Row[] = [
  { hex: VOLT, mark: VOLT_MARK, name: "The Volt", means: "The strongest level on a board", mayBeUsedFor: "The Volt, and nothing else" },
  { hex: FLIP, mark: FLIP_MARK, name: "The gamma flip", means: "Where the sign of gamma changes", mayBeUsedFor: "The flip, and nothing else" },
  { hex: REVERSAL, mark: REVERSAL_MARK, name: "A Reversal", means: "A reversal level", mayBeUsedFor: "Reversals, and nothing else" },
  { hex: SURGE, mark: `${SURGE_MARK} ${WALL_MARK}`, name: "Surge and walls", means: "Surges and walls", mayBeUsedFor: "Surges and walls" },
  { hex: COIL, mark: COIL_MARK, name: "The Coil", means: "The coil (same hex as ACCENT)", mayBeUsedFor: "The coil, and accent chrome" },
  { hex: PREMARKET, name: "Pre-market", means: "Pre-market state", mayBeUsedFor: "Pre-market state" },
];

export default function Colours() {
  return (
    <PageShell
      title="Colour vocabulary"
      lede={
        <>
          A colour is a word in this product. Each reserved hex means exactly one thing, and a near-miss is
          worse than a reuse: <Mono>#141a20</Mono> instead of <Mono>#141a21</Mono> shipped across 45 usages
          once. Always import the token.
        </>
      }
      maxWidth={1000}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <Card title="Reserved" subtitle="Vocabulary, not decoration. Read this twice.">
          <div className="vk-xscroll">
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr>
                  {["Swatch", "Hex", "Mark", "Means", "May be used for"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "0 12px 10px 0",
                        fontFamily: MONO,
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.09em",
                        textTransform: "uppercase",
                        color: PAPER_QUIET,
                        borderBottom: `1px solid ${LINE}`,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RESERVED.map((r) => (
                  <tr key={r.hex + r.name}>
                    <td style={cell}>
                      <span
                        aria-hidden
                        style={{
                          display: "inline-block",
                          width: 34,
                          height: 20,
                          borderRadius: 5,
                          background: r.hex,
                          border: `1px solid ${LINE}`,
                        }}
                      />
                    </td>
                    <td style={{ ...cell, fontFamily: MONO, color: r.hex, fontVariantNumeric: "tabular-nums" }}>
                      {r.hex}
                    </td>
                    <td style={{ ...cell, fontFamily: MONO, fontSize: 15, color: r.hex }}>{r.mark ?? "·"}</td>
                    <td style={{ ...cell, color: PAPER }}>{r.means}</td>
                    <td style={{ ...cell, color: PAPER_QUIET }}>{r.mayBeUsedFor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
            <Chip mark={VOLT_MARK} label="Volt" value="772" colour={VOLT} />
            <Chip mark={WALL_MARK} label="Walls" value="748/784" colour={SURGE} />
            <Chip mark={FLIP_MARK} label="Flip" value="760" colour={FLIP} />
            <Chip mark={REVERSAL_MARK} label="Reversal" value="741" colour={REVERSAL} />
            <Chip mark={COIL_MARK} label="Coil" value="766" colour={COIL} />
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 12, color: PAPER_QUIET }}>
            Example data only, not a live quote.
          </p>
        </Card>

        <Card title="Filled rows" subtitle="Text sitting ON a reserved fill takes its own ink.">
          <div style={{ display: "grid", gap: 8 }}>
            <FillRow bg={VOLT} ink={INK_ON_VOLT} label={`${VOLT_MARK} Volt row`} ink_name="#1a1404" />
            <FillRow bg={SURGE} ink={INK_ON_SURGE} label={`${WALL_MARK} Wall row`} ink_name="#071026" />
            <FillRow bg={REVERSAL} ink={INK_ON_REVERSAL} label={`${REVERSAL_MARK} Reversal row`} ink_name="#36081d" />
          </div>
        </Card>

        <Card title="Two traps" subtitle="Both have already cost time.">
          <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 10, color: PAPER }}>
            <li>
              <strong>Near-misses are worse than reuse.</strong>{" "}
              <span style={{ color: PAPER_QUIET }}>
                The reserved-colour test fails the build on a hand-minted hex. Import the token.
              </span>
            </li>
            <li>
              <strong>The flip glyph must be FLIP_MARK</strong>{" "}
              <span style={{ color: PAPER_QUIET }}>
                (<Mono>⚡</Mono> plus U+FE0E). A bare bolt defaults to emoji presentation, the system font
                paints it orange and discards your colour, and orange is the Volt's reserved colour: a bare
                bolt silently draws the flip in the Volt's colour.
              </span>
            </li>
          </ul>
        </Card>

        <Card title="Brand and semantic" subtitle="ACCENT is chrome. ACCENT_TEXT is the accent when it has to be a word.">
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
            <Swatch hex={ACCENT} name="ACCENT" note="Fills, borders, rings, glows. Not words." />
            <Swatch hex={ACCENT_TEXT} name="ACCENT_TEXT" note="The accent, when it is text." />
            <Swatch hex={SKY} name="SKY" note="Gradients, highlights, fine lines." />
            <Swatch hex={GOOD} name="GOOD" note="Support, positive, live. Data only." />
            <Swatch hex={BAD} name="BAD" note="Danger, negative. Data only." />
          </div>
          <p style={{ margin: "14px 0 0", fontSize: 13, color: PAPER_QUIET, maxWidth: 640 }}>
            Green and red carry P&amp;L meaning on a trading screen, so they never appear as UI chrome, a
            success toast or a hover state. A control that needs to say "this worked" says it in Paper with
            Volt Blue chrome.
          </p>
        </Card>

        <Card title="Surfaces and text" subtitle="Close together on purpose. Depth is a hairline and a shadow, not a jump in lightness.">
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
            <Swatch hex={INK} name="INK" note="Page background." />
            <Swatch hex={PANEL} name="PANEL" note="Bars, panels, chrome." />
            <Swatch hex={ELEV} name="ELEV" note="A raised card." />
            <Swatch hex={LINE} name="LINE" note="Hairlines. Never heavier than 1px." />
            <Swatch hex={PAPER} name="PAPER" note="All body text. ~14.5:1 on Ink." />
            <Swatch hex={PAPER_DISPLAY} name="PAPER_DISPLAY" note="16px+ bold headlines only." />
            <Swatch hex={PAPER_QUIET} name="PAPER_QUIET" note="Units, captions. 10.76:1." />
          </div>
          <p style={{ margin: "14px 0 0", fontSize: 13, color: PAPER_QUIET, maxWidth: 640 }}>
            There is no grey text in this product. The three Paper values are not a ramp: they are one
            colour, optically corrected for three contexts. Secondary information is expressed through size,
            weight, spacing and position.
          </p>
        </Card>
      </div>
    </PageShell>
  );
}

const cell: CSSProperties = {
  padding: "10px 12px 10px 0",
  borderBottom: `1px solid ${LINE}`,
  fontSize: 13,
  verticalAlign: "middle",
};

function FillRow({ bg, ink, label, ink_name }: { bg: string; ink: string; label: string; ink_name: string }) {
  return (
    <div
      style={{
        background: bg,
        color: ink,
        borderRadius: R_MD,
        padding: "11px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontFamily: MONO,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.05em",
      }}
    >
      <span>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{ink_name}</span>
    </div>
  );
}

function Swatch({ hex, name, note }: { hex: string; name: string; note: string }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: R_MD, overflow: "hidden" }}>
      <div style={{ height: 40, background: hex }} aria-hidden />
      <div style={{ padding: "9px 11px", background: rgba(ACCENT, 0.04) }}>
        <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: PAPER }}>{name}</div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: PAPER_QUIET, fontVariantNumeric: "tabular-nums" }}>
          {hex}
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: PAPER_QUIET }}>{note}</div>
      </div>
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span style={{ fontFamily: MONO, color: PAPER }}>{children}</span>;
}
