import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { OWNER_THEME as HOME_THEME, ownerRgba } from "../lib/theme";
import { ALPHA2_NAME, FEATURE_ID_TO_ALPHA2 } from "../lib/countryMaps";

/**
 * Visitor choropleth for the Control Panel.
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
  /** Optional per-visit detail. Only used to populate the click-to-pin card —
   *  the choropleth and bubbles never read these. */
  path?: string | null;
  pageLabel?: string | null;
  userId?: string | null;
  createdAt?: string | null;
}

/** How many raw rows each country/city keeps for its detail card. Enough to
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
 * One plotted bubble. Cloudflare returns a CITY CENTROID, not a device position,
 * so every visitor in a metro shares one coordinate — which is what makes them
 * safe to cluster and count. Keyed on rounded coords so tiny float differences
 * between rows don't split one city into a cluster of near-identical dots.
 */
interface PlaceStat {
  key: string;
  lat: number;
  lon: number;
  label: string;
  country: string | null;
  visits: number;
  unique: number;
  sample: VisitorMapRow[];
}

interface Aggregate {
  byCode: Map<string, CountryStat>;
  ranked: CountryStat[];
  places: PlaceStat[];
  placesWithCoords: number;
  totalVisits: number;
  totalUnique: number;
  unknownVisits: number;
  maxUnique: number;
  maxPlaceUnique: number;
}

