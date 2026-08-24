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

/**
 * The two colours that ENCODE something, as opposed to the accent, which is
 * chrome. Call-side and put-side gamma are the one real polarity in this data.
 *
 * CALL is OWNER_THEME.cyan — already in the app — and the clay was picked to
 * pair with it: the two separate at ΔE 17.8 under deuteranopia, where a
 * blue/red pair typically collapses. If these ever move into homeTheme.ts,
 * move them together; re-picking one alone breaks the separation.
 *
 * ADDED vs REMOVED is fill-vs-outline, deliberately NOT a third colour, so the
 * whole encoding survives for a colourblind reader.
 */
const GAMMA_CALL = "#219EBC";
const GAMMA_PUT = "#C96A3E";
const WARN = "#E0B341";

type FeedRow = {
  alert?: string; logged?: string; building?: string;
  date?: string; symbol?: string; strike?: number; zx?: number; band?: string;
  verdict?: string; what?: string; side?: string; vsSpot?: string;
  isCall?: boolean; isAdded?: boolean; flip?: boolean; opex?: boolean;
  histHit?: number | null; histLift?: number | null; histN?: number | null;
  staleDays?: number;
  graded?: boolean; moveSigma?: number | null; move3d?: number | null; hit?: boolean;
  lane?: string; untested?: boolean; at?: string; expiry?: string;
  builtM?: number; typicalM?: number | null; baselineSessions?: number;
};

/**
 * The row's canonical sentence. Each lane names it differently — `alert` on the
 * daily feed, `building` on the intraday one, `logged` in the recorder's log —
 * and the last fallback scans for ANY string field.
 *
 * That last clause is not paranoia: `feed_live` shipped with only `building`,
 * the lookup checked `alert || logged`, and every row rendered as an empty
 * styled box. A renderer that can silently produce nothing is worse than one
 * that throws, so this cannot return blank while the row holds any text at all.
 */
function rowText(r: FeedRow): string {
  if (r.alert) return r.alert;
  if (r.building) return r.building;
  if (r.logged) return r.logged;
  const first = Object.values(r).find((v) => typeof v === "string" && v.length > 12);
  return typeof first === "string" ? first : "";
}

const chipBase: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10, fontWeight: 700,
  letterSpacing: "0.09em", padding: "1px 6px", borderRadius: 4, whiteSpace: "nowrap",
};

function Chips({ r }: { r: FeedRow }) {
  return (
    <>
      {r.flip && <span style={{ ...chipBase, color: LIGHT_BLUE, border: `1px solid ${LIGHT_BLUE}` }}>FLIP</span>}
      {r.opex && (
        <span style={{
          ...chipBase, color: WARN, border: `1px solid ${WARN}88`,
          // Texture, not another colour: opex is not a KIND of build, it is
          // contamination, and hatching says "discount this" without competing
          // with the call/put reading.
          background: "repeating-linear-gradient(45deg, rgba(224,179,65,0.14) 0 3px, transparent 3px 6px)",
        }}>OPEX</span>
      )}
      {r.histHit == null && r.zx != null && r.lane !== "live" && (
        <span style={{ ...chipBase, color: HOME_THEME.muted, opacity: 0.55, border: `1px solid ${HOME_THEME.border}` }}>UNTESTED</span>
      )}
    </>
  );
}

/**
 * Feed rows. Falls back to the plain sentence for any row without the
 * structured fields — an older cached response, or the recorder's frozen line —
 * so the component can never render blank.
 */
