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

      <Panel
        title="Strike GEX growth → move (daily)" test="strike-gex-move"
        subtitle="Does the day's biggest per-strike GEX build precede a move? 400 sessions of eod_strike_gex, vol-normalized."
        fields={[
          { key: "days", label: "lookback (days)", type: "number", def: 180 },
          { key: "win", label: "trailing win", type: "number", def: 20 },
          { key: "hitSigma", label: "big move (σ)", type: "number", def: 1 },
          { key: "ticker", label: "ticker (blank = all)", type: "text", def: "" },
        ]}
        help={
          <>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, marginBottom: 8 }}>How to read this</div>
            <p style={{ margin: "0 0 8px" }}>
              For every symbol-session it finds the single strike whose net GEX changed most vs the
              prior session, scores that change against the symbol's own recent history, and looks at
              what price did over the next 1 / 3 / 5 sessions.
            </p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>z</strong> — how unusual the build was for that ticker: (biggest |Δ$ gamma| − its trailing mean) ÷ trailing stdev. This is what everything ranks on, <em>not</em> percent change. Net GEX is a signed sum that crosses zero, so a % off a near-flat strike is unbounded noise — −2M → +1M would read as “−150%”.</p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>Δ %</strong> — the raw percent change you asked for, kept on every event row in the detail table. Read it per-event, never as a ranking.</p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>σ</strong> — every move is divided by that ticker's own trailing return stdev, so a 2% day in a $30 name and a 2% day in SPX are comparable and the buckets can pool the whole roster.</p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>buckets</strong> — the answer lives here. Compare each z-bucket's “big move %” to the <strong>ALL (baseline)</strong> row. If extreme builds don't beat baseline, there is no edge at this horizon and no amount of staring at the detail table will create one.</p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>conc %</strong> — the top strike's share of the day's total |Δ|. High means one strike carried it; low means the whole ladder shifted and the “top strike” is arbitrary.</p>
            <p style={{ margin: "0 0 10px" }}><strong style={{ color: LIGHT_BLUE }}>lift</strong> (by ticker) — strong-build big-move % ÷ that ticker's own baseline. Above 1 means the signal adds something for that name. Tickers with fewer than 5 strong events are hidden.</p>
            <p style={{ margin: "0 0 6px", color: HOME_THEME.text }}>
              Every scoring window is strictly trailing and excludes the event bar, so nothing leaks the
              outcome into the score. A quick audit: the baseline <strong>up %</strong> should sit near 50 —
              if it drifts far off, something has gone wrong with the forward join.
            </p>
            <p style={{ margin: "6px 0 0" }}>
              Sign convention: Δ&gt;0 = call / positive gamma added, Δ&lt;0 = put / negative gamma added.
              The <code>call_gex</code>/<code>put_gex</code> legs only exist after 2026-08-18 and were never
              backfilled, so this reads net GEX and infers the side from the sign — which works on every
              row in the table.
            </p>
          </>
        }
      />

      <Panel
        title="Strike GEX growth → move (intraday)" test="strike-gex-move-intraday"
        subtitle="Same engine on 1-minute strike_growth: build over the last N minutes vs the move over the next N."
        fields={[
          { key: "ticker", label: "ticker", type: "text", def: "SPX" },
          { key: "days", label: "lookback (days)", type: "number", def: 3 },
          { key: "slotMin", label: "slot (min)", type: "number", def: 10 },
          { key: "look", label: "build (slots)", type: "number", def: 3 },
          { key: "fwd", label: "forward (slots)", type: "number", def: 3 },
          { key: "hitSigma", label: "big move (σ)", type: "number", def: 1 },
        ]}
        help={
          <>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, marginBottom: 8 }}>Read the sample-size warning first</div>
            <p style={{ margin: "0 0 8px", color: HOME_THEME.text }}>
              <strong style={{ color: SOFT_RED }}>This is a wiring check, not a study.</strong>{" "}
              <code>strike_growth</code> is on a 5-day retention sweep, so whatever this returns today is a
              handful of sessions. It <em>cannot</em> be backfilled — that table is the only record of those
              minutes. Raise <code>RETENTION_STRIKE_GROWTH_DAYS</code> on the VPS (no redeploy) and the sample
              grows forward from that day at roughly 0.3GB of disk per extra session.
            </p>
            <p style={{ margin: "0 0 8px" }}>
              Everything else reads exactly like the daily panel above: z-scored build, moves in the session's
              own σ, buckets compared against the ALL row. The difference is the clock — build is measured over
              <strong> slot × build</strong> minutes and the move over <strong>slot × forward</strong> minutes,
              both shown in the note. Times are ET.
            </p>
            <p style={{ margin: "0 0 6px" }}>
              This is the version that can actually test causality, because a daily bar cannot tell you whether
              the gamma stacked before or after the move. Give it weeks of retention before reading anything
              into the buckets.
            </p>
            <p style={{ margin: "6px 0 0" }}>
              Leave <strong>ticker</strong> blank to sweep the whole roster — expect it to be slow, the table
              writes about 2M rows a session.
            </p>
          </>
        }
      />
    </PageShell>
  );
}
