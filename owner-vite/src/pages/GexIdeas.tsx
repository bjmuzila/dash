// Owner "ΔGEX Ideas" — the design doc for the interpretation layer proposed on
// top of the ΔGEX Board (/owner/gex-growth).
//
// THIS PAGE IS A MOCKUP. Every number on it is invented and nothing here fetches
// anything. It exists so the proposal can be READ AT THE SIZE IT WILL SHIP —
// a static HTML file in a folder loses its argument the moment the folder is
// tidied, and a screenshot cannot be measured against the real rail beside it.
//
// WHY IT IS A REACT PAGE AND NOT A .html IN public/. Two reasons, and the second
// is the one that matters:
//   1. AGENTS.md: the live UI is React .tsx under a page module. A loose .html
//      is dead-code territory by that document's own rule of thumb.
//   2. AUTH. owner-vite is gated by <AuthGate> in App.jsx, which is React inside
//      index.html. nginx `try_files $uri` serves a static file BEFORE any of
//      that runs, so `owner-vite/public/anything.html` is world-readable to
//      whoever has the URL. (The Next side is the same story from the other
//      direction: middleware.ts's matcher explicitly excludes `\.html?`.) As a
//      route it inherits the owner gate like every other page here.
//
// STYLING. The section shells are the shared <Card>, so this page ages with the
// rest of the app. The dense internals (tables, chips, the flip track) are
// class-based off ONE <style> block below rather than a few hundred inline
// objects — but every colour in that block is interpolated from HOME_THEME, so
// there is still no hardcoded hex outside the two GEX polarity constants, which
// are the same pair GexGrowth.tsx pins and for the same reason.
//
// WHEN A MODULE SHIPS, DELETE ITS SECTION HERE. This page is a proposal, not a
// second source of truth — a "design doc" that outlives the thing it designed is
// how two descriptions of one feature start disagreeing.

import { HOME_THEME, LIGHT_BLUE, rgba } from "../lib/theme";
import { PageShell, Card } from "../components/PageCard";

const T = HOME_THEME;
// The app's GEX polarity pair — same values, same reason as GexGrowth.tsx: a
// trader reads +GEX green / −GEX red everywhere else in this app, and the owner
// status palette would read as "ok / error" instead of "long / short gamma".
const POS = "#22C55E";
const NEG = "#EF4444";

