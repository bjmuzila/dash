import { useCallback, useEffect, useState } from "react";
import {
  OWNER_THEME as HOME_THEME,
  homeButtonStyle,
  homePanelStyle,
  homeSecondaryButtonStyle,
} from "../lib/theme";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER CONTROLS — feed toggles, manual job triggers, and signal-alert switches.
 *
 * Lifted out of ControlPanel's Infra tab (which no longer exists) into a
 * self-contained component so it can render on the Admin page. It owns all of
 * its own state and fetches — nothing is threaded in from a parent.
 *
 * Note on duplication: ControlPanel's sidebar still has its own compact
 * idle/mvc/maintenance quick-toggles with their own copy of this state. Both
 * seed from the same /proxy endpoints on mount, so they converge; they're
 * deliberately independent rather than sharing a store, because a shared store
 * for three booleans isn't worth the coupling between two separate routes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function SpotFeedHealth() {
  const [ageMs, setAgeMs] = useState<number | null | undefined>(undefined);
  const [spot, setSpot] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/proxy/status", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        setAgeMs(j?.spotAgeMs ?? null);
        setSpot(Number(j?.spot) || null);
      } catch { if (alive) setAgeMs(null); }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const stale = ageMs == null || ageMs > 120_000;
  const slow = !stale && ageMs != null && ageMs > 20_000;
  const color = stale ? HOME_THEME.red : slow ? "#facc15" : "#00e676";
  const label = ageMs === undefined ? "…" : stale ? "STALE" : slow ? "SLOW" : "HEALTHY";
  const ageStr = ageMs == null ? "no ticks" : ageMs < 1000 ? "<1s ago" : `${Math.round(ageMs / 1000)}s ago`;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
      borderRadius: 12, border: `1px solid ${color}59`, background: `${color}12`,
    }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color }}>SPX Index Feed · {label}</div>
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, fontFamily: "var(--font-mono)" }}>
          spot {spot != null ? spot.toFixed(2) : "--"} · updated {ageStr}
        </div>
      </div>
      {stale && ageMs !== undefined && (
        <div style={{ marginLeft: "auto", fontSize: 14, color: HOME_THEME.red, opacity: 1, maxWidth: 220, textAlign: "right" }}>
          Index stream frozen — re-subscribe Theta / recreate dashboard.
        </div>
      )}
    </div>
  );
}

type ThetaStatsResp = {
  ok: boolean;
  cpuPercent?: number | null;
  memUsageBytes?: number | null;
  memLimitBytes?: number | null;
  memPercent?: number | null;
  pids?: number | null;
  status?: string;
  health?: string | null;
  restarting?: boolean;
  oomKilled?: boolean;
};

const MIB = 1024 * 1024;

// Live docker-stats readout for the theta-terminal container. Added after the
// 2026-07-07 heap OOM (options prints stopped mid-session, JVM heap exhausted
// — see docker-compose.yml theta-terminal comment) so a recurrence shows up
// here before it silently kills the feed again. Sources /api/owner/theta-stats,
// which reads the docker-socket-proxy sidecar (no raw docker.sock in the app
// container).
function ThetaTerminalStats() {
  const [data, setData] = useState<ThetaStatsResp | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/owner/theta-stats", { cache: "no-store" });
        const j = await r.json();
        if (alive) setData(r.ok ? j : null);
      } catch { if (alive) setData(null); }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const errored = data === null;
  const memPct = data?.memPercent ?? null;
  const unhealthy =
    !errored && data != null &&
    (data.status !== "running" || data.restarting || data.oomKilled || data.health === "unhealthy" || (memPct != null && memPct > 95));
  const warn = !errored && !unhealthy && ((memPct != null && memPct > 80) || data?.health === "starting");

  const color = errored || unhealthy ? HOME_THEME.red : warn ? "#facc15" : "#00e676";
  const label = data === undefined ? "…" : errored ? "UNREACHABLE" : unhealthy ? "UNHEALTHY" : warn ? "WARN" : "HEALTHY";

  const memStr = data?.memUsageBytes != null && data?.memLimitBytes
    ? `${(data.memUsageBytes / MIB).toFixed(0)}MiB / ${(data.memLimitBytes / MIB / 1024).toFixed(1)}GiB (${memPct?.toFixed(0)}%)`
    : "--";
  const cpuStr = data?.cpuPercent != null ? `${data.cpuPercent.toFixed(1)}%` : "--";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
      borderRadius: 12, border: `1px solid ${color}59`, background: `${color}12`,
    }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color }}>Theta Terminal · {label}</div>
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, fontFamily: "var(--font-mono)" }}>
          cpu {cpuStr} · mem {memStr} · pids {data?.pids ?? "--"}
        </div>
      </div>
      {errored && (
        <div style={{ marginLeft: "auto", fontSize: 14, color: HOME_THEME.red, opacity: 1, maxWidth: 220, textAlign: "right" }}>
          Stats unreachable — check docker-proxy sidecar.
        </div>
      )}
    </div>
  );
}

