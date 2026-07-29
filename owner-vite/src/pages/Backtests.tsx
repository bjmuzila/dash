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
    </PageShell>
  );
}
