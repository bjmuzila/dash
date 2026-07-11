"use client";

/**
 * IbStatsTab — /scanner → "IB Stats"
 *
 * Initial Balance (09:30–10:30 ET) rule backtest, run client-side over a static
 * 3-year ES 5m RTH CSV shipped in /public/data/. No network, no API — the CSV is
 * baked in, so the tab is instant and works offline.
 *
 * To refresh the dataset: drop a new CSV at public/data/es-5m-rth.csv and bump
 * LAST_UPDATED below.
 */

import { useEffect, useMemo, useState } from "react";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import {
  parseCsv, buildDays, avg, med, clock,
  type Day,
} from "@/lib/ibStats";

const CSV_URL = "/data/es-5m-rth.csv";
const LAST_UPDATED = "7/11/2026";

/* ── formatting ───────────────────────────────────────────────────────────── */

const f2 = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : n.toFixed(2);
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");
const rateNum = (n: number, d: number) => (d ? (100 * n) / d : null);

const rateColor = (p: number | null) =>
  p == null ? "rgba(255,255,255,0.4)"
  : p >= 60 ? HOME_THEME.green
  : p <= 40 ? HOME_THEME.red
  : HOME_THEME.orange;

const th: React.CSSProperties = {
  padding: "7px 10px", textAlign: "right", fontWeight: 700, fontSize: 12,
  letterSpacing: "0.05em", textTransform: "uppercase",
  color: "rgba(255,255,255,0.55)", whiteSpace: "nowrap",
};
const thL: React.CSSProperties = { ...th, textAlign: "left" };
const td: React.CSSProperties = {
  padding: "7px 10px", textAlign: "right", color: HOME_THEME.text,
  fontSize: 15, borderTop: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap",
};
const tdL: React.CSSProperties = { ...td, textAlign: "left" };
const tdDim: React.CSSProperties = { ...td, color: "rgba(255,255,255,0.55)", fontSize: 13 };
const note: React.CSSProperties = {
  marginTop: 10, fontSize: 13, fontStyle: "italic", color: "rgba(255,255,255,0.5)",
};

/* one stat row: label · n · hits · rate · detail */
function Row({ label, n, hits, detail, indent }: {
  label: string; n: number; hits: number; detail?: string; indent?: boolean;
}) {
  const p = rateNum(hits, n);
  return (
    <tr>
      <td style={{ ...tdL, paddingLeft: indent ? 26 : 10, color: indent ? "rgba(255,255,255,0.8)" : HOME_THEME.text }}>{label}</td>
      <td style={td}>{n}</td>
      <td style={td}>{hits}</td>
      <td style={{ ...td, color: rateColor(p), fontWeight: 800 }}>{p == null ? "—" : `${p.toFixed(1)}%`}</td>
      <td style={tdDim}>{detail ?? ""}</td>
    </tr>
  );
}

function Tbl({ head, children, footNote }: {
  head: string[]; children: React.ReactNode; footNote?: string;
}) {
  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>{head.map((h, i) => <th key={h} style={i === 0 ? thL : th}>{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {footNote && <div style={note} dangerouslySetInnerHTML={{ __html: footNote }} />}
    </>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 12, padding: 12,
    }}>
      <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>{k}</div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 3, color: HOME_THEME.text }}>{v}</div>
      {sub && <div style={{ fontSize: 11, marginTop: 3, color: "rgba(255,255,255,0.45)" }}>{sub}</div>}
    </div>
  );
}

const statGrid: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
  gap: 12, marginBottom: 14,
};

const sectionRow = (text: string) => (
  <tr>
    <td colSpan={5} style={{ ...tdL, color: LIGHT_BLUE, fontWeight: 800, fontSize: 13, paddingTop: 14 }}>
      {text}
    </td>
  </tr>
);

/* ── component ────────────────────────────────────────────────────────────── */