function aggregate(rows: VisitorMapRow[]): Aggregate {
  // Unique visitors are approximated by distinct client IP — the only stable
  // per-visitor key we log (guests have no user id). Same IP on two continents
  // is not a case worth modelling here.
  const acc = new Map<string, { visits: number; ips: Set<string>; sample: VisitorMapRow[] }>();
  const globalIps = new Set<string>();
  const placeAcc = new Map<string, { lat: number; lon: number; label: string; country: string | null; visits: number; ips: Set<string>; sample: VisitorMapRow[] }>();
  let unknownVisits = 0;
  let totalVisits = 0;

  for (const r of rows) {
    const code = (r.country || "").toUpperCase();
    totalVisits++;
    if (r.ip) globalIps.add(r.ip);

    // Bubble layer is independent of the choropleth: a row can have coords even
    // if its country code is a sentinel, and vice versa.
    if (typeof r.lat === "number" && typeof r.lon === "number" && Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
      // 2dp ≈ 1 km — tight enough to keep distinct cities apart, loose enough
      // that one city's rows collapse to a single bubble.
      const pk = `${r.lat.toFixed(2)},${r.lon.toFixed(2)}`;
      let place = placeAcc.get(pk);
      if (!place) {
        const label = [r.city, r.region, code && !NON_COUNTRY.has(code) ? (ALPHA2_NAME[code] || code) : null]
          .filter(Boolean)
          .join(", ");
        place = {
          lat: r.lat,
          lon: r.lon,
          label: label || `${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}`,
          country: code && !NON_COUNTRY.has(code) ? code : null,
          visits: 0,
          ips: new Set<string>(),
          sample: [],
        };
        placeAcc.set(pk, place);
      }
      place.visits++;
      place.ips.add(r.ip || `anon:${pk}:${place.visits}`);
      if (place.sample.length < SAMPLE_CAP) place.sample.push(r);
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
    // Fall back to a synthetic key so an IP-less row still counts as one visitor
    // instead of collapsing every such row into a single phantom visitor.
    bucket.ips.add(r.ip || `anon:${bucket.visits}`);
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

  // Biggest bubbles drawn first so small ones land on top and stay clickable.
  const places: PlaceStat[] = [...placeAcc.entries()]
    .map(([key, p]) => ({
      key,
      lat: p.lat,
      lon: p.lon,
      label: p.label,
      country: p.country,
      visits: p.visits,
      unique: p.ips.size,
      sample: p.sample,
    }))
    .sort((a, b) => b.unique - a.unique);

  return {
    byCode,
    ranked,
    places,
    placesWithCoords: places.reduce((n, p) => n + p.visits, 0),
    totalVisits,
    totalUnique: globalIps.size,
    unknownVisits,
    maxUnique: ranked.length ? ranked[0].unique : 0,
    maxPlaceUnique: places.length ? places[0].unique : 0,
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

// ── Bubbles ──────────────────────────────────────────────────────────────────

const BUBBLE_MIN_R = 2.5;
const BUBBLE_MAX_R = 15;
const BUBBLE_FILL = "rgba(255,183,3,0.42)";   // OWNER_THEME.gold, translucent
const BUBBLE_STROKE = "rgba(255,183,3,0.95)";

/**
 * Radius by sqrt of count so AREA tracks the value — the standard for
 * proportional symbols. Scaling radius linearly would make a 10× city look
 * 100× bigger.
 */
function bubbleRadius(value: number, max: number): number {
  if (value <= 0 || max <= 0) return BUBBLE_MIN_R;
  return BUBBLE_MIN_R + (BUBBLE_MAX_R - BUBBLE_MIN_R) * Math.sqrt(value / max);
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

/** A pinned country or city, with the raw rows behind it. */
interface SelectedPlace {
  kind: "country" | "place";
  name: string;
  unique: number;
  visits: number;
  sample: VisitorMapRow[];
}

interface HoverState {
  /** "place" hovers come from a bubble, "country" from the choropleth beneath. */
  kind: "country" | "place";
  code: string | null;
  name: string;
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

/** Detail card for a clicked country or city. Everything here is derived from
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
            {place.kind === "place" ? "City · from IP" : "Country"}
          </div>
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
        <Row label="Unique visitors" value={place.unique.toLocaleString()} />
        <Row label="Page loads" value={place.visits.toLocaleString()} />
        {ips.length > 0 && <Row label="Distinct IPs seen" value={ips.length.toLocaleString()} />}

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

  // Project each city centroid once. Natural Earth clips nothing, but guard the
  // null return anyway — a bad coord would otherwise throw inside the render.
  const bubbles = useMemo(() => {
    if (!projection) return [];
    const out: Array<PlaceStat & { cx: number; cy: number; r: number }> = [];
    for (const p of stats.places) {
      const xy = projection([p.lon, p.lat]);
      if (!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) continue;
      out.push({ ...p, cx: xy[0], cy: xy[1], r: bubbleRadius(p.unique, stats.maxPlaceUnique) });
    }
    return out;
  }, [projection, stats]);

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
      // Divide by k so borders stay hairline-thin as you zoom in instead of
      // swelling into slabs.
      strokeWidth={0.4 / view.k}
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
  )), [paths, stats.maxUnique, view.k, svgRect]);

  const bubbleLayer = useMemo(() => bubbles.map((b) => (
    <circle
      key={b.key}
      cx={b.cx}
      cy={b.cy}
      r={b.r / view.k}
      fill={BUBBLE_FILL}
      stroke={BUBBLE_STROKE}
      strokeWidth={0.9 / view.k}
      style={{ cursor: "pointer" }}
      onMouseMove={(e) => {
        if (drag.current?.moved) return;
        const box = svgRect();
        if (!box) return;
        setHover({
          kind: "place", code: b.key, name: b.label,
          unique: b.unique, visits: b.visits,
          x: e.clientX - box.left, y: e.clientY - box.top,
        });
        pending.current = { kind: "place", name: b.label, unique: b.unique, visits: b.visits, sample: b.sample };
      }}
    />
  )), [bubbles, view.k, svgRect]);

  const hoveredCountry = hover?.kind === "country" && hover.code
    ? paths.find((p) => p.code === hover.code) ?? null
    : null;
  const hoveredBubble = hover?.kind === "place"
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
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !width) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = svg.getBoundingClientRect();
      const px = e.clientX - box.left;
      const py = e.clientY - box.top;
      setView((v) => zoomAbout(v, v.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18), px, py, width, height));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [width, height]);

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

  // A bubble hover always has a value; a country hover only counts when the
  // feature maps to a code we track.
  const active = hover && (hover.kind === "place" || hover.code) ? hover : null;
  const headline = active ? active.unique : stats.totalUnique;
  const headlineLabel = active ? active.name : "Worldwide";
  const subline = active
    ? `${active.visits.toLocaleString()} load${active.visits === 1 ? "" : "s"}`
    : `${stats.ranked.length} countr${stats.ranked.length === 1 ? "y" : "ies"}` +
      (stats.places.length ? ` · ${stats.places.length} cit${stats.places.length === 1 ? "y" : "ies"}` : "");

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
            Unique visitors · by country
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
                strokeWidth={1.1 / view.k}
                pointerEvents="none"
              />
            )}

            {/* Bubble layer — one dot per city centroid, area ∝ visitors.
                Radius and stroke divide by k so a bubble keeps a constant
                on-screen size while zooming separates overlapping cities. */}
            {showBubbles && bubbleLayer}
            {showBubbles && hoveredBubble && (
              <circle
                cx={hoveredBubble.cx}
                cy={hoveredBubble.cy}
                r={hoveredBubble.r / view.k}
                fill="none"
                stroke={HOME_THEME.text}
                strokeWidth={1.6 / view.k}
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
              {hover.unique > 0
                ? `${hover.unique.toLocaleString()} visitor${hover.unique === 1 ? "" : "s"} · ${hover.visits.toLocaleString()} loads`
                : "No visits"}
            </div>
            {hover.kind === "place" && (
              <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.45, marginTop: 3 }}>
                city-level, from IP
              </div>
            )}
          </div>
        )}

        {/* Pinned detail card — click a country or city bubble. Unlike the
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

          {/* Bubble toggle doubles as the bubble legend. Disabled (with a reason)
              when no row has coordinates yet, so an empty layer isn't a mystery. */}
          <button
            type="button"
            onClick={() => setShowBubbles((v) => !v)}
            disabled={stats.places.length === 0}
            title={
              stats.places.length === 0
                ? "No coordinates logged yet — enable Cloudflare's visitor location headers"
                : `${stats.places.length} cities · bubble area ∝ visitors · toggle off to see the country shading alone`
            }
            style={{
              marginLeft: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 9px",
              borderRadius: 999,
              border: `1px solid ${showBubbles && stats.places.length ? BUBBLE_STROKE : HOME_THEME.border}`,
              background: showBubbles && stats.places.length ? "rgba(255,183,3,0.10)" : "transparent",
              color: HOME_THEME.text,
              fontSize: 14,
              cursor: stats.places.length === 0 ? "default" : "pointer",
              opacity: stats.places.length === 0 ? 0.4 : 0.85,
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
            Cities
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
