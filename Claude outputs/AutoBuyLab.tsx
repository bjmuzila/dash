/**
 * Results → Auto-Buy Lab — the entry/exit test bench for the timed 0DTE
 * auto-buy.
 *
 * THE QUESTION THIS TAB ASKS. A blind timed buy ("every day at 10:15, buy the
 * 0.25Δ call") is a losing trade — theta plus fakeouts. The edge, if there is
 * one, comes from only firing when several INDEPENDENT reads agree: trend
 * (VWAP, EMA stack), structure (opening range + retest), dealer positioning
 * (GEX regime), participation (TICK/ADD/VOLD, RVOL, CVD). So the tab is built
 * around one control: an AND-stack of filters, each of which can be armed or
 * disarmed, and everything below re-reads from that stack.
 *
 * FOUR PANELS, ONE STATE.
 *   1. Entry Rule Stack — the filters, armed/disarmed, with their live read.
 *   2. Confluence gauge — the weighted score at the fire clock vs. the arm
 *      threshold. This is the thing that decides FIRE / NO FIRE.
 *   3. Exit Rule Set — first-condition-wins, with the historical mix of which
 *      condition actually got hit.
 *   4. Sweep — clock × stack expectancy matrix, per-filter drop-one-out lift,
 *      equity curves, the ranked result table and the fired-trade log.
 *
 * ── DATA IS FIXTURE, DELIBERATELY ──────────────────────────────────────────
 * There is no /api/autobuy-lab yet. Every number below comes from FIXTURES at
 * the bottom of this file and the page says so in its header badge, because a
 * results board that silently shows made-up numbers is worse than no board.
 * The shapes are the ones the endpoint should return, so wiring it later is a
 * swap of the three `const … = FIXTURE_…` lines for fetches, not a rewrite.
 *
 * Scoring, the matrix lookup and the exit mix ARE real code running over those
 * fixtures — toggling a filter recomputes the score, moves the gauge and
 * re-ranks the table. That is the part being reviewed here.
 */

import React, { useMemo, useState } from "react";
import { HOME_THEME, classicCardAccentStyle } from "../../lib/theme";

const C = {
  cyan: HOME_THEME.cyan,
  border: HOME_THEME.border,
  label: HOME_THEME.text,
  purple: HOME_THEME.purple,
  gold: HOME_THEME.gold,
  orange: HOME_THEME.orange,
  lightBlue: HOME_THEME.lightBlue,
};
const GREEN = HOME_THEME.green;
const RED = HOME_THEME.red;
const WIN = "#1FD98A";
const SOFT_RED = "#f4948e";
const CARD = classicCardAccentStyle;
const INSET = "rgba(0,0,0,0.30)";
const MONO = "var(--font-mono)";

function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── Types the future endpoint should satisfy ────────────────────────────────

/** Which independent read a filter belongs to — the gauge breaks down by block. */
type Block = "trend" | "dealer" | "internals" | "participation";

type FilterDef = {
  id: string;
  name: string;
  /** What the filter looked like on the session the live read is from. */
  detail: string;
  block: Block;
  /** Relative weight in the confluence score. */
  weight: number;
  /** Armed by default in the shipped preset. */
  armed: boolean;
  /** Live read at the fire clock: does it pass right now. */
  pass: boolean;
  /** Drop-one-out expectancy lift vs. the full stack, $ per fired trade. */
  lift: number;
};

type ExitVariant = {
  id: "A" | "B" | "C";
  label: string;
  target: string;
  stop: string;
  trail: string;
  flatten: string;
  structure: string;
  gexVeto: string;
  /** Share of trades closed by each condition — target/trail/struct/stop/time. */
  mix: [number, number, number, number, number];
};

type SweepRow = {
  stack: string;
  clock: string;
  exit: string;
  fires: number;
  win: number;
  avg: number;
  pf: number;
  dd: number;
};

type LoggedTrade = {
  date: string;
  side: "CALL" | "PUT";
  strike: number;
  score: number;
  entry: number;
  exit: number;
  reason: "target" | "trail" | "struct" | "stop" | "time";
  pl: number;
};

const CLOCKS = ["09:45", "10:00", "10:15", "10:30", "10:45", "11:30", "14:00"] as const;
type Clock = (typeof CLOCKS)[number];

const BLOCK_LABEL: Record<Block, string> = {
  trend: "Trend",
  dealer: "Dealer / GEX",
  internals: "Internals",
  participation: "Participation",
};
const BLOCK_COLOR: Record<Block, [string, string]> = {
  trend: [C.cyan, C.lightBlue],
  dealer: [C.orange, C.gold],
  internals: [WIN, GREEN],
  participation: [RED, SOFT_RED],
};

/** Score at or above this arms the buy. */
const ARM_THRESHOLD = 75;

// ── Page ────────────────────────────────────────────────────────────────────