export default function IbStatsTab() {
  const [csv, setCsv] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(CSV_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} — is ${CSV_URL} in /public/data/?`);
        return r.text();
      })
      .then((t) => { if (alive) setCsv(t); })
      .catch((e) => { if (alive) setErr(String(e.message || e)); });
    return () => { alive = false; };
  }, []);

  const days: Day[] = useMemo(() => (csv ? buildDays(parseCsv(csv)) : []), [csv]);

  if (err) {
    return (
      <Card accent="red" title="IB Stats — dataset not found">
        <div style={{ color: HOME_THEME.red, fontSize: 15 }}>{err}</div>
      </Card>
    );
  }
  if (!csv) {
    return <Card accent="cyan" title="IB Stats"><div style={{ color: "rgba(255,255,255,0.6)" }}>Loading dataset…</div></Card>;
  }
  if (!days.length) {
    return <Card accent="red" title="IB Stats"><div style={{ color: HOME_THEME.red }}>No complete RTH sessions parsed from the CSV.</div></Card>;
  }

  const N = days.length;
  const widths = days.map((d) => d.width);
  const yearsSpan = (() => {
    const a = new Date(days[0].date).getTime(), b = new Date(days[N - 1].date).getTime();
    return (b - a) / (365.25 * 864e5);
  })();

  /* baseline */
  const fcb = days.filter((d) => d.firstCloseBreak);
  const single = days.filter((d) => d.singleBreak).length;
  const both = days.filter((d) => d.bothBroke).length;
  const none = days.filter((d) => d.neitherBroke).length;

  /* 0b — break time */
  const touchMins = days.filter((d) => d.firstTouchBar).map((d) => d.firstTouchBar!.min);
  const closeMins = fcb.map((d) => d.firstCloseBreak!.breakMin);
  const cbH = fcb.filter((d) => d.firstCloseBreak!.side === "H").map((d) => d.firstCloseBreak!.breakMin);
  const cbL = fcb.filter((d) => d.firstCloseBreak!.side === "L").map((d) => d.firstCloseBreak!.breakMin);
  const timeBuckets: [number, string][] = [
    [630, "by 10:30 (first bar out)"], [660, "by 11:00"], [690, "by 11:30"],
    [720, "by 12:00 (noon)"], [780, "by 13:00"], [840, "by 14:00"], [900, "by 15:00"],
  ];

  /* 1 — midpoint bias */
  const wb = days.filter((d) => d.bias);
  const wbL = wb.filter((d) => d.bias === "H");
  const wbS = wb.filter((d) => d.bias === "L");

  /* 2 — formation order */
  const conf = days.filter((d) => d.bias && ((d.first === "L" && d.bias === "H") || (d.first === "H" && d.bias === "L")));
  const confL = conf.filter((d) => d.bias === "H");
  const confS = conf.filter((d) => d.bias === "L");
  const disc = days.filter((d) => d.bias && !conf.includes(d));

  /* 3 — single break */
  const sbWin = fcb.filter((d) => (d.firstCloseBreak!.side === "H" ? !d.touchedL : !d.touchedH)).length;
  const noMidReturn = fcb.filter((d) => {
    const fb = d.firstCloseBreak!, rest = d.post.slice(fb.i + 1);
    if (!rest.length) return false;
    return fb.side === "H"
      ? Math.min(...rest.map((b) => b.l)) > d.mid
      : Math.max(...rest.map((b) => b.h)) < d.mid;
  }).length;

  /* 4 — width buckets */
  const wd = days.filter((d) => d.widthBucket);
  const narrow = wd.filter((d) => d.widthBucket === "narrow");
  const normal = wd.filter((d) => d.widthBucket === "normal");
  const wide = wd.filter((d) => d.widthBucket === "wide");
  const avgAtr = avg(wd.map((d) => d.atr!)) ?? 0;
  const avgAvgIb = avg(wd.map((d) => d.avgIB!)) ?? 0;
  const extRate = (a: Day[]) => {
    const x = a.filter((d) => d.firstCloseBreak);
    return x.length ? pct(x.filter((d) => d.firstCloseBreak!.hit["1"]).length, x.length) : "—";
  };
  const wRange = (a: Day[]) =>
    a.length ? `${f2(Math.min(...a.map((d) => d.width)))} – ${f2(Math.max(...a.map((d) => d.width)))} pts` : "—";

  /* 5 — volume filter */
  const volYes = fcb.filter((d) => d.firstCloseBreak!.volSurge);
  const volNo = fcb.filter((d) => !d.firstCloseBreak!.volSurge);
  const wickOnly = days.filter((d) => (d.touchedH || d.touchedL) && !d.firstCloseBreak);

  /* 6 — failed break */
  const failed = fcb.filter((d) => d.firstCloseBreak!.failed);

  /* 7 — FVG */
  const fv = days.filter((d) => d.fvg);
  const fvB = fv.filter((d) => d.fvg === "bull");
  const fvS = fv.filter((d) => d.fvg === "bear");
  const hitExt = (d: Day) => (d.fvg === "bull" ? d.touchedH : d.touchedL);
  const hitMid = (d: Day) =>
    d.post.length
      ? d.fvg === "bull"
        ? Math.max(...d.post.map((b) => b.h)) >= d.mid
        : Math.min(...d.post.map((b) => b.l)) <= d.mid
      : false;

  /* 8 — retest */
  const rt = fcb.filter((d) => d.firstCloseBreak!.retest);
  const noRt = fcb.filter((d) => !d.firstCloseBreak!.retest && !d.firstCloseBreak!.failed);

  /* B — 0.25 fib pullback */
  const fA = fcb.filter((d) => d.firstCloseBreak!.fibA.hit);
  const fAno = fcb.filter((d) => !d.firstCloseBreak!.fibA.hit);
  const fB = fcb.filter((d) => d.firstCloseBreak!.fibB.hit);

  /* 10 — close location */
  const top = days.filter((d) => d.closeZone === "top25");
  const bot = days.filter((d) => d.closeZone === "bot25");
  const midz = days.filter((d) => d.closeZone === "mid50");
  const topStrong = top.filter((d) => d.first === "L");
  const botStrong = bot.filter((d) => d.first === "H");

  /* 11 — open type */
  const openTypes: ("OAR-H" | "OAR-L" | "HIR" | "LIR")[] = ["OAR-H", "OAR-L", "HIR", "LIR"];

  /* 12 — ORB */
  const ob = days.filter((d) => d.orbDir && d.bias);
  const align = ob.filter((d) => d.orbDir === d.bias);
  const oppose = ob.filter((d) => d.orbDir !== d.bias);

  /* 13 — time filter buckets */
  const tf: [number, number, string][] = [
    [630, 720, "10:30 – 12:00"], [720, 780, "12:00 – 13:00"], [780, 840, "13:00 – 14:00"],
    [840, 900, "14:00 – 15:00"], [900, 961, "15:00 – close"],
  ];
  const byNoon = fcb.filter((d) => d.firstCloseBreak!.breakMin < 720);

  /* 14 — contained */
  const cont = days.filter((d) => d.containedAt2);

  /* ★ ranking */
  const ranked = ([
    ["Midpoint close bias", wb.length, wb.filter((d) => d.firstTouchSide === d.bias).length],
    ["Formation order + midpoint (confluent)", conf.length, conf.filter((d) => d.firstTouchSide === d.bias).length],
    ["Single break — opposite side never breaks", fcb.length, sbWin],
    ["Close top/bot 25% + formation order", topStrong.length + botStrong.length,
      topStrong.filter((d) => d.firstTouchSide === "H").length + botStrong.filter((d) => d.firstTouchSide === "L").length],
    ["ORB aligned with IB bias", align.length, align.filter((d) => d.firstTouchSide === d.bias).length],
    ["FVG direction = break direction", fv.length, fv.filter((d) => d.firstTouchSide === (d.fvg === "bull" ? "H" : "L")).length],
    ["Failed break → opposite extreme", failed.length, failed.filter((d) => d.firstCloseBreak!.fadeOpp).length],
    ["Retest → continuation", rt.length, rt.filter((d) => d.firstCloseBreak!.retestCont).length],
    ["0.25 fib pullback (IB range) → continuation", fA.length, fA.filter((d) => d.firstCloseBreak!.fibA.cont).length],
    ["0.25 fib pullback (impulse) → continuation", fB.length, fB.filter((d) => d.firstCloseBreak!.fibB.cont).length],
    ["Break + volume surge → ≥1× ext", volYes.length, volYes.filter((d) => d.firstCloseBreak!.hit["1"]).length],
    ["Narrow IB → single break", narrow.length, narrow.filter((d) => d.singleBreak).length],
    ["Wide IB → both sides break (rotation)", wide.length, wide.filter((d) => d.bothBroke).length],
    ["Contained at 2pm → stays contained", cont.length, cont.filter((d) => !d.containedBrokeLate).length],
  ] as [string, number, number][])
    .filter(([, n]) => n >= 8)
    .sort((a, b) => b[2] / b[1] - a[2] / a[1]);

  const verdict = (n: number, p: number) =>
    n < 20 ? "thin sample" : p >= 65 ? "tradeable" : p >= 55 ? "marginal" : p <= 45 ? "inverted — fade it" : "noise";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* header / dataset */}
      <Card accent="cyan" title="Initial Balance Stats — ES 5m RTH" subtitle={`Last updated ${LAST_UPDATED}`}>
        <div style={statGrid}>
          <Stat k="Sessions" v={String(N)} sub={`${yearsSpan.toFixed(1)} years of data`} />
          <Stat k="Date range" v={`${days[0].date} → ${days[N - 1].date}`} sub="RTH only" />
          <Stat k="Avg IB width" v={`${f2(avg(widths))} pts`} />
          <Stat k="Median IB width" v={`${f2(med(widths))} pts`} />
          <Stat k="IB as % of day range" v={`${f2((avg(days.map((d) => d.width / (d.dayHigh - d.dayLow))) ?? 0) * 100)}%`} />
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.55 }}>
          IB = 09:30–10:30 ET high/low. A <b>break</b> means a 5m <b>close</b> outside the IB — wick-only touches are tracked separately as the trap set.
          Extensions, MFE and MAE are quoted in multiples of IB width, measured from the broken level.
        </div>
      </Card>

      {/* ★ ranking */}
      <Card accent="green" title="★ Rule Ranking — highest hit rate first" subtitle="Rules with ≥8 sample days only">
        <Tbl head={["Rule", "Sample (days)", "Hit", "Hit rate", "Verdict"]}
          footNote="Sample size is the first thing to check — a 90% hit rate on 9 days is nothing. A rule at 50±5% is a coin flip.">
          {ranked.map(([l, n, w]) => (
            <Row key={l} label={l} n={n} hits={w} detail={verdict(n, (100 * w) / n)} />
          ))}
        </Tbl>
      </Card>

      {/* 0 baseline */}
      <Card accent="cyan" title="0 · Baseline — IB break behavior" subtitle="The benchmark every rule must beat">
        <Tbl head={["Outcome", "Days", "Hit", "Rate", "Note"]}>
          <Row label="IB high broken (any wick)" n={N} hits={days.filter((d) => d.touchedH).length} />
          <Row label="IB low broken (any wick)" n={N} hits={days.filter((d) => d.touchedL).length} />
          <Row label="SINGLE break only (one side)" n={N} hits={single} detail="the 'single break' edge" />
          <Row label="BOTH sides broken (rotation)" n={N} hits={both} />
          <Row label="NEITHER side broken (contained)" n={N} hits={none} />
          <Row label="Break confirmed by 5m CLOSE" n={N} hits={fcb.length} />
        </Tbl>
      </Card>

      {/* 0b time of break */}
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

      {/* 1 midpoint bias */}
      <Card accent="cyan" title="1 · Midpoint Close Bias" subtitle="IB closes above mid → high breaks first. Below mid → low breaks first.">
        <Tbl head={["Signal", "Days", "Correct", "Hit rate", "Detail"]}>
          <Row label="All midpoint-bias days" n={wb.length} hits={wb.filter((d) => d.firstTouchSide === d.bias).length} />
          <Row indent label="Bias LONG (close > mid)" n={wbL.length} hits={wbL.filter((d) => d.firstTouchSide === "H").length} detail="predicted high breaks first" />
          <Row indent label="Bias SHORT (close < mid)" n={wbS.length} hits={wbS.filter((d) => d.firstTouchSide === "L").length} detail="predicted low breaks first" />
          <Row label="…and that side EVER breaks" n={wb.length} hits={wb.filter((d) => (d.bias === "H" ? d.touchedH : d.touchedL)).length} detail="looser test — breaks at any point" />
        </Tbl>
      </Card>

      {/* 2 formation order */}
      <Card accent="green" title="2 · Formation Order + Midpoint" subtitle="Low forms first + close above mid → long. High first + close below mid → short.">
        <Tbl head={["Setup", "Days", "Correct", "Hit rate", "Detail"]}
          footNote="Compare CONFLUENT against the raw midpoint bias in Rule 1 — the delta is the entire value of the formation-order filter.">
          <Row label="CONFLUENT (order agrees with bias)" n={conf.length} hits={conf.filter((d) => d.firstTouchSide === d.bias).length} detail="the A+ filter" />
          <Row indent label="Long (low first, close > mid)" n={confL.length} hits={confL.filter((d) => d.firstTouchSide === "H").length} />
          <Row indent label="Short (high first, close < mid)" n={confS.length} hits={confS.filter((d) => d.firstTouchSide === "L").length} />
          <Row label="DISCORDANT (order fights bias)" n={disc.length} hits={disc.filter((d) => d.firstTouchSide === d.bias).length} detail="skip these" />
        </Tbl>
      </Card>

      {/* 3 single break */}
      <Card accent="orange" title="3 · Single Break Continuation" subtitle="The claimed 70–85% edge, tested on close-confirmed breaks">
        <Tbl head={["Test", "Days", "Hit", "Rate", "Detail"]}>
          <Row label="Opposite IB side NEVER breaks" n={fcb.length} hits={sbWin} detail="true single-break day after entry" />
          <Row label="Break extends ≥ 0.5× IB width" n={fcb.length} hits={fcb.filter((d) => d.firstCloseBreak!.hit["0.5"]).length} />
          <Row label="Break extends ≥ 1.0× IB width" n={fcb.length} hits={fcb.filter((d) => d.firstCloseBreak!.hit["1"]).length} />
          <Row label="Never trades back to the IB midpoint" n={fcb.length} hits={noMidReturn} detail="strictest version" />
        </Tbl>
      </Card>

      {/* 4 width buckets */}
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
          {([["NARROW", narrow, HOME_THEME.green], ["NORMAL", normal, HOME_THEME.orange], ["WIDE", wide, HOME_THEME.red]] as [string, Day[], string][]).map(([l, a, c]) => (
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

      {/* 5 breakout entry */}
      <Card accent="green" title="5 · Breakout Entry — close beyond IB + volume" subtitle="Volume filter = break-bar volume > average IB bar volume">
        <Tbl head={["Entry filter", "Days", "≥1× IB ext", "Rate", "Avg MFE / MAE (× IB width)"]}
          footNote="MAE is your stop-distance requirement — it's the heat the average winner still made you sit through.">
          <Row label="Close break + VOLUME surge" n={volYes.length} hits={volYes.filter((d) => d.firstCloseBreak!.hit["1"]).length}
            detail={`MFE ${f2(avg(volYes.map((d) => d.firstCloseBreak!.rExt)))}× / MAE ${f2(avg(volYes.map((d) => d.firstCloseBreak!.rAdv)))}×`} />
          <Row label="Close break, NO volume surge" n={volNo.length} hits={volNo.filter((d) => d.firstCloseBreak!.hit["1"]).length}
            detail={`MFE ${f2(avg(volNo.map((d) => d.firstCloseBreak!.rExt)))}× / MAE ${f2(avg(volNo.map((d) => d.firstCloseBreak!.rAdv)))}×`} />
          <Row label="WICK-only touch (no close outside)" n={wickOnly.length} hits={0} detail="the traps — no entry taken" />
        </Tbl>
      </Card>

      {/* 6 failed break */}
      <Card accent="red" title="6 · Failed Breakout Fade" subtitle="Break closes outside, then closes back inside within 30 min">
        <Tbl head={["Outcome", "Days", "Hit", "Rate", "Detail"]}
          footNote={`Avg excursion before the fail: <b>${f2(avg(failed.map((d) => d.firstCloseBreak!.peakBeforeFail)))} pts</b> (${f2(avg(failed.map((d) => d.firstCloseBreak!.peakBeforeFail / d.width)))}× IB width) — that is roughly the stop a breakout entry has to survive.`}>
          <Row label="Break FAILS (closes back inside ≤30m)" n={fcb.length} hits={failed.length} detail="base rate of the trap" />
          <Row indent label="then reaches the IB MIDPOINT" n={failed.length} hits={failed.filter((d) => d.firstCloseBreak!.fadeMid).length} detail="target 1" />
          <Row indent label="then reaches the OPPOSITE IB extreme" n={failed.length} hits={failed.filter((d) => d.firstCloseBreak!.fadeOpp).length} detail="target 2 — the money target" />
        </Tbl>
      </Card>

      {/* 7 FVG */}
      <Card accent="purple" title="7 · 15m FVG inside the IB" subtitle="15m fair-value gap built from the IB's 5m bars">
        <Tbl head={["FVG", "Days", "Reaches IB extreme in FVG dir", "Rate", "Reaches midpoint"]}>
          <Row label="BULLISH FVG in IB" n={fvB.length} hits={fvB.filter(hitExt).length} detail={`mid: ${pct(fvB.filter(hitMid).length, fvB.length)}`} />
          <Row label="BEARISH FVG in IB" n={fvS.length} hits={fvS.filter(hitExt).length} detail={`mid: ${pct(fvS.filter(hitMid).length, fvS.length)}`} />
          <Row label="FVG direction = first-touch side" n={fv.length} hits={fv.filter((d) => d.firstTouchSide === (d.fvg === "bull" ? "H" : "L")).length} detail="directional predictive power" />
          <Row label="NO FVG in IB (control) → single break" n={N - fv.length} hits={days.filter((d) => !d.fvg && d.singleBreak).length} detail="control group" />
        </Tbl>
      </Card>

      {/* 8 retest */}
      <Card accent="cyan" title="8 · Retest Continuation" subtitle="Returns to within 2 ticks of the broken level, close holds outside">
        <Tbl head={["Path", "Days", "Continues to new extreme", "Rate", "Avg MFE (× IB width)"]}
          footNote="If retest MFE ≥ no-retest MFE, waiting costs nothing and improves the entry. If it's materially lower, the best days never retest — take the break.">
          <Row label="Break → clean RETEST → continue" n={rt.length} hits={rt.filter((d) => d.firstCloseBreak!.retestCont).length}
            detail={`${f2(avg(rt.map((d) => d.firstCloseBreak!.rExt)))}×`} />
          <Row label="Break → NO retest (runs away)" n={noRt.length} hits={noRt.filter((d) => d.firstCloseBreak!.hit["1"]).length}
            detail={`${f2(avg(noRt.map((d) => d.firstCloseBreak!.rExt)))}× (hit = ≥1× ext)`} />
        </Tbl>
      </Card>

      {/* B — 0.25 fib pullback */}
      <Card accent="green" title="B · 0.25 Fib Pullback → Continuation" subtitle="Two readings of &quot;the 0.25 level&quot; — they are very different trades">
        <Tbl head={["Test", "Days", "Hit", "Rate", "Detail"]}
          footNote={`Variant A avg MFE measured <i>from the 0.25 entry</i>: <b>${f2(avg(fA.map((d) => d.firstCloseBreak!.fibA.mfe ?? 0)))}× IB width</b> · avg bars from break to pullback touch: <b>${f2(avg(fA.map((d) => d.firstCloseBreak!.fibA.barsToTouch ?? 0)))}</b> (×5 min). Watch the "no pullback" row — if the runaway days carry the fattest MFE, waiting for 0.25 filters you out of the best sessions.`}>
          {sectionRow("Variant A — 0.25 of the IB RANGE, measured back into the IB (high break → IBH − 0.25×width). A deep pullback that re-enters the IB.")}
          <Row label="Pullback REACHES the 0.25 level" n={fcb.length} hits={fA.length} detail="how often you even get filled" />
          <Row indent label="then CONTINUES to a new extreme" n={fA.length} hits={fA.filter((d) => d.firstCloseBreak!.fibA.cont).length} detail="the actual edge" />
          <Row indent label="instead runs through the IB MIDPOINT" n={fA.length} hits={fA.filter((d) => d.firstCloseBreak!.fibA.fail).length} detail="trade dies" />
          <Row label="NO pullback — price never comes back" n={fcb.length} hits={fAno.length}
            detail={`these run: avg MFE ${f2(avg(fAno.map((d) => d.firstCloseBreak!.rExt)))}× IB`} />
          {sectionRow("Variant B — 0.25 retrace of the post-break IMPULSE (break level → running extreme). A shallow pullback that stays outside the IB.")}
          <Row label="Pullback REACHES the 0.25 impulse retrace" n={fcb.length} hits={fB.length} detail="requires impulse > 0.25× IB first" />
          <Row indent label="then CONTINUES to a new extreme" n={fB.length} hits={fB.filter((d) => d.firstCloseBreak!.fibB.cont).length} detail="the actual edge" />
        </Tbl>
      </Card>

      {/* 9 extension targets */}
      <Card accent="orange" title="9 · Extension Targets" subtitle="Scale-out probabilities, measured from the broken level">
        <Tbl head={["Target", "Breaks", "Reached", "Hit rate", "Sizing"]}
          footNote={`Avg MFE on all close-breaks: <b>${f2(avg(fcb.map((d) => d.firstCloseBreak!.rExt)))}× IB width</b> · avg MAE (heat taken): <b>${f2(avg(fcb.map((d) => d.firstCloseBreak!.rAdv)))}× IB width</b>.`}>
          {[0.5, 1, 1.5, 2].map((t) => (
            <Row key={t} label={`${t}× IB width from break`} n={fcb.length}
              hits={fcb.filter((d) => d.firstCloseBreak!.hit[String(t)]).length}
              detail={`avg IB ${f2(avg(widths))} pts → target ≈ ${f2(t * (avg(widths) ?? 0))} pts`} />
          ))}
        </Tbl>
      </Card>

      {/* 10 close location */}
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

      {/* 11 open type */}
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

      {/* 12 ORB */}
      <Card accent="cyan" title="12 · ORB + IB Alignment" subtitle="09:30–09:45 opening range breaks the same way as the IB midpoint bias">
        <Tbl head={["Setup", "Days", "Bias side breaks first", "Rate", "Single-break rate"]}
          footNote="Aligned should beat conflicted on BOTH columns for this filter to earn its keep.">
          <Row label="ALIGNED (ORB dir = IB bias)" n={align.length} hits={align.filter((d) => d.firstTouchSide === d.bias).length}
            detail={pct(align.filter((d) => d.singleBreak).length, align.length)} />
          <Row label="CONFLICTED (ORB vs IB bias)" n={oppose.length} hits={oppose.filter((d) => d.firstTouchSide === d.bias).length}
            detail={pct(oppose.filter((d) => d.singleBreak).length, oppose.length)} />
        </Tbl>
      </Card>

      {/* 13 time filter */}
      <Card accent="orange" title="13 · Time Filter — when the break happens" subtitle="Hit = extension ≥ 1× IB width">
        <Tbl head={["Break window", "Breaks", "≥1× ext", "Rate", "Detail"]}
          footNote="Late breaks have less session left — expect decaying extension rates. If they don't decay, the break is time-agnostic.">
          {tf.map(([a, b, l]) => {
            const g = fcb.filter((d) => d.firstCloseBreak!.breakMin >= a && d.firstCloseBreak!.breakMin < b);
            return (
              <Row key={l} label={l} n={g.length} hits={g.filter((d) => d.firstCloseBreak!.hit["1"]).length}
                detail={`avg MFE ${f2(avg(g.map((d) => d.firstCloseBreak!.rExt)))}× · fail rate ${pct(g.filter((d) => d.firstCloseBreak!.failed).length, g.length)}`} />
            );
          })}
          <Row label="ALL breaks before noon" n={byNoon.length} hits={byNoon.filter((d) => d.firstCloseBreak!.hit["1"]).length} detail="the killzone cut" />
        </Tbl>
      </Card>

      {/* 14 contained */}
      <Card accent="red" title="14 · Contained Day (rare)" subtitle="Price still entirely inside the IB at 14:00 ET">
        <Tbl head={["Outcome", "Days", "Hit", "Rate", "Detail"]}>
          <Row label="Contained at 14:00" n={N} hits={cont.length} detail="base rate of the setup" />
          <Row indent label="STAYS inside through the close (fade works)" n={cont.length} hits={cont.filter((d) => !d.containedBrokeLate).length} detail="fade the extremes" />
          <Row indent label="BREAKS out late (fade gets run over)" n={cont.length} hits={cont.filter((d) => d.containedBrokeLate).length} detail="the tail risk" />
        </Tbl>
      </Card>
    </div>
  );
}