const CSS = `
.gxi { font-size: 14px; line-height: 1.5; color: ${T.text}; }
.gxi .mono { font-family: var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.gxi .pos { color: ${POS}; }
.gxi .neg { color: ${NEG}; }
.gxi .lb  { color: ${LIGHT_BLUE}; }
.gxi .gd  { color: ${T.gold}; }
.gxi .lbl {
  font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
}

/* Explanatory footer under each module. Inset panel, no accent edge. */
.gxi .note {
  margin-top: 14px; padding: 10px 12px; border: 1px solid ${T.border};
  border-radius: 12px; background: ${T.panelInset}; font-size: 12px; line-height: 1.55;
}
.gxi .note b { color: ${LIGHT_BLUE}; }
.gxi .cost {
  display: inline-block; font-size: 9.5px; font-weight: 800; letter-spacing: .08em;
  text-transform: uppercase; padding: 2px 8px; border-radius: 999px;
  border: 1px solid ${T.border}; margin-right: 6px; vertical-align: 2px;
}
.gxi .cost.free { color: ${POS}; border-color: ${rgba(POS, .35)}; background: ${rgba(POS, .10)}; }
.gxi .cost.work { color: ${T.gold}; border-color: ${rgba(T.gold, .35)}; background: ${rgba(T.gold, .10)}; }

/* Module 1 — regime */
.gxi .regime { display: grid; grid-template-columns: auto 1fr; gap: 18px; align-items: center; }
.gxi .verdict {
  display: flex; flex-direction: column; gap: 2px; padding: 12px 16px; border-radius: 14px;
  border: 1px solid ${rgba(POS, .30)}; background: ${rgba(POS, .08)}; min-width: 210px;
}
.gxi .verdict .big {
  font-family: var(--font-mono), ui-monospace, monospace; font-size: 26px; font-weight: 800;
}
.gxi .rstats { display: flex; gap: 10px; flex-wrap: wrap; }
.gxi .stat {
  border: 1px solid ${T.border}; border-radius: 12px; padding: 8px 14px;
  background: ${T.panelInset}; min-width: 128px;
}
.gxi .stat .v {
  font-family: var(--font-mono), ui-monospace, monospace; font-size: 17px;
  font-weight: 800; display: block; margin-top: 2px;
}

/* Module 2 — walls */
.gxi .walls { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.gxi .wall {
  border: 1px solid ${T.border}; border-radius: 14px; padding: 14px; background: ${T.panelInset};
}
.gxi .wallhead {
  display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 8px;
}
.gxi .strike { font-family: var(--font-mono), ui-monospace, monospace; font-size: 22px; font-weight: 800; }
.gxi .chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px;
  font-size: 10.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
  border: 1px solid ${T.border}; white-space: nowrap;
}
.gxi .chip.build { color: ${POS}; border-color: ${rgba(POS, .38)}; background: ${rgba(POS, .11)}; }
.gxi .chip.erode { color: ${NEG}; border-color: ${rgba(NEG, .38)}; background: ${rgba(NEG, .11)}; }
.gxi .chip.warn  { color: ${T.gold}; border-color: ${rgba(T.gold, .38)}; background: ${rgba(T.gold, .11)}; }
.gxi .chip.flat  { color: ${T.text}; background: rgba(255,255,255,0.05); }
/* Prior level as an outline, current as a fill — the same encoding the compare
   ladder uses, so the two read the same way. */
.gxi .prog {
  height: 8px; border-radius: 4px; background: rgba(255,255,255,0.07);
  overflow: hidden; margin: 10px 0 4px; position: relative;
}
.gxi .prog span { display: block; height: 100%; border-radius: 4px; }
.gxi .prog .ghost {
  position: absolute; top: 0; left: 0; height: 100%; border-radius: 4px;
  border: 1px solid currentColor; background: transparent;
}
.gxi .action { font-size: 12px; line-height: 1.5; margin-top: 8px; }

/* Module 3 — flip */
.gxi .flip { display: grid; grid-template-columns: 1fr auto; gap: 20px; align-items: center; }
.gxi .fliptrack {
  position: relative; height: 82px; border: 1px solid ${T.border};
  border-radius: 12px; background: ${T.panelInset}; overflow: hidden;
}
.gxi .fliptrack .zone { position: absolute; top: 0; bottom: 0; }
.gxi .marker { position: absolute; top: 0; bottom: 0; width: 2px; }
.gxi .mlabel {
  position: absolute; font-size: 10px; font-weight: 800; white-space: nowrap;
  transform: translateX(-50%);
}

/* Module 4 — ranked table */
.gxi table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.gxi th {
  text-align: left; font-size: 10px; font-weight: 800; letter-spacing: .1em;
  text-transform: uppercase; padding: 0 8px 7px; border-bottom: 1px solid ${T.border};
}
.gxi td {
  padding: 7px 8px; border-bottom: 1px solid rgba(255,255,255,0.05);
  font-family: var(--font-mono), ui-monospace, monospace;
}
.gxi tbody tr:hover td { background: ${rgba(LIGHT_BLUE, .06)}; }
.gxi td.tagcell { font-family: inherit; }
/* Bars run out from a centre rail — sign is carried by SIDE as well as colour,
   because green/red alone fails deuteran separation (ΔE 7.4, measured). */
.gxi .bar { display: flex; align-items: center; height: 14px; }
.gxi .bar .l, .gxi .bar .r { flex: 1; display: flex; }
.gxi .bar .l { justify-content: flex-end; }
.gxi .bar i { display: block; height: 9px; border-radius: 4px; }
.gxi .bar .rail { width: 1px; background: ${T.border}; height: 16px; margin: 0 3px; flex: none; }
.gxi tr.spotrow td {
  background: ${rgba(T.cyan, .09)};
  border-top: 1px solid ${rgba(T.cyan, .45)};
  border-bottom: 1px solid ${rgba(T.cyan, .45)};
}

/* Module 5 — rail */
.gxi .rail-demo {
  border: 1px solid ${T.border}; border-radius: 14px; overflow: hidden;
  max-width: 330px; align-self: start;
}
.gxi .rrow {
  display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center;
  padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.05);
}
.gxi .rrow.on { background: ${rgba(LIGHT_BLUE, .12)}; box-shadow: inset 2px 0 0 ${LIGHT_BLUE}; }
.gxi .rrow .sym { font-size: 13px; font-weight: 800; }
.gxi .minitag {
  font-size: 9px; font-weight: 800; letter-spacing: .05em; padding: 1px 6px;
  border-radius: 999px; border: 1px solid ${T.border}; white-space: nowrap;
}

.gxi .cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
.gxi ul.tight { margin: 8px 0 0; padding-left: 18px; font-size: 12.5px; line-height: 1.65; }
.gxi ul.tight li { margin-bottom: 5px; }
.gxi .kbd {
  font-family: var(--font-mono), ui-monospace, monospace; font-size: 11px; padding: 1px 6px;
  border: 1px solid ${T.border}; border-radius: 6px; background: ${T.panelInset};
}
.gxi hr.sep { border: none; border-top: 1px solid ${T.border}; margin: 12px 0; }

@media (max-width: 900px) {
  .gxi .walls, .gxi .cols2 { grid-template-columns: 1fr !important; }
  .gxi .flip, .gxi .regime { grid-template-columns: 1fr !important; }
}
`;

