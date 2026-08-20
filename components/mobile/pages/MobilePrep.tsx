"use client";

/**
 * MobilePrep — Premarket Prep + Post-Market Recap, phone edition.
 *
 * Replaces the Estimated Moves tab in the bottom bar (see components/mobile/
 * mobileNav.ts). EM was one number a day and it is still on the desktop /em
 * page; this is the screen you actually open before the bell and again after
 * the close.
 *
 * NOT a restyled desktop page. components/pages/Premarket.tsx lays out three
 * columns of inline-styled cards and could never be squeezed into 390px — what
 * is shared is the DATA, not the markup:
 *
 *   useMobileGex          the one live-GEX layer, same socket, same 0DTE pin.
 *   useEsCandles          overnight high/low, prior close, today's RTH range.
 *   postMarketData.ts     the recorded ladder, the SAVED wall grades from
 *                         server-v2/walls-recorder.js, and the next expiry's
 *                         structure — the exact hooks the desktop tab uses, so
 *                         the phone can never disagree with the laptop about
 *                         how the day went.
 *
 * Phone-specific decisions:
 *   - The desktop's horizontal level rail becomes a VERTICAL ladder. Five labels
 *     across 358px overlap; the same five as rows, sorted high to low with spot
 *     inline, read at a glance and need no legend. It also REPLACES the shared
 *     LevelsBar on this page rather than sitting under it: the two showed the
 *     same four numbers, and LevelsBar paints the walls on the CHART's blue/red
 *     pole ramp, which would have put two different wall colours on one screen.
 *   - PRE / POST is a segmented control that picks itself by the clock and then
 *     stays where you put it (sessionStorage), same rule as the desktop tab.
 *   - Every grid goes through gridCols() — see mobileTheme, the app-wide GLOBAL
 *     GRID COLLAPSE in globals.css would otherwise flatten these.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMobileGex } from "@/hooks/useMobileGex";
import { useEsCandles } from "@/hooks/useEsCandles";
import { netGEXOf } from "@/lib/calculations/calculations";
import MobileShell from "../MobileShell";
import ExpiryBadge from "../ExpiryBadge";
import { MCard, MEmpty, MSegmented, MStat, MStatGrid, MStatusDot } from "../MobileUI";
import {
  M_COLOR, MONO, RADIUS, TYPE, fmtMoney, fmtPrice, gridCols, mTile, rgba,
} from "../mobileTheme";
import {
  RTH_CLOSE_MIN,
  RTH_OPEN_MIN,
  etHm,
  etMinutes,
  useIntradayLadder,
  useNextExpiryStructure,
  useRecordedWalls,
  REACTION_LABEL,
  REACTION_TONE,
  type WallLevel,
} from "@/components/pages/premarket/postMarketData";

const TAB_KEY = "cb-mprep-tab-v1";

type View = "pre" | "post";
const VIEWS: { id: View; label: string }[] = [
  { id: "pre", label: "Premarket" },
  { id: "post", label: "Post-Market" },
];

/**
 * WALL COLOURS — call wall GREEN, put wall RED, on every ticker and every
 * surface. Deliberately not M_COLOR.pos / .neg: those two mean "positive or
 * negative gamma" and belong to the bars and the heat ramp. Flipping the wall
 * convention must not re-colour a single bar, so the levels get their own pair.
 * The desktop board carries the same split as --cw / --pw.
 */
const CW_COLOR = M_COLOR.up;
const PW_COLOR = M_COLOR.down;

const TONE_COLOR: Record<"ok" | "bad" | "warn" | "vio", string> = {
  ok: M_COLOR.up, bad: M_COLOR.neg, warn: M_COLOR.orange, vio: M_COLOR.cb,
};

/** ET wall clock for "now", as { date, minutes }. */
function etNow(ts: number) {
  const date = new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return { date, minutes: etMinutes(ts) };
}

