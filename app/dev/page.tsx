"use client";

import { useEffect, useRef, useState } from "react";


const C = { cyan: "#00F0FF", border: "rgba(255,255,255,0.10)", card: "rgba(13,17,25,0.55)", label: "#8da8c2" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.label, textTransform: "uppercase", letterSpacing: "0.14em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", fontFamily: "monospace" }}>{children}</div>
    </div>
  );
}

const FEED_ORDER = ["Quote", "Trade", "Summary", "Greeks"] as const;

function fmt(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
  return String(v);
}

// Compact formatter for big exposure numbers (B/M/K), signed.
function fmtExp(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(3)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(2)}`;
}

const EXPOSURE_ROWS: { key: string; label: string }[] = [
  { key: "gex", label: "GEX (γ·OI·S²)" },
  { key: "dex", label: "DEX (δ·OI·100·S)" },
  { key: "vex", label: "VEX (vega·OI·100·S)" },
  { key: "thetaExp", label: "Theta exp" },
  { key: "gexVol", label: "GEX (vol)" },
  { key: "vannaExp", label: "Vanna exp" },
  { key: "charmExp", label: "Charm exp" },
];

// 5th panel: net-greek exposures for the single contract.
function ExposurePanel({ data }: { data: Record<string, unknown> | undefined }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px" }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#ffb300", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 10 }}>Net Greeks</div>
      {!data && <div style={{ color: C.label, fontFamily: "monospace", fontSize: 13 }}>—</div>}
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {EXPOSURE_ROWS.map(({ key, label }) => {
            const v = data[key];
            const na = v == null;
            return (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: "monospace", fontSize: 13.5 }}>
                <span style={{ color: C.label }}>{label}</span>
                <span style={{ color: na ? "#5d7388" : (typeof v === "number" && v < 0 ? "#ff6b6b" : "#22e08a"), fontWeight: 700 }}>{na ? "n/a" : fmtExp(v)}</span>
              </div>
            );
          })}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: "monospace", fontSize: 12, color: C.label, marginTop: 4, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
            <span>spot</span><span>{fmt(data.spot)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// One feed-type panel: a titled card listing its key/value rows.
function FeedPanel({ name, data }: { name: string; data: Record<string, unknown> | undefined }) {
  const entries = data ? Object.entries(data) : [];
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px" }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 10 }}>{name}</div>
      {entries.length === 0 && <div style={{ color: C.label, fontFamily: "monospace", fontSize: 13 }}>—</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: "monospace", fontSize: 13.5 }}>
            <span style={{ color: C.label }}>{k}</span>
            <span style={{ color: v == null || v === "" ? "#5d7388" : "#cfe", fontWeight: 700 }}>{fmt(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DevPage() {
  const [ticker, setTicker] = useState("SPXW");
  const [side, setSide] = useState<"CALL" | "PUT">("PUT");
  const [strike, setStrike] = useState("7265");
  const [expiry, setExpiry] = useState("");
  const [expirations, setExpirations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [sentSymbol, setSentSymbol] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveMs, setLiveMs] = useState(0);
  const [logs, setLogs] = useState<{ t: number; level: "info" | "ok" | "warn" | "err"; msg: string }[]>([]);

  // Append a timestamped line to the on-page log panel (newest last, capped).
  function log(level: "info" | "ok" | "warn" | "err", msg: string) {
    setLogs((prev) => [...prev, { t: Date.now(), level, msg }].slice(-200));
  }

  // Abort handle for the poll loop + in-flight fetch.
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  function stop() {
    stopRef.current = true;
    abortRef.current?.abort();
    log("warn", "■ stopped by user");
    setStatusMsg("Stopped.");
    setLoading(false);
  }

  // Live "page is alive" counter — ticks up while polling so a stalled tab is obvious.
  useEffect(() => {
    if (!loading) return;
    const start = performance.now();
    setLiveMs(0);
    const id = setInterval(() => setLiveMs(Math.round(performance.now() - start)), 100);
    return () => clearInterval(id);
  }, [loading]);

  // Load available expiries from the proxy (same source the chart uses).
  useEffect(() => {
    fetch("/proxy/expirations")
      .then((r) => r.json())
      .then((d) => {
        const exps: string[] = Array.isArray(d?.expirations) ? d.expirations : [];
        setExpirations(exps);
        if (exps.length && !expiry) setExpiry(d?.expiry || exps[0]);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tkr = ticker.trim().toUpperCase();

  // All tickers (SPX included) probe via REST — one request, no polling, no
  // dependency on the live feed having the symbol subscribed. This is the path
  // that reliably loads. /proxy/probe-rest does: chain → resolve strike →
  // market-data (quote / OI / volume / prev-close).
  async function render() {
    if (!tkr || !expiry || !strike) { setError("Pick a ticker, expiry and strike first."); return; }
    stopRef.current = false;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setLoading(true); setError(null); setResult(null); setElapsed(null); setStatusMsg(null);
    setSentSymbol("");
    const t0 = performance.now();
    const type = side === "CALL" ? "C" : "P";
    log("info", `▶ REST probe ${tkr} ${side} ${strike} ${expiry}`);
    try {
      const url = `/proxy/probe-rest?ticker=${encodeURIComponent(tkr)}&expiry=${encodeURIComponent(expiry)}&type=${type}&strike=${encodeURIComponent(strike)}`;
      const r = await fetch(url, { signal });
      const d = await r.json();
      setElapsed(Math.round(performance.now() - t0));
      if (d?.resolvedSymbol) setSentSymbol(d.resolvedSymbol);
      const snapNote = d?.snapped ? ` · snapped ${d?.requestedStrike} → ${d?.resolvedStrike}` : "";
      log(d?.found ? "ok" : "warn", `${r.status} ${d?.status || "?"} · sym=${d?.resolvedSymbol || "—"} · ${Math.round(performance.now() - t0)}ms`);

      if (d?.found) {
        setResult(d.result);
        setStatusMsg(`REST — all feeds${snapNote}`);
        if (d?.snapped) log("warn", `↪ snapped ${d?.requestedStrike} → ${d?.resolvedStrike} (${d?.resolvedSymbol})`);
        const f = d?.result?.feeds || {};
        const ex = d?.result?.exposures || {};
        log("ok", `✔ OI=${f?.Summary?.openInterest ?? "—"} vol=${f?.Trade?.volume ?? "—"} mark=${f?.Quote?.mark ?? "—"} iv=${f?.Greeks?.iv ?? "—"}`);
        log("ok", `Σ GEX=${fmtExp(ex?.gex)} DEX=${fmtExp(ex?.dex)} VEX=${fmtExp(ex?.vex)} spot=${ex?.spot ?? "—"}`);
      } else if (d?.error) {
        setError(d.error);
        log("err", `✖ ${d.error}`);
      } else if (d?.status === "no-expiry") {
        const av = Array.isArray(d?.availableExpirations) ? d.availableExpirations.join(", ") : "—";
        setError(`No expiry ${expiry} for ${d?.chainTicker || tkr}. Available: ${av}`);
        log("warn", `⚠ no-expiry · available: ${av}`);
      } else if (d?.status === "no-strike") {
        setError(`Expiry ${expiry} exists but no ${type} strikes matched ${strike} for ${d?.chainTicker || tkr}.`);
        log("warn", `⚠ no-strike for ${strike}${type}`);
      } else {
        setStatusMsg(`No data (${d?.status || r.status}).`);
        log("warn", `⚠ ${d?.status || r.status}`);
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError" && !stopRef.current) {
        const m = String((e as Error)?.message || e);
        setError(m); log("err", `✖ ${m}`);
      }
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = { background: "#0b1320", color: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 16, fontFamily: "monospace", outline: "none" };

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 24, color: "#fff", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.1em" }}>Dev · Symbol Probe</span>
        <span style={{ fontSize: 12, color: C.label }}>Chain → strike resolve → market-data (any ticker)</span>
        <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: "#0c2535", color: C.cyan, border: `1px solid ${C.border}` }}>REST</span>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 20 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: C.label, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
          Ticker
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z.]/g, ""))}
            style={{ ...inputStyle, width: 110 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: C.label, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
          Side
          <div style={{ display: "flex", gap: 4 }}>
            {(["CALL", "PUT"] as const).map((s) => (
              <button key={s} onClick={() => setSide(s)} style={{ ...inputStyle, padding: "8px 16px", cursor: "pointer", background: side === s ? "#0c2535" : "#0b1320", color: side === s ? C.cyan : "#fff", fontWeight: 700 }}>{s}</button>
            ))}
          </div>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: C.label, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
          Strike
          <input value={strike} onChange={(e) => setStrike(e.target.value.replace(/[^\d.]/g, ""))} style={{ ...inputStyle, width: 120 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: C.label, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
          Expiry
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)} style={{ ...inputStyle, minWidth: 140 }}>
            {!expirations.length && <option value="">—</option>}
            {expirations.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <button onClick={render} disabled={loading} style={{ ...inputStyle, cursor: loading ? "wait" : "pointer", background: C.cyan, color: "#041016", fontWeight: 800, padding: "9px 22px", border: "none" }}>
          {loading ? "Loading…" : "Render"}
        </button>
        <button onClick={stop} disabled={!loading} style={{ ...inputStyle, cursor: loading ? "pointer" : "not-allowed", background: loading ? "#ef4444" : "#2a1414", color: "#fff", fontWeight: 800, padding: "9px 22px", border: "none", opacity: loading ? 1 : 0.5 }}>
          ■ Stop
        </button>
      </div>

      {error && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 14, fontFamily: "monospace" }}>{error}</div>}
      {statusMsg && !error && <div style={{ color: loading || statusMsg.startsWith("⚠") ? "#ffb300" : C.cyan, fontSize: 13, marginBottom: 14, fontFamily: "monospace" }}>{statusMsg}</div>}

      {/* Readout */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        <Field label="Ticker">{tkr || "—"}</Field>
        <Field label="Side">{side}</Field>
        <Field label="Strike">{strike || "—"}</Field>
        <Field label="Resolved Symbol">{sentSymbol || "—"}</Field>
        <Field label="Elapsed">
          {loading
            ? <span style={{ color: "#ffb300" }}>{(liveMs / 1000).toFixed(1)}s ⏱</span>
            : elapsed != null ? `${elapsed} ms` : "—"}
        </Field>
      </div>

      {/* All feed types at once */}
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {FEED_ORDER.map((name) => {
          const feeds = (result as { feeds?: Record<string, Record<string, unknown>> } | null)?.feeds;
          return <FeedPanel key={name} name={name} data={feeds?.[name]} />;
        })}
        <ExposurePanel data={(result as { exposures?: Record<string, unknown> } | null)?.exposures} />
      </div>

      {/* Raw market-data item — every field, nothing dropped */}
      <details style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", marginTop: 12 }}>
        <summary style={{ fontSize: 11, fontWeight: 800, color: C.label, textTransform: "uppercase", letterSpacing: "0.14em", cursor: "pointer" }}>Raw response</summary>
        <pre style={{ margin: "10px 0 0", fontSize: 13, fontFamily: "monospace", color: "#cfe", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {result != null ? JSON.stringify(result, null, 2) : "—"}
        </pre>
      </details>

      {/* Log panel */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.label, textTransform: "uppercase", letterSpacing: "0.14em" }}>Log</div>
          <button onClick={() => setLogs([])} style={{ ...inputStyle, padding: "4px 12px", fontSize: 11, cursor: "pointer" }}>Clear</button>
        </div>
        <div style={{ maxHeight: 240, overflowY: "auto", fontFamily: "monospace", fontSize: 12.5, lineHeight: 1.6, display: "flex", flexDirection: "column" }}>
          {!logs.length && <span style={{ color: C.label }}>—</span>}
          {logs.map((l, i) => {
            const color = l.level === "ok" ? "#22e08a" : l.level === "warn" ? "#ffb300" : l.level === "err" ? "#ef4444" : "#9fc4e0";
            const ts = new Date(l.t).toLocaleTimeString("en-US", { hour12: false }) + "." + String(l.t % 1000).padStart(3, "0");
            return (
              <div key={i} style={{ color, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                <span style={{ color: C.label }}>{ts}</span>  {l.msg}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
