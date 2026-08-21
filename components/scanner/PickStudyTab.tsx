"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Pick Study — what did the A and B cards have in common?
//
// Read-only viewer over /proxy/gex-change-top-study. Every GEX Change Top pick
// that has been graded is bucketed on ONE capture-time feature at a time, and
// the table reports the hit rate (A/B) per bucket.
//
// THREE THINGS THIS PAGE IS BUILT TO STOP YOU DOING:
//
//   1. Believing a thin bucket. Anything under the server's MIN_N is marked
//      "thin" and greyed. At ~15-30 picks a day a month is ~500 rows, and eight
//      features against 500 rows will hand you beautiful splits that are pure
//      noise.
//   2. Believing an in-sample split. Every bucket is ALSO computed on the first
//      and second half of the window separately (split by date, never mid-day).
//      A row only earns the ✓ hold marker when both halves point the same way
//      as the full window. Untricked, that column kills most findings.
//   3. Forgetting the control group. "Taken vs passed on" compares the top-5
//      picks against the shadow candidates the board had no room for. If those
//      two numbers match, the ranking is decorative and no amount of bucketing
//      inside the taken set will tell you that.
//
// The calibration block at the bottom grades the grader: for each letter the
// projection rule predicted AT CAPTURE, what did those picks actually do. It
// reads "not armed" until a rule exists in server-v2/config/pick-proj-rule.json.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, homeButtonStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { seg, th, td } from "@/components/scanner/scannerStyles";
import { SortTh, useTableSort } from "@/components/shared/useTableSort";

type Summary = {
  n: number;
  pctGood: number | null;
  pctNeverGreen: number | null;
  avgPts: number | null;
  medSustained: number | null;
};

type Bucket = Summary & {
  bucket: string;
  thin: boolean;
  lift: number | null;
  holds: boolean | null;
  firstHalf: Summary;
  secondHalf: Summary;
};

type StudyResp = {
  ok: boolean;
  error?: string;
  days: number;
  by: string;
  cohort: string;
  label: string;
  note: string;
  minN: number;
  splitDate: string | null;
  overall: Summary;
  cohorts: { selected: Summary; shadow: Summary } | null;
  features: { key: string; label: string }[];
  buckets: Bucket[];
};

type CalRow = Summary & { projected: string; actual: Record<string, number>; thin: boolean };
type CalResp = {
  ok: boolean; error?: string; armed: boolean; days: number; note?: string;
  terms?: { by: string; bucket: string; pts: number }[];
  base?: number; minN?: number; unprojected?: number;
  overall?: Summary; rows?: CalRow[]; n?: number;
};

const tint = (hex: string, a: number): string => {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

const MONO = "var(--font-mono)";
const GRADES = ["A+", "A", "B", "C", "D", "F"];

const pct = (v: number | null | undefined, dp = 0): string =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(dp)}%`;
const signed = (v: number | null | undefined, dp = 0): string =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(dp)}`;

/** Green above the line, red below — the only thing a lift column has to say. */
const liftColor = (v: number | null): string =>
  v == null ? HOME_THEME.text : v >= 8 ? HOME_THEME.green : v <= -8 ? HOME_THEME.red : HOME_THEME.text;

const DAY_OPTS = [14, 30, 60, 90, 180];
const COHORTS: { key: string; label: string; hint: string }[] = [
  { key: "selected", label: "Taken", hint: "The picks that made the board — what the cards actually showed." },
  { key: "shadow", label: "Passed on", hint: "Candidates that qualified and cleared the entry floor but ranked below the top 5. The control group." },
  { key: "all", label: "Both", hint: "Taken and passed-on together — the widest sample, and the least conditioned on selection." },
];

/** A small hit-rate bar; width is the value, so a column of them reads at a glance. */
function RateBar({ v }: { v: number | null }) {
  if (v == null) return <span style={{ color: HOME_THEME.text }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 96 }}>
      <span style={{ position: "relative", width: 52, height: 6, borderRadius: 3, background: tint(HOME_THEME.text, 0.10) }}>
        <span style={{
          position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 3,
          width: `${Math.max(0, Math.min(100, v))}%`, background: HOME_THEME.cyan,
        }} />
      </span>
      <span style={{ fontFamily: MONO, fontWeight: 700 }}>{pct(v)}</span>
    </span>
  );
}