const pts = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}`;

const px0 = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) || v <= 0 ? "—" : Math.round(v).toLocaleString("en-US");

// ─────────────────────────────────────────────────────────────────────────────
//  the vertical level ladder — the phone's answer to the desktop rail
// ─────────────────────────────────────────────────────────────────────────────

function LevelLadder({
  rows,
}: {
  rows: { code: string; name: string; px: number; color: string; dist: number | null; isSpot?: boolean }[];
}) {
  if (rows.length < 2) return <MEmpty>Waiting for the chain…</MEmpty>;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map((r, i) => (
        <div
          key={r.code}
          style={{
            display: "grid",
            ...gridCols("64px 1fr auto"),
            alignItems: "center",
            gap: 10,
            padding: "7px 0",
            borderTop: i === 0 ? "none" : `1px solid ${rgba("#ffffff", 0.06)}`,
            // Spot is the row everything else is measured from, so it gets the
            // only filled background on the ladder.
            background: r.isSpot ? rgba("#ffffff", 0.05) : "transparent",
            borderRadius: r.isSpot ? RADIUS.sm : 0,
            paddingLeft: r.isSpot ? 8 : 0,
            paddingRight: r.isSpot ? 8 : 0,
          }}
        >
          <span
            style={{
              fontSize: TYPE.micro - 1, fontWeight: 800, letterSpacing: "0.08em",
              color: r.color, whiteSpace: "nowrap",
            }}
          >
            {r.code}
          </span>
          <span style={{ fontSize: TYPE.micro, color: M_COLOR.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {r.name}
          </span>
          <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ ...MONO, fontSize: TYPE.value + 1, fontWeight: 700, color: r.isSpot ? M_COLOR.text : r.color }}>
              {px0(r.px)}
            </span>
            <span style={{ ...MONO, fontSize: TYPE.micro, fontWeight: 700, width: 42, textAlign: "right",
              color: r.dist == null ? "transparent" : r.dist >= 0 ? M_COLOR.up : M_COLOR.down }}>
              {r.dist == null ? "—" : pts(r.dist)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function MobilePrep() {
  const g = useMobileGex("oi-vol");
  const { sessionCandles } = useEsCandles(true, 2, 5, false);

  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const { date: etDate, minutes: etMin } = etNow(clock);
  const afterClose = etMin >= RTH_CLOSE_MIN + 5;

  // PRE before the bell, POST after the settle — until you pick, then your pick
  // holds for the session. Same rule as the desktop tab.
  const [view, setView] = useState<View>("pre");
  const pinned = useRef(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(TAB_KEY);
      if (saved === "pre" || saved === "post") { pinned.current = true; setView(saved); }
    } catch { /* private mode */ }
  }, []);
  useEffect(() => {
    if (pinned.current) return;
    setView(afterClose ? "post" : "pre");
  }, [afterClose]);
  const pick = useCallback((v: View) => {
    pinned.current = true;
    setView(v);
    try { sessionStorage.setItem(TAB_KEY, v); } catch { /* nothing to do */ }
  }, []);

  const isPost = view === "post";

  // ── derived, off the same chain the desktop uses ───────────────────────────
  const perStrike = useMemo(() => {
    if (!g.chain.length || !(g.spot > 0)) return [];
    return g.chain
      .map((r) => ({ strike: r.strike, net: netGEXOf(r, "net", g.spot) }))
      .filter((r) => Number.isFinite(r.net))
      .sort((a, b) => a.strike - b.strike);
  }, [g.chain, g.spot]);

  /** CORE (CB) — the strike carrying the most absolute gamma. */
  const cb = useMemo(() => {
    if (!perStrike.length) return null;
    return perStrike.reduce((b, r) => (Math.abs(r.net) > Math.abs(b.net) ? r : b), perStrike[0]);
  }, [perStrike]);

  /** ATM straddle × 0.85, else ATM IV × √(1 day) — the desktop's formula. */
  const em = useMemo(() => {
    if (!g.chain.length || !(g.spot > 0)) return null;
    const atm = g.chain.reduce((b, r) => (Math.abs(r.strike - g.spot) < Math.abs(b.strike - g.spot) ? r : b), g.chain[0]);
    const cm = atm.callMark ?? ((atm.bid ?? 0) + (atm.ask ?? 0)) / 2;
    const pm = atm.putMark ?? 0;
    if (cm > 0 && pm > 0) return (cm + pm) * 0.85;
    const iv = ((atm.callIV ?? 0) + (atm.putIV ?? 0)) / 2;
    return iv > 0 ? g.spot * iv * Math.sqrt(1 / 252) : null;
  }, [g.chain, g.spot]);

  const basis = g.basis;
  const toSpx = useCallback((esPx: number | null | undefined) =>
    esPx == null || basis == null ? null : esPx - basis, [basis]);

  /** Overnight window + today's RTH, off the ES bars (ES prices). */
  const session = useMemo(() => {
    if (!sessionCandles.length) return null;
    let pdDate = "";
    for (const c of sessionCandles) {
      const d = c.date ?? c.slotKey.slice(0, 10);
      if (d < etDate && d > pdDate) pdDate = d;
    }
    let hi = -Infinity, lo = Infinity, rthHi = -Infinity, rthLo = Infinity;
    let pdc: number | null = null, pdcTs = -1;
    for (const c of sessionCandles) {
      const d = c.date ?? c.slotKey.slice(0, 10);
      const hm = c.slotKey.slice(11, 16).split(":").map(Number);
      const mins = Number.isFinite(hm[0]) ? hm[0] * 60 + (hm[1] || 0) : -1;
      if (mins < 0) continue;
      if ((d === etDate && mins < RTH_OPEN_MIN) || (d < etDate && mins >= 18 * 60)) {
        if (c.high > hi) hi = c.high;
        if (c.low < lo) lo = c.low;
      }
      if (d === pdDate && mins >= RTH_OPEN_MIN && mins < RTH_CLOSE_MIN && c.timestamp > pdcTs) {
        pdcTs = c.timestamp; pdc = c.close;
      }
      if (d === etDate && mins >= RTH_OPEN_MIN && mins < RTH_CLOSE_MIN) {
        if (c.high > rthHi) rthHi = c.high;
        if (c.low < rthLo) rthLo = c.low;
      }
    }
    return {
      onHi: Number.isFinite(hi) ? hi : null,
      onLo: Number.isFinite(lo) ? lo : null,
      pdc,
      rthHi: Number.isFinite(rthHi) ? rthHi : null,
      rthLo: Number.isFinite(rthLo) ? rthLo : null,
    };
  }, [sessionCandles, etDate]);

  const posGamma = (g.totalNetGex ?? 0) >= 0;
  const distFlip = g.spot > 0 && g.flip ? g.spot - g.flip : null;

  const ladderRows = useMemo(() => {
    const out: { code: string; name: string; px: number; color: string; dist: number | null; isSpot?: boolean }[] = [];
    const add = (code: string, name: string, v: number | null | undefined, color: string, isSpot = false) => {
      if (v != null && Number.isFinite(v) && v > 0) {
        out.push({ code, name, px: v, color, dist: isSpot || !(g.spot > 0) ? null : v - g.spot, isSpot });
      }
    };
    add("CW", "call wall", g.callWall, CW_COLOR);
    add("CORE", "max γ strike", cb?.strike, M_COLOR.cb);
    add("SPOT", g.esFut > 0 ? `ES ${fmtPrice(g.esFut, 2)}` : "live", g.spot > 0 ? g.spot : null, M_COLOR.text, true);
    add("FLIP", "gamma flip", g.flip, M_COLOR.orange);
    add("PW", "put wall", g.putWall, PW_COLOR);
    return out.sort((a, b) => b.px - a.px);
  }, [g.callWall, g.putWall, g.flip, g.spot, g.esFut, cb]);

  // ── POST-only data. The hooks are only mounted on that view, so the phone
  //    does not spend a request on the recap while you are reading the map. ──
  return (
    <MobileShell
      title={isPost ? "Post-Market Recap" : "Premarket Prep"}
      right={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {g.totalNetGex != null && (
            <span style={{ ...MONO, fontSize: TYPE.label, fontWeight: 800, color: posGamma ? M_COLOR.pos : M_COLOR.neg }}>
              {fmtMoney(g.totalNetGex)}
            </span>
          )}
          <MStatusDot live={g.source === "live" && g.connected} label={g.source === "rest" ? "DELAYED" : undefined} />
        </div>
      }
      sticky={
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <MSegmented options={VIEWS} value={view} onChange={pick} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ExpiryBadge expiry={g.expiry} isZeroDte={g.isZeroDte} />
            <span style={{ fontSize: TYPE.micro, color: M_COLOR.faint, marginLeft: "auto" }}>
              {isPost ? etDate : etMin < RTH_OPEN_MIN
                ? `open in ${Math.floor((RTH_OPEN_MIN - etMin) / 60)}h ${String((RTH_OPEN_MIN - etMin) % 60).padStart(2, "0")}m`
                : etMin < RTH_CLOSE_MIN ? "RTH open" : "after the close"}
            </span>
          </div>
        </div>
      }
    >
      {!g.hasData && <MEmpty tall>{g.connected ? "Loading the SPX chain…" : "Connecting to the live feed…"}</MEmpty>}

      {g.hasData && !isPost && (
        <PreView
          g={g}
          em={em}
          cb={cb}
          posGamma={posGamma}
          distFlip={distFlip}
          ladderRows={ladderRows}
          session={session}
          toSpx={toSpx}
        />
      )}

      {g.hasData && isPost && (
        <PostView
          g={g}
          etDate={etDate}
          cb={cb}
          session={session}
          toSpx={toSpx}
          perStrike={perStrike}
        />
      )}
    </MobileShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  PRE
// ─────────────────────────────────────────────────────────────────────────────

type Gex = ReturnType<typeof useMobileGex>;
type Session = { onHi: number | null; onLo: number | null; pdc: number | null; rthHi: number | null; rthLo: number | null } | null;

function PreView({
  g, em, cb, posGamma, distFlip, ladderRows, session, toSpx,
}: {
  g: Gex;
  em: number | null;
  cb: { strike: number; net: number } | null;
  posGamma: boolean;
  distFlip: number | null;
  ladderRows: { code: string; name: string; px: number; color: string; dist: number | null; isSpot?: boolean }[];
  session: Session;
  toSpx: (v: number | null | undefined) => number | null;
}) {
  const band = g.callWall != null && g.putWall != null ? Math.abs(g.callWall - g.putWall) : null;
  const onHi = toSpx(session?.onHi);
  const onLo = toSpx(session?.onLo);
  const pdc = toSpx(session?.pdc);
  const gap = pdc != null && g.spot > 0 ? g.spot - pdc : null;

  return (
    <>
      <div
        style={{
          ...mTile,
          padding: "11px 12px",
          background: posGamma ? rgba(M_COLOR.up, 0.09) : rgba(M_COLOR.neg, 0.09),
          border: `1px solid ${posGamma ? rgba(M_COLOR.up, 0.28) : rgba(M_COLOR.neg, 0.28)}`,
        }}
      >
        <div style={{ fontSize: TYPE.lead - 2, fontWeight: 800, letterSpacing: "-0.01em", color: posGamma ? M_COLOR.up : M_COLOR.neg }}>
          {posGamma ? "POSITIVE GAMMA" : "NEGATIVE GAMMA"}
        </div>
        <div style={{ fontSize: TYPE.micro + 1, color: M_COLOR.dim, marginTop: 2 }}>
          {distFlip == null
            ? "No flip in the current chain."
            : `${distFlip >= 0 ? "Above" : "Below"} flip by ${Math.abs(distFlip).toFixed(0)} pts · ${posGamma ? "fade the walls" : "follow the breaks"}`}
        </div>
      </div>

      <MCard title="Levels · high to low">
        <LevelLadder rows={ladderRows} />
      </MCard>

      <MCard title="Expected range" padded>
        <MStatGrid cols={3}>
          <MStat label="EM" value={em == null ? "—" : `±${em.toFixed(0)}`} sub={em && g.spot > 0 ? `±${((em / g.spot) * 100).toFixed(2)}%` : undefined} accent={M_COLOR.blue} />
          <MStat label="Wall band" value={band == null ? "—" : `${band.toFixed(0)} pts`} sub={g.putWall != null && g.callWall != null ? `${px0(g.putWall)}–${px0(g.callWall)}` : undefined} />
          <MStat label="CORE" value={px0(cb?.strike)} sub={cb && g.spot > 0 ? `${pts(cb.strike - g.spot)} pts` : undefined} accent={M_COLOR.cb} />
        </MStatGrid>
      </MCard>

      <MCard title="Overnight">
        <MStatGrid cols={2}>
          <MStat label="ON high" value={px0(onHi)} sub={onHi != null && g.spot > 0 ? `${pts(onHi - g.spot)} from spot` : undefined} accent={M_COLOR.up} />
          <MStat label="ON low" value={px0(onLo)} sub={onLo != null && g.spot > 0 ? `${pts(onLo - g.spot)} from spot` : undefined} accent={M_COLOR.down} />
          <MStat label="Prior close" value={px0(pdc)} sub="SPX-equivalent" />
          <MStat
            label="Gap"
            value={gap == null ? "—" : `${pts(gap)} pts`}
            accent={gap == null ? undefined : gap >= 0 ? M_COLOR.up : M_COLOR.down}
            sub={onHi != null && onLo != null ? `ON range ${(onHi - onLo).toFixed(0)}` : undefined}
          />
        </MStatGrid>
      </MCard>

      <div style={{ ...mTile, padding: "10px 12px", background: rgba(M_COLOR.blue, 0.06), border: `1px solid ${rgba(M_COLOR.blue, 0.22)}` }}>
        <div style={{ fontSize: TYPE.micro, color: M_COLOR.dim, lineHeight: 1.45 }}>
          {g.callWall != null && g.putWall != null ? (
            <>
              <b style={{ color: M_COLOR.text }}>Base case</b> {px0(g.putWall)}–{px0(g.callWall)}.{" "}
              {posGamma
                ? `Fade the edges toward ${px0(cb?.strike)}.`
                : "Two-sided and fast — size down and trade the breaks."}{" "}
              {g.flip != null && <>Below <b style={{ color: M_COLOR.orange }}>{px0(g.flip)}</b> the regime turns.</>}
            </>
          ) : (
            "Waiting for both walls before calling a base case."
          )}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST
// ─────────────────────────────────────────────────────────────────────────────

function PostView({
  g, etDate, cb, session, toSpx, perStrike,
}: {
  g: Gex;
  etDate: string;
  cb: { strike: number; net: number } | null;
  session: Session;
  toSpx: (v: number | null | undefined) => number | null;
  perStrike: { strike: number; net: number }[];
}) {
  const { cols, state: histState } = useIntradayLadder(true, g.expiry || "");
  const { next, state: nextState } = useNextExpiryStructure(true, g.expiry || "", g.spot);
  const { byLevel: recorded, state: wallState } = useRecordedWalls(etDate, "SPX");

  const rthHi = toSpx(session?.rthHi);
  const rthLo = toSpx(session?.rthLo);
  const pdc = toSpx(session?.pdc);
  const dayChg = pdc != null && g.spot > 0 ? g.spot - pdc : null;

  const openNetGex = cols.length ? cols[0].cells.reduce((s, x) => s + x.net, 0) : null;
  const netGexChg = openNetGex != null && g.totalNetGex != null ? g.totalNetGex - openNetGex : null;

  const verdict = useMemo(() => {
    if (!(g.spot > 0) || rthHi == null || rthLo == null || g.callWall == null || g.putWall == null) {
      return { t: "NOT ENOUGH OF THE DAY YET", c: M_COLOR.faint };
    }
    if (rthHi > g.callWall && rthLo < g.putWall) return { t: "BOTH WALLS GAVE", c: M_COLOR.neg };
    if (rthHi > g.callWall) return { t: "BROKE THE CALL WALL", c: M_COLOR.neg };
    if (rthLo < g.putWall) return { t: "BROKE THE PUT WALL", c: M_COLOR.neg };
    if (cb && Math.abs(g.spot - cb.strike) <= Math.max(5, g.spot * 0.0008)) return { t: "PINNED TO CORE", c: M_COLOR.cb };
    return { t: "HELD THE RANGE", c: M_COLOR.up };
  }, [g.spot, g.callWall, g.putWall, rthHi, rthLo, cb]);

  const GRADE_ROWS: { lvl: WallLevel; label: string; color: string; live: number | null }[] = [
    { lvl: "call_wall", label: "Call Wall", color: CW_COLOR, live: g.callWall },
    { lvl: "cb", label: "CORE", color: M_COLOR.cb, live: cb?.strike ?? null },
    { lvl: "put_wall", label: "Put Wall", color: PW_COLOR, live: g.putWall },
  ];

  const nextBand = next?.callWall != null && next?.putWall != null ? Math.abs(next.callWall - next.putWall) : null;
  const todayBand = g.callWall != null && g.putWall != null ? Math.abs(g.callWall - g.putWall) : null;

  return (
    <>
      <div style={{ ...mTile, padding: "11px 12px", background: rgba(verdict.c, 0.09), border: `1px solid ${rgba(verdict.c, 0.28)}` }}>
        <div style={{ fontSize: TYPE.lead - 3, fontWeight: 800, color: verdict.c }}>{verdict.t}</div>
        <div style={{ ...MONO, fontSize: TYPE.micro + 1, color: M_COLOR.dim, marginTop: 3 }}>
          {px0(g.spot)}
          {dayChg != null && (
            <span style={{ color: dayChg >= 0 ? M_COLOR.up : M_COLOR.down }}>{"  "}{pts(dayChg)} pts</span>
          )}
          {rthHi != null && rthLo != null && `  ·  H ${px0(rthHi)} / L ${px0(rthLo)}`}
        </div>
      </div>

      <MCard title="Net GEX · open → now">
        <MStatGrid cols={2}>
          <MStat label="At 09:30" value={openNetGex == null ? "—" : fmtMoney(openNetGex)} sub={histState === "ok" ? "recorded" : "not recorded"} />
          <MStat
            label="Now"
            value={g.totalNetGex == null ? "—" : fmtMoney(g.totalNetGex)}
            accent={(g.totalNetGex ?? 0) >= 0 ? M_COLOR.pos : M_COLOR.neg}
            sub={netGexChg == null ? undefined : `${fmtMoney(netGexChg)} on the day`}
          />
        </MStatGrid>
      </MCard>

      <MCard title={`Level grades${wallState === "ok" ? " · wall log" : ""}`}>
        {wallState !== "ok" ? (
          <MEmpty>
            {wallState === "loading" ? "Loading the SPX wall log…" : `Nothing recorded for ${etDate}.`}
          </MEmpty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {GRADE_ROWS.map(({ lvl, label, color, live }) => {
              const rec = recorded.get(lvl);
              const last = rec?.events.length ? rec.events[rec.events.length - 1] : null;
              const rx = last?.reaction ?? null;
              const tone = rx ? REACTION_TONE[rx] : null;
              const status = rx ? REACTION_LABEL[rx] : rec ? "UNTESTED" : "—";
              const tone_c = tone ? TONE_COLOR[tone] : M_COLOR.faint;
              return (
                <div key={lvl} style={{ ...mTile, padding: "9px 10px", borderLeft: `3px solid ${color}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: TYPE.micro, fontWeight: 800, letterSpacing: "0.08em", color, textTransform: "uppercase" }}>
                      {label}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span
                      style={{
                        fontSize: TYPE.micro - 1, fontWeight: 800, letterSpacing: "0.05em",
                        color: tone_c, background: rgba(tone_c, 0.12),
                        border: `1px solid ${rgba(tone_c, 0.35)}`, borderRadius: RADIUS.sm - 2, padding: "2px 6px",
                      }}
                    >
                      {status}
                    </span>
                  </div>
                  <div style={{ ...MONO, fontSize: TYPE.value + 1, fontWeight: 700, marginTop: 3 }}>
                    {px0(rec?.last ?? live)}
                  </div>
                  <div style={{ fontSize: TYPE.micro, color: M_COLOR.faint, marginTop: 1 }}>
                    {rec
                      ? [
                          rec.open != null && rec.last != null && rec.open !== rec.last
                            ? `${px0(rec.open)} → ${px0(rec.last)}`
                            : "never moved",
                          rec.moves ? `${rec.moves} rewrites` : null,
                          rec.events.length ? `${rec.events.length} events` : "no touches",
                          last?.reclaim_min != null ? `reclaimed ${last.reclaim_min}m` : null,
                        ].filter(Boolean).join(" · ")
                      : "not in today's log"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </MCard>

      <MCard title="Tomorrow · after 0DTE rolls off">
        {nextState !== "ok" || !next ? (
          <MEmpty>{nextState === "loading" ? "Pulling the next expiry…" : "Next expiry unavailable."}</MEmpty>
        ) : (
          <>
            <MStatGrid cols={2}>
              <MStat label="Call wall" value={px0(next.callWall)} accent={CW_COLOR}
                sub={next.callWall != null && g.spot > 0 ? `${pts(next.callWall - g.spot)} from close` : undefined} />
              <MStat label="Put wall" value={px0(next.putWall)} accent={PW_COLOR}
                sub={next.putWall != null && g.spot > 0 ? `${pts(next.putWall - g.spot)} from close` : undefined} />
              <MStat label="Flip" value={px0(next.flip)} accent={M_COLOR.orange}
                sub={next.flip != null && g.spot > 0 ? `${pts(next.flip - g.spot)} from close` : undefined} />
              <MStat label="CORE" value={px0(next.cb)} accent={M_COLOR.cb}
                sub={next.netGex != null ? fmtMoney(next.netGex) : undefined} />
            </MStatGrid>
            <div style={{ fontSize: TYPE.micro, color: M_COLOR.dim, marginTop: 9, lineHeight: 1.45 }}>
              {(next.netGex ?? 0) >= 0 ? "Positive gamma into tomorrow" : "Negative gamma into tomorrow"}
              {nextBand != null && todayBand != null
                ? nextBand > todayBand
                  ? ` — ${nextBand.toFixed(0)} pts of room vs ${todayBand.toFixed(0)} today, so the fade needs the edges.`
                  : ` — tighter than today (${nextBand.toFixed(0)} vs ${todayBand.toFixed(0)} pts), the walls bind sooner.`
                : "."}
            </div>
          </>
        )}
      </MCard>

      <div style={{ fontSize: TYPE.micro - 1, color: M_COLOR.faint, textAlign: "center", paddingBottom: 4 }}>
        {cols.length
          ? `${cols.length} minutes recorded · ${etHm(cols[0].ts)}–${etHm(cols[cols.length - 1].ts)} ET`
          : "no per-minute ladder recorded today"}
        {perStrike.length ? ` · ${perStrike.length} strikes live` : ""}
      </div>
    </>
  );
}