export default function AutoBuyLab() {
  const [side, setSide] = useState<"CALL" | "PUT">("CALL");
  const [clock, setClock] = useState<Clock>("10:15");
  const [exitId, setExitId] = useState<ExitVariant["id"]>("C");
  const [armed, setArmed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(FILTERS.map((f) => [f.id, f.armed])),
  );

  const toggle = (id: string) => setArmed((a) => ({ ...a, [id]: !a[id] }));

  const live = FILTERS.filter((f) => armed[f.id]);
  const exit = EXITS.find((e) => e.id === exitId) as ExitVariant;

  // Weighted confluence score — armed filters only, so disarming a failing
  // filter RAISES the score rather than leaving a hole in it.
  const score = useMemo(() => {
    const total = live.reduce((s, f) => s + f.weight, 0);
    if (total === 0) return 0;
    const got = live.reduce((s, f) => s + (f.pass ? f.weight : 0), 0);
    return Math.round((got / total) * 100);
  }, [live]);

  const blockScores = useMemo(() => {
    const out = {} as Record<Block, number | null>;
    (Object.keys(BLOCK_LABEL) as Block[]).forEach((b) => {
      const inBlock = live.filter((f) => f.block === b);
      const total = inBlock.reduce((s, f) => s + f.weight, 0);
      out[b] = total === 0 ? null : Math.round((inBlock.reduce((s, f) => s + (f.pass ? f.weight : 0), 0) / total) * 100);
    });
    return out;
  }, [live]);

  const failing = live.filter((f) => !f.pass);
  const fires = score >= ARM_THRESHOLD && failing.length === 0;

  // Which matrix column the current stack lands in — the sweep was run over
  // cumulative stacks, so the count of armed filters picks the column.
  const stackCol = Math.min(live.length, MATRIX_COLS.length - 1);

  const ranked = useMemo(
    () => [...FIXTURE_SWEEP].sort((a, b) => b.avg - a.avg),
    [],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, minHeight: 0 }}>

      {/* ── Control bar ── */}
      <div style={{ ...CARD, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ marginRight: "auto" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.45, fontWeight: 800 }}>
            Results · Contracts
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: WIN, boxShadow: `0 0 10px ${WIN}` }} />
            Auto-Buy Contract Lab
          </div>
        </div>

        <Seg
          options={["CALL", "PUT"]}
          value={side}
          onChange={(v) => setSide(v as "CALL" | "PUT")}
        />
        <Seg
          options={CLOCKS as unknown as string[]}
          value={clock}
          onChange={(v) => setClock(v as Clock)}
        />
        <Pill tone="warn">FIXTURE DATA — no endpoint wired</Pill>
      </div>

      {/* ── KPI strip ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
        <Kpi k="Spot SPX" v="7,612" d="+18.4 (+0.24%)" dc={WIN} vc={C.lightBlue} />
        <Kpi k="Net GEX" v="−$418M" d={`Below flip 7,640 · amplifying`} vc={SOFT_RED} />
        <Kpi k="Best combo win%" v="63.1%" d="10:15 · V+OR+GEX+TICK" vc={WIN} />
        <Kpi k="Expectancy / trade" v="+$142" d="1 contract · 120 sessions" vc={WIN} />
        <Kpi k="Profit factor" v="1.84" d="Max DD −$1,940" vc={C.gold} />
        <Kpi k="Fire rate" v="41/120" d="34% of sessions qualified" />
        <Kpi k="Avg hold" v="46m" d={`Flatten by ${exit.flatten}`} />
      </div>

      {/* ── Entry stack + gauge/exits ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.05fr) minmax(0,1fr)", gap: 20 }} className="abl-2col">
        <Panel
          title="Entry Rule Stack"
          sub="All armed filters must pass at the clock — AND logic"
          right={<Pill tone={side === "CALL" ? "cyan" : "bad"}>{side} side</Pill>}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(128px,1fr))", gap: 10, marginBottom: 16 }}>
            <Field label="Fire clock" value={`${clock}:00`} color={C.lightBlue} />
            <Field label="OR window" value="30 min" />
            <Field label="Strike rule" value="0.25Δ" />
            <Field label="Resolved" value={side === "CALL" ? "7625 C" : "7595 P"} color={C.gold} />
            <Field label="Size cap" value="2 ct" />
          </div>

          <Micro>Confluence filters</Micro>
          <div style={{ marginTop: 8 }}>
            {FILTERS.map((f) => {
              const on = armed[f.id];
              return (
                <div
                  key={f.id}
                  onClick={() => toggle(f.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(f.id); } }}
                  style={{
                    display: "grid", gridTemplateColumns: "38px 1fr auto 48px", gap: 10, alignItems: "center",
                    padding: "10px 12px", borderRadius: 12, marginBottom: 8, cursor: "pointer",
                    background: on && f.pass
                      ? `linear-gradient(90deg, ${rgba(C.cyan, 0.07)}, ${INSET})`
                      : INSET,
                    border: `1px solid ${
                      !on ? "rgba(255,255,255,0.05)" : f.pass ? rgba(C.cyan, 0.28) : rgba(RED, 0.25)
                    }`,
                    transition: "border-color .15s, background .15s",
                  }}
                >
                  <Switch on={on} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, opacity: on ? 1 : 0.5 }}>{f.name}</div>
                    <div style={{ fontSize: 11, opacity: 0.55, marginTop: 1 }}>{f.detail}</div>
                  </div>
                  {!on
                    ? <Pill tone="off">off</Pill>
                    : f.pass
                      ? <Pill tone="good">● PASS</Pill>
                      : <Pill tone="bad">✕ FAIL</Pill>}
                  <div style={{ fontFamily: MONO, fontSize: 12, opacity: 0.7, textAlign: "right" }}>w {f.weight.toFixed(1)}</div>
                </div>
              );
            })}
          </div>
        </Panel>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>

          {/* Gauge */}
          <Panel
            title={`Confluence at ${clock}:00`}
            sub="Weighted score vs. arm threshold"
            right={
              fires
                ? <Pill tone="good">ARMED — all filters pass</Pill>
                : <Pill tone="warn">{`HOLD — ${failing.length} filter${failing.length === 1 ? "" : "s"} failing`}</Pill>
            }
          >
            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              <Gauge score={score} />
              <div style={{ flex: 1, minWidth: 210 }}>
                <div style={{
                  padding: "12px 16px", borderRadius: 14,
                  border: `1px solid ${rgba(fires ? WIN : C.gold, 0.35)}`,
                  background: `linear-gradient(180deg, ${rgba(fires ? WIN : C.gold, 0.11)}, ${rgba(fires ? WIN : C.gold, 0.02)})`,
                }}>
                  <Micro>Decision</Micro>
                  <div style={{ fontSize: 19, fontWeight: 800, color: fires ? WIN : C.gold, marginTop: 2 }}>
                    {fires ? `FIRE — buy ${side === "CALL" ? "7625 C" : "7595 P"}` : "NO FIRE"}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4, lineHeight: 1.55 }}>
                    {fires
                      ? `Score ${score} of 100, threshold ${ARM_THRESHOLD}. ${live.length} filters armed, all passing.`
                      : failing.length
                        ? `${failing.map((f) => f.name).join(", ")} failing. Score ${score} of 100.`
                        : `Score ${score} of 100 — ${ARM_THRESHOLD - score} short of arm.`}
                  </div>
                </div>

                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                  {(Object.keys(BLOCK_LABEL) as Block[]).map((b) => {
                    const v = blockScores[b];
                    const [a1, a2] = BLOCK_COLOR[b];
                    return (
                      <div key={b}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, opacity: 0.7 }}>
                          <span>{BLOCK_LABEL[b]} block</span>
                          <span style={{ fontFamily: MONO }}>{v == null ? "—" : v}</span>
                        </div>
                        <div style={{ height: 7, borderRadius: 999, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${v ?? 0}%`, borderRadius: 999, background: `linear-gradient(90deg, ${a1}, ${a2})`, transition: "width .25s" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Panel>

          {/* Exits */}
          <Panel
            title="Exit Rule Set"
            sub="First condition to hit wins — evaluated every tick"
            right={<Seg options={EXITS.map((e) => e.id)} value={exitId} onChange={(v) => setExitId(v as ExitVariant["id"])} />}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
              <Field label="Profit target" value={exit.target} color={WIN} />
              <Field label="Hard stop" value={exit.stop} color={SOFT_RED} />
              <Field label="Trail" value={exit.trail} color={C.gold} />
              <Field label="Time flatten" value={exit.flatten} />
              <Field label="Structure stop" value={exit.structure} color={C.lightBlue} />
              <Field label="GEX veto exit" value={exit.gexVeto} color={C.orange} />
            </div>

            <div style={{ borderTop: `1px solid ${C.border}`, margin: "14px 0" }} />
            <Micro>Which condition actually closed the trade</Micro>
            <div style={{ display: "flex", height: 9, borderRadius: 999, overflow: "hidden", marginTop: 9 }}>
              {exit.mix.map((pct, i) => (
                <div key={i} style={{ width: `${pct}%`, background: EXIT_MIX_COLORS[i], transition: "width .25s" }} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, opacity: 0.75, marginTop: 9 }}>
              {EXIT_MIX_LABELS.map((l, i) => (
                <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: EXIT_MIX_COLORS[i] }} />
                  {l} {exit.mix[i]}%
                </span>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* ── Matrix + lift ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.05fr) minmax(0,1fr)", gap: 20 }} className="abl-2col">

        <Panel title="Fire Clock × Filter Stack" sub="Expectancy per fired trade, 120 sessions · 1 contract">
          <div style={{ display: "grid", gridTemplateColumns: `96px repeat(${MATRIX_COLS.length},1fr)`, gap: 4, fontSize: 11 }}>
            <div />
            {MATRIX_COLS.map((c) => (
              <div key={c} style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.5, fontWeight: 800, textAlign: "center", padding: "6px 2px" }}>
                {c}
              </div>
            ))}
            {CLOCKS.map((ck) => (
              <React.Fragment key={ck}>
                <div
                  onClick={() => setClock(ck)}
                  style={{
                    fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", paddingRight: 8,
                    cursor: "pointer", opacity: ck === clock ? 1 : 0.7, color: ck === clock ? WIN : "inherit",
                  }}
                >
                  {ck}{ck === clock ? " ★" : ""}
                </div>
                {MATRIX[ck].map((v, i) => {
                  const hot = ck === clock && i === stackCol;
                  return (
                    <div
                      key={i}
                      title={`${ck} · ${MATRIX_COLS[i]} · ${v >= 0 ? "+" : "−"}$${Math.abs(v)}`}
                      style={{
                        borderRadius: 7, padding: "9px 6px", textAlign: "center", fontFamily: MONO, fontWeight: 700,
                        background: heat(v),
                        border: `1px solid ${hot ? rgba(WIN, 0.6) : "rgba(255,255,255,0.06)"}`,
                        boxShadow: hot ? `0 0 16px ${rgba(WIN, 0.25)}` : "none",
                      }}
                    >
                      {v >= 0 ? `+${v}` : v}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          <div style={{ fontSize: 11, opacity: 0.5, lineHeight: 1.55, marginTop: 12 }}>
            Each cell is mean P/L per fired trade under the exit set above. Columns are cumulative — “+GEX” means
            VWAP + OR + GEX. Cells with fewer than 12 fires are not shown. Click a row label to move the fire clock.
          </div>
        </Panel>

        <Panel title="Filter Contribution" sub="Marginal lift · drop-one-out vs. full stack" right={<Pill tone="cyan">{`${clock} · ${side}`}</Pill>}>
          <LiftChart />
          <div style={{ fontSize: 11, opacity: 0.5, lineHeight: 1.55, marginTop: 10 }}>
            RVOL is the only armed filter costing expectancy at this clock — it cuts 23 fires and removes more winners
            than losers. Candidate for disarm, or a 1.15× threshold.
          </div>
        </Panel>
      </div>

      {/* ── Equity curves ── */}
      <Panel
        title="Test Runs — Equity Curves"
        sub="Cumulative P/L, 1 contract, 120 sessions"
        right={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {RUNS.map((r) => (
              <div key={r.name} style={{ padding: "8px 12px", borderRadius: 12, border: `1px solid ${C.border}`, background: INSET, fontSize: 11, minWidth: 118 }}>
                <div style={{ fontWeight: 800, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color }} />{r.name}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 800, marginTop: 3, color: r.total >= 0 ? r.color : SOFT_RED }}>
                  {r.total >= 0 ? "+" : "−"}${Math.abs(r.total).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        }
      >
        <EquityChart />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.4, marginTop: 6, letterSpacing: "0.1em" }}>
          {["APR 2026", "MAY", "JUN", "JUL", "AUG", "SEP 17"].map((m) => <span key={m}>{m}</span>)}
        </div>
      </Panel>

      {/* ── Sweep table + trade log ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 20 }} className="abl-2col">

        <Panel title="Sweep Results" sub="Ranked by expectancy · min 20 fires">
          <div style={{ overflowX: "auto" }} className="wall-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>{["Entry stack", "Clock", "Exit", "Fires", "Win%", "Avg", "PF", "Max DD"].map((h, i) => (
                  <th key={h} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => {
                  const best = i === 0;
                  return (
                    <tr key={`${r.stack}-${r.clock}-${r.exit}`} style={best ? { background: rgba(WIN, 0.07) } : undefined}>
                      <td style={{ ...td, textAlign: "left", fontFamily: "inherit", boxShadow: best ? `inset 3px 0 0 ${WIN}` : undefined }}>{r.stack}</td>
                      <td style={td}>{r.clock}</td>
                      <td style={{ ...td, fontFamily: "inherit" }}>{r.exit}</td>
                      <td style={td}>{r.fires}</td>
                      <td style={{ ...td, color: r.win >= 0.5 ? WIN : SOFT_RED }}>{(r.win * 100).toFixed(1)}%</td>
                      <td style={{ ...td, color: r.avg >= 0 ? WIN : SOFT_RED }}>{r.avg >= 0 ? "+" : "−"}${Math.abs(r.avg)}</td>
                      <td style={td}>{r.pf.toFixed(2)}</td>
                      <td style={{ ...td, color: SOFT_RED }}>−${Math.abs(r.dd).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Fired Trades" sub={`Last ${FIXTURE_LOG.length} qualifying sessions · exit set ${exitId}`}>
          <div style={{ overflowX: "auto" }} className="wall-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>{["Date", "Side", "Strike", "Score", "In", "Out", "Exit", "P/L"].map((h, i) => (
                  <th key={h} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {FIXTURE_LOG.map((t) => (
                  <tr key={t.date}>
                    <td style={{ ...td, textAlign: "left", fontFamily: "inherit" }}>{t.date}</td>
                    <td style={{ ...td, fontFamily: "inherit", color: t.side === "CALL" ? C.lightBlue : SOFT_RED }}>{t.side}</td>
                    <td style={td}>{t.strike}</td>
                    <td style={td}>{t.score}</td>
                    <td style={td}>{t.entry.toFixed(2)}</td>
                    <td style={td}>{t.exit.toFixed(2)}</td>
                    <td style={{ ...td, fontFamily: "inherit" }}>
                      <Pill tone={REASON_TONE[t.reason]}>{t.reason}</Pill>
                    </td>
                    <td style={{ ...td, color: t.pl >= 0 ? WIN : SOFT_RED }}>{t.pl >= 0 ? "+" : "−"}${Math.abs(t.pl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* ── Guardrails ── */}
      <Panel
        title="Guardrails & Live Arm"
        sub="Applied before any order leaves the box"
        right={<Pill tone="warn">PAPER — arming is not wired</Pill>}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))", gap: 10 }}>
          <Field label="Max contracts" value="2" />
          <Field label="Max daily risk" value="$800" color={SOFT_RED} />
          <Field label="Trades / day" value="1" />
          <Field label="Consecutive loss halt" value="3" />
          <Field label="Min bid/ask width" value="≤ $0.30" />
          <Field label="Min OI at strike" value="1,500" />
          <Field label="No new entries after" value="12:00 ET" />
          <Field label="Kill switch" value="ARMED" color={RED} />
        </div>
        <div style={{ fontSize: 11, opacity: 0.5, lineHeight: 1.55, marginTop: 12 }}>
          Nothing on this tab routes an order. The numbers are fixtures for layout review until
          <span style={{ fontFamily: MONO }}> /api/autobuy-lab </span>
          exists; the shapes above are what it should return.
        </div>
      </Panel>

      {/* One-column fallback — the grids above are 2-up on a desktop only. */}
      <style>{`@media (max-width: 1180px) { .abl-2col { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────

const th: React.CSSProperties = {
  fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.5, fontWeight: 800,
  textAlign: "right", padding: "8px 10px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "9px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "right",
  fontFamily: MONO, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
};

function Panel({ title, sub, right, children }: {
  title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div style={{ ...CARD, padding: 22, minWidth: 0 }} className="card-hover">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: GREEN, marginTop: 2 }}>{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Micro({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.55, fontWeight: 700 }}>{children}</div>;
}

function Field({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: INSET, border: `1px solid ${C.border}`, borderRadius: 11, padding: "10px 12px" }}>
      <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.5, fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 800, marginTop: 3, color: color ?? "inherit" }}>{value}</div>
    </div>
  );
}

function Kpi({ k, v, d, vc, dc }: { k: string; v: string; d: string; vc?: string; dc?: string }) {
  return (
    <div style={{ ...CARD, padding: "14px 16px" }}>
      <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.5, fontWeight: 700, marginBottom: 4 }}>{k}</div>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", fontFamily: MONO, fontVariantNumeric: "tabular-nums", lineHeight: 1.15, color: vc ?? "inherit" }}>{v}</div>
      <div style={{ fontSize: 11, marginTop: 3, opacity: 0.75, color: dc ?? "inherit" }}>{d}</div>
    </div>
  );
}

