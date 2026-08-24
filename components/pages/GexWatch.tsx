"use client";

/**
 * /gex-watch — GEX Watch, on its own page, live.
 *
 * WHERE THIS CAME FROM. This was one <Panel> on the owner-vite Backtests page
 * ("GEX Watch", test=strike-gex-watch): you pressed Run, it ran the whole study
 * once, and you read the result. It has been moved here whole and given the one
 * thing the panel could not have — a lane that keeps updating — because the
 * question it answers ("what is building RIGHT NOW that is bigger than this
 * ticker's normal") stops being useful the moment the number is an hour old.
 *
 * TWO LANES, TWO CADENCES, AND THEY ARE NOT THE SAME MEASUREMENT.
 *
 *   BUILDING NOW (live)  — /api/gex-watch-live → strikeGexBuildingNow().
 *     One query over `strike_growth` for the latest recorded 10-minute slot,
 *     judged against that symbol's own biggest build at the SAME slot on prior
 *     sessions. Polls on an interval. Carries NO odds and says so on every
 *     line: strike_growth is on a ~5-day retention sweep, so no outcome history
 *     exists to score it against.
 *
 *   SINCE LAST CLOSE (study) — /api/backtests?test=strike-gex-watch.
 *     The full thing: the calibration sweep that earns the cutoff, the
 *     400-session odds join, the recorder's alert log and its grading. This is
 *     NOT polled. It is a 169-ticker window-function scan, correct once and
 *     indefensible every sixty seconds, and its input only changes at the
 *     16:40 ET recorder run anyway. Runs on mount and when you press Run.
 *
 * Never read a hit-rate off the study lane onto a live line. The renderer keeps
 * them in separate cards for exactly that reason.
 *
 * OWNER ONLY. Both endpoints are `auth: 'owner'` server-side; the guard below is
 * chrome so the page says so instead of rendering an empty error. The customer
 * surface for this data is the GEX Watch box on /premarket, which reads the
 * logged, graded, opex-filtered feed and never runs the sweep.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { HOME_THEME, LIGHT_BLUE, SOFT_RED, homeButtonStyle, homeSecondaryButtonStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { useIsOwner } from "@/components/shared/useIsOwner";

// ─────────────────────────────────────────────────────────────────────────────
// Encoding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The two colours that ENCODE something, as opposed to the accent, which is
 * chrome. Call-side and put-side gamma are the one real polarity in this data.
 * CALL is the app's own cyan; the clay was picked to pair with it — the two
 * separate at ΔE 17.8 under deuteranopia, where a blue/red pair collapses. Move
 * them together or not at all. (Same pair as GexWatchFeed on /premarket.)
 */
const GAMMA_CALL = "#219EBC";
const GAMMA_PUT = "#C96A3E";
const WARN = "#E0B341";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const summaryStyle: CSSProperties = {
  cursor: "pointer", fontSize: 13, fontWeight: 800, letterSpacing: "0.14em",
  textTransform: "uppercase", color: LIGHT_BLUE, opacity: 0.85,
  listStyle: "none", userSelect: "none", padding: "4px 0",
};

const th: CSSProperties = {
  textAlign: "left", padding: "7px 10px", fontSize: 14, fontWeight: 800,
  letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.muted,
  opacity: 0.55, borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap",
};
const td: CSSProperties = {
  padding: "7px 10px", fontSize: 14, color: HOME_THEME.text,
  borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap",
};

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

// ─────────────────────────────────────────────────────────────────────────────
// Feed rows — one renderer, both lanes (the server sends the same field set)
// ─────────────────────────────────────────────────────────────────────────────

