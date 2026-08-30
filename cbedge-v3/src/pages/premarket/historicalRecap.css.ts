// ─────────────────────────────────────────────────────────────────────────────
// The historical recap's stylesheet, in its own module.
//
// Split out of HistoricalRecap.tsx so that component can be lazy(). The component is the
// heavy half; this is a few KB of selectors the page needs on the FIRST paint,
// because every premarket stylesheet is concatenated into the single <style>
// block at the top of Premarket.tsx and the cascade depends on them all
// arriving together.
//
// Importing the constant from the component would have dragged the component
// into the entry chunk with it — exactly the import edge lazy() exists to cut.
// HistoricalRecap.tsx re-exports the name, so nothing that imported it from there
// had to change.
// ─────────────────────────────────────────────────────────────────────────────

export const HISTORICAL_CSS = `
.pmk .hgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.pmk .hev{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.pmk .hrow{display:grid;grid-template-columns:64px 1fr 104px 96px;align-items:center;height:22px;gap:9px}
.pmk .hrow .k{font-size:10.5px;text-align:right;color:var(--dim)}
.pmk .hrow .v{font-size:var(--text-2xs);text-align:right;white-space:nowrap}
.pmk .hrow .track{position:relative;height:13px;border-radius:3px;background:var(--bg);
  box-shadow:inset 1px 0 0 var(--line2)}
.pmk .hrow .track i{position:absolute;left:0;top:2px;bottom:2px;border-radius:2px}
.pmk .hrow .track i.p{background:var(--pos)}
.pmk .hrow .track i.n{background:var(--neg)}
/* Level strip: the day's five SPX levels as one row of labelled figures. */
.pmk .hlev{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:10px}
.pmk .hlev .l{border:1px solid var(--card);border-radius:var(--r2);background:var(--panel2);padding:9px 10px}
.pmk .hlev .l .n2{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2)}
.pmk .hlev .l .v2{font-size:17px;font-weight:640;margin-top:2px;letter-spacing:-.02em}
.pmk .hlev .l .m2{font-size:var(--text-2xs);color:var(--dim)}
/* Cumulative gamma curve. Sized by its wrapper, drawn edge to edge. */
.pmk .hcurve{margin-top:12px;border:1px solid var(--card);border-radius:var(--r);
  background:var(--panel2);padding:10px 12px 8px}
.pmk .hcurve svg{display:block;width:100%;height:132px}
.pmk .hcurvex{display:flex;justify-content:space-between;font-size:var(--text-3xs);color:var(--dim2);margin-top:4px}
@media (max-width:1180px){
  .pmk .hgrid{grid-template-columns:1fr}
  .pmk .hlev{grid-template-columns:repeat(2,1fr)}
}
`;
