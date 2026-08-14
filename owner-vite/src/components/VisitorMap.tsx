import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { geoNaturalEarth1, geoPath, geoArea, geoBounds, geoCentroid } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { OWNER_THEME as HOME_THEME, ownerRgba } from "../lib/theme";
import { ALPHA2_NAME, FEATURE_ID_TO_ALPHA2 } from "../lib/countryMaps";

/**
 * Visitor map for the Control Panel: a country choropleth with one dot per
 * VISITOR on top — not one dot per city. Cloudflare geolocates to a metro
 * centroid, so people who share a city share a coordinate; each visitor still
 * gets their own dot, fanned out around that shared point, so any single person
 * can be hovered and clicked. Zooming pulls the fan apart.
 *
 * Data path: Cloudflare's "Add visitor location headers" managed transform sets
 * cf-ipcountry → /api/page-status stores it on the page_visits row → the owner
 * reads it back through /api/page-visits. Rows logged before that transform was
 * switched on carry a null country and land in the "Unknown" bucket, which is
 * reported honestly in the footer rather than silently dropped.
 *
 * Precision is per-row, and the map says which it has. `latitude`/`longitude`
 * were being read from Cloudflare and then dropped on the way into the database
 * until 2026-08-13 (a key-name mismatch — see that day's changelog), so older
 * rows arrive with no coordinate. Most of them DO still carry a city, and
 * `server-v2/scripts/backfill-visit-geo.js` geocodes those back to a real
 * position; what remains is rows with a country and nothing finer. Rather than
 * drop those visitors off the map entirely, they are fanned out around their
 * COUNTRY's centroid and drawn dashed and dimmed. A solid dot is a place
 * we measured; a dashed one is a country we know and a position we invented.
 * The two are counted separately everywhere they are counted at all.
 *
 * The world geometry is vendored at public/countries-110m.json (world-atlas@2,
 * 110m resolution ≈ 105 KB) and fetched at runtime, so it never enters the JS
 * bundle. See src/lib/countryMaps.ts for the id ↔ alpha-2 lookup.
 */

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface VisitorMapRow {
  country?: string | null;
  region?: string | null;
  city?: string | null;
  /** City-centroid latitude/longitude from Cloudflare. Null pre-transform. */
  lat?: number | null;
  lon?: number | null;
  ip?: string | null;
  /** Per-visit detail for the click-to-pin card. */
  path?: string | null;
  pageLabel?: string | null;
  createdAt?: string | null;
  /** Account behind the visit, resolved server-side in /api/page-visits by
   *  joining page_visits.user_id against `users`. All null for signed-out
   *  traffic — those dots are labelled "Visitor". A `userId` with no
   *  `userEmail` means the session belonged to an account that's since gone.
   *  `userEmail` is also the strongest identity available, so it decides which
   *  dot a row belongs to (see `visitorKey`). */
  userId?: string | null;
  userEmail?: string | null;
  /** Linked Discord username, when the account has one. */
  userName?: string | null;
  userCreatedAt?: string | null;
  userLastLoginAt?: string | null;
  /** PAYING, not merely signed in — 'active' or 'trialing' on the subscriptions
   *  row, resolved server-side in /api/page-visits against libDb.PAID_STATUSES.
   *  This is what makes a dot gold. */
  isSubscriber?: boolean | null;
  /** The raw Stripe status behind `isSubscriber`, so a lapsed account reads as
   *  'past_due' / 'canceled' in the detail card instead of a flat "no". */
  subStatus?: string | null;
  isOwner?: boolean | null;
}

/** How many raw rows each country/visitor keeps for its detail card. Enough to
 *  fill the card's scroll area without holding the whole log twice. */
const SAMPLE_CAP = 60;

// cf-ipcountry sentinels that aren't real places: XX = Cloudflare couldn't
// geolocate the IP, T1 = Tor exit node. Both are grouped with "no country".
const NON_COUNTRY = new Set(["XX", "T1"]);

// Three world-atlas features carry no ISO numeric id (they're disputed or
// partially recognised), so the id → alpha-2 table can't reach them. Kosovo is
// the only one Cloudflare has a code for (XK); the other two stay "no data".
const NAME_TO_ALPHA2: Record<string, string> = { Kosovo: "XK" };

interface CountryStat {
  code: string;
  name: string;
  visits: number;
  unique: number;
  /** Most recent raw rows, for the pinned detail card. */
  sample: VisitorMapRow[];
}

/**
 * One plotted dot = ONE VISITOR, not one city.
 *
 * Cloudflare returns a city centroid, not a device position, so every visitor in
 * a metro shares a single coordinate. Rather than collapsing them into one fat
 * bubble, each visitor keeps its own dot and the co-located ones are fanned out
 * around the centroid (see `spreadOffset`) so they can be hovered and clicked
 * individually. `placeKey` identifies the shared coordinate — it's what the
 * fan-out is computed against, and what the location label reads from.
 */
interface VisitorDot {
  key: string;
  /** Shared city-centroid coordinate, before fan-out. */
  lat: number;
  lon: number;
  /** Coordinate-cluster key, and this dot's slot within that cluster. */
  placeKey: string;
  slot: number;
  slotCount: number;
  /** True when this dot has no city coordinate and is parked on its COUNTRY's
   *  centroid instead — a real visitor at an approximate position. Drawn
   *  dimmer and dashed so it never passes for a located one. Every row logged
   *  before the coordinate columns started being written (see the changelog for
   *  2026-08-12) is one of these, which is most of the history. */
  approx: boolean;
  /** Degrees of latitude this dot's cluster may fan across. A city cluster is
   *  ~1°; a country cluster is sized from the country's own bounding box so a
   *  US blob doesn't spill into Canada. */
  spreadDeg: number;
  /** "Denver, Colorado, United States" */
  placeLabel: string;
  /** What the map calls this person: their email if they were signed in,
   *  otherwise the honest "Visitor". */
  visitorLabel: string;
  /** True when at least one of this dot's rows carried a session. */
  signedIn: boolean;
  /** True when the account behind this dot is PAYING (active or trialing).
   *  This — not `signedIn` — is what fills a dot gold. A free registered
   *  account is a gold RING: identified, but not a customer, and the map has to
   *  be able to answer "where are the people actually paying" at a glance. */
  isSubscriber: boolean;
  /** Raw Stripe status, for the detail card. */
  subStatus: string | null;
  country: string | null;
  ip: string | null;
  /** Every IP this person was seen on at this location. */
  ips: string[];
  userId: string | null;
  email: string | null;
  discord: string | null;
  accountCreatedAt: string | null;
  lastLoginAt: string | null;
  isOwner: boolean;
  /** Page loads by this one visitor. */
  visits: number;
  sample: VisitorMapRow[];
}

interface Aggregate {
  byCode: Map<string, CountryStat>;
  ranked: CountryStat[];
  dots: VisitorDot[];
  /** How many of those dots are identified accounts rather than anonymous. */
  signedInDots: number;
  /** …and how many of THOSE are paying. The three counts the legend prints are
   *  subscriberDots / (signedInDots − subscriberDots) / (dots − signedInDots). */
  subscriberDots: number;
  placeCount: number;
  visitsWithCoords: number;
  totalVisits: number;
  totalUnique: number;
  unknownVisits: number;
  maxUnique: number;
  /** Dots placed on a real city coordinate, and dots parked on a country
   *  centroid because the row has no coordinate. `cityDots + approxDots ===
   *  dots.length`. Shown separately in the footer — a map that silently mixes
   *  measured and approximated positions is a map you can't trust. */
  cityDots: number;
  approxDots: number;
  /** How many countries the approximate dots are spread across. */
  approxCountries: number;
}

