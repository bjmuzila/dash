/**
 * Spread Desk · My positions. Each tracked spread is read against the board it
 * sits on (walls, flip, regime) and against the member's own rules (profit
 * level, time rule, loss level). A playback bar steps through five example
 * sessions so the readings can be seen changing. Readings, never instructions.
 */
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ACCENT, BAD, ELEV, FLIP, GOOD, INK, LINE, MONO, PAPER, PAPER_QUIET, R_LG, SKY, SURGE, labelStyle, numStyle, rgba,
} from "../../theme";
import {
  BOARDS, SESSIONS, SESSIONS_SHORT, TICKERS, at, buildLog, emOf, expLabel, f2, fk, money, portfolio, readPos, shortsOf,
} from "./model";
import type { Position, PositionInput, Rules, Ticker } from "./model";
import { Btn, CheckRow, Field, Mark, Panel, Pill, Stat, TONE, inputStyle } from "./ui";

type Props = {
  R: Rules;
  positions: Position[];
  onAdd: (p: PositionInput) => string | null;
  onRemove: (id: number) => void;
  sess: number;
  setSess: (n: number) => void;
};

export default function Monitor({ R, positions, onAdd, onRemove, sess, setSess }: Props) {
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);
  const sessRef = useRef(sess);
  sessRef.current = sess;

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setSess(Math.min(5, sessRef.current + 1));
      if (sessRef.current >= 4) setPlaying(false);
    }, 1300);
    return () => {
      if (timer.current != null) window.clearInterval(timer.current);
    };
  }, [playing, setSess]);

  const log = buildLog(R, positions, sess);
  const port = portfolio(R, positions, sess);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 16 }}>
      <section className="sd-playbar" style={{ background: "transparent", border: `1px solid ${LINE}`, borderRadius: R_LG, padding: "12px 14px" }}>
        <Btn
          small
          onClick={() => {
            if (playing) return setPlaying(false);
            if (sess >= 5) setSess(0);
            setPlaying(true);
          }}
        >
          {playing ? "❚❚ Pause" : "▶ Play"}
        </Btn>
        <span style={{ ...numStyle, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>{SESSIONS[sess]}</span>
        <div className="sd-scrub">
          <input
            type="range" min={0} max={5} step={1} value={sess} aria-label="Example session"
            onChange={(e) => { setPlaying(false); setSess(+e.target.value); }}
            style={{ width: "100%", accentColor: ACCENT }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 10, color: PAPER_QUIET }}>
            {["Today", "+1", "+2", "+3", "+4", "+5"].map((t) => <span key={t}>{t}</span>)}
          </div>
        </div>
        <span style={{ fontSize: 11.5, color: PAPER_QUIET, maxWidth: 240 }}>Demo playback. Step through five example sessions to watch structure and your rules play out.</span>
      </section>

      <div className="sd-mon">
        <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
          {positions.length === 0 ? (
            <Panel pad={28}>
              <div style={{ textAlign: "center", color: PAPER }}>
                <b>No positions tracked.</b>
                <div style={{ color: PAPER_QUIET, marginTop: 4 }}>Use “+ Track this” in the strike finder, or add one by hand.</div>
              </div>
            </Panel>
          ) : (
            positions.map((p) => <PositionCard key={p.id} R={R} p={p} sess={sess} onRemove={() => onRemove(p.id)} />)
          )}
        </div>

        <aside style={{ display: "grid", gap: 16, minWidth: 0, alignContent: "start" }}>
          <Panel title="Portfolio vs your limits" aside={`Account ${money(R.acct)}`}>
            <div style={{ padding: "12px 14px", display: "grid", gap: 10 }}>
              <KV k="Capital at risk" v={<span style={{ color: port.totPct > R.maxTotal ? BAD : PAPER }}>{money(port.tot)} · {f2(port.totPct, 1)}% <span style={{ color: PAPER_QUIET }}>/ {R.maxTotal}%</span></span>} />
              <KV k="Open P&L (model)" v={<span style={{ color: port.pnl >= 0 ? GOOD : BAD }}>{port.pnl >= 0 ? "+" : ""}{money(port.pnl)}</span>} />
              <KV k="Net delta" v={`${port.delta >= 0 ? "+" : ""}${Math.round(port.delta)} sh`} />
              <KV k="Theta per day" v={<span style={{ color: GOOD }}>+{money(port.theta)}</span>} />
              <KV k={`Trades over ${R.riskPct}% risk`} v={<span style={{ color: port.overN ? BAD : PAPER }}>{port.overN}</span>} />
              <Conc title={`By underlying · limit ${R.maxUnd}%`} rows={port.byUnd} limit={R.maxUnd} acct={R.acct} />
              <Conc title={`By expiration week · limit ${R.maxWeek}%`} rows={port.byWeek} limit={R.maxWeek} acct={R.acct} />
            </div>
          </Panel>

          <Panel title="Changes at your strikes" aside={`${log.length - 1} change${log.length === 2 ? "" : "s"}`}>
            <div style={{ maxHeight: 460, overflowY: "auto" }}>
              {log.map((e, j) => (
                <div key={`${e.d}-${e.t}-${j}`} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", padding: "12px 14px", borderTop: j ? `1px solid ${LINE}` : "none" }}>
                  <time style={{ fontFamily: MONO, fontSize: 11, color: PAPER_QUIET, gridRow: "span 2", paddingTop: 2, whiteSpace: "nowrap" }}>{SESSIONS_SHORT[e.d]}</time>
                  <div style={{ display: "flex", gap: 6, fontSize: 13, fontWeight: 600, color: PAPER }}><Mark lvl={e.lvl} /><span>{e.t}</span></div>
                  <div style={{ fontSize: 12, color: PAPER_QUIET }}>{e.det}</div>
                </div>
              ))}
            </div>
          </Panel>

          <AddForm onAdd={onAdd} />
        </aside>
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, color: PAPER_QUIET }}>
      <span>{k}</span>
      <span style={{ ...numStyle, color: PAPER }}>{v}</span>
    </div>
  );
}

