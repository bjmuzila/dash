"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HOME_THEME as T } from "./homeTheme";

/**
 * OfferPill — the live "$30 first month" offer, in the toolbar.
 *
 * WHY IT IS A PILL AND NOT A MODAL. The offer is already attached to the
 * ACCOUNT (lib/lifecycleOffers.ts mints a customer-restricted promotion code
 * and app/api/stripe/checkout pre-applies it), so this is not something the
 * user must act on to receive — checkout was going to give them the price
 * either way. A modal would interrupt someone reading a chart to tell them
 * something that is already true. A pill sits there, says the offer exists, and
 * waits.
 *
 * It also reaches the people the email never did — bounced, filtered, ignored —
 * which until now was a silent loss.
 *
 * RENDERS NOTHING for everyone without a live offer, which is almost everyone.
 * One cheap fetch on mount, `{ offer: null }`, and the component disappears.
 *
 * IT AUTO-OPENS ONCE, then behaves. The first time a given code is seen in this
 * browser the panel drops open on its own after a beat, because a pill nobody
 * notices converts nobody. After that it stays closed until clicked. There is
 * no dismiss button on purpose: outside click, Esc, or simply ignoring it all
 * work, and nothing here can be "dismissed forever" by accident — the offer
 * stays reachable in the toolbar until it is redeemed or expires, at which
 * point the API stops returning it and the pill vanishes by itself.
 *
 * The localStorage flag is a convenience, not state that matters: cleared
 * storage or a second device just means it auto-opens once more. Wrapped in
 * try/catch because Safari private mode throws on access.
 */

const CLAIM_URL = "/pricing";
const AUTO_OPEN_DELAY_MS = 900;
const SEEN_KEY_PREFIX = "cbe_offer_seen:";

/**
 * Alpha variants of a theme colour, so the tints below are derived from
 * homeTheme rather than being a second set of hardcoded hex values that can
 * drift from it (see AGENTS.md — colours come from the theme, always).
 */
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// The offer accent. ORANGE, matching the Sales page's trial panels and the
// "attention, but nothing is wrong" role it plays elsewhere in the app.
const ACCENT = T.orange;
const accentA = (a: number) => hexA(ACCENT, a);

// HOME_THEME flattens `muted` and `text` to the same pure white, which kills
// every bit of hierarchy inside a small panel like this one. A local dimmed
// white for secondary copy is the same workaround app/pricing/page.tsx uses,
// and for the same reason.
const DIM = "rgba(255,255,255,0.62)";
const DIMMER = "rgba(255,255,255,0.45)";

interface ActiveOffer {
  kind: string | null;
  code: string | null;
  offerCents: number | null;
  listCents: number | null;
  expiresAt: string | null;
}