/** Where a country's approximate dots go, and how wide they may fan. */
export interface CountryAnchor {
  lat: number;
  lon: number;
  spreadDeg: number;
}

/** One identity per visitor, best effort: the account wins (email first, then
 *  user id) because it survives a changing IP, then the IP, then a per-row
 *  synthetic key so an unidentifiable row counts as its own visitor rather than
 *  merging with every other one. Used for the country counts AND the dots, so
 *  the choropleth and the dot layer can never report a different number of
 *  people.
 *
 *  Signed-out rows from the same IP as a signed-in one stay a SEPARATE dot on
 *  purpose: we know a session was attached to one and not the other, and
 *  quietly merging them would claim an identification the log doesn't support. */
function visitorKey(r: VisitorMapRow, fallback: number): string {
  const stable = stableVisitorKey(r);
  return stable ?? `anon:${fallback}`;
}

/** The identity half of `visitorKey`, without the per-row synthetic fallback.
 *  Null when the row carries nothing that could match another row — which is
 *  exactly when it must NOT be merged with anything. */
function stableVisitorKey(r: VisitorMapRow): string | null {
  if (r.userEmail) return `e:${r.userEmail.trim().toLowerCase()}`;
  if (r.userId) return `u:${r.userId}`;
  if (r.ip) return `ip:${r.ip}`;
  return null;
}

function aggregate(
  rows: VisitorMapRow[],
  /** Country centroids, once the world geometry has loaded. Null before that,
   *  which simply means no approximate dots are produced yet. */
  anchors: Map<string, CountryAnchor> | null,
): Aggregate {
  const acc = new Map<string, { visits: number; ips: Set<string>; sample: VisitorMapRow[] }>();
  const globalVisitors = new Set<string>();
  // One entry per (coordinate cluster × visitor) — the dot layer's unit of work.
  const dotAcc = new Map<string, {
    lat: number; lon: number; placeKey: string; placeLabel: string;
    approx: boolean; spreadDeg: number;
    signedIn: boolean; isSubscriber: boolean; subStatus: string | null;
    country: string | null; ips: Set<string>;
    userId: string | null; email: string | null; discord: string | null;
    accountCreatedAt: string | null; lastLoginAt: string | null; isOwner: boolean;
    visits: number; sample: VisitorMapRow[];
  }>();
  // Fan-out needs to know how crowded each coordinate is, so count dots per place.
  const placeSizes = new Map<string, number>();
  let unknownVisits = 0;
  let totalVisits = 0;
  let visitsWithCoords = 0;
  let anonSeq = 0;

  // Someone seen today (with a city coordinate) and last week (without one) is
  // ONE person — they must not appear as a dot in their city PLUS a second dot
  // on the country centroid. So remember where each visitor is known to be,
  // per country, and let their coordinate-less rows join that dot instead of
  // falling back to the country. Rows arrive newest-first, so the first hit is
  // their most recent known location.
  const knownPlace = new Map<string, { key: string; lat: number; lon: number; label: string }>();
  for (const r of rows) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    const cc = (r.country || "").toUpperCase();
    if (!cc || NON_COUNTRY.has(cc)) continue;
    const id = stableVisitorKey(r);
    if (!id) continue;
    const k = `${id}|${cc}`;
    if (knownPlace.has(k)) continue;
    knownPlace.set(k, {
      key: `${r.lat.toFixed(2)},${r.lon.toFixed(2)}`,
      lat: r.lat,
      lon: r.lon,
      label:
        [r.city, r.region, ALPHA2_NAME[cc] || cc].filter(Boolean).join(", ") ||
        `${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}`,
    });
  }

  for (const r of rows) {
    const code = (r.country || "").toUpperCase();
    totalVisits++;
    const vid = visitorKey(r, ++anonSeq);
    globalVisitors.add(vid);

    // Dot layer is independent of the choropleth: a row can have coords even
    // if its country code is a sentinel, and vice versa.
    const realCountry = code && !NON_COUNTRY.has(code) ? code : null;
    const hasCoords =
      typeof r.lat === "number" && typeof r.lon === "number" &&
      Number.isFinite(r.lat) && Number.isFinite(r.lon);
    // Where this row's dot goes, in order of how much we actually know:
    //   1. this row's own city coordinate,
    //   2. a city we've seen THIS visitor at in this country (so one person is
    //      one dot, not a city dot plus a country dot),
    //   3. the country's centroid, flagged approximate,
    //   4. nothing — no coordinate and no usable country code.
    const stableId = !hasCoords ? stableVisitorKey(r) : null;
    const known = stableId && realCountry ? knownPlace.get(`${stableId}|${realCountry}`) ?? null : null;
    const anchor = !hasCoords && !known && realCountry ? anchors?.get(realCountry) ?? null : null;
    const place = hasCoords
      ? {
          // 2dp ≈ 1 km — tight enough to keep distinct cities apart, loose
          // enough that one city's rows share one centroid to fan out from.
          key: `${(r.lat as number).toFixed(2)},${(r.lon as number).toFixed(2)}`,
          lat: r.lat as number,
          lon: r.lon as number,
          approx: false,
          spreadDeg: SPREAD_MAX_DEG,
          label:
            [r.city, r.region, realCountry ? ALPHA2_NAME[realCountry] || realCountry : null]
              .filter(Boolean)
              .join(", ") || `${(r.lat as number).toFixed(2)}, ${(r.lon as number).toFixed(2)}`,
        }
      : known
        ? {
            key: known.key,
            lat: known.lat,
            lon: known.lon,
            approx: false,
            spreadDeg: SPREAD_MAX_DEG,
            label: known.label,
          }
        : anchor
          ? {
              key: `cc:${realCountry}`,
              lat: anchor.lat,
              lon: anchor.lon,
              approx: true,
              spreadDeg: anchor.spreadDeg,
              label: `${ALPHA2_NAME[realCountry!] || realCountry} · country only`,
            }
          : null;

    if (hasCoords) visitsWithCoords++;

    if (place) {
      // Keyed per (location × visitor): the same person seen in two cities is
      // two dots, because each dot answers "who was here", not "who exists".
      const dk = `${place.key}|${vid}`;
      let dot = dotAcc.get(dk);
      if (!dot) {
        dot = {
          lat: place.lat,
          lon: place.lon,
          placeKey: place.key,
          placeLabel: place.label,
          approx: place.approx,
          spreadDeg: place.spreadDeg,
          signedIn: Boolean(r.userEmail || r.userId),
          isSubscriber: Boolean(r.isSubscriber),
          subStatus: r.subStatus ?? null,
          country: realCountry,
          ips: new Set<string>(),
          userId: r.userId ?? null,
          email: r.userEmail ?? null,
          discord: r.userName ?? null,
          accountCreatedAt: r.userCreatedAt ?? null,
          lastLoginAt: r.userLastLoginAt ?? null,
          isOwner: Boolean(r.isOwner),
          visits: 0,
          sample: [],
        };
        dotAcc.set(dk, dot);
        placeSizes.set(place.key, (placeSizes.get(place.key) ?? 0) + 1);
      }
      dot.visits++;
      if (r.ip) dot.ips.add(r.ip);
      // Later rows can carry detail the first one lacked (an account row logged
      // before the email join existed, a session that started mid-visit).
      if (!dot.userId && r.userId) dot.userId = r.userId;
      if (!dot.email && r.userEmail) dot.email = r.userEmail;
      if (!dot.discord && r.userName) dot.discord = r.userName;
      if (!dot.accountCreatedAt && r.userCreatedAt) dot.accountCreatedAt = r.userCreatedAt;
      if (!dot.lastLoginAt && r.userLastLoginAt) dot.lastLoginAt = r.userLastLoginAt;
      if (r.isOwner) dot.isOwner = true;
      if (r.userEmail || r.userId) dot.signedIn = true;
      // Subscription is resolved per-ROW from a single live join, so every row
      // for one account agrees. Taking the true one anyway keeps the dot right
      // if a visit predates the account's identity being resolvable at all.
      if (r.isSubscriber) dot.isSubscriber = true;
      if (!dot.subStatus && r.subStatus) dot.subStatus = r.subStatus;
      if (dot.sample.length < SAMPLE_CAP) dot.sample.push(r);
    }

    if (!code || NON_COUNTRY.has(code)) {
      unknownVisits++;
      continue;
    }
    let bucket = acc.get(code);
    if (!bucket) {
      bucket = { visits: 0, ips: new Set<string>(), sample: [] };
      acc.set(code, bucket);
    }
    bucket.visits++;
    if (bucket.sample.length < SAMPLE_CAP) bucket.sample.push(r);
    bucket.ips.add(vid);
  }

  const byCode = new Map<string, CountryStat>();
  for (const [code, b] of acc) {
    byCode.set(code, {
      code,
      name: ALPHA2_NAME[code] || code,
      visits: b.visits,
      unique: b.ips.size,
      sample: b.sample,
    });
  }
  const ranked = [...byCode.values()].sort((a, b) => b.unique - a.unique);

  // Assign each dot its slot within its coordinate cluster, in insertion order,
  // so a visitor's position on the map is stable between refreshes as long as
  // the log's ordering is. Busiest dots sort last → drawn on top → clickable.
  const slotCursor = new Map<string, number>();
  const dots: VisitorDot[] = [...dotAcc.entries()]
    .map(([key, d]) => {
      const slot = slotCursor.get(d.placeKey) ?? 0;
      slotCursor.set(d.placeKey, slot + 1);
      const ips = [...d.ips];
      return {
        key,
        lat: d.lat,
        lon: d.lon,
        placeKey: d.placeKey,
        slot,
        slotCount: placeSizes.get(d.placeKey) ?? 1,
        placeLabel: d.placeLabel,
        approx: d.approx,
        spreadDeg: d.spreadDeg,
        // An account without a resolvable email still isn't anonymous, so it
        // reads as the id rather than being demoted to "Visitor".
        visitorLabel: d.email || d.discord || (d.userId ? `${d.userId.slice(0, 12)}…` : "Visitor"),
        signedIn: d.signedIn,
        isSubscriber: d.isSubscriber,
        subStatus: d.subStatus,
        country: d.country,
        ip: ips[0] ?? null,
        ips,
        userId: d.userId,
        email: d.email,
        discord: d.discord,
        accountCreatedAt: d.accountCreatedAt,
        lastLoginAt: d.lastLoginAt,
        isOwner: d.isOwner,
        visits: d.visits,
        sample: d.sample,
      };
    })
    // Paying subscribers sort LAST so they draw on top of the fan and win the
    // click when a customer shares a city with twenty anonymous visitors. Every
    // dot is the same size now, so draw order is the ONLY thing deciding who is
    // reachable where marks overlap — within each tier the busiest still sorts
    // last, as before.
    .sort((a, b) => (a.isSubscriber ? 1 : 0) - (b.isSubscriber ? 1 : 0) || a.visits - b.visits);

  return {
    byCode,
    ranked,
    dots,
    signedInDots: dots.reduce((n, d) => n + (d.signedIn ? 1 : 0), 0),
    subscriberDots: dots.reduce((n, d) => n + (d.isSubscriber ? 1 : 0), 0),
    // Real places only — a country centroid is not a location the visitor was at.
    placeCount: [...placeSizes.keys()].filter((k) => !k.startsWith("cc:")).length,
    visitsWithCoords,
    totalVisits,
    totalUnique: globalVisitors.size,
    unknownVisits,
    maxUnique: ranked.length ? ranked[0].unique : 0,
    cityDots: dots.reduce((n, d) => n + (d.approx ? 0 : 1), 0),
    approxDots: dots.reduce((n, d) => n + (d.approx ? 1 : 0), 0),
    approxCountries: new Set(dots.filter((d) => d.approx).map((d) => d.placeKey)).size,
  };
}

