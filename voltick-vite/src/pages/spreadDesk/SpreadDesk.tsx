/**
 * Spread Desk · a screener for credit spread and iron condor traders.
 *
 *   Strike finder   ticker, lean, DTE → candidate short strikes behind walls,
 *                   checked against the member's own rules
 *   My positions    tracked spreads read against walls, flip, regime and rules
 *   Journal         the closed-trade record, split by setup
 *   My rules        every number the other tabs read
 *   Playbook        the structures and habits, in plain English
 *
 * MOCK DATA ONLY. Nothing here reads the feed yet: boards, sessions and journal
 * trades are synthetic, and the page says so in its ribbon. Rules and tracked
 * positions persist per browser (localStorage, try/catch, nothing shared).
 *
 * Copy rules hold: no em-dashes in anything a person reads, and never buy,
 * sell, signal, entry, target, stop or prediction. Mechanics and locations only.
 */
import { useCallback, useEffect, useState } from "react";
import { PageShell } from "../../components/PageCard";
import { ACCENT, ELEV, LINE, MONO, PANEL, PAPER, PAPER_QUIET, R_LG, R_MD, SKY, W_BOLD, rgba } from "../../theme";
import { DEFAULT_POSITIONS, RULE_DEFAULTS, prep, readPos } from "./model";
import type { Position, PositionInput, Rules } from "./model";
import { Pill, load, save } from "./ui";
import Finder from "./Finder";
import Monitor from "./Monitor";
import Journal from "./Journal";
import RulesTab from "./RulesTab";
import Playbook from "./Playbook";

type Tab = "finder" | "positions" | "journal" | "rules" | "playbook";
const TABS: [Tab, string][] = [
  ["finder", "Strike finder"],
  ["positions", "My positions"],
  ["journal", "Journal"],
  ["rules", "My rules"],
  ["playbook", "Playbook"],
];
const RULES_KEY = "spreaddesk.rules.v1";
const POS_KEY = "spreaddesk.positions.v1";

const readHash = (): Tab => {
  const h = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
  return TABS.find(([k]) => k === h)?.[0] ?? "finder";
};

const sameSpread = (a: PositionInput, b: PositionInput) =>
  a.tk === b.tk && a.type === b.type && a.short === b.short && a.dte === b.dte && (a.short2 ?? null) === (b.short2 ?? null);