type Tone = "good" | "bad" | "warn" | "off" | "cyan";
const TONE: Record<Tone, string> = { good: WIN, bad: RED, warn: HOME_THEME.gold, off: "#ffffff", cyan: C.cyan };
function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const c = TONE[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999,
      fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
      background: rgba(c, tone === "off" ? 0.05 : 0.12),
      border: `1px solid ${rgba(c, tone === "off" ? 0.12 : 0.3)}`,
      color: tone === "off" ? "rgba(255,255,255,0.4)" : tone === "cyan" ? C.lightBlue : c,
    }}>{children}</span>
  );
}

const REASON_TONE: Record<LoggedTrade["reason"], Tone> = {
  target: "good", trail: "warn", struct: "cyan", stop: "bad", time: "off",
};

function Switch({ on }: { on: boolean }) {
  return (
    <div style={{
      width: 34, height: 19, borderRadius: 999, position: "relative",
      background: on ? `linear-gradient(90deg, ${rgba(C.cyan, 0.5)}, ${rgba(C.lightBlue, 0.55)})` : "rgba(255,255,255,0.10)",
      border: `1px solid ${on ? rgba(C.cyan, 0.5) : C.border}`,
      boxShadow: on ? `0 0 12px ${rgba(C.cyan, 0.3)}` : "none",
      transition: "background .15s",
    }}>
      <span style={{
        position: "absolute", top: 2, left: on ? 17 : 2, width: 13, height: 13, borderRadius: "50%",
        background: on ? "#fff" : "#cfd6de", transition: "left .15s",
      }} />
    </div>
  );
}