// ── Color ramp ───────────────────────────────────────────────────────────────

// Three-stop sequential ramp in ONE hue (the owner teal), running near-surface →
// theme cyan. Traffic is heavily skewed toward one or two countries, so the
// domain is square-rooted; a linear ramp would render everything but the top
// country as the same near-empty shade.
//
// The old ramp topped out at a near-white #9BD8EC, which is where the busiest
// country sits — and gold-on-#9BD8EC is a 1.12:1 contrast ratio, i.e. the dots
// vanished into exactly the country you most want to read. Capping the ramp at
// HOME_THEME.cyan costs nothing (the choropleth is context; the dots are the
// data) and takes that worst case to 1.80:1, with the surface ring below doing
// the rest of the work.
const RAMP: Array<[number, number, number]> = [
  [10, 38, 50],   // #0A2632  — barely above the panel
  [22, 90, 116],  // #165A74
  [33, 158, 188], // #219EBC  (HOME_THEME.cyan) — the ceiling, not near-white
];

const EMPTY_FILL = "rgba(255,255,255,0.045)";
const STROKE = "rgba(255,255,255,0.16)";
// The card surface, used as the dots' separating ring (see MEMBER_STROKE).
const SURFACE = "#0D1119"; // HOME_THEME.panelBgStrong

function rampColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const [r1, g1, b1] = RAMP[i];
  const [r2, g2, b2] = RAMP[i + 1];
  const mix = (a: number, b: number) => Math.round(a + (b - a) * f);
  return `rgb(${mix(r1, r2)},${mix(g1, g2)},${mix(b1, b2)})`;
}

function intensity(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  // sqrt compresses the long tail so mid-volume countries stay legible.
  return Math.sqrt(value / max);
}

// ── Visitor dots ─────────────────────────────────────────────────────────────

