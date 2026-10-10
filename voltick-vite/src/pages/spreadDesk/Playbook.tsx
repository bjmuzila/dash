/**
 * Spread Desk · Playbook. The common credit spread structures and the habits
 * traders build around them, plus where dealer positioning fits. Education, not
 * recommendations. Copy rules: no em-dashes, no trade-call words.
 */
import type { ReactNode } from "react";
import { ACCENT_TEXT, BAD, GOOD, LINE, PAPER, PAPER_QUIET, labelStyle, numStyle } from "../../theme";
import { Panel, Pill } from "./ui";

const th = { ...labelStyle, fontSize: 9.5, textAlign: "left" as const, padding: "8px 10px", borderBottom: `1px solid ${LINE}`, whiteSpace: "nowrap" as const };
const td = { padding: "9px 10px", borderBottom: `1px solid ${LINE}`, color: PAPER, fontSize: 12.5, verticalAlign: "top" as const };

const STRUCTURES: [string, string, string, string, string, string, "accent" | "plain"][] = [
  ["Put credit spread", "16-20Δ", "About ⅓ of width or more", "width − credit", "Neutral to mildly bullish, positive gamma. Index put skew usually makes this side richer.", "Screened", "accent"],
  ["Call credit spread", "16-20Δ", "About ⅓ of width or more", "width − credit", "Neutral to mildly bearish, or after a sharp rally into a call wall.", "Screened", "accent"],
  ["Iron condor", "16-20Δ each side", "Combined credit", "wider wing − total credit", "Range-bound, positive gamma, moderate implied vol. Only one side can lose in full.", "Screened", "accent"],
  ["Cash-secured put", "20-30Δ", "Higher absolute premium", "strike − credit", "Names the trader is willing to own. Ties up the full strike in cash.", "Later", "plain"],
  ["Short strangle", "16-20Δ each side", "Highest", "unlimited", "High IV rank and constant attention. Drawdowns run far deeper than defined-risk spreads.", "Not covered", "plain"],
];

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul style={{ margin: 0, padding: "14px 14px 14px 32px", display: "grid", gap: 8, fontSize: 13, color: PAPER }}>
      {items.map((x, i) => <li key={i}>{x}</li>)}
    </ul>
  );
}

export default function Playbook({ goRules }: { goRules: () => void }) {
  const setYours = (
    <button type="button" onClick={goRules} style={{ border: 0, background: "none", padding: 0, font: "inherit", fontFamily: "inherit", color: ACCENT_TEXT, textDecoration: "underline", cursor: "pointer", textTransform: "none", letterSpacing: 0, fontSize: 12 }}>
      Set yours
    </button>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 16 }}>
      <Panel title="The common credit spread structures" aside="Education · not recommendations">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>{["Structure", "Typical short delta", "Credit traders look for", "Max loss", "Conditions traders look for", "On Spread Desk"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {STRUCTURES.map(([name, d, cr, ml, cond, here, tone]) => (
                <tr key={name}>
                  <td style={{ ...td, fontWeight: 700 }}>{name}</td>
                  <td style={{ ...td, ...numStyle }}>{d}</td>
                  <td style={td}>{cr}</td>
                  <td style={{ ...td, ...numStyle, color: ml === "unlimited" ? BAD : PAPER }}>{ml}</td>
                  <td style={td}>{cond}</td>
                  <td style={td}><Pill tone={tone}>{here}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="sd-cols3">
        <Panel title="Opening a spread" aside={setYours}>
          <Bullets items={[
            <><b>30 to 45 DTE</b> is where many traders start: theta is efficient and gamma is still manageable. 0DTE is a different, high-gamma product with its own rules.</>,
            <><b>16 to 20 delta</b> short strikes sit near one expected move. Lower delta wins more often for less credit; higher delta pays more and wins less.</>,
            <><b>$5 wide</b> on SPY-sized underlyings is a common default. A credit of about ⅓ of width keeps the break-even win rate reasonable.</>,
            <><b>IV rank above 30 to 50.</b> Premium is thin when implied vol is low.</>,
            <><b>Outside the expected move.</b> Short strikes at or beyond 1σ for the expiration.</>,
          ]} />
        </Panel>
        <Panel title="Managing it" aside={setYours}>
          <Bullets items={[
            <><b>A profit level around 50%</b> of max profit. It keeps most of the available premium and frees the capital sooner.</>,
            <><b>A time rule at 21 DTE.</b> In the last three weeks gamma grows faster than theta.</>,
            <><b>A loss level set in advance</b>, often 2× the credit. On a defined-risk spread, closing the whole position is usually simpler than adjusting one side.</>,
            <><b>0DTE</b> runs tighter: 25 to 50% profit levels, 1.5 to 2× loss levels, and nothing held into the close.</>,
          ]} />
        </Panel>
        <Panel title="Risk" aside={setYours}>
          <Bullets items={[
            <><b>Size from max loss, never from credit.</b> 1 to 2% of the account at risk per trade is the usual range.</>,
            <><b>Concentration limits</b>, such as 5% per underlying and 15% per expiration week, keep one bad week from compounding.</>,
            <><b>Defined risk first.</b> Undefined-risk structures need more capital and constant attention.</>,
            <>Watch net delta, theta and the gamma regime across the whole book, not just per trade.</>,
          ]} />
        </Panel>
      </div>

      <Panel title="Where dealer positioning fits" aside="What Voltick adds">
        <div className="sd-regime" style={{ padding: 14 }}>
          <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, display: "grid", gap: 6, fontSize: 12.5, color: PAPER }}>
            <span><Pill tone="good">Positive gamma · sticky</Pill></span>
            <b>Dealers dampen moves.</b> Their hedging leans against rallies and dips, which pulls price back toward the middle of the range. This is the backdrop range trades like iron condors are built for, and walls hold more often here.
          </div>
          <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, display: "grid", gap: 6, fontSize: 12.5, color: PAPER }}>
            <span><Pill tone="alert">Negative gamma · slippery</Pill></span>
            <b>Dealers amplify moves.</b> Hedging pushes in the direction price is already going, so short strikes get tested more often. Traders in this regime often size down, stay single-sided or stand aside.
          </div>
        </div>
        <p style={{ margin: 0, padding: "0 14px 14px", fontSize: 13, color: PAPER }}>
          Delta and expected move describe distance. Neither says what stands between price and the short strike. Spread Desk adds the call wall, the put wall and the gamma flip, and shows how far each short strike sits from them.
        </p>
      </Panel>

      <Panel title="Reality checks">
        <Bullets items={[
          <><b>High win rates are lopsided.</b> Many small wins, occasional larger losses. The math only works with consistent sizing and early management.</>,
          <><b>Going closer to the money for a bigger credit</b> is the most common way the edge disappears.</>,
          <><b>SPX is cash-settled</b>, so there is no early assignment or share delivery. Equity options can be assigned.</>,
          <><b>Published win rates assume management rules.</b> Change the rules and the results change. The Journal shows what your own rules produced.</>,
          <><b>Test before trusting.</b> Regime filters often matter more than small delta tweaks. Voltick will grade wall setups on its own archive once the multi-day record is mature.</>,
        ]} />
        <p style={{ margin: 0, padding: "0 14px 14px", fontSize: 11.5, color: PAPER_QUIET }}>
          <span style={{ color: GOOD }}>●</span> Educational material. Nothing here is investment advice.
        </p>
      </Panel>
    </div>
  );
}
