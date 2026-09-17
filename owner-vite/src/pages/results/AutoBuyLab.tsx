/**
 * Results → Auto-Buy Lab — the entry/exit test bench for the timed 0DTE
 * auto-buy, wired to /api/autobuy-lab.
 *
 * THE QUESTION. The CB tracker already buys a contract at 9:45 / 10:30 / 12:00
 * and records what happened to it minute by minute. This tab asks the two
 * questions that log cannot answer on its own: which of those buys should have
 * been skipped, and which exit rule should have closed the ones that were
 * taken. Every number here is a REPLAY over `cb_trades` + `cb_trade_ticks` —
 * server-v2/autobuy-lab.js walks the real bars. Nothing is simulated.
 *
 * FLIPPING A FILTER IS THE WHOLE INTERACTION. Each toggle re-runs the sweep and
 * the panels move together: the hypothetical ticket at the top-right shows the
 * order the stack would place RIGHT NOW (or would have placed, on the last
 * recorded session at this clock) with its real strike, premium, debit, target,
 * stop and trail prices; under it the delta strip says what that toggle did to
 * fires, win rate and expectancy. That pairing is the point — a filter that
 * lifts expectancy by cutting the sample to nine trades is not an improvement,
 * and you can only see that when both numbers move in front of you.
 *
 * FOURTEEN FILTERS ARE WIRED, ONE IS NOT, AND THE PAGE SAYS WHICH. Five read
 * the trade row itself (the $1.00 premium rule, walk depth, CB distance, spot
 * drift toward the CB, the CB strike's own price). Six read `etf_candles` at
 * the checkpoint minute — VWAP + slope and RVOL and the CVD proxy off SPY,
 * which is the only series in the roster with real volume; the opening-range
 * break-and-retest and the EMA stack off SPX itself; the VIX band off VIX. Two
 * read `walls_log`, which is change-only on a 15-minute slot grid and has to be
 * carried forward: whether spot is pinned into the wall ahead, and whether
 * there is more room to that wall than to the CB.
 *
 * TICK / ADD / VOLD reads `etf_candles` too, under whichever of several
 * candidate spellings the feed actually serves — the header says which one
 * resolved, so "does this feed carry internals?" is answered on screen. Only
 * the econ-calendar veto is still `available:false`, because econ-alert-
 * recorder fetches events and never stores them. Two wired ones are renamed
 * rather than faked: it is VIX, not VIX1D, and the CVD is a signed-bar-volume
 * proxy built on TradingView's polarity ladder, not tick delta.
 *
 * A DENIAL IS ALSO A RESULT. Every session the stack refuses is replayed under
 * the same exit rules and reported beside the fired ones, three arms across the
 * top: what it took, what it refused, and what taking everything would have
 * done. Each filter row then carries its own bill — the trades it personally
 * vetoed and what they went on to do. A filter whose vetoes were PROFITABLE is
 * costing money however good its lift looks, and that is the number to build
 * the stack on.
 *
 * THREE READ STATES, NOT TWO. A filter can PASS, FAIL, or have NO READ — the
 * EMA stack genuinely cannot exist at 9:45, and RVOL needs five prior sessions
 * before it means anything. No-read fails the AND stack but is counted and
 * coloured separately, because "this rule rejects everything" and "this rule
 * had nothing to read" are different problems and must never look alike.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME, SOFT_RED, classicCardAccentStyle } from "../../lib/theme";

const C = {
  cyan: HOME_THEME.cyan,
  border: HOME_THEME.border,
  gold: HOME_THEME.gold,
  orange: HOME_THEME.orange,
  lightBlue: HOME_THEME.lightBlue,
};
const GREEN = HOME_THEME.green;
const RED = HOME_THEME.red;
const WIN = "#1FD98A";
const CARD = classicCardAccentStyle;
const INSET = "rgba(0,0,0,0.30)";
const MONO = "var(--font-mono)";

function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── Payload shapes (server-v2/autobuy-lab.js) ───────────────────────────────

type Block = "trend" | "dealer" | "internals" | "participation";

type ApiFilter = {
  id: string; name: string; detail: string; block: Block; weight: number;
  available: boolean; armed: boolean;
  needs?: string;
  passRate?: number | null; passes?: number; of?: number;
  /** Sessions where the filter had no data to read — never counted as a fail. */
  unmeasurable?: number | null;
  lift?: number | null;
  /**
   * What this filter personally kept you out of: the trades that clear every
   * OTHER armed filter and fail only this one, replayed anyway. `totalUsd`
   * NEGATIVE means it blocked losers and earned its place; POSITIVE means it
   * blocked winners and is costing money however good its lift looks.
   */
  veto?: { fires: number; winRate: number | null; avgUsd: number | null; totalUsd: number } | null;
};
type Stats = {
  fires: number; wins: number; winRate: number | null; avgUsd: number | null;
  totalUsd: number; pf: number | null; maxDd: number; avgHoldMin: number | null;
};
type ApiExit = {
  id: string; label: string; target: number; stop: number;
  trailArm: number | null; trailGive: number | null; distStop: number | null; flattenMin: number;
};
type ApiLive = {
  date: string; status: string; skipReason: string | null;
  side: string; strike: number | null; cbStrike: number | null; cbPrice: number | null;
  walkSteps: number | null; probePrice: number | null; probeBid: number | null; probeAsk: number | null;
  probeSpot: number | null; probeDist: number | null; entryPrice: number | null; lastPrice: number | null;
  occ: string | null;
  /** true / false / null — null means the filter could not be measured. */
  reads: Record<string, boolean | null>;
  today?: boolean;
  context?: Record<string, number | null> | null;
};
type ApiTrade = {
  id: number; date: string; checkpoint: string; side: string; strike: number | null;
  entry: number | null; exit: number | null; reason: "target" | "trail" | "struct" | "stop" | "time";
  pnl: number | null; pnlUsd: number | null; holdMin: number | null;
  cbStrike?: number | null; probeDist?: number | null; walkSteps?: number | null;
  /** Rejected rows only: which armed filters said no to this one. */
  blockedBy?: string[];
};
type ApiSweep = {
  stack: string; filters: string[]; clock: string; clockLabel: string; exit: string; exitLabel: string;
  fires: number; winRate: number | null; avgUsd: number | null; pf: number | null; maxDd: number;
};
type Payload = {
  basis: string; clock: string; exit: string; since: number | null; sessions: number;
  checkpoints: { key: string; label: string; min: number }[];
  exits: ApiExit[];
  multiplier: number; buyMin: number;
  filters: ApiFilter[]; armed: string[];
  stats: Stats; noData: number; candidates: number;
  /** Same window, same exits, the sessions the stack said NO to. */
  rejectedStats: Stats; rejectedNoData: number;
  /** Every filled trade at this clock with no filters at all — the yardstick. */
  blindStats: Stats;
  rejectedTrades: ApiTrade[];
  internalsSource?: Record<string, string>;
  exitMix: Record<"target" | "trail" | "struct" | "stop" | "time", number>;
  equity: { date: string; pnlUsd: number; cum: number }[];
  matrix: Record<string, Record<string, { avgUsd: number | null; fires: number; winRate: number | null }>>;
  sweep: ApiSweep[];
  /** False when the candle/wall context query failed — the trade-row filters still work. */
  contextLoaded?: boolean;
  live: ApiLive | null;
  trades: ApiTrade[];
};