type FeedRow = {
  alert?: string; logged?: string; building?: string;
  date?: string; symbol?: string; strike?: number; zx?: number | null; band?: string;
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
 * and the last fallback scans for ANY string field. That last clause is not
 * paranoia: `feed_live` shipped with only `building`, the lookup checked
 * `alert || logged`, and every row rendered as an empty styled box.
 */
function rowText(r: FeedRow): string {
  if (r.alert) return r.alert;
  if (r.building) return r.building;
  if (r.logged) return r.logged;
  const first = Object.values(r).find((v) => typeof v === "string" && v.length > 12);
  return typeof first === "string" ? first : "";
}

const chipBase: CSSProperties = {
  fontFamily: MONO, fontSize: 10, fontWeight: 700,
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

function FeedRows({ rows }: { rows: FeedRow[] }) {
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
              fontSize: 13, color: HOME_THEME.text, fontFamily: MONO, lineHeight: 1.5 }}>{text}</div>
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
                <span style={{ fontFamily: MONO, fontSize: 11.5, color: HOME_THEME.muted, opacity: 0.55 }}>[{r.date}]</span>
                <span style={{ fontSize: 14.5, fontWeight: 700 }}>{r.symbol}</span>
                <span style={{ fontFamily: MONO, fontSize: 13, color: HOME_THEME.muted, opacity: 0.75 }}>
                  {r.strike} strike{r.expiry ? ` · exp ${r.expiry}` : ""}
                </span>
                {r.at && <span style={{ fontFamily: MONO, fontSize: 11.5, color: LIGHT_BLUE, opacity: 0.8 }}>{r.at} ET</span>}
                <Chips r={r} />
                {(r.staleDays ?? 0) > 3 && (
                  <span style={{ ...chipBase, color: SOFT_RED, border: `1px solid ${SOFT_RED}88` }}>{r.staleDays}D STALE</span>
                )}
              </div>

              <div style={{ fontFamily: MONO, fontSize: 12.5, color: HOME_THEME.text, lineHeight: 1.5 }}>
                {r.what}{r.side ? ` · ${r.side}` : ""}{r.vsSpot ? ` · ${r.vsSpot} vs spot` : ""}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: r.zx == null ? HOME_THEME.muted : edge, minWidth: 40, opacity: r.zx == null ? 0.5 : 1 }}>
                  {r.zx == null ? "—" : `${r.zx}×`}
                </span>
                <span style={{ flex: "0 1 200px", height: 5, background: "rgba(255,255,255,0.07)", borderRadius: 3, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${pctOfScale}%`, background: edge, borderRadius: 3 }} />
                </span>
                <span style={{ fontFamily: MONO, fontSize: 11.5, color: HOME_THEME.muted, opacity: 0.6 }}>
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
                <div style={{ fontFamily: MONO, fontSize: 11.5, color: WARN, opacity: 0.8 }}>
                  ⚠ UNTESTED — no outcome history for intraday builds yet
                </div>
              )}

              {r.graded !== undefined && (
                <div style={{ fontFamily: MONO, fontSize: 12, color: HOME_THEME.muted, opacity: 0.75,
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

// ─────────────────────────────────────────────────────────────────────────────
// Live lane
// ─────────────────────────────────────────────────────────────────────────────

/** Sections of the study response rendered as feed rows rather than as a table. */
const FEED_SECTIONS = new Set(["feed", "feed_live", "logged_feed"]);

/** Poll choices. 0 = off. The data itself only moves on the recorder's
 *  10-minute slot boundary, so anything under a minute is pure noise. */
const INTERVALS: { label: string; ms: number }[] = [
  { label: "off", ms: 0 },
  { label: "1m", ms: 60_000 },
  { label: "5m", ms: 300_000 },
  { label: "10m", ms: 600_000 },
];

const etTime = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false,
    hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);

function LiveDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
        background: on ? GAMMA_CALL : HOME_THEME.border,
        boxShadow: on ? `0 0 8px ${GAMMA_CALL}` : "none",
        animation: on ? "gwPulse 2s ease-in-out infinite" : "none",
      }}
    />
  );
}

type LiveState = {
  rows: FeedRow[];
  note: string;
  at: number | null;
  err: string | null;
  loading: boolean;
};

function labelStyle(): CSSProperties {
  return {
    display: "flex", flexDirection: "column", gap: 4, fontSize: 14, fontWeight: 800,
    letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.6,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function GexWatchPage() {
  const { isOwner, loaded } = useIsOwner();

  // Live lane -----------------------------------------------------------------
  const [ticker, setTicker] = useState("");
  const [everyMs, setEveryMs] = useState(60_000);
  const [live, setLive] = useState<LiveState>({ rows: [], note: "", at: null, err: null, loading: true });
  // Kept in a ref so the poll effect does not restart on every tick.
  const tickerRef = useRef(ticker);
  tickerRef.current = ticker;

  const loadLive = useCallback(async () => {
    setLive((s) => ({ ...s, loading: true }));
    try {
      const qs = new URLSearchParams({ limit: "60" });
      const t = tickerRef.current.trim();
      if (t) qs.set("ticker", t.toUpperCase());
      const res = await fetch(`/api/gex-watch-live?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      setLive({
        rows: Array.isArray(json.feed_live) ? json.feed_live : [],
        note: typeof json.live_note === "string" ? json.live_note : "",
        at: Date.now(), err: null, loading: false,
      });
    } catch (e) {
      // Keep the last good rows on screen — a poll that fails should not blank
      // the page, it should say the number on screen is the older one.
      setLive((s) => ({ ...s, err: (e as Error).message, loading: false }));
    }
  }, []);

  useEffect(() => { loadLive(); }, [loadLive]);

  useEffect(() => {
    if (!everyMs) return;
    const id = window.setInterval(loadLive, everyMs);
    return () => window.clearInterval(id);
  }, [everyMs, loadLive]);

  // Study lane ----------------------------------------------------------------
  const [minZ, setMinZ] = useState("0");
  const [days, setDays] = useState("180");
  const [hitSigma, setHitSigma] = useState("1");
  const [withChecks, setWithChecks] = useState(false);
  const [study, setStudy] = useState<Record<string, unknown> | null>(null);
  const [studyErr, setStudyErr] = useState<string | null>(null);
  const [studyLoading, setStudyLoading] = useState(false);

  const runStudy = useCallback(async () => {
    setStudyLoading(true); setStudyErr(null);
    try {
      const qs = new URLSearchParams({ test: "strike-gex-watch", minZ, days, hitSigma });
      const t = tickerRef.current.trim();
      if (t) qs.set("ticker", t.toUpperCase());
      if (withChecks) qs.set("withChecks", "1");
      const res = await fetch(`/api/backtests?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      setStudy(json);
    } catch (e) { setStudyErr((e as Error).message); } finally { setStudyLoading(false); }
  }, [minZ, days, hitSigma, withChecks]);

  // Runs once on mount so the page is useful on arrival. Deliberately NOT
  // re-run when the inputs change — this is the expensive lane, and a keystroke
  // in "history (days)" must not fire a 169-ticker sweep.
  const ranOnce = useRef(false);
  useEffect(() => {
    if (ranOnce.current) return;
    ranOnce.current = true;
    runStudy();
  }, [runStudy]);

  if (loaded && !isOwner) {
    return (
      <PageShell>
        <Card variant="budget" title="GEX Watch" subtitle="Owner only.">
          <div style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.6 }}>
            This is the research bench behind the GEX Watch box on{" "}
            <strong style={{ color: LIGHT_BLUE }}>Premarket</strong> — the calibration sweep, the
            alert log and the untested intraday lane. The read that is ready for use is on that page.
          </div>
        </Card>
      </PageShell>
    );
  }

  // Study sections, split the way the old panel split them: the feeds inline,
  // everything else behind one toggle.
  const allSections = study
    ? Object.entries(study).filter(([k, v]) => Array.isArray(v) && v.length && typeof (v as unknown[])[0] === "object" && k !== "detail")
    : [];
  const primary = allSections.filter(([k]) => k === "feed" || k === "logged_feed");
  // feed_live is dropped from the study response on purpose: the live card above
  // is the same lane, fresher. Two copies on one page is two answers.
  const secondary = allSections.filter(([k]) => !["feed", "logged_feed", "feed_live", "live"].includes(k));
  const detail = study && Array.isArray(study.detail) ? (study.detail as Record<string, unknown>[]) : null;
  const note = typeof study?.note === "string" ? (study.note as string) : "";

  return (
    <PageShell>
      <style>{`details > summary::-webkit-details-marker { display: none; }
        @keyframes gwPulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }`}</style>

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <Card
        variant="budget"
        title="GEX Watch"
        subtitle="Strikes growing more than their ticker normally grows — building now, and since the last close."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <label style={labelStyle()}>
            ticker (blank = all)
            <input
              type="text" style={{ ...homeInputStyle, width: 130 }} value={ticker}
              placeholder="all"
              onChange={(e) => setTicker(e.target.value)}
            />
          </label>
          <label style={labelStyle()}>
            ×normal (0 = auto)
            <input type="number" style={{ ...homeInputStyle, width: 100 }} value={minZ} onChange={(e) => setMinZ(e.target.value)} />
          </label>
          <label style={labelStyle()}>
            history (days)
            <input type="number" style={{ ...homeInputStyle, width: 100 }} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <label style={labelStyle()}>
            big move (σ)
            <input type="number" style={{ ...homeInputStyle, width: 90 }} value={hitSigma} onChange={(e) => setHitSigma(e.target.value)} />
          </label>
          <label style={labelStyle()}>
            run checks
            <input
              type="checkbox" checked={withChecks} onChange={(e) => setWithChecks(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: HOME_THEME.cyan }}
            />
          </label>
          <button
            style={{ ...homeButtonStyle, padding: "8px 18px", opacity: studyLoading ? 0.6 : 1 }}
            onClick={runStudy}
            disabled={studyLoading}
          >
            {studyLoading ? "Running…" : "Run study"}
          </button>
        </div>

        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
          borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 12 }}>
          <LiveDot on={everyMs > 0} />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase",
            color: HOME_THEME.muted, opacity: 0.6 }}>
            live refresh
          </span>
          {INTERVALS.map((iv) => (
            <button
              key={iv.label}
              onClick={() => setEveryMs(iv.ms)}
              aria-pressed={everyMs === iv.ms}
              style={everyMs === iv.ms
                ? { ...homeButtonStyle, borderColor: LIGHT_BLUE, color: LIGHT_BLUE }
                : homeSecondaryButtonStyle}
            >
              {iv.label}
            </button>
          ))}
          <button style={homeSecondaryButtonStyle} onClick={loadLive} disabled={live.loading}>
            {live.loading ? "…" : "refresh now"}
          </button>
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: HOME_THEME.muted, opacity: 0.6 }}>
            {live.at ? `updated ${etTime(new Date(live.at))} ET` : "…"}
          </span>
          {live.err && (
            <span style={{ fontFamily: MONO, fontSize: 11.5, color: SOFT_RED }}>
              last poll failed: {live.err} — showing the previous read
            </span>
          )}
        </div>
      </Card>

      {/* ── Live lane ────────────────────────────────────────────────────── */}
      <Card
        variant="budget"
        title="Building now"
        subtitle="The latest recorded 10-minute slot, judged against the same slot on prior sessions."
      >
        <div style={{
          fontSize: 12.5, color: WARN, lineHeight: 1.55, marginBottom: 10,
          padding: "8px 10px", borderLeft: `2px solid ${WARN}`, background: "rgba(224,179,65,0.07)",
        }}>
          ⚠ UNTESTED LANE. <code>strike_growth</code> is on a ~5-day retention sweep, so there is no
          outcome history to score these against — and there will not be until retention is raised and
          weeks pass. Never read the hit rates from the study card below onto a line here.
        </div>
        {live.note && (
          <p style={{ fontSize: 13, color: HOME_THEME.muted, opacity: 0.75, lineHeight: 1.6, margin: "0 0 4px", maxWidth: "90ch" }}>
            {live.note}
          </p>
        )}
        {live.rows.length === 0 ? (
          <div style={{ fontSize: 13, color: HOME_THEME.muted, opacity: 0.6, padding: "10px 0" }}>
            {live.loading && !live.at ? "Loading…" : "Nothing building on the latest recorded minute."}
          </div>
        ) : (
          <FeedRows rows={live.rows} />
        )}
      </Card>

      {/* ── Study lane ───────────────────────────────────────────────────── */}
      <Card
        variant="budget"
        title="Since last close"
        subtitle="The full study — earned cutoff, 400-session odds, the recorder's log and its grades. Not polled."
      >
        {studyErr && <div style={{ fontSize: 14, color: SOFT_RED }}>Error: {studyErr}</div>}
        {!study && !studyErr && (
          <div style={{ fontSize: 13, color: HOME_THEME.muted, opacity: 0.6 }}>
            {studyLoading ? "Running the sweep…" : "Press Run study."}
          </div>
        )}
        {study && (
          <div>
            {note && (() => {
              // Lead with the first sentence — that is the earned cutoff, i.e.
              // the answer. The rest is caveats and method, which matter but not
              // on every run.
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

            {primary.map(([k, v]) => (
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

        <details style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${HOME_THEME.border}` }}>
          <summary style={summaryStyle}>▸ How to read this</summary>
          <HowToRead />
        </details>
      </Card>
    </PageShell>
  );
}

