"use client";

// ─────────────────────────────────────────────────────────────────────────────
// EVERY LINK OUT TO VOLTICK, AND THE ONLY ONE.
//
// While sales are closed, sending someone to Voltick is the single conversion
// this site still has. An untracked <a href={VOLTICK_URL}> tells you nothing:
// not how many people went, not from which surface, not whether the pricing
// page's notice does any work compared with the hero button. Voltick's own
// analytics can see arrivals but cannot see WHICH of our four placements sent
// them, because they are all the same referrer.
//
// So: no raw anchor to VOLTICK_URL anywhere in the tree. Use this. A link that
// is not this one is a click nobody counted.
//
// ── HOW IT'S STORED ─────────────────────────────────────────────────────────
//
// It reuses /api/page-status — the beacon every public page already fires —
// rather than adding an endpoint. Three reasons, and they are the whole design:
//
//   1. NO MIGRATION. It writes a normal `page_visits` row, so a click arrives
//      carrying IP, Cloudflare geo, browser/OS/device and the signed-in user_id
//      if there is one — all the columns the owner visitor map already reads.
//      A new table would need a migration, a query, and a page to show it.
//   2. IT IS ALREADY PUBLIC. /api/page-status is in middleware's PUBLIC_PATTERNS
//      and registered in server-v2/api-router.js, which intercepts /api/* before
//      middleware runs in production. A brand-new /api/* route would have to be
//      added to both, and getting either wrong means a signed-out visitor — i.e.
//      everyone this page is for — silently logs nothing.
//   3. IT ALREADY SURVIVES THE NAVIGATION. sendBeacon is queued by the browser
//      at the lowest priority and is explicitly allowed to outlive the document,
//      which matters here more than anywhere else on the site: the click IS a
//      navigation away, and a plain fetch() would usually be cancelled mid-flight.
//
// HOW TO READ IT: the rows are `page_key = 'click:voltick'`, with `page_label`
// carrying the placement and `path` the page it happened on. Group by page_label
// for "which button", by path for "which page", by day for the trend.
//
// ── TWO THINGS THAT LOOK LIKE BUGS AND ARE NOT ──────────────────────────────
//
// `isEntry: false`, always. The entry flag marks the FIRST beacon of a browser
// session and is what carries referrer/UTM; session counts are
// COUNT(*) WHERE is_entry. A click is never an arrival, and letting it claim the
// flag would invent a session and attribute it to ourselves.
//
// `isLoaded: true` is what makes /api/page-status write the visit row at all —
// the unload beacon deliberately writes none. The side effect is one row in
// `page_load_status` named `click:voltick` that reads as permanently loaded.
// That is not a leak; its total_loads counter is a running total of Voltick
// clicks, which is the headline number anyway.
// ─────────────────────────────────────────────────────────────────────────────

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { VOLTICK_URL } from "@/lib/salesClosed";

/** One key for every placement, so the counter is "clicks to Voltick, total". */
const CLICK_PAGE_KEY = "click:voltick";

/**
 * Where the click happened. Free-form, but keep them short and stable — they
 * become `page_label` and a renamed one splits its own history in two.
 * Current placements:
 *   landing-hero-cta · landing-volt-card · landing-footer
 *   pricing-notice   · sign-up-notice
 */
export type VoltickPlacement = string;

function report(placement: VoltickPlacement): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    pageKey: CLICK_PAGE_KEY,
    pageLabel: placement,
    path: window.location.pathname,
    isLoaded: true,
    lastLoadedAt: new Date().toISOString(),
    // See the header: a click is not a session entry.
    isEntry: false,
    referrer: null,
    query: null,
  });

  // Telemetry must never be able to break, or delay, the navigation the visitor
  // actually asked for. Every branch here is wrapped and every failure is
  // swallowed: a lost click row is an annoyance, a thrown error on the way out
  // is a visitor stuck on a dead button.
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/page-status", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    void fetch("/api/page-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      // Without this the request is cancelled the moment the document goes away,
      // which on this particular link is immediately.
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* non-fatal */
  }
}

export default function VoltickLink({
  placement,
  href = VOLTICK_URL,
  style,
  className,
  children,
  newTab = false,
}: {
  /** Which surface this link sits on. Becomes `page_label`. */
  placement: VoltickPlacement;
  /** Defaults to VOLTICK_URL — pass one only for a deep link into their site. */
  href?: string;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
  /** Open in a new tab. Off by default: every existing Voltick link navigates. */
  newTab?: boolean;
}) {
  // onClick covers a normal click and the keyboard's Enter (browsers dispatch a
  // click for it). onAuxClick catches the middle-click that opens a background
  // tab — a real visit that fires no click event, and the one people use most
  // when they are not ready to leave the page they are reading.
  const fire = (_e: MouseEvent<HTMLAnchorElement>) => report(placement);

  return (
    <a
      href={href}
      style={style}
      className={className}
      onClick={fire}
      onAuxClick={fire}
      // noreferrer is deliberately NOT set. Voltick should be able to see that
      // the traffic came from cbedge.net — that is the point of sending it.
      {...(newTab ? { target: "_blank", rel: "noopener" } : {})}
    >
      {children}
    </a>
  );
}