const BLOCK_LABEL: Record<Block, string> = {
  trend: "Trend", dealer: "Dealer / CB", internals: "Internals", participation: "Participation",
};
const BLOCK_COLOR: Record<Block, [string, string]> = {
  trend: [C.cyan, C.lightBlue],
  dealer: [C.orange, C.gold],
  internals: [WIN, GREEN],
  participation: [RED, SOFT_RED],
};
const ARM_THRESHOLD = 75;

const usd = (v: number | null | undefined, dp = 0) =>
  v == null ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

// ── Page ────────────────────────────────────────────────────────────────────

export default function AutoBuyLab() {
  const [clock, setClock] = useState("1030");
  const [exitId, setExitId] = useState("C");
  const [basis, setBasis] = useState("oivol");
  const [size, setSize] = useState(1);
  const [since, setSince] = useState<number | "all">(120);
  const [armed, setArmed] = useState<string[] | null>(null);   // null = server default
  const [logTab, setLogTab] = useState<"fired" | "rejected">("fired");

  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  // What the previous response said, so a toggle can report its own effect.
  const prev = useRef<{ armed: string[]; stats: Stats } | null>(null);
  const [delta, setDelta] = useState<{ label: string; from: Stats; to: Stats } | null>(null);
  const lastToggled = useRef<string | null>(null);

  const armedKey = armed == null ? "" : armed.join(",");

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      if (since === "all") qs.set("all", "1"); else qs.set("since", String(since));
      qs.set("basis", basis);
      qs.set("clock", clock);
      qs.set("exit", exitId);
      if (armed != null) qs.set("filters", armedKey);
      const r = await fetch(`/api/autobuy-lab?${qs.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j: Payload = await r.json();
      // First response defines the armed set the UI owns from then on.
      setArmed((a) => (a == null ? j.armed : a));
      if (prev.current && lastToggled.current) {
        setDelta({ label: lastToggled.current, from: prev.current.stats, to: j.stats });
      }
      prev.current = { armed: j.armed, stats: j.stats };
      lastToggled.current = null;
      setData(j);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }, [since, basis, clock, exitId, armed, armedKey]);

  useEffect(() => { load(); }, [load]);

  const toggle = (f: ApiFilter) => {
    if (!f.available || armed == null) return;
    const on = armed.includes(f.id);
    lastToggled.current = `${f.name} ${on ? "disarmed" : "armed"}`;
    setArmed(on ? armed.filter((x) => x !== f.id) : armed.concat(f.id));
  };

  const filters = data?.filters ?? [];
  const liveFilters = filters.filter((f) => f.available && (armed ?? data?.armed ?? []).includes(f.id));

  // Confluence score over the live read of today's (or the last) session row.
  const reads = data?.live?.reads ?? null;
  const score = useMemo(() => {
    if (!reads || !liveFilters.length) return null;
    const total = liveFilters.reduce((s, f) => s + f.weight, 0);
    if (!total) return 0;
    const got = liveFilters.reduce((s, f) => s + (reads[f.id] === true ? f.weight : 0), 0);
    return Math.round((got / total) * 100);
  }, [reads, liveFilters]);

  const blockScores = useMemo(() => {
    const out = {} as Record<Block, number | null>;
    (Object.keys(BLOCK_LABEL) as Block[]).forEach((b) => {
      const inB = liveFilters.filter((f) => f.block === b);
      const total = inB.reduce((s, f) => s + f.weight, 0);
      out[b] = !reads || !total ? null
        : Math.round((inB.reduce((s, f) => s + (reads[f.id] === true ? f.weight : 0), 0) / total) * 100);
    });
    return out;
  }, [liveFilters, reads]);

  const failing = reads ? liveFilters.filter((f) => reads[f.id] !== true) : [];
  const fires = reads != null && failing.length === 0 && liveFilters.length > 0;

  const logRows = (logTab === "fired" ? data?.trades : data?.rejectedTrades) ?? [];

  const exitDef = data?.exits.find((e) => e.id === exitId) ?? null;
  const clockLabel = data?.checkpoints.find((c) => c.key === clock)?.label ?? clock;

  // The contract the ticket is written against: today's row if the recorder has
  // one at this clock, otherwise the most recent replayed trade — labelled as
  // such, never passed off as live.
  const ref = data?.live ?? null;
  const fallback = data?.trades?.[0] ?? null;
  const ticketPrem = ref?.entryPrice ?? ref?.probePrice ?? fallback?.entry ?? null;
  const ticketStrike = ref?.strike ?? fallback?.strike ?? null;
  const ticketSide = ref?.side ?? fallback?.side ?? null;
  const ticketDate = ref?.date ?? fallback?.date ?? null;
  // The replayed result for the very session the ticket is written against,
  // when the stack rejected it. "It said no" is half an answer; "it said no and
  // the trade lost $210" is the whole one.
  const rejectedToday = ref ? (data?.rejectedTrades ?? []).find((t) => t.date === ref.date) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, minHeight: 0 }}>

      {/* ── Control bar ── */}
      <div style={{ ...CARD, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ marginRight: "auto" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.45, fontWeight: 800 }}>
            Results · Contracts
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: err ? RED : busy ? C.gold : WIN,
              boxShadow: `0 0 10px ${err ? RED : busy ? C.gold : WIN}`,
            }} />
            Auto-Buy Contract Lab
          </div>
        </div>
        <Seg options={(data?.checkpoints ?? []).map((c) => ({ v: c.key, l: c.label }))} value={clock} onChange={setClock} />
        <Seg options={(data?.exits ?? []).map((e) => ({ v: e.id, l: e.id }))} value={exitId} onChange={setExitId} />
        <Seg options={[{ v: "oivol", l: "OI+VOL" }, { v: "vol", l: "VOL" }]} value={basis} onChange={setBasis} />
        <Seg
          options={[{ v: "20", l: "20d" }, { v: "120", l: "120d" }, { v: "all", l: "All" }]}
          value={String(since)}
          onChange={(v) => setSince(v === "all" ? "all" : Number(v))}
        />
      </div>

      {data && data.contextLoaded === false && (
        <div style={{ ...CARD, padding: "12px 18px", borderColor: rgba(HOME_THEME.gold, 0.3), fontSize: 12, color: HOME_THEME.gold }}>
          Candle and wall context didn’t load — the trade-row filters still score, the rest read as “no read”.
        </div>
      )}

      {err && (
        <div style={{ ...CARD, padding: 18, borderColor: rgba(RED, 0.35), color: SOFT_RED, fontFamily: MONO, fontSize: 13 }}>
          Couldn’t load the lab: {err}
        </div>
      )}

      {/* ── KPI strip — all replayed, all real ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
        <Kpi k="Sessions replayed" v={data ? String(data.sessions) : "—"} d={`${clockLabel} checkpoint`} />
        <Kpi k="Fires" v={data ? `${data.stats.fires}` : "—"} d={data ? `of ${data.candidates} filled${data.noData ? ` · ${data.noData} no ticks` : ""}` : ""} />
        <Kpi k="Win rate" v={pct(data?.stats.winRate)} d={data ? `${data.stats.wins} winners` : ""} vc={(data?.stats.winRate ?? 0) >= 0.5 ? WIN : SOFT_RED} />
        <Kpi k="Expectancy / trade" v={usd(data?.stats.avgUsd)} d={`1 contract · exit ${exitId}`} vc={(data?.stats.avgUsd ?? 0) >= 0 ? WIN : SOFT_RED} />
        <Kpi k="Total" v={usd(data?.stats.totalUsd)} d={`Max DD ${usd(data ? -data.stats.maxDd : null)}`} vc={(data?.stats.totalUsd ?? 0) >= 0 ? WIN : SOFT_RED} />
        <Kpi k="Profit factor" v={data?.stats.pf == null ? "—" : data.stats.pf.toFixed(2)} d="gross win ÷ gross loss" vc={C.gold} />
        <Kpi k="Avg hold" v={data?.stats.avgHoldMin == null ? "—" : `${data.stats.avgHoldMin}m`} d={exitDef ? `Flatten ${Math.floor(exitDef.flattenMin / 60)}:${String(exitDef.flattenMin % 60).padStart(2, "0")} ET` : ""} />
      </div>

      {/* ── The three arms. This is the comparison the whole page exists for:
              what the stack TOOK, what it REFUSED, and what taking everything
              would have done. A stack whose refusals were profitable is a stack
              throwing money away, and no single-arm number can show that. ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
        <ArmCard label="Fired" sub="the stack said yes" s={data?.stats} tone={WIN} />
        <ArmCard label="Rejected" sub="the stack said no — replayed anyway" s={data?.rejectedStats} tone={C.gold} invert />
        <ArmCard label="Blind" sub="every fill, no filters" s={data?.blindStats} tone="rgba(255,255,255,0.45)" />
      </div>

      {/* ── Entry stack + ticket/gauge ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.05fr) minmax(0,1fr)", gap: 20 }} className="abl-2col">

        <Panel
          title="Entry Rule Stack"
          sub="All armed filters must pass at the clock — AND logic"
          right={<Pill tone={ticketSide === "P" ? "bad" : "cyan"}>{ticketSide === "P" ? "PUT side" : "CALL side"}</Pill>}
        >
          <Micro>
            Wired — scored over the recorded rows
            {data?.internalsSource && Object.keys(data.internalsSource).length
              ? ` · internals via ${Object.entries(data.internalsSource).map(([k, v]) => `${k}=${v}`).join(" ")}`
              : " · internals: no feed symbol has resolved yet"}
          </Micro>
          <div style={{ marginTop: 8 }}>
            {filters.filter((f) => f.available).map((f) => (
              <FilterRow key={f.id} f={f} on={(armed ?? []).includes(f.id)} read={reads?.[f.id] ?? null} onClick={() => toggle(f)} />
            ))}
          </div>

          <div style={{ borderTop: `1px solid ${C.border}`, margin: "16px 0 12px" }} />
          <Micro>Not wired — no recorder writes this at the checkpoint minute</Micro>
          <div style={{ marginTop: 8 }}>
            {filters.filter((f) => !f.available).map((f) => (
              <div key={f.id} style={{
                display: "grid", gridTemplateColumns: "38px 1fr auto", gap: 10, alignItems: "center",
                padding: "9px 12px", borderRadius: 12, marginBottom: 7,
                background: INSET, border: "1px solid rgba(255,255,255,0.04)", opacity: 0.55,
              }}>
                <Switch on={false} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{f.name}</div>
                  <div style={{ fontSize: 11, opacity: 0.6, marginTop: 1 }}>Needs: {f.needs}</div>
                </div>
                <Pill tone="off">no data</Pill>
              </div>
            ))}
          </div>
        </Panel>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>

          {/* ── The hypothetical ticket — the thing that moves when you toggle ── */}
          <Panel
            title="Hypothetical Ticket"
            sub={ref
              ? `${ref.date} · ${ref.status}${ref.skipReason ? ` — ${ref.skipReason}` : ""}`
              : ticketDate ? `No row at ${clockLabel} today — pricing off ${ticketDate}` : "No recorded row to price"}
            right={<Seg options={[{ v: "1", l: "1 ct" }, { v: "2", l: "2 ct" }, { v: "3", l: "3 ct" }]} value={String(size)} onChange={(v) => setSize(Number(v))} />}
          >
            <Ticket
              fires={fires}
              side={ticketSide}
              strike={ticketStrike}
              prem={ticketPrem}
              occ={ref?.occ ?? null}
              exit={exitDef}
              size={size}
              multiplier={data?.multiplier ?? 100}
              expectancy={data?.stats.avgUsd ?? null}
              failing={failing.map((f) => f.name)}
              stale={!ref}
            />

            {!fires && rejectedToday && (
              <>
                <div style={{ borderTop: `1px solid ${C.border}`, margin: "14px 0 10px" }} />
                <Micro>Denied — what it did anyway</Micro>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginTop: 8 }}>
                  <Field label="Exit" value={rejectedToday.reason} />
                  <Field label="Out" value={rejectedToday.exit?.toFixed(2) ?? "—"} />
                  <Field
                    label="Would have"
                    value={usd((rejectedToday.pnlUsd ?? 0) * size)}
                    color={(rejectedToday.pnlUsd ?? 0) >= 0 ? SOFT_RED : WIN}
                  />
                </div>
                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8, lineHeight: 1.55 }}>
                  {(rejectedToday.pnlUsd ?? 0) >= 0
                    ? "The stack refused a winner here — worth checking which filter, in the row list below."
                    : "The stack refused a loser here — this is the filter doing its job."}
                </div>
              </>
            )}

            {delta && (
              <>
                <div style={{ borderTop: `1px solid ${C.border}`, margin: "14px 0 10px" }} />
                <Micro>{delta.label}</Micro>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginTop: 8 }}>
                  <DeltaTile label="Fires" from={delta.from.fires} to={delta.to.fires} fmt={(v) => String(v)} goodUp />
                  <DeltaTile label="Win rate" from={delta.from.winRate} to={delta.to.winRate} fmt={(v) => pct(v)} goodUp />
                  <DeltaTile label="Expectancy" from={delta.from.avgUsd} to={delta.to.avgUsd} fmt={(v) => usd(v)} goodUp />
                  <DeltaTile label="Max DD" from={delta.from.maxDd} to={delta.to.maxDd} fmt={(v) => usd(v)} />
                </div>
              </>
            )}
          </Panel>

          {/* ── Gauge ── */}
          <Panel
            title={`Confluence at ${clockLabel}`}
            sub={ref ? "Weighted score over this session’s read" : "No live row — gauge is idle"}
            right={fires
              ? <Pill tone="good">ARMED — all filters pass</Pill>
              : reads
                ? <Pill tone="warn">{`HOLD — ${failing.length} failing`}</Pill>
                : <Pill tone="off">no session row</Pill>}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              <Gauge score={score} />
              <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 7 }}>
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
          </Panel>

          {/* ── Exit mix ── */}
          <Panel
            title="Exit Rule Set"
            sub={exitDef ? `${exitDef.label} — first condition to hit wins` : "—"}
            right={<Pill tone="cyan">{`Variant ${exitId}`}</Pill>}
          >
            {exitDef && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                <Field label="Profit target" value={`+${Math.round(exitDef.target * 100)}%`} color={WIN} />
                <Field label="Hard stop" value={`−${Math.round(exitDef.stop * 100)}%`} color={SOFT_RED} />
                <Field label="Trail" value={exitDef.trailArm == null ? "none" : `+${Math.round(exitDef.trailArm * 100)}% → ${Math.round((exitDef.trailGive ?? 0) * 100)}%`} color={C.gold} />
                <Field label="Time flatten" value={`${Math.floor(exitDef.flattenMin / 60)}:${String(exitDef.flattenMin % 60).padStart(2, "0")} ET`} />
                <Field label="Distance stop" value={exitDef.distStop == null ? "none" : `CB +${exitDef.distStop} pts`} color={C.lightBlue} />
              </div>
            )}
            <div style={{ borderTop: `1px solid ${C.border}`, margin: "14px 0" }} />
            <Micro>Which condition actually closed the trade</Micro>
            <div style={{ display: "flex", height: 9, borderRadius: 999, overflow: "hidden", marginTop: 9 }}>
              {MIX_KEYS.map((k, i) => (
                <div key={k} style={{ width: `${data?.exitMix?.[k] ?? 0}%`, background: MIX_COLORS[i], transition: "width .25s" }} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, opacity: 0.75, marginTop: 9 }}>
              {MIX_KEYS.map((k, i) => (
                <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: MIX_COLORS[i] }} />
                  {k} {data?.exitMix?.[k] ?? 0}%
                </span>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* ── Matrix + lift ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.05fr) minmax(0,1fr)", gap: 20 }} className="abl-2col">

        <Panel title="Checkpoint × Exit Rule" sub="Mean P/L per fired trade under the armed stack">
          <div style={{ display: "grid", gridTemplateColumns: `110px repeat(${(data?.exits ?? []).length || 3},1fr)`, gap: 4, fontSize: 11 }}>
            <div />
            {(data?.exits ?? []).map((e) => (
              <div key={e.id} style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.5, fontWeight: 800, textAlign: "center", padding: "6px 2px" }}>
                {e.id} · {e.label}
              </div>
            ))}
            {(data?.checkpoints ?? []).map((cp) => (
              <React.Fragment key={cp.key}>
                <div
                  onClick={() => setClock(cp.key)}
                  style={{ fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", paddingRight: 8, cursor: "pointer", color: cp.key === clock ? WIN : "inherit", opacity: cp.key === clock ? 1 : 0.7 }}
                >
                  {cp.label}{cp.key === clock ? " ★" : ""}
                </div>
                {(data?.exits ?? []).map((e) => {
                  const cell = data?.matrix?.[cp.key]?.[e.id];
                  const hot = cp.key === clock && e.id === exitId;
                  return (
                    <div
                      key={e.id}
                      onClick={() => { setClock(cp.key); setExitId(e.id); }}
                      title={cell ? `${cell.fires} fires · win ${pct(cell.winRate)}` : "no fires"}
                      style={{
                        borderRadius: 7, padding: "10px 6px", textAlign: "center", fontFamily: MONO, fontWeight: 700, cursor: "pointer",
                        background: heat(cell?.avgUsd ?? null),
                        border: `1px solid ${hot ? rgba(WIN, 0.6) : "rgba(255,255,255,0.06)"}`,
                        boxShadow: hot ? `0 0 16px ${rgba(WIN, 0.25)}` : "none",
                      }}
                    >
                      <div>{cell?.avgUsd == null ? "—" : usd(cell.avgUsd)}</div>
                      <div style={{ fontSize: 9, opacity: 0.55, marginTop: 2 }}>{cell?.fires ?? 0} fires</div>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          <div style={{ fontSize: 11, opacity: 0.5, lineHeight: 1.55, marginTop: 12 }}>
            Replayed over bar CLOSES only — an intra-minute high nobody could have hit never fills a target here.
            Trades with no recorded ticks are excluded and counted separately, so a week the recorder was down reads
            as missing rather than as a week of scratches.
          </div>
        </Panel>

        <Panel title="Filter Contribution" sub="Armed: drop-one-out. Disarmed: what arming it would do." right={<Pill tone="cyan">{clockLabel}</Pill>}>
          <LiftChart filters={filters.filter((f) => f.available)} armed={armed ?? []} />
          <div style={{ fontSize: 11, opacity: 0.5, lineHeight: 1.55, marginTop: 10 }}>
            Lift is the change in expectancy per fired trade, in dollars, at this clock under exit {exitId}. A big
            positive lift on a filter that also collapses the fire count is a smaller edge than it looks — check the
            fires column in the sweep below before believing it.
          </div>
        </Panel>
      </div>

      {/* ── Equity ── */}
      <Panel title="Equity Curve" sub={`Cumulative P/L, 1 contract · ${data?.equity.length ?? 0} fired trades`}>
        <EquityChart points={data?.equity ?? []} />
      </Panel>

      {/* ── Sweep + log ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 20 }} className="abl-2col">

        <Panel title="Sweep Results" sub="Every filter subset × exit × checkpoint, min 8 fires">
          <div style={{ overflowX: "auto", maxHeight: 460 }} className="wall-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead><tr>{["Entry stack", "Clock", "Exit", "Fires", "Win%", "Avg", "PF", "Max DD"].map((h, i) => (
                <th key={h} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}</tr></thead>
              <tbody>
                {(data?.sweep ?? []).map((r, i) => (
                  <tr
                    key={`${r.stack}|${r.clock}|${r.exit}`}
                    onClick={() => { setArmed(r.filters); setClock(r.clock); setExitId(r.exit); lastToggled.current = `Loaded ${r.stack}`; }}
                    style={{ cursor: "pointer", background: i === 0 ? rgba(WIN, 0.07) : undefined }}
                  >
                    <td style={{ ...td, textAlign: "left", fontFamily: "inherit", boxShadow: i === 0 ? `inset 3px 0 0 ${WIN}` : undefined }}>{r.stack}</td>
                    <td style={td}>{r.clockLabel}</td>
                    <td style={{ ...td, fontFamily: "inherit" }}>{r.exit}</td>
                    <td style={td}>{r.fires}</td>
                    <td style={{ ...td, color: (r.winRate ?? 0) >= 0.5 ? WIN : SOFT_RED }}>{pct(r.winRate)}</td>
                    <td style={{ ...td, color: (r.avgUsd ?? 0) >= 0 ? WIN : SOFT_RED }}>{usd(r.avgUsd)}</td>
                    <td style={td}>{r.pf == null ? "—" : r.pf.toFixed(2)}</td>
                    <td style={{ ...td, color: SOFT_RED }}>{usd(-r.maxDd)}</td>
                  </tr>
                ))}
                {!busy && !(data?.sweep ?? []).length && (
                  <tr><td colSpan={8} style={{ ...td, textAlign: "left", fontFamily: "inherit", opacity: 0.6 }}>
                    No combination reached 8 fires in this window.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title={logTab === "fired" ? "Fired Trades" : "Rejected Trades"}
          sub={logTab === "fired"
            ? `Replayed under exit ${exitId} · newest first`
            : `The stack said no — replayed under exit ${exitId} anyway`}
          right={<Seg options={[{ v: "fired", l: "Fired" }, { v: "rejected", l: "Rejected" }]} value={logTab} onChange={(v) => setLogTab(v as "fired" | "rejected")} />}
        >
          <div style={{ overflowX: "auto", maxHeight: 460 }} className="wall-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead><tr>{["Date", "Side", "Strike", "In", "Out", "Exit", "Hold", "P/L"].map((h, i) => (
                <th key={h} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}</tr></thead>
              <tbody>
                {logRows.map((t) => (
                  <tr key={t.id}>
                    <td style={{ ...td, textAlign: "left", fontFamily: "inherit" }}>
                      {t.date}
                      {t.blockedBy?.length ? (
                        <div style={{ fontSize: 10, opacity: 0.5, fontFamily: MONO }}>by {t.blockedBy.join(", ")}</div>
                      ) : null}
                    </td>
                    <td style={{ ...td, fontFamily: "inherit", color: t.side === "P" ? SOFT_RED : C.lightBlue }}>{t.side === "P" ? "PUT" : "CALL"}</td>
                    <td style={td}>{t.strike ?? "—"}</td>
                    <td style={td}>{t.entry?.toFixed(2) ?? "—"}</td>
                    <td style={td}>{t.exit?.toFixed(2) ?? "—"}</td>
                    <td style={{ ...td, fontFamily: "inherit" }}><Pill tone={REASON_TONE[t.reason]}>{t.reason}</Pill></td>
                    <td style={td}>{t.holdMin == null ? "—" : `${t.holdMin}m`}</td>
                    {/* On the REJECTED tab a profit is bad news — it is money the
                        stack refused — so the colours invert with the tab. */}
                    <td style={{ ...td, color: (t.pnlUsd ?? 0) >= 0 ? (logTab === "fired" ? WIN : SOFT_RED) : (logTab === "fired" ? SOFT_RED : WIN) }}>
                      {usd(t.pnlUsd)}
                    </td>
                  </tr>
                ))}
                {!busy && !logRows.length && (
                  <tr><td colSpan={8} style={{ ...td, textAlign: "left", fontFamily: "inherit", opacity: 0.6 }}>
                    {logTab === "fired"
                      ? `Nothing fired at ${clockLabel} under this stack.`
                      : `Nothing was rejected at ${clockLabel} — the stack took every fill.`}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div style={{ ...CARD, padding: "14px 18px", fontSize: 11, opacity: 0.55, lineHeight: 1.6 }}>
        Read-only. Nothing on this tab places, modifies or cancels an order — the ticket above is what the armed stack
        WOULD send, priced off the recorded probe. Arming it for real needs an order path that does not exist yet.
      </div>

      <style>{`@media (max-width: 1180px) { .abl-2col { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

// ── The ticket ──────────────────────────────────────────────────────────────

function Ticket({ fires, side, strike, prem, occ, exit, size, multiplier, expectancy, failing, stale }: {
  fires: boolean; side: string | null; strike: number | null; prem: number | null; occ: string | null;
  exit: ApiExit | null; size: number; multiplier: number; expectancy: number | null;
  failing: string[]; stale: boolean;
}) {
  if (prem == null || strike == null || exit == null) {
    return <div style={{ fontSize: 13, opacity: 0.6 }}>No recorded contract at this checkpoint to price a ticket against.</div>;
  }
  const isPut = side === "P";
  const debit = prem * multiplier * size;
  const targetPx = prem * (1 + exit.target);
  const stopPx = prem * (1 - exit.stop);
  const armPx = exit.trailArm == null ? null : prem * (1 + exit.trailArm);
  const maxGain = debit * exit.target;
  const maxRisk = debit * exit.stop;
  const ev = expectancy == null ? null : expectancy * size;

  const tone = fires ? WIN : C.gold;
  return (
    <div>
      <div style={{
        padding: "14px 16px", borderRadius: 14,
        border: `1px solid ${rgba(tone, 0.35)}`,
        background: `linear-gradient(180deg, ${rgba(tone, 0.11)}, ${rgba(tone, 0.02)})`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: tone }}>
            {fires ? "FIRE" : "NO FIRE"}
          </div>
          {stale && <Pill tone="off">priced off the last recorded session</Pill>}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 800, marginTop: 8, opacity: fires ? 1 : 0.55 }}>
          BUY +{size} SPXW {strike} {isPut ? "P" : "C"} @ {prem.toFixed(2)} LMT
        </div>
        {occ && <div style={{ fontFamily: MONO, fontSize: 10, opacity: 0.4, marginTop: 2 }}>{occ}</div>}
        {!fires && (
          <div style={{ fontSize: 11, opacity: 0.75, marginTop: 6, lineHeight: 1.55 }}>
            {failing.length ? `Blocked by: ${failing.join(", ")}.` : "No armed filter has a read at this checkpoint."}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(128px,1fr))", gap: 10, marginTop: 12 }}>
        <Field label="Debit" value={usd(debit, 0)} />
        <Field label={`Target +${Math.round(exit.target * 100)}%`} value={targetPx.toFixed(2)} color={WIN} />
        <Field label={`Stop −${Math.round(exit.stop * 100)}%`} value={stopPx.toFixed(2)} color={SOFT_RED} />
        {armPx != null && <Field label={`Trail arms +${Math.round((exit.trailArm ?? 0) * 100)}%`} value={armPx.toFixed(2)} color={C.gold} />}
        <Field label="Max gain at target" value={usd(maxGain)} color={WIN} />
        <Field label="Max risk at stop" value={usd(-maxRisk)} color={SOFT_RED} />
        <Field label="Expected value" value={usd(ev)} color={(ev ?? 0) >= 0 ? WIN : SOFT_RED} />
      </div>
    </div>
  );
}

/**
 * One arm of the comparison. `invert` flips the colour logic: on the REJECTED
 * arm a profitable total is BAD news — it means the filters threw away money —
 * so green/red are swapped rather than the number being hidden.
 */
function ArmCard({ label, sub, s, tone, invert }: {
  label: string; sub: string; s?: Stats; tone: string; invert?: boolean;
}) {
  const total = s?.totalUsd ?? null;
  const good = total == null ? null : (invert ? total < 0 : total > 0);
  return (
    <div style={{ ...CARD, padding: "14px 16px", borderColor: rgba(tone.startsWith("#") ? tone : WIN, 0.22) }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: tone }}>{label}</div>
        <div style={{ fontFamily: MONO, fontSize: 12, opacity: 0.6 }}>{s?.fires ?? 0} trades</div>
      </div>
      <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{sub}</div>
      <div style={{
        fontFamily: MONO, fontSize: 24, fontWeight: 800, marginTop: 6, letterSpacing: "-0.02em",
        color: good == null ? "inherit" : good ? WIN : SOFT_RED,
      }}>{usd(total)}</div>
      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2, fontFamily: MONO }}>
        win {pct(s?.winRate)} · avg {usd(s?.avgUsd)}
      </div>
      {invert && total != null && (
        <div style={{ fontSize: 11, marginTop: 6, color: total > 0 ? SOFT_RED : WIN, lineHeight: 1.5 }}>
          {total > 0
            ? `The refused trades made ${usd(total)}. The stack is costing you money at this clock.`
            : `The refused trades lost ${usd(Math.abs(total))}. The stack is earning its place.`}
        </div>
      )}
    </div>
  );
}