// ONE size for every dot. A dot is a person, and one person is not worth more
// map than another — scaling by page loads made the owner's own dot a crater
// over the east coast and buried the visitors underneath it, while saying
// nothing you could not read off the detail card. Page loads are a per-visitor
// number, not a spatial one; the map's job here is WHERE and WHO, and both of
// those now use their own channel (position, and hue+fill) with nothing
// competing. Whoever wants the counts can hover.
const DOT_R = 4;
// THREE states, on two independent channels — hue and fill:
//
//   solid GOLD   paying subscriber (active or trialing)
//   hollow GOLD  signed-in account that is NOT paying
//   hollow SLATE anonymous visitor, known only by IP
//
// Gold used to mean "signed in", which put a free registration and a paying
// customer in the same colour and made the map useless for the one question it
// is best placed to answer: where is the revenue. Hue now means "has an
// account", fill means "is paying" — two channels, so the distinction survives
// colour-blindness and 3px rendering, and the busiest reading (solid gold) is
// the rarest and most valuable state.
//
// Each mark pairs its colour with the SURFACE colour, and that is what keeps it
// visible over every country shade, because the two are contrast-complementary
// against the ramp. A gold fill over the busiest (palest) country is weak at
// 1.8:1, but its dark ring there is 6.0:1; over an empty near-black country the
// ring vanishes and the gold fill carries it at 9.0:1. Same trick inverted for
// the visitor dot: its dark fill is 6.0:1 on a pale country, its slate ring is
// 5.1:1 on a dark one. Whichever half of a mark loses contrast, the other half
// holds — so no dot goes missing at any step of the ramp. (Slate alone would
// have been 1.02:1 on the busiest country: invisible. Hence the dark fill.)
// A ring in the surface colour is also the standard way to keep overlapping
// dots legible, which matters here because co-located visitors are a tight fan.
const BUBBLE_FILL = "rgba(13,17,25,0.85)";      // surface, so it reads hollow
const BUBBLE_STROKE = "rgba(138,147,166,0.95)"; // #8A93A6 slate — anonymous
const MEMBER_FILL = "#FFB703";                  // OWNER_THEME.gold — PAYING
const MEMBER_STROKE = SURFACE;
/** Free registered account: the gold hue, but hollow — the same dark disc the
 *  anonymous dot uses, ringed in gold instead of slate. Reads as "we know who
 *  this is" at a glance and "not a customer" on a second look. */
const FREE_FILL = BUBBLE_FILL;
const FREE_STROKE = MEMBER_FILL;
// A country-centroid dot is a real person at a position we are guessing, so it
// keeps its identity colour (you can still see who is signed in) but loses
// solidity: dashed ring, half opacity. Precision is a visual property here, not
// a footnote — nobody reads the footnote while pointing at a dot.
const APPROX_OPACITY = 0.5;
const APPROX_DASH = "2.5 2.5";
/** Text/badge colour for anonymous visitors, matching their dot. */
const VISITOR_INK = "#8A93A6";

// Golden angle: successive slots land on opposite sides of the cluster, so a
// sunflower spiral fills evenly instead of forming spokes.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
// Degrees of latitude the widest cluster may span. Small on purpose: at k=1 the
// fan is a couple of pixels wide and reads as one place; zooming in is what
// separates the individual people.
const SPREAD_MAX_DEG = 0.9;

/**
 * Fan co-located visitors out around their shared city centroid.
 *
 * Cloudflare geolocates to a metro, not a device, so without this every visitor
 * in a city would stack into one dot and only the topmost would be clickable.
 * The offset is deterministic (slot index → position), never random, so a dot
 * doesn't jump between renders. Longitude is divided by cos(lat) so the fan
 * stays circular on screen instead of stretching near the poles.
 */
function spreadOffset(
  lat: number,
  lon: number,
  slot: number,
  count: number,
  maxDeg: number = SPREAD_MAX_DEG,
): [number, number] {
  if (count <= 1) return [lat, lon];
  // Density is what sets the fan's size, capped by how much room the cluster
  // has: a city gets SPREAD_MAX_DEG, a country gets a slice of its own bounding
  // box. The 0.12°/visitor growth is kept for cities; a country cluster holds
  // hundreds of people, so it scales off its cap instead of creeping there.
  const spread = maxDeg <= SPREAD_MAX_DEG
    ? Math.min(maxDeg, 0.12 * Math.sqrt(count))
    : maxDeg * Math.min(1, Math.sqrt(count) / 12);
  const radius = spread * Math.sqrt((slot + 0.5) / count);
  const angle = (slot + 1) * GOLDEN_ANGLE;
  const dLat = radius * Math.sin(angle);
  const dLon = (radius * Math.cos(angle)) / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lon + dLon];
}

/** The biggest landmass of a country feature, by solid angle. Used for the
 *  country centroid and its bounding box — see `countryAnchors`. */
function mainlandOf(f: Feature<Geometry, { name?: string }>): Feature<Geometry, { name?: string }> {
  const g = f.geometry as Geometry & { type: string; coordinates?: unknown };
  if (!g || g.type !== "MultiPolygon") return f;
  const parts = (g as unknown as { coordinates: number[][][][] }).coordinates;
  let best: Geometry | null = null;
  let bestArea = -1;
  for (const coordinates of parts) {
    const poly = { type: "Polygon", coordinates } as unknown as Geometry;
    const area = geoArea(poly as never);
    if (area > bestArea) { bestArea = area; best = poly; }
  }
  return best ? { type: "Feature", properties: f.properties, geometry: best } : f;
}

// ── Sizing ───────────────────────────────────────────────────────────────────

const ASPECT = 2.5;
const MIN_HEIGHT = 320;

// Return type is inferred rather than annotated: React 18 and 19 disagree on
// whether useRef<T>(null) is RefObject<T> or RefObject<T | null>, and inference
// stays correct under both.
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(w);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// ── Component ────────────────────────────────────────────────────────────────

/** A pinned country or visitor, with the raw rows behind it. */
interface SelectedPlace {
  kind: "country" | "visitor";
  name: string;
  /** Secondary line — the visitor's location, or nothing for a country. */
  sub?: string | null;
  /** Countries report distinct visitors; a visitor dot is always 1. */
  unique: number;
  visits: number;
  sample: VisitorMapRow[];
  /** The dot itself, so the card can show who this was. Absent for countries. */
  account?: VisitorDot | null;
}

interface HoverState {
  /** "visitor" hovers come from a dot, "country" from the choropleth beneath. */
  kind: "country" | "visitor";
  code: string | null;
  name: string;
  sub?: string | null;
  signedIn?: boolean;
  isSubscriber?: boolean;
  unique: number;
  visits: number;
  x: number;
  y: number;
}

// ── Zoom / pan ───────────────────────────────────────────────────────────────
//
// Hand-rolled rather than pulling in d3-zoom: the whole behaviour is one
// transform on a <g>, and d3-zoom would add a dependency plus its own event
// layer fighting the per-country mouse handlers.

interface View { k: number; x: number; y: number }

const IDENTITY: View = { k: 1, x: 0, y: 0 };
const MIN_K = 1;
const MAX_K = 12;
const STEP = 1.6; // per button press

/**
 * Keep the map covering the viewport: at k=1 the translation is pinned to 0,
 * and zoomed in you can never drag empty space into frame.
 */
function clampView(v: View, w: number, h: number): View {
  const k = Math.min(MAX_K, Math.max(MIN_K, v.k));
  return {
    k,
    x: Math.min(0, Math.max(w * (1 - k), v.x)),
    y: Math.min(0, Math.max(h * (1 - k), v.y)),
  };
}

/** Zoom to `nextK` while holding the point (px, py) fixed under the cursor. */
function zoomAbout(v: View, nextK: number, px: number, py: number, w: number, h: number): View {
  const k = Math.min(MAX_K, Math.max(MIN_K, nextK));
  const ratio = k / v.k;
  return clampView({ k, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio }, w, h);
}

const sectionLabel: CSSProperties = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: HOME_THEME.text,
  opacity: 0.45,
  margin: "10px 0 4px",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Detail card for a clicked country or visitor. Everything here is derived from
 *  the sampled raw rows the aggregator kept — no extra fetch. */