export default function GexIdeas() {
  return (
    <PageShell>
      <style>{CSS}</style>
      <div className="gxi" style={{ display: "flex", flexDirection: "column", gap: "clamp(16px, 2vw, 32px)" }}>

        <Card
          variant="budget"
          title="ΔGEX Board — proposed interpretation layer"
          subtitle="Mockup · every number below is invented · SPX shown at 6452 · nothing here is wired"
        >
          <p style={{ fontSize: 13, margin: 0 }}>
            The board today reports <b className="lb">what changed</b>. Every module below turns that into{" "}
            <b className="lb">what it means</b> — and all but two need <i>no new data</i>, because{" "}
            <span className="mono">/api/eod-strike-gex-change</span> already returns{" "}
            <span className="mono">netGex</span>, <span className="mono">prevNetGex</span> and{" "}
            <span className="mono">chg</span> on every strike, plus spot.
          </p>
          <div className="note">
            <span className="cost free">no new data</span>
            derivable client-side from the payload <span className="mono">GexGrowth.tsx</span> already fetches.
            <br />
            <span className="cost work">schema change</span>
            needs a recorder, query or table change before it can render.
          </div>
        </Card>

        {/* ── 1 · REGIME ────────────────────────────────────────────────── */}
        <Card
          variant="budget"
          title="1 · Regime verdict strip"
          subtitle="Sits above the ladder — because the same Δ means opposite things in opposite regimes"
        >
          <div className="regime">
            <div className="verdict">
              <span className="lbl">Regime</span>
              <span className="big pos">+2.41B</span>
              <span style={{ fontSize: 12, fontWeight: 700 }}>POSITIVE · weakening</span>
              <span style={{ fontSize: 11.5, marginTop: 4 }}>
                Lean mean-reversion. Tighter targets, premium-selling bias.
              </span>
            </div>
            <div className="rstats">
              <div className="stat"><span className="lbl">Net GEX</span><span className="v pos">+2.41B</span></div>
              <div className="stat"><span className="lbl">Prior close</span><span className="v pos">+3.88B</span></div>
              <div className="stat"><span className="lbl">Δ net</span><span className="v neg">−1.47B</span></div>
              <div className="stat"><span className="lbl">Δ / |total GEX|</span><span className="v neg">−37.9%</span></div>
              <div className="stat"><span className="lbl">Spot</span><span className="v">6452</span></div>
            </div>
          </div>
          <div className="note">
            <b>Why.</b> A reader currently has to hold the regime in their head while reading a Δ. This states it.
            <br />
            <b>Computes as</b> <span className="mono">Σ netGex</span> (sign → regime),{" "}
            <span className="mono">Σ prevNetGex</span>, and the Δ normalised by{" "}
            <span className="mono">Σ|netGex|</span> — because −1.47B means nothing until you know it is 38% of the book.
            <br />
            <b>Wording table</b> keyed on (regime sign × Δ sign), the same pattern as{" "}
            <span className="mono">MODE_COPY</span>, so a label can never drift from its number.
            <div style={{ marginTop: 8 }}><span className="cost free">no new data</span></div>
          </div>
        </Card>

        {/* ── 2 · WALLS ─────────────────────────────────────────────────── */}
        <Card
          variant="budget"
          title="2 · Wall status — building vs eroding"
          subtitle="The two strikes that matter, with a state and an instruction instead of a number"
        >
          <div className="walls">
            <div className="wall">
              <div className="wallhead">
                <div>
                  <span className="lbl" style={{ display: "block" }}>Call wall · +98 pts</span>
                  <span className="strike">6500</span>
                </div>
                <span className="chip erode">▼ Eroding</span>
              </div>
              <div className="prog">
                <span className="ghost" style={{ width: "100%", color: POS }} />
                <span style={{ width: "69%", background: POS }} />
              </div>
              <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span>prior <span className="pos">+1.48B</span></span>
                <span>now <span className="pos">+1.02B</span></span>
                <span>Δ <span className="neg">−462M · −31%</span></span>
              </div>
              <div className="action">
                Wall lost about a third of its gamma overnight. <b className="lb">Breakouts more likely</b> —
                reduce fade size, or flip to momentum if price arrives on volume.
              </div>
            </div>

            <div className="wall">
              <div className="wallhead">
                <div>
                  <span className="lbl" style={{ display: "block" }}>Put wall · −102 pts</span>
                  <span className="strike">6350</span>
                </div>
                <span className="chip warn">▼ Weakening</span>
              </div>
              <div className="prog">
                <span className="ghost" style={{ width: "61%", color: NEG }} />
                <span style={{ width: "100%", background: NEG }} />
              </div>
              <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span>prior <span className="neg">−540M</span></span>
                <span>now <span className="neg">−880M</span></span>
                <span>Δ <span className="neg">−340M · −63%</span></span>
              </div>
              <div className="action">
                More short gamma piled on under price. Treat a test of 6350 as a{" "}
                <b className="lb">continuation setup, not a bounce</b>.
              </div>
            </div>
          </div>
          <div className="note">
            <b>Note the two cards say opposite things from the same sign.</b> Both Δs are negative; one weakens a
            ceiling, one weakens a floor. That is exactly the ambiguity the <span className="mono">compare</span>{" "}
            tab exists to resolve — this states the resolution in words.
            <br />
            <b>Computes as</b> call wall = <span className="mono">argmax(netGex)</span> above spot, put wall ={" "}
            <span className="mono">argmin(netGex)</span> below. State chip from{" "}
            <span className="mono">chg / |prevNetGex|</span> against two thresholds (say ±15% / ±40%).
            <br />
            <b>Colour is never alone</b> — every card carries a word and a glyph, because green/red fails deuteran
            separation at ΔE 7.4 (measured, same as the ladder&apos;s note).
            <div style={{ marginTop: 8 }}><span className="cost free">no new data</span></div>
          </div>
        </Card>

        {/* ── 3 · FLIP ──────────────────────────────────────────────────── */}
        <Card
          variant="budget"
          title="3 · Gamma flip migration"
          subtitle="Where the zero-crossing moved overnight — often bigger news than any single wall"
        >
          <div className="flip">
            <div className="fliptrack">
              <div className="zone" style={{ left: 0, width: "46%", background: `linear-gradient(90deg, ${rgba(NEG, .20)}, ${rgba(NEG, .06)})` }} />
              <div className="zone" style={{ left: "46%", right: 0, background: `linear-gradient(90deg, ${rgba(POS, .06)}, ${rgba(POS, .18)})` }} />
              <div className="marker" style={{ left: "31%", background: "rgba(255,255,255,0.35)" }} />
              <div className="mlabel" style={{ left: "31%", top: 8 }}>flip yest · 6396</div>
              <div className="marker" style={{ left: "46%", background: T.gold, boxShadow: `0 0 10px ${rgba(T.gold, .5)}` }} />
              <div className="mlabel gd" style={{ left: "46%", top: 30 }}>flip today · 6431</div>
              <div className="marker" style={{ left: "74%", background: T.cyan }} />
              <div className="mlabel" style={{ left: "74%", top: 8, color: T.cyan }}>spot 6452</div>
              <div className="mlabel neg" style={{ left: 12, bottom: 8, transform: "none" }}>◀ short gamma</div>
              <div className="mlabel pos" style={{ right: 10, bottom: 8, transform: "none" }}>long gamma ▶</div>
            </div>
            <div style={{ minWidth: 190 }}>
              <span className="lbl">Flip moved</span>
              <div className="mono gd" style={{ fontSize: 24, fontWeight: 800 }}>+35 pts</div>
              <div style={{ fontSize: 11.5, marginTop: 2 }}>6396 → 6431 · <b className="gd">7 strikes</b></div>
              <hr className="sep" />
              <span className="lbl">Cushion to flip</span>
              <div className="mono" style={{ fontSize: 20, fontWeight: 800 }}>21 pts</div>
              <div style={{ fontSize: 11.5, marginTop: 2 }}>was 56 · <span className="neg">−63% room</span></div>
            </div>
          </div>
          <div className="note">
            <b>The number that matters is the cushion, not the flip.</b> Spot is now 21 points above the crossing
            instead of 56 — one bad hour and the book is short gamma.
            <br />
            <b>Computes as</b> the sign change in cumulative <span className="mono">netGex</span> walking the ladder,
            interpolated between the two straddling strikes, run twice (once on <span className="mono">netGex</span>,
            once on <span className="mono">prevNetGex</span>).
            <br />
            <b className="gd">One decision outstanding:</b> the framework this came from reads{" "}
            <i>&ldquo;flip rising → more of the book below spot is supportive&rdquo;</i>, which is the opposite of the
            convention drawn here (flip rising toward spot = the short-gamma zone climbing = cushion thinning). Both
            conventions are in use. Pick one and it becomes a single constant — better than baking in the wrong one
            silently.
            <div style={{ marginTop: 8 }}><span className="cost free">no new data</span></div>
          </div>
        </Card>

        {/* ── 4 · RANKED ────────────────────────────────────────────────── */}
        <Card
          variant="budget"
          title="4 · Ranked ΔGEX, normalised and tagged"
          subtitle="The morning pass — top changes near the money, biggest first, each one named"
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, fontSize: 11.5 }}>
            <span className="chip flat">Band: ±3%</span>
            <span className="chip flat" style={{ opacity: .5 }}>±5%</span>
            <span className="chip flat" style={{ opacity: .5 }}>whole ladder</span>
            <span style={{ flex: 1 }} />
            <span className="chip flat" style={{ opacity: .5 }}>Top 5</span>
            <span className="chip flat">Top 10</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Strike</th><th>Dist</th><th style={{ width: 180 }}>Δ</th>
                <th style={{ textAlign: "right" }}>Δ value</th>
                <th style={{ textAlign: "right" }}>% of |GEX|</th>
                <th style={{ textAlign: "right" }}>Prior → now</th>
                <th>Read</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>6500</td><td className="lb">+0.7%</td>
                <td><span className="bar"><span className="l"><i style={{ width: "82%", background: NEG }} /></span><span className="rail" /><span className="r" /></span></td>
                <td style={{ textAlign: "right" }} className="neg">−462M</td>
                <td style={{ textAlign: "right" }} className="neg">−11.9%</td>
                <td style={{ textAlign: "right" }}><span className="pos">+1.48B</span> → <span className="pos">+1.02B</span></td>
                <td className="tagcell"><span className="chip erode" style={{ fontSize: 9.5 }}>Eroding wall</span></td>
              </tr>
              <tr>
                <td>6350</td><td className="lb">−1.6%</td>
                <td><span className="bar"><span className="l"><i style={{ width: "60%", background: NEG }} /></span><span className="rail" /><span className="r" /></span></td>
                <td style={{ textAlign: "right" }} className="neg">−340M</td>
                <td style={{ textAlign: "right" }} className="neg">−8.8%</td>
                <td style={{ textAlign: "right" }}><span className="neg">−540M</span> → <span className="neg">−880M</span></td>
                <td className="tagcell"><span className="chip warn" style={{ fontSize: 9.5 }}>Accel zone</span></td>
              </tr>
              <tr>
                <td>6475</td><td className="lb">+0.4%</td>
                <td><span className="bar"><span className="l" /><span className="rail" /><span className="r"><i style={{ width: "55%", background: POS }} /></span></span></td>
                <td style={{ textAlign: "right" }} className="pos">+310M</td>
                <td style={{ textAlign: "right" }} className="pos">+8.0%</td>
                <td style={{ textAlign: "right" }}>+21M → <span className="pos">+331M</span></td>
                <td className="tagcell"><span className="chip build" style={{ fontSize: 9.5 }}>New magnet</span></td>
              </tr>
              <tr className="spotrow">
                <td>6450 ◀</td><td className="lb">spot</td>
                <td><span className="bar"><span className="l"><i style={{ width: "31%", background: NEG }} /></span><span className="rail" /><span className="r" /></span></td>
                <td style={{ textAlign: "right" }} className="neg">−175M</td>
                <td style={{ textAlign: "right" }} className="neg">−4.5%</td>
                <td style={{ textAlign: "right" }}><span className="pos">+88M</span> → <span className="neg">−87M</span></td>
                <td className="tagcell"><span className="chip warn" style={{ fontSize: 9.5 }}>⚑ Sign flip</span></td>
              </tr>
              <tr>
                <td>6425</td><td className="lb">−0.4%</td>
                <td><span className="bar"><span className="l" /><span className="rail" /><span className="r"><i style={{ width: "26%", background: POS }} /></span></span></td>
                <td style={{ textAlign: "right" }} className="pos">+147M</td>
                <td style={{ textAlign: "right" }} className="pos">+3.8%</td>
                <td style={{ textAlign: "right" }}><span className="neg">−92M</span> → <span className="pos">+55M</span></td>
                <td className="tagcell"><span className="chip build" style={{ fontSize: 9.5 }}>⚑ Sign flip</span></td>
              </tr>
            </tbody>
          </table>
          <div className="note">
            <b>Three things the ladder can&apos;t do today.</b>
            <ul className="tight">
              <li>
                <b className="lb">Normalisation.</b> <span className="mono">chg / Σ|netGex|</span> — the raw dollar
                change is not comparable across names. −462M on SPX and −462M on SMCI are not the same event.
              </li>
              <li>
                <b className="lb">A near-the-money band.</b> The ladder is ±40 strikes; the read wants ±3–5%. A band
                toggle is a filter over rows you already have.
              </li>
              <li>
                <b className="lb">Sign flips ranked to the top.</b> A strike crossing zero overnight is high-priority
                even when its dollar Δ is mid-table — 6450 above is the fourth-largest change on the board and the
                most important line on it.
              </li>
            </ul>
            <b>Tag rules</b> are four cheap predicates on{" "}
            <span className="mono">(prevNetGex, netGex, strike vs spot)</span>: eroding wall · new magnet (small
            prior, large now) · acceleration zone · sign flip.
            <div style={{ marginTop: 8 }}><span className="cost free">no new data</span></div>
          </div>
        </Card>

        {/* ── 5 · RAIL ──────────────────────────────────────────────────── */}
        <Card
          variant="budget"
          title="5 · Rail badges — scan 169 names without opening them"
          subtitle="Same rail, one extra column"
        >
          <div className="cols2">
            <div className="rail-demo">
              <div className="rrow on">
                <span className="sym">SPX</span>
                <span className="minitag gd">⚑ FLIP +35</span>
                <span className="mono neg" style={{ fontSize: 11.5 }}>−1.47B</span>
              </div>
              <div className="rrow">
                <span className="sym">NVDA</span>
                <span className="minitag neg">WALL ▼</span>
                <span className="mono neg" style={{ fontSize: 11.5 }}>−612M</span>
              </div>
              <div className="rrow">
                <span className="sym">QQQ</span>
                <span className="minitag pos">MAGNET</span>
                <span className="mono pos" style={{ fontSize: 11.5 }}>+488M</span>
              </div>
              <div className="rrow">
                <span className="sym">TSLA</span>
                <span className="minitag gd">⚑ 3 FLIPS</span>
                <span className="mono neg" style={{ fontSize: 11.5 }}>−203M</span>
              </div>
              <div className="rrow">
                <span className="sym">AAPL</span>
                <span />
                <span className="mono pos" style={{ fontSize: 11.5 }}>+96M</span>
              </div>
            </div>
            <div>
              <div className="note" style={{ marginTop: 0 }}>
                <b>The problem this solves.</b> The rail ranks by |Δ| only, so a name whose flip jumped seven strikes
                on a modest dollar change sorts below five names that did nothing interesting. A badge column lets the
                interesting ones surface, and gives a fourth sort: <span className="kbd">Most structural change</span>.
                <br /><br />
                <b className="gd">This one has a real cost.</b> Badges need per-strike rows for every symbol, and{" "}
                <span className="mono">/api/eod-strike-gex-board</span> deliberately returns only the top-N strikes per
                name — that is why it is one query instead of 169. Two honest options:
                <ul className="tight">
                  <li>
                    Extend the board query to also compute flip / wall / flip-count per symbol <b>in SQL</b>, in the
                    same CTE. One extra round of aggregation, no extra round trips.
                  </li>
                  <li>
                    Or compute nothing extra and badge only what the top-N strikes can prove (sign flips) — free, but
                    partial.
                  </li>
                </ul>
                <div style={{ marginTop: 8 }}>
                  <span className="cost work">schema change</span>
                  query change, not a table change — no backfill needed.
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* ── 6 · LIMITS ───────────────────────────────────────────────── */}
        <Card
          variant="budget"
          title="6 · What this board still can't tell you"
          subtitle="Stated up front, because a confident tag on a number that can't support it is worse than no tag"
        >
          <div className="cols2">
            <div className="wall">
              <div className="wallhead">
                <span className="lbl">Call-driven vs put-driven Δ</span>
                <span className="chip warn">Needs schema</span>
              </div>
              <p style={{ fontSize: 12.5, margin: 0 }}>
                The read wants the split — large positive Δ <i>from calls</i> above spot vs large negative Δ{" "}
                <i>from puts</i> below. The recorder stores a single signed <span className="mono">net_gex</span> per
                strike; the call and put legs are summed and thrown away inside{" "}
                <span className="mono">accumulateChainGex()</span>.
              </p>
              <p style={{ fontSize: 12.5, margin: "8px 0 0" }}>
                <b className="lb">Fix:</b> add <span className="mono">call_gex</span> /{" "}
                <span className="mono">put_gex</span> columns and write all three. Cheap going forward, but{" "}
                <b>no backfill is possible</b> — the chains are gone. The split starts the day it ships.
              </p>
              <p style={{ fontSize: 12.5, margin: "8px 0 0" }}>
                <b>Partial today:</b> the four split chips already separate the +γ and −γ legs of the{" "}
                <i>change</i>, which answers most of the same question without the schema change.
              </p>
            </div>
            <div>
              <div className="wall">
                <div className="wallhead">
                  <span className="lbl">0DTE vs multi-day</span>
                  <span className="chip warn">Needs schema</span>
                </div>
                <p style={{ fontSize: 12.5, margin: 0 }}>
                  The recorder is <b>ex-0DTE by design</b> (<span className="mono">d &gt; today</span>), because
                  same-day gamma dwarfs the board and decays to nothing by the close. So the structural backdrop is
                  here and the fast-moving half is not. <b className="lb">Fix:</b> a second expiry bucket per strike —
                  real cost, real value, its own project.
                </p>
              </div>
              <div className="wall" style={{ marginTop: 14 }}>
                <div className="wallhead">
                  <span className="lbl">Was the OI change aggressive?</span>
                  <span className="chip warn">Other system</span>
                </div>
                <p style={{ fontSize: 12.5, margin: 0 }}>
                  Customer buying puts is more destabilising than passive flow — but ΔGEX cannot see intent. That
                  confirmation lives in the flow / premium data, not here. The useful move is a link out to the flow
                  page pre-filtered to the strike, not a number invented on this one.
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* ── 7 · ORDER ────────────────────────────────────────────────── */}
        <Card
          variant="budget"
          title="7 · Suggested order"
          subtitle="Cheapest first, and each one is useful on its own"
        >
          <div className="cols2">
            <ul className="tight" style={{ marginTop: 0 }}>
              <li><b className="lb">1 · Regime strip</b> — ~40 lines, pure client. Highest ratio of meaning to code on the list.</li>
              <li><b className="lb">2 · Normalised % column + ±3/5% band</b> — two lines of maths and a filter. Makes the ladder comparable across names.</li>
              <li><b className="lb">3 · Sign-flip tag</b> — one predicate, and it surfaces the highest-priority alert on the board.</li>
              <li><b className="lb">4 · Wall status cards</b> — argmax/argmin plus a threshold table.</li>
            </ul>
            <div>
              <ul className="tight" style={{ marginTop: 0 }}>
                <li><b className="lb">5 · Flip migration</b> — needs the convention decision in module 3 first.</li>
                <li><b className="lb">6 · Rail badges</b> — SQL work in the board CTE.</li>
                <li><b className="gd">7 · Call/put split</b> — schema change, no backfill. Only worth it if the four split chips turn out not to answer the question.</li>
              </ul>
              <div className="note">
                <b>1–5 are one file.</b> All of them read the payload <span className="mono">GexGrowth.tsx</span>{" "}
                already holds, so they are pure additions to that page — no recorder change, no migration, nothing
                that can corrupt the recorded series.
              </div>
            </div>
          </div>
        </Card>

      </div>
    </PageShell>
  );
}
