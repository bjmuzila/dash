"use client";

/**
 * QuickProbe — owner-only "add a contract to the probe list", docked in the
 * Notes drawer.
 *
 * Fill in ticker / expiration / strike / call-or-put, hit Probe, and the
 * contract is written straight onto the owner probe list — the same list
 * /owner/probe renders. No navigation, no new tab: the row is there the next
 * time that page is opened, and the server-side recorder starts filling its
 * price history during RTH exactly as if it had been typed there.
 *
 * It posts the identical payload the probe page's own Add button posts:
 *
 *   POST /api/watch { action: "add", ticker, expiry, strike, side }
 *
 * No `addedPrice` is sent, so the route captures the live mark as the entry
 * basis (`app/api/watch/route.ts` / `api-router.js` -> `/proxy/probe-rest`).
 * That route is registered `auth: 'owner'` server-side, so this is genuinely
 * gated, not just hidden.
 *
 * The one other request it makes is /api/expirations, to fill the expiration
 * dropdown for whatever symbol is typed — the same route the customer chain
 * surfaces already call. No new endpoint, no proxy change.
 *
 * `useIsOwner` decides whether the card is DRAWN; /api/watch decides whether
 * the write is allowed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { HOME_THEME, homeInputStyle, LIGHT_BLUE, SOFT_RED } from "./homeTheme";
import { useIsOwner } from "./useIsOwner";

type Side = "C" | "P";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function expiryLabel(ymd: string): string {
  const dt = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return ymd;
  return `${DAY_NAMES[dt.getDay()]} ${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
}

export default function QuickProbe() {
  const { isOwner } = useIsOwner();

  // Open by default — this is owner chrome in the owner's own drawer, so the
  // fields are there the moment Notes opens. Collapsible for when the note list
  // needs the room.
  const [open, setOpen] = useState(true);
  const [ticker, setTicker] = useState("SPX");
  const [expiries, setExpiries] = useState<string[]>([]);
  const [expiration, setExpiration] = useState("");
  const [strike, setStrike] = useState("");
  const [side, setSide] = useState<Side>("C");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Last contract successfully added, for the confirmation line. */
  const [added, setAdded] = useState<string | null>(null);

  // Guards a stale expiry response from overwriting a newer symbol's list.
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

  useEffect(() => {
    if (!open || !isOwner) return;
    void loadExpiries(ticker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isOwner]);

  // ── add the contract to the probe list ─────────────────────────────────────
  const probe = useCallback(async () => {
    const sym = ticker.trim().toUpperCase();
    const exp = expiration.trim().slice(0, 10);
    const k = parseFloat(strike);
    if (!sym) { setError("Enter a ticker."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) { setError("Pick an expiration."); return; }
    if (!Number.isFinite(k) || k <= 0) { setError("Enter a strike."); return; }

    setBusy(true);
    setError(null);
    setAdded(null);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", ticker: sym, expiry: exp, strike: k, side }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || j?.error) {
        setError(String(j?.error || `Probe failed (${res.status}).`));
        return;
      }
      setAdded(`${sym} ${k}${side} · ${expiryLabel(exp)}`);
      // Strike is the one field that changes contract to contract; clear it so
      // the next probe on the same symbol/expiry is one number and Enter.
      setStrike("");
    } catch {
      setError("Probe failed — couldn't reach the watch service.");
    } finally {
      setBusy(false);
    }
  }, [ticker, expiration, strike, side]);

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
    const tone = s === "C" ? LIGHT_BLUE : SOFT_RED;
    return (
      <button
        key={s}
        type="button"
        onClick={() => { setSide(s); setAdded(null); }}
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
        {s === "C" ? "Call" : "Put"}
      </button>
    );
  };

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
              onChange={(e) => { setTicker(e.target.value.toUpperCase()); setAdded(null); }}
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
                onChange={(e) => { setExpiration(e.target.value); setAdded(null); }}
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
                onChange={(e) => { setExpiration(e.target.value); setAdded(null); }}
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
                onChange={(e) => { setStrike(e.target.value.replace(/[^0-9.]/g, "")); setAdded(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void probe(); } }}
                inputMode="decimal"
                placeholder="6400"
                autoComplete="off"
                style={{ ...fieldStyle, fontVariantNumeric: "tabular-nums" }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={labelStyle}>Side</span>
              <div style={{ display: "flex", gap: 6 }}>{sideBtn("C")}{sideBtn("P")}</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void probe()}
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
            {busy ? "Adding…" : "Probe"}
          </button>

          {error && (
            <div style={{ fontSize: 12, color: SOFT_RED, lineHeight: 1.4 }}>{error}</div>
          )}

          {added && !error && (
            <div style={{ fontSize: 11, color: HOME_THEME.cyan, lineHeight: 1.45 }}>
              Added <strong style={{ fontWeight: 700 }}>{added}</strong> to the probe list.
            </div>
          )}

          {!added && !error && (
            <div style={{ fontSize: 10, color: HOME_THEME.muted, opacity: 0.45, letterSpacing: "0.04em", textAlign: "center" }}>
              Adds the contract to the owner probe list
            </div>
          )}
        </div>
      )}
    </div>
  );
}