function PlaceCard({ place, onClose }: { place: SelectedPlace; onClose: () => void }) {
  const acct = place.kind === "visitor" ? place.account ?? null : null;
  const { topPages, recent, ips } = useMemo(() => {
    const pageCounts = new Map<string, number>();
    const ipSet = new Set<string>();
    for (const r of place.sample) {
      const label = r.pageLabel || r.path || "(unknown page)";
      pageCounts.set(label, (pageCounts.get(label) ?? 0) + 1);
      if (r.ip) ipSet.add(r.ip);
    }
    const withTime = place.sample
      .filter((r) => r.createdAt)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
    return {
      topPages: [...pageCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      recent: withTime.slice(0, 12),
      ips: [...ipSet],
    };
  }, [place]);

  const Row = ({ label, value }: { label: string; value: ReactNode }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14, padding: "4px 0" }}>
      <span style={{ color: HOME_THEME.text, opacity: 0.6, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ color: HOME_THEME.text, fontFamily: "var(--font-mono)", textAlign: "right", overflowWrap: "anywhere", minWidth: 0 }}>{value}</span>
    </div>
  );

  return (
    <div
      style={{
        position: "absolute", top: 12, right: 12, zIndex: 5,
        width: 300, maxHeight: "calc(100% - 24px)",
        display: "flex", flexDirection: "column",
        background: HOME_THEME.panelBgStrong,
        border: `1px solid ${HOME_THEME.borderStrong}`,
        borderRadius: 12,
        boxShadow: `0 10px 34px ${ownerRgba("#000000", 0.6)}`,
        overflow: "hidden",
      }}
      // Don't let a drag that starts on the card pan the map underneath.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${HOME_THEME.border}`, display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: HOME_THEME.text, overflow: "hidden", textOverflow: "ellipsis" }}>
            {place.name}
          </div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: place.kind !== "visitor" ? HOME_THEME.lightBlue : acct?.signedIn ? HOME_THEME.gold : VISITOR_INK, marginTop: 2 }}>
            {place.kind !== "visitor"
              ? "Country"
              : acct?.isOwner
                ? "Signed in · owner (you)"
                : acct?.isSubscriber
                  ? `Subscriber${acct.subStatus === "trialing" ? " · trialing" : ""}`
                  : acct?.signedIn
                    // A lapsed customer is NOT the same as someone who never
                    // paid, and the difference is the whole point of the card.
                    ? acct.subStatus
                      ? `Free account · ${acct.subStatus}`
                      : "Free account"
                    : "Visitor · not signed in"}
          </div>
          {place.sub && (
            <div style={{ fontSize: 11, color: HOME_THEME.text, opacity: 0.55, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {place.sub}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "transparent", border: `1px solid ${HOME_THEME.border}`, color: HOME_THEME.text,
            borderRadius: 6, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "3px 7px", flexShrink: 0,
          }}
        >×</button>
      </div>

      <div className="owner-scroll" style={{ overflowY: "auto", padding: "8px 12px 12px" }}>
        {place.kind === "country" && <Row label="Unique visitors" value={place.unique.toLocaleString()} />}
        <Row label="Page loads" value={place.visits.toLocaleString()} />
        {place.kind === "country" && ips.length > 0 && <Row label="Distinct IPs seen" value={ips.length.toLocaleString()} />}

        {/* Who this was. Present only for a visitor dot; an account section that
            says "not signed in" is more useful than no section, because it
            answers the question rather than leaving it ambiguous. */}
        {acct && (
          <>
            <div style={sectionLabel}>Account</div>
            {acct.signedIn ? (
              <>
                {acct.email && <Row label="Email" value={acct.email} />}
                {acct.discord && <Row label="Discord" value={acct.discord} />}
                {acct.userId && <Row label="User ID" value={`${acct.userId.slice(0, 14)}…`} />}
                {acct.accountCreatedAt && <Row label="Member since" value={fmtDate(acct.accountCreatedAt)} />}
                <Row
                  label="Last login"
                  value={acct.lastLoginAt ? fmtDateTime(acct.lastLoginAt) : "never (no session row)"}
                />
                {/* Spelled out rather than left to the dot's colour: "no
                    subscription" and "canceled last week" look identical on the
                    map and could not be less alike in what you'd do about it. */}
                <Row
                  label="Subscription"
                  value={
                    acct.isSubscriber
                      ? acct.subStatus === "trialing" ? "trialing" : "active"
                      : acct.subStatus || "none"
                  }
                />
              </>
            ) : (
              <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.6, padding: "4px 0", lineHeight: 1.5 }}>
                No session on any of these loads — anonymous visitor, identified
                only by IP.
              </div>
            )}
            {acct.placeLabel && <Row label="Location" value={acct.placeLabel} />}
            {acct.ips.length > 0 && (
              <Row label={acct.ips.length === 1 ? "IP" : `IPs (${acct.ips.length})`} value={acct.ips.join(", ")} />
            )}
          </>
        )}

        {topPages.length > 0 && (
          <>
            <div style={sectionLabel}>Top pages</div>
            {topPages.map(([label, n]) => (
              <Row key={label} label={label} value={n.toLocaleString()} />
            ))}
          </>
        )}

        {recent.length > 0 && (
          <>
            <div style={sectionLabel}>Recent visits</div>
            {recent.map((r, i) => (
              <div key={i} style={{ padding: "5px 0", borderBottom: i === recent.length - 1 ? "none" : `1px solid ${HOME_THEME.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}>
                  <span style={{ color: HOME_THEME.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.pageLabel || r.path || "—"}
                  </span>
                  <span style={{ color: HOME_THEME.text, opacity: 0.55, fontFamily: "var(--font-mono)", flexShrink: 0, fontSize: 10 }}>
                    {new Date(r.createdAt!).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
                {r.ip && (
                  <div style={{ fontSize: 10, color: HOME_THEME.text, opacity: 0.4, fontFamily: "var(--font-mono)", marginTop: 1 }}>
                    {r.ip}{r.userId ? ` · ${r.userId.slice(0, 12)}…` : ""}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {place.sample.length >= SAMPLE_CAP && (
          <div style={{ fontSize: 10, color: HOME_THEME.text, opacity: 0.35, marginTop: 8 }}>
            Showing the first {SAMPLE_CAP} logged rows for this location.
          </div>
        )}
      </div>
    </div>
  );
}

export function VisitorMap({ rows }: { rows: VisitorMapRow[] }) {
  const [features, setFeatures] = useState<Array<Feature<Geometry, { name?: string }>> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  // Click pins a place; hover only previews it. Kept separate so moving the
  // mouse away doesn't dismiss the card you just opened.
  const [selected, setSelected] = useState<SelectedPlace | null>(null);
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const [view, setView] = useState<View>(IDENTITY);
  const [showBubbles, setShowBubbles] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  // What a click right now would pin. Written by the same mousemove handlers
  // that drive the tooltip, and read on pointerup — see endDrag for why this
  // can't just be an onClick on the geometry.
  const pending = useRef<SelectedPlace | null>(null);
  // getBoundingClientRect() forces a layout flush; calling it on every
  // mousemove was a measurable chunk of this component's hover cost. Cache it
  // and invalidate on resize/scroll instead.
  const rectRef = useRef<DOMRect | null>(null);
  const svgRect = useCallback((): DOMRect | null => {
    if (!rectRef.current && svgRef.current) rectRef.current = svgRef.current.getBoundingClientRect();
    return rectRef.current;
  }, []);
  useEffect(() => {
    const invalidate = () => { rectRef.current = null; };
    window.addEventListener("scroll", invalidate, true);
    window.addEventListener("resize", invalidate);
    return () => {
      window.removeEventListener("scroll", invalidate, true);
      window.removeEventListener("resize", invalidate);
    };
  }, []);
  // Drag state lives in a ref: panning shouldn't re-render on every pointermove
  // beyond the one setView call, and a ref avoids stale-closure bugs.
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);

  // World geometry: fetched once, cached by the browser. A failure here must
  // degrade to a readable message, never an empty card with no explanation.
  useEffect(() => {
    let cancelled = false;
    const url = `${import.meta.env.BASE_URL}countries-110m.json`;
    fetch(url, { cache: "force-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((topo) => {
        if (cancelled) return;
        const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, { name?: string }>;
        setFeatures(fc.features);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err?.message || err));
      });
    return () => { cancelled = true; };
  }, []);

  // Country centroids, derived from the same geometry the choropleth draws, so
  // an approximate dot always lands inside the country it belongs to and no
  // second data file has to be vendored or kept in sync.
  //
  // A country's centroid is taken from its LARGEST polygon, not the whole
  // MultiPolygon: France's overseas départements would otherwise drag its
  // centre into the Atlantic, and the USA's would sit somewhere near Alaska.
  const countryAnchors = useMemo(() => {
    if (!features) return null;
    const m = new Map<string, CountryAnchor>();
    for (const f of features) {
      const code =
        FEATURE_ID_TO_ALPHA2[String(f.id)] ?? NAME_TO_ALPHA2[f.properties?.name ?? ""] ?? null;
      if (!code || m.has(code)) continue;
      const main = mainlandOf(f);
      const [lon, lat] = geoCentroid(main);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const [[w, s], [e, n]] = geoBounds(main);
      // Fan across a third of the country's SHORTER side, so the blob stays
      // inside the border rather than bleeding into the neighbours.
      const span = Math.min(Math.abs(n - s), Math.abs(e - w));
      m.set(code, { lat, lon, spreadDeg: Math.max(1.2, Math.min(9, span * 0.33)) });
    }
    return m;
  }, [features]);

  const stats = useMemo(() => aggregate(rows, countryAnchors), [rows, countryAnchors]);

  const height = Math.max(MIN_HEIGHT, Math.round((width || 900) / ASPECT));

  // Projection is refitted whenever the container resizes so the map always
  // fills the card instead of being letterboxed at a fixed scale.
  // One projection shared by the choropleth and the bubble layer, so a dot always
  // lands inside the country it belongs to.
  const projection = useMemo(() => {
    if (!features || !width) return null;
    return geoNaturalEarth1().fitSize([width, height], {
      type: "FeatureCollection",
      features,
    } as FeatureCollection);
  }, [features, width, height]);

  const paths = useMemo(() => {
    if (!features || !projection) return [];
    const path = geoPath(projection);
    return features.map((f) => {
      const code =
        FEATURE_ID_TO_ALPHA2[String(f.id)] ?? NAME_TO_ALPHA2[f.properties?.name ?? ""] ?? null;
      const stat = code ? stats.byCode.get(code) : undefined;
      return {
        key: String(f.id ?? f.properties?.name ?? Math.random()),
        d: path(f) || "",
        code,
        name: (code && ALPHA2_NAME[code]) || f.properties?.name || "Unknown",
        unique: stat?.unique ?? 0,
        visits: stat?.visits ?? 0,
        sample: stat?.sample ?? [],
      };
    });
  }, [features, projection, stats]);

  // Project each visitor once, after fanning it out from its city centroid.
  // Natural Earth clips nothing, but guard the null return anyway — a bad coord
  // would otherwise throw inside the render.
  const bubbles = useMemo(() => {
    if (!projection) return [];
    const out: Array<VisitorDot & { cx: number; cy: number; r: number }> = [];
    for (const d of stats.dots) {
      const [lat, lon] = spreadOffset(d.lat, d.lon, d.slot, d.slotCount, d.spreadDeg);
      const xy = projection([lon, lat]);
      if (!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) continue;
      out.push({ ...d, cx: xy[0], cy: xy[1], r: DOT_R });
    }
    return out;
  }, [projection, stats]);

  // Dot radius has to divide by k to stay a constant size on screen, so the dot
  // layer is the one thing that genuinely depends on zoom. Quantising to 0.05
  // steps means a smooth wheel zoom rebuilds it a handful of times instead of
  // once per event, and the ≤2.5% size error is invisible.
  const sizeK = Math.round(view.k * 20) / 20;

  // ── Layers ────────────────────────────────────────────────────────────────
  //
  // Both layers are memoized on geometry + zoom only, deliberately NOT on
  // `hover`. Hover used to restyle the matching element in place, which meant
  // every mousemove re-ran `paths.map` over ~177 features (plus a fresh style
  // object each) and re-reconciled the whole tree. Now hover just draws one
  // extra outline on top, and pointer movement costs a single element.
  const countryLayer = useMemo(() => paths.map((p) => (
    <path
      key={p.key}
      d={p.d}
      fill={p.unique > 0 ? rampColor(intensity(p.unique, stats.maxUnique)) : EMPTY_FILL}
      stroke={STROKE}
      // non-scaling-stroke keeps borders hairline-thin at every zoom level
      // WITHOUT the width depending on k — which is what lets this layer drop
      // `view.k` from its deps and stop rebuilding all ~177 paths per wheel tick.
      strokeWidth={0.5}
      vectorEffect="non-scaling-stroke"
      style={{ transition: "fill 120ms linear", cursor: p.unique > 0 ? "pointer" : "default" }}
      onMouseMove={(e) => {
        if (drag.current?.moved) return; // suppress hover mid-pan
        const box = svgRect();
        if (!box) return;
        setHover({
          kind: "country", code: p.code, name: p.name,
          unique: p.unique, visits: p.visits,
          x: e.clientX - box.left, y: e.clientY - box.top,
        });
        pending.current = p.unique > 0
          ? { kind: "country", name: p.name, unique: p.unique, visits: p.visits, sample: p.sample }
          : null;
      }}
    />
  )), [paths, stats.maxUnique, svgRect]);

  const bubbleLayer = useMemo(() => bubbles.map((b) => (
    <circle
      key={b.key}
      cx={b.cx}
      cy={b.cy}
      r={b.r / sizeK}
      // Solid gold ONLY for a paying subscriber. A free account is the same
      // hollow disc as an anonymous visitor, ringed gold instead of slate.
      fill={b.approx ? "none" : b.isSubscriber ? MEMBER_FILL : b.signedIn ? FREE_FILL : BUBBLE_FILL}
      stroke={
        b.isSubscriber
          ? (b.approx ? MEMBER_FILL : MEMBER_STROKE)
          : b.signedIn ? FREE_STROKE : BUBBLE_STROKE
      }
      strokeWidth={b.isSubscriber ? 1.8 : 1.5}
      strokeDasharray={b.approx ? APPROX_DASH : undefined}
      opacity={b.approx ? APPROX_OPACITY : undefined}
      vectorEffect="non-scaling-stroke"
      style={{ cursor: "pointer" }}
      onMouseMove={(e) => {
        if (drag.current?.moved) return;
        const box = svgRect();
        if (!box) return;
        setHover({
          kind: "visitor", code: b.key, name: b.visitorLabel, sub: b.placeLabel,
          signedIn: b.signedIn, isSubscriber: b.isSubscriber, unique: 1, visits: b.visits,
          x: e.clientX - box.left, y: e.clientY - box.top,
        });
        pending.current = {
          kind: "visitor", name: b.visitorLabel, sub: b.placeLabel,
          unique: 1, visits: b.visits, sample: b.sample, account: b,
        };
      }}
    />
  )), [bubbles, sizeK, svgRect]);

  const hoveredCountry = hover?.kind === "country" && hover.code
    ? paths.find((p) => p.code === hover.code) ?? null
    : null;
  const hoveredBubble = hover?.kind === "visitor"
    ? bubbles.find((b) => b.key === hover.code) ?? null
    : null;

  // Re-clamp after a resize so a view that was legal at the old size can't leave
  // a strip of empty card showing at the new one.
  useEffect(() => {
    if (!width) return;
    setView((v) => (v.k === 1 ? v : clampView(v, width, height)));
  }, [width, height]);

  // Wheel zoom. Registered manually because React's synthetic wheel handler is
  // passive — preventDefault there is ignored and the page scrolls instead.
  //
  // `features` and `loadError` are in the deps for a reason: the <svg> is only
  // mounted once the world geometry has loaded, so on first paint svgRef.current
  // is null and this effect bailed out. Width/height rarely change after that,
  // so without a re-run when the map finally mounts the listener was never
  // attached and the wheel just scrolled the page.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !width) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = svg.getBoundingClientRect();
      const px = e.clientX - box.left;
      const py = e.clientY - box.top;
      // Trackpads emit many small deltas and mice one big one; normalising by
      // the magnitude keeps both feeling like the same zoom speed. DOM_DELTA_LINE
      // (=1) and _PAGE (=2) report in lines/pages, not pixels.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
      const px_delta = e.deltaY * unit;
      const factor = Math.exp(-px_delta * 0.0022);
      setView((v) => zoomAbout(v, v.k * factor, px, py, width, height));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [width, height, features, loadError]);

  const zoomBy = (factor: number) =>
    setView((v) => (width ? zoomAbout(v, v.k * factor, width / 2, height / 2, width, height) : v));

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPanning(true);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !width) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return; // ignore click jitter
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    setHover(null); // a tooltip chasing the cursor mid-drag is just noise
    setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, width, height));
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current?.id === e.pointerId) {
      const wasPan = drag.current.moved;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      drag.current = null;
      setPanning(false);
      // Selection is resolved here rather than from an onClick on the country
      // path / city circle: onPointerDown captures the pointer on the <svg>, and
      // pointer capture retargets the follow-up click event to the capture
      // element — so a handler on the child would never fire. `pending` is set
      // by the same mousemove that drives the tooltip, so it's already the thing
      // under the cursor. A drag that happens to end on a country isn't a click.
      if (!wasPan) setSelected(pending.current);
    }
  };

  const zoomed = view.k > 1.001;

  // A visitor hover always has a value; a country hover only counts when the
  // feature maps to a code we track.
  const active = hover && (hover.kind === "visitor" || hover.code) ? hover : null;
  const headline = active ? active.unique : stats.totalUnique;
  const headlineLabel = active ? active.name : "Worldwide";
  const subline = active
    ? (active.kind === "visitor" ? `${active.sub} · ` : "") +
      `${active.visits.toLocaleString()} load${active.visits === 1 ? "" : "s"}`
    : `${stats.ranked.length} countr${stats.ranked.length === 1 ? "y" : "ies"}` +
      (stats.cityDots
        ? ` · ${stats.cityDots.toLocaleString()} at ${stats.placeCount.toLocaleString()} location${stats.placeCount === 1 ? "" : "s"}`
        : "") +
      (stats.approxDots
        ? ` · ${stats.approxDots.toLocaleString()} country-level`
        : "");

  const cardStyle: CSSProperties = {
    background: HOME_THEME.panelBgStrong,
    border: `1px solid ${HOME_THEME.border}`,
    borderRadius: 18,
    padding: 0,
    position: "relative",
    overflow: "hidden",
    minWidth: 0,
  };

  return (
    <div style={cardStyle}>
      {/* Header floats over the map, matching the other Control Panel cards but
          reclaiming the vertical space the map wants. */}
      <div
        style={{
          position: "absolute",
          insetInline: 0,
          top: 0,
          zIndex: 2,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          padding: "13px 15px 34px",
          pointerEvents: "none",
          background: `linear-gradient(to bottom, ${HOME_THEME.panelBgStrong} 42%, transparent)`,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: HOME_THEME.cyan, marginBottom: 6 }}>
            Visitors · by country, one dot per person
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
            <span
              style={{
                fontSize: 26,
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                color: HOME_THEME.lightBlue,
                lineHeight: 1,
              }}
            >
              {headline.toLocaleString()}
            </span>
            <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.65 }}>
              {headlineLabel} · {subline}
            </span>
          </div>
        </div>
        <div
          style={{
            fontSize: 14,
            fontFamily: "var(--font-mono)",
            color: HOME_THEME.text,
            opacity: 0.65,
            whiteSpace: "nowrap",
          }}
        >
          last {stats.totalVisits.toLocaleString()} loads
        </div>
      </div>

      <div ref={wrapRef} style={{ position: "relative", width: "100%", minHeight: MIN_HEIGHT }}>
        {loadError ? (
          <div style={centeredMessage}>Couldn’t load the world map ({loadError}).</div>
        ) : !features ? (
          <div style={centeredMessage}>Loading map…</div>
        ) : (
          <svg
            ref={svgRef}
            width={width || "100%"}
            height={height}
            viewBox={`0 0 ${width || 900} ${height}`}
            style={{
              display: "block",
              width: "100%",
              height,
              cursor: panning ? "grabbing" : zoomed ? "grab" : "default",
              touchAction: "none", // let pointer events own pan/zoom on touch
            }}
            onMouseLeave={() => { setHover(null); pending.current = null; }}
            onMouseMoveCapture={() => { pending.current = null; }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => zoomBy(STEP)}
          >
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {countryLayer}
            {hoveredCountry && (
              // Highlight drawn as one extra path on top rather than by
              // restyling the hovered country in place — that keeps the base
              // layer independent of `hover`, so a mousemove no longer
              // rebuilds and reconciles all ~177 country paths.
              <path
                d={hoveredCountry.d}
                fill="none"
                stroke={HOME_THEME.lightBlue}
                strokeWidth={1.4}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}

            {/* Visitor layer — one dot per visitor, fanned out around the city
                centroid they share. Radius and stroke divide by k so a dot keeps
                a constant on-screen size while zooming pulls the fan apart, which
                is what makes individual people in one metro reachable. */}
            {showBubbles && bubbleLayer}
            {showBubbles && hoveredBubble && (
              <circle
                cx={hoveredBubble.cx}
                cy={hoveredBubble.cy}
                r={hoveredBubble.r / sizeK + 2.5}
                fill="none"
                stroke={HOME_THEME.text}
                strokeWidth={1.6}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
            </g>
          </svg>
        )}

        {/* Zoom controls. Sit above the map, out of the header gradient's way. */}
        {features && !loadError && (
          <div
            style={{
              position: "absolute",
              right: 12,
              bottom: 12,
              zIndex: 3,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              alignItems: "center",
            }}
          >
            <ZoomButton label="Zoom in" onClick={() => zoomBy(STEP)} disabled={view.k >= MAX_K - 0.001}>
              +
            </ZoomButton>
            <ZoomButton label="Zoom out" onClick={() => zoomBy(1 / STEP)} disabled={!zoomed}>
              −
            </ZoomButton>
            {zoomed && (
              <>
                <ZoomButton label="Reset view" onClick={() => setView(IDENTITY)}>
                  ⟲
                </ZoomButton>
                <span
                  style={{
                    fontSize: 14,
                    fontFamily: "var(--font-mono)",
                    color: HOME_THEME.text,
                    opacity: 0.55,
                  }}
                >
                  {view.k.toFixed(1)}×
                </span>
              </>
            )}
          </div>
        )}

        {hover && (
          <div
            style={{
              position: "absolute",
              left: Math.min(Math.max(hover.x + 12, 8), Math.max((width || 0) - 190, 8)),
              top: Math.max(hover.y - 10, 8),
              pointerEvents: "none",
              zIndex: 3,
              background: HOME_THEME.panelBgStrong,
              border: `1px solid ${HOME_THEME.borderStrong}`,
              borderRadius: 10,
              padding: "8px 10px",
              minWidth: 150,
              boxShadow: `0 6px 22px ${ownerRgba("#000000", 0.55)}`,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: HOME_THEME.text, marginBottom: 4 }}>
              {hover.name}
            </div>
            <div
              style={{
                fontSize: 14,
                fontFamily: "var(--font-mono)",
                color: hover.unique > 0 ? HOME_THEME.lightBlue : HOME_THEME.text,
                opacity: hover.unique > 0 ? 1 : 0.55,
              }}
            >
              {hover.kind === "visitor"
                ? `1 visitor · ${hover.visits.toLocaleString()} load${hover.visits === 1 ? "" : "s"}`
                : hover.unique > 0
                  ? `${hover.unique.toLocaleString()} visitor${hover.unique === 1 ? "" : "s"} · ${hover.visits.toLocaleString()} loads`
                  : "No visits"}
            </div>
            {hover.kind === "visitor" && (
              <>
                <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.45, marginTop: 3 }}>
                  {hover.sub || "located by IP"}
                </div>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: hover.signedIn ? HOME_THEME.gold : VISITOR_INK, opacity: 0.9, marginTop: 2 }}>
                  {hover.isSubscriber ? "subscriber" : hover.signedIn ? "free account" : "not signed in"}
                </div>
              </>
            )}
          </div>
        )}

        {/* Pinned detail card — click a country or a visitor dot. Unlike the
            tooltip above this is interactive (scrollable, dismissible), so it
            gets pointer events and sits anchored to the corner rather than
            chasing the cursor. */}
        {selected && <PlaceCard place={selected} onClose={() => setSelected(null)} />}
      </div>

      {/* Legend + honest footnote about rows with no geo. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          padding: "9px 15px 13px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.6 }}>0</span>
          <span
            style={{
              width: 128,
              height: 8,
              borderRadius: 999,
              background: `linear-gradient(to right, ${EMPTY_FILL}, ${rampColor(0)}, ${rampColor(0.5)}, ${rampColor(1)})`,
              border: `1px solid ${HOME_THEME.border}`,
            }}
          />
          <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.6, fontFamily: "var(--font-mono)" }}>
            {stats.maxUnique.toLocaleString()}
          </span>

          {/* Dot toggle doubles as the dot legend. Disabled (with a reason)
              when no row has coordinates yet, so an empty layer isn't a mystery. */}
          <button
            type="button"
            onClick={() => setShowBubbles((v) => !v)}
            disabled={stats.dots.length === 0}
            title={
              stats.dots.length === 0
                ? "No geolocated rows yet — enable Cloudflare's visitor location headers"
                : `${stats.dots.length} visitors · ${stats.subscriberDots} paying (solid gold), ${stats.signedInDots - stats.subscriberDots} free accounts (gold ring), ${stats.dots.length - stats.signedInDots} anonymous (slate ring) · ${stats.cityDots} on a city coordinate across ${stats.placeCount} locations, ${stats.approxDots} dashed on a country centroid · zoom in to separate visitors sharing a place`
            }
            style={{
              marginLeft: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 9px",
              borderRadius: 999,
              border: `1px solid ${showBubbles && stats.dots.length ? BUBBLE_STROKE : HOME_THEME.border}`,
              background: showBubbles && stats.dots.length ? "rgba(255,183,3,0.10)" : "transparent",
              color: HOME_THEME.text,
              fontSize: 14,
              cursor: stats.dots.length === 0 ? "default" : "pointer",
              opacity: stats.dots.length === 0 ? 0.4 : 0.85,
            }}
          >
            <span
              title="Paying subscriber (active or trialing)"
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: MEMBER_FILL,
                border: `1.5px solid ${MEMBER_STROKE}`,
              }}
            />
            <span
              title="Signed-in account, not paying"
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: FREE_FILL,
                border: `1.5px solid ${FREE_STROKE}`,
              }}
            />
            <span
              title="Anonymous visitor"
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: BUBBLE_FILL,
                border: `1.5px solid ${BUBBLE_STROKE}`,
              }}
            />
            Visitors
          </button>

          {/* Solid vs hollow is the whole legend for identity, so spell the split
              out in numbers too — a glance at the map can't count them, and
              "paying" is the number worth being able to read without counting. */}
          {stats.dots.length > 0 && (
            <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.6 }}>
              <span style={{ fontFamily: "var(--font-mono)", color: HOME_THEME.gold }}>
                {stats.subscriberDots.toLocaleString()}
              </span>{" "}
              paying ·{" "}
              <span style={{ fontFamily: "var(--font-mono)", color: HOME_THEME.gold, opacity: 0.7 }}>
                {(stats.signedInDots - stats.subscriberDots).toLocaleString()}
              </span>{" "}
              free ·{" "}
              <span style={{ fontFamily: "var(--font-mono)", color: VISITOR_INK }}>
                {(stats.dots.length - stats.signedInDots).toLocaleString()}
              </span>{" "}
              anonymous
            </span>
          )}

          {/* Precision, spelled out. A dashed dot is a real visitor whose
              position we are guessing from their country — say how many. */}
          {stats.approxDots > 0 && (
            <span
              style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.45 }}
              title={`These rows carry a country but no coordinate, so each visitor is fanned out around their country's centre instead of a city. Rows logged before 2026-08-13 have no coordinates at all — that column was never being written.`}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  border: `1.5px dashed ${BUBBLE_STROKE}`,
                  opacity: APPROX_OPACITY,
                  marginRight: 5,
                  verticalAlign: -1,
                }}
              />
              <span style={{ fontFamily: "var(--font-mono)" }}>
                {stats.approxDots.toLocaleString()}
              </span>{" "}
              country-level
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {stats.ranked.slice(0, 5).map((c) => (
            <span key={c.code} style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.75 }}>
              {c.name}{" "}
              <span style={{ fontFamily: "var(--font-mono)", color: HOME_THEME.lightBlue }}>
                {c.unique.toLocaleString()}
              </span>
            </span>
          ))}
          {stats.unknownVisits > 0 && (
            <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.45 }}>
              {stats.unknownVisits.toLocaleString()} unmapped
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ZoomButton({
  children, label, onClick, disabled,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      // Stop the press from also starting a pan on the svg underneath.
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        width: 28,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        border: `1px solid ${HOME_THEME.border}`,
        background: HOME_THEME.panelBgStrong,
        color: HOME_THEME.text,
        fontSize: 15,
        lineHeight: 1,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.35 : 0.9,
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}

const centeredMessage: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: MIN_HEIGHT,
  fontSize: 14,
  color: HOME_THEME.text,
  opacity: 0.6,
};

export default VisitorMap;
