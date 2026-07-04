"use client";

// Owner "Backtests" page — the edge studies we built in chat, as re-runnable
// panels. Each card hits GET /api/backtests?test=… (owner-gated, read-only) and
// renders the returned tables. Theme comes from PageShell + Card + homeTheme.

import { useState, type CSSProperties } from "react";
import { HOME_THEME, homeButtonStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

type FieldType = "number" | "select" | "checkbox";
type Field = { key: string; label: string; type: FieldType; def: string | number | boolean; options?: string[] };

const th: CSSProperties = { textAlign: "left", padding: "6px 10px", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: HOME_THEME.green, borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "6px 10px", fontSize: 13, color: HOME_THEME.text, borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap" };

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
              const strong = s === "REJECT" || s === "held" || s === "yes";
              return <td key={c} style={{ ...td, color: strong ? HOME_THEME.green : s === "broke" || s === "no" ? HOME_THEME.orange : HOME_THEME.text }}>{s}</td>;
            })}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Panel({ title, subtitle, accent, test, fields }: { title: string; subtitle: string; accent: string; test: string; fields: Field[] }) {
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
    <Card accent={accent} title={title} subtitle={subtitle}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        {fields.map((f) => (
          <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: HOME_THEME.green }}>
            {f.label}
            {f.type === "select" ? (
              <select style={{ ...homeInputStyle, width: 120 }} value={String(params[f.key])} onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))}>
                {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === "checkbox" ? (
              <input type="checkbox" checked={!!params[f.key]} onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.checked }))} style={{ width: 18, height: 18, accentColor: HOME_THEME.cyan }} />
            ) : (
              <input type="number" style={{ ...homeInputStyle, width: 90 }} value={String(params[f.key])} onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))} />
            )}
          </label>
        ))}
        <button style={{ ...homeButtonStyle, padding: "8px 18px", opacity: loading ? 0.6 : 1 }} onClick={run} disabled={loading}>
          {loading ? "Running…" : "Run"}
        </button>
      </div>

      {err && <div style={{ marginTop: 12, fontSize: 13, color: HOME_THEME.red }}>Error: {err}</div>}
      {data && (
        <div style={{ marginTop: 14 }}>
          {typeof data.note === "string" && <div style={{ fontSize: 12, color: HOME_THEME.green, marginBottom: 8, lineHeight: 1.5 }}>{data.note}</div>}
          {sections.map(([k, v]) => (
            <div key={k} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.7 }}>{k}</div>
              <DataTable rows={v as Record<string, unknown>[]} />
            </div>
          ))}
          {detail && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: HOME_THEME.cyan }}>Per-day detail ({detail.length})</summary>
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
      <Card accent="cyan" title="Backtests" subtitle="Re-runnable edge studies over the live Postgres data. Owner-only.">
        <p style={{ fontSize: 13, color: HOME_THEME.text, lineHeight: 1.6, margin: 0 }}>
          Each panel runs server-side against the same tables the dashboard writes. Adjust the inputs and hit Run.
          Samples are still small — treat results as directional. Expand “Per-day detail” to see the underlying rows.
        </p>
      </Card>

      <Panel
        title="CB size → reach" accent="orange" test="cb-size"
        subtitle="Does a bigger CB level get touched / held more often?"
        fields={[{ key: "tol", label: "strike tol (pt)", type: "number", def: 10 }]}
      />

      <Panel
        title="Confidence calibration" accent="green" test="confidence"
        subtitle="Predicted reach / hold / break vs what actually happened."
        fields={[]}
      />

      <Panel
        title="DEX pre-flip alert" accent="purple" test="dex-preflip"
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
        title="Gamma wall — pin / reject" accent="cyan" test="gamma-wall"
        subtitle="Does price gravitate to / reject off the largest GEX wall?"
        fields={[
          { key: "near", label: "wall ≤ pt from spot", type: "number", def: 150 },
          { key: "tol", label: "reach tol (pt)", type: "number", def: 5 },
          { key: "minRange", label: "min day range", type: "number", def: 5 },
        ]}
      />
    </PageShell>
  );
}
