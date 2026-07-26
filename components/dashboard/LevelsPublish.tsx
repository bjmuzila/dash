"use client";

import { useCallback, useEffect, useState } from "react";
import {
  HOME_THEME,
  homeButtonStyle,
  homePanelStyle,
  homeSecondaryButtonStyle,
} from "@/components/shared/homeTheme";

// ─── Helpers (ported from the owner dashboard) ──────────────────────────────

/** "Jun 21, 09:00 (2h ago)" style for the levels last-run stamp. */
function fmtLastRun(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  const ago = mins < 60 ? `${mins}m ago`
    : mins < 1440 ? `${Math.round(mins / 60)}h ago`
    : `${Math.round(mins / 1440)}d ago`;
  const stamp = d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "America/New_York",
  });
  return `${stamp} ET (${ago})`;
}

/** Stale if the newest levels row is older than ~8 days (a weekly cadence missed a run). */
function levelsAreStale(iso: string | null): boolean {
  if (!iso) return true;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return true;
  return Date.now() - d.getTime() > 8 * 24 * 60 * 60 * 1000;
}

/**
 * Start of the current publish window — the most recent Friday 16:00 ET. Mirrors
 * publishWindowStartET() in server-v2/api-router.js and PUBLISH_DOW/PUBLISH_HOUR
 * in levels-auto-publish.js; keep the three in step.
 */
function publishWindowStartET(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[get("weekday") || "Sun"];
  const mins = ((dow - 5) * 24 * 60) + Number(get("hour")) * 60 + Number(get("minute")) - 16 * 60;
  const offsetMin = mins >= 0 ? mins : mins + 7 * 24 * 60;
  return now.getTime() - offsetMin * 60 * 1000;
}

/**
 * A ticker's EM is STALE if it wasn't priced inside the current publish window —
 * i.e. em_updated_at predates the most recent Friday 16:00 ET, so /em is showing
 * a straddle struck for a week that has already expired.
 *
 * This used to compare em_updated_at against updated_at with a 10-minute
 * tolerance, which silently missed the common case: a ticker that THROWS during
 * the run is never POSTed at all, so both stamps stay frozen together at
 * whenever it last worked and the row looked fresh.
 */
function emIsStale(_updatedAt: string | null, emUpdatedAt: string | null): boolean {
  if (!emUpdatedAt) return true;
  const em = new Date(emUpdatedAt).getTime();
  if (isNaN(em)) return true;
  return em < publishWindowStartET();
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "3px 9px", borderRadius: 20,
        fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
        background: ok ? "rgba(16,185,129,0.14)" : "rgba(239,68,68,0.14)",
        border: `1px solid ${ok ? HOME_THEME.green : HOME_THEME.red}44`,
        color: ok ? HOME_THEME.green : HOME_THEME.red,
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: ok ? HOME_THEME.green : HOME_THEME.red,
        boxShadow: ok ? `0 0 6px ${HOME_THEME.green}` : `0 0 6px ${HOME_THEME.red}`,
      }} />
      {label}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.16em", marginBottom: 6 }}>
      {children}
    </div>
  );
}

// Core "Estimated Moves" watchlist — the zone roster (display labels ESU/NQU).
const CORE_EM_TICKERS = ["SPX", "NDX", "ESU", "NQU", "SPY", "QQQ", "IWM"];