function money(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** "3 days left" / "ends today" / null when there is no expiry to report. */
function daysLeft(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const days = Math.ceil(ms / 86_400_000);
  return days <= 1 ? "ends today" : `${days} days left`;
}

export default function OfferPill({ compact = false }: { compact?: boolean }) {
  const [offer, setOffer] = useState<ActiveOffer | null>(null);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // ── load ──────────────────────────────────────────────────────────────────
  // Best-effort and silent: the endpoint answers { offer: null } for signed-out
  // users AND for its own failures, so there is nothing here worth logging on
  // every page load.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/offers/active", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json().catch(() => ({}));
        const o = j?.offer as ActiveOffer | null | undefined;
        if (alive && o?.offerCents && o?.listCents) setOffer(o);
      } catch { /* no pill, no noise */ }
    })();
    return () => { alive = false; };
  }, []);

  // ── auto-open, once per code per browser ─────────────────────────────────
  useEffect(() => {
    if (!offer?.code) return;
    const key = SEEN_KEY_PREFIX + offer.code;
    let seen = false;
    try { seen = localStorage.getItem(key) === "1"; } catch { /* private mode */ }
    if (seen) return;
    const id = setTimeout(() => {
      setOpen(true);
      try { localStorage.setItem(key, "1"); } catch { /* nothing to do */ }
    }, AUTO_OPEN_DELAY_MS);
    return () => clearTimeout(id);
  }, [offer?.code]);

  // ── close on outside click / Esc ──────────────────────────────────────────
  // Both, because the panel has no dismiss button: whichever reflex the user
  // has, it works.
  const onDocDown = useCallback((e: MouseEvent) => {
    if (!wrapRef.current || wrapRef.current.contains(e.target as Node)) return;
    setOpen(false);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onDocDown]);

  if (!offer?.offerCents || !offer?.listCents) return null;

  const offerStr = money(offer.offerCents);
  const listStr = money(offer.listCents);
  const savedStr = money(offer.listCents - offer.offerCents);
  const left = daysLeft(offer.expiresAt);

  return (
    <div ref={wrapRef} style={{ position: "relative", zIndex: 30, display: "flex", alignItems: "center", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        aria-expanded={open}
        title={`Your first month is ${offerStr} instead of ${listStr}${left ? ` — ${left}` : ""}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 30,
          padding: compact ? "0 9px" : "0 12px",
          borderRadius: 999,
          border: `1px solid ${accentA(open || hover ? 0.7 : 0.42)}`,
          background: accentA(open || hover ? 0.18 : 0.11),
          color: ACCENT,
          fontSize: 13,
          fontWeight: 800,
          whiteSpace: "nowrap",
          cursor: "pointer",
          boxShadow: open || hover ? `0 4px 12px -2px ${accentA(0.42)}` : "none",
          transform: hover && !open ? "translateY(-1px)" : "none",
          transition: "border-color .14s, background .14s, box-shadow .14s, transform .14s",
        }}
      >
        <span style={{ fontSize: 14, lineHeight: 1 }} aria-hidden>★</span>
        {compact ? offerStr : `${offerStr} first month`}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Your offer"
          style={{
            position: "absolute",
            top: "calc(100% + 10px)",
            // Anchored to the pill's RIGHT edge: this sits in the right-hand
            // toolbar cluster, so a left-anchored panel would hang off the
            // viewport on a narrow window.
            right: 0,
            width: 306,
            padding: 16,
            borderRadius: 14,
            // T.panel, not panelBgStrong — that one is translucent, and a
            // floating panel over a live chart has to be opaque to be readable.
            background: T.panel,
            border: `1px solid ${accentA(0.34)}`,
            boxShadow: "0 18px 44px -12px rgba(0,0,0,0.75)",
            color: T.text,
          }}
        >
          <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: DIMMER }}>
            Your first month
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginTop: 6 }}>
            <span style={{ fontSize: 34, fontWeight: 900, color: ACCENT, lineHeight: 1 }}>{offerStr}</span>
            <span style={{ fontSize: 13, color: DIMMER, textDecoration: "line-through" }}>{listStr}</span>
            <span style={{ fontSize: 12, color: T.green }}>save {savedStr}</span>
          </div>

          <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.55, color: DIM }}>
            Then <strong style={{ color: T.green }}>{listStr}/month</strong>, cancel any time.
            It&rsquo;s already on your account — start the monthly plan and the price
            is applied at checkout. Nothing to type.
          </div>

          {/* A real anchor, NOT next/link. Inside the customer dashboard
              next/link is shimmed to react-router (app-vite/src/shims), and
              /pricing is a Next server-rendered page with no SPA route — a
              client-side push would fall through the catch-all to
              /traders-dashboard. Same reasoning as V3Pill in GlobalToolbar. */}
          <a
            href={CLAIM_URL}
            style={{
              display: "block",
              marginTop: 14,
              padding: "10px 14px",
              borderRadius: 10,
              background: ACCENT,
              color: T.bg,
              fontSize: 13,
              fontWeight: 800,
              textAlign: "center",
              textDecoration: "none",
            }}
          >
            Claim {offerStr} for a month →
          </a>

          <div style={{ marginTop: 11, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, color: DIMMER }}>
            <span>{left ?? "no expiry"}</span>
            {offer.code && (
              <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}>{offer.code}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
