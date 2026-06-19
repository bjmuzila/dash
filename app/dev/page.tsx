"use client";

import { useEffect, useState } from "react";

// ── Symbol builder ──────────────────────────────────────────────────────────
// SPXW streamer-symbol form, e.g. .SPXW260618P7265
//   ".SPXW" + YYMMDD + (C|P) + strike   (expiry is YYYY-MM-DD)
function buildSymbol(expiry: string, side: "CALL" | "PUT", strike: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
  if (!m || !strike) return "";
  const [, yyyy, mm, dd] = m;
  const yy = yyyy.slice(2);
  const cp = side === "CALL" ? "C" : "P";
  const k = String(Number(strike)); // drop any leading zeros / decimals
  return `.SPXW${yy}${mm}${dd}${cp}${k}`;
}

const FEED_TYPES = ["Greeks", "Quote", "Trade", "Summary"] as const;
type FeedType = (typeof FEED_TYPES)[number];

const C = { cyan: "#00F0FF", border: "rgba(255,255,255,0.10)", card: "rgba(13,17,25,0.55)", label: "#8da8c2" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.label, textTransform: "uppercase", letterSpacing: "0.14em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", fontFamily: "monospace" }}>{children}</div>
    </div>
  );
}

export default function DevPage() {
  const [side, setSide] = useState<"CALL" | "PUT">("PUT");
  const [strike, setStrike] = useState("7265");
  const [expiry, setExpiry] = useState("");
  const [expirations, setExpirations] = useState<string[]>([]);
  const [feed, setFeed] = useState<FeedType>("Greeks");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [waited, setWaited] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [sentSymbol, setSentSymbol] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveMs, setLiveMs] = useState(0);

  const builtSymbol = buildSymbol(expiry, side, strike);

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

  async function render() {
    if (!builtSymbol) { setError("Pick an expiry and strike first."); return; }
    setLoading(true); setError(null); setResult(null); setElapsed(null); setWaited(null); setStatusMsg(null);
    setSentSymbol(builtSymbol);
    const t0 = performance.now();
    // Poll: the first request subscribes on demand; keep polling until the feed
    // delivers data (or we give up). The server reports waitedMs (sub→first event).
    const DEADLINE_MS = 30_000;
    try {
      while (true) {
        const r = await fetch(`/proxy/probe?symbol=${encodeURIComponent(builtSymbol)}&feed=${encodeURIComponent(feed)}`);
        const d = await r.json();
        if (d?.found) {
          setResult(d.result);
          setWaited(Number.isFinite(d?.waitedMs) ? d.waitedMs : null);
          setElapsed(Math.round(performance.now() - t0));
          setStatusMsg(d.source === "active" ? "Live (active chart window)" : d.source === "probe" ? "Filled via on-demand subscription" : "Cached");
          break;
        }
        if (performance.now() - t0 > DEADLINE_MS) {
          setStatusMsg("Subscribed — still waiting for first event. Try Render again; sub stays live 15 min.");
          setElapsed(Math.round(performance.now() - t0));
          break;
        }
        setStatusMsg(`Subscribed to ${builtSymbol} — waiting for ${feed} data…`);
        await new Promise((res) => setTimeout(res, 600));
      }
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = { background: "#0b1320", color: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 16, fontFamily: "monospace", outline: "none" };

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 24, color: "#fff", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.1em" }}>Dev · Symbol Probe</span>
        <span style={{ fontSize: 12, color: C.label }}>Raw proxy feed data per strike</span>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 20 }}>
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
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: C.label, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
          Feed Type
          <select value={feed} onChange={(e) => setFeed(e.target.value as FeedType)} style={{ ...inputStyle, minWidth: 120 }}>
            {FEED_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <button onClick={render} disabled={loading} style={{ ...inputStyle, cursor: loading ? "wait" : "pointer", background: C.cyan, color: "#041016", fontWeight: 800, padding: "9px 22px", border: "none" }}>
          {loading ? "Loading…" : "Render"}
        </button>
      </div>

      {error && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 14, fontFamily: "monospace" }}>{error}</div>}
      {statusMsg && !error && <div style={{ color: loading ? "#ffb300" : C.cyan, fontSize: 13, marginBottom: 14, fontFamily: "monospace" }}>{statusMsg}</div>}

      {/* Readout */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        <Field label="Side">{side}</Field>
        <Field label="Strike">{strike || "—"}</Field>
        <Field label="Built Symbol">{builtSymbol || "—"}</Field>
        <Field label="Selected Symbol">{sentSymbol || builtSymbol || "—"}</Field>
        <Field label="Feed Type">{feed}</Field>
        <Field label="Elapsed">
          {loading
            ? <span style={{ color: "#ffb300" }}>{(liveMs / 1000).toFixed(1)}s ⏱</span>
            : elapsed != null ? `${elapsed} ms` : "—"}
        </Field>
        <Field label="Data Wait">{waited != null ? `${waited} ms` : "—"}</Field>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", marginTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.label, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 8 }}>Result</div>
        <pre style={{ margin: 0, fontSize: 14, fontFamily: "monospace", color: "#cfe", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {result != null ? JSON.stringify(result, null, 2) : "—"}
        </pre>
      </div>
    </div>
  );
}
