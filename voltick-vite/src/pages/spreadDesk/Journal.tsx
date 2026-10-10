/**
 * Spread Desk · Journal. The record of closed spreads, split by setup. Example
 * trades only: the live version fills from the member's own closed positions.
 */
import { useState } from "react";
import { BAD, GOOD, LINE, PAPER, PAPER_QUIET, SKY, labelStyle, numStyle } from "../../theme";
import { GROUPS, TRADES, f2, money, pct, stats } from "./model";
import { Bar, Panel, bigNum, inputStyle } from "./ui";

const th = { ...labelStyle, fontSize: 9.5, textAlign: "left" as const, padding: "8px 10px", borderBottom: `1px solid ${LINE}`, whiteSpace: "nowrap" as const };
const td = { padding: "8px 10px", borderBottom: `1px solid ${LINE}`, color: PAPER, fontSize: 12.5, verticalAlign: "top" as const };
const tdn = { ...td, ...numStyle, textAlign: "right" as const };

export default function Journal() {
  const [grp, setGrp] = useState("regime");
  const s = stats(TRADES);
  const g = GROUPS[grp];
  const m = new Map<string, typeof TRADES>();
  TRADES.forEach((t) => {
    const k = g.f(t);
    m.set(k, [...(m.get(k) ?? []), t]);
  });
  const rows = [...m.entries()].map(([key, l]) => ({ key, ...stats(l) })).sort((a, z) => z.win - a.win);
  const pf = (v: number) => (isFinite(v) ? f2(v) : "∞");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 16 }}>
      <div className="sd-kpis">
        {([
          [pct(s.win), "Win rate", PAPER],
          [pf(s.pf), "Profit factor", PAPER],
          [pct(s.capt), "Avg share of max profit kept", PAPER],
          [`${s.exp >= 0 ? "+" : ""}${money(s.exp)}`, "Expectancy per trade", s.exp >= 0 ? GOOD : BAD],
          [pct(s.ror), "Return on risk", PAPER],
          [String(s.maxStreak), "Longest losing streak", PAPER],
        ] as [string, string, string][]).map(([v, l, c]) => (
          <div key={l} style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ ...bigNum, color: c }}>{v}</div>
            <div style={{ fontSize: 11.5, color: PAPER_QUIET, fontWeight: 600 }}>{l}</div>
          </div>
        ))}
      </div>

      <div className="sd-two">
        <Panel
          title="Your record by setup"
          aside={
            <select aria-label="Group by" value={grp} onChange={(e) => setGrp(e.target.value)} style={{ ...inputStyle, width: "auto", textTransform: "none", letterSpacing: 0 }}>
              {Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          }
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr><th style={th}>Setup</th><th style={{ ...th, textAlign: "right" }}>Trades</th><th style={th}>Win rate</th><th style={{ ...th, textAlign: "right" }}>Avg P&amp;L</th><th style={{ ...th, textAlign: "right" }}>Profit factor</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ ...td, fontWeight: 700 }}>{r.key}</td>
                    <td style={tdn}>{r.n}</td>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ ...numStyle, width: 38 }}>{pct(r.win)}</span>
                        <div style={{ flex: 1, minWidth: 60 }}><Bar value={r.win} color={r.win >= 0.7 ? GOOD : r.win >= 0.5 ? SKY : BAD} /></div>
                      </div>
                    </td>
                    <td style={{ ...tdn, color: r.exp >= 0 ? GOOD : BAD }}>{r.exp >= 0 ? "+" : ""}{money(r.exp)}</td>
                    <td style={tdn}>{pf(r.pf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "10px 14px", fontSize: 11.5, color: PAPER_QUIET }}>{g.note} Small samples move a lot.</div>
        </Panel>

        <Panel title="Closed trades" aside={`Example journal · ${TRADES.length} trades`}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Opened", "Ticker", "Structure"].map((h) => <th key={h} style={th}>{h}</th>)}
                  {["Δ", "DTE"].map((h) => <th key={h} style={{ ...th, textAlign: "right" }}>{h}</th>)}
                  {["Regime", "Wall"].map((h) => <th key={h} style={th}>{h}</th>)}
                  <th style={{ ...th, textAlign: "right" }}>Credit</th>
                  <th style={th}>Closed by</th>
                  <th style={{ ...th, textAlign: "right" }}>P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {TRADES.slice().reverse().map((t) => (
                  <tr key={t.date + t.tk}>
                    <td style={{ ...td, ...numStyle }}>{t.date}</td>
                    <td style={{ ...td, ...numStyle, fontWeight: 700 }}>{t.tk}</td>
                    <td style={td}>{t.strat}</td>
                    <td style={tdn}>{t.delta}</td>
                    <td style={tdn}>{t.dte}</td>
                    <td style={{ ...td, color: t.regime === "Positive" ? GOOD : BAD }}>{t.regime}</td>
                    <td style={td}>{t.wall ? "behind" : "open air"}</td>
                    <td style={tdn}>${f2(t.cr)}</td>
                    <td style={td}>{t.exit}</td>
                    <td style={{ ...tdn, color: t.pnl >= 0 ? GOOD : BAD }}>{t.pnl >= 0 ? "+" : ""}{money(t.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
