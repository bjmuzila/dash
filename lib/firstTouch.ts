import type { NextRequest } from "next/server";
import {
  SELF_HOSTS,
  classifyChannel,
  parseReferrer,
  parseUserAgent,
  parseUtm,
  type Channel,
} from "@/lib/visitorAttribution";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FIRST-TOUCH ATTRIBUTION — "which link did this subscriber come from?"
 *
 * THE PROBLEM THIS EXISTS TO FIX
 *
 * page_visits already stores referrer/UTM, but ONLY on the first beacon of a
 * browser session (is_entry) — and at that moment the visitor is ANONYMOUS.
 * user_id on that row is NULL. Every later beacon in the session has the
 * user_id but posts null attribution BY DESIGN (lib/pageStatus.ts: sending
 * document.referrer on every SPA navigation would report one Google visit as
 * twenty).
 *
 * So the row that knows the campaign has no user, and the rows that know the
 * user have no campaign. Joining page_visits to a paying customer therefore
 * answers "direct" for nearly everyone, which is why the Sales page could never
 * say where a subscriber came from.
 *
 * THE FIX
 *
 * Stash the arrival on the VISITOR, in a cookie, the moment it happens — before
 * an account exists — and copy it onto the account at sign-up. Exactly the
 * shape lib/promoLinks.ts already uses for `cbe_promo`: the query string does
 * not survive the pricing → sign-up → checkout detour, and a cookie does.
 *
 * FIRST touch, not last: the record is written once and never overwritten while
 * it lives. The link that first brought someone to the site is the one that
 * earned the sale; a later direct visit on their way to paying is not a second
 * acquisition.
 *
 * The server's own `Referer` header is the right source HERE (unlike in the
 * beacon, where it points at the page firing it): on a document navigation it
 * is the page the visitor actually clicked from.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Cookie name. One place, read by middleware (write) and sign-up (consume). */
export const FIRST_TOUCH_COOKIE = "cbe_attr";

/** 180 days. Long enough to cover a slow decision, short enough to expire. */
export const FIRST_TOUCH_MAX_AGE = 180 * 24 * 60 * 60;

export interface FirstTouch {
  channel: Channel;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  referrer: string | null;
  referrerHost: string | null;
  /** The page the link actually landed on ("/", "/pricing", …). */
  landingPath: string | null;
  /** ISO timestamp of the arrival, not of the sign-up. */
  firstSeenAt: string;
}

// Stored under one-letter keys so the cookie stays small — a long referrer plus
// five UTM tags in verbose JSON pushes past what is polite to send on every
// request for the rest of the visit.
type Packed = {
  ch: string;
  s?: string; m?: string; c?: string; t?: string; n?: string;
  r?: string; h?: string; p?: string;
  at: string;
};

const MAX_COOKIE_BYTES = 1500;

function b64urlEncode(s: string): string {
  const bytes = typeof Buffer !== "undefined"
    ? Buffer.from(s, "utf8").toString("base64")
    : btoa(unescape(encodeURIComponent(s)));
  return bytes.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string | null {
  try {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/");
    return typeof Buffer !== "undefined"
      ? Buffer.from(pad, "base64").toString("utf8")
      : decodeURIComponent(escape(atob(pad)));
  } catch {
    return null;
  }
}

export function encodeFirstTouch(ft: FirstTouch): string {
  const packed: Packed = { ch: ft.channel, at: ft.firstSeenAt };
  if (ft.utmSource) packed.s = ft.utmSource;
  if (ft.utmMedium) packed.m = ft.utmMedium;
  if (ft.utmCampaign) packed.c = ft.utmCampaign;
  if (ft.utmTerm) packed.t = ft.utmTerm;
  if (ft.utmContent) packed.n = ft.utmContent;
  // Referrers can be enormous (search result URLs with a query in them). The
  // HOST is what every report groups by, so it is kept whole and the full URL
  // is the part that gets trimmed.
  if (ft.referrer) packed.r = ft.referrer.slice(0, 300);
  if (ft.referrerHost) packed.h = ft.referrerHost;
  if (ft.landingPath) packed.p = ft.landingPath.slice(0, 200);
  return b64urlEncode(JSON.stringify(packed));
}

/** Decode a cookie value. Returns null for anything malformed — a visitor can
 *  hand us any string they like, and a bad one must simply read as "no data". */
export function decodeFirstTouch(raw: string | null | undefined): FirstTouch | null {
  if (!raw || raw.length > MAX_COOKIE_BYTES * 2) return null;
  const json = b64urlDecode(raw);
  if (!json) return null;
  let p: Packed;
  try {
    p = JSON.parse(json) as Packed;
  } catch {
    return null;
  }
  if (!p || typeof p !== "object" || typeof p.ch !== "string") return null;
  const str = (v: unknown, max = 300): string | null =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  return {
    channel: p.ch as Channel,
    utmSource: str(p.s, 120),
    utmMedium: str(p.m, 120),
    utmCampaign: str(p.c, 120),
    utmTerm: str(p.t, 120),
    utmContent: str(p.n, 120),
    referrer: str(p.r, 300),
    referrerHost: str(p.h, 253),
    landingPath: str(p.p, 200),
    firstSeenAt: str(p.at, 40) ?? new Date().toISOString(),
  };
}

/**
 * Build the record for THIS request, or null when there is nothing worth
 * recording.
 *
 * "Nothing worth recording" is deliberate and does real work: a plain direct
 * hit on the landing page returns null, so no Set-Cookie is stamped on the
 * response and the cached public page stays cacheable for the bulk of traffic.
 * Only a tagged arrival (utm_*, a click id, ?ref=) or one with a genuine
 * external referrer is written — those are the arrivals that can answer the
 * question, and a tagged URL is unique anyway so caching is moot.
 */
export function captureFirstTouch(req: NextRequest): FirstTouch | null {
  const ua = parseUserAgent(req.headers.get("user-agent"));
  if (ua.isBot) return null;

  const utm = parseUtm(req.nextUrl.search);
  const ref = parseReferrer(req.headers.get("referer"), SELF_HOSTS);

  const tagged = Boolean(utm.utmSource || utm.utmMedium || utm.utmCampaign);
  const referred = Boolean(ref.referrerHost); // null for self-hosts and direct
  if (!tagged && !referred) return null;

  return {
    channel: classifyChannel(ref, utm),
    utmSource: utm.utmSource,
    utmMedium: utm.utmMedium,
    utmCampaign: utm.utmCampaign,
    utmTerm: utm.utmTerm,
    utmContent: utm.utmContent,
    referrer: ref.referrer,
    referrerHost: ref.referrerHost,
    landingPath: req.nextUrl.pathname,
    firstSeenAt: new Date().toISOString(),
  };
}

/** Cookie options. Mirrors sessionCookieOptions' stance: HttpOnly (nothing on
 *  the client reads this), Lax (it must survive the click in from X/Google),
 *  Secure in production only so local http dev still sets it. */
export function firstTouchCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: FIRST_TOUCH_MAX_AGE,
  };
}

/** One human-readable line for the owner UI: "x · launch", "google.com", … */
export function firstTouchLabel(ft: {
  utmSource?: string | null;
  utmCampaign?: string | null;
  referrerHost?: string | null;
  channel?: string | null;
} | null | undefined): string {
  if (!ft) return "unknown";
  if (ft.utmSource) return ft.utmCampaign ? `${ft.utmSource} · ${ft.utmCampaign}` : ft.utmSource;
  if (ft.referrerHost) return ft.referrerHost;
  if (ft.channel) return ft.channel;
  return "direct";
}
