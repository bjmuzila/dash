"use client";

// Owner "Backtests" page — the edge studies we built in chat, as re-runnable
// panels. Each card hits GET /api/backtests?test=… (owner-gated, read-only) and
// renders the returned tables. Theme comes from PageShell + Card + homeTheme.

import { useState, type CSSProperties } from "react";
import { HOME_THEME, homeButtonStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";

// Budget UI language (see BUDGET_UI_STYLE.md): one accent only — light blue —
// no rotating card colors, no top bars. Red standardized to theme's #EF4444.
const LIGHT_BLUE = "#7dd3fc";
const SOFT_RED = HOME_THEME.red;

type FieldType = "number" | "select" | "checkbox" | "text";
type Field = { key: string; label: string; type: FieldType; def: string | number | boolean; options?: string[] };

// Column titles are a neutral muted white so they read distinctly from the
// blue (positive) / red (negative) value cells below them.
const th: CSSProperties = { textAlign: "left", padding: "7px 10px", fontSize: 15, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.55, borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "7px 10px", fontSize: 15, color: HOME_THEME.text, borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap" };

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

function Panel({ title, subtitle, test, fields }: { title: string; subtitle: string; test: string; fields: Field[] }) {
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
          <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 15, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.6 }}>
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

      {err && <div style={{ marginTop: 12, fontSize: 15, color: SOFT_RED }}>Error: {err}</div>}
      {data && (
        <div style={{ marginTop: 14 }}>
          {typeof data.note === "string" && <div style={{ fontSize: 15, color: LIGHT_BLUE, marginBottom: 8, lineHeight: 1.5 }}>{data.note}</div>}
          {sections.map(([k, v]) => (
            <div key={k} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE }}>{k}</div>
              <DataTable rows={v as Record<string, unknown>[]} />
            </div>
          ))}
          {detail && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: "pointer", fontSize: 15, color: LIGHT_BLUE }}>Per-day detail ({detail.length})</summary>
              <DataTable rows={detail} />
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

export default function BacktestsPage() {
  return (
    <PageShell>
      <Card variant="budget" accent={LIGHT_BLUE} title="Backtests" subtitle="Re-runnable edge studies over the live Postgres data. Owner-only.">
        <p style={{ fontSize: 15, color: HOME_THEME.text, lineHeight: 1.6, margin: 0 }}>
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
        title="DEX pre-flip alert" test="dex-preflip"
        subtitle="Range-expansion + stall → does a sharp move follow? (2× vs 3×)"
        fields={[
          { key: "greek", label: "greek", type: "select", def: "dex", options: ["dex", "gex"] },
          { key: "hitAbs", label: "hit ≥ $B", type: "number", def: 50 },
          { key: "lookMin", label: "look-ahead (m)", type: "number", def: 20 },
          { key: "minPRange", label: "min prior range", type: "number", def: 5 },
          { key: "edges", label: "edges only", type: "checkbox", def: true },
        ]}
      />

      <Panel
        title="Gamma wall — pin / reject" test="gamma-wall"
        subtitle="Does price gravitate to / reject off the largest GEX wall?"
        fields={[
          { key: "near", label: "wall ≤ pt from spot", type: "number", def: 150 },
          { key: "tol", label: "reach tol (pt)", type: "number", def: 5 },
          { key: "minRange", label: "min day range", type: "number", def: 5 },
        ]}
      />

      <Panel
        title="Normalized GEX per strike" test="normalized-gex"
        subtitle="Live chain: |strike net GEX| / Σ|net GEX| × 100 for one ticker + expiration."
        fields={[
          { key: "ticker", label: "ticker", type: "text", def: "SPX" },
          { key: "expiration", label: "expiration (YYYY-MM-DD)", type: "text", def: "" },
        ]}
      />
    </PageShell>
  );
}