function FeedRows({ rows }: { rows: FeedRow[] }) {
  const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 10 }}>
      {rows.map((r, i) => {
        const text = rowText(r);
        // Structured rendering needs a symbol; `zx` may legitimately be null on
        // an intraday row with no time-of-day baseline yet, so it is handled
        // inside rather than dropping the row to plain text.
        if (!r.symbol) {
          return (
            <div key={i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "9px 12px",
              fontSize: 13, color: HOME_THEME.text, fontFamily: mono, lineHeight: 1.5 }}>{text}</div>
          );
        }
        const edge = r.isCall ? GAMMA_CALL : GAMMA_PUT;
        const pctOfScale = r.zx == null ? 0 : Math.max(3, Math.min(100, (r.zx / 8) * 100));
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "3px 1fr",
            background: "rgba(255,255,255,0.03)", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ background: edge }} />
            <div style={{ padding: "10px 13px", display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontFamily: mono, fontSize: 11.5, color: HOME_THEME.muted, opacity: 0.55 }}>[{r.date}]</span>
                <span style={{ fontSize: 14.5, fontWeight: 700 }}>{r.symbol}</span>
                <span style={{ fontFamily: mono, fontSize: 13, color: HOME_THEME.muted, opacity: 0.75 }}>
                  {r.strike} strike{r.expiry ? ` · exp ${r.expiry}` : ""}
                </span>
                {r.at && <span style={{ fontFamily: mono, fontSize: 11.5, color: LIGHT_BLUE, opacity: 0.8 }}>{r.at} ET</span>}
                <Chips r={r} />
                {(r.staleDays ?? 0) > 3 && (
                  <span style={{ ...chipBase, color: SOFT_RED, border: `1px solid ${SOFT_RED}88` }}>{r.staleDays}D STALE</span>
                )}
              </div>

              <div style={{ fontFamily: mono, fontSize: 12.5, color: HOME_THEME.text, lineHeight: 1.5 }}>
                {r.what}{r.side ? ` · ${r.side}` : ""}{r.vsSpot ? ` · ${r.vsSpot} vs spot` : ""}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 700, color: r.zx == null ? HOME_THEME.muted : edge, minWidth: 40, opacity: r.zx == null ? 0.5 : 1 }}>
                  {r.zx == null ? "—" : `${r.zx}×`}
                </span>
                <span style={{ flex: "0 1 200px", height: 5, background: "rgba(255,255,255,0.07)", borderRadius: 3, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${pctOfScale}%`, background: edge, borderRadius: 3 }} />
                </span>
                <span style={{ fontFamily: mono, fontSize: 11.5, color: HOME_THEME.muted, opacity: 0.6 }}>
                  {r.lane === "live"
                    ? (r.zx == null
                        ? `no baseline yet — ${r.baselineSessions ?? 0} prior session(s) at this time`
                        : `vs a typical ${r.at} · ${r.baselineSessions} prior session${r.baselineSessions === 1 ? "" : "s"}`)
                    : r.histHit == null
                      ? "no odds at this level yet"
                      : `hist ${r.histHit}%${r.histLift ? ` · ${r.histLift}× base` : ""}${r.histN ? ` · n=${r.histN}` : ""}`}
                </span>
              </div>

              {r.lane === "live" && (
                <div style={{ fontFamily: mono, fontSize: 11.5, color: WARN, opacity: 0.8 }}>
                  ⚠ UNTESTED — no outcome history for intraday builds yet
                </div>
              )}

              {r.graded !== undefined && (
                <div style={{ fontFamily: mono, fontSize: 12, color: HOME_THEME.muted, opacity: 0.75,
                  display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {r.graded && r.moveSigma != null ? (
                    <>
                      <span>→ RESULT: {r.moveSigma >= 0 ? "+" : ""}{r.moveSigma.toFixed(2)}σ next session</span>
                      <span style={{ color: r.hit ? GAMMA_CALL : GAMMA_PUT, fontWeight: 700 }}>
                        {r.hit ? "✓ HIT" : "✗ miss"}
                      </span>
                      {r.move3d != null && <span style={{ opacity: 0.7 }}>· {r.move3d >= 0 ? "+" : ""}{r.move3d.toFixed(2)}σ by 3d</span>}
                    </>
                  ) : (
                    <span>→ not graded yet — waiting on the forward session</span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Sections rendered as feed rows rather than as a table. */
const FEED_SECTIONS = new Set(["feed", "feed_live", "logged_feed"]);

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
              {FEED_SECTIONS.has(k)
                ? <FeedRows rows={v as FeedRow[]} />
                : <DataTable rows={v as Record<string, unknown>[]} />}
            </div>
          ))}
          {secondary.length > 0 && (
            <details style={{ marginTop: 6, marginBottom: 6 }}>
              <summary style={summaryStyle}>▸ Calibration &amp; diagnostics ({secondary.length})</summary>
              <div style={{ marginTop: 8 }}>
                {secondary.map(([k, v]) => (
                  <div key={k} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE, opacity: 0.8 }}>{k}</div>
                    {FEED_SECTIONS.has(k)
                      ? <FeedRows rows={v as FeedRow[]} />
                      : <DataTable rows={v as Record<string, unknown>[]} />}
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

      {/* GEX Watch MOVED — 2026-08-24.
          It is its own page now: /gex-watch, in the Test Lab sub-strip
          (components/pages/GexWatch.tsx). It was the only panel here whose
          answer changed intraday, and a Run-once panel could not show that;
          the page splits it into a polling "building now" lane
          (/api/gex-watch-live) and the full on-demand study, which is still
          this same endpoint, test=strike-gex-watch.
          Do NOT re-add a copy here — two renderers of one feed is two
          answers. */}

    </PageShell>
  );
}
