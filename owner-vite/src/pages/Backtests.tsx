// Owner "Backtests" page — re-runnable edge studies. Port of
// app/owner/backtests/page.tsx. Each card hits GET /api/backtests?test=…
// (owner-gated, read-only) and renders the returned tables.

import { useState, type CSSProperties, type ReactNode } from "react";
import { HOME_THEME, homeButtonStyle, homeInputStyle } from "../lib/theme";
import { PageShell, Card } from "../components/PageCard";
import { ThemedSelect } from "../components/ThemedSelect";

const LIGHT_BLUE = "#7dd3fc";
const SOFT_RED = HOME_THEME.red;

type FieldType = "number" | "select" | "checkbox" | "text";
type Field = { key: string; label: string; type: FieldType; def: string | number | boolean; options?: string[] };

const th: CSSProperties = { textAlign: "left", padding: "7px 10px", fontSize: 14, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.55, borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "7px 10px", fontSize: 14, color: HOME_THEME.text, borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap" };

function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows?.length) return null;
  const cols = Array.from(rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set<string>()));
  return (
    <div style={{ overflowX: "auto", marginTop: 10 }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr>{cols.map((c) => <th key={c} style={th}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{cols.map((c) => {
              const v = r[c];
              const s = String(v ?? "");
              const numeric = typeof v === "number" ? v : NaN;
              const positive = s === "REJECT" || s === "held" || s === "yes";
              const negative = s === "broke" || s === "no" || (Number.isFinite(numeric) && numeric < 0);
              return <td key={c} style={{ ...td, color: positive ? LIGHT_BLUE : negative ? HOME_THEME.red : HOME_THEME.text }}>{s}</td>;
            })}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Panel({ title, subtitle, test, fields, help }: { title: string; subtitle: string; test: string; fields: Field[]; help?: ReactNode }) {
  const [params, setParams] = useState<Record<string, string | number | boolean>>(
    Object.fromEntries(fields.map((f) => [f.key, f.def])),
  );
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  async function run() {
    setLoading(true); setErr(null);
    try {
      const qs = new URLSearchParams({ test });
      for (const f of fields) {
        const v = params[f.key];
        if (f.type === "checkbox") { if (v) qs.set(f.key, "1"); }
        else qs.set(f.key, String(v));
      }
      const res = await fetch(`/api/backtests?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }

  const sections = data ? Object.entries(data).filter(([k, v]) => Array.isArray(v) && v.length && typeof v[0] === "object" && k !== "detail") : [];
  const detail = data && Array.isArray(data.detail) ? (data.detail as Record<string, unknown>[]) : null;

  return (
    <Card variant="budget" accent={LIGHT_BLUE} title={title} subtitle={subtitle}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        {fields.map((f) => (
          <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.6 }}>
            {f.label}
            {f.type === "select" ? (
              <ThemedSelect
                width={120}
                ariaLabel={f.label}
                value={String(params[f.key])}
                options={f.options!.map((o) => ({ value: o, label: o.toUpperCase() }))}
                onChange={(v) => setParams((p) => ({ ...p, [f.key]: v }))}
              />
            ) : f.type === "checkbox" ? (
              <input type="checkbox" checked={!!params[f.key]} onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.checked }))} style={{ width: 18, height: 18, accentColor: HOME_THEME.cyan }} />
            ) : f.type === "text" ? (
              <input type="text" style={{ ...homeInputStyle, width: 120 }} value={String(params[f.key])} onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))} />
            ) : (
              <input type="number" style={{ ...homeInputStyle, width: 90 }} value={String(params[f.key])} onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))} />
            )}
          </label>
        ))}
        <button style={{ ...homeButtonStyle, padding: "8px 18px", opacity: loading ? 0.6 : 1 }} onClick={run} disabled={loading}>
          {loading ? "Running…" : "Run"}
        </button>
      </div>

      {err && <div style={{ marginTop: 12, fontSize: 14, color: SOFT_RED }}>Error: {err}</div>}
      {data && (
        <div style={{ marginTop: 14 }}>
          {typeof data.note === "string" && <div style={{ fontSize: 14, color: LIGHT_BLUE, marginBottom: 8, lineHeight: 1.5 }}>{data.note}</div>}
          {sections.map(([k, v]) => (
            <div key={k} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE }}>{k}</div>
              <DataTable rows={v as Record<string, unknown>[]} />
            </div>
          ))}
          {detail && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: "pointer", fontSize: 14, color: LIGHT_BLUE }}>Per-day detail ({detail.length})</summary>
              <DataTable rows={detail} />
            </details>
          )}
        </div>
      )}

      {help && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${HOME_THEME.border}`, fontSize: 13.5, color: HOME_THEME.muted, lineHeight: 1.65 }}>
          {help}
        </div>
      )}
    </Card>
  );
}

export default function Backtests() {
  return (
    <PageShell>
      <Card variant="budget" accent={LIGHT_BLUE} title="Backtests" subtitle="Re-runnable edge studies over the live Postgres data. Owner-only.">
        <p style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.6, margin: 0 }}>
          Each panel runs server-side against the same tables the dashboard writes. Adjust the inputs and hit Run.
          Samples are still small — treat results as directional. Expand “Per-day detail” to see the underlying rows.
        </p>
      </Card>

      <Panel
        title="CB size → reach" test="cb-size"
        subtitle="Does a bigger CB level get touched / held more often?"
        fields={[{ key: "tol", label: "strike tol (pt)", type: "number", def: 10 }]}
      />

      <Panel
        title="Confidence calibration" test="confidence"
        subtitle="Predicted reach / hold / break vs what actually happened."
        fields={[]}
      />

      <Panel
        title="Normalized GEX per strike" test="normalized-gex"
        subtitle="Live chain: |strike net GEX| / Σ|net GEX| × 100 for one ticker + expiration."
        fields={[
          { key: "ticker", label: "ticker", type: "text", def: "SPX" },
          { key: "expiration", label: "expiration (YYYY-MM-DD)", type: "text", def: "" },
        ]}
      />

      <Panel
        title="GEX change — by ticker" test="gex-change-summary"
        subtitle="Consolidates the very-strong GEX-change board into one row per ticker for a session."
        fields={[{ key: "date", label: "date (blank = latest)", type: "text", def: "" }]}
        help={
          <>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, marginBottom: 8 }}>How to read this</div>
            <p style={{ margin: "0 0 8px" }}>
              The recorder keeps the top-N “very strong” strikes every 30 minutes. One ticker shows up many
              times across slots and strikes — this collapses that into one row each.
            </p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>$M abs</strong> — total |Δ GEX| flagged for the day. Rank on this, not on the raw hit count.</p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>call %</strong> — share of that on the call / above-spot side. ≥70 reads as resistance building, ≤30 as support or downside protection, in between is two-sided.</p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>slots</strong> — distinct 30m windows it appeared in. High slots + high $M abs = persistent build; a single slot is a one-off and usually noise.</p>
            <p style={{ margin: "0 0 10px" }}><strong style={{ color: LIGHT_BLUE }}>expiries / near exp</strong> — everything sitting on one short-dated expiry means event positioning, not a standing level.</p>
            <p style={{ margin: "0 0 6px" }}>
              Expand <strong>Per-day detail</strong> for the per-strike breakdown. <strong>concentration %</strong> there is the single
              largest hit as a share of that strike's total — above ~60% means one print is carrying it rather than distributed stacking.
            </p>
            <p style={{ margin: "6px 0 0", color: HOME_THEME.text }}>
              If the note warns the board is saturated, every slot hit the top-N cap and these totals are a floor, not the full picture.
            </p>
          </>
        }
      />

      <Card variant="budget" accent={LIGHT_BLUE} title="Strike GEX → move" subtitle="One report you read every day, and four panels that exist to prove the report means something.">
        <p style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.65, margin: "0 0 10px" }}>
          <strong style={{ color: LIGHT_BLUE }}>Panel ① is the thing.</strong> It scans every ticker for strikes
          growing more than that ticker normally grows and prints one line per alert, each carrying the historical
          odds for its band. On a normal day that is all you read.
        </p>
        <p style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.65, margin: "0 0 10px" }}>
          Panels ②–⑤ are the calibration. They answer, in order: when price moved, had a strike grown first
          (<strong>pre-move</strong>)? At what % growth do the odds actually shift (<strong>threshold</strong>)? How
          often does a big build lead nowhere (<strong>false alarms</strong>)? And what did a flagged day actually
          look like, strike by strike (<strong>timeline</strong>)? Run them when you want to change the feed's
          settings or stop trusting it — not every morning.
        </p>
        <p style={{ fontSize: 13.5, color: HOME_THEME.muted, lineHeight: 1.6, margin: 0 }}>
          Every panel returns a <strong>coverage</strong> table — the 20 thinnest symbols in{" "}
          <code>eod_strike_gex</code> for your filter, thinnest first, with days-stale. Check it before believing
          anything. A symbol with a handful of sessions on file, or big holes between them, cannot produce a study,
          and the panels say <em>SAMPLE TOO SMALL TO READ</em> rather than dress up four data points as a finding.
        </p>
      </Card>


      <Panel
        title="① THE FEED — what's growing more than normal, right now" test="strike-gex-watch"
        subtitle="Scans every ticker's latest session for strikes growing more than that ticker normally grows. One line per alert, each carrying its own historical hit rate."
        fields={[
          { key: "minZ", label: "min ×normal", type: "number", def: 1.5 },
          { key: "ticker", label: "ticker (blank = all)", type: "text", def: "" },
          { key: "days", label: "history (days)", type: "number", def: 180 },
          { key: "hitSigma", label: "big move (σ)", type: "number", def: 1 },
        ]}
        help={
          <>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, marginBottom: 8 }}>This is the daily report — the rest of the page is how it got calibrated</div>
            <p style={{ margin: "0 0 8px" }}>
              Read <strong>feed</strong> and nothing else on a normal day. Each line is one alert:
            </p>
            <p style={{ margin: "0 0 10px", padding: "8px 10px", background: "rgba(125,211,252,0.07)", borderLeft: `2px solid ${LIGHT_BLUE}`, fontSize: 13, lineHeight: 1.55, color: HOME_THEME.text }}>
              MU 2000 strike — GEX grew +187%, way above normal (3.4× typical). $4.2M → $12.1M, 3.1% vs spot,
              call side. History: 51% big-move next session (1.8× base, n=64).
            </p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>×normal</strong> — the whole idea. It's that strike's dollar change divided by the trailing average of <em>that ticker's own biggest daily strike move</em>. So <strong>1.0× is an ordinary day's hottest strike</strong> and 3× is three times that. A $40M build is enormous for a mid-cap and a rounding error for SPX; this is what puts them on one scale, and it's why a plain dollar cutoff would just rank the report by market cap.</p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>History:</strong> on each line — what happened the last n times <em>anything</em> hit that band. That's the part that makes an alert worth acting on rather than just interesting. If it says “not enough past events,” the flag is untested, not proven.</p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>by_symbol</strong> — the watchlist proper: one row per ticker, its hottest strike. Five strikes lighting up on MU is one thing to watch, not five.</p>
            <p style={{ margin: "0 0 10px" }}><strong style={{ color: LIGHT_BLUE }}>odds</strong> — the backtest behind the feed, over your whole history window. The note names the band that earned its keep (lift ≥1.3 on real n) or says none did. Watch <strong>per yr</strong> next to <strong>lift</strong>: a 3× lift firing twice a year is a curiosity.</p>
            <p style={{ margin: "0 0 6px", color: HOME_THEME.text }}>
              <strong style={{ color: SOFT_RED }}>Not live.</strong> <code>eod_strike_gex</code> is written once daily
              after the close, so this is the last <em>recorded</em> session per symbol and every line over 3 days old
              is marked stale. A recorder that quietly stopped looks exactly like a quiet market here — that's what the
              coverage table is for.
            </p>
            <p style={{ margin: "6px 0 0" }}>
              An empty feed is a real answer, not a failure — most days nothing clears the bar. Drop{" "}
              <strong>min ×normal</strong> to about 1.0 to see the near-misses.
            </p>
          </>
        }
      />

      <Panel
        title="② Pre-move — did a strike grow before the move?" test="strike-gex-premove"
        subtitle="Move-anchored: starts from every significant move and looks back for the strike that grew most."
        fields={[
          { key: "ticker", label: "ticker (blank = all)", type: "text", def: "" },
          { key: "days", label: "lookback (days)", type: "number", def: 180 },
          { key: "hitSigma", label: "move size (σ)", type: "number", def: 1.5 },
          { key: "lead", label: "look back (sessions)", type: "number", def: 3 },
        ]}
        help={
          <>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, marginBottom: 8 }}>The two summary rows are the whole answer</div>
            <p style={{ margin: "0 0 8px" }}>
              For every session it finds the biggest %-grower among the strikes over the previous few sessions.
              Then it splits those sessions into ones that <strong>moved</strong> and ones that <strong>didn't</strong>,
              and shows the same statistics for both.
            </p>
            <p style={{ margin: "0 0 8px", color: HOME_THEME.text }}>
              <strong style={{ color: SOFT_RED }}>Compare the rows, never read one alone.</strong> “9 of 12 moves had
              a strike grow over 100% first” sounds like a finding and is worth nothing — if 200 quiet days also had
              one, the build tells you nothing about tomorrow. That is exactly why the quiet row is there.
            </p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>med / p75 |Δ%|</strong> — how much the top strike grew, in percent. This is the number you'd watch live.</p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>≥50 / ≥100 / ≥200% grew</strong> — share of days in that group where the build cleared each bar. If “≥100% grew” is 60% on move days and 55% on quiet days, that's noise, not an edge.</p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>med lead</strong> — how many sessions before the move the build landed. <strong>lead_profile</strong> breaks that out session by session, so you can see whether the signal is same-day-ish or has real warning time.</p>
            <p style={{ margin: "0 0 10px" }}><strong style={{ color: LIGHT_BLUE }}>above spot %</strong> — where the growing strike sat. Heavily above-spot on down moves would be an interesting asymmetry; near 50/50 means direction isn't in the signal.</p>
            <p style={{ margin: "0 0 6px" }}>
              <strong>move size (σ)</strong> is in multiples of that ticker's own normal day, so a 2% day in a small
              cap and a 2% day in SPX aren't treated as the same event. 1.5σ is roughly a “that was a real move” day.
            </p>
            <p style={{ margin: "6px 0 0" }}>
              No lookahead: a strike's Δ on session <em>i−1</em> is known at that close, and the move is measured on
              session <em>i</em>. The window is strictly before the move.
            </p>
          </>
        }
      />

      <Panel
        title="③ Trigger threshold — what % growth actually matters?" test="strike-gex-threshold"
        subtitle="Buckets sessions by the raw % growth of the top strike and reports where the odds shift."
        fields={[
          { key: "ticker", label: "ticker (blank = all)", type: "text", def: "" },
          { key: "days", label: "lookback (days)", type: "number", def: 180 },
          { key: "hitSigma", label: "big move (σ)", type: "number", def: 1 },
          { key: "minBase", label: "min base $", type: "number", def: 1000000 },
        ]}
        help={
          <>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, marginBottom: 8 }}>This is the panel that gives you a number</div>
            <p style={{ margin: "0 0 8px" }}>
              Walk the <strong>thresholds</strong> table from the top. Each row is a band of % growth; the question is
              where <strong>lift</strong> first climbs meaningfully above 1 <em>and stays there</em> on decent n. The
              note names that band outright as the TRIGGER, or says no band earned one.
            </p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>lift</strong> — that band's big-move rate ÷ the ALL baseline. 1.0 is “no different from any random day.” Below 1.3 isn't worth acting on.</p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>per yr</strong> — how often the band fires. <strong>Read this next to lift, always.</strong> A 3× lift that triggers twice a year is a curiosity; a 1.5× lift that fires weekly is a tool.</p>
            <p style={{ margin: "0 0 10px" }}><strong style={{ color: LIGHT_BLUE }}>min base $</strong> — a strike only gets a % at all if it already held this much gamma. This is what makes percent usable: without a floor, a strike going from $12K to $900K is a “+7,400%” that means nothing. Lower it and you'll get more rows and worse ones.</p>
            <p style={{ margin: "0 0 6px" }}>
              <strong>by_side</strong> splits the ≥100% builds by call/put and above/below spot. If one side carries all
              the lift, that's a sharper rule than the pooled number — and if they're all the same, the side doesn't matter.
            </p>
            <p style={{ margin: "6px 0 0", color: HOME_THEME.text }}>
              A band with too few events is suppressed rather than shown, and the note lists what got dropped. A single
              event reading “100%, lift 2×” is a coin landing heads, and it looks exactly like a discovery.
            </p>
          </>
        }
      />

      <Panel
        title="④ False alarms — how often does a big build lead nowhere?" test="strike-gex-move"
        subtitle="Build-anchored: starts from the biggest dollar-gamma builds and looks forward 1 / 3 / 5 sessions."
        fields={[
          { key: "ticker", label: "ticker (blank = all)", type: "text", def: "" },
          { key: "days", label: "lookback (days)", type: "number", def: 180 },
          { key: "win", label: "trailing win", type: "number", def: 20 },
          { key: "hitSigma", label: "big move (σ)", type: "number", def: 1 },
        ]}
        help={
          <>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, marginBottom: 8 }}>The other direction, on purpose</div>
            <p style={{ margin: "0 0 8px" }}>
              Panel 1 asks “when it moved, had something built?” This asks the reverse: “when something built, did it
              move?” You need both. A signal that appears before every move but also before every quiet day is not a signal.
            </p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>z</strong> — this panel ranks on <em>dollars</em>, not percent: (the day's biggest |Δ$ gamma| − that ticker's trailing mean) ÷ its trailing stdev. Dollar builds and percent builds are different animals — a huge percent move on a small strike is not a huge dollar build — and it's worth seeing whether both point the same way.</p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>buckets</strong> — compare each z band's “big move %” to the ALL row. If the extreme band doesn't beat baseline, there's no edge at this horizon.</p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>conc %</strong> (detail) — the top strike's share of the day's total |Δ|. High means one strike carried it; low means the whole ladder shifted and “top strike” is arbitrary.</p>
            <p style={{ margin: "0 0 10px" }}><strong style={{ color: LIGHT_BLUE }}>lift</strong> (by ticker) — which names respond and which don't. Tickers without enough strong events are hidden rather than shown at n=2.</p>
            <p style={{ margin: "6px 0 0", color: HOME_THEME.text }}>
              Audit check you can run on any result: the baseline <strong>up %</strong> should sit near 50. Markets rise
              about half the time; if it comes back at 70 or 30, the forward join is broken and nothing else on the page
              can be trusted.
            </p>
          </>
        }
      />

      <Panel
        title="⑤ Per-strike timeline — the raw series" test="strike-gex-timeline"
        subtitle="One ticker, day by day: what each strike held, what it changed by in $ and %, where price was, and how big that day's move was."
        fields={[
          { key: "ticker", label: "ticker", type: "text", def: "SPX" },
          { key: "days", label: "lookback (days)", type: "number", def: 60 },
          { key: "strike", label: "strike (0 = auto)", type: "number", def: 0 },
          { key: "topN", label: "auto strikes", type: "number", def: 3 },
        ]}
        help={
          <>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, marginBottom: 8 }}>What to look at</div>
            <p style={{ margin: "0 0 8px" }}>
              The <strong>strikes</strong> table ranks that ticker's strikes by how much they actually moved over the
              window — pick one from it and put its number in the <strong>strike</strong> field to pin the series to it.
              Leave it at 0 and the most active few are chosen for you.
            </p>
            <p style={{ margin: "0 0 8px" }}>
              The series itself is under <strong>Per-day detail</strong>. Read the <strong>Δ %</strong> column against
              the <strong>move σ</strong> column beside it: that's the whole question in raw form — did the growth show
              up before the big σ day, or on it, or after?
            </p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>Δ %</strong> is blank when the strike held under the base floor the prior session. A percent off nothing is not a percent, so it's shown as nothing rather than as a giant number.</p>
            <p style={{ margin: "0 0 10px" }}><strong style={{ color: LIGHT_BLUE }}>move σ</strong> is that session's own move in the ticker's normal-day units, so ±1 is an ordinary day and ±2 is a notable one.</p>
            <p style={{ margin: "6px 0 0" }}>
              This panel is per-ticker by design — a pooled timeline would be meaningless. Use it to sanity-check what
              the other three panels claim: if the threshold panel says +150% is the trigger, come here and look at
              what a few of those days actually looked like before you believe it.
            </p>
          </>
        }
      />

      <Panel
        title="⑥ Intraday (wiring check only)" test="strike-gex-move-intraday"
        subtitle="The 1-minute version on strike_growth — the only one that can separate cause from effect, once it has history."
        fields={[
          { key: "ticker", label: "ticker", type: "text", def: "SPX" },
          { key: "days", label: "lookback (days)", type: "number", def: 3 },
          { key: "slotMin", label: "slot (min)", type: "number", def: 10 },
          { key: "look", label: "build (slots)", type: "number", def: 3 },
        ]}
        help={
          <>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, marginBottom: 8 }}>Read the sample-size warning first</div>
            <p style={{ margin: "0 0 8px", color: HOME_THEME.text }}>
              <strong style={{ color: SOFT_RED }}>This is a wiring check, not a study.</strong>{" "}
              <code>strike_growth</code> is on a 5-day retention sweep, so it can only ever see a handful of sessions.
              It <em>cannot</em> be backfilled — that table is the only record of those minutes. Raise{" "}
              <code>RETENTION_STRIKE_GROWTH_DAYS</code> on the VPS (no redeploy) and the sample grows forward from that
              day at roughly 0.3GB of disk per extra session.
            </p>
            <p style={{ margin: "0 0 8px" }}>
              It matters because a <em>daily</em> bar genuinely cannot tell you whether the gamma stacked before the
              move or because of it — both happen inside the same 24 hours. Only the minute data can. Give this weeks
              of retention before reading anything into its buckets.
            </p>
            <p style={{ margin: "6px 0 0" }}>
              Build is measured over <strong>slot × build</strong> minutes and the move over the same span forward; both
              are spelled out in the note. Times are ET. Blank the ticker to sweep the roster — expect it to be slow,
              the table writes about 2M rows a session.
            </p>
          </>
        }
      />

    </PageShell>
  );
}