function DeltaTile({ label, from, to, fmt, goodUp }: {
  label: string; from: number | null; to: number | null; fmt: (v: number | null) => string; goodUp?: boolean;
}) {
  const changed = from !== to;
  const up = (to ?? 0) > (from ?? 0);
  const good = goodUp ? up : !up;
  const color = !changed ? "rgba(255,255,255,0.5)" : good ? WIN : SOFT_RED;
  return (
    <div style={{ background: INSET, border: `1px solid ${changed ? rgba(good ? WIN : RED, 0.25) : C.border}`, borderRadius: 11, padding: "10px 12px" }}>
      <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.5, fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 800, marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ opacity: 0.45 }}>{fmt(from)}</span>
        <span style={{ opacity: 0.35 }}>→</span>
        <span style={{ color }}>{fmt(to)}</span>
      </div>
    </div>
  );
}

// ── Rows, chrome, charts ────────────────────────────────────────────────────

function FilterRow({ f, on, read, onClick }: { f: ApiFilter; on: boolean; read: boolean | null; onClick: () => void }) {
  // Four states, and the fourth matters: a filter with NO DATA on this session
  // is not a filter that failed. Showing both as a red ✕ is how you end up
  // hunting a bug in a rule that simply had nothing to read.
  const state = !on ? "off" : read == null ? "nodata" : read ? "pass" : "fail";
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      style={{
        display: "grid", gridTemplateColumns: "38px 1fr auto 74px", gap: 10, alignItems: "center",
        padding: "10px 12px", borderRadius: 12, marginBottom: 8, cursor: "pointer",
        background: state === "pass" ? `linear-gradient(90deg, ${rgba(C.cyan, 0.07)}, ${INSET})` : INSET,
        border: `1px solid ${
          state === "off" ? "rgba(255,255,255,0.05)"
            : state === "fail" ? rgba(RED, 0.25)
              : state === "pass" ? rgba(C.cyan, 0.28) : rgba(HOME_THEME.gold, 0.22)
        }`,
        transition: "border-color .15s, background .15s",
      }}
    >
      <Switch on={on} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, opacity: on ? 1 : 0.5 }}>{f.name}</div>
        <div style={{ fontSize: 11, opacity: 0.55, marginTop: 1 }}>{f.detail}</div>
        <div style={{ fontSize: 10, opacity: 0.4, marginTop: 2, fontFamily: MONO }}>
          passes {f.passes ?? 0}/{f.of ?? 0} measured
          {f.unmeasurable ? ` · ${f.unmeasurable} no data` : ""}
          {f.lift == null ? "" : ` · lift ${usd(f.lift)}`}
        </div>
        {f.veto && f.veto.fires > 0 && (
          <div style={{ fontSize: 10, marginTop: 3, fontFamily: MONO, color: f.veto.totalUsd > 0 ? SOFT_RED : WIN }}>
            vetoed {f.veto.fires} → they {f.veto.totalUsd > 0 ? "made" : "lost"} {usd(Math.abs(f.veto.totalUsd))}
            {f.veto.totalUsd > 0 ? " (blocking winners)" : " (blocking losers)"}
          </div>
        )}
      </div>
      {state === "off" ? <Pill tone="off">off</Pill>
        : state === "pass" ? <Pill tone="good">● PASS</Pill>
          : state === "fail" ? <Pill tone="bad">✕ FAIL</Pill>
            : <Pill tone="warn">no read</Pill>}
      <div style={{ fontFamily: MONO, fontSize: 12, opacity: 0.7, textAlign: "right" }}>w {f.weight.toFixed(1)}</div>
    </div>
  );
}

