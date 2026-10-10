/**
 * Spread Desk · My rules. Every number the finder screens with and the monitor
 * reads against. The starting values are the rules many credit spread traders
 * learn first; they are a starting point, not Voltick's advice.
 */
import type { ReactNode } from "react";
import { PAPER, PAPER_QUIET } from "../../theme";
import { RULE_DEFAULTS, f2, money, pct } from "./model";
import type { Rules } from "./model";
import { Btn, CheckRow, Field, Panel, inputStyle } from "./ui";

type NumKey = { [K in keyof Rules]: Rules[K] extends number ? K : never }[keyof Rules];
type BoolKey = { [K in keyof Rules]: Rules[K] extends boolean ? K : never }[keyof Rules];

export default function RulesTab({ R, setR }: { R: Rules; setR: (r: Rules) => void }) {
  const num = (k: NumKey, label: string, step = 1, min = 0) => (
    <Field label={label} htmlFor={`sd-r-${k}`}>
      <input
        id={`sd-r-${k}`} type="number" step={step} min={min} value={R[k]} style={inputStyle}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (isFinite(v)) setR({ ...R, [k]: v });
        }}
      />
    </Field>
  );
  const yes = (k: BoolKey, label: string, on: string, off: string) => (
    <Field label={label} htmlFor={`sd-r-${k}`}>
      <select id={`sd-r-${k}`} value={R[k] ? "1" : "0"} onChange={(e) => setR({ ...R, [k]: e.target.value === "1" })} style={inputStyle}>
        <option value="1">{on}</option>
        <option value="0">{off}</option>
      </select>
    </Field>
  );
  const group = (title: string, aside: string, children: ReactNode) => (
    <Panel title={title} aside={aside}>
      <div className="sd-grid3" style={{ padding: 14 }}>{children}</div>
    </Panel>
  );

  const w = R.width, minCr = (w * R.minCredit) / 100, perCt = (w - minCr) * 100, riskD = (R.acct * R.riskPct) / 100;
  const ct = Math.floor(riskD / perCt);
  const screens = [R.outsideEM && "sit outside 1σ", R.needWall && "sit behind a wall", R.needPos && "come from a positive-gamma board", `have IV rank of ${R.minIVR} or more`].filter(Boolean).join(", ");

  return (
    <div className="sd-rules">
      <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
        {group("Account and sizing", "Size from max loss", <>
          {num("acct", "Account size ($)", 1000)}
          {num("riskPct", "Risk per trade (%)", 0.5, 0.25)}
          {num("width", "Default width ($)", 1, 1)}
        </>)}
        {group("Screening", "Checks every candidate", <>
          {num("deltaLo", "Short delta from", 1, 5)}
          {num("deltaHi", "Short delta to", 1, 5)}
          <Field label="Default DTE" htmlFor="sd-r-dte">
            <select id="sd-r-dte" value={R.dte} onChange={(e) => setR({ ...R, dte: +e.target.value })} style={inputStyle}>
              {[7, 14, 21, 30, 45].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          {num("minCredit", "Min credit (% of width)", 1, 5)}
          {num("minIVR", "Min IV rank", 5, 0)}
          {yes("outsideEM", "Short outside expected move", "Yes, 1σ or more", "Not required")}
          {yes("needWall", "Short behind a wall", "Required", "Not required")}
          {yes("needPos", "Gamma regime", "Positive only", "Either")}
        </>)}
        {group("Management", "Drives the monitor", <>
          {num("profitPct", "Profit level (% of max)", 5, 10)}
          {num("timeRule", "Time rule (DTE)", 1, 0)}
          {num("lossX", "Loss level (× credit)", 0.25, 0.5)}
        </>)}
        {group("Portfolio limits", "% of account at risk", <>
          {num("maxUnd", "Max per underlying (%)", 1, 1)}
          {num("maxWeek", "Max per expiration week (%)", 1, 1)}
          {num("maxTotal", "Max total at risk (%)", 1, 1)}
        </>)}
        {group("0DTE", "Its own set", <>
          {num("zProfit", "Profit level (%)", 5, 10)}
          {num("zLoss", "Loss level (× credit)", 0.25, 0.5)}
          {num("zRisk", "Risk per trade (%)", 0.25, 0.25)}
        </>)}
      </div>

      <aside style={{ display: "grid", gap: 16, alignContent: "start", position: "sticky", top: 72 }}>
        <Panel title="What your rules mean" aside="Live">
          <div style={{ padding: 14, display: "grid", gap: 10 }}>
            <CheckRow lvl="ok">On a ${w}-wide spread you need at least ${f2(minCr)} credit. Max loss is then {money(perCt)} per contract.</CheckRow>
            <CheckRow lvl="ok">Risking {R.riskPct}% of {money(R.acct)} is {money(riskD)} per trade: {ct} contract{ct === 1 ? "" : "s"} at that max loss.</CheckRow>
            <CheckRow lvl="ok">At that credit, if every loser lost the full width, {pct((w - minCr) / w)} of trades would have to win just to break even. Your {R.profitPct}% profit level and {R.lossX}× loss level change that math, and the Journal shows what actually happened.</CheckRow>
            <CheckRow lvl="ok">Short strikes from {R.deltaLo}Δ to {R.deltaHi}Δ: about {pct(1 - R.deltaHi / 100)} to {pct(1 - R.deltaLo / 100)} model chance of expiring out of the money.</CheckRow>
            <CheckRow lvl="ok">The monitor flags each position at {R.profitPct}% of max profit, at {R.timeRule} DTE, and when the loss reaches {R.lossX}× the credit.</CheckRow>
            <CheckRow lvl="ok">Portfolio limits: {R.maxUnd}% per underlying ({money((R.acct * R.maxUnd) / 100)}), {R.maxWeek}% per expiration week ({money((R.acct * R.maxWeek) / 100)}), {R.maxTotal}% in total.</CheckRow>
            <CheckRow lvl="ok">To match every rule, a candidate must {screens}.</CheckRow>
            <CheckRow lvl="ok">0DTE runs on its own set: {R.zProfit}% profit level, {R.zLoss}× loss level, {R.zRisk}% risk per trade.</CheckRow>
          </div>
        </Panel>
        <Panel pad={14}>
          <p style={{ margin: "0 0 10px", fontSize: 12, color: PAPER_QUIET }}>
            The starting values are rules many credit spread traders learn first: 16 to 20 delta, 30 to 45 DTE, a 50% profit level, a 21-DTE time rule, 1 to 2% risk.
            They are a common starting point, <span style={{ color: PAPER }}>not Voltick's advice</span>. Change any of them.
          </p>
          <Btn small kind="ghost" onClick={() => setR({ ...RULE_DEFAULTS })}>Reset to the starting values</Btn>
        </Panel>
      </aside>
    </div>
  );
}