// TradingView watchlist export — the combined indicator is filtered to these
// (intersected with tickers that actually have levels).
const WATCHLIST =
  "CME_MINI:ESU2026,CME_MINI:NQU2026,AMEX:SPY,NASDAQ:QQQ,SPCFD:SPX,NASDAQ:NDX,CBOE:UVXY," +
  "NASDAQ:AAPL,NASDAQ:AMD,NASDAQ:AMZN,NASDAQ:GOOGL,NASDAQ:META,NASDAQ:MSFT,NASDAQ:NVDA,NASDAQ:SPCX,NASDAQ:TSLA," +
  "NASDAQ:ASTS,NASDAQ:AVGO,NASDAQ:BYND,NYSE:CMG,NASDAQ:COIN,NASDAQ:NFLX,NYSE:NOK,NYSE:OSCR,NASDAQ:PLTR,NYSE:QBTS," +
  "NASDAQ:QUBT,NASDAQ:RGTI,NASDAQ:RIVN,AMEX:SLV,NASDAQ:SMCI,NASDAQ:SOFI,NASDAQ:SOUN,AMEX:SOXL,NASDAQ:TQQQ," +
  "NASDAQ:ABNB,NASDAQ:AFRM,NASDAQ:ARM,NYSE:BA,NYSE:BABA,NYSE:CCJ,NYSE:CHWY,NASDAQ:COST,NYSE:CRM,NASDAQ:CRWD," +
  "NYSE:FDX,NYSE:GS,NYSE:HIMS,NASDAQ:INTC,NASDAQ:IREN,AMEX:IWM,NYSE:LLY,NYSE:MA,NASDAQ:MARA,NYSE:MCD,NYSE:MRK," +
  "NASDAQ:MRNA,NASDAQ:MU,NYSE:NIO,NYSE:NKE,NYSE:OKLO,NASDAQ:OPEN,NYSE:OXY,NASDAQ:PDD,NYSE:PFE,NASDAQ:PTON," +
  "NYSE:RBLX,NASDAQ:RIOT,NASDAQ:RKLB,NASDAQ:ROKU,NYSE:SE,NASDAQ:SMH,NASDAQ:SNDK,NYSE:SNOW,NYSE:TGT,NYSE:TSM," +
  "NASDAQ:TTD,NYSE:U,NYSE:UNH,NYSE:UPS,NASDAQ:UPST,NYSE:V,NYSE:XPEV";

// failedEm may arrive as string[] (legacy) or {ticker,reason}[]; normalize.
const normFailedEm = (raw: unknown): { ticker: string; reason?: string }[] =>
  Array.isArray(raw)
    ? raw.map((f) => (typeof f === "string" ? { ticker: f } : (f as { ticker: string; reason?: string }))).filter((f) => f && f.ticker)
    : [];

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Levels auto-publish control surface for the /em customer feed. Moved here from
 * the owner dashboard so it lives on the Estimated Moves → EM Tracker tab.
 * Self-contained: owns its own fetch/poll state, no props required.
 */