/** Sortable columns of the bucket table. */
type BucketSortKey =
  | "bucket" | "n" | "pctGood" | "lift" | "holds" | "neverGreen" | "avgPts" | "medSustained";

/** Sortable columns of the calibration table (grades are `g:<letter>`). */
type CalSortKey = "projected" | "n" | "pctGood" | "neverGreen" | "avgPts" | `g:${string}`;

const bucketSortValue = (b: Bucket, k: BucketSortKey) => {
  switch (k) {
    case "bucket": return b.bucket;
    case "n": return b.n;
    case "pctGood": return b.pctGood;
    case "lift": return b.lift;
    // Sorts ✓ above ✗ above —, which is the order you actually scan for.
    case "holds": return b.holds == null ? null : b.holds ? 1 : 0;
    case "neverGreen": return b.pctNeverGreen;
    case "avgPts": return b.avgPts;
    case "medSustained": return b.medSustained;
    default: return null;
  }
};

const calSortValue = (r: CalRow, k: CalSortKey) => {
  if (k.startsWith("g:")) return r.actual?.[k.slice(2)] ?? 0;
  switch (k) {
    // By grade rank, not alphabetically — "A+" must not land between "A" and "B".
    case "projected": return GRADES.indexOf(r.projected) < 0 ? 99 : GRADES.indexOf(r.projected);
    case "n": return r.n;
    case "pctGood": return r.pctGood;
    case "neverGreen": return r.pctNeverGreen;
    case "avgPts": return r.avgPts;
    default: return null;
  }
};

