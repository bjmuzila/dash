import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
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
  ip?: string | null;
}

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
}

interface Aggregate {
  byCode: Map<string, CountryStat>;
  ranked: CountryStat[];
  totalVisits: number;
  totalUnique: number;
  unknownVisits: number;
  maxUnique: number;
}

function aggregate(rows: VisitorMapRow[]): Aggregate {
  // Unique visitors are approximated by distinct client IP — the only stable
  // per-visitor key we log (guests have no user id). Same IP on two continents
  // is not a case worth modelling here.
  const acc = new Map<string, { visits: number; ips: Set<string> }>();
  const globalIps = new Set<string>();
  let unknownVisits = 0;
  let totalVisits = 0;

  for (const r of rows) {
    const code = (r.country || "").toUpperCase();
    totalVisits++;
    if (r.ip) globalIps.add(r.ip);
    if (!code || NON_COUNTRY.has(code)) {
      unknownVisits++;
      continue;
    }
    let bucket = acc.get(code);
    if (!bucket) {
      bucket = { visits: 0, ips: new Set<string>() };
      acc.set(code, bucket);
    }
    bucket.visits++;
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
    });
  }
  const ranked = [...byCode.values()].sort((a, b) => b.unique - a.unique);

  return {
    byCode,
    ranked,
    totalVisits,
    totalUnique: globalIps.size,
    unknownVisits,
    maxUnique: ranked.length ? ranked[0].unique : 0,
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

interface HoverState {
  code: string | null;
  name: string;
  unique: number;
  visits: number;
  x: number;
  y: number;
}

export function VisitorMap({ rows }: { rows: VisitorMapRow[] }) {
  const [features, setFeatures] = useState<Array<Feature<Geometry, { name?: string }>> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();

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
  const paths = useMemo(() => {
    if (!features || !width) return [];
    const projection = geoNaturalEarth1().fitSize([width, height], {
      type: "FeatureCollection",
      features,
    } as FeatureCollection);
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
      };
    });
  }, [features, width, height, stats]);

  const headline = hover && hover.code ? hover.unique : stats.totalUnique;
  const headlineLabel = hover && hover.code ? hover.name : "Worldwide";
  const subline = hover && hover.code
    ? `${hover.visits.toLocaleString()} load${hover.visits === 1 ? "" : "s"}`
    : `${stats.ranked.length} countr${stats.ranked.length === 1 ? "y" : "ies"}`;

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
            width={width || "100%"}
            height={height}
            viewBox={`0 0 ${width || 900} ${height}`}
            style={{ display: "block", width: "100%", height }}
            onMouseLeave={() => setHover(null)}
          >
            {paths.map((p) => {
              const t = intensity(p.unique, stats.maxUnique);
              const isHovered = hover?.code != null && hover.code === p.code;
              return (
                <path
                  key={p.key}
                  d={p.d}
                  fill={p.unique > 0 ? rampColor(t) : EMPTY_FILL}
                  stroke={isHovered ? HOME_THEME.lightBlue : STROKE}
                  strokeWidth={isHovered ? 1.1 : 0.4}
                  style={{ cursor: p.unique > 0 ? "default" : "default", transition: "fill 120ms linear" }}
                  onMouseMove={(e) => {
                    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                    setHover({
                      code: p.code,
                      name: p.name,
                      unique: p.unique,
                      visits: p.visits,
                      x: e.clientX - box.left,
                      y: e.clientY - box.top,
                    });
                  }}
                />
              );
            })}
          </svg>
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
          </div>
        )}
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