const th: React.CSSProperties = {
  fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.5, fontWeight: 800,
  textAlign: "right", padding: "8px 10px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
  position: "sticky", top: 0, background: "#0D1119",
};
const td: React.CSSProperties = {
  padding: "9px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "right",
  fontFamily: MONO, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
};

const MIX_KEYS = ["target", "trail", "struct", "stop", "time"] as const;
const MIX_COLORS = [WIN, HOME_THEME.gold, HOME_THEME.lightBlue, RED, "rgba(255,255,255,0.35)"];

function Panel({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
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

function Kpi({ k, v, d, vc }: { k: string; v: string; d: string; vc?: string }) {
  return (
    <div style={{ ...CARD, padding: "14px 16px" }}>
      <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.5, fontWeight: 700, marginBottom: 4 }}>{k}</div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", fontFamily: MONO, fontVariantNumeric: "tabular-nums", lineHeight: 1.15, color: vc ?? "inherit" }}>{v}</div>
      <div style={{ fontSize: 11, marginTop: 3, opacity: 0.7 }}>{d}</div>
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

const REASON_TONE: Record<ApiTrade["reason"], Tone> = {
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
      <span style={{ position: "absolute", top: 2, left: on ? 17 : 2, width: 13, height: 13, borderRadius: "50%", background: on ? "#fff" : "#cfd6de", transition: "left .15s" }} />
    </div>
  );
}

function Seg({ options, value, onChange }: { options: { v: string; l: string }[]; value: string; onChange: (v: string) => void }) {
  if (!options.length) return null;
  return (
    <div style={{ display: "flex", gap: 4, background: INSET, padding: 4, borderRadius: 12, border: `1px solid ${C.border}` }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            style={{
              fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
              border: `1px solid ${on ? rgba(C.cyan, 0.3) : "transparent"}`,
              background: on ? `linear-gradient(180deg, ${rgba(C.cyan, 0.16)}, ${rgba(C.cyan, 0.04)})` : "transparent",
              color: on ? C.lightBlue : "rgba(255,255,255,0.55)",
              boxShadow: on ? `0 0 14px ${rgba(C.cyan, 0.18)}` : "none",
            }}
          >{o.l}</button>
        );
      })}
    </div>
  );
}

