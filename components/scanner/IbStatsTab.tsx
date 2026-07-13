"use client";

/**
 * IbStatsTab — /scanner → "IB Stats"
 *
 * Initial Balance (09:30–10:30 ET) rule backtest for ES and NQ.
 *
 * The heavy compute does NOT happen here. It runs once, offline, in
 * ib-backtest-esu6.html ("Export JSON for dashboard"), which reads the raw 1m
 * CSVs and writes one slim record per session to:
 *
 *     public/data/ib-ES.json
 *     public/data/ib-NQ.json
 *
 * This tab just fetches those (~300 KB each) and aggregates. To refresh the
 * dataset: re-run the HTML on new CSVs, drop the new JSON in, bump LAST_UPDATED.
 */

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { Card as ThemeCard } from "@/components/shared/PageCard";
import { useEsCandles } from "@/hooks/useEsCandles";
import { useNqCandles } from "@/hooks/useNqCandles";
import { avg, med, clock, type IbDataset, type SlimDay } from "@/lib/ibStats";

const LAST_UPDATED = "7/11/2026";
const SYMBOLS = ["ES", "NQ"] as const;
type Sym = (typeof SYMBOLS)[number];

/* ── opening-range windows ───────────────────────────────────────────────────
 * Every rule in this tab is window-agnostic: it only ever asks "the range built
 * from 09:30 for N minutes". IB is just N=60. The exporter (ib-backtest-esu6.html)
 * writes the SAME schema for each window, so switching windows is a file swap:
 *
 *   60m → public/data/ib-<SYM>.json
 *   30m → public/data/orb30-<SYM>.json
 *   15m → public/data/orb15-<SYM>.json
 *    5m → public/data/orb5-<SYM>.json
 *
 * A missing file just shows the "dataset not found" card — export it and drop it in.
 */
const WINDOWS = [
  { min: 60, label: "IB 60m", range: "09:30–10:30" },
  { min: 30, label: "ORB 30m", range: "09:30–10:00" },
  { min: 15, label: "ORB 15m", range: "09:30–09:45" },
  { min: 5, label: "ORB 5m", range: "09:30–09:35" },
] as const;
type Win = (typeof WINDOWS)[number]["min"];
const dsPath = (sym: Sym, win: Win) => (win === 60 ? `/data/ib-${sym}.json` : `/data/orb${win}-${sym}.json`);
const winLabel = (win: Win) => WINDOWS.find((w) => w.min === win)!.label;
const winRange = (win: Win) => WINDOWS.find((w) => w.min === win)!.range;
/** minute-of-day the opening range closes (570 = 09:30 ET) */
const rangeEnd = (win: Win) => 570 + win;

/** Card titles are the only non-white font on the page — colored per card via
 *  the `accent` prop. The card SURFACE stays accent-free (no top strip); this
 *  only tints the title text. */
const TITLE_COLORS: Record<string, string> = {
  cyan: HOME_THEME.cyan,
  green: HOME_THEME.green,
  orange: HOME_THEME.orange,
  red: HOME_THEME.red,
  purple: HOME_THEME.purple,
  blue: LIGHT_BLUE,
};

/* ── panel ────────────────────────────────────────────────────────────────────
 * Dashboard card look: variant="budget" (no top accent strip), 16px titles,
 * 15px body, white text throughout — no gray, no per-card accent color.
 * Call sites still pass `accent`; it's accepted and ignored so the tab can
 * never drift back to colored top bars.
 */
function Card({ title, subtitle, children, accent = "cyan" }: {
  accent?: keyof typeof TITLE_COLORS; title?: React.ReactNode; subtitle?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <ThemeCard variant="budget">
      {(title != null || subtitle != null) && (
        <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 3 }}>
          {title != null && (
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.06em", color: TITLE_COLORS[accent] ?? HOME_THEME.cyan }}>{title}</div>
          )}
          {subtitle != null && (
            <div style={{ fontSize: 15, color: HOME_THEME.text }}>{subtitle}</div>
          )}
        </div>
      )}
      {children}
    </ThemeCard>
  );
}

/* ── formatting ───────────────────────────────────────────────────────────── */

const f2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(2));
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");
const rateNum = (n: number, d: number) => (d ? (100 * n) / d : null);

const rateColor = (p: number | null) =>
  p == null ? HOME_THEME.text
  : p >= 60 ? HOME_THEME.green
  : p <= 40 ? HOME_THEME.red
  : HOME_THEME.orange;

const th: React.CSSProperties = {
  padding: "7px 10px", textAlign: "right", fontWeight: 700, fontSize: 15,
  letterSpacing: "0.03em", color: HOME_THEME.text, whiteSpace: "nowrap",
};
const thL: React.CSSProperties = { ...th, textAlign: "left" };
const td: React.CSSProperties = {
  padding: "7px 10px", textAlign: "right", color: HOME_THEME.text,
  fontSize: 15, borderTop: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap",
};
const tdL: React.CSSProperties = { ...td, textAlign: "left" };
const tdDim: React.CSSProperties = { ...td, fontSize: 15 };
const note: React.CSSProperties = { marginTop: 10, fontSize: 15, fontStyle: "italic", color: HOME_THEME.text };

const statGrid: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 14,
};

function Row({ label, n, hits, detail, indent }: {
  label: string; n: number; hits: number; detail?: string; indent?: boolean;
}) {
  const p = rateNum(hits, n);
  return (
    <tr>
      <td style={{ ...tdL, paddingLeft: indent ? 26 : 10 }}>{label}</td>
      <td style={td}>{n}</td>
      <td style={td}>{hits}</td>
      <td style={{ ...td, color: rateColor(p), fontWeight: 800 }}>{p == null ? "—" : `${p.toFixed(1)}%`}</td>
      <td style={tdDim}>{detail ?? ""}</td>
    </tr>
  );
}

function Tbl({ head, children, footNote }: { head: string[]; children: React.ReactNode; footNote?: string }) {
  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{head.map((h, i) => <th key={h} style={i === 0 ? thL : th}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
      {footNote && <div style={note} dangerouslySetInnerHTML={{ __html: footNote }} />}
    </>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 15, letterSpacing: "0.03em", color: HOME_THEME.text }}>{k}</div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 3, color: HOME_THEME.text }}>{v}</div>
      {sub && <div style={{ fontSize: 15, marginTop: 3, color: HOME_THEME.text }}>{sub}</div>}
    </div>
  );
}

const sectionRow = (text: string) => (
  <tr><td colSpan={5} style={{ ...tdL, color: LIGHT_BLUE, fontWeight: 800, fontSize: 15, paddingTop: 14 }}>{text}</td></tr>
);

/* ── LIVE TODAY ───────────────────────────────────────────────────────────────
 * Everything the stats below need in order to be applied to the session that's
 * actually running: today's IB high/low/mid/width, live price, where price sits
 * relative to those levels, and the historical odds for THIS day's weekday and
 * width bucket. Fed by the same ES/NQ candle sockets the rest of the app uses.
 */

/** minute-of-day in ET, straight off the bar timestamp — never trust local tz */
function etMin(ts: number): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ts));
  const h = +(p.find((x) => x.type === "hour")?.value ?? 0);
  const m = +(p.find((x) => x.type === "minute")?.value ?? 0);
  return (h % 24) * 60 + m;
}

/** true ET calendar date of a bar (YYYY-MM-DD) — used to keep sessions apart */
function etDate(ts: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ts));
}