// ── Controls ─────────────────────────────────────────────────────────────────

type SignalAlertRow = { key: string; label: string; group: string; enabled: boolean };

export function OwnerControls() {
  // Live server switches. `null` means "not read back from the server yet" so
  // the UI can show — instead of guessing a default and flickering.
  const [isIdle, setIsIdle] = useState<boolean | null>(null);
  const [mvcAuto, setMvcAuto] = useState<boolean | null>(null);
  const [maint, setMaint] = useState<boolean | null>(null);
  const [ctlBusy, setCtlBusy] = useState<string | null>(null);
  const [ctlMsg, setCtlMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null);

  const flashMsg = useCallback((key: string, text: string, ok: boolean) => {
    setCtlMsg({ key, text, ok });
    setTimeout(() => setCtlMsg((m) => (m?.key === key ? null : m)), 4000);
  }, []);

  // Seed the three toggles from the server. Without this they read — forever.
  useEffect(() => {
    fetch("/proxy/idle").then((r) => r.json()).then((j) => setIsIdle(!!j?.idle)).catch(() => { /* non-fatal */ });
    fetch("/proxy/mvc-auto").then((r) => r.json()).then((j) => setMvcAuto(!!j?.enabled)).catch(() => { /* non-fatal */ });
    fetch("/proxy/maintenance").then((r) => r.json()).then((j) => setMaint(!!j?.maintenance)).catch(() => { /* non-fatal */ });
  }, []);

  // Signal Alerts — live DB-backed per-alert-key toggles for the background
  // alert workers.
  const [signalAlerts, setSignalAlerts] = useState<SignalAlertRow[] | null>(null);
  const [signalAlertsBusy, setSignalAlertsBusy] = useState<string | null>(null);

  const loadSignalAlerts = useCallback(async () => {
    try {
      const r = await fetch("/proxy/signal-alerts");
      const j = await r.json();
      if (Array.isArray(j?.alerts)) setSignalAlerts(j.alerts);
    } catch { /* non-fatal */ }
  }, []);
  useEffect(() => { void loadSignalAlerts(); }, [loadSignalAlerts]);

  const toggleSignalAlert = useCallback(async (key: string, current: boolean) => {
    const next = !current;
    setSignalAlertsBusy(key);
    // Optimistic flip.
    setSignalAlerts((rows) => rows ? rows.map((r) => (r.key === key ? { ...r, enabled: next } : r)) : rows);
    try {
      const r = await fetch("/proxy/signal-alerts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled: next }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      flashMsg(`sigalert-${key}`, `${key} → ${next ? "ON" : "OFF"}`, true);
    } catch (e) {
      // Revert on failure.
      setSignalAlerts((rows) => rows ? rows.map((r) => (r.key === key ? { ...r, enabled: current } : r)) : rows);
      flashMsg(`sigalert-${key}`, `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally {
      setSignalAlertsBusy(null);
    }
  }, [flashMsg]);

  const toggleIdle = useCallback(async () => {
    const next = !isIdle;
    setCtlBusy("idle");
    try {
      const r = await fetch("/proxy/idle", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idle: next }),
      });
      const j = await r.json();
      setIsIdle(typeof j.idle === "boolean" ? j.idle : next);
      flashMsg("idle", next ? "Feed paused (idle ON)" : "Feed resumed (idle OFF)", true);
    } catch (e) {
      flashMsg("idle", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); }
  }, [isIdle, flashMsg]);

  const toggleMvcAuto = useCallback(async () => {
    const next = !mvcAuto;
    setCtlBusy("mvcAuto");
    try {
      const r = await fetch("/proxy/mvc-auto", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      const j = await r.json();
      setMvcAuto(typeof j.enabled === "boolean" ? j.enabled : next);
      flashMsg("mvcAuto", next ? "CB - Core Bullseye auto-snapshot ON" : "CB - Core Bullseye auto-snapshot OFF", true);
    } catch (e) {
      flashMsg("mvcAuto", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); }
  }, [mvcAuto, flashMsg]);

  const toggleMaint = useCallback(async () => {
    const next = !maint;
    // Turning ON locks out customers — confirm. Turning OFF is safe.
    if (next && !window.confirm("Enable maintenance mode?\n\nAll non-owner users will be redirected to the maintenance page until you turn it off.")) return;
    setCtlBusy("maint");
    try {
      const r = await fetch("/proxy/maintenance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      const j = await r.json();
      setMaint(typeof j.maintenance === "boolean" ? j.maintenance : next);
      flashMsg("maint", next ? "Maintenance mode ON — customers locked out" : "Maintenance mode OFF — site live", true);
    } catch (e) {
      flashMsg("maint", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); }
  }, [maint, flashMsg]);

  const doReconnect = useCallback(async () => {
    if (!window.confirm("Reconnect the TT/dxLink feed now? Live data drops for a few seconds while it re-establishes.")) return;
    setCtlBusy("reconnect");
    try {
      const r = await fetch("/proxy/reconnect", { method: "POST" });
      const j = await r.json();
      flashMsg("reconnect", j?.ok ? "Feed reconnected" : `Failed: ${j?.error || r.status}`, !!j?.ok);
    } catch (e) {
      flashMsg("reconnect", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); }
  }, [flashMsg]);

  const doEodRun = useCallback(async () => {
    setCtlBusy("eod");
    try {
      const r = await fetch("/proxy/eod-gex-run", { method: "POST" });
      const j = await r.json();
      const saved = j?.result?.saved?.length ? j.result.saved.join(", ") : "none";
      flashMsg("eod", j?.ok ? `EOD GEX saved: ${saved}` : `Failed: ${j?.error || r.status}`, !!j?.ok);
    } catch (e) {
      flashMsg("eod", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); }
  }, [flashMsg]);

  const doMvcSnapshot = useCallback(async () => {
    setCtlBusy("mvcSnap");
    try {
      // force=1 → manual owner snapshot overrides the outside-RTH guard.
      const r = await fetch("/proxy/mvc-snapshot?force=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const j = await r.json();
      flashMsg("mvcSnap", j?.ok ? `Snapshot saved · MVC ${j.strike} · SPX ${j.spot}` : `Skipped: ${j?.error || r.status}`, !!j?.ok);
    } catch (e) {
      flashMsg("mvcSnap", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); }
  }, [flashMsg]);

  const doPremarketRun = useCallback(async () => {
    setCtlBusy("premarket");
    try {
      const r = await fetch("/proxy/premarket-summary-run", { method: "POST" });
      const j = await r.json();
      flashMsg("premarket", j?.ok ? "Premarket summary generated" : `Failed: ${j?.error || r.status}`, !!j?.ok);
    } catch (e) {
      flashMsg("premarket", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); }
  }, [flashMsg]);

  const doStrategyRun = useCallback(async () => {
    setCtlBusy("strategy");
    try {
      const r = await fetch("/proxy/strategy-run", { method: "POST" });
      const j = await r.json();
      flashMsg("strategy", j?.ok ? "Daily strategy generated" : `Failed: ${j?.error || r.status}`, !!j?.ok);
    } catch (e) {
      flashMsg("strategy", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); }
  }, [flashMsg]);

  const doClearChat = useCallback(async () => {
    if (!window.confirm("Erase ALL subscriber chat messages? This cannot be undone.")) return;
    setCtlBusy("clearChat");
    try {
      const r = await fetch("/api/chat/clear", { method: "POST" });
      const j = await r.json();
      flashMsg("clearChat", j?.ok ? `Chat cleared (${j.deleted ?? "?"} messages)` : `Failed: ${j?.error || r.status}`, !!j?.ok);
    } catch (e) {
      flashMsg("clearChat", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); }
  }, [flashMsg]);

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${HOME_THEME.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: HOME_THEME.cyan }}>Controls</span>
        <span style={{ fontSize: 14, color: HOME_THEME.textSecondary, fontFamily: "var(--font-mono)" }}>
          {`idle ${isIdle == null ? "—" : isIdle ? "ON" : "OFF"} · mvc ${mvcAuto == null ? "—" : mvcAuto ? "ON" : "OFF"} · maint ${maint == null ? "—" : maint ? "ON" : "OFF"}`}
        </span>
      </div>
      <div style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* SPX index-feed health (frozen-spot detector) + quick link to the page */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px", minWidth: 260 }}><SpotFeedHealth /></div>
          <a href="/greeks" style={{ ...homeSecondaryButtonStyle, padding: "8px 16px", borderRadius: 8, textDecoration: "none", fontSize: 14, whiteSpace: "nowrap" }}>
            Open Greeks →
          </a>
        </div>
        {/* theta-terminal container health (cpu/mem/pids) — live docker stats */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px", minWidth: 260 }}><ThetaTerminalStats /></div>
        </div>
        {/* Toggles */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
          {/* Idle */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em" }}>Idle Mode (feed)</span>
            <button
              onClick={toggleIdle}
              disabled={ctlBusy === "idle"}
              title="Pause/resume the live TT/dxLink feed. Idle ON stops recompute, flow, OI, and candle timers."
              style={{
                ...homeButtonStyle, padding: "7px 18px", borderRadius: 8, fontSize: 14,
                opacity: ctlBusy === "idle" ? 0.6 : 1,
                cursor: ctlBusy === "idle" ? "wait" : "pointer",
              }}
            >
              {ctlBusy === "idle" ? "…" : isIdle == null ? "—" : isIdle ? "● Idle ON — resume" : "○ Idle OFF — pause"}
            </button>
          </div>
          {/* MVC auto */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em" }}>CB Auto (5m)</span>
            <button
              onClick={toggleMvcAuto}
              disabled={ctlBusy === "mvcAuto"}
              title="Enable/disable the in-process CB - Core Bullseye auto-collector (writes mvc_snapshots every 5m during RTH)."
              style={{
                ...homeButtonStyle, padding: "7px 18px", borderRadius: 8, fontSize: 14,
                opacity: ctlBusy === "mvcAuto" ? 0.6 : 1,
                cursor: ctlBusy === "mvcAuto" ? "wait" : "pointer",
              }}
            >
              {ctlBusy === "mvcAuto" ? "…" : mvcAuto == null ? "—" : mvcAuto ? "● Auto ON — disable" : "○ Auto OFF — enable"}
            </button>
          </div>
          {/* Maintenance mode */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em" }}>Maintenance</span>
            <button
              onClick={toggleMaint}
              disabled={ctlBusy === "maint"}
              title="When ON, all non-owner users are redirected to the maintenance page. You (owner) keep full access."
              style={{
                ...homeButtonStyle, padding: "7px 18px", borderRadius: 8, fontSize: 14,
                opacity: ctlBusy === "maint" ? 0.6 : 1,
                cursor: ctlBusy === "maint" ? "wait" : "pointer",
              }}
            >
              {ctlBusy === "maint" ? "…" : maint == null ? "—" : maint ? "● Maint ON — go live" : "○ Maint OFF — enable"}
            </button>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            onClick={doReconnect}
            disabled={ctlBusy === "reconnect"}
            title="Tear down and re-establish the TT/dxLink feed (recovers from a dropped socket or expired auth without a Render restart)."
            style={{ ...homeButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 14, opacity: ctlBusy === "reconnect" ? 0.6 : 1, cursor: ctlBusy === "reconnect" ? "wait" : "pointer" }}
          >
            {ctlBusy === "reconnect" ? "Reconnecting…" : "↻ Reconnect Feed"}
          </button>
          <button
            onClick={doEodRun}
            disabled={ctlBusy === "eod"}
            title="Manually fire the EOD GEX recorder for $SPX/SPY/QQQ (in case the 3:55–4:05 ET window was missed)."
            style={{ ...homeButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 14, opacity: ctlBusy === "eod" ? 0.6 : 1, cursor: ctlBusy === "eod" ? "wait" : "pointer" }}
          >
            {ctlBusy === "eod" ? "Recording…" : "▶ Run EOD GEX now"}
          </button>
          <button
            onClick={doMvcSnapshot}
            disabled={ctlBusy === "mvcSnap"}
            title="Write a single CB - Core Bullseye snapshot right now (overrides the outside-RTH guard; still needs a live chain)."
            style={{ ...homeButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 14, opacity: ctlBusy === "mvcSnap" ? 0.6 : 1, cursor: ctlBusy === "mvcSnap" ? "wait" : "pointer" }}
          >
            {ctlBusy === "mvcSnap" ? "Snapshotting (may reconnect)…" : "📸 CB Snapshot now"}
          </button>
          <button
            onClick={doPremarketRun}
            disabled={ctlBusy === "premarket"}
            title="Generate the Analytics Premarket card's 5-bullet AI summary now (instead of waiting for the ~8am ET run)."
            style={{ ...homeButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 14, opacity: ctlBusy === "premarket" ? 0.6 : 1, cursor: ctlBusy === "premarket" ? "wait" : "pointer" }}
          >
            {ctlBusy === "premarket" ? "Generating…" : "📝 Premarket Summary now"}
          </button>
          <button
            onClick={doStrategyRun}
            disabled={ctlBusy === "strategy"}
            title="Generate the Analytics Strategy Builder card's full daily AI plan now (instead of waiting for the hourly run)."
            style={{ ...homeButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 14, opacity: ctlBusy === "strategy" ? 0.6 : 1, cursor: ctlBusy === "strategy" ? "wait" : "pointer" }}
          >
            {ctlBusy === "strategy" ? "Generating…" : "🎯 Strategy now"}
          </button>
          <button
            onClick={doClearChat}
            disabled={ctlBusy === "clearChat"}
            title="Permanently delete ALL subscriber chat messages. Cannot be undone."
            style={{ ...homeButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 14, opacity: ctlBusy === "clearChat" ? 0.6 : 1, cursor: ctlBusy === "clearChat" ? "wait" : "pointer" }}
          >
            {ctlBusy === "clearChat" ? "Erasing…" : "🗑️ Erase all chat"}
          </button>
        </div>

        {/* Result message */}
        {ctlMsg && (
          <div style={{
            fontSize: 14, fontFamily: "var(--font-mono)", padding: "8px 10px", borderRadius: 8,
            background: ctlMsg.ok ? "rgba(255,255,255,0.05)" : "rgba(239,68,68,0.10)",
            border: `1px solid ${ctlMsg.ok ? HOME_THEME.green : HOME_THEME.red}44`,
            color: ctlMsg.ok ? HOME_THEME.green : HOME_THEME.red,
          }}>
            {ctlMsg.ok ? "✓ " : "✗ "}{ctlMsg.text}
          </div>
        )}

        {/* ── Signal Alerts — live per-kind toggles for the background trade-signal
            engine (Discord "CB Edge Signals"). DB-backed; a flip here takes effect
            within ~20s, no redeploy. Replaces the old compile-time env kill switches. */}
        <div style={{ borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.text }}>Signal Alerts</span>
            <span style={{ fontSize: 14, color: HOME_THEME.textMuted }}>
              on/off per alert type for the background signals engine → Discord. No redeploy needed.
            </span>
          </div>
          {!signalAlerts ? (
            <span style={{ fontSize: 14, color: HOME_THEME.textMuted }}>Loading…</span>
          ) : (() => {
            const masterEnabled = signalAlerts.find((r) => r.key === "bzila_confluence")?.enabled ?? true;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {signalAlerts.map((row) => {
                  const isBzilaSub = row.group === "bzila" && row.key !== "bzila_confluence";
                  const dimmed = isBzilaSub && !masterEnabled;
                  const busy = signalAlertsBusy === row.key;
                  return (
                    <div
                      key={row.key}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        paddingLeft: isBzilaSub ? 22 : 0,
                        opacity: dimmed ? 0.45 : 1,
                      }}
                    >
                      <button
                        onClick={() => toggleSignalAlert(row.key, row.enabled)}
                        disabled={busy}
                        title={
                          row.key === "bzila_confluence"
                            ? "Master switch — must be ON for any Bzila sub-setup below to fire."
                            : isBzilaSub
                            ? "Independently toggleable, but only fires while the Bzila Confluence master switch above is also ON."
                            : undefined
                        }
                        style={{
                          ...homeButtonStyle, padding: "4px 12px", borderRadius: 7, fontSize: 14,
                          minWidth: 74, textAlign: "center",
                          opacity: busy ? 0.6 : 1,
                          cursor: busy ? "wait" : "pointer",
                          background: row.enabled ? homeButtonStyle.background : "rgba(255,255,255,0.04)",
                        }}
                      >
                        {busy ? "…" : row.enabled ? "● ON" : "○ OFF"}
                      </button>
                      <span style={{ fontSize: 14, color: HOME_THEME.text }}>{row.label}</span>
                      <span
                        style={{
                          fontSize: 12, fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase",
                          padding: "2px 7px", borderRadius: 5,
                          color: row.group === "bzila" ? HOME_THEME.cyan : HOME_THEME.textMuted,
                          border: `1px solid ${row.group === "bzila" ? HOME_THEME.cyan : HOME_THEME.border}66`,
                        }}
                      >
                        {row.group}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>
      </div>
    </div>
  );
}

export default OwnerControls;