function Seg({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 4, background: INSET, padding: 4, borderRadius: 12, border: `1px solid ${C.border}` }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            style={{
              fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 9, cursor: "pointer",
              fontFamily: "inherit",
              border: `1px solid ${on ? rgba(C.cyan, 0.3) : "transparent"}`,
              background: on ? `linear-gradient(180deg, ${rgba(C.cyan, 0.16)}, ${rgba(C.cyan, 0.04)})` : "transparent",
              color: on ? C.lightBlue : "rgba(255,255,255,0.55)",
              boxShadow: on ? `0 0 14px ${rgba(C.cyan, 0.18)}` : "none",
            }}
          >{o}</button>
        );
      })}
    </div>
  );
}

/** Semicircular confluence gauge. The white tick is the arm threshold. */
function Gauge({ score }: { score: number }) {
  // 226 is the arc length of the 72px-radius semicircle path below.
  const LEN = 226;
  const offset = LEN - (LEN * Math.max(0, Math.min(100, score))) / 100;
  const tickA = Math.PI * (1 - ARM_THRESHOLD / 100);
  const tx = 88 + 72 * Math.cos(tickA);
  const ty = 100 - 72 * Math.sin(tickA);
  return (
    <svg width="176" height="112" viewBox="0 0 176 112" aria-label={`Confluence score ${score}`}>
      <defs>
        <linearGradient id="abl-gauge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={RED} />
          <stop offset="45%" stopColor={HOME_THEME.gold} />
          <stop offset="100%" stopColor={WIN} />
        </linearGradient>
      </defs>
      <path d="M16 100 A72 72 0 0 1 160 100" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="15" strokeLinecap="round" />
      <path
        d="M16 100 A72 72 0 0 1 160 100" fill="none" stroke="url(#abl-gauge)" strokeWidth="15" strokeLinecap="round"
        strokeDasharray={LEN} strokeDashoffset={offset} opacity="0.95"
        style={{ transition: "stroke-dashoffset .3s ease" }}
      />
      <line x1={tx} y1={ty} x2={tx + 9} y2={ty - 8} stroke="#fff" strokeWidth="2" opacity="0.65" />
      <text x="88" y="86" textAnchor="middle" fontSize="30" fontWeight="900" fill="#fff" fontFamily="ui-monospace,monospace">{score}</text>
      <text x="88" y="103" textAnchor="middle" fontSize="9" fill="rgba(255,255,255,.5)" letterSpacing="1.5">{`ARM ≥ ${ARM_THRESHOLD}`}</text>
    </svg>
  );
}