export default function LevelsPublish() {
  const [levels, setLevels] = useState<{
    count: number;
    lastRun: string | null;
    emGrabbed: string | null;
    tickers: Array<{ ticker: string; stale: boolean }>;
  }>({ count: 0, lastRun: null, emGrabbed: null, tickers: [] });

  const [pubRun, setPubRun] = useState<{
    running: boolean;
    at: string | null;
    reason: string | null;
    ms: number | null;
    emOk: number | null;
    emTotal: number | null;
    posted: number | null;
    failedEm: { ticker: string; reason?: string }[];
    error: string | null;
  }>({ running: false, at: null, reason: null, ms: null, emOk: null, emTotal: null, posted: null, failedEm: [], error: null });

  const [publishing, setPublishing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [copiedTicker, setCopiedTicker] = useState<string | null>(null);
  const [copyingAll, setCopyingAll] = useState(false);

  // ── Data refresh ──────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const lr = await fetch("/api/levels", { cache: "no-store" });
      if (lr.ok) {
        const all = (await lr.json()) as Array<{ ticker?: string; updated_at?: string; em_updated_at?: string }>;
        if (Array.isArray(all) && all.length) {
          const lastRun = all.map((r) => r.updated_at).filter(Boolean).sort().pop() ?? null;
          const emGrabbed = all.map((r) => r.em_updated_at).filter(Boolean).sort().pop() ?? null;
          setLevels({
            count: all.length,
            lastRun: lastRun as string | null,
            emGrabbed: emGrabbed as string | null,
            tickers: all.filter((r) => r.ticker).map((r) => ({
              ticker: String(r.ticker),
              stale: emIsStale(r.updated_at ?? null, r.em_updated_at ?? null),
            })),
          });
        } else {
          setLevels({ count: 0, lastRun: null, emGrabbed: null, tickers: [] });
        }
      }
    } catch { /* non-fatal */ }

    try {
      const ps = await fetch("/proxy/levels-status", { cache: "no-store" });
      if (ps.ok) {
        const j = await ps.json();
        const lr = j?.lastRun ?? null;
        setPubRun({
          running: !!j?.running,
          at: lr?.at ?? null,
          reason: lr?.reason ?? null,
          ms: typeof lr?.ms === "number" ? lr.ms : null,
          emOk: typeof lr?.emOk === "number" ? lr.emOk : null,
          emTotal: typeof lr?.emTotal === "number" ? lr.emTotal : null,
          posted: typeof lr?.posted === "number" ? lr.posted : null,
          failedEm: normFailedEm(lr?.failedEm),
          error: lr?.error ?? null,
        });
      }
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  // ── Pine copy ───────────────────────────────────────────────────────────
  const copyPine = useCallback(async (ticker: string) => {
    try {
      const r = await fetch(`/api/pinescript?ticker=${encodeURIComponent(ticker)}&format=json`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.pine) throw new Error(j?.error || "no script");
      await navigator.clipboard.writeText(j.pine);
      setCopiedTicker(ticker);
      setTimeout(() => setCopiedTicker((c) => (c === ticker ? null : c)), 1500);
    } catch (err) {
      window.alert(`Copy Pine failed for ${ticker}: ${String((err as Error)?.message || err)}`);
    }
  }, []);

  const copyAllPine = useCallback(async () => {
    if (copyingAll) return;
    setCopyingAll(true);
    try {
      const r = await fetch(`/api/pinescript?all=1&format=json&symbols=${encodeURIComponent(WATCHLIST)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.pine) throw new Error(j?.error || "no script");
      await navigator.clipboard.writeText(j.pine);
      setCopiedTicker("__ALL__");
      setTimeout(() => setCopiedTicker((c) => (c === "__ALL__" ? null : c)), 1500);
    } catch (err) {
      window.alert(`Copy combined Pine failed: ${String((err as Error)?.message || err)}`);
    } finally {
      setCopyingAll(false);
    }
  }, [copyingAll]);

  // ── Publish / retry ───────────────────────────────────────────────────────
  const pollPublishStatus = useCallback((done: () => void) => {
    const startedAt = Date.now();
    const poll = async (): Promise<void> => {
      try {
        const ps = await fetch("/proxy/levels-status", { cache: "no-store" });
        if (ps.ok) {
          const j = await ps.json();
          const lr = j?.lastRun ?? null;
          setPubRun({
            running: !!j?.running,
            at: lr?.at ?? null,
            reason: lr?.reason ?? null,
            ms: typeof lr?.ms === "number" ? lr.ms : null,
            emOk: typeof lr?.emOk === "number" ? lr.emOk : null,
            emTotal: typeof lr?.emTotal === "number" ? lr.emTotal : null,
            posted: typeof lr?.posted === "number" ? lr.posted : null,
            failedEm: normFailedEm(lr?.failedEm),
            error: lr?.error ?? null,
          });
          if (!j?.running) { done(); void refresh(); return; }
        }
      } catch { /* keep polling */ }
      if (Date.now() - startedAt > 10 * 60 * 1000) { done(); return; }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 2000);
  }, [refresh]);

  const triggerPublish = useCallback(async () => {
    if (publishing || retrying) return;
    if (!window.confirm("Publish weekly EM levels for the ENTIRE roster now?\n\nThis overwrites this week's snapshot and takes a few minutes.")) return;
    if (!window.confirm("Are you sure? This will replace the current published levels on the customer /em page.")) return;
    setPublishing(true);
    try {
      // Server-side gate: the proxy rejects any publish POST without this token,
      // so a bare/accidental POST can't republish. Only this confirmed path sends it.
      await fetch("/proxy/levels-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "PUBLISH" }),
      });
    } catch { /* the poll below still reflects state */ }
    pollPublishStatus(() => setPublishing(false));
  }, [publishing, retrying, pollPublishStatus]);

  const triggerRetry = useCallback(async () => {
    if (publishing || retrying) return;
    const n = pubRun.failedEm.length;
    if (!n) return;
    if (!window.confirm(`Retry the ${n} not-found ticker${n === 1 ? "" : "s"} only?\n\nRecomputes just those rows; the rest of the published roster is untouched.`)) return;
    setRetrying(true);
    try {
      await fetch("/proxy/levels-retry-failed", { method: "POST" });
    } catch { /* the poll below still reflects state */ }
    pollPublishStatus(() => setRetrying(false));
  }, [publishing, retrying, pubRun.failedEm.length, pollPublishStatus]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ ...homePanelStyle, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionLabel>Levels Publish · /em feed</SectionLabel>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <StatusBadge
          ok={!levelsAreStale(levels.lastRun)}
          label={levels.lastRun ? (levelsAreStale(levels.lastRun) ? "Stale" : "Current") : "Never run"}
        />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.12em" }}>Last Published</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.cyan, fontFamily: "var(--font-mono)" }}>{fmtLastRun(levels.lastRun)}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.12em" }}>EM Grabbed</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.cyan, fontFamily: "var(--font-mono)" }}>{fmtLastRun(levels.emGrabbed)}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.12em" }}>Tickers</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.cyan, fontFamily: "var(--font-mono)" }}>{levels.count}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.12em" }}>Schedule</span>
          {/* Mirrors PUBLISH_DOW/PUBLISH_HOUR in server-v2/levels-auto-publish.js. */}
          <span style={{ fontSize: 12, fontWeight: 600, color: "#fff", fontFamily: "var(--font-mono)" }}>Fri ~16:15 ET</span>
        </div>
        <button
          onClick={triggerPublish}
          disabled={publishing || pubRun.running}
          title="Compute & publish weekly EM levels for the whole roster now (~45s for the current roster). Overwrites the current weekly snapshot."
          style={{
            ...homeButtonStyle, padding: "6px 16px", borderRadius: 8, fontSize: 12, marginLeft: "auto",
            opacity: (publishing || pubRun.running) ? 0.6 : 1,
            cursor: (publishing || pubRun.running) ? "not-allowed" : "pointer",
          }}
        >
          {(publishing || pubRun.running) ? "Publishing…" : "Publish Now"}
        </button>
        <a href="/database" style={{ ...homeSecondaryButtonStyle, padding: "6px 14px", borderRadius: 8, textDecoration: "none", fontSize: 12 }}>
          View table →
        </a>
      </div>

      {(pubRun.running || pubRun.at) && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 12, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: `1px solid ${HOME_THEME.border}` }}>
          {pubRun.running ? (
            <span style={{ fontWeight: 800, color: HOME_THEME.cyan }}>● Running… computing levels (this can take a few minutes)</span>
          ) : (
            <>
              <span style={{ fontWeight: 800, color: pubRun.error ? HOME_THEME.red : HOME_THEME.green }}>
                {pubRun.error ? "✗ Failed" : "✓ Last run OK"}
              </span>
              {pubRun.emTotal != null && (
                <span style={{ color: "#fff", fontFamily: "var(--font-mono)" }}>
                  EM <b style={{ color: (pubRun.failedEm.length ? HOME_THEME.orange : HOME_THEME.green) }}>{pubRun.emOk}/{pubRun.emTotal}</b>
                  {pubRun.posted != null ? <> · {pubRun.posted} rows</> : null}
                </span>
              )}
              {pubRun.ms != null && <span style={{ color: HOME_THEME.muted }}>in {Math.round(pubRun.ms / 1000)}s</span>}
              {pubRun.at && <span style={{ color: HOME_THEME.muted }}>{fmtLastRun(pubRun.at)}</span>}
              {pubRun.reason && <span style={{ color: HOME_THEME.muted }}>({pubRun.reason})</span>}
              {pubRun.error && <span style={{ color: HOME_THEME.red }}>{pubRun.error}</span>}
            </>
          )}
        </div>
      )}
      {!pubRun.running && pubRun.failedEm.length > 0 && (
        <div style={{ fontSize: 10, color: HOME_THEME.orange, lineHeight: 1.6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <b>No EM priced ({pubRun.failedEm.length}):</b>
            <button
              onClick={triggerRetry}
              disabled={retrying || publishing}
              style={{
                fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 6, cursor: (retrying || publishing) ? "default" : "pointer",
                color: (retrying || publishing) ? HOME_THEME.muted : "#000",
                background: (retrying || publishing) ? "rgba(255,255,255,0.06)" : HOME_THEME.orange,
                border: `1px solid ${HOME_THEME.orange}`, opacity: (retrying || publishing) ? 0.6 : 1,
              }}
              title="Recompute and publish ONLY these tickers — the rest of the roster is untouched."
            >
              {retrying ? "Retrying…" : "↻ Retry not-found only"}
            </button>
          </div>
          {pubRun.failedEm.map((f) => (
            <span key={f.ticker} style={{ marginRight: 10, whiteSpace: "nowrap" }}>
              <b style={{ color: "#fff" }}>{f.ticker}</b>
              {f.reason ? <span style={{ color: HOME_THEME.muted }}> ({f.reason})</span> : null}
            </span>
          ))}
          <div style={{ color: HOME_THEME.muted, marginTop: 3 }}>
            Usually illiquid / no quoted weekly straddle, or after-hours. Retry once liquidity returns.
          </div>
        </div>
      )}
      {levels.tickers.length > 0 && (
        <>
          {levels.tickers.some((t) => t.stale) && (
            <div style={{ fontSize: 10, fontWeight: 700, color: HOME_THEME.orange, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: HOME_THEME.orange, display: "inline-block" }} />
              {levels.tickers.filter((t) => t.stale).length} of {levels.tickers.length} ticker(s) haven’t priced an EM since Friday’s close — their band is blanked on /em until a retry pass fills it in.
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => void copyAllPine()}
              disabled={copyingAll}
              title={`Copy ONE combined indicator for the core EM watchlist (${CORE_EM_TICKERS.join(", ")})`}
              style={{
                fontSize: 10, fontWeight: 700, cursor: copyingAll ? "wait" : "pointer",
                color: copiedTicker === "__ALL__" ? HOME_THEME.green : HOME_THEME.cyan,
                background: copiedTicker === "__ALL__" ? "rgba(34,197,94,0.14)" : "rgba(33,158,188,0.15)",
                border: `1px solid ${copiedTicker === "__ALL__" ? HOME_THEME.green + "66" : HOME_THEME.cyan + "66"}`,
                padding: "3px 10px", borderRadius: 6, fontFamily: "var(--font-mono)",
              }}
            >
              {copiedTicker === "__ALL__" ? "✓ copied core" : copyingAll ? "copying…" : "⧉ Copy Core EM"}
            </button>
            {levels.tickers.map((t) => {
              const copied = copiedTicker === t.ticker;
              return (
                <button
                  key={t.ticker}
                  type="button"
                  onClick={() => void copyPine(t.ticker)}
                  title={`Click to copy Pine script.\n${t.stale ? "No EM priced since Friday’s close — band blanked on /em, retry loop is still trying this one" : "EM freshly computed this publish window"}`}
                  style={{
                    fontSize: 10, fontWeight: 700, cursor: "pointer",
                    color: copied ? HOME_THEME.green : t.stale ? HOME_THEME.orange : HOME_THEME.cyan,
                    background: copied ? "rgba(34,197,94,0.14)" : t.stale ? "rgba(249,115,22,0.12)" : "rgba(33,158,188,0.08)",
                    border: `1px solid ${copied ? HOME_THEME.green + "66" : t.stale ? HOME_THEME.orange + "66" : HOME_THEME.border}`,
                    padding: "3px 8px", borderRadius: 6, fontFamily: "var(--font-mono)",
                  }}
                >
                  {copied ? "✓ copied" : `${t.ticker}${t.stale ? " ⚠" : ""}`}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