function Conc({ title, rows, limit, acct }: { title: string; rows: [string, number][]; limit: number; acct: number }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span style={labelStyle}>{title}</span>
      {rows.map(([k, v]) => {
        const pc = (v / acct) * 100, over = pc > limit, scale = Math.max(limit * 1.6, pc);
        return (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "70px minmax(0,1fr) 54px", gap: 8, alignItems: "center", fontSize: 11.5, color: PAPER }}>
            <span style={{ fontFamily: MONO }}>{k}</span>
            <div style={{ position: "relative", height: 6, borderRadius: 99, background: INK, border: `1px solid ${LINE}` }}>
              <i style={{ display: "block", height: "100%", width: `${(pc / scale) * 100}%`, borderRadius: 99, background: over ? BAD : SKY }} />
              <u style={{ position: "absolute", top: -3, bottom: -3, width: 2, left: `${(limit / scale) * 100}%`, background: PAPER }} />
            </div>
            <span style={{ ...numStyle, textAlign: "right", color: over ? BAD : PAPER }}>{f2(pc, 1)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function PositionCard({ R, p, sess, onRemove }: { R: Rules; p: Position; sess: number; onRemove: () => void }) {
  const r = readPos(R, p, sess);
  const legs = p.type === "condor"
    ? `${fk(p.long)}P / ${fk(p.short)}P · ${fk(p.short2 ?? 0)}C / ${fk(p.long2 ?? 0)}C`
    : p.type === "put" ? `${fk(p.short)}P / ${fk(p.long)}P` : `${fk(p.short)}C / ${fk(p.long)}C`;
  const kind = p.type === "condor" ? "Iron condor" : p.type === "put" ? "Put credit spread" : "Call credit spread";
  const profitPct = p.dte === 0 ? R.zProfit : R.profitPct, lossX = p.dte === 0 ? R.zLoss : R.lossX;
  const pm = r.pn.pctMax;
  const lo = -lossX, span = 1 - lo, pos = (v: number) => Math.max(0, Math.min(100, ((v - lo) / span) * 100)), zero = pos(0);
  const nearest = Math.min(...shortsOf(p).map((k) => Math.abs(k - r.spot))) / emOf(r.spot, BOARDS[p.tk].iv, r.dteNow);
  const edge = r.lvl === "ok" ? LINE : rgba(TONE[r.lvl], 0.5);
  return (
    <article style={{ background: "transparent", border: `1px solid ${edge}`, borderRadius: R_LG, overflow: "hidden", transition: "border-color 200ms" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px", alignItems: "center", padding: "12px 14px", borderBottom: `1px solid ${LINE}`, background: ELEV }}>
        <span style={{ ...numStyle, fontWeight: 800, fontSize: 16 }}>{p.tk}</span>
        <span style={{ ...numStyle, fontWeight: 700 }}>{legs}</span>
        <span style={{ fontSize: 12.5, color: PAPER_QUIET }}>{kind} · {p.qty} ct · {expLabel(p.dte)} · {r.dteNow} DTE · opened for ${f2(p.cr)}</span>
        <span style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
          <Pill tone={r.lvl} dot wrap>{r.label}</Pill>
          <button type="button" onClick={onRemove} aria-label={`Remove ${p.tk} ${legs} from the monitor`} title="Remove from monitor"
            style={{ border: `1px solid ${LINE}`, background: "transparent", color: PAPER_QUIET, borderRadius: 8, width: 28, height: 28, cursor: "pointer", fontSize: 14 }}>×</button>
        </span>
      </div>
      <div className="sd-pnl">
        <Stat label="Open P&L" value={`${r.pn.dollars >= 0 ? "+" : ""}${money(r.pn.dollars)}`} color={r.pn.dollars >= 0 ? GOOD : BAD} />
        <Stat label="% of max profit" value={`${Math.round(pm * 100)}%`} />
        <Stat label="Max loss" value={money((p.width - p.cr) * 100 * p.qty)} />
        <Stat label="Nearest short" value={`${f2(nearest)}σ`} />
        <div>
          <div style={{ ...labelStyle, fontSize: 9.5 }}>Loss {lossX}× · profit {profitPct}%</div>
          <div style={{ position: "relative", height: 8, marginTop: 8, borderRadius: 99, background: INK, border: `1px solid ${LINE}` }}>
            <i style={{ position: "absolute", top: 0, bottom: 0, borderRadius: 99, ...(pm >= 0 ? { left: `${zero}%`, width: `${pos(pm) - zero}%`, background: GOOD } : { left: `${pos(pm)}%`, width: `${zero - pos(pm)}%`, background: BAD }) }} />
            <b style={{ position: "absolute", top: -4, width: 2, height: 14, left: `${pos(profitPct / 100)}%`, background: GOOD }} />
            <b style={{ position: "absolute", top: -4, width: 2, height: 14, left: `${zero}%`, background: PAPER_QUIET }} />
          </div>
        </div>
      </div>
      <div className="sd-posbody">
        <div style={{ padding: "12px 14px", minWidth: 0 }}><Strip p={p} sess={sess} /></div>
        <div className="sd-checks">
          {r.items.map((it, j) => <CheckRow key={j} lvl={it.lvl}>{it.t}</CheckRow>)}
        </div>
      </div>
      <div style={{ padding: "10px 14px", borderTop: `1px solid ${LINE}`, fontSize: 12.5, color: PAPER }}>{r.note}</div>
    </article>
  );
}

function Strip({ p, sess }: { p: Position; sess: number }) {
  const b = BOARDS[p.tk], spot = at(b, "spot", sess), flip = at(b, "flip", sess);
  const sides: ("putWall" | "callWall")[] = p.type === "condor" ? ["putWall", "callWall"] : [p.type === "call" ? "callWall" : "putWall"];
  const pts = [p.short, p.long, p.short2, p.long2, spot, flip, ...sides.map((k) => at(b, k, sess)), ...sides.map((k) => at(b, k, 0))].filter((v): v is number => v != null);
  let lo = Math.min(...pts), hi = Math.max(...pts);
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const W = 480, H = 78, P = 14, x = (k: number) => P + ((k - lo) / (hi - lo)) * (W - 2 * P);
  const txt = { fontFamily: MONO, fontSize: 9.5, textAnchor: "middle" as const };
  const zones: [number, number][] = [[p.short, p.long]];
  if (p.type === "condor") zones.push([p.short2 ?? 0, p.long2 ?? 0]);
  const arrowId = `sd-arr-${p.id}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${p.tk} position strip`} style={{ display: "block", width: "100%", height: "auto" }}>
      <defs>
        <marker id={arrowId} viewBox="0 0 6 6" refX={5} refY={3} markerWidth={6} markerHeight={6} orient="auto"><path d="M0 0 6 3 0 6z" fill={SKY} /></marker>
      </defs>
      <line x1={P} x2={W - P} y1={40} y2={40} stroke={LINE} strokeWidth={6} strokeLinecap="round" />
      {zones.map(([a, c]) => <rect key={a} x={Math.min(x(a), x(c))} y={34} width={Math.abs(x(c) - x(a))} height={12} rx={3} fill={rgba(BAD, 0.3)} />)}
      <line x1={x(flip)} x2={x(flip)} y1={22} y2={58} stroke={FLIP} strokeDasharray="3 3" strokeWidth={1.4} />
      <text x={x(flip)} y={72} {...txt} fill={FLIP}>flip {fk(flip)}</text>
      {sides.map((key) => {
        const w = at(b, key, sess), w0 = at(b, key, 0);
        return (
          <g key={key}>
            {w !== w0 && (
              <>
                <circle cx={x(w0)} cy={22} r={3} fill="none" stroke={SKY} />
                <line x1={x(w0)} x2={x(w) + (w < w0 ? 5 : -5)} y1={22} y2={22} stroke={SKY} strokeWidth={1.4} markerEnd={`url(#${arrowId})`} />
              </>
            )}
            <rect x={x(w) - 2.5} y={28} width={5} height={24} rx={1.5} fill={SURGE} />
            <text x={x(w)} y={12} {...txt} fontWeight={700} fill={SURGE}>{w !== w0 ? `‖ wall ${fk(w)} (was ${fk(w0)})` : `‖ wall ${fk(w)}`}</text>
          </g>
        );
      })}
      {shortsOf(p).map((k) => (
        <g key={k}>
          <circle cx={x(k)} cy={40} r={6} fill={ACCENT} stroke={INK} strokeWidth={2} />
          <text x={x(k)} y={72} {...txt} fontWeight={700} fill={PAPER}>short {fk(k)}</text>
        </g>
      ))}
      <path d={`M${x(spot)} 31 l-6 -9 h12 z`} fill={PAPER} />
      <line x1={x(spot)} x2={x(spot)} y1={31} y2={50} stroke={PAPER} strokeWidth={2} />
    </svg>
  );
}

function AddForm({ onAdd }: { onAdd: (p: PositionInput) => string | null }) {
  const [tk, setTk] = useState<Ticker>("SPY");
  const [type, setType] = useState<"put" | "call">("put");
  const prefill = (t: Ticker, ty: "put" | "call") => {
    const b = BOARDS[t], w = at(b, ty === "call" ? "callWall" : "putWall"), s = ty === "call" ? w + b.step : w - b.step;
    return { s: String(s), l: String(ty === "call" ? s + 5 : s - 5) };
  };
  const [k, setK] = useState(prefill("SPY", "put"));
  const [dte, setDte] = useState(45);
  const [qty, setQty] = useState("2");
  const [cr, setCr] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = parseFloat(k.s), l = parseFloat(k.l), b = BOARDS[tk];
    if (!isFinite(s) || !isFinite(l)) return setMsg({ ok: false, t: "Enter both strikes." });
    if (type === "put" && !(l < s)) return setMsg({ ok: false, t: "For a put credit spread the long strike sits below the short." });
    if (type === "call" && !(l > s)) return setMsg({ ok: false, t: "For a call credit spread the long strike sits above the short." });
    if (s < b.lo || s > b.hi) return setMsg({ ok: false, t: `${tk} strikes in this example run ${fk(b.lo)} to ${fk(b.hi)}.` });
    const c = parseFloat(cr);
    const err = onAdd({ tk, type, short: s, long: l, dte, qty: Math.max(1, parseInt(qty) || 1), cr: isFinite(c) ? c : null });
    if (err) return setMsg({ ok: false, t: err });
    const spot = at(b, "spot");
    const itm = type === "put" ? s >= spot : s <= spot;
    setMsg({ ok: true, t: `Tracking ${tk} ${fk(s)}/${fk(l)}.${itm ? " That short starts in the money." : ""}` });
  };

  return (
    <Panel title="Track a position" aside="Manual">
      <form onSubmit={submit} noValidate style={{ padding: 14, display: "grid", gap: 10 }}>
        <div className="sd-row2">
          <Field label="Ticker" htmlFor="sd-atk">
            <select id="sd-atk" value={tk} onChange={(e) => { const t = e.target.value as Ticker; setTk(t); setK(prefill(t, type)); }} style={inputStyle}>
              {TICKERS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Structure" htmlFor="sd-aty">
            <select id="sd-aty" value={type} onChange={(e) => { const ty = e.target.value as "put" | "call"; setType(ty); setK(prefill(tk, ty)); }} style={inputStyle}>
              <option value="put">Put credit spread</option>
              <option value="call">Call credit spread</option>
            </select>
          </Field>
        </div>
        <div className="sd-row2">
          <Field label="Short strike" htmlFor="sd-as"><input id="sd-as" type="number" step={0.5} value={k.s} onChange={(e) => setK({ ...k, s: e.target.value })} style={inputStyle} /></Field>
          <Field label="Long strike" htmlFor="sd-al"><input id="sd-al" type="number" step={0.5} value={k.l} onChange={(e) => setK({ ...k, l: e.target.value })} style={inputStyle} /></Field>
        </div>
        <div className="sd-row2">
          <Field label="Days to exp." htmlFor="sd-ad">
            <select id="sd-ad" value={dte} onChange={(e) => setDte(+e.target.value)} style={inputStyle}>
              {[7, 14, 21, 30, 45].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Contracts" htmlFor="sd-aq"><input id="sd-aq" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} /></Field>
        </div>
        <Field label="Credit per share (blank = model)" htmlFor="sd-ac"><input id="sd-ac" type="number" step={0.01} placeholder="model" value={cr} onChange={(e) => setCr(e.target.value)} style={inputStyle} /></Field>
        <Btn type="submit">Track position</Btn>
        <div style={{ fontSize: 12, color: msg ? (msg.ok ? GOOD : BAD) : PAPER_QUIET }}>
          {msg ? msg.t : "Voltick watches walls, flip, regime and your own rules around each short strike, and logs every change."}
        </div>
      </form>
    </Panel>
  );
}
