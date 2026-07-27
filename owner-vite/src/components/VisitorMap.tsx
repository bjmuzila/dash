import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
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
  /** Per-visit detail for the click-to-pin card. `userId` is the exception: it
   *  is also the strongest visitor identity, so it decides which dot a row
   *  belongs to (see `visitorKey`). */
  path?: string | null;
  pageLabel?: string | null;
  userId?: string | null;
  createdAt?: string | null;
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
  /** "Denver, Colorado, United States" */
  placeLabel: string;
  /** How this visitor is identified — IP, else user id, else "anonymous". */
  visitorLabel: string;
  country: string | null;
  ip: string | null;
  userId: string | null;
  /** Page loads by this one visitor. */
  visits: number;
  sample: VisitorMapRow[];
}

interface Aggregate {
  byCode: Map<string, CountryStat>;
  ranked: CountryStat[];
  dots: VisitorDot[];
  placeCount: number;
  visitsWithCoords: number;
  totalVisits: number;
  totalUnique: number;
  unknownVisits: number;
  maxUnique: number;
  maxDotVisits: number;
}

/** One identity per visitor, best effort: a signed-in user id wins because it
 *  survives a changing IP, then the IP, then a per-row synthetic key so an
 *  unidentifiable row counts as its own visitor rather than merging with every
 *  other one. Used for the country counts AND the dots, so the choropleth and
 *  the dot layer can never report a different number of people. */
function visitorKey(r: VisitorMapRow, fallback: number): string {
  if (r.userId) return `u:${r.userId}`;
  if (r.ip) return `ip:${r.ip}`;
  return `anon:${fallback}`;
}

function aggregate(rows: VisitorMapRow[]): Aggregate {
  const acc = new Map<string, { visits: number; ips: Set<string>; sample: VisitorMapRow[] }>();
  const globalVisitors = new Set<string>();
  // One entry per (coordinate cluster × visitor) — the dot layer's unit of work.
  const dotAcc = new Map<string, {
    lat: number; lon: number; placeKey: string; placeLabel: string;
    visitorLabel: string; country: string | null; ip: string | null; userId: string | null;
    visits: number; sample: VisitorMapRow[];
  }>();
  // Fan-out needs to know how crowded each coordinate is, so count dots per place.
  const placeSizes = new Map<string, number>();
  let unknownVisits = 0;
  let totalVisits = 0;
  let visitsWithCoords = 0;
  let anonSeq = 0;

  for (const r of rows) {
    const code = (r.country || "").toUpperCase();
    totalVisits++;
    const vid = visitorKey(r, ++anonSeq);
    globalVisitors.add(vid);

    // Dot layer is independent of the choropleth: a row can have coords even
    // if its country code is a sentinel, and vice versa.
    if (typeof r.lat === "number" && typeof r.lon === "number" && Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
      visitsWithCoords++;
      // 2dp ≈ 1 km — tight enough to keep distinct cities apart, loose enough
      // that one city's rows share one centroid to fan out from.
      const pk = `${r.lat.toFixed(2)},${r.lon.toFixed(2)}`;
      // Keyed per (location × visitor): the same person seen in two cities is
      // two dots, because each dot answers "who was here", not "who exists".
      const dk = `${pk}|${vid}`;
      let dot = dotAcc.get(dk);
      if (!dot) {
        const label = [r.city, r.region, code && !NON_COUNTRY.has(code) ? (ALPHA2_NAME[code] || code) : null]
          .filter(Boolean)
          .join(", ");
        dot = {
          lat: r.lat,
          lon: r.lon,
          placeKey: pk,
          placeLabel: label || `${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}`,
          visitorLabel: r.ip || (r.userId ? `${r.userId.slice(0, 12)}…` : "anonymous"),
          country: code && !NON_COUNTRY.has(code) ? code : null,
          ip: r.ip ?? null,
          userId: r.userId ?? null,
          visits: 0,
          sample: [],
        };
        dotAcc.set(dk, dot);
        placeSizes.set(pk, (placeSizes.get(pk) ?? 0) + 1);
      }
      dot.visits++;
      if (!dot.userId && r.userId) dot.userId = r.userId;
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
      return {
        key,
        lat: d.lat,
        lon: d.lon,
        placeKey: d.placeKey,
        slot,
        slotCount: placeSizes.get(d.placeKey) ?? 1,
        placeLabel: d.placeLabel,
        visitorLabel: d.visitorLabel,
        country: d.country,
        ip: d.ip,
        userId: d.userId,
        visits: d.visits,
        sample: d.sample,
      };
    })
    .sort((a, b) => a.visits - b.visits);

  return {
    byCode,
    ranked,
    dots,
    placeCount: placeSizes.size,
    visitsWithCoords,
    totalVisits,
    totalUnique: globalVisitors.size,
    unknownVisits,
    maxUnique: ranked.length ? ranked[0].unique : 0,
    maxDotVisits: dots.length ? dots[dots.length - 1].visits : 0,
  };
}

// ── Color ramp ───────────────────────────────────────────────────────────────

// Three-stop sequential ramp drawn from the owner palette (deep teal → cyan →
// light blue). Traffic is heavily skewed toward one or two countries, so the
// domain is square-rooted; a linear ramp would render everything but the top
// country as the same near-empty shade.
const RAMP: Array<[number, number, number]> = [
  [16, 63, 81],   // #103F51
  [33, 158, 188], // #219EBC  (HOME_THEME.cyan)
  [155, 216, 236] // #9BD8EC
];

