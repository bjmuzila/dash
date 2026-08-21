"use client";

/**
 * QuickProbe — owner-only contract launcher, docked in the Notes drawer.
 *
 * Fill in ticker / expiration / strike / call-or-put and Probe hands the
 * contract off to the real probe page on the owner site:
 *
 *   https://owner.cbedge.net/owner/probe?ticker=&exp=&strike=&side=
 *
 * That page (owner-vite/src/pages/Probe.tsx) reads those params on mount, fills
 * its structured inputs and its shorthand box, then strips the query from the
 * URL. All the actual work — /proxy/probe-rest resolve, the /api/watch record,
 * the tracking — stays there. This is a launcher, nothing more: it records
 * nothing and adds nothing.
 *
 * The one request it makes on its own is /api/expirations, to populate the
 * expiration dropdown for whatever symbol is typed — the same route the
 * customer chain surfaces already call. No new endpoint, no proxy change.
 *
 * Gating is CHROME ONLY (useIsOwner) — same rule as the rest of the owner
 * chrome. The owner site behind the link has its own AuthGate.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { HOME_THEME, homeInputStyle, LIGHT_BLUE, SOFT_RED } from "./homeTheme";
import { useIsOwner } from "./useIsOwner";

type Side = "C" | "P";

/** Owner site root. Overridable for a staging host / local owner-vite dev run. */
const OWNER_SITE =
  (process.env.NEXT_PUBLIC_OWNER_SITE_URL || "https://owner.cbedge.net").replace(/\/+$/, "");
const PROBE_PATH = "/owner/probe";

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
  const [error, setError] = useState<string | null>(null);

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

  // ── hand off to the owner probe page ───────────────────────────────────────
  const launch = useCallback(() => {
    const sym = ticker.trim().toUpperCase();
    const exp = expiration.trim().slice(0, 10);
    const k = parseFloat(strike);
    if (!sym) { setError("Enter a ticker."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) { setError("Pick an expiration."); return; }
    if (!Number.isFinite(k) || k <= 0) { setError("Enter a strike."); return; }
    setError(null);

    const qs = new URLSearchParams({
      ticker: sym,
      exp,
      strike: String(k),
      side,
    });
    const url = `${OWNER_SITE}${PROBE_PATH}?${qs.toString()}`;
    // New tab, and never let the opened page reach back through window.opener.
    try {
      window.open(url, "cb-owner-probe", "noopener,noreferrer");
    } catch {
      window.location.href = url;
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
        onClick={() => setSide(s)}
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
                onChange={(e) => setExpiration(e.target.value)}
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
                onChange={(e) => setExpiration(e.target.value)}
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
                onChange={(e) => setStrike(e.target.value.replace(/[^0-9.]/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); launch(); } }}
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
            onClick={launch}
            style={{
              marginTop: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              padding: "8px 0",
              borderRadius: 9,
              border: `1px solid ${HOME_THEME.cyan}55`,
              background: `linear-gradient(180deg, ${HOME_THEME.cyan}26, ${HOME_THEME.cyan}0d)`,
              color: HOME_THEME.cyan,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Probe
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>

          <div style={{ fontSize: 10, color: HOME_THEME.muted, opacity: 0.45, letterSpacing: "0.04em", textAlign: "center" }}>
            Opens the probe page on the owner site
          </div>

          {error && (
            <div style={{ fontSize: 12, color: SOFT_RED, lineHeight: 1.4 }}>{error}</div>
          )}
        </div>
      )}
    </div>
  );
}