function Gauge({ score }: { score: number | null }) {
  const LEN = 226;
  const s = score ?? 0;
  const offset = LEN - (LEN * Math.max(0, Math.min(100, s))) / 100;
  const a = Math.PI * (1 - ARM_THRESHOLD / 100);
  const tx = 88 + 72 * Math.cos(a);
  const ty = 100 - 72 * Math.sin(a);
  return (
    <svg width="176" height="112" viewBox="0 0 176 112" aria-label={`Confluence score ${score ?? "unavailable"}`}>
      <defs>
        <linearGradient id="abl-gauge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={RED} /><stop offset="45%" stopColor={HOME_THEME.gold} /><stop offset="100%" stopColor={WIN} />
        </linearGradient>
      </defs>
      <path d="M16 100 A72 72 0 0 1 160 100" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="15" strokeLinecap="round" />
      <path d="M16 100 A72 72 0 0 1 160 100" fill="none" stroke="url(#abl-gauge)" strokeWidth="15" strokeLinecap="round"
        strokeDasharray={LEN} strokeDashoffset={offset} opacity={score == null ? 0.15 : 0.95}
        style={{ transition: "stroke-dashoffset .3s ease" }} />
      <line x1={tx} y1={ty} x2={tx + 9} y2={ty - 8} stroke="#fff" strokeWidth="2" opacity="0.65" />
      <text x="88" y="86" textAnchor="middle" fontSize="30" fontWeight="900" fill="#fff" fontFamily="ui-monospace,monospace">{score ?? "—"}</text>
      <text x="88" y="103" textAnchor="middle" fontSize="9" fill="rgba(255,255,255,.5)" letterSpacing="1.5">{`ARM ≥ ${ARM_THRESHOLD}`}</text>
    </svg>
  );
}