const EMPTY_FILL = "rgba(255,255,255,0.045)";
const STROKE = "rgba(255,255,255,0.16)";

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

// One dot per visitor, so the size range is deliberately narrow — a dot is a
// person, and the only thing it varies by is how many pages that person loaded.
const BUBBLE_MIN_R = 2.4;
const BUBBLE_MAX_R = 6;
const BUBBLE_FILL = "rgba(255,183,3,0.42)";   // OWNER_THEME.gold, translucent
const BUBBLE_STROKE = "rgba(255,183,3,0.95)";

/**
 * Radius by sqrt of count so AREA tracks the value — the standard for
 * proportional symbols. Scaling radius linearly would make a 10× visitor look
 * 100× bigger.
 */
function bubbleRadius(value: number, max: number): number {
  if (value <= 1 || max <= 1) return BUBBLE_MIN_R;
  return BUBBLE_MIN_R + (BUBBLE_MAX_R - BUBBLE_MIN_R) * Math.sqrt((value - 1) / (max - 1));
}

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
function spreadOffset(lat: number, lon: number, slot: number, count: number): [number, number] {
  if (count <= 1) return [lat, lon];
  const spread = Math.min(SPREAD_MAX_DEG, 0.12 * Math.sqrt(count));
  const radius = spread * Math.sqrt((slot + 0.5) / count);
  const angle = (slot + 1) * GOLDEN_ANGLE;
  const dLat = radius * Math.sin(angle);
  const dLon = (radius * Math.cos(angle)) / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lon + dLon];
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
}

interface HoverState {
  /** "visitor" hovers come from a dot, "country" from the choropleth beneath. */
  kind: "country" | "visitor";
  code: string | null;
  name: string;
  sub?: string | null;
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

/** Detail card for a clicked country or visitor. Everything here is derived from
 *  the sampled raw rows the aggregator kept — no extra fetch. */
function PlaceCard({ place, onClose }: { place: SelectedPlace; onClose: () => void }) {
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
      <span style={{ color: HOME_THEME.text, fontFamily: "var(--font-mono)", flexShrink: 0 }}>{value}</span>
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
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: HOME_THEME.lightBlue, marginTop: 2 }}>
            {place.kind === "visitor" ? "Visitor · located by IP" : "Country"}
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
        {place.kind === "country"
          ? <Row label="Unique visitors" value={place.unique.toLocaleString()} />
          : <Row label="Identified by" value={ips[0] || place.name} />}
        <Row label="Page loads" value={place.visits.toLocaleString()} />
        {place.kind === "country" && ips.length > 0 && <Row label="Distinct IPs seen" value={ips.length.toLocaleString()} />}

        {topPages.length > 0 && (
          <>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: HOME_THEME.text, opacity: 0.45, margin: "10px 0 4px" }}>
              Top pages
            </div>
            {topPages.map(([label, n]) => (
              <Row key={label} label={label} value={n.toLocaleString()} />
            ))}
          </>
        )}

        {recent.length > 0 && (
          <>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: HOME_THEME.text, opacity: 0.45, margin: "10px 0 4px" }}>
              Recent visits
            </div>
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

  const stats = useMemo(() => aggregate(rows), [rows]);

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
      const [lat, lon] = spreadOffset(d.lat, d.lon, d.slot, d.slotCount);
      const xy = projection([lon, lat]);
      if (!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) continue;
      out.push({ ...d, cx: xy[0], cy: xy[1], r: bubbleRadius(d.visits, stats.maxDotVisits) });
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
      fill={BUBBLE_FILL}
      stroke={BUBBLE_STROKE}
      strokeWidth={0.9}
      vectorEffect="non-scaling-stroke"
      style={{ cursor: "pointer" }}
      onMouseMove={(e) => {
        if (drag.current?.moved) return;
        const box = svgRect();
        if (!box) return;
        setHover({
          kind: "visitor", code: b.key, name: b.visitorLabel, sub: b.placeLabel,
          unique: 1, visits: b.visits,
          x: e.clientX - box.left, y: e.clientY - box.top,
        });
        pending.current = { kind: "visitor", name: b.visitorLabel, sub: b.placeLabel, unique: 1, visits: b.visits, sample: b.sample };
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
      (stats.dots.length
        ? ` · ${stats.dots.length.toLocaleString()} plotted from ${stats.placeCount.toLocaleString()} location${stats.placeCount === 1 ? "" : "s"}`
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
                r={hoveredBubble.r / sizeK}
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
              <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.45, marginTop: 3 }}>
                {hover.sub || "one visitor"}
              </div>
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
                ? "No coordinates logged yet — enable Cloudflare's visitor location headers"
                : `${stats.dots.length} visitors across ${stats.placeCount} locations · one dot per visitor, size ∝ their page loads · zoom in to separate visitors sharing a city`
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
              style={{
                width: 9,
                height: 9,
                borderRadius: 999,
                background: BUBBLE_FILL,
                border: `1px solid ${BUBBLE_STROKE}`,
              }}
            />
            Visitors
          </button>
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