function LiftChart() {
  const rows = [...FILTERS].sort((a, b) => b.lift - a.lift);
  const max = Math.max(...rows.map((r) => Math.abs(r.lift)), 1);
  const H = 36;
  return (
    <svg viewBox={`0 0 520 ${rows.length * H + 32}`} width="100%" height={rows.length * H + 32} fontFamily="Inter, sans-serif">
      {[240, 300, 360, 420, 480].map((x) => (
        <line key={x} x1={x} y1="6" x2={x} y2={rows.length * H} stroke="rgba(255,255,255,0.07)" />
      ))}
      <line x1="180" y1="6" x2="180" y2={rows.length * H} stroke="rgba(255,255,255,0.28)" />
      {rows.map((r, i) => {
        const y = i * H + 12;
        const w = (Math.abs(r.lift) / max) * 290;
        const pos = r.lift >= 0;
        return (
          <g key={r.id}>
            <text x="170" y={y + 14} fontSize="11" fill={pos ? "rgba(255,255,255,.82)" : "rgba(255,255,255,.5)"} textAnchor="end">{r.name}</text>
            <rect x={pos ? 180 : 180 - w} y={y} width={w} height="19" rx="4" fill={pos ? C.cyan : RED} opacity={pos ? 0.45 + 0.4 * (Math.abs(r.lift) / max) : 0.7} />
            <text x={pos ? 180 + w + 8 : 180 - w - 8} y={y + 14} fontSize="11" fontFamily="ui-monospace,monospace" textAnchor={pos ? "start" : "end"} fill={pos ? "#fff" : SOFT_RED}>
              {pos ? `+$${r.lift}` : `−$${Math.abs(r.lift)}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function EquityChart() {
  return (
    <svg viewBox="0 0 1200 300" width="100%" height="300" preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id="abl-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={WIN} stopOpacity="0.22" />
          <stop offset="100%" stopColor={WIN} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[40, 95, 150, 205].map((y) => <line key={y} x1="0" y1={y} x2="1200" y2={y} stroke="rgba(255,255,255,0.06)" />)}
      <line x1="0" y1="232" x2="1200" y2="232" stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" />
      {RUNS.map((r) => (
        <polyline key={r.name} fill="none" stroke={r.color} strokeWidth={r.width} opacity={r.opacity} points={r.points} />
      ))}
      <path d={`M${RUNS[0].points.replace(/ /g, " L")} L1200,232 Z`} fill="url(#abl-fill)" />
      <polyline fill="none" stroke={RUNS[0].color} strokeWidth="2.6" points={RUNS[0].points} />
    </svg>
  );
}

/** Red → transparent → green wash for a matrix cell. */
function heat(v: number): string {
  const mag = Math.min(Math.abs(v) / 150, 1);
  if (v > 8) return rgba(WIN, 0.10 + mag * 0.62);
  if (v < -8) return rgba(RED, 0.08 + mag * 0.5);
  return "rgba(255,255,255,0.08)";
}

// ── FIXTURES — replace with /api/autobuy-lab ────────────────────────────────

const FILTERS: FilterDef[] = [
  { id: "vwap", name: "VWAP + slope", detail: "Price > VWAP, slope up over last 5 bars", block: "trend", weight: 1.0, armed: true, pass: true, lift: 56 },
  { id: "or", name: "Opening range + retest", detail: "Break 30m high 7608.5, retest held 10:07", block: "trend", weight: 1.0, armed: true, pass: true, lift: 35 },
  { id: "gex", name: "GEX regime", detail: "Not pinned into wall · flip 7640 · call wall 7675", block: "dealer", weight: 1.5, armed: true, pass: true, lift: 71 },
  { id: "internals", name: "TICK / ADD / VOLD", detail: "TICK +412 · ADD +1,180 · VOLD +2.1B", block: "internals", weight: 1.2, armed: true, pass: true, lift: 44 },
  { id: "ema", name: "EMA stack 8 / 21 / 50 (5m)", detail: "Stacked bullish, price above all three", block: "trend", weight: 0.8, armed: true, pass: true, lift: 20 },
  { id: "rvol", name: "Relative volume ≥ 1.4×", detail: "Session RVOL 1.18× — below threshold", block: "participation", weight: 0.6, armed: true, pass: false, lift: -9 },
  { id: "cvd", name: "Cumulative volume delta", detail: "CVD rising, no bearish divergence", block: "internals", weight: 0.7, armed: true, pass: true, lift: 12 },
  { id: "vix1d", name: "VIX1D regime band", detail: "12.5 to 22 band — currently 15.8", block: "dealer", weight: 0.5, armed: false, pass: true, lift: 8 },
  { id: "cal", name: "No scheduled event ±30m", detail: "Econ calendar veto — clear today", block: "participation", weight: 0.5, armed: false, pass: true, lift: 4 },
];

const EXIT_MIX_LABELS = ["target", "trail", "struct", "stop", "time"];
const EXIT_MIX_COLORS = [WIN, HOME_THEME.gold, HOME_THEME.lightBlue, RED, "rgba(255,255,255,0.35)"];

const EXITS: ExitVariant[] = [
  {
    id: "A", label: "Hard bracket", target: "+50%", stop: "−50%", trail: "none",
    flatten: "14:00 ET", structure: "none", gexVeto: "off", mix: [31, 0, 0, 47, 22],
  },
  {
    id: "B", label: "Fixed + structure", target: "+60%", stop: "−40%", trail: "none",
    flatten: "13:30 ET", structure: "VWAP lost 2 bars", gexVeto: "off", mix: [35, 0, 21, 32, 12],
  },
  {
    id: "C", label: "Scale + trail", target: "+65%, ½ at +35%", stop: "−40%", trail: "+45% → 20% give-back",
    flatten: "13:30 ET", structure: "VWAP lost 2 bars", gexVeto: "Flip crossed vs. side", mix: [38, 19, 14, 22, 7],
  },
];

const MATRIX_COLS = ["Naked", "+VWAP", "+OR", "+GEX", "+TICK", "Full"];

const MATRIX: Record<Clock, number[]> = {
  "09:45": [-96, -41, 12, 48, 61, 77],
  "10:00": [-54, 9, 66, 98, 112, 131],
  "10:15": [-28, 52, 94, 124, 136, 142],
  "10:30": [-17, 44, 83, 109, 118, 129],
  "10:45": [-33, 18, 55, 76, 88, 101],
  "11:30": [-71, -22, 6, 29, 37, 46],
  "14:00": [-148, -104, -67, -39, -24, -11],
};

const RUNS = [
  { name: "C · Full + trail", color: WIN, total: 5822, width: 2.6, opacity: 1, points: "0,232 60,221 120,210 180,216 240,198 300,188 360,194 420,173 480,161 540,168 600,147 660,135 720,142 780,121 840,109 900,116 960,96 1020,84 1080,91 1140,72 1200,62" },
  { name: "B · No RVOL", color: HOME_THEME.lightBlue, total: 6410, width: 2.2, opacity: 0.9, points: "0,232 60,218 120,205 180,212 240,190 300,178 360,186 420,162 480,148 540,156 600,132 660,118 720,126 780,102 840,88 900,96 960,74 1020,60 1080,68 1140,48 1200,36" },
  { name: "A · VWAP only", color: HOME_THEME.gold, total: 2131, width: 1.8, opacity: 0.85, points: "0,232 60,224 120,229 180,214 240,220 300,203 360,209 420,192 480,198 540,183 600,190 660,176 720,181 780,168 840,174 900,161 960,166 1020,155 1080,160 1140,150 1200,154" },
  { name: "Blind 10:15", color: RED, total: -1148, width: 1.8, opacity: 0.8, points: "0,232 60,226 120,241 180,233 240,252 300,244 360,261 420,250 480,268 540,258 600,272 660,263 720,277 780,266 840,281 900,270 960,285 1020,274 1080,288 1140,278 1200,283" },
];

const FIXTURE_SWEEP: SweepRow[] = [
  { stack: "VWAP·OR·GEX·TICK·EMA·CVD", clock: "10:15", exit: "C trail", fires: 41, win: 0.634, avg: 142, pf: 1.84, dd: 1940 },
  { stack: "VWAP·OR·GEX·TICK·EMA·CVD", clock: "10:00", exit: "C trail", fires: 47, win: 0.596, avg: 131, pf: 1.71, dd: 2180 },
  { stack: "VWAP·OR·GEX·TICK·EMA", clock: "10:30", exit: "C trail", fires: 52, win: 0.577, avg: 129, pf: 1.66, dd: 2340 },
  { stack: "VWAP·OR·GEX·TICK", clock: "10:15", exit: "B fixed", fires: 58, win: 0.552, avg: 118, pf: 1.54, dd: 2610 },
  { stack: "VWAP·OR·GEX", clock: "10:15", exit: "C trail", fires: 66, win: 0.530, avg: 101, pf: 1.42, dd: 2880 },
  { stack: "VWAP·OR·GEX·TICK·RVOL", clock: "10:15", exit: "C trail", fires: 26, win: 0.577, avg: 88, pf: 1.33, dd: 1720 },
  { stack: "VWAP·OR", clock: "10:15", exit: "A hard", fires: 79, win: 0.481, avg: 52, pf: 1.16, dd: 3410 },
  { stack: "VWAP only", clock: "10:15", exit: "A hard", fires: 94, win: 0.447, avg: 23, pf: 1.06, dd: 3960 },
  { stack: "None (blind timed)", clock: "10:15", exit: "A hard", fires: 120, win: 0.383, avg: -10, pf: 0.97, dd: 4720 },
  { stack: "Full stack", clock: "14:00", exit: "C trail", fires: 33, win: 0.364, avg: -11, pf: 0.94, dd: 2050 },
];

const FIXTURE_LOG: LoggedTrade[] = [
  { date: "Sep 16", side: "CALL", strike: 7590, score: 84, entry: 4.10, exit: 6.80, reason: "target", pl: 270 },
  { date: "Sep 15", side: "PUT", strike: 7545, score: 79, entry: 5.25, exit: 3.15, reason: "stop", pl: -210 },
  { date: "Sep 11", side: "CALL", strike: 7520, score: 91, entry: 3.70, exit: 7.55, reason: "target", pl: 385 },
  { date: "Sep 10", side: "CALL", strike: 7505, score: 77, entry: 4.60, exit: 5.95, reason: "trail", pl: 135 },
  { date: "Sep 08", side: "PUT", strike: 7480, score: 82, entry: 4.95, exit: 8.10, reason: "target", pl: 315 },
  { date: "Sep 04", side: "CALL", strike: 7455, score: 76, entry: 3.85, exit: 3.10, reason: "struct", pl: -75 },
  { date: "Sep 03", side: "PUT", strike: 7430, score: 88, entry: 5.40, exit: 8.95, reason: "trail", pl: 355 },
  { date: "Aug 29", side: "CALL", strike: 7410, score: 75, entry: 4.20, exit: 2.52, reason: "stop", pl: -168 },
  { date: "Aug 27", side: "CALL", strike: 7385, score: 86, entry: 3.95, exit: 6.52, reason: "target", pl: 257 },
  { date: "Aug 26", side: "PUT", strike: 7360, score: 80, entry: 4.75, exit: 4.90, reason: "time", pl: 15 },
];