const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function LiveToday({ sym, win, ds, days, hist }: {
  sym: Sym;
  win: Win;
  ds: IbDataset;
  days: SlimDay[];
  hist: { dowStats: { name: string; sb: number | null; n: number }[]; avgIb: number; avgAtr: number };
}) {
  const REND = rangeEnd(win);          // 09:30 + window, in minutes-of-day
  const WLBL = winLabel(win);          // "IB 60m" / "ORB 15m" / …
  const es = useEsCandles(sym === "ES", 2);
  const nq = useNqCandles(sym === "NQ", 2);
  const candles = sym === "ES" ? es.candles : nq.candles;
  const connected = sym === "ES" ? es.connected : nq.connected;

  const live = useMemo(() => {
    if (!candles?.length) return null;
    // Bars arrive for ~2 sessions. Group by TRUE ET session date — filtering on
    // minute-of-day alone would blend yesterday's RTH into today's IB.
    const all = candles
      .map((c) => ({
        day: etDate(c.timestamp), min: etMin(c.timestamp),
        h: c.high, l: c.low, c: c.close, o: c.open, v: (c as { volume?: number }).volume ?? 0,
      }))
      .filter((b) => b.min >= 570 && b.min <= 960)
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.min - b.min));
    if (!all.length) return null;

    const today = all[all.length - 1].day;
    const bars = all.filter((b) => b.day === today);
    const priorBars = all.filter((b) => b.day < today);
    const pdh = priorBars.length ? Math.max(...priorBars.map((b) => b.h)) : null;
    const pdl = priorBars.length ? Math.min(...priorBars.map((b) => b.l)) : null;

    const ibBars = bars.filter((b) => b.min >= 570 && b.min < REND);
    const post = bars.filter((b) => b.min >= REND);
    const last = bars[bars.length - 1];
    const nowMin = last.min;
    const ibComplete = nowMin >= REND;

    if (!ibBars.length) return { pending: true, nowMin, price: last.c } as const;

    const ibh = Math.max(...ibBars.map((b) => b.h));
    const ibl = Math.min(...ibBars.map((b) => b.l));
    const width = ibh - ibl;
    const mid = (ibh + ibl) / 2;
    const ibClose = ibBars[ibBars.length - 1].c;

    // which extreme printed first
    let hiIdx = Infinity, loIdx = Infinity;
    ibBars.forEach((b, i) => {
      if (b.h === ibh) hiIdx = Math.min(hiIdx, i);
      if (b.l === ibl) loIdx = Math.min(loIdx, i);
    });
    const first: "H" | "L" = hiIdx < loIdx ? "H" : "L";
    const bias: "H" | "L" | null = ibClose > mid ? "H" : ibClose < mid ? "L" : null;
    const loc = width > 0 ? (ibClose - ibl) / width : 0.5;
    const closeZone = loc >= 0.75 ? "top 25%" : loc <= 0.25 ? "bottom 25%" : "middle 50%";

    const brokeH = post.some((b) => b.c > ibh);
    const brokeL = post.some((b) => b.c < ibl);
    const touchH = post.some((b) => b.h > ibh);
    const touchL = post.some((b) => b.l < ibl);

    let breakSide: "H" | "L" | null = null, breakMin: number | null = null;
    for (const b of post) {
      if (b.c > ibh) { breakSide = "H"; breakMin = b.min; break; }
      if (b.c < ibl) { breakSide = "L"; breakMin = b.min; break; }
    }

    const price = last.c;
    const dayHigh = Math.max(...bars.map((b) => b.h));
    const dayLow = Math.min(...bars.map((b) => b.l));

    const status =
      !ibComplete ? "IB still forming"
      : brokeH && brokeL ? "BOTH sides broken — rotation"
      : brokeH ? "Broken HIGH"
      : brokeL ? "Broken LOW"
      : touchH || touchL ? "Wicked out, no close outside"
      : "Inside IB";

    const bucket =
      hist.avgAtr && hist.avgIb
        ? width < 0.5 * hist.avgAtr || width < 0.75 * hist.avgIb ? "NARROW"
          : width > 1.5 * hist.avgAtr || width > 1.25 * hist.avgIb ? "WIDE"
          : "NORMAL"
        : "—";

    // extension targets from the broken level
    const lvl = breakSide === "H" ? ibh : breakSide === "L" ? ibl : null;
    const targets = lvl != null && breakSide
      ? [0.5, 1, 1.5, 2].map((t) => ({
          t, px: breakSide === "H" ? lvl + t * width : lvl - t * width,
          hit: breakSide === "H" ? dayHigh >= lvl + t * width : dayLow <= lvl - t * width,
        }))
      : [];

    // live inner-ORB — first close outside the 09:30–09:45 range, still inside the
    // opening range. Only meaningful when the window is longer than 15m.
    const orb = win > 15 ? ibBars.filter((b) => b.min < 585) : [];
    let orbDir: "H" | "L" | null = null;
    if (orb.length) {
      const orbH = Math.max(...orb.map((b) => b.h));
      const orbL = Math.min(...orb.map((b) => b.l));
      for (const b of ibBars.filter((x) => x.min >= 585)) {
        if (b.c > orbH) { orbDir = "H"; break; }
        if (b.c < orbL) { orbDir = "L"; break; }
      }
    }

    const zone: SlimDay["closeZone"] = loc >= 0.75 ? "top25" : loc <= 0.25 ? "bot25" : "mid50";

    /* ── rule 11 · open type — needs the prior RTH range ── */
    const dayOpen = bars[0].o;
    const openType: SlimDay["openType"] =
      pdh == null || pdl == null ? null
        : dayOpen > pdh ? "OAR-H"
          : dayOpen < pdl ? "OAR-L"
            : dayOpen > (pdh + pdl) / 2 ? "HIR"
              : "LIR";

    /* ── rule 7 · 15m FVG inside the IB — rebuild 15m bars from the IB bars ── */
    const b15: { h: number; l: number }[] = [];
    for (let s = 570; s < REND; s += 15) {
      const g = ibBars.filter((b) => b.min >= s && b.min < s + 15);
      if (g.length) b15.push({ h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)) });
    }
    let fvg: SlimDay["fvg"] = null;
    for (let i = 2; i < b15.length; i++) {
      if (b15[i].l > b15[i - 2].h) fvg = "bull";
      else if (b15[i].h < b15[i - 2].l) fvg = "bear";
    }

    /* ── rules 5/6/8 · things that only exist once a close-break has printed ── */
    const bIdx = breakMin != null ? post.findIndex((b) => b.min === breakMin) : -1;
    const brk = bIdx >= 0 ? post[bIdx] : null;
    const after = bIdx >= 0 ? post.slice(bIdx + 1) : [];
    const ibVol = avg(ibBars.map((b) => b.v)) ?? 0;
    const volSurge = brk && ibVol > 0 ? brk.v > ibVol : null;

    // rule 6 — closes back inside the IB within 30 min of the break
    const failed = brk
      ? after.filter((b) => b.min <= brk.min + 30)
          .some((b) => (breakSide === "H" ? b.c < ibh : b.c > ibl))
      : null;

    // rule 8 — comes back to within 2 ticks of the broken level, then closes back outside
    const tick = sym === "ES" ? 0.25 : 0.25;
    const lvlPx = breakSide === "H" ? ibh : breakSide === "L" ? ibl : null;
    const rtIdx = lvlPx != null && brk
      ? after.findIndex((b) => (breakSide === "H" ? b.l <= lvlPx + 2 * tick : b.h >= lvlPx - 2 * tick))
      : -1;
    const retest = rtIdx >= 0;
    const retestCont = retest && lvlPx != null
      ? after.slice(rtIdx + 1).some((b) => (breakSide === "H" ? b.c > lvlPx : b.c < lvlPx))
      : null;

    // rule 14 — still fully inside the IB at 14:00 ET
    const at2 = bars.filter((b) => b.min <= 840);
    const containedAt2 = nowMin >= 840
      ? !at2.some((b) => b.min >= REND && (b.c > ibh || b.c < ibl))
      : null;

    const extHit1 = targets.find((t) => t.t === 1)?.hit ?? false;

    return {
      pending: false as const, nowMin, price, ibh, ibl, mid, width, ibComplete,
      first, bias, closeZone, zone, orbDir, status, bucket, breakSide, breakMin, targets, dayHigh, dayLow,
      brokeH, brokeL, touchH, touchL, openType, fvg, volSurge, failed, retest, retestCont,
      containedAt2, extHit1, pdh, pdl, dayOpen,
    };
  }, [candles, hist, sym, win, REND]);

  const dowName = DOW_NAMES[new Date().getDay()];
  const dowRow = hist.dowStats.find((d) => d.name === dowName);

  if (!live) {
    return (
      <Card title={`Today — ${sym}`} subtitle={connected ? "Waiting for today's bars…" : "Candle feed disconnected"}>
        <div style={{ fontSize: 15, color: HOME_THEME.text }}>
          No RTH bars yet for the current session. This card fills in from 09:30 ET.
        </div>
      </Card>
    );
  }

  if (live.pending) {
    return (
      <Card title={`Today — ${sym} · ${dowName}`} subtitle={`Pre-range — ${WLBL} levels set at ${clock(REND)} ET`}>
        <div style={statGrid}>
          <Stat k="Live price" v={f2(live.price)} />
          <Stat k="Clock (ET)" v={clock(live.nowMin)} />
        </div>
      </Card>
    );
  }

  const distH = live.ibh - live.price;
  const distL = live.price - live.ibl;

  return (
    <>
      <LiveGauges live={live} days={days} dowName={dowName} win={win} />

      <RuleBoard live={live} days={days} dowName={dowName} win={win} />

      <Card
        accent="cyan"
        title={`Today — ${sym} · ${WLBL} · ${dowName}`}
        subtitle={`${live.ibComplete ? `${WLBL} complete` : `${WLBL} STILL FORMING — levels not final until ${clock(REND)} ET`} · ${clock(live.nowMin)} ET${connected ? "" : " · feed disconnected"}`}
      >
      <div style={statGrid}>
        <Stat k="Live price" v={f2(live.price)} sub={`day range ${f2(live.dayLow)} – ${f2(live.dayHigh)}`} />
        <Stat k={`${WLBL} High`} v={f2(live.ibh)} sub={distH > 0 ? `${f2(distH)} pts above price` : `broken — ${f2(-distH)} pts below price`} />
        <Stat k={`${WLBL} Low`} v={f2(live.ibl)} sub={distL > 0 ? `${f2(distL)} pts below price` : `broken — ${f2(-distL)} pts above price`} />
        <Stat k={`${WLBL} Mid`} v={f2(live.mid)} sub={live.price >= live.mid ? "price above mid" : "price below mid"} />
        <Stat k={`${WLBL} Width`} v={`${f2(live.width)} pts`} sub={`${live.bucket} · sample avg ${f2(hist.avgIb)}`} />
        <Stat k="Status" v={live.status} sub={live.breakMin != null ? `broke ${live.breakSide === "H" ? "high" : "low"} at ${clock(live.breakMin)}` : "no close outside yet"} />
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{["Today's read", "Value", "What the history says"].map((h, i) => <th key={h} style={i === 0 ? thL : th}>{h}</th>)}</tr></thead>
        <tbody>
          <tr>
            <td style={tdL}>Midpoint bias</td>
            <td style={td}>{live.bias === "H" ? "LONG (close > mid)" : live.bias === "L" ? "SHORT (close < mid)" : "flat"}</td>
            <td style={tdDim}>Expects the {live.bias === "H" ? "HIGH" : "LOW"} to break first — see Rule 1 for the hit rate</td>
          </tr>
          <tr>
            <td style={tdL}>Formation order</td>
            <td style={td}>{live.first === "H" ? "HIGH formed first" : "LOW formed first"}</td>
            <td style={tdDim}>
              {live.bias && ((live.first === "L" && live.bias === "H") || (live.first === "H" && live.bias === "L"))
                ? "CONFLUENT with the bias — the A+ filter (Rule 2)"
                : "DISCORDANT — order fights the bias (Rule 2 says skip)"}
            </td>
          </tr>
          <tr>
            <td style={tdL}>{WLBL} close location</td>
            <td style={td}>{live.closeZone} of the {WLBL}</td>
            <td style={tdDim}>Rule 10 — strong only when the zone agrees with the formation order</td>
          </tr>
          <tr>
            <td style={tdL}>Width bucket</td>
            <td style={td}>{live.bucket}</td>
            <td style={tdDim}>{live.bucket === "NARROW" ? "breakout/trend lean" : live.bucket === "WIDE" ? "rotation lean — fade the breaks" : "no width edge"}</td>
          </tr>
          <tr>
            <td style={tdL}>Day of week</td>
            <td style={td}>{dowName}</td>
            <td style={tdDim}>{dowRow && dowRow.sb != null ? `single-break rate on ${dowName}s: ${dowRow.sb.toFixed(1)}%` : "—"}</td>
          </tr>
        </tbody>
      </table>

      {live.targets.length > 0 && (
        <>
          <div style={{ height: 14 }} />
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Extension target", "Price", "Status"].map((h, i) => <th key={h} style={i === 0 ? thL : th}>{h}</th>)}</tr></thead>
            <tbody>
              {live.targets.map((t) => (
                <tr key={t.t}>
                  <td style={tdL}>{t.t}× {WLBL} width from the broken level</td>
                  <td style={td}>{f2(t.px)}</td>
                  <td style={{ ...td, color: t.hit ? HOME_THEME.green : HOME_THEME.text, fontWeight: 800 }}>{t.hit ? "REACHED" : "not yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div style={note}>
        Live levels are computed from the same {sym} candle feed the rest of the dashboard uses. The historical odds below describe the
        base rate, not a prediction for today.
      </div>
      </Card>
    </>
  );
}

/* ── LIVE GAUGES ──────────────────────────────────────────────────────────────
 * Direction bias gauge + expansion matrix + active rule + one overall
 * bullish/bearish verdict. Every number is scored live off the dataset against
 * today's actual conditions — nothing hardcoded.
 */

const MIN_N = 40;

/** Pick the tightest condition stack that still has a usable sample. */
function bestSample(days: SlimDay[], conds: ((d: SlimDay) => boolean)[], labels: string[]) {
  for (let i = conds.length; i > 0; i--) {
    const g = days.filter((d) => conds.slice(0, i).every((c) => c(d)));
    if (g.length >= MIN_N) return { g, label: labels.slice(0, i).join(" + ") };
  }
  return { g: days, label: "all sessions" };
}

function Gauge({ pHigh }: { pHigh: number }) {
  const ang = -90 + (pHigh / 100) * 180;
  const arc = 125;
  const hiSide = pHigh >= 50;
  return (
    <div style={{ position: "relative", width: 190, height: 108, margin: "0 auto" }}>
      <svg viewBox="0 0 100 50" style={{ width: "100%", height: "100%" }}>
        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="10" strokeLinecap="round" />
        <path d="M 10 50 A 40 40 0 0 1 50 10" fill="none" stroke={HOME_THEME.green} strokeWidth="10"
          strokeDasharray={arc} strokeDashoffset={arc - arc * (pHigh / 100)} style={{ transition: "stroke-dashoffset .6s" }} />
        <path d="M 50 10 A 40 40 0 0 1 90 50" fill="none" stroke={HOME_THEME.red} strokeWidth="10"
          strokeDasharray={arc} strokeDashoffset={arc - arc * ((100 - pHigh) / 100)} style={{ transition: "stroke-dashoffset .6s" }} />
        <line x1="50" y1="50" x2="50" y2="15" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"
          style={{ transformOrigin: "50px 50px", transform: `rotate(${ang}deg)`, transition: "transform .6s" }} />
        <circle cx="50" cy="50" r="4.5" fill="#fff" />
      </svg>
      <div style={{ position: "absolute", bottom: 0, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: HOME_THEME.text }}>
          {(hiSide ? pHigh : 100 - pHigh).toFixed(1)}%
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.04em", color: hiSide ? HOME_THEME.green : HOME_THEME.red }}>
          {Math.abs(pHigh - 50) < 2 ? "NO DIRECTIONAL EDGE" : hiSide ? "HIGH BREAK BIAS" : "LOW BREAK BIAS"}
        </div>
      </div>
    </div>
  );
}

function Bar({ label, p, color }: { label: string; p: number; color: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: HOME_THEME.text, marginBottom: 4 }}>
        <span>{label}</span><span style={{ fontWeight: 800, color }}>{p.toFixed(1)}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 6, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
        <div style={{ width: `${p}%`, height: "100%", background: color, transition: "width .6s" }} />
      </div>
    </div>
  );
}

function LiveGauges({ live, days, dowName, win }: { live: any; days: SlimDay[]; dowName: string; win: Win }) {
  const L = winLabel(win);
  const bias = live.bias as "H" | "L" | null;
  const first = live.first as "H" | "L";
  const bucketKey = String(live.bucket).toLowerCase() as SlimDay["widthBucket"];
  const orbDir = live.orbDir as "H" | "L" | null;
  const dowIdx = DOW_NAMES.indexOf(dowName);

  const g = useMemo(() => {
    const conds: ((d: SlimDay) => boolean)[] = [];
    const labels: string[] = [];
    if (bias) { conds.push((d) => d.bias === bias); labels.push(bias === "H" ? "close > mid" : "close < mid"); }
    conds.push((d) => d.first === first); labels.push(`${first === "H" ? "HIGH" : "LOW"} first`);
    if (bucketKey) { conds.push((d) => d.widthBucket === bucketKey); labels.push(`${String(live.bucket)} ${L}`); }
    if (orbDir) { conds.push((d) => d.orbDir === orbDir); labels.push(`inner ORB ${orbDir === "H" ? "up" : "down"}`); }
    return bestSample(days, conds, labels);
  }, [days, bias, first, bucketKey, orbDir, live.bucket, L]);

  const withTouch = g.g.filter((d) => d.firstTouchSide);
  const pHigh = withTouch.length ? (100 * withTouch.filter((d) => d.firstTouchSide === "H").length) / withTouch.length : 50;

  const dowDays = dowIdx >= 1 && dowIdx <= 5
    ? g.g.filter((d) => new Date(`${d.date}T12:00:00Z`).getUTCDay() === dowIdx)
    : [];
  const mx = dowDays.length >= MIN_N ? dowDays : g.g;
  const pSingle = (100 * mx.filter((d) => d.singleBreak).length) / (mx.length || 1);
  const pBoth = (100 * mx.filter((d) => d.bothBroke).length) / (mx.length || 1);
  const pNone = (100 * mx.filter((d) => d.neitherBroke).length) / (mx.length || 1);

  /* active rule — the tactical read that fits today's live state right now */
  const B = (d: SlimDay) => d.fcb!;
  const fcb = days.filter((d) => d.fcb);
  const rule = (() => {
    if (live.breakSide && !live.ibComplete) return null;
    if (live.brokeH && live.brokeL) {
      return { name: "BOTH SIDES BROKEN — rotation day", n: mx.length, p: pBoth, verdict: "fade" as const,
        note: `Rotation day — fade the extremes, don't chase` };
    }
    if (live.breakSide) {
      const side = live.breakSide as "H" | "L";
      const grp = fcb.filter((d) => B(d).side === side && d.widthBucket === bucketKey);
      const use = grp.length >= MIN_N ? grp : fcb.filter((d) => B(d).side === side);
      const cont = use.filter((d) => B(d).hit["1"]).length;
      const failP = (100 * use.filter((d) => B(d).failed).length) / (use.length || 1);
      const p = (100 * cont) / (use.length || 1);
      return failP > 50
        ? { name: `${side === "H" ? "HIGH" : "LOW"} break — fails more often than it runs`, n: use.length, p: 100 - failP, verdict: "fade" as const, note: `${failP.toFixed(1)}% of these breaks close back inside within 30m` }
        : { name: `${side === "H" ? "HIGH" : "LOW"} break confirmed → ≥1× ext`, n: use.length, p, verdict: p >= 55 ? ("tradeable" as const) : ("noise" as const), note: `fail rate ${failP.toFixed(1)}%` };
    }
    if (bias) {
      const use = g.g.filter((d) => d.firstTouchSide);
      const p = bias === "H" ? pHigh : 100 - pHigh;
      return { name: `Midpoint bias → ${bias === "H" ? "HIGH" : "LOW"} breaks first`, n: use.length, p,
        verdict: p >= 60 ? ("tradeable" as const) : p <= 45 ? ("fade" as const) : ("noise" as const), note: g.label };
    }
    return { name: `No bias — ${L} closed on the midpoint`, n: g.g.length, p: 50, verdict: "noise" as const, note: "wait for a break" };
  })();

  /* overall verdict — one signed number */
  const score = (() => {
    let s = (pHigh - 50) * 1.6;                                   // directional conditional
    if (live.brokeH && !live.brokeL) s += 22;
    if (live.brokeL && !live.brokeH) s -= 22;
    if (live.brokeH && live.brokeL) s *= 0.4;                     // rotation kills conviction
    if (live.price > live.mid) s += 6; else if (live.price < live.mid) s -= 6;
    if (bias === "H") s += 4; else if (bias === "L") s -= 4;
    if (!live.ibComplete) s *= 0.5;                               // IB not final
    return Math.max(-100, Math.min(100, s));
  })();
  const bull = score >= 0;
  const strength = Math.abs(score) >= 45 ? "STRONG" : Math.abs(score) >= 20 ? "LEAN" : "NEUTRAL";
  const sColor = strength === "NEUTRAL" ? HOME_THEME.orange : bull ? HOME_THEME.green : HOME_THEME.red;
  const vColor = rule?.verdict === "tradeable" ? HOME_THEME.green : rule?.verdict === "fade" ? HOME_THEME.red : HOME_THEME.orange;

  return (
    <Card accent="cyan" title={`Live Read — direction, expansion, active rule · ${L}`}
      subtitle={`${g.label}${live.ibComplete ? "" : ` · ${L} STILL FORMING`}`}>

      {/* overall verdict */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
        background: "rgba(255,255,255,0.03)", border: `1px solid ${sColor}`, borderRadius: 12, padding: "14px 18px", marginBottom: 14,
      }}>
        <div>
          <div style={{ fontSize: 15, color: HOME_THEME.text }}>Overall break bias</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: sColor, marginTop: 2 }}>
            {strength === "NEUTRAL" ? "NEUTRAL — no edge" : `${strength} ${bull ? "BULLISH" : "BEARISH"} BREAK`}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 34, fontWeight: 800, color: sColor }}>{score >= 0 ? "+" : ""}{score.toFixed(0)}</div>
          <div style={{ fontSize: 15, color: HOME_THEME.text }}>−100 bear … +100 bull</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
        {/* direction gauge */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: HOME_THEME.text, marginBottom: 6 }}>Breakout target bias</div>
          <Gauge pHigh={pHigh} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 15, color: HOME_THEME.text }}>
            <span>High first <b style={{ color: HOME_THEME.green }}>{pHigh.toFixed(1)}%</b></span>
            <span>Low first <b style={{ color: HOME_THEME.red }}>{(100 - pHigh).toFixed(1)}%</b></span>
          </div>
        </div>

        {/* expansion matrix */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: HOME_THEME.text, marginBottom: 10 }}>Expansion matrix</div>
          <Bar label="Single-side trend" p={pSingle} color={HOME_THEME.cyan} />
          <Bar label="Rotational chop (both)" p={pBoth} color={HOME_THEME.purple} />
          <Bar label="Contained range (none)" p={pNone} color={HOME_THEME.orange} />
          <div style={{ fontSize: 15, color: HOME_THEME.text, marginTop: 4 }}>
            {pBoth > 32 ? "Rotational risk HIGH — expect a two-sided day" : "One-sided break expected — opposite extreme protected"}
          </div>
        </div>

        {/* active rule */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${vColor}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: HOME_THEME.text, marginBottom: 10 }}>Active tactical rule</div>
          {rule ? (
            <>
              <div style={{ fontSize: 17, fontWeight: 800, color: vColor }}>
                {rule.verdict === "tradeable" ? "TRADEABLE EDGE" : rule.verdict === "fade" ? "FADE SETUP" : "NO EDGE"}
              </div>
              <div style={{ fontSize: 15, color: HOME_THEME.text, marginTop: 6 }}>{rule.name}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 10 }}>
                <span style={{ fontSize: 15, color: HOME_THEME.text }}>Edge rate</span>
                <span style={{ fontSize: 24, fontWeight: 800, color: vColor }}>{rule.p.toFixed(1)}%</span>
              </div>
              <div style={{ fontSize: 15, color: HOME_THEME.text, marginTop: 4 }}>{rule.note}</div>
            </>
          ) : (
            <div style={{ fontSize: 15, color: HOME_THEME.text }}>Waiting on the 10:30 ET close.</div>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ── PLAYBOOK ─────────────────────────────────────────────────────────────────
 * Today's live conditions, each turned into a historical conditional: of all
 * past sessions that looked like this one, how often did the rule pay?
 * Every % here is computed live off the dataset — nothing is hardcoded.
 */

type Setup = {
  label: string;      // the condition that is true right now
  question: string;   // what we're measuring on those matching days
  cond: (d: SlimDay) => boolean;
  outcome: (d: SlimDay) => boolean;
  side?: "H" | "L";
};

/* ── the 14 rules, evaluated against the live session ─────────────────────────
 * Each rule reports one of three live states:
 *   IN PLAY      — today's session satisfies the rule's trigger; % is the
 *                  conditional base rate on the sessions that matched it
 *   NOT IN PLAY  — the trigger is absent today (and we say which one)
 *   PENDING      — the trigger can't exist yet (needs the IB, or needs a break)
 * Before 10:30 ET every IB-derived read is provisional and flagged as such.
 */

type RuleState = "in-play" | "not-in-play" | "pending";

type LiveRule = {
  id: string;
  name: string;
  state: RuleState;
  read: string;                   // what today actually shows
  side: "H" | "L" | null;         // direction the rule points, if any
  question: string;               // what the % measures
  cond?: (d: SlimDay) => boolean;
  outcome?: (d: SlimDay) => boolean;
};

function buildRules(live: any, dowName: string, win: Win): LiveRule[] {
  const L = winLabel(win);              // "IB 60m" / "ORB 15m" — the range this board is reading
  const REND = rangeEnd(win);
  const bias = live.bias as "H" | "L" | null;
  const first = live.first as "H" | "L";
  const zone = live.zone as SlimDay["closeZone"];
  const bucket = live.bucket as string;
  const bk = bucket.toLowerCase() as SlimDay["widthBucket"];
  const orbDir = live.orbDir as "H" | "L" | null;
  const brk = live.breakSide as "H" | "L" | null;
  const openType = live.openType as SlimDay["openType"];
  const fvg = live.fvg as SlimDay["fvg"];
  const dowIdx = DOW_NAMES.indexOf(dowName);
  const W = (s: "H" | "L") => (s === "H" ? "HIGH" : "LOW");
  const zoneWord = zone === "top25" ? "TOP 25%" : zone === "bot25" ? "BOTTOM 25%" : "MIDDLE 50%";
  const confluent = !!bias && ((first === "L" && bias === "H") || (first === "H" && bias === "L"));
  // The side today's IB leans toward. PENDING rules are still scored — they show
  // the conditional rate for the break that HASN'T printed yet, i.e. "if it fires,
  // here's what it did historically on sessions that looked like this one."
  const exp: "H" | "L" = bias ?? first;
  const noBreak = "no close-confirmed break yet — odds below are for IF it fires";

  const R: LiveRule[] = [];

  /* 1 · Midpoint Close Bias */
  R.push(bias ? {
    id: "1", name: "Midpoint Close Bias", state: "in-play",
    read: `${L} closed ${bias === "H" ? "ABOVE" : "BELOW"} mid → lean ${bias === "H" ? "LONG" : "SHORT"}`,
    side: bias, question: `${W(bias)} breaks first`,
    cond: (d) => d.bias === bias, outcome: (d) => d.firstTouchSide === bias,
  } : {
    id: "1", name: "Midpoint Close Bias", state: "not-in-play",
    read: `${L} closed exactly ON the midpoint — no bias`, side: null, question: "—",
  });

  /* 2 · Formation Order + Midpoint */
  R.push(bias && confluent ? {
    id: "2", name: "Formation Order + Midpoint", state: "in-play",
    read: `${W(first)} formed first + close ${bias === "H" ? "above" : "below"} mid — CONFLUENT (the A+ filter)`,
    side: bias, question: `${W(bias)} breaks first`,
    cond: (d) => d.bias === bias && d.first === first,
    outcome: (d) => d.firstTouchSide === bias,
  } : {
    id: "2", name: "Formation Order + Midpoint", state: "not-in-play",
    read: bias
      ? `${W(first)} formed first + close ${bias === "H" ? "above" : "below"} mid — DISCORDANT, the rule says skip`
      : "no midpoint bias to align with",
    side: null, question: "—",
  });

  /* 3 · Single Break Continuation */
  R.push(brk ? {
    id: "3", name: "Single Break Continuation", state: "in-play",
    read: `Broke the ${W(brk)} — does the other side stay untouched?`,
    side: brk, question: `${brk === "H" ? "LOW" : "HIGH"} never breaks (stays a single-break day)`,
    cond: (d) => !!d.fcb && d.fcb.side === brk,
    outcome: (d) => (d.fcb!.side === "H" ? !d.touchedL : !d.touchedH),
  } : {
    id: "3", name: "Single Break Continuation", state: "pending",
    read: `${noBreak} — projected side: ${W(exp)}`,
    side: exp, question: `IF the ${W(exp)} breaks, the ${exp === "H" ? "LOW" : "HIGH"} never does`,
    cond: (d) => !!d.fcb && d.fcb.side === exp,
    outcome: (d) => (exp === "H" ? !d.touchedL : !d.touchedH),
  });

  /* 4 · Range Width → Day Type */
  R.push(bk === "narrow" || bk === "normal" || bk === "wide" ? {
    id: "4", name: `${L} Width → Day Type`, state: "in-play",
    read: `${bucket} ${L} (${f2(live.width)} pts) → ${bk === "narrow" ? "trend / breakout lean" : bk === "wide" ? "rotation lean — fade the breaks" : "no width edge"}`,
    side: null, question: bk === "wide" ? "BOTH sides break (rotation)" : "only ONE side breaks",
    cond: (d) => d.widthBucket === bk,
    outcome: (d) => (bk === "wide" ? d.bothBroke : d.singleBreak),
  } : {
    id: "4", name: `${L} Width → Day Type`, state: "not-in-play",
    read: "width bucket unavailable — ATR14 / 20d avg range not yet established", side: null, question: "—",
  });

  /* 5 · Breakout Entry + volume */
  R.push(brk && live.volSurge != null ? {
    id: "5", name: "Breakout Entry — close + volume", state: "in-play",
    read: live.volSurge
      ? `${W(brk)} break came WITH a volume surge (break bar > avg ${L} bar)`
      : `${W(brk)} break came with NO volume surge — the weaker version`,
    side: brk, question: `the break runs ≥ 1× ${L} width`,
    cond: (d) => !!d.fcb && d.fcb.volSurge === live.volSurge,
    outcome: (d) => !!d.fcb!.hit["1"],
  } : {
    id: "5", name: "Breakout Entry — close + volume", state: "pending",
    read: brk
      ? "break printed but bar volume is unavailable on the live feed — showing the all-breaks rate"
      : `${noBreak} — projected side: ${W(exp)}`,
    side: exp, question: `IF a ${W(exp)} break prints WITH a volume surge, it runs ≥ 1× ${L} width`,
    cond: (d) => !!d.fcb && d.fcb.side === exp && d.fcb.volSurge,
    outcome: (d) => !!d.fcb!.hit["1"],
  });

  /* 6 · Failed Breakout Fade */
  R.push(brk ? {
    id: "6", name: "Failed Breakout Fade", state: "in-play",
    read: live.failed
      ? `The ${W(brk)} break ALREADY FAILED — closed back inside. Fade target: mid, then the opposite extreme`
      : `${W(brk)} break is holding — this is the trap risk, not yet triggered`,
    side: brk === "H" ? "L" : "H",
    question: live.failed ? `the fade reaches the OPPOSITE ${L} extreme` : "this break fails and closes back inside ≤30m",
    cond: (d) => !!d.fcb && d.fcb.side === brk && (live.failed ? d.fcb.failed : true),
    outcome: (d) => (live.failed ? d.fcb!.fadeOpp : d.fcb!.failed),
  } : {
    id: "6", name: "Failed Breakout Fade", state: "pending",
    read: `${noBreak} — this is the trap rate to expect`,
    side: exp === "H" ? "L" : "H",
    question: `IF a ${W(exp)} break prints, it FAILS back inside within 30m`,
    cond: (d) => !!d.fcb && d.fcb.side === exp,
    outcome: (d) => d.fcb!.failed,
  });

  /* 7 · 15m FVG inside the range — impossible once the window is ≤15m (nothing to nest) */
  R.push(fvg ? {
    id: "7", name: `15m FVG inside the ${L}`, state: "in-play",
    read: `${fvg === "bull" ? "BULLISH" : "BEARISH"} 15m fair-value gap inside the ${L}`,
    side: fvg === "bull" ? "H" : "L",
    question: `the ${fvg === "bull" ? "HIGH" : "LOW"} is the side that gets touched first`,
    cond: (d) => d.fvg === fvg,
    outcome: (d) => d.firstTouchSide === (fvg === "bull" ? "H" : "L"),
  } : {
    id: "7", name: `15m FVG inside the ${L}`, state: "not-in-play",
    read: win <= 15
      ? `window is only ${win}m — a 15m FVG cannot form inside it. Use the 30m or 60m tab for this rule.`
      : `no 15m FVG formed inside today's ${L}`,
    side: null, question: "—",
  });

  /* 8 · Retest Continuation */
  R.push(brk && live.retest ? {
    id: "8", name: "Retest Continuation", state: "in-play",
    read: `Price came back to the broken ${W(brk)} and ${live.retestCont ? "held — continuation is live" : "is still deciding"}`,
    side: brk, question: "it continues to a new extreme after the retest",
    cond: (d) => !!d.fcb?.retest && d.fcb.retestCont != null,
    outcome: (d) => !!d.fcb!.retestCont,
  } : {
    id: "8", name: "Retest Continuation", state: "pending",
    read: brk
      ? `no retest of the broken ${W(brk)} yet — odds below are for IF it comes back`
      : `${noBreak} — projected side: ${W(exp)}`,
    side: brk ?? exp,
    question: `IF the broken ${W(brk ?? exp)} is retested, it continues to a new extreme`,
    cond: (d) => !!d.fcb && d.fcb.side === (brk ?? exp) && d.fcb.retest && d.fcb.retestCont != null,
    outcome: (d) => !!d.fcb!.retestCont,
  });

  /* 9 · Extension Targets */
  R.push(brk ? {
    id: "9", name: "Extension Targets", state: "in-play",
    read: `Measuring from the broken ${W(brk)} — ${live.targets.filter((t: any) => t.hit).length}/${live.targets.length} targets reached`,
    side: brk, question: `the move reaches ≥ 1× ${L} width`,
    cond: (d) => !!d.fcb && d.fcb.side === brk,
    outcome: (d) => !!d.fcb!.hit["1"],
  } : {
    id: "9", name: "Extension Targets", state: "pending",
    read: `${noBreak} — targets would measure from the ${L} ${W(exp)} (${f2(exp === "H" ? live.ibh : live.ibl)})`,
    side: exp, question: `IF a ${W(exp)} break prints, it reaches ≥ 1× ${L} width`,
    cond: (d) => !!d.fcb && d.fcb.side === exp,
    outcome: (d) => !!d.fcb!.hit["1"],
  });

  /* 10 · Close Location in the range */
  const strongZone = (zone === "top25" && first === "L") || (zone === "bot25" && first === "H");
  R.push(strongZone && bias ? {
    id: "10", name: `Close Location in the ${L} Range`, state: "in-play",
    read: `Close in the ${zoneWord} + ${W(first)} formed first — the strong ${zone === "top25" ? "LONG" : "SHORT"} version`,
    side: zone === "top25" ? "H" : "L",
    question: `${zone === "top25" ? "HIGH" : "LOW"} breaks first`,
    cond: (d) => d.closeZone === zone && d.first === first,
    outcome: (d) => d.firstTouchSide === (zone === "top25" ? "H" : "L"),
  } : {
    id: "10", name: `Close Location in the ${L} Range`, state: "not-in-play",
    read: zone === "mid50"
      ? `${L} closed in the MIDDLE 50% — no close-location edge`
      : `Close in the ${zoneWord} but ${W(first)} formed first — zone and formation order disagree`,
    side: null, question: "—",
  });

  /* 11 · Open Type + range width */
  R.push(openType && bk ? {
    id: "11", name: `Open Type + ${L} Width`, state: "in-play",
    read: `${openType} open (${openType.startsWith("OAR") ? "outside" : "inside"} the prior RTH range) + ${bucket} ${L}`,
    side: null, question: "only ONE side breaks",
    cond: (d) => d.openType === openType && d.widthBucket === bk,
    outcome: (d) => d.singleBreak,
  } : {
    id: "11", name: `Open Type + ${L} Width`, state: "not-in-play",
    read: "prior-session RTH range unavailable on the live feed — open type can't be classified",
    side: null, question: "—",
  });

  /* 12 · inner 09:30–09:45 ORB vs the range's midpoint bias — needs a window > 15m */
  R.push(orbDir && bias ? {
    id: "12", name: `Inner 15m ORB + ${L} Alignment`, state: "in-play",
    read: orbDir === bias
      ? `Inner 15m ORB broke ${W(orbDir)} — ALIGNED with the midpoint bias`
      : `Inner 15m ORB broke ${W(orbDir)} — CONFLICTS with the midpoint bias`,
    side: bias, question: `${W(bias)} breaks first`,
    cond: (d) => d.bias === bias && d.orbDir === orbDir,
    outcome: (d) => d.firstTouchSide === bias,
  } : {
    id: "12", name: `Inner 15m ORB + ${L} Alignment`, state: "not-in-play",
    read: win <= 15
      ? `window is only ${win}m — there is no inner ORB to nest inside it. Use the 30m or 60m tab for this rule.`
      : !orbDir ? `the 09:30–09:45 opening range never broke inside the ${L}` : "no midpoint bias to align with",
    side: null, question: "—",
  });

  /* 13 · Time Filter */
  const bm = live.breakMin as number | null;
  R.push(bm != null ? {
    id: "13", name: "Time Filter — when the break happens", state: "in-play",
    read: `Break printed at ${clock(bm)} ET — ${bm <= REND + 30 ? `early (first 30m out of the ${L})` : bm <= 780 ? "midday" : "late"}`,
    side: brk, question: `the break runs ≥ 1× ${L} width given that timing`,
    cond: (d) => !!d.fcb && (bm <= 660 ? d.fcb.breakMin <= 660 : bm <= 780 ? d.fcb.breakMin > 660 && d.fcb.breakMin <= 780 : d.fcb.breakMin > 780),
    outcome: (d) => !!d.fcb!.hit["1"],
  } : {
    id: "13", name: "Time Filter — when the break happens", state: "pending",
    read: `${noBreak} — it's ${clock(live.nowMin)} ET, so a break now counts as ${live.nowMin <= 660 ? "EARLY" : live.nowMin <= 780 ? "MIDDAY" : "LATE"}`,
    side: exp,
    question: `IF the break prints in this window, it runs ≥ 1× ${L} width`,
    cond: (d) => !!d.fcb && (live.nowMin <= 660
      ? d.fcb.breakMin <= 660
      : live.nowMin <= 780
        ? d.fcb.breakMin > 660 && d.fcb.breakMin <= 780
        : d.fcb.breakMin > 780),
    outcome: (d) => !!d.fcb!.hit["1"],
  });

  /* 14 · Contained Day */
  R.push(live.containedAt2 === true ? {
    id: "14", name: "Contained Day (rare)", state: "in-play",
    read: `Price is STILL fully inside the ${L} at 14:00 ET — the rare contained day`,
    side: null, question: "it stays contained into the close (never breaks late)",
    cond: (d) => d.containedAt2,
    outcome: (d) => !d.containedBrokeLate,
  } : live.nowMin < 840 && !live.brokeH && !live.brokeL ? {
    id: "14", name: "Contained Day (rare)", state: "pending",
    read: `Still inside the ${L} at ${clock(live.nowMin)} ET — not confirmed until 14:00`,
    side: null, question: "IF price is still contained at 14:00, it never breaks late",
    cond: (d) => d.containedAt2,
    outcome: (d) => !d.containedBrokeLate,
  } : {
    id: "14", name: "Contained Day (rare)", state: "not-in-play",
    read: `price already broke the ${L} — not a contained day`, side: null, question: "—",
  });

  /* 0c · day-of-week, kept as a live read alongside the rules */
  if (dowIdx >= 1 && dowIdx <= 5) {
    R.push({
      id: "0c", name: `Day of week — ${dowName}`, state: "in-play",
      read: `It's ${dowName}`, side: null, question: "only ONE side breaks",
      cond: (d) => new Date(`${d.date}T12:00:00Z`).getUTCDay() === dowIdx,
      outcome: (d) => d.singleBreak,
    });
  }

  return R;
}

function RuleBoard({ live, days, dowName, win }: { live: any; days: SlimDay[]; dowName: string; win: Win }) {
  const L = winLabel(win);
  const REND = rangeEnd(win);
  const rules = buildRules(live, dowName, win);
  const provisional = !live.ibComplete;

  // Score EVERY rule that has a condition — including PENDING ones. A pending
  // rule's % is the "if it fires" rate: the trigger hasn't happened yet, but the
  // odds for when it does are exactly what you want on screen beforehand.
  const scored = rules.map((r) => {
    if (!r.cond || !r.outcome) return { ...r, n: 0, hits: 0, p: null as number | null };
    const g = days.filter(r.cond);
    const hits = g.filter(r.outcome).length;
    return { ...r, n: g.length, hits, p: g.length ? (100 * hits) / g.length : null };
  });

  const inPlay = scored.filter((r) => r.state === "in-play");
  const pending = scored.filter((r) => r.state === "pending");
  const off = scored.filter((r) => r.state === "not-in-play");

  const stateChip = (s: RuleState) => {
    const [txt, col] =
      s === "in-play" ? ["IN PLAY", HOME_THEME.green]
        : s === "pending" ? ["PENDING", HOME_THEME.orange]
          : ["NOT IN PLAY", HOME_THEME.red];
    return (
      <span style={{
        fontSize: 15, fontWeight: 800, color: col, border: `1px solid ${col}`,
        borderRadius: 6, padding: "1px 8px", whiteSpace: "nowrap",
      }}>{txt}</span>
    );
  };

  const sideChip = (s: "H" | "L" | null) => {
    if (!s) return <span style={{ color: HOME_THEME.text }}>—</span>;
    const col = s === "H" ? HOME_THEME.green : HOME_THEME.red;
    return <span style={{ color: col, fontWeight: 800 }}>{s === "H" ? "HIGH ↑" : "LOW ↓"}</span>;
  };

  // 4-column section header — sample counts are owner-only, so this board has no Sample column
  const secRow = (text: string) => (
    <tr><td colSpan={4} style={{ ...tdL, color: LIGHT_BLUE, fontWeight: 800, fontSize: 15, paddingTop: 14 }}>{text}</td></tr>
  );

  return (
    <Card
      accent="green"
      title={`In Play Right Now — all 14 rules against today's ${L} (${winRange(win)} ET)`}
      subtitle={provisional
        ? `${L} STILL FORMING — every read below is CONDITIONAL: this is what the rules would say if the range closed where it stands right now. They can still flip before ${clock(REND)} ET.`
        : `${L} FORMED — each rule scored against every past session that matched today's condition`}
    >
      {/* the levels every rule below is measured against */}
      <div style={statGrid}>
        <Stat k="Live price" v={f2(live.price)} sub={`day range ${f2(live.dayLow)} – ${f2(live.dayHigh)}`} />
        <Stat k={`${L} High`} v={f2(live.ibh)} sub={live.price < live.ibh ? `${f2(live.ibh - live.price)} pts above price` : `broken — ${f2(live.price - live.ibh)} pts below price`} />
        <Stat k={`${L} Low`} v={f2(live.ibl)} sub={live.price > live.ibl ? `${f2(live.price - live.ibl)} pts below price` : `broken — ${f2(live.ibl - live.price)} pts above price`} />
        <Stat k={`${L} Mid`} v={f2(live.mid)} sub={live.price >= live.mid ? "price above mid" : "price below mid"} />
        <Stat k={`${L} Width`} v={`${f2(live.width)} pts`} sub={String(live.bucket)} />
        <Stat
          k={L}
          v={provisional ? "FORMING" : "FORMED"}
          sub={provisional ? `not final until ${clock(REND)} ET · now ${clock(live.nowMin)}` : `locked at ${clock(REND)} ET · now ${clock(live.nowMin)}`}
        />
        <Stat k="Status" v={String(live.status)} sub={live.breakMin != null ? `broke ${live.breakSide === "H" ? "high" : "low"} at ${clock(live.breakMin)} ET` : "no close outside yet"} />
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Rule", "Live read", "Points to", "Hit rate"].map((h, i) => (
              <th key={h} style={i === 0 ? thL : i === 1 ? thL : th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {secRow(provisional ? `IN PLAY (conditional — if the IB formed now) · ${inPlay.length}` : `IN PLAY · ${inPlay.length}`)}
          {inPlay.map((r) => (
            <tr key={r.id}>
              <td style={{ ...tdL, fontWeight: 800 }}>{r.id} · {r.name}</td>
              <td style={tdL}>
                <div>{r.read}</div>
                <div style={{ color: HOME_THEME.text, opacity: 0.85 }}>chance {r.question}</div>
              </td>
              <td style={td}>{sideChip(r.side)}</td>
              <td style={{ ...td, color: rateColor(r.p), fontWeight: 800, fontSize: 18 }}>
                {r.p == null ? "—" : `${r.p.toFixed(1)}%`}
              </td>
            </tr>
          ))}

          {secRow(`PENDING — not triggered yet, here are the odds IF it fires · ${pending.length}`)}
          {pending.map((r) => (
            <tr key={r.id}>
              <td style={{ ...tdL, fontWeight: 800 }}>{r.id} · {r.name}</td>
              <td style={tdL}>
                <div>{r.read}</div>
                <div style={{ color: HOME_THEME.text, opacity: 0.85 }}>chance {r.question}</div>
              </td>
              <td style={td}>{sideChip(r.side)}</td>
              <td style={{ ...td, color: rateColor(r.p), fontWeight: 800, fontSize: 18 }}>
                {r.p == null ? "—" : `${r.p.toFixed(1)}%`}
              </td>
            </tr>
          ))}

          {secRow(`NOT IN PLAY · ${off.length}`)}
          {off.map((r) => (
            <tr key={r.id}>
              <td style={{ ...tdL, fontWeight: 800, opacity: 0.75 }}>{r.id} · {r.name}</td>
              <td style={{ ...tdL, opacity: 0.75 }}>{r.read}</td>
              <td style={td}>{stateChip(r.state)}</td>
              <td style={td}>—</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={note}>
        Every % is a conditional base rate, not a prediction — &ldquo;on the past sessions that looked like this one, how often did it
        happen?&rdquo; PENDING rules haven&rsquo;t triggered yet (they need a break to print or the 14:00 bell) — their % is the
        <b> if it fires</b> rate, conditioned on today&rsquo;s IB and the side it leans toward. NOT IN PLAY means the trigger is
        genuinely absent today, so there is nothing to score.
      </div>
    </Card>
  );
}

/* eslint-disable @typescript-eslint/no-unused-vars */
/** @deprecated superseded by RuleBoard — kept only for reference, not rendered. */
function PlaybookLegacy({ live, days, dowName }: { live: any; days: SlimDay[]; dowName: string }) {
  const bias = live.bias as "H" | "L" | null;
  const first = live.first as "H" | "L";
  const zone = live.zone as SlimDay["closeZone"];
  const bucket = live.bucket as string;
  const orbDir = live.orbDir as "H" | "L" | null;
  const dowIdx = DOW_NAMES.indexOf(dowName);
  const bucketKey = bucket.toLowerCase() as SlimDay["widthBucket"];
  const dirWord = (s: "H" | "L") => (s === "H" ? "HIGH" : "LOW");

  const setups: Setup[] = [];

  if (bias) {
    setups.push({
      label: `IB closed ${bias === "H" ? "ABOVE" : "BELOW"} the midpoint`,
      question: `${dirWord(bias)} breaks first`,
      cond: (d) => d.bias === bias,
      outcome: (d) => d.firstTouchSide === bias,
      side: bias,
    });
    setups.push({
      label: `Midpoint bias = ${bias === "H" ? "LONG" : "SHORT"}`,
      question: `IB ${dirWord(bias)} breaks at all today`,
      cond: (d) => d.bias === bias,
      outcome: (d) => (bias === "H" ? d.touchedH : d.touchedL),
      side: bias,
    });
    setups.push({
      label: `${dirWord(first)} formed first + close ${bias === "H" ? "above" : "below"} mid`,
      question: `${dirWord(bias)} breaks first`,
      cond: (d) => d.bias === bias && d.first === first,
      outcome: (d) => d.firstTouchSide === bias,
      side: bias,
    });
    setups.push({
      label: `IB close in the ${zone === "top25" ? "TOP 25%" : zone === "bot25" ? "BOTTOM 25%" : "MIDDLE 50%"} + ${dirWord(first)} first`,
      question: `${dirWord(bias)} breaks first`,
      cond: (d) => d.closeZone === zone && d.first === first,
      outcome: (d) => d.firstTouchSide === bias,
      side: bias,
    });
  }

  if (bucketKey === "narrow" || bucketKey === "wide" || bucketKey === "normal") {
    setups.push({
      label: `${bucket} IB width`,
      question: "only ONE side breaks (single-break day)",
      cond: (d) => d.widthBucket === bucketKey,
      outcome: (d) => d.singleBreak,
    });
    setups.push({
      label: `${bucket} IB width`,
      question: "BOTH sides break (rotation — fade the break)",
      cond: (d) => d.widthBucket === bucketKey,
      outcome: (d) => d.bothBroke,
    });
    setups.push({
      label: `${bucket} IB width`,
      question: "the break runs ≥ 1× IB width",
      cond: (d) => d.widthBucket === bucketKey && !!d.fcb,
      outcome: (d) => !!d.fcb?.hit["1"],
    });
  }

  if (orbDir && bias) {
    setups.push({
      label: orbDir === bias
        ? `ORB broke ${dirWord(orbDir)} — ALIGNED with the IB bias`
        : `ORB broke ${dirWord(orbDir)} — CONFLICTS with the IB bias`,
      question: `${dirWord(bias)} breaks first`,
      cond: (d) => d.bias === bias && d.orbDir === orbDir,
      outcome: (d) => d.firstTouchSide === bias,
      side: bias,
    });
  }

  if (dowIdx >= 1 && dowIdx <= 5) {
    setups.push({
      label: `It's ${dowName}`,
      question: "only ONE side breaks",
      cond: (d) => new Date(`${d.date}T12:00:00Z`).getUTCDay() === dowIdx,
      outcome: (d) => d.singleBreak,
    });
  }

  // the full stack — every live condition at once
  if (bias && bucketKey) {
    setups.push({
      label: `ALL OF IT: ${dirWord(first)} first + ${bias === "H" ? "above" : "below"} mid + ${bucket} IB`,
      question: `${dirWord(bias)} breaks first`,
      cond: (d) => d.bias === bias && d.first === first && d.widthBucket === bucketKey,
      outcome: (d) => d.firstTouchSide === bias,
      side: bias,
    });
    setups.push({
      label: `ALL OF IT: ${dirWord(first)} first + ${bias === "H" ? "above" : "below"} mid + ${bucket} IB`,
      question: "the break fails and closes back inside within 30m",
      cond: (d) => d.bias === bias && d.first === first && d.widthBucket === bucketKey && !!d.fcb,
      outcome: (d) => !!d.fcb?.failed,
    });
  }

  const scored = setups
    .map((s) => {
      const g = days.filter(s.cond);
      const hits = g.filter(s.outcome).length;
      return { ...s, n: g.length, hits, p: g.length ? (100 * hits) / g.length : null };
    })
    .filter((s) => s.n >= 15)
    .sort((a, b) => (b.p ?? 0) - (a.p ?? 0));

  return (
    <Card
      accent="green"
      title="In Play Right Now — what today's IB is setting up"
      subtitle={live.ibComplete
        ? "Every % below is today's live condition, scored against every past session that looked the same"
        : "IB STILL FORMING — these conditions can still flip before 10:30 ET"}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
        {scored.map((s, i) => (
          <div key={i} style={{
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${s.p != null && s.p >= 60 ? HOME_THEME.green : s.p != null && s.p <= 40 ? HOME_THEME.red : "rgba(255,255,255,0.08)"}`,
            borderRadius: 12, padding: 14,
          }}>
            <div style={{ fontSize: 15, color: HOME_THEME.text, fontWeight: 700 }}>{s.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "8px 0 4px" }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: rateColor(s.p) }}>
                {s.p == null ? "—" : `${s.p.toFixed(0)}%`}
              </span>
              <span style={{ fontSize: 15, color: HOME_THEME.text }}>chance {s.question}</span>
            </div>
            {s.n < 40 && (
              <div style={{ fontSize: 15, color: HOME_THEME.text }}>thin sample</div>
            )}
          </div>
        ))}
      </div>
      <div style={note}>
        These are conditional base rates, not predictions — each card asks &ldquo;on the days that looked exactly like today, how often
        did this happen?&rdquo; Cards with fewer than 40 matching sessions are flagged thin; the tighter the condition stack, the smaller
        the sample, so the &ldquo;ALL OF IT&rdquo; cards are the most specific and the least reliable at once.
      </div>
    </Card>
  );
}

/* ── component ────────────────────────────────────────────────────────────── */

/** Backfill atr / avgIB / widthBucket for datasets exported without them.
 *  Trailing windows only (no lookahead): day i uses the 14/20 sessions BEFORE it. */
function deriveWidthBuckets(src: SlimDay[]): SlimDay[] {
  if (src.some((d) => d.widthBucket)) return src;   // already populated — leave alone
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  return src.map((d, i) => {
    const atr = d.atr ?? mean(src.slice(Math.max(0, i - 14), i).map((x) => x.dayRange));
    const avgIB = d.avgIB ?? mean(src.slice(Math.max(0, i - 20), i).map((x) => x.width));
    if (atr == null || avgIB == null || i < 14) return { ...d, atr, avgIB };
    const widthBucket: SlimDay["widthBucket"] =
      d.width < 0.5 * atr || d.width < 0.75 * avgIB ? "narrow"
        : d.width > 1.5 * atr || d.width > 1.25 * avgIB ? "wide"
          : "normal";
    return { ...d, atr, avgIB, widthBucket };
  });
}

export default function IbStatsTab() {
  const { userId, isOwnerClaim } = useAuth();
  // Cosmetic owner gate — the historical stat tables are owner-only. Same
  // pattern as /traders-dashboard: prefer the session's owner claim, fall back
  // to the public owner id for the pre-claim path.
  const isOwner = isOwnerClaim || (
    process.env.NEXT_PUBLIC_OWNER_USER_ID ? userId === process.env.NEXT_PUBLIC_OWNER_USER_ID : false
  );

  const [sym, setSym] = useState<Sym>("ES");
  const [win, setWin] = useState<Win>(60);
  const [showStats, setShowStats] = useState(false);
  // cache key is symbol + window — each combination is its own exported file
  const [sets, setSets] = useState<Record<string, IbDataset>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const key = `${sym}-${win}`;

  useEffect(() => {
    if (sets[key] || errs[key]) return;
    let alive = true;
    const path = dsPath(sym, win);
    fetch(path)
      .then((r) => {
        if (!r.ok) throw new Error(`${sym} ${winLabel(win)}: ${r.status} — is public${path} in the repo? Export it from ib-backtest-esu6.html with the ${win}m window selected.`);
        return r.json();
      })
      .then((j: IbDataset) => { if (alive) setSets((s) => ({ ...s, [key]: j })); })
      .catch((e) => { if (alive) setErrs((s) => ({ ...s, [key]: String(e.message || e) })); });
    return () => { alive = false; };
  }, [sym, win, key, sets, errs]);

  const ds = sets[key];
  const err = errs[key];

  const btn = (on: boolean): React.CSSProperties => ({
    padding: "8px 18px", borderRadius: 8, fontSize: 15, fontWeight: 800, cursor: "pointer",
    border: `1px solid ${on ? HOME_THEME.cyan : "rgba(255,255,255,0.15)"}`,
    background: on ? "rgba(33,158,188,0.15)" : "transparent",
    color: HOME_THEME.text, transition: "all 0.15s",
  });

  const symTabs = (
    <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
      {SYMBOLS.map((s) => (
        <button key={s} onClick={() => setSym(s)} style={{ ...btn(sym === s), padding: "8px 22px" }}>{s}</button>
      ))}
      <div style={{ width: 1, height: 26, background: "rgba(255,255,255,0.15)", margin: "0 6px" }} />
      {WINDOWS.map((w) => (
        <button key={w.min} onClick={() => setWin(w.min)} style={btn(win === w.min)} title={`${w.range} ET`}>
          {w.label}
        </button>
      ))}
      <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.7 }}>{winRange(win)} ET</span>
    </div>
  );

  if (err) return <div>{symTabs}<Card title={`${winLabel(win)} Stats — dataset not found`}><div style={{ color: HOME_THEME.red, fontSize: 15 }}>{err}</div></Card></div>;
  if (!ds) return <div>{symTabs}<Card title={`${winLabel(win)} Stats`}><div style={{ color: HOME_THEME.text, fontSize: 15 }}>Loading {sym} {winLabel(win)} dataset…</div></Card></div>;

  /* The exporter wrote atr / avgIB / widthBucket as null for every session, so the
   * width-bucket tables came up empty. Derive them here from the raw sessions:
   *   atr    = trailing 14d mean of RTH day range
   *   avgIB  = trailing 20d mean of IB width
   *   bucket = narrow/normal/wide per the 0.5×ATR|0.75×avgIB / 1.5×ATR|1.25×avgIB rule
   * Days already stored with real values are left untouched. */
  const days = deriveWidthBuckets(ds.days);
  const N = days.length;
  const widths = days.map((d) => d.width);
  const yearsSpan = (new Date(ds.to).getTime() - new Date(ds.from).getTime()) / (365.25 * 864e5);

  const fcb = days.filter((d) => d.fcb);
  const B = (d: SlimDay) => d.fcb!;

  /* 0b — timing */
  const touchMins = days.filter((d) => d.firstTouchMin != null).map((d) => d.firstTouchMin!);
  const closeMins = fcb.map((d) => B(d).breakMin);
  const cbH = fcb.filter((d) => B(d).side === "H").map((d) => B(d).breakMin);
  const cbL = fcb.filter((d) => B(d).side === "L").map((d) => B(d).breakMin);
  const REND = rangeEnd(win);
  const timeBuckets: [number, string][] = ([
    [REND, `by ${clock(REND)} (first bar out)`], [REND + 15, `by ${clock(REND + 15)}`], [REND + 30, `by ${clock(REND + 30)}`],
    [660, "by 11:00"], [720, "by 12:00 (noon)"], [780, "by 13:00"], [840, "by 14:00"], [900, "by 15:00"],
  ] as [number, string][]).filter(([m], i, a) => m >= REND && a.findIndex(([x]) => x === m) === i);

  /* rules */
  const wb = days.filter((d) => d.bias);
  const wbL = wb.filter((d) => d.bias === "H");
  const wbS = wb.filter((d) => d.bias === "L");
  const conf = days.filter((d) => d.bias && ((d.first === "L" && d.bias === "H") || (d.first === "H" && d.bias === "L")));
  const confL = conf.filter((d) => d.bias === "H");
  const confS = conf.filter((d) => d.bias === "L");
  const disc = days.filter((d) => d.bias && !conf.includes(d));
  const sbWin = fcb.filter((d) => (B(d).side === "H" ? !d.touchedL : !d.touchedH)).length;

  const wd = days.filter((d) => d.widthBucket);
  const narrow = wd.filter((d) => d.widthBucket === "narrow");
  const normal = wd.filter((d) => d.widthBucket === "normal");
  const wide = wd.filter((d) => d.widthBucket === "wide");
  const avgAtr = avg(wd.map((d) => d.atr!)) ?? 0;
  const avgAvgIb = avg(wd.map((d) => d.avgIB!)) ?? 0;
  const extRate = (a: SlimDay[]) => {
    const x = a.filter((d) => d.fcb);
    return x.length ? pct(x.filter((d) => B(d).hit["1"]).length, x.length) : "—";
  };
  const wRange = (a: SlimDay[]) =>
    a.length ? `${f2(Math.min(...a.map((d) => d.width)))} – ${f2(Math.max(...a.map((d) => d.width)))} pts` : "—";

  const volYes = fcb.filter((d) => B(d).volSurge);
  const volNo = fcb.filter((d) => !B(d).volSurge);
  const wickOnly = days.filter((d) => (d.touchedH || d.touchedL) && !d.fcb);
  const failed = fcb.filter((d) => B(d).failed);

  const fv = days.filter((d) => d.fvg);
  const fvB = fv.filter((d) => d.fvg === "bull");
  const fvS = fv.filter((d) => d.fvg === "bear");
  const hitExt = (d: SlimDay) => (d.fvg === "bull" ? d.touchedH : d.touchedL);

  const rt = fcb.filter((d) => B(d).retest);
  const noRt = fcb.filter((d) => !B(d).retest && !B(d).failed);

  const fA = fcb.filter((d) => B(d).fibA.hit);
  const fAno = fcb.filter((d) => !B(d).fibA.hit);
  const fB = fcb.filter((d) => B(d).fibB.hit);

  const top = days.filter((d) => d.closeZone === "top25");
  const bot = days.filter((d) => d.closeZone === "bot25");
  const midz = days.filter((d) => d.closeZone === "mid50");
  const topStrong = top.filter((d) => d.first === "L");
  const botStrong = bot.filter((d) => d.first === "H");

  const openTypes: NonNullable<SlimDay["openType"]>[] = ["OAR-H", "OAR-L", "HIR", "LIR"];

  const ob = days.filter((d) => d.orbDir && d.bias);
  const align = ob.filter((d) => d.orbDir === d.bias);
  const oppose = ob.filter((d) => d.orbDir !== d.bias);

  const tf: [number, number, string][] = [
    [REND, 720, `${clock(REND)} – 12:00`], [720, 780, "12:00 – 13:00"], [780, 840, "13:00 – 14:00"],
    [840, 900, "14:00 – 15:00"], [900, 961, "15:00 – close"],
  ];
  const byNoon = fcb.filter((d) => B(d).breakMin < 720);
  const cont = days.filter((d) => d.containedAt2);

  /* day of week — parsed at noon UTC so no timezone can shift the date */
  const DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const dowOf = (d: SlimDay) => new Date(`${d.date}T12:00:00Z`).getUTCDay(); // 1=Mon … 5=Fri
  const byDow = DOW.map((name, i) => {
    const g = days.filter((d) => dowOf(d) === i + 1);
    const gb = g.filter((d) => d.fcb);
    return { name, g, gb };
  }).filter((x) => x.g.length > 0);

  const ranked = ([
    ["Midpoint close bias", wb.length, wb.filter((d) => d.firstTouchSide === d.bias).length],
    ["Formation order + midpoint (confluent)", conf.length, conf.filter((d) => d.firstTouchSide === d.bias).length],
    ["Single break — opposite side never breaks", fcb.length, sbWin],
    ["Close top/bot 25% + formation order", topStrong.length + botStrong.length,
      topStrong.filter((d) => d.firstTouchSide === "H").length + botStrong.filter((d) => d.firstTouchSide === "L").length],
    ["ORB aligned with IB bias", align.length, align.filter((d) => d.firstTouchSide === d.bias).length],
    ["FVG direction = break direction", fv.length, fv.filter((d) => d.firstTouchSide === (d.fvg === "bull" ? "H" : "L")).length],
    ["Failed break → opposite extreme", failed.length, failed.filter((d) => B(d).fadeOpp).length],
    ["Retest → continuation", rt.length, rt.filter((d) => B(d).retestCont).length],
    ["0.25 fib pullback (IB range) → continuation", fA.length, fA.filter((d) => B(d).fibA.cont).length],
    ["0.25 fib pullback (impulse) → continuation", fB.length, fB.filter((d) => B(d).fibB.cont).length],
    ["Break + volume surge → ≥1× ext", volYes.length, volYes.filter((d) => B(d).hit["1"]).length],
    ["Narrow IB → single break", narrow.length, narrow.filter((d) => d.singleBreak).length],
    ["Wide IB → both sides break (rotation)", wide.length, wide.filter((d) => d.bothBroke).length],
    ["Contained at 2pm → stays contained", cont.length, cont.filter((d) => !d.containedBrokeLate).length],
  ] as [string, number, number][])
    .filter(([, n]) => n >= 8)
    .sort((a, b) => b[2] / b[1] - a[2] / a[1]);

  const verdict = (n: number, p: number) =>
    n < 20 ? "thin sample" : p >= 65 ? "tradeable" : p >= 55 ? "marginal" : p <= 45 ? "inverted — fade it" : "noise";

  return (
    <div>
      {symTabs}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        <LiveToday
          sym={sym}
          win={win}
          ds={ds}
          days={days}
          hist={{
            avgIb: avg(days.slice(-20).map((d) => d.width)) ?? 0,
            avgAtr: avg(days.slice(-20).map((d) => d.atr ?? d.dayRange)) ?? 0,
            dowStats: byDow.map(({ name, g }) => ({
              name, n: g.length, sb: rateNum(g.filter((d) => d.singleBreak).length, g.length),
            })),
          }}
        />

        {isOwner && (
          <button
            onClick={() => setShowStats((v) => !v)}
            style={{
              alignSelf: "flex-start", padding: "8px 18px", borderRadius: 8, fontSize: 15, fontWeight: 800, cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: HOME_THEME.text,
            }}
          >
            {showStats ? "Hide historical stats ▲ (owner)" : `Show historical stats (${N} sessions) ▼ (owner)`}
          </button>
        )}

        {isOwner && showStats && (<>
        <Card accent="blue" title={`${winLabel(win)} Stats — ${ds.symbol} ${ds.barMinutes}m RTH`} subtitle={`${winRange(win)} ET · last updated ${LAST_UPDATED}`}>
          <div style={statGrid}>
            <Stat k="Sessions" v={String(N)} sub={`${yearsSpan.toFixed(1)} years of data`} />
            <Stat k="Date range" v={`${ds.from} → ${ds.to}`} sub={`${ds.barMinutes}m bars, RTH`} />
            <Stat k={`Avg ${winLabel(win)} width`} v={`${f2(avg(widths))} pts`} />
            <Stat k={`Median ${winLabel(win)} width`} v={`${f2(med(widths))} pts`} />
            <Stat k="Range as % of day range" v={`${f2((avg(days.map((d) => d.width / d.dayRange)) ?? 0) * 100)}%`} />
          </div>
          <div style={{ fontSize: 15, color: HOME_THEME.text, lineHeight: 1.55 }}>
            {winLabel(win)} = {winRange(win)} ET high/low. A <b>break</b> means a bar <b>close</b> outside the range — wick-only touches
            are tracked separately as the trap set. Extensions, MFE and MAE are quoted in multiples of range width, measured from the
            broken level. Every rule below is identical across windows, so the tabs above are directly comparable: the shorter the
            window, the earlier the entry and the higher the both-sides-broke tax.
          </div>
        </Card>

        <Card accent="green" title="★ Rule Ranking — highest hit rate first" subtitle="Rules with ≥8 sample days only">
          <Tbl head={["Rule", "Sample (days)", "Hit", "Hit rate", "Verdict"]}
            footNote="Sample size is the first thing to check — a 90% hit rate on 9 days is nothing. A rule at 50±5% is a coin flip.">
            {ranked.map(([l, n, w]) => <Row key={l} label={l} n={n} hits={w} detail={verdict(n, (100 * w) / n)} />)}
          </Tbl>
        </Card>

        <Card accent="cyan" title="0 · Baseline — IB break behavior" subtitle="The benchmark every rule must beat">
          <Tbl head={["Outcome", "Days", "Hit", "Rate", "Note"]}>
            <Row label="IB high broken (any wick)" n={N} hits={days.filter((d) => d.touchedH).length} />
            <Row label="IB low broken (any wick)" n={N} hits={days.filter((d) => d.touchedL).length} />
            <Row label="SINGLE break only (one side)" n={N} hits={days.filter((d) => d.singleBreak).length} detail="the 'single break' edge" />
            <Row label="BOTH sides broken (rotation)" n={N} hits={days.filter((d) => d.bothBroke).length} />
            <Row label="NEITHER side broken (contained)" n={N} hits={days.filter((d) => d.neitherBroke).length} />
            <Row label="Break confirmed by a bar CLOSE" n={N} hits={fcb.length} />
          </Tbl>
        </Card>

        <Card accent="purple" title="0b · Time of IB Break" subtitle="When the first break actually happens">
          <div style={statGrid}>
            <Stat k="Avg · first TOUCH" v={clock(avg(touchMins))} sub={`${f2((avg(touchMins) ?? 0) - 570)} min after IB open`} />
            <Stat k="Avg · CLOSE break" v={clock(avg(closeMins))} sub={`${f2((avg(closeMins) ?? 0) - 570)} min after IB open`} />
            <Stat k="Median · CLOSE break" v={clock(med(closeMins))} sub={`n = ${closeMins.length} days`} />
            <Stat k="Avg · HIGH breaks" v={clock(avg(cbH))} sub={`n = ${cbH.length}`} />
            <Stat k="Avg · LOW breaks" v={clock(avg(cbL))} sub={`n = ${cbL.length}`} />
            <Stat k="Earliest / Latest" v={closeMins.length ? `${clock(Math.min(...closeMins))} – ${clock(Math.max(...closeMins))}` : "—"} />
          </div>
          <Tbl head={["Break has occurred…", "Break days", "Count", "Cumulative %", "Note"]}
            footNote="The steepest part of this curve is your attention window — that's when to be at the screen.">
            {timeBuckets.map(([m, l]) => (
              <Row key={l} label={l} n={closeMins.length} hits={closeMins.filter((x) => x <= m).length} detail="cumulative" />
            ))}
          </Tbl>
        </Card>

        <Card accent="blue" title="0c · Day of the Week" subtitle="Same rules, sliced by weekday — where the trend days and the chop days actually live">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Day", "Sessions", "Avg IB width", "Single break", "Both sides (rotation)", "Never broke", "Break ≥1× ext", "Fail rate", "Avg break time", "High breaks first"]
                  .map((h, i) => <th key={h} style={i === 0 ? thL : th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {byDow.map(({ name, g, gb }) => {
                const sb = rateNum(g.filter((d) => d.singleBreak).length, g.length);
                const bb = rateNum(g.filter((d) => d.bothBroke).length, g.length);
                const ext = rateNum(gb.filter((d) => B(d).hit["1"]).length, gb.length);
                return (
                  <tr key={name}>
                    <td style={tdL}>{name}</td>
                    <td style={td}>{g.length}</td>
                    <td style={td}>{f2(avg(g.map((d) => d.width)))}</td>
                    <td style={{ ...td, color: rateColor(sb), fontWeight: 800 }}>{sb == null ? "—" : `${sb.toFixed(1)}%`}</td>
                    <td style={{ ...td, color: rateColor(bb), fontWeight: 800 }}>{bb == null ? "—" : `${bb.toFixed(1)}%`}</td>
                    <td style={td}>{pct(g.filter((d) => d.neitherBroke).length, g.length)}</td>
                    <td style={{ ...td, color: rateColor(ext), fontWeight: 800 }}>{ext == null ? "—" : `${ext.toFixed(1)}%`}</td>
                    <td style={td}>{pct(gb.filter((d) => B(d).failed).length, gb.length)}</td>
                    <td style={td}>{clock(avg(gb.map((d) => B(d).breakMin)))}</td>
                    <td style={td}>{pct(g.filter((d) => d.firstTouchSide === "H").length, g.filter((d) => d.firstTouchSide).length)}</td>
                  </tr>
                );
              })}
              <tr>
                <td style={{ ...tdL, fontWeight: 800 }}>ALL DAYS</td>
                <td style={{ ...td, fontWeight: 800 }}>{N}</td>
                <td style={{ ...td, fontWeight: 800 }}>{f2(avg(widths))}</td>
                <td style={{ ...td, fontWeight: 800 }}>{pct(days.filter((d) => d.singleBreak).length, N)}</td>
                <td style={{ ...td, fontWeight: 800 }}>{pct(days.filter((d) => d.bothBroke).length, N)}</td>
                <td style={{ ...td, fontWeight: 800 }}>{pct(days.filter((d) => d.neitherBroke).length, N)}</td>
                <td style={{ ...td, fontWeight: 800 }}>{pct(fcb.filter((d) => B(d).hit["1"]).length, fcb.length)}</td>
                <td style={{ ...td, fontWeight: 800 }}>{pct(fcb.filter((d) => B(d).failed).length, fcb.length)}</td>
                <td style={{ ...td, fontWeight: 800 }}>{clock(avg(closeMins))}</td>
                <td style={{ ...td, fontWeight: 800 }}>{pct(days.filter((d) => d.firstTouchSide === "H").length, days.filter((d) => d.firstTouchSide).length)}</td>
              </tr>
            </tbody>
          </table>
          <div style={note}>
            Read each weekday against the ALL DAYS row, not against 50%. A day only matters if it deviates from the sample&rsquo;s own baseline
            by more than a few points — with ~450 sessions per weekday, a 3–4 point gap is still inside the noise band.
          </div>
        </Card>

        <Card accent="cyan" title="1 · Midpoint Close Bias" subtitle="IB closes above mid → high breaks first. Below mid → low breaks first.">
          <Tbl head={["Signal", "Days", "Correct", "Hit rate", "Detail"]}>
            <Row label="All midpoint-bias days" n={wb.length} hits={wb.filter((d) => d.firstTouchSide === d.bias).length} />
            <Row indent label="Bias LONG (close > mid)" n={wbL.length} hits={wbL.filter((d) => d.firstTouchSide === "H").length} detail="predicted high breaks first" />
            <Row indent label="Bias SHORT (close < mid)" n={wbS.length} hits={wbS.filter((d) => d.firstTouchSide === "L").length} detail="predicted low breaks first" />
            <Row label="…and that side EVER breaks" n={wb.length} hits={wb.filter((d) => (d.bias === "H" ? d.touchedH : d.touchedL)).length} detail="looser test — breaks at any point" />
          </Tbl>
        </Card>

        <Card accent="green" title="2 · Formation Order + Midpoint" subtitle="Low forms first + close above mid → long. High first + close below mid → short.">
          <Tbl head={["Setup", "Days", "Correct", "Hit rate", "Detail"]}
            footNote="Compare CONFLUENT against the raw midpoint bias in Rule 1 — the delta is the entire value of the formation-order filter.">
            <Row label="CONFLUENT (order agrees with bias)" n={conf.length} hits={conf.filter((d) => d.firstTouchSide === d.bias).length} detail="the A+ filter" />
            <Row indent label="Long (low first, close > mid)" n={confL.length} hits={confL.filter((d) => d.firstTouchSide === "H").length} />
            <Row indent label="Short (high first, close < mid)" n={confS.length} hits={confS.filter((d) => d.firstTouchSide === "L").length} />
            <Row label="DISCORDANT (order fights bias)" n={disc.length} hits={disc.filter((d) => d.firstTouchSide === d.bias).length} detail="skip these" />
          </Tbl>
        </Card>

        <Card accent="orange" title="3 · Single Break Continuation" subtitle="The claimed 70–85% edge, tested on close-confirmed breaks">
          <Tbl head={["Test", "Days", "Hit", "Rate", "Detail"]}>
            <Row label="Opposite IB side NEVER breaks" n={fcb.length} hits={sbWin} detail="true single-break day after entry" />
            <Row label="Break extends ≥ 0.5× IB width" n={fcb.length} hits={fcb.filter((d) => B(d).hit["0.5"]).length} />
            <Row label="Break extends ≥ 1.0× IB width" n={fcb.length} hits={fcb.filter((d) => B(d).hit["1"]).length} />
            <Row label="Never trades back to the IB midpoint" n={fcb.length} hits={fcb.filter((d) => d.noMidReturn).length} detail="strictest version" />
          </Tbl>
        </Card>

        <Card accent="red" title="4 · IB Width → Day Type" subtitle="Narrow → trend/break. Wide → rotation, fade the breaks.">
          <div style={statGrid}>
            <Stat k="NARROW = width <" v="0.5× ATR14  or  0.75× avgIB20" sub={`≈ under ${f2(Math.min(0.5 * avgAtr, 0.75 * avgAvgIb))} pts at current vol`} />
            <Stat k="WIDE = width >" v="1.5× ATR14  or  1.25× avgIB20" sub={`≈ over ${f2(Math.min(1.5 * avgAtr, 1.25 * avgAvgIb))} pts at current vol`} />
            <Stat k="NORMAL" v="everything between" sub="the default state" />
            <Stat k="Sample averages" v={`ATR14 ${f2(avgAtr)} · avgIB20 ${f2(avgAvgIb)}`} sub="RTH daily range / 20d mean IB" />
          </div>
          <Tbl head={["Bucket", "Days", "Single-break", "Rate", "Both sides broke / ≥1× ext"]}>
            <Row label="NARROW IB" n={narrow.length} hits={narrow.filter((d) => d.singleBreak).length}
              detail={`both: ${pct(narrow.filter((d) => d.bothBroke).length, narrow.length)} · ≥1× ext: ${extRate(narrow)}`} />
            <Row label="NORMAL IB" n={normal.length} hits={normal.filter((d) => d.singleBreak).length}
              detail={`both: ${pct(normal.filter((d) => d.bothBroke).length, normal.length)} · ≥1× ext: ${extRate(normal)}`} />
            <Row label="WIDE IB" n={wide.length} hits={wide.filter((d) => d.bothBroke).length}
              detail={`hit col = BOTH-sides rate · ≥1× ext: ${extRate(wide)}`} />
          </Tbl>
          <div style={{ height: 14 }} />
          <Tbl head={["Bucket", "Actual IB widths in sample", "Mean", "Days", "Share of sessions"]}
            footNote="Use the ×ATR / ×avgIB rule live — the point ranges are just what those adaptive thresholds worked out to across this sample, so they overlap as vol regimes shift.">
            {([["NARROW", narrow, HOME_THEME.green], ["NORMAL", normal, HOME_THEME.orange], ["WIDE", wide, HOME_THEME.red]] as [string, SlimDay[], string][]).map(([l, a, c]) => (
              <tr key={l}>
                <td style={{ ...tdL, color: c, fontWeight: 800 }}>{l}</td>
                <td style={td}>{wRange(a)}</td>
                <td style={td}>{a.length ? `${f2(avg(a.map((d) => d.width)))} pts` : "—"}</td>
                <td style={td}>{a.length}</td>
                <td style={td}>{pct(a.length, wd.length)}</td>
              </tr>
            ))}
          </Tbl>
        </Card>

        <Card accent="green" title="5 · Breakout Entry — close beyond IB + volume" subtitle="Volume filter = break-bar volume > average IB bar volume">
          <Tbl head={["Entry filter", "Days", "≥1× IB ext", "Rate", "Avg MFE / MAE (× IB width)"]}
            footNote="MAE is your stop-distance requirement — it's the heat the average winner still made you sit through.">
            <Row label="Close break + VOLUME surge" n={volYes.length} hits={volYes.filter((d) => B(d).hit["1"]).length}
              detail={`MFE ${f2(avg(volYes.map((d) => B(d).rExt)))}× / MAE ${f2(avg(volYes.map((d) => B(d).rAdv)))}×`} />
            <Row label="Close break, NO volume surge" n={volNo.length} hits={volNo.filter((d) => B(d).hit["1"]).length}
              detail={`MFE ${f2(avg(volNo.map((d) => B(d).rExt)))}× / MAE ${f2(avg(volNo.map((d) => B(d).rAdv)))}×`} />
            <Row label="WICK-only touch (no close outside)" n={wickOnly.length} hits={0} detail="the traps — no entry taken" />
          </Tbl>
        </Card>

        <Card accent="red" title="6 · Failed Breakout Fade" subtitle="Break closes outside, then closes back inside within 30 min">
          <Tbl head={["Outcome", "Days", "Hit", "Rate", "Detail"]}
            footNote={`Avg excursion before the fail: <b>${f2(avg(failed.map((d) => B(d).peakBeforeFail)))} pts</b> — that is roughly the stop a breakout entry has to survive.`}>
            <Row label="Break FAILS (closes back inside ≤30m)" n={fcb.length} hits={failed.length} detail="base rate of the trap" />
            <Row indent label="then reaches the IB MIDPOINT" n={failed.length} hits={failed.filter((d) => B(d).fadeMid).length} detail="target 1" />
            <Row indent label="then reaches the OPPOSITE IB extreme" n={failed.length} hits={failed.filter((d) => B(d).fadeOpp).length} detail="target 2 — the money target" />
          </Tbl>
        </Card>

        <Card accent="purple" title="7 · 15m FVG inside the IB" subtitle="15m fair-value gap, rebuilt from the raw bars">
          <Tbl head={["FVG", "Days", "Reaches IB extreme in FVG dir", "Rate", "Reaches midpoint"]}>
            <Row label="BULLISH FVG in IB" n={fvB.length} hits={fvB.filter(hitExt).length} detail={`mid: ${pct(fvB.filter((d) => d.fvgHitMid).length, fvB.length)}`} />
            <Row label="BEARISH FVG in IB" n={fvS.length} hits={fvS.filter(hitExt).length} detail={`mid: ${pct(fvS.filter((d) => d.fvgHitMid).length, fvS.length)}`} />
            <Row label="FVG direction = first-touch side" n={fv.length} hits={fv.filter((d) => d.firstTouchSide === (d.fvg === "bull" ? "H" : "L")).length} detail="directional predictive power" />
            <Row label="NO FVG in IB (control) → single break" n={N - fv.length} hits={days.filter((d) => !d.fvg && d.singleBreak).length} detail="control group" />
          </Tbl>
        </Card>

        <Card accent="cyan" title="8 · Retest Continuation" subtitle="Returns to within 2 ticks of the broken level, close holds outside">
          <Tbl head={["Path", "Days", "Continues to new extreme", "Rate", "Avg MFE (× IB width)"]}
            footNote="If retest MFE ≥ no-retest MFE, waiting costs nothing and improves the entry. If it's materially lower, the best days never retest — take the break.">
            <Row label="Break → clean RETEST → continue" n={rt.length} hits={rt.filter((d) => B(d).retestCont).length} detail={`${f2(avg(rt.map((d) => B(d).rExt)))}×`} />
            <Row label="Break → NO retest (runs away)" n={noRt.length} hits={noRt.filter((d) => B(d).hit["1"]).length} detail={`${f2(avg(noRt.map((d) => B(d).rExt)))}× (hit = ≥1× ext)`} />
          </Tbl>
        </Card>

        <Card accent="green" title="B · 0.25 Fib Pullback → Continuation" subtitle="Two readings of &quot;the 0.25 level&quot; — they are very different trades">
          <Tbl head={["Test", "Days", "Hit", "Rate", "Detail"]}
            footNote={`Variant A avg MFE measured <i>from the 0.25 entry</i>: <b>${f2(avg(fA.map((d) => B(d).fibA.mfe ?? 0)))}× IB width</b>. Watch the "no pullback" row — if the runaway days carry the fattest MFE, waiting for 0.25 filters you out of the best sessions.`}>
            {sectionRow("Variant A — 0.25 of the IB RANGE, measured back into the IB (high break → IBH − 0.25×width). A deep pullback that re-enters the IB.")}
            <Row label="Pullback REACHES the 0.25 level" n={fcb.length} hits={fA.length} detail="how often you even get filled" />
            <Row indent label="then CONTINUES to a new extreme" n={fA.length} hits={fA.filter((d) => B(d).fibA.cont).length} detail="the actual edge" />
            <Row indent label="instead runs through the IB MIDPOINT" n={fA.length} hits={fA.filter((d) => B(d).fibA.fail).length} detail="trade dies" />
            <Row label="NO pullback — price never comes back" n={fcb.length} hits={fAno.length} detail={`these run: avg MFE ${f2(avg(fAno.map((d) => B(d).rExt)))}× IB`} />
            {sectionRow("Variant B — 0.25 retrace of the post-break IMPULSE (break level → running extreme). A shallow pullback that stays outside the IB.")}
            <Row label="Pullback REACHES the 0.25 impulse retrace" n={fcb.length} hits={fB.length} detail="requires impulse > 0.25× IB first" />
            <Row indent label="then CONTINUES to a new extreme" n={fB.length} hits={fB.filter((d) => B(d).fibB.cont).length} detail="the actual edge" />
          </Tbl>
        </Card>

        <Card accent="orange" title="9 · Extension Targets" subtitle="Scale-out probabilities, measured from the broken level">
          <Tbl head={["Target", "Breaks", "Reached", "Hit rate", "Sizing"]}
            footNote={`Avg MFE on all close-breaks: <b>${f2(avg(fcb.map((d) => B(d).rExt)))}× IB width</b> · avg MAE (heat taken): <b>${f2(avg(fcb.map((d) => B(d).rAdv)))}× IB width</b>.`}>
            {[0.5, 1, 1.5, 2].map((t) => (
              <Row key={t} label={`${t}× IB width from break`} n={fcb.length} hits={fcb.filter((d) => B(d).hit[String(t)]).length}
                detail={`avg IB ${f2(avg(widths))} pts → target ≈ ${f2(t * (avg(widths) ?? 0))} pts`} />
            ))}
          </Tbl>
        </Card>

        <Card accent="green" title="10 · Close Location in IB Range" subtitle="Top 25% + low first → strong long. Bottom 25% + high first → strong short.">
          <Tbl head={["Zone", "Days", "Breaks as predicted", "Rate", "Detail"]}>
            <Row label="TOP 25% close" n={top.length} hits={top.filter((d) => d.firstTouchSide === "H").length} detail="plain zone" />
            <Row indent label="+ LOW formed first (STRONG LONG)" n={topStrong.length} hits={topStrong.filter((d) => d.firstTouchSide === "H").length}
              detail={`single-break: ${pct(topStrong.filter((d) => d.singleBreak).length, topStrong.length)}`} />
            <Row label="BOTTOM 25% close" n={bot.length} hits={bot.filter((d) => d.firstTouchSide === "L").length} detail="plain zone" />
            <Row indent label="+ HIGH formed first (STRONG SHORT)" n={botStrong.length} hits={botStrong.filter((d) => d.firstTouchSide === "L").length}
              detail={`single-break: ${pct(botStrong.filter((d) => d.singleBreak).length, botStrong.length)}`} />
            <Row label="MIDDLE 50% close (no edge expected)" n={midz.length} hits={midz.filter((d) => d.firstTouchSide === d.bias).length} detail="bias hit-rate — expect a coin flip" />
          </Tbl>
        </Card>

        <Card accent="purple" title="11 · Open Type + IB Width" subtitle="OAR = open outside the prior RTH range · HIR/LIR = open inside it">
          <Tbl head={["Open type", "Days", "Hit", "Rate", "What 'hit' means"]}
            footNote="OAR-H / OAR-L = opened above / below the prior RTH range. HIR / LIR = opened inside the prior range, in the upper / lower half.">
            {openTypes.flatMap((ot) => {
              const g = wd.filter((d) => d.openType === ot);
              if (!g.length) return [];
              const gn = g.filter((d) => d.widthBucket === "narrow");
              const gw = g.filter((d) => d.widthBucket === "wide");
              const out = [<Row key={ot} label={`${ot} — all`} n={g.length} hits={g.filter((d) => d.singleBreak).length} detail="single-break rate" />];
              if (gn.length) out.push(<Row key={ot + "n"} indent label={`${ot} + NARROW IB`} n={gn.length} hits={gn.filter((d) => d.singleBreak).length} detail="breakout thesis" />);
              if (gw.length) out.push(<Row key={ot + "w"} indent label={`${ot} + WIDE IB`} n={gw.length} hits={gw.filter((d) => d.bothBroke).length} detail="both-sides broke = rotation thesis" />);
              return out;
            })}
          </Tbl>
        </Card>

        <Card accent="cyan" title="12 · ORB + IB Alignment" subtitle="09:30–09:45 opening range breaks the same way as the IB midpoint bias">
          <Tbl head={["Setup", "Days", "Bias side breaks first", "Rate", "Single-break rate"]}
            footNote="Aligned should beat conflicted on BOTH columns for this filter to earn its keep.">
            <Row label="ALIGNED (ORB dir = IB bias)" n={align.length} hits={align.filter((d) => d.firstTouchSide === d.bias).length}
              detail={pct(align.filter((d) => d.singleBreak).length, align.length)} />
            <Row label="CONFLICTED (ORB vs IB bias)" n={oppose.length} hits={oppose.filter((d) => d.firstTouchSide === d.bias).length}
              detail={pct(oppose.filter((d) => d.singleBreak).length, oppose.length)} />
          </Tbl>
        </Card>

        <Card accent="orange" title="13 · Time Filter — when the break happens" subtitle="Hit = extension ≥ 1× IB width">
          <Tbl head={["Break window", "Breaks", "≥1× ext", "Rate", "Detail"]}
            footNote="Late breaks have less session left — expect decaying extension rates. If they don't decay, the break is time-agnostic.">
            {tf.map(([a, b, l]) => {
              const g = fcb.filter((d) => B(d).breakMin >= a && B(d).breakMin < b);
              return <Row key={l} label={l} n={g.length} hits={g.filter((d) => B(d).hit["1"]).length}
                detail={`avg MFE ${f2(avg(g.map((d) => B(d).rExt)))}× · fail rate ${pct(g.filter((d) => B(d).failed).length, g.length)}`} />;
            })}
            <Row label="ALL breaks before noon" n={byNoon.length} hits={byNoon.filter((d) => B(d).hit["1"]).length} detail="the killzone cut" />
          </Tbl>
        </Card>

        <Card accent="red" title="14 · Contained Day (rare)" subtitle="Price still entirely inside the IB at 14:00 ET">
          <Tbl head={["Outcome", "Days", "Hit", "Rate", "Detail"]}>
            <Row label="Contained at 14:00" n={N} hits={cont.length} detail="base rate of the setup" />
            <Row indent label="STAYS inside through the close (fade works)" n={cont.length} hits={cont.filter((d) => !d.containedBrokeLate).length} detail="fade the extremes" />
            <Row indent label="BREAKS out late (fade gets run over)" n={cont.length} hits={cont.filter((d) => d.containedBrokeLate).length} detail="the tail risk" />
          </Tbl>
        </Card>
        </>)}
      </div>
    </div>
  );
}
