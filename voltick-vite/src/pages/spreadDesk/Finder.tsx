/**
 * Spread Desk · Strike finder. Ticker, lean and DTE in; a strike ladder with the
 * walls, the flip and the expected move, plus candidate short strikes checked
 * against the member's own rules. Describes structure, never recommends.
 */
import { useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import {
  ACCENT, ACCENT_TEXT, BAD, ELEV, FLIP, FLIP_MARK, GOOD, INK, LINE, MONO, PAPER, PAPER_QUIET,
  R_LG, R_MD, SKY, SURGE, WALL_MARK, W_BOLD, labelStyle, numStyle, rgba,
} from "../../theme";
import {
  BOARDS, Phi, TICKERS, at, buildCands, conditions, emOf, evalStrike, expLabel, f2, fk, gexAt, money, pct, snap,
  strikes, widthFor,
} from "./model";
import type { Cand, Lean, PositionInput, Rules, SideGroup, Ticker } from "./model";
import { Bar, Btn, CheckRow, Chips, Field, Panel, Pill, Seg, Stat, inputStyle } from "./ui";

type Props = {
  R: Rules;
  tracked: (p: PositionInput) => boolean;
  onTrack: (p: PositionInput) => void;
  goRules: () => void;
};

export default function Finder({ R, tracked, onTrack, goRules }: Props) {
  const [tk, setTk] = useState<Ticker>("SPY");
  const [lean, setLean] = useState<Lean>("neutral");
  const [dte, setDte] = useState<number>(R.dte);
  const [width, setWidth] = useState<number>(R.width);
  const [cushion, setCushion] = useState(1);
  const [myK, setMyK] = useState<number | null>(null);
  const [mySide, setMySide] = useState<"put" | "call">("put");

  const b = BOARDS[tk];
  const groups = useMemo(() => buildCands(R, b, lean, dte, width, cushion), [R, b, lean, dte, width, cushion]);
  const w = widthFor(b, width);
  const spot = at(b, "spot"), flip = at(b, "flip"), cw = at(b, "callWall"), pw = at(b, "putWall");
  const s = emOf(spot, b.iv, dte);
  const cond = conditions(R, b);
  const riskPct = dte === 0 ? R.zRisk : R.riskPct;

  const pick = (k: number) => {
    setMyK(k);
    setMySide(k > spot ? "call" : "put");
  };
  const mine = myK != null && isFinite(myK) ? evalStrike(R, b, myK, mySide === "call", dte, w) : null;

  const all = groups.flatMap((g) => g.rows);
  const anyFull = all.some((r) => r.passN === r.checks.length);
  const closest = all.slice().sort((a, z) => z.passN - a.passN)[0];

  return (
    <div className="sd-finder">
      {/* ── inputs + board facts ── */}
      <Panel title="Your inputs" aside="You drive">
        <div style={{ padding: 14, display: "grid", gap: 16 }}>
          <Field label="Ticker" htmlFor="sd-tk">
            <select id="sd-tk" value={tk} onChange={(e) => { setTk(e.target.value as Ticker); setMyK(null); }} style={inputStyle}>
              {TICKERS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field
            label="Your lean"
            hint={lean === "neutral" ? "Neutral looks at both sides and builds an iron condor." : lean === "bull" ? "Bullish looks below price: a put credit spread." : "Bearish looks above price: a call credit spread."}
          >
            <Seg label="Your lean" value={lean} onChange={setLean} options={[["bear", "Bearish"], ["neutral", "Neutral"], ["bull", "Bullish"]]} />
          </Field>
          <Field label="Days to expiration" hint={`Your rules default to ${R.dte} DTE.`}>
            <Seg label="Days to expiration" value={dte} onChange={setDte} options={[0, 7, 14, 21, 30, 45].map((d) => [d, String(d)] as [number, string])} />
          </Field>
          <div className="sd-row2">
            <Field label="Width ($)" htmlFor="sd-w">
              <input id="sd-w" type="number" min={1} max={25} value={width} onChange={(e) => +e.target.value > 0 && setWidth(+e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Past the wall" htmlFor="sd-c">
              <select id="sd-c" value={cushion} onChange={(e) => setCushion(+e.target.value)} style={inputStyle}>
                <option value={0}>On the wall</option>
                <option value={1}>1 strike</option>
                <option value={2}>2 strikes</option>
                <option value={3}>3 strikes</option>
              </select>
            </Field>
          </div>
        </div>
        <div style={{ padding: "4px 14px 14px", display: "grid", gap: 8 }}>
          <div style={labelStyle}>Board now</div>
          {([
            ["Price", f2(spot), PAPER],
            [`${WALL_MARK} Call wall`, fk(cw), SURGE],
            [`${WALL_MARK} Put wall`, fk(pw), SURGE],
            [`${FLIP_MARK} Gamma flip`, fk(flip), FLIP],
            [`Expected move · ${dte}d`, `±${f2(s)}`, PAPER],
            ["Implied vol · IV rank", `${f2(b.iv * 100, 1)}% · ${b.ivr}`, PAPER],
            ["Realized vol (20d)", `${f2(b.rv * 100, 1)}%`, PAPER],
            ["IV minus realized", `${cond.vrp > 0 ? "+" : ""}${f2(cond.vrp * 100, 1)} pts`, cond.vrp > 0 ? GOOD : BAD],
          ] as [string, string, string][]).map(([l, v, c]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, borderTop: `1px dashed ${LINE}`, paddingTop: 8 }}>
              <span style={{ color: PAPER_QUIET }}>{l}</span>
              <span style={{ ...numStyle, color: c }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ margin: "0 14px 14px", padding: 12, borderRadius: R_LG, border: `1px solid ${LINE}`, background: ELEV, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={labelStyle}>Conditions</span>
            <span style={{ ...numStyle, fontSize: 12 }}>{cond.score}/3</span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {[0, 1, 2].map((i) => <i key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: i < cond.score ? GOOD : LINE }} />)}
          </div>
          <div><Pill wrap tone={cond.sticky ? (cond.score >= 2 ? "good" : "watch") : "alert"}>{cond.sticky ? (cond.score === 3 ? "Positive gamma · rich premium" : "Positive gamma") : "Negative gamma · moves tend to extend"}</Pill></div>
          <CheckRow lvl={cond.sticky ? "ok" : "watch"}>{cond.sticky ? "Price above the flip. Dealers dampen moves." : "Price below the flip. Dealers amplify moves."}</CheckRow>
          <CheckRow lvl={cond.ivrOk ? "ok" : "watch"}>IV rank {b.ivr} {cond.ivrOk ? "meets" : "is under"} your minimum of {R.minIVR}.</CheckRow>
          <CheckRow lvl={cond.vrp > 0 ? "ok" : "watch"}>{cond.vrp > 0 ? "Implied vol is above realized: options are priced for more movement than recent days delivered." : "Implied vol is below realized: premium is thin against recent movement."}</CheckRow>
        </div>
      </Panel>

      <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
        {dte === 0 && (
          <div style={{ padding: "10px 14px", borderRadius: R_LG, border: `1px solid ${rgba(SKY, 0.4)}`, background: rgba(SKY, 0.08), fontSize: 12.5, color: PAPER }}>
            <b>0DTE uses your separate rule set:</b> {R.zProfit}% profit level, {R.zLoss}× credit loss level, {R.zRisk}% risk per trade, nothing held into the close.
            {!b.daily && ` ${tk} has no daily expirations, so this reading is for illustration only.`}
          </div>
        )}

        {/* ── ladder ── */}
        <Panel title={`${tk} · dealer gamma by strike`} aside={`${expLabel(dte)} · ${dte} DTE`}>
          <div className="sd-ladder">
            <Ladder tk={tk} dte={dte} w={w} R={R} groups={groups} myK={myK} onPick={pick} />
            <div style={{ padding: 16, display: "grid", gap: 14, alignContent: "start" }}>
              <div style={labelStyle}>Plain-English read</div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: W_BOLD, color: PAPER }}>{tk} is boxed between {fk(pw)} and {fk(cw)}</h3>
              <p style={{ margin: 0, fontSize: 13, color: PAPER }}>
                The call wall sits <b>{f2(cw - spot)}</b> above price ({f2((cw - spot) / s)}σ) and the put wall <b>{f2(spot - pw)}</b> below ({f2((spot - pw) / s)}σ) for a {dte === 0 ? "same-day" : `${dte}-day`} expiration.
                Price is {cond.sticky ? "above" : "below"} the flip at {fk(flip)}, so dealers are{" "}
                {cond.sticky ? "more likely to dampen moves (sticky tape)." : "more likely to amplify moves (slippery tape). Walls hold less reliably in this regime."}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px", fontSize: 11.5, color: PAPER_QUIET }}>
                {([[GOOD, "Positive gamma"], [BAD, "Negative gamma"], [rgba(ACCENT, 0.4), "Expected move"], [FLIP, "Gamma flip"], [ACCENT, "Wall candidate"], [PAPER_QUIET, "Delta strikes"], [SKY, "Your strike"]] as [string, string][]).map(([c, l]) => (
                  <span key={l}><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: c, marginRight: 5, verticalAlign: -1 }} />{l}</span>
                ))}
              </div>
              <p style={{ margin: 0, fontSize: 12, color: PAPER_QUIET }}>
                A <b style={{ color: PAPER }}>wall</b> is the strike where dealers hold the most gamma on one side. Price has often slowed or turned there.
                A short strike just past a wall has that level standing between it and price. One in <b style={{ color: PAPER }}>open air</b> does not.
              </p>
              <p style={{ margin: 0, fontSize: 12, color: PAPER_QUIET }}>Hover the ladder for each strike's delta and odds. Click any strike to check it against your rules.</p>
            </div>
          </div>
        </Panel>

        {/* ── strike checker ── */}
        <Panel title="Check your own strike" aside="Click the ladder or type one">
          <div className="sd-checker">
            <div className="sd-row2">
              <Field label="Short strike" htmlFor="sd-myk">
                <input id="sd-myk" type="number" step={0.5} value={myK ?? ""} onChange={(e) => { const v = parseFloat(e.target.value); setMyK(isFinite(v) ? v : null); }} style={inputStyle} />
              </Field>
              <Field label="Side" htmlFor="sd-side">
                <select id="sd-side" value={mySide} onChange={(e) => setMySide(e.target.value as "put" | "call")} style={inputStyle}>
                  <option value="put">Put</option>
                  <option value="call">Call</option>
                </select>
              </Field>
            </div>
            <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
              {!mine ? (
                <>
                  <b style={{ color: PAPER }}>No strike picked yet</b>
                  <span style={{ fontSize: 12.5, color: PAPER_QUIET }}>Click a row on the ladder above, or type a strike and side.</span>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <span style={{ ...numStyle, fontWeight: 800, fontSize: 15 }}>{legs(mine)}</span>
                    <StructurePill c={mine} />
                    {!mine.itm && <Pill tone={mine.passN === mine.checks.length ? "good" : "plain"}>{mine.passN}/{mine.checks.length} of your rules</Pill>}
                  </div>
                  <span style={{ fontSize: 12.5, color: PAPER }}>
                    {structureText(mine)}{" "}
                    {!mine.itm && `${f2(mine.delta, 0)}Δ · ${f2(mine.sd)}σ from price · model credit $${f2(mine.cr)} (${Math.round(mine.ratio * 100)}% of width) · POP ${pct(mine.pop)} · ${mine.qty} contract${mine.qty === 1 ? "" : "s"} at your risk size.`}
                  </span>
                  {!mine.itm && <Chips checks={mine.checks} />}
                </>
              )}
            </div>
            <Btn disabled={!mine || mine.itm} onClick={() => mine && onTrack({ tk, type: mySide, short: mine.shortK, long: mine.longK, dte, cr: +f2(mine.cr), qty: Math.max(1, mine.qty) })}>
              Track this
            </Btn>
          </div>
        </Panel>

        {/* ── condor ── */}
        {lean === "neutral" && <Condor R={R} tk={tk} dte={dte} groups={groups} tracked={tracked} onTrack={onTrack} riskPct={riskPct} />}

        {/* ── candidates ── */}
        <Panel title="Candidate short strikes" aside="Wall candidate + 15/20/25Δ · checked against your rules">
          <div style={{ padding: 12, display: "grid", gap: 10 }}>
            {!anyFull && closest && (
              <div style={{ padding: "10px 14px", borderRadius: R_LG, border: `1px solid ${rgba(SKY, 0.4)}`, background: rgba(SKY, 0.08), fontSize: 12.5, color: PAPER }}>
                <b>No candidate on this board meets every one of your rules.</b> The closest is {fk(closest.shortK)}{closest.call ? "C" : "P"} ({closest.passN}/{closest.checks.length}), which misses: {closest.checks.filter((c) => !c.ok).map((c) => c.t).join(", ")}.
                Try another expiration or ticker, or adjust{" "}
                <button type="button" onClick={goRules} style={{ border: 0, background: "none", padding: 0, font: "inherit", color: ACCENT_TEXT, textDecoration: "underline", cursor: "pointer" }}>My rules</button>.
              </div>
            )}
            {groups.map((g) => (
              <div key={g.side} style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: PAPER_QUIET, paddingTop: 4 }}>
                  <Pill tone="accent">{g.side === "call" ? "Call side · above price" : "Put side · below price"}</Pill>
                  Far to near. The outlined row sits behind the wall.
                </div>
                {g.rows.map((c) => (
                  <CandRow key={c.shortK} c={c} dte={dte} riskPct={riskPct}
                    isTracked={tracked({ tk, type: c.call ? "call" : "put", short: c.shortK, long: c.longK, dte })}
                    onTrack={() => onTrack({ tk, type: c.call ? "call" : "put", short: c.shortK, long: c.longK, dte, cr: +f2(c.cr), qty: Math.max(1, c.qty) })} />
                ))}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

const legs = (c: Cand | ReturnType<typeof evalStrike>) => `${fk(c.shortK)}${c.call ? "C" : "P"} / ${fk(c.longK)}${c.call ? "C" : "P"}`;

function structureText(c: ReturnType<typeof evalStrike>) {
  if (c.itm) return `This ${c.call ? "call" : "put"} strike is already on the wrong side of price.`;
  if (c.onWall) return `Your short sits on the ${fk(c.wall)} wall itself. Price would test the level and your strike together.`;
  if (c.behind) return `The ${fk(c.wall)} wall sits ${fk(c.gap)} pts between price and your short.`;
  return `Nothing structural between price and ${fk(c.shortK)}. The ${fk(c.wall)} wall is ${fk(c.gap)} pts further out.`;
}
function StructurePill({ c }: { c: ReturnType<typeof evalStrike> }) {
  if (c.itm) return <Pill tone="alert">In the money</Pill>;
  if (c.onWall) return <Pill tone="watch">On the {fk(c.wall)} wall</Pill>;
  if (c.behind) return <Pill tone="accent" wrap>Behind {c.call ? "call" : "put"} wall {fk(c.wall)}</Pill>;
  return <Pill tone="watch" wrap>Open air · in front of {fk(c.wall)}</Pill>;
}

function CandRow({ c, dte, riskPct, isTracked, onTrack }: { c: Cand; dte: number; riskPct: number; isTracked: boolean; onTrack: () => void }) {
  const full = c.passN === c.checks.length;
  const touchC = c.touch > 0.45 ? BAD : c.touch > 0.3 ? SKY : GOOD;
  return (
    <article
      className="sd-cand"
      style={{
        background: ELEV, borderRadius: R_LG, padding: "12px 14px",
        border: `1px solid ${c.behind ? rgba(ACCENT, 0.45) : LINE}`,
        boxShadow: c.behind ? `0 0 0 1px ${rgba(ACCENT, 0.12)}, 0 14px 30px -20px ${rgba(ACCENT, 0.6)}` : "none",
      }}
    >
      <div style={{ display: "grid", gap: 8, justifyItems: "start", alignContent: "start" }}>
        <div>
          <div style={{ ...numStyle, fontWeight: 800, fontSize: 16 }}>{legs(c)}</div>
          <div style={{ fontSize: 11.5, color: PAPER_QUIET, fontWeight: 600 }}>
            {c.tags.map((t) => (t === "wall" ? "Wall candidate" : `${t} strike`)).join(" · ")} · {expLabel(dte)}
          </div>
        </div>
        <StructurePill c={c} />
        <Pill tone={full ? "good" : "plain"}>{c.passN}/{c.checks.length} of your rules</Pill>
      </div>
      <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
        <div className="sd-stats">
          <Stat label="Short delta" value={`${f2(c.delta, 0)}Δ`} />
          <Stat label="Distance" value={`${f2(c.sd)}σ`} />
          <Stat label="Model credit" value={<>${f2(c.cr)} <span style={{ fontSize: 11, color: PAPER_QUIET }}>{Math.round(c.ratio * 100)}%</span></>} />
          <Stat label="Break-even" value={f2(c.be)} />
          <Stat label="Max risk" value={`$${f2(c.risk)}`} />
          <Stat label="Return on risk" value={`${Math.round((c.cr / c.risk) * 100)}%`} />
          <Stat label={`Size at ${riskPct}%`} value={`${c.qty} ct`} />
          <Stat label="$ at risk" value={money(c.qty * c.risk * 100)} />
        </div>
        <div style={{ fontSize: 12, color: PAPER }}>{structureText(c)}</div>
        <Chips checks={c.checks} />
      </div>
      <div className="sd-compare">
        <Odds label="Prob. of profit (model)" v={c.pop} color={SKY} />
        <Odds label="Prob. of touch (model)" v={c.touch} color={touchC} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 11.5, color: PAPER_QUIET }}>
          Voltick hold record <Pill>Not published</Pill>
        </div>
        <Btn small kind="ghost" done={isTracked} disabled={isTracked} onClick={onTrack}>{isTracked ? "✓ Tracking" : "+ Track this"}</Btn>
      </div>
    </article>
  );
}

function Odds({ label, v, color }: { label: string; v: number; color: string }) {
  return (
    <div style={{ display: "grid", gap: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: PAPER_QUIET }}>
        <span>{label}</span>
        <span style={{ ...numStyle, color: PAPER }}>{pct(v)}</span>
      </div>
      <Bar value={v} color={color} />
    </div>
  );
}

function Condor({ R, tk, dte, groups, tracked, onTrack, riskPct }: { R: Rules; tk: Ticker; dte: number; groups: SideGroup[]; tracked: Props["tracked"]; onTrack: Props["onTrack"]; riskPct: number }) {
  const p = groups.find((g) => g.side === "put")?.wallRow, c = groups.find((g) => g.side === "call")?.wallRow;
  if (!p || !c) return null;
  const b = BOARDS[tk], spot = at(b, "spot"), s = emOf(spot, b.iv, dte);
  const cr = p.cr + c.cr, w = Math.max(p.w, c.w), risk = w - cr, beP = p.shortK - cr, beC = c.shortK + cr;
  const pop = Math.max(0, Phi2(beC, beP, spot, s));
  const qty = Math.max(0, Math.floor((R.acct * riskPct) / 100 / (risk * 100)));
  const input: PositionInput = { tk, type: "condor", short: p.shortK, long: p.longK, short2: c.shortK, long2: c.longK, dte, qty: Math.max(1, qty) };
  const isTracked = tracked(input);
  return (
    <Panel title="Iron condor from the two wall candidates" aside="Neutral lean">
      <div className="sd-condor">
        <div>
          <div style={{ ...numStyle, fontWeight: 800, fontSize: 16 }}>{fk(p.longK)}P / {fk(p.shortK)}P · {fk(c.shortK)}C / {fk(c.longK)}C</div>
          <div style={{ fontSize: 11.5, color: PAPER_QUIET, fontWeight: 600 }}>Both shorts behind their walls · {expLabel(dte)}</div>
        </div>
        <div className="sd-stats">
          <Stat label="Total credit" value={`$${f2(cr)}`} />
          <Stat label="Max risk" value={`$${f2(risk)}`} />
          <Stat label="Break-evens" value={<span style={{ fontSize: 12.5 }}>{f2(beP)} to {f2(beC)}</span>} />
          <Stat label="POP (model)" value={pct(pop)} />
        </div>
        <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
          <span style={{ fontSize: 11.5, color: PAPER_QUIET }}>{qty} ct at your risk size · {money(qty * risk * 100)} at risk</span>
          <Btn small done={isTracked} disabled={isTracked} onClick={() => onTrack(input)}>{isTracked ? "✓ Tracking" : "+ Track condor"}</Btn>
        </div>
      </div>
    </Panel>
  );
}
function Phi2(hi: number, lo: number, spot: number, s: number) {
  // P(lo < price at expiry < hi) under the same normal model the board uses
  return Phi((hi - spot) / s) - Phi((lo - spot) / s);
}
/* ── the strike ladder ─────────────────────────────────────────────────── */
const L = { W: 520, H: 470, top: 14, bot: 14, axisX: 64, mid: 300, half: 200 };

function Ladder({ tk, dte, w, R, groups, myK, onPick }: { tk: Ticker; dte: number; w: number; R: Rules; groups: SideGroup[]; myK: number | null; onPick: (k: number) => void }) {
  const b = BOARDS[tk];
  const ref = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ k: number; x: number; y: number } | null>(null);
  const ks = strikes(b), spot = at(b, "spot"), flip = at(b, "flip"), cw = at(b, "callWall"), pw = at(b, "putWall");
  const y = (k: number) => L.top + ((b.hi - k) / (b.hi - b.lo)) * (L.H - L.top - L.bot);
  const gmax = Math.max(...ks.map((k) => Math.abs(gexAt(b, k))));
  const rowH = Math.max(2, (L.H - L.top - L.bot) / ks.length - 1.2);
  const s = emOf(spot, b.iv, dte);
  const wallRows = groups.map((g) => g.wallRow).filter((r): r is Cand => !!r);
  const deltaRows = groups.flatMap((g) => g.rows.filter((r) => !r.tags.includes("wall")));
  const every = Math.ceil(ks.length / 22);
  const T = { fontFamily: MONO, fontSize: 9.5 } as const;

  const kFrom = (e: MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const yv = ((e.clientY - r.top) / r.height) * L.H;
    return Math.min(b.hi, Math.max(b.lo, snap(b, b.hi - ((yv - L.top) / (L.H - L.top - L.bot)) * (b.hi - b.lo))));
  };
  const onMove = (e: MouseEvent) => {
    const box = wrap.current!.getBoundingClientRect();
    setHover({ k: kFrom(e), x: e.clientX - box.left, y: e.clientY - box.top });
  };

  const hv = hover ? evalStrike(R, b, hover.k, hover.k > spot, dte, w) : null;
  const boxW = wrap.current?.getBoundingClientRect().width ?? 500;
  const boxH = wrap.current?.getBoundingClientRect().height ?? 470;

  return (
    <div ref={wrap} className="sd-ladderwrap" style={{ position: "relative", padding: "10px 8px 10px 4px", minWidth: 0 }}>
      <svg ref={ref} viewBox={`0 0 ${L.W} ${L.H}`} role="img" aria-label="Strike ladder. Hover for readings, click a strike to check it."
        style={{ display: "block", width: "100%", height: "auto", cursor: "crosshair" }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={(e) => onPick(kFrom(e))}>
        <rect x={L.axisX} y={y(spot + s)} width={L.W - L.axisX - 4} height={Math.max(0, y(spot - s) - y(spot + s))} fill={rgba(ACCENT, 0.08)} stroke={rgba(ACCENT, 0.3)} strokeDasharray="3 3" />
        <text x={L.axisX + 4} y={y(spot + s) - 4} {...T} fill={ACCENT_TEXT}>+1σ {f2(spot + s)}</text>
        <text x={L.axisX + 4} y={y(spot - s) + 12} {...T} fill={ACCENT_TEXT}>−1σ {f2(spot - s)}</text>
        <line x1={L.mid} x2={L.mid} y1={L.top} y2={L.H - L.bot} stroke={LINE} />
        {ks.map((k, i) => {
          const g = gexAt(b, k), len = (Math.abs(g) / gmax) * L.half, isWall = k === cw || k === pw;
          return (
            <g key={k}>
              <rect x={g >= 0 ? L.mid : L.mid - len} y={y(k) - rowH / 2} width={Math.max(1, len)} height={rowH} rx={1.5} fill={g >= 0 ? GOOD : BAD} opacity={isWall ? 1 : 0.5} />
              {(i % every === 0 || isWall || wallRows.some((r) => r.shortK === k) || k === myK) && (
                <text x={L.axisX - 8} y={y(k) + 3.5} textAnchor="end" fontFamily={MONO} fontSize={10} fill={isWall ? PAPER : PAPER_QUIET} fontWeight={isWall ? 700 : 400}>{fk(k)}</text>
              )}
            </g>
          );
        })}
        <text x={L.mid + 6} y={y(cw) + 3.5} fontSize={10.5} fontWeight={700} fill={SURGE}>{WALL_MARK} Call wall</text>
        <text x={L.mid + 6} y={y(pw) + 3.5} fontSize={10.5} fontWeight={700} fill={SURGE}>{WALL_MARK} Put wall</text>
        <line x1={L.axisX} x2={L.W - 4} y1={y(flip)} y2={y(flip)} stroke={FLIP} strokeWidth={1.3} strokeDasharray="6 4" />
        <text x={L.axisX + 4} y={y(flip) - 4} {...T} fill={FLIP}>{FLIP_MARK} flip {fk(flip)}</text>
        <line x1={L.axisX} x2={L.W - 4} y1={y(spot)} y2={y(spot)} stroke={PAPER} strokeWidth={1.4} />
        <rect x={2} y={y(spot) - 9} width={L.axisX - 6} height={18} rx={4} fill={PAPER} />
        <text x={(L.axisX - 4) / 2 + 1} y={y(spot) + 4} textAnchor="middle" fontFamily={MONO} fontSize={10.5} fontWeight={800} fill={INK}>{f2(spot)}</text>
        {deltaRows.map((r) => (
          <g key={`d${r.shortK}`}>
            <line x1={L.W - 60} x2={L.W - 4} y1={y(r.shortK)} y2={y(r.shortK)} stroke={PAPER_QUIET} strokeWidth={1.2} />
            <text x={L.W - 62} y={y(r.shortK) + 3.5} textAnchor="end" {...T} fill={PAPER_QUIET}>{r.tags.join(" · ")}</text>
          </g>
        ))}
        {wallRows.map((r) => (
          <g key={`w${r.shortK}`}>
            <line x1={L.axisX} x2={L.W - 4} y1={y(r.shortK)} y2={y(r.shortK)} stroke={ACCENT} strokeWidth={2} />
            <rect x={L.W - 84} y={y(r.shortK) - 9} width={80} height={18} rx={9} fill={ACCENT} />
            <text x={L.W - 44} y={y(r.shortK) + 3.5} textAnchor="middle" fontFamily={MONO} fontSize={10} fontWeight={700} fill={PAPER}>short {fk(r.shortK)}</text>
          </g>
        ))}
        {myK != null && myK >= b.lo && myK <= b.hi && (
          <g>
            <line x1={L.axisX} x2={L.W - 4} y1={y(myK)} y2={y(myK)} stroke={SKY} strokeWidth={2} strokeDasharray="5 3" />
            <rect x={L.W - 178} y={y(myK) - 9} width={84} height={18} rx={9} fill={SKY} />
            <text x={L.W - 136} y={y(myK) + 3.5} textAnchor="middle" fontFamily={MONO} fontSize={10} fontWeight={700} fill={INK}>yours {fk(myK)}</text>
          </g>
        )}
        {hover && <line x1={L.axisX} x2={L.W - 4} y1={y(hover.k)} y2={y(hover.k)} stroke={rgba(PAPER, 0.35)} pointerEvents="none" />}
      </svg>
      {hover && hv && (
        <div
          style={{
            position: "absolute", pointerEvents: "none", zIndex: 5, minWidth: 180,
            left: Math.max(0, hover.x + 204 > boxW ? hover.x - 204 : hover.x + 14),
            top: Math.max(0, hover.y + 150 > boxH ? hover.y - 160 : hover.y + 14),
            background: ELEV, border: `1px solid ${rgba(ACCENT, 0.45)}`, borderRadius: R_MD, padding: "8px 10px", fontSize: 12,
            boxShadow: `0 14px 30px -12px ${rgba(INK, 0.9)}`,
          }}
        >
          <div style={{ ...numStyle, fontWeight: 800, fontSize: 14, marginBottom: 4 }}>
            {fk(hover.k)} <span style={{ fontSize: 11, color: PAPER_QUIET }}>{hover.k > spot ? "call side" : "put side"}</span>
          </div>
          {([
            ["Dealer gamma", `${gexAt(b, hover.k) >= 0 ? "+" : "−"}$${f2(Math.abs(gexAt(b, hover.k)) * b.scale)}B`],
            ["Short delta", hv.itm ? "ITM" : `${f2(hv.delta, 0)}Δ`],
            ["From price", `${f2(hv.sd)}σ`],
            ["Touch (model)", pct(hv.touch)],
            ["Structure", hv.itm ? "in the money" : hv.onWall ? "on the wall" : hv.behind ? "behind wall" : "open air"],
          ] as [string, string][]).map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 12, color: PAPER_QUIET }}>
              <span>{l}</span>
              <span style={{ ...numStyle, color: PAPER }}>{v}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: PAPER_QUIET, marginTop: 4 }}>Click to check against your rules</div>
        </div>
      )}
    </div>
  );
}
