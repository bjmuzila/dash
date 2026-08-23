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
// Every long explanation on this page is COLLAPSED BY DEFAULT. The panels are
// heavily documented on purpose, but the docs are reference material — you read
// them once while calibrating and never again, and left open they bury the
// numbers you actually came for.
const summaryStyle: CSSProperties = {
  // `listStyle: none` alone does not kill the marker in WebKit; the
  // ::-webkit-details-marker rule in the style tag below handles that.
  cursor: "pointer", fontSize: 13, fontWeight: 800, letterSpacing: "0.14em",
  textTransform: "uppercase", color: LIGHT_BLUE, opacity: 0.85,
  listStyle: "none", userSelect: "none", padding: "4px 0",
};

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

function Panel({ title, subtitle, test, fields, help, primary }: {
  title: string; subtitle: string; test: string; fields: Field[]; help?: ReactNode;
  /** Section keys to render inline. Everything else the endpoint returns goes
   *  behind one toggle. Omit to render every section (the older panels). */
  primary?: string[];
}) {
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

  const allSections = data ? Object.entries(data).filter(([k, v]) => Array.isArray(v) && v.length && typeof v[0] === "object" && k !== "detail") : [];
  const sections = primary ? allSections.filter(([k]) => primary.includes(k)) : allSections;
  const secondary = primary ? allSections.filter(([k]) => !primary.includes(k)) : [];
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
          {typeof data.note === "string" && (() => {
            // Lead with the first sentence — on the watch panel that is the
            // earned cutoff, i.e. the answer. The rest is caveats and method,
            // which matter but not on every run.
            const note = data.note as string;
            const cut = note.indexOf(". ");
            const head = cut > 0 && cut < note.length - 2 ? note.slice(0, cut + 1) : note;
            const rest = cut > 0 && cut < note.length - 2 ? note.slice(cut + 2) : "";
            if (!rest) return <div style={{ fontSize: 14, color: LIGHT_BLUE, marginBottom: 8, lineHeight: 1.5 }}>{note}</div>;
            return (
              <details style={{ marginBottom: 8 }}>
                <summary style={{ ...summaryStyle, fontSize: 14, fontWeight: 500, letterSpacing: 0, textTransform: "none", color: LIGHT_BLUE, opacity: 1, lineHeight: 1.5 }}>
                  {head} <span style={{ opacity: 0.6, fontSize: 13 }}>— more ▾</span>
                </summary>
                <div style={{ fontSize: 13.5, color: HOME_THEME.muted, lineHeight: 1.6, marginTop: 6, whiteSpace: "pre-line" }}>{rest}</div>
              </details>
            );
          })()}
          {sections.map(([k, v]) => (
            <div key={k} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE }}>{k}</div>
              <DataTable rows={v as Record<string, unknown>[]} />
            </div>
          ))}
          {secondary.length > 0 && (
            <details style={{ marginTop: 6, marginBottom: 6 }}>
              <summary style={summaryStyle}>▸ Calibration &amp; diagnostics ({secondary.length})</summary>
              <div style={{ marginTop: 8 }}>
                {secondary.map(([k, v]) => (
                  <div key={k} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE, opacity: 0.8 }}>{k}</div>
                    <DataTable rows={v as Record<string, unknown>[]} />
                  </div>
                ))}
              </div>
            </details>
          )}
          {detail && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: "pointer", fontSize: 14, color: LIGHT_BLUE }}>Per-day detail ({detail.length})</summary>
              <DataTable rows={detail} />
            </details>
          )}
        </div>
      )}

      {help && (
        <details style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${HOME_THEME.border}` }}>
          <summary style={summaryStyle}>▸ How to read this</summary>
          <div style={{ fontSize: 13.5, color: HOME_THEME.muted, lineHeight: 1.65, marginTop: 10 }}>
            {help}
          </div>
        </details>
      )}
    </Card>
  );
}

export default function Backtests() {
  return (
    <PageShell>
      <style>{`details > summary::-webkit-details-marker { display: none; }
        details[open] > summary .chev { transform: rotate(90deg); }`}</style>
      <Card variant="budget" accent={LIGHT_BLUE} title="Backtests" subtitle="Re-runnable edge studies over the live Postgres data. Owner-only.">
        <details>
          <summary style={summaryStyle}>▸ About this page</summary>
          <p style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.6, margin: "10px 0 0" }}>
            Each panel runs server-side against the same tables the dashboard writes. Adjust the inputs and hit Run.
            Samples are still small — treat results as directional. Expand “Per-day detail” to see the underlying rows.
          </p>
        </details>
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
        title="GEX Watch" test="strike-gex-watch"
        subtitle="Strikes growing more than their ticker normally grows, at a cutoff the backtest earned rather than one anybody picked."
        primary={["feed", "by_symbol"]}
        fields={[
          { key: "minZ", label: "×normal (0 = auto)", type: "number", def: 0 },
          { key: "ticker", label: "ticker (blank = all)", type: "text", def: "" },
          { key: "days", label: "history (days)", type: "number", def: 180 },
          { key: "hitSigma", label: "big move (σ)", type: "number", def: 1 },
          { key: "withChecks", label: "run checks", type: "checkbox", def: false },
        ]}
        help={
          <>
            <p style={{ margin: "0 0 10px", color: HOME_THEME.text }}>
              Hit Run. Read <strong style={{ color: LIGHT_BLUE }}>feed</strong>. That is the whole daily use.
            </p>
            <p style={{ margin: "0 0 10px", padding: "8px 10px", background: "rgba(125,211,252,0.07)", borderLeft: `2px solid ${LIGHT_BLUE}`, fontSize: 13, lineHeight: 1.55, color: HOME_THEME.text }}>
              MU 2000 strike — GEX grew +187%, way above normal (3.4× typical). $4.2M → $12.1M, 3.1% vs spot,
              call side. History: 51% big-move next session (1.8× base, n=64).
            </p>

            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, margin: "16px 0 8px" }}>The three numbers on a line</div>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>×normal</strong> — the strike's dollar change ÷ the trailing average of <em>that ticker's own biggest daily strike move</em>. 1.0 is an ordinary day's hottest strike; 3× is three times that. It is what puts a mid-cap and SPX on one scale — a plain dollar cutoff would just rank the feed by market cap.</p>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>Δ %</strong> — the raw growth, measured only on strikes that already held real gamma. Without that floor a strike going $12K → $900K reads as “+7,400%”.</p>
            <p style={{ margin: "0 0 10px" }}><strong style={{ color: LIGHT_BLUE }}>History</strong> — what happened the last n times anything hit that band. “Not enough past events” means the flag is untested, not proven.</p>

            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, margin: "16px 0 8px" }}>The cutoff is earned, not chosen</div>
            <p style={{ margin: "0 0 8px" }}>
              Leave <strong>×normal</strong> at <strong>0</strong> and the backtest sets it: it sweeps candidate levels
              across your history and takes the one where price actually followed. Open{" "}
              <strong>Calibration &amp; diagnostics</strong> to see that sweep.
            </p>
            <p style={{ margin: "0 0 8px" }}>
              In <strong>calibration</strong>, trust <strong style={{ color: LIGHT_BLUE }}>lift (low)</strong>, not{" "}
              <strong>lift</strong>. Raw lift almost always peaks at the most extreme cutoff simply because the tail has
              the fewest events — on the test data ≥4× showed 1.86× on 24 events while ≥1.5× showed 1.66× on 154. The
              first is twenty-four coin flips. The lower bound is the worst case at 95% confidence, and picking on it
              chooses the second.
            </p>
            <p style={{ margin: "0 0 10px" }}>
              <strong>odds</strong> is the sanity check: does lift <em>rise</em> as changes get bigger? The note says so
              out loud. One bin popping while its neighbours sit at baseline is a coincidence, not a threshold.
            </p>

            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, margin: "16px 0 8px" }}>Two lanes, and run checks</div>
            <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>feed</strong> — since last close, off 400 sessions, so every line carries odds. The premarket read.</p>
            <p style={{ margin: "0 0 8px" }}><strong style={{ color: LIGHT_BLUE }}>feed_live</strong> — building now, off 1-minute data. Marked <strong style={{ color: SOFT_RED }}>UNTESTED</strong>: 5-day retention leaves no outcome history to score against. Never read a feed hit-rate onto a feed_live line.</p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>run checks</strong> is off by default because each one runs its own full-history query.
              Tick it and you get <strong>premove_check</strong> — the same study run backwards, starting from the moves
              and looking back, printing move-days next to quiet-days. <strong>If those two rows look alike, the cutoff
              above is describing noise</strong> however good its lift looks. With a ticker set you also get its
              per-strike timeline.
            </p>
            <p style={{ margin: "6px 0 0", color: HOME_THEME.text }}>
              <strong style={{ color: SOFT_RED }}>Not live.</strong> Written once daily after the close. An empty feed
              is a real answer — most days are quiet at an earned cutoff — but a stalled recorder looks identical from
              here, which is what <strong>coverage</strong> is for. Check it first if the feed goes quiet for days.
            </p>
          </>
        }
      />

    </PageShell>
  );
}