export default function SpreadDesk() {
  const [tab, setTab] = useState<Tab>(readHash);
  const [R, setRState] = useState<Rules>(() => ({ ...RULE_DEFAULTS, ...(load<Partial<Rules>>(RULES_KEY) ?? {}) }));
  const [positions, setPositions] = useState<Position[]>(() =>
    (load<PositionInput[]>(POS_KEY) ?? DEFAULT_POSITIONS).map((p) => prep({ ...RULE_DEFAULTS, ...(load<Partial<Rules>>(RULES_KEY) ?? {}) }, p)),
  );
  const [sess, setSess] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => save(RULES_KEY, R), [R]);
  useEffect(() => save(POS_KEY, positions.map(({ id: _id, m0: _m0, width: _w, ...rest }) => rest)), [positions]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(t);
  }, [toast]);

  const go = useCallback((t: Tab) => {
    setTab(t);
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${t}`);
    } catch {
      /* ignore */
    }
  }, []);

  const tracked = useCallback((p: PositionInput) => positions.some((x) => sameSpread(x, p)), [positions]);
  const add = useCallback(
    (p: PositionInput): string | null => {
      if (positions.some((x) => sameSpread(x, p))) {
        setToast("Already tracking that one.");
        return "Already tracking that one.";
      }
      setPositions((list) => [prep(R, p), ...list]);
      setToast(`✓ Tracking ${p.tk} ${p.type === "condor" ? "iron condor" : `${p.short}/${p.long} ${p.type} spread`} · see My positions`);
      return null;
    },
    [positions, R],
  );
  const remove = useCallback((id: number) => setPositions((list) => list.filter((p) => p.id !== id)), []);

  const flagged = positions.filter((p) => readPos(R, p, sess).lvl !== "ok").length;

  return (
    <PageShell
      title="Spread Desk"
      lede="Set your own rules once. The desk screens strikes against them, shows which sit behind dealer walls and which sit in open air, and watches your open spreads for structure changes. You choose the trade."
      maxWidth={1400}
    >
      <style>{CSS}</style>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div role="tablist" aria-label="Spread Desk sections" style={{ display: "flex", gap: 4, padding: 4, background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_LG, overflowX: "auto", maxWidth: "100%" }}>
          {TABS.map(([k, l]) => {
            const on = k === tab;
            return (
              <button
                key={k}
                role="tab"
                aria-selected={on}
                type="button"
                onClick={() => go(k)}
                style={{
                  border: 0, borderRadius: R_MD, padding: "8px 12px", cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: W_BOLD, whiteSpace: "nowrap",
                  background: on ? ELEV : "transparent", color: on ? PAPER : PAPER_QUIET, boxShadow: on ? `inset 0 -1px 0 ${ACCENT}` : "none",
                }}
              >
                {l}
                {k === "positions" && flagged > 0 && <span style={{ fontFamily: MONO, fontSize: 11, marginLeft: 6, color: SKY }}>{flagged} flagged</span>}
              </button>
            );
          })}
        </div>
        <Pill tone="accent">Mock data · not wired to the feed</Pill>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px", marginBottom: 16, borderRadius: R_LG, border: `1px solid ${rgba(ACCENT, 0.28)}`, background: rgba(ACCENT, 0.08), fontSize: 13, color: PAPER }}>
        <span>
          <b>Example data only.</b> Everything here is interactive, but levels, prices, sessions and journal trades are synthetic, not live readings. Odds are Black-Scholes model estimates from one implied vol. Voltick's own hold record for multi-day strikes is not published yet.
        </span>
      </div>

      {tab === "finder" && <Finder R={R} tracked={tracked} onTrack={add} goRules={() => go("rules")} />}
      {tab === "positions" && <Monitor R={R} positions={positions} onAdd={add} onRemove={remove} sess={sess} setSess={setSess} />}
      {tab === "journal" && <Journal />}
      {tab === "rules" && <RulesTab R={R} setR={setRState} />}
      {tab === "playbook" && <Playbook goRules={() => go("rules")} />}

      <div style={{ marginTop: 28, paddingTop: 16, borderTop: `1px solid ${LINE}`, display: "grid", gap: 6, fontSize: 12, color: PAPER_QUIET }}>
        <div>
          <b style={{ color: PAPER }}>How these numbers are made.</b> Delta, credit, probability of touch and probability of profit are Black-Scholes model estimates from one implied vol for the expiration, without skew or a real bid/ask, so they read the terrain rather than quote a fill. Open interest updates once a day, so walls can move after each overnight update.
        </div>
        <div>Spread Desk is a screener you drive with your own inputs and rules. It does not recommend trades.</div>
        <div>Voltick provides market analytics for educational purposes. Nothing here is investment advice.</div>
      </div>

      {toast && (
        <div
          role="status"
          onClick={() => go("positions")}
          style={{
            position: "fixed", left: "50%", bottom: 20, transform: "translateX(-50%)", zIndex: 50, cursor: "pointer", maxWidth: "calc(100% - 32px)",
            background: ELEV, border: `1px solid ${rgba(ACCENT, 0.5)}`, color: PAPER, padding: "10px 14px", borderRadius: R_LG, fontSize: 13,
            boxShadow: `0 20px 40px -16px ${rgba(PANEL, 0.9)}`,
          }}
        >
          {toast}
        </div>
      )}
    </PageShell>
  );
}

/* Layout only: grids and their breakpoints. Colors stay in theme tokens above. */
const CSS = `
.sd-finder{display:grid;grid-template-columns:270px minmax(0,1fr);gap:16px;align-items:start}
.sd-ladder{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)}
.sd-ladderwrap{border-right:1px solid ${LINE}}
.sd-checker{display:grid;grid-template-columns:200px minmax(0,1fr) auto;gap:14px;align-items:center;padding:14px}
.sd-condor{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr) auto;gap:16px;align-items:center;padding:14px}
.sd-cand{display:grid;grid-template-columns:190px minmax(0,1fr) 230px;gap:14px;align-items:start}
.sd-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px 10px}
.sd-compare{display:grid;gap:8px;border-left:1px solid ${LINE};padding-left:14px}
.sd-row2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}
.sd-regime{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sd-playbar{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:14px;align-items:center}
.sd-mon{display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:16px;align-items:start}
.sd-pnl{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;padding:10px 14px;border-bottom:1px solid ${LINE}}
.sd-posbody{display:grid;grid-template-columns:minmax(0,1fr) 270px}
.sd-checks{border-left:1px solid ${LINE};padding:12px 14px;display:grid;gap:8px;align-content:start}
.sd-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}
.sd-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:16px;align-items:start}
.sd-rules{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px;align-items:start}
.sd-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.sd-cols3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
@media (max-width:1180px){
  .sd-finder,.sd-mon,.sd-two,.sd-rules,.sd-cols3{grid-template-columns:1fr}
  .sd-ladder{grid-template-columns:1fr}
  .sd-ladderwrap{border-right:0;border-bottom:1px solid ${LINE}}
  .sd-cand,.sd-checker,.sd-condor{grid-template-columns:1fr}
  .sd-compare{border-left:0;padding-left:0;border-top:1px solid ${LINE};padding-top:10px}
  .sd-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
  .sd-rules aside{position:static!important}
}
@media (max-width:640px){
  .sd-stats,.sd-pnl,.sd-kpis,.sd-grid3{grid-template-columns:repeat(2,minmax(0,1fr))}
  .sd-posbody,.sd-regime{grid-template-columns:minmax(0,1fr)}
  .sd-checks{border-left:0;border-top:1px solid ${LINE}}
  .sd-playbar{grid-template-columns:auto 1fr}
  .sd-scrub{grid-column:1/-1}
}
`;