function HowToRead() {
  return (
    <div style={{ fontSize: 13.5, color: HOME_THEME.muted, lineHeight: 1.65, marginTop: 10 }}>
      <p style={{ margin: "0 0 10px", color: HOME_THEME.text }}>
        Read <strong style={{ color: LIGHT_BLUE }}>Building now</strong> for what is happening, and{" "}
        <strong style={{ color: LIGHT_BLUE }}>feed</strong> for what happened overnight and what it
        historically meant. Those are the whole daily use.
      </p>
      <p style={{ margin: "0 0 10px", padding: "8px 10px", background: "rgba(125,211,252,0.07)", borderLeft: `2px solid ${LIGHT_BLUE}`, fontSize: 13, lineHeight: 1.55, color: HOME_THEME.text }}>
        MU 2000 strike — GEX grew +187%, way above normal (3.4× typical). $4.2M → $12.1M, 3.1% vs spot,
        call side. History: 51% big-move next session (1.8× base, n=64).
      </p>

      <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, margin: "16px 0 8px" }}>The three numbers on a line</div>
      <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>×normal</strong> — the strike&rsquo;s dollar change ÷ the trailing average of <em>that ticker&rsquo;s own biggest daily strike move</em>. 1.0 is an ordinary day&rsquo;s hottest strike; 3× is three times that. It is what puts a mid-cap and SPX on one scale — a plain dollar cutoff would just rank the feed by market cap.</p>
      <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>Δ %</strong> — the raw growth, measured only on strikes that already held real gamma. Without that floor a strike going $12K → $900K reads as &ldquo;+7,400%&rdquo;. A line that says <strong>FLIPPED</strong> crossed zero, which is a regime change and not a percentage at all.</p>
      <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>side</strong> — read from the real call/put legs, not the sign of Δ. A positive Δ means calls were added <em>or</em> puts were removed, and those are opposite events. The live lane deliberately does NOT claim a side: <code>strike_growth</code> has no legs, only net.</p>
      <p style={{ margin: "0 0 5px", color: HOME_THEME.text }}><strong style={{ color: SOFT_RED }}>⚠ OPEX SESSION</strong> — on the third Friday the expiring tranche leaves the chain, so strikes collapse for calendar reasons. Those lines are flagged and excluded from the calibration.</p>
      <p style={{ margin: "0 0 10px" }}><strong style={{ color: LIGHT_BLUE }}>History</strong> — what happened the last n times anything hit that band. &ldquo;Not enough past events&rdquo; means the flag is untested, not proven.</p>

      <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, margin: "16px 0 8px" }}>The cutoff is earned, not chosen</div>
      <p style={{ margin: "0 0 8px" }}>
        Leave <strong>×normal</strong> at <strong>0</strong> and the study sets it: it sweeps candidate levels
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

      <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, margin: "16px 0 8px" }}>The log — believe this over the study</div>
      <p style={{ margin: "0 0 8px" }}>
        A recorder writes the alerts down every day at 16:40 ET and grades them once the next session
        exists. <strong>logged_feed</strong> is that record — the line exactly as it was said on the day,
        with the outcome appended. <strong>track_record</strong> is the same thing summarised, and it is{" "}
        <strong style={{ color: LIGHT_BLUE }}>forward-tested</strong>: nothing in it was chosen after seeing
        the outcome, which is exactly what you cannot say about the calibration sweep. Where the two
        disagree, the log wins.
      </p>

      <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE, margin: "16px 0 8px" }}>Two lanes, two cadences</div>
      <p style={{ margin: "0 0 5px" }}><strong style={{ color: LIGHT_BLUE }}>Building now</strong> — polls <code>/api/gex-watch-live</code>. One query over ~5 days of <code>strike_growth</code>, time-of-day matched. No odds, ever, on this lane.</p>
      <p style={{ margin: "0 0 8px" }}><strong style={{ color: LIGHT_BLUE }}>Since last close</strong> — the full sweep, on demand only. It is a 169-ticker window-function scan and its input changes once a day at the recorder run, so polling it would burn the database for a number that cannot have moved.</p>
      <p style={{ margin: "0 0 8px" }}>
        <strong>run checks</strong> is off by default because each one runs its own full-history query.
        Tick it and you get <strong>premove_check</strong> — the same study run backwards, starting from the moves
        and looking back, printing move-days next to quiet-days. <strong>If those two rows look alike, the cutoff
        is describing noise</strong> however good its lift looks.
      </p>
      <p style={{ margin: "6px 0 0", color: HOME_THEME.text }}>
        If the daily feed goes quiet for days, check <strong>coverage</strong> first: an empty feed is a real
        answer at an earned cutoff, but a stalled recorder looks identical from here.
      </p>
    </div>
  );
}