function LiftChart({ filters, armed }: { filters: ApiFilter[]; armed: string[] }) {
  const rows = [...filters].sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0));
  const max = Math.max(...rows.map((r) => Math.abs(r.lift ?? 0)), 1);
  const H = 36;
  if (!rows.length) return <div style={{ fontSize: 13, opacity: 0.6 }}>No wired filters to score.</div>;
  return (
    <svg viewBox={`0 0 520 ${rows.length * H + 24}`} width="100%" height={rows.length * H + 24} fontFamily="Inter, sans-serif">
      <line x1="230" y1="6" x2="230" y2={rows.length * H} stroke="rgba(255,255,255,0.28)" />
      {rows.map((r, i) => {
        const y = i * H + 10;
        const lift = r.lift ?? 0;
        const w = (Math.abs(lift) / max) * 250;
        const pos = lift >= 0;
        const on = armed.includes(r.id);
        return (
          <g key={r.id} opacity={on ? 1 : 0.5}>
            <text x="220" y={y + 14} fontSize="11" fill="rgba(255,255,255,.82)" textAnchor="end">{r.name}</text>
            <rect x={pos ? 230 : 230 - w} y={y} width={w} height="19" rx="4" fill={pos ? C.cyan : RED} opacity={0.45 + 0.4 * (Math.abs(lift) / max)} />
            <text x={pos ? 230 + w + 8 : 230 - w - 8} y={y + 14} fontSize="11" fontFamily="ui-monospace,monospace" textAnchor={pos ? "start" : "end"} fill={pos ? "#fff" : SOFT_RED}>
              {usd(lift)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function EquityChart({ points }: { points: { date: string; cum: number }[] }) {
  if (points.length < 2) {
    return <div style={{ fontSize: 13, opacity: 0.6, padding: "40px 0", textAlign: "center" }}>Not enough fired trades to draw a curve.</div>;
  }
  const W = 1200, H = 260;
  const vals = points.map((p) => p.cum);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / span) * (H - 20) - 10;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cum).toFixed(1)}`).join(" ");
  const zero = y(0);
  const end = points[points.length - 1].cum;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
        <defs>
          <linearGradient id="abl-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={end >= 0 ? WIN : RED} stopOpacity="0.22" />
            <stop offset="100%" stopColor={end >= 0 ? WIN : RED} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={zero} x2={W} y2={zero} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" />
        <path d={`${path} L${W},${zero} L0,${zero} Z`} fill="url(#abl-fill)" />
        <path d={path} fill="none" stroke={end >= 0 ? WIN : RED} strokeWidth="2.4" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.4, marginTop: 6, letterSpacing: "0.1em" }}>
        <span>{points[0].date}</span>
        <span style={{ fontFamily: MONO, opacity: 0.8 }}>{usd(end)}</span>
        <span>{points[points.length - 1].date}</span>
      </div>
    </>
  );
}

function heat(v: number | null): string {
  if (v == null) return "rgba(255,255,255,0.05)";
  const mag = Math.min(Math.abs(v) / 150, 1);
  if (v > 8) return rgba(WIN, 0.10 + mag * 0.62);
  if (v < -8) return rgba(RED, 0.08 + mag * 0.5);
  return "rgba(255,255,255,0.08)";
}
