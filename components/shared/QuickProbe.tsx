"use client";

/**
 * QuickProbe — owner-only single-contract lookup, docked in the Notes drawer.
 *
 * Fill in ticker / expiration / strike / call-or-put and it pulls that one
 * contract out of the live chain: mark, bid/ask, volume, OI, IV and the four
 * greeks. It is a READ — no orders, no writes, nothing recorded.
 *
 * Data path is the one every chain surface already uses:
 *   /api/expirations?ticker=…            → the expiry list
 *   /api/chains?ticker=…&expiration=…    → { data: { items, underlyingPrice } }
 * The per-strike payload is read the same way lib/calculations/optionChain
 * reads it (group.strikes[] → { "strike-price", call, put }), so a number here
 * cannot disagree with the chain page. No new endpoint, no proxy change.
 *
 * Gating is CHROME ONLY (useIsOwner) — same rule as the rest of the owner
 * chrome. Nothing sensitive is exposed by the panel itself; the endpoints it
 * calls are the ones the customer chain pages already call.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME, homeInputStyle, LIGHT_BLUE, SOFT_RED } from "./homeTheme";
import { useIsOwner } from "./useIsOwner";
import type { NoteExtra } from "./notes";

type Side = "call" | "put";

type Probe = {
  ticker: string;
  expiration: string;
  strike: number;
  side: Side;
  /** Strike actually found (snapped to the nearest listed one when needed). */
  matchedStrike: number;
  snapped: boolean;
  underlying: number;
  bid: number;
  ask: number;
  mark: number;
  last: number;
  volume: number;
  oi: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  ts: number;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function expiryLabel(ymd: string): string {
  const dt = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return ymd;
  return `${DAY_NAMES[dt.getDay()]} ${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
}

const num = (o: Record<string, unknown> | undefined, k: string) =>
  o ? parseFloat(String(o[k])) || 0 : 0;

/** Mark falls back bid/ask mid → last → close, exactly like optionChain.ts. */
function markOf(o: Record<string, unknown> | undefined): number {
  if (!o) return 0;
  const m = num(o, "mark") || num(o, "mark-price");
  if (m > 0) return m;
  const b = num(o, "bid") || num(o, "bid-price");
  const a = num(o, "ask") || num(o, "ask-price");
  if (b > 0 || a > 0) return (b + a) / 2;
  return num(o, "last") || num(o, "last-price") || num(o, "close") || num(o, "price") || num(o, "mid");
}

/** IV is quoted as a fraction upstream; a few feeds send whole percent. */
function ivOf(o: Record<string, unknown> | undefined): number {
  const raw =
    num(o, "implied-volatility") ||
    num(o, "impliedVolatility") ||
    num(o, "iv") ||
    num(o, "volatility");
  if (!raw) return 0;
  return raw > 5 ? raw / 100 : raw;
}

const fmtPrice = (n: number) => (n > 0 ? n.toFixed(2) : "—");
const fmtInt = (n: number) => (n ? n.toLocaleString() : "0");
const fmtGreek = (n: number) => (n ? n.toFixed(4) : "—");
const fmtPct = (n: number) => (n > 0 ? `${(n * 100).toFixed(1)}%` : "—");

export default function QuickProbe({
  addNote,
}: {
  addNote?: (text: string, extra?: NoteExtra) => void;
}) {
  const { isOwner } = useIsOwner();

  const [open, setOpen] = useState(false);
  const [ticker, setTicker] = useState("SPX");
  const [expiries, setExpiries] = useState<string[]>([]);
  const [expiration, setExpiration] = useState("");
  const [strike, setStrike] = useState("");
  const [side, setSide] = useState<Side>("call");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Probe | null>(null);
  const [saved, setSaved] = useState(false);

  // Symbol the expiry list belongs to, so a stale response can't overwrite it.
  const expiryReqRef = useRef(0);

  // ── expirations for the typed symbol ───────────────────────────────────────
  const loadExpiries = useCallback(async (sym: string) => {
    const clean = sym.trim().toUpperCase();
    if (!clean) return;
    const req = ++expiryReqRef.current;
    try {
      const json = await fetch(`/api/expirations?ticker=${encodeURIComponent(clean)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (req !== expiryReqRef.current) return;
      const items: Array<Record<string, unknown>> = json?.data?.items ?? [];
      const seen = new Set<string>();
      const list = items
        .map((it) => String(it["expiration-date"] ?? "").slice(0, 10))
        .filter((d) => d && !seen.has(d) && (seen.add(d), true))
        .sort();
      setExpiries(list);
      setExpiration((cur) => (cur && list.includes(cur) ? cur : list[0] ?? ""));
    } catch {
      if (req === expiryReqRef.current) setExpiries([]);
    }
  }, []);

  // Load once when the section is first opened, and on every symbol commit.
  useEffect(() => {
    if (!open || !isOwner) return;
    void loadExpiries(ticker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isOwner]);

  // ── the probe ──────────────────────────────────────────────────────────────
  const runProbe = useCallback(async () => {
    const sym = ticker.trim().toUpperCase();
    const exp = expiration.trim().slice(0, 10);
    const k = parseFloat(strike);
    if (!sym) { setError("Enter a ticker."); return; }
    if (!exp) { setError("Pick an expiration."); return; }
    if (!Number.isFinite(k) || k <= 0) { setError("Enter a strike."); return; }

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(
        `/api/chains?ticker=${encodeURIComponent(sym)}&expiration=${encodeURIComponent(exp)}&range=all`,
        { cache: "no-store" },
      );
      const json = await res.json().catch(() => null);
      const data = (json?.data as Record<string, unknown> | undefined) ?? undefined;
      const items = (data?.items as unknown[]) ?? [];
      const underlying = parseFloat(String(data?.underlyingPrice ?? 0)) || 0;

      // Groups are per-expiration; keep the one asked for when it's labeled.
      const groups = (items as { "expiration-date"?: string; strikes?: unknown[] }[]);
      const target = groups.filter((g) => String(g["expiration-date"] ?? "").slice(0, 10) === exp);
      const rows = (target.length ? target : groups).flatMap((g) => (g.strikes ?? []) as unknown[]);
      if (!rows.length) { setError("No strikes returned for that expiry."); setResult(null); return; }

      let best: Record<string, unknown> | null = null;
      let bestK = 0;
      for (const row of rows) {
        const it = row as Record<string, unknown>;
        const s = parseFloat(String(it["strike-price"] ?? 0));
        if (!s) continue;
        if (!best || Math.abs(s - k) < Math.abs(bestK - k)) { best = it; bestK = s; }
      }
      if (!best) { setError("No strikes returned for that expiry."); setResult(null); return; }

      const leg = best[side] as Record<string, unknown> | undefined;
      if (!leg) { setError(`No ${side} leg listed at ${bestK}.`); setResult(null); return; }

      setResult({
        ticker: sym,
        expiration: exp,
        strike: k,
        side,
        matchedStrike: bestK,
        snapped: Math.abs(bestK - k) > 0.0001,
        underlying,
        bid: num(leg, "bid") || num(leg, "bid-price"),
        ask: num(leg, "ask") || num(leg, "ask-price"),
        mark: markOf(leg),
        last: num(leg, "last") || num(leg, "last-price") || num(leg, "close"),
        volume: parseInt(String(leg.volume ?? 0), 10) || 0,
        oi: parseInt(String(leg["open-interest"] ?? leg.openInterest ?? 0), 10) || 0,
        iv: ivOf(leg),
        delta: num(leg, "delta"),
        gamma: num(leg, "gamma"),
        theta: num(leg, "theta"),
        vega: num(leg, "vega"),
        ts: Date.now(),
      });
    } catch {
      setError("Probe failed — chain request didn't come back.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [ticker, expiration, strike, side]);

  const noteText = useMemo(() => {
    if (!result) return "";
    const tag = `${result.ticker} ${expiryLabel(result.expiration)} ${result.matchedStrike}${result.side === "call" ? "C" : "P"}`;
    return [
      tag,
      `mark ${fmtPrice(result.mark)} · bid ${fmtPrice(result.bid)} / ask ${fmtPrice(result.ask)}`,
      `vol ${fmtInt(result.volume)} · OI ${fmtInt(result.oi)} · IV ${fmtPct(result.iv)}`,
      `Δ ${fmtGreek(result.delta)} · Γ ${fmtGreek(result.gamma)} · Θ ${fmtGreek(result.theta)} · V ${fmtGreek(result.vega)}`,
      result.underlying > 0 ? `spot ${result.underlying.toFixed(2)}` : "",
    ].filter(Boolean).join("\n");
  }, [result]);

  // Owner chrome only — renders nothing (and fetches nothing) for anyone else.
  if (!isOwner) return null;

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: HOME_THEME.muted,
    opacity: 0.55,
    marginBottom: 3,
    display: "block",
  };
  const fieldStyle: React.CSSProperties = {
    ...homeInputStyle,
    width: "100%",
    padding: "6px 8px",
    fontSize: 13,
    borderRadius: 8,
    boxSizing: "border-box",
  };

  const sideBtn = (s: Side) => {
    const on = side === s;
    const tone = s === "call" ? LIGHT_BLUE : SOFT_RED;
    return (
      <button
        key={s}
        type="button"
        onClick={() => { setSide(s); setSaved(false); }}
        style={{
          flex: 1,
          padding: "6px 0",
          borderRadius: 8,
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: on ? tone : HOME_THEME.muted,
          opacity: on ? 1 : 0.55,
          background: on ? `${tone}22` : "rgba(0,0,0,0.4)",
          border: `1px solid ${on ? `${tone}66` : HOME_THEME.border}`,
          transition: "background 0.15s, border-color 0.15s, opacity 0.15s",
        }}
      >
        {s === "call" ? "Call" : "Put"}
      </button>
    );
  };

  const statRow = (k: string, v: string, tone?: string) => (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.55 }}>{k}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: tone || HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>{v}</span>
    </div>
  );

  return (
    <div
      style={{
        flexShrink: 0,
        marginBottom: 12,
        borderRadius: 14,
        border: `1px solid ${open ? "rgba(33,158,188,0.18)" : "rgba(255,255,255,0.05)"}`,
        background: open
          ? "linear-gradient(180deg, rgba(33,158,188,0.07), rgba(13,17,25,0.5))"
          : "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(13,17,25,0.45))",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
        transition: "background 0.15s, border-color 0.15s",
        overflow: "hidden",
      }}
    >
      {/* header / toggle */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: HOME_THEME.text,
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1 }} aria-hidden>🔎</span>
        <span style={{ flex: 1, textAlign: "left", fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Quick Probe
        </span>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.cyan, opacity: 0.75 }}>
          Owner
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ color: HOME_THEME.muted, opacity: 0.6, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.18s" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {/* ticker */}
          <div>
            <label style={labelStyle} htmlFor="qp-ticker">Ticker</label>
            <input
              id="qp-ticker"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              onBlur={() => void loadExpiries(ticker)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void loadExpiries(ticker); } }}
              placeholder="SPX"
              autoComplete="off"
              spellCheck={false}
              style={{ ...fieldStyle, letterSpacing: "0.06em", fontWeight: 700 }}
            />
          </div>

          {/* expiration */}
          <div>
            <label style={labelStyle} htmlFor="qp-exp">Expiration</label>
            {expiries.length > 0 ? (
              <select
                id="qp-exp"
                value={expiration}
                onChange={(e) => { setExpiration(e.target.value); setSaved(false); }}
                style={{ ...fieldStyle, cursor: "pointer" }}
              >
                {expiries.map((d) => (
                  <option key={d} value={d}>{`${expiryLabel(d)} · ${d}`}</option>
                ))}
              </select>
            ) : (
              <input
                id="qp-exp"
                type="date"
                value={expiration}
                onChange={(e) => { setExpiration(e.target.value); setSaved(false); }}
                style={{ ...fieldStyle, cursor: "text" }}
              />
            )}
          </div>

          {/* strike + side */}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={labelStyle} htmlFor="qp-strike">Strike</label>
              <input
                id="qp-strike"
                value={strike}
                onChange={(e) => { setStrike(e.target.value.replace(/[^0-9.]/g, "")); setSaved(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runProbe(); } }}
                inputMode="decimal"
                placeholder="6400"
                autoComplete="off"
                style={{ ...fieldStyle, fontVariantNumeric: "tabular-nums" }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={labelStyle}>Side</span>
              <div style={{ display: "flex", gap: 6 }}>{sideBtn("call")}{sideBtn("put")}</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void runProbe()}
            disabled={busy}
            style={{
              marginTop: 2,
              padding: "8px 0",
              borderRadius: 9,
              border: `1px solid ${HOME_THEME.cyan}55`,
              background: `linear-gradient(180deg, ${HOME_THEME.cyan}26, ${HOME_THEME.cyan}0d)`,
              color: HOME_THEME.cyan,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.55 : 1,
            }}
          >
            {busy ? "Probing…" : "Probe"}
          </button>

          {error && (
            <div style={{ fontSize: 12, color: SOFT_RED, lineHeight: 1.4 }}>{error}</div>
          )}

          {result && !error && (
            <div
              style={{
                marginTop: 2,
                padding: "10px 11px",
                borderRadius: 11,
                background: "rgba(13,17,25,0.45)",
                border: `1px solid ${HOME_THEME.border}`,
                display: "flex",
                flexDirection: "column",
                gap: 5,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: HOME_THEME.text, letterSpacing: "0.02em" }}>
                  {result.ticker} {result.matchedStrike}
                  <span style={{ color: result.side === "call" ? LIGHT_BLUE : SOFT_RED }}>
                    {result.side === "call" ? "C" : "P"}
                  </span>
                </span>
                <span style={{ fontSize: 11, color: HOME_THEME.muted, opacity: 0.6 }}>{expiryLabel(result.expiration)}</span>
                {result.underlying > 0 && (
                  <span style={{ marginLeft: "auto", fontSize: 11, color: HOME_THEME.muted, opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>
                    spot {result.underlying.toFixed(2)}
                  </span>
                )}
              </div>

              {result.snapped && (
                <div style={{ fontSize: 11, color: HOME_THEME.orange, opacity: 0.85, lineHeight: 1.35 }}>
                  {result.strike} isn&apos;t listed — snapped to {result.matchedStrike}.
                </div>
              )}

              <div style={{ height: 1, background: HOME_THEME.border, margin: "2px 0" }} />

              {statRow("Mark", fmtPrice(result.mark), HOME_THEME.text)}
              {statRow("Bid / Ask", `${fmtPrice(result.bid)} / ${fmtPrice(result.ask)}`)}
              {statRow("Last", fmtPrice(result.last))}
              {statRow("Volume", fmtInt(result.volume))}
              {statRow("Open Int", fmtInt(result.oi))}
              {statRow("IV", fmtPct(result.iv))}

              <div style={{ height: 1, background: HOME_THEME.border, margin: "2px 0" }} />

              {statRow("Delta", fmtGreek(result.delta))}
              {statRow("Gamma", fmtGreek(result.gamma))}
              {statRow("Theta", fmtGreek(result.theta))}
              {statRow("Vega", fmtGreek(result.vega))}

              {addNote && (
                <button
                  type="button"
                  onClick={() => {
                    addNote(noteText, { src: "Quick Probe" });
                    setSaved(true);
                  }}
                  style={{
                    marginTop: 4,
                    padding: "6px 0",
                    borderRadius: 8,
                    border: `1px solid ${HOME_THEME.border}`,
                    background: "rgba(255,255,255,0.05)",
                    color: saved ? HOME_THEME.cyan : HOME_THEME.muted,
                    opacity: saved ? 1 : 0.75,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  {saved ? "Saved to notes" : "Save to notes"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