export default function PickStudyTab() {
  const [by, setBy] = useState("score");
  const [days, setDays] = useState(60);
  const [cohort, setCohort] = useState("selected");
  const [data, setData] = useState<StudyResp | null>(null);
  const [cal, setCal] = useState<CalResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Click a column title to sort; click again to flip; a third click puts the
  // rows back in the order the server sent them (which is meaningful here — the
  // buckets arrive in the feature's own order, and grades arrive ranked).
  const bucketSort = useTableSort<BucketSortKey>();
  const calSort = useTableSort<CalSortKey>();

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    const u = new URL("/proxy/gex-change-top-study", window.location.origin);
    u.searchParams.set("days", String(days));
    u.searchParams.set("by", by);
    u.searchParams.set("cohort", cohort);
    fetch(u.toString(), { cache: "no-store" })
      .then((r) => r.json())
      .then((j: StudyResp) => { if (!j?.ok) { setErr(j?.error || "load failed"); setData(null); } else setData(j); })
      .catch((e) => setErr(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, [by, days, cohort]);

  const loadCal = useCallback(() => {
    const u = new URL("/proxy/gex-change-top-calibration", window.location.origin);
    u.searchParams.set("days", String(days));
    u.searchParams.set("cohort", cohort);
    fetch(u.toString(), { cache: "no-store" })
      .then((r) => r.json())
      .then((j: CalResp) => setCal(j?.ok ? j : null))
      .catch(() => setCal(null));
  }, [days, cohort]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCal(); }, [loadCal]);

  const features = data?.features ?? [{ key: "score", label: "Score" }];
  const overall = data?.overall;

  /** A bucket, as a paste-ready projection-rule term. */
  const copyTerm = (b: Bucket) => {
    const term = { by: data?.by ?? by, bucket: b.bucket, pts: Math.round(b.lift ?? 0) };
    const text = JSON.stringify(term);
    navigator.clipboard?.writeText(text).then(
      () => { setCopied(b.bucket); setTimeout(() => setCopied(null), 1600); },
      () => { /* clipboard blocked — the table still shows the numbers */ },
    );
  };

  const cohortNote = COHORTS.find((c) => c.key === cohort)?.hint ?? "";

  // The control-group comparison, stated as a single sentence rather than left
  // for the reader to compute from two cells.
  const verdict = useMemo(() => {
    const c = data?.cohorts;
    if (!c || c.selected.pctGood == null || c.shadow.pctGood == null) return null;
    if (c.shadow.n < (data?.minN ?? 30)) {
      return { tone: HOME_THEME.text, text: `Only ${c.shadow.n} passed-on pick(s) recorded so far — the control group needs ${data?.minN ?? 30}+ before this comparison means anything. It starts filling from the deploy that turned shadow recording on.` };
    }
    const d = c.selected.pctGood - c.shadow.pctGood;
    if (Math.abs(d) < 5) {
      return { tone: HOME_THEME.orange, text: `Taken picks hit ${pct(c.selected.pctGood)} vs ${pct(c.shadow.pctGood)} for the ones passed on — a ${signed(d)}pt gap. That is inside the noise: on this sample the top-5 cut is not doing measurable work.` };
    }
    if (d > 0) {
      return { tone: HOME_THEME.green, text: `Taken picks hit ${pct(c.selected.pctGood)} vs ${pct(c.shadow.pctGood)} passed on — ${signed(d)}pts. The ranking is selecting something real.` };
    }
    return { tone: HOME_THEME.red, text: `Taken picks hit ${pct(c.selected.pctGood)} vs ${pct(c.shadow.pctGood)} for the ones passed on — ${signed(d)}pts. The picks you skipped did BETTER. Check the ranking before tuning anything else.` };
  }, [data]);

  return (
    <Card
      variant="budget"
      title={<span style={{ fontSize: 17 }}>Pick Study</span>}
      subtitle={`What the graded picks had in common at capture · ${days}d window${loading ? " · loading…" : ""}`}
    >
      {/* ── controls ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        {features.map((f) => (
          <button key={f.key} onClick={() => setBy(f.key)} style={seg(by === f.key)}>{f.label}</button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {DAY_OPTS.map((d) => (
          <button key={d} onClick={() => setDays(d)} style={seg(days === d)}>{d}d</button>
        ))}
        <span style={{ width: 10 }} />
        {COHORTS.map((c) => (
          <button key={c.key} onClick={() => setCohort(c.key)} title={c.hint} style={seg(cohort === c.key)}>{c.label}</button>
        ))}
        <button onClick={() => { load(); loadCal(); }} style={{ ...homeButtonStyle, padding: "6px 12px", fontSize: 13 }}>↻</button>
      </div>

      {err && <div style={{ color: HOME_THEME.red, fontSize: 13, padding: "8px 0" }}>Error: {err}</div>}

      {data && (
        <>
          {/* ── headline ─────────────────────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: HOME_THEME.text }}>
              <b style={{ fontFamily: MONO, color: HOME_THEME.cyan }}>{overall?.n ?? 0}</b> graded pick{overall?.n === 1 ? "" : "s"}
            </span>
            <span style={{ fontSize: 13, color: HOME_THEME.text }}>
              A/B rate <b style={{ fontFamily: MONO, color: HOME_THEME.green }}>{pct(overall?.pctGood)}</b>
            </span>
            <span style={{ fontSize: 13, color: HOME_THEME.text }}>
              never green <b style={{ fontFamily: MONO, color: HOME_THEME.red }}>{pct(overall?.pctNeverGreen)}</b>
            </span>
            <span style={{ fontSize: 13, color: HOME_THEME.text }}>
              avg <b style={{ fontFamily: MONO }}>{overall?.avgPts == null ? "—" : `${overall.avgPts.toFixed(0)}/100`}</b>
            </span>
          </div>
          <div style={{ fontSize: 12, color: HOME_THEME.text, marginBottom: 14 }}>{cohortNote}</div>

          {/* ── the control-group verdict ─────────────────────────────────────── */}
          {verdict && (
            <div style={{
              fontSize: 13, lineHeight: 1.5, padding: "8px 12px", borderRadius: 8, marginBottom: 16,
              color: verdict.tone, background: tint(verdict.tone, 0.08),
              border: `1px solid ${tint(verdict.tone, 0.3)}`,
            }}>
              <b>Taken vs passed on · </b>{verdict.text}
            </div>
          )}

          {/* ── the bucket table ─────────────────────────────────────────────── */}
          <div style={{ fontSize: 14, fontWeight: 800, color: HOME_THEME.orange, marginBottom: 2 }}>{data.label}</div>
          <div style={{ fontSize: 12, color: HOME_THEME.text, marginBottom: 10, maxWidth: 780, lineHeight: 1.5 }}>{data.note}</div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: HOME_THEME.green, textTransform: "uppercase", fontSize: 11 }}>
                  <SortTh sort={bucketSort} sortKey="bucket" style={{ ...th, textAlign: "left" }}>Bucket</SortTh>
                  <SortTh sort={bucketSort} sortKey="n" style={th}>n</SortTh>
                  <SortTh sort={bucketSort} sortKey="pctGood" style={{ ...th, textAlign: "left" }}>A/B rate</SortTh>
                  <SortTh sort={bucketSort} sortKey="lift" style={th} title="Hit rate minus the window's overall hit rate. This is the number that matters.">Lift</SortTh>
                  <SortTh sort={bucketSort} sortKey="holds" style={th} title="Does the split point the same way in BOTH halves of the window? A ✗ means it did not survive out of sample.">Holds</SortTh>
                  <SortTh sort={bucketSort} sortKey="neverGreen" style={th}>Never green</SortTh>
                  <SortTh sort={bucketSort} sortKey="avgPts" style={th}>Avg pts</SortTh>
                  <SortTh sort={bucketSort} sortKey="medSustained" style={th} title="Median best gain that held for two consecutive snapshots — a fillable move, not a one-print spike.">Med. sustained</SortTh>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {data.buckets.length === 0 && (
                  <tr><td colSpan={9} style={{ ...td, textAlign: "left", color: HOME_THEME.text, padding: "14px 8px" }}>
                    No graded picks in this window yet.
                  </td></tr>
                )}
                {bucketSort.apply(data.buckets, bucketSortValue).map((b) => (
                  <tr key={b.bucket} style={{
                    borderTop: `1px solid ${tint(HOME_THEME.text, 0.06)}`,
                    opacity: b.thin ? 0.45 : 1,
                  }}>
                    <td style={{ ...td, textAlign: "left", fontWeight: 800, fontFamily: MONO }}>
                      {b.bucket}
                      {b.thin && (
                        <span title={`Only ${b.n} pick(s) — under the ${data.minN} minimum. Not a finding yet.`}
                          style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: HOME_THEME.orange }}>thin</span>
                      )}
                    </td>
                    <td style={{ ...td, fontFamily: MONO }}>{b.n}</td>
                    <td style={{ ...td, textAlign: "left" }}><RateBar v={b.pctGood} /></td>
                    <td style={{ ...td, fontFamily: MONO, fontWeight: 800, color: liftColor(b.lift) }}>
                      {b.lift == null ? "—" : `${signed(b.lift)}pt`}
                    </td>
                    <td style={{ ...td, fontFamily: MONO }}
                      title={`First half ${pct(b.firstHalf.pctGood)} (n=${b.firstHalf.n}) · second half ${pct(b.secondHalf.pctGood)} (n=${b.secondHalf.n})`}>
                      {b.holds == null ? "—" : b.holds
                        ? <span style={{ color: HOME_THEME.green }}>✓</span>
                        : <span style={{ color: HOME_THEME.red }}>✗</span>}
                    </td>
                    <td style={{ ...td, fontFamily: MONO, color: (b.pctNeverGreen ?? 0) > (overall?.pctNeverGreen ?? 0) ? HOME_THEME.red : HOME_THEME.text }}>
                      {pct(b.pctNeverGreen)}
                    </td>
                    <td style={{ ...td, fontFamily: MONO }}>{b.avgPts == null ? "—" : b.avgPts.toFixed(0)}</td>
                    <td style={{ ...td, fontFamily: MONO }}>{b.medSustained == null ? "—" : `${signed(b.medSustained)}%`}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <button
                        onClick={() => copyTerm(b)}
                        title={'Copy this bucket as a projection-rule term for server-v2/config/pick-proj-rule.json.\nThe SIGN is what the data supports; the magnitude (lift used directly as points) is a convention you should sanity-check.'}
                        style={{
                          ...homeButtonStyle, padding: "2px 8px", fontSize: 11,
                          color: copied === b.bucket ? HOME_THEME.green : HOME_THEME.text,
                          borderColor: copied === b.bucket ? tint(HOME_THEME.green, 0.5) : HOME_THEME.border,
                        }}
                      >
                        {copied === b.bucket ? "✓ copied" : "⧉ term"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 8, fontSize: 11, color: HOME_THEME.text, lineHeight: 1.6, maxWidth: 860 }}>
            Features come from the slot each pick was <b>first</b> flagged — the only source that cannot see the outcome.
            Lift is this bucket&apos;s A/B rate minus the window&apos;s. <b>Holds</b> recomputes the split on each half of the
            window separately (split at {data.splitDate ?? "—"}, by date so no session lands on both sides); a ✗ means it did
            not survive out of sample and is not a finding. Buckets under n={data.minN} are greyed.
          </div>
        </>
      )}

      {/* ── calibration ─────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 26, paddingTop: 16, borderTop: `1px solid ${tint(HOME_THEME.text, 0.10)}` }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: HOME_THEME.orange, marginBottom: 6 }}>
          Calibration · grading the grader
        </div>
        {!cal || !cal.armed ? (
          <div style={{ fontSize: 12, color: HOME_THEME.text, lineHeight: 1.6, maxWidth: 820 }}>
            No projection rule is armed, so nothing is being predicted yet and there is nothing to calibrate.
            That is the shipping default and it is deliberate — a projection seeded with plausible-looking guesses
            is indistinguishable on screen from one backed by evidence.
            <br /><br />
            To arm it: find buckets above that are <b>not thin</b> and <b>hold</b> in both halves, hit <b>⧉ term</b> on each,
            and drop them into <code style={{ fontFamily: MONO, color: HOME_THEME.cyan }}>server-v2/config/pick-proj-rule.json</code> as{" "}
            <code style={{ fontFamily: MONO }}>{'{ "enabled": true, "base": 50, "terms": [ … ] }'}</code>.
            From the next capture on, every pick is stamped with a projected grade and this table starts filling.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: HOME_THEME.text, marginBottom: 10 }}>
              Rule: base {cal.base} · {cal.terms?.length ?? 0} term(s){cal.note ? ` · ${cal.note}` : ""}
              {cal.unprojected ? ` · ${cal.unprojected} pick(s) captured before the rule was armed are excluded` : ""}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: HOME_THEME.green, textTransform: "uppercase", fontSize: 11 }}>
                    <SortTh sort={calSort} sortKey="projected" style={{ ...th, textAlign: "left" }}>Predicted</SortTh>
                    <SortTh sort={calSort} sortKey="n" style={th}>n</SortTh>
                    <SortTh sort={calSort} sortKey="pctGood" style={{ ...th, textAlign: "left" }}>Actual A/B</SortTh>
                    <SortTh sort={calSort} sortKey="neverGreen" style={th}>Never green</SortTh>
                    <SortTh sort={calSort} sortKey="avgPts" style={th}>Avg pts</SortTh>
                    {GRADES.map((g) => (
                      <SortTh key={g} sort={calSort} sortKey={`g:${g}`} style={th}
                        title={`How many of these picks actually graded ${g}.`}>{g}</SortTh>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calSort.apply(cal.rows ?? [], calSortValue).map((r) => (
                    <tr key={r.projected} style={{ borderTop: `1px solid ${tint(HOME_THEME.text, 0.06)}`, opacity: r.thin ? 0.45 : 1 }}>
                      <td style={{ ...td, textAlign: "left", fontWeight: 800, fontFamily: MONO }}>{r.projected}</td>
                      <td style={{ ...td, fontFamily: MONO }}>{r.n}</td>
                      <td style={{ ...td, textAlign: "left" }}><RateBar v={r.pctGood} /></td>
                      <td style={{ ...td, fontFamily: MONO, color: HOME_THEME.red }}>{pct(r.pctNeverGreen)}</td>
                      <td style={{ ...td, fontFamily: MONO }}>{r.avgPts == null ? "—" : r.avgPts.toFixed(0)}</td>
                      {GRADES.map((g) => (
                        <td key={g} style={{ ...td, fontFamily: MONO, color: r.actual?.[g] ? HOME_THEME.text : tint(HOME_THEME.text, 0.3) }}>
                          {r.actual?.[g] ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {(cal.rows ?? []).length === 0 && (
                    <tr><td colSpan={10} style={{ ...td, textAlign: "left", color: HOME_THEME.text, padding: "12px 8px" }}>
                      Rule is armed but no picks carry a projection yet — they start appearing at the next capture.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: HOME_THEME.text, lineHeight: 1.6, maxWidth: 860 }}>
              Read down the Predicted column: the A/B rate should rise monotonically from F to A+. If it does not, the rule
              is not ranking. Projections are stamped at capture and never recomputed, so retuning the rule leaves the old
              predictions intact — which is what makes this table a real out-of-sample test rather than a restatement.
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
