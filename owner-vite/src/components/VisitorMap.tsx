import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { OWNER_THEME as HOME_THEME, ownerRgba } from "../lib/theme";

/**
 * Visitor dot map for the Control Panel.
 *
 * Data path: Cloudflare's "Add visitor location headers" managed transform sets
 * cf-ipcountry/cf-ipcity/cf-region/cf-iplatitude/cf-iplongitude → /api/page-status
 * stores them on the page_visits row → the owner reads them back through
 * /api/page-visits. Rows logged before that transform was switched on (or before
 * lat/lon was added) carry no coordinates and are reported honestly in the
 * footer as "unmapped" rather than silently dropped.
 *
 * Each dot is one city (visits are clustered by rounded lat/lon so the same
 * city doesn't render a dozen overlapping points). Click a dot to pin its
 * popup open — shows the city name and the pages loaded from there. Click the
 * same dot again (or anywhere else on the map) to dismiss.
 *
 * The world geometry is vendored at public/countries-110m.json (world-atlas@2,
 * 110m resolution ≈ 105 KB) and fetched at runtime, so it never enters the JS
 * bundle — used here only as a faint basemap, not for choropleth fill.
 */

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface VisitorMapRow {
  country?: string | null;
  region?: string | null;
  city?: string | null;
  lat?: number | null;
  lon?: number | null;
  ip?: string | null;
  pageLabel?: string | null;
  path?: string | null;
  /** Signed-in identity, resolved server-side from users.email/discord_username. */
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
}

interface CityPoint {
  key: string;
  lat: number;
  lon: number;
  city: string;
  region: string | null;
  country: string | null;
  visits: number;
  unique: number;
  pages: Array<{ label: string; count: number }>;
  /** Signed-in visitors seen from this city — empty for guest-only cities. */
  visitors: Array<{ label: string; count: number }>;
}

interface Aggregate {
  points: CityPoint[];
  ranked: CityPoint[];
  totalVisits: number;
  totalUnique: number;
  unmappedVisits: number;
  maxUnique: number;
}

function displayName(city: string | null | undefined, region: string | null | undefined, country: string | null | undefined): string {
  const parts = [city, region && region !== city ? region : null, country].filter(Boolean);
  return parts.length ? parts.join(", ") : "Unknown location";
}

function aggregate(rows: VisitorMapRow[]): Aggregate {
  // Group by rounded lat/lon (~1.1km grid) so the same city's visits stack into
  // one dot instead of one per slightly-different IP geolocation.
  const acc = new Map<
    string,
    {
      lat: number;
      lon: number;
      city: string;
      region: string | null;
      country: string | null;
      visits: number;
      ips: Set<string>;
      pages: Map<string, number>;
      visitors: Map<string, number>;
    }
  >();
  const globalIps = new Set<string>();
  let unmappedVisits = 0;
  let totalVisits = 0;

  for (const r of rows) {
    totalVisits++;
    if (r.ip) globalIps.add(r.ip);
    if (r.lat == null || r.lon == null || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) {
      unmappedVisits++;
      continue;
    }
    const key = `${r.lat.toFixed(2)},${r.lon.toFixed(2)}`;
    let bucket = acc.get(key);
    if (!bucket) {
      bucket = {
        lat: r.lat,
        lon: r.lon,
        city: r.city || "",
        region: r.region || null,
        country: r.country || null,
        visits: 0,
        ips: new Set<string>(),
        pages: new Map<string, number>(),
        visitors: new Map<string, number>(),
      };
      acc.set(key, bucket);
    }
    bucket.visits++;
    bucket.ips.add(r.ip || `anon:${bucket.visits}`);
    const page = r.pageLabel || r.path || "Unknown page";
    bucket.pages.set(page, (bucket.pages.get(page) ?? 0) + 1);
    // Only signed-in visits carry an identity — guests contribute to the dot's
    // count but never appear in the "Visitors" list.
    const identity = r.userEmail || r.userName;
    if (identity) bucket.visitors.set(identity, (bucket.visitors.get(identity) ?? 0) + 1);
  }

  const points: CityPoint[] = [];
  for (const [key, b] of acc) {
    points.push({
      key,
      lat: b.lat,
      lon: b.lon,
      city: displayName(b.city, b.region, b.country),
      region: b.region,
      country: b.country,
      visits: b.visits,
      unique: b.ips.size,
      pages: [...b.pages.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, c) => c.count - a.count),
      visitors: [...b.visitors.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, c) => c.count - a.count),
    });
  }
  const ranked = [...points].sort((a, b) => b.unique - a.unique);

  return {
    points,
    ranked,
    totalVisits,
    totalUnique: globalIps.size,
    unmappedVisits,
    maxUnique: ranked.length ? ranked[0].unique : 0,
  };
}

// ── Dot sizing/color ─────────────────────────────────────────────────────────

const DOT_MIN_R = 3.5;
const DOT_MAX_R = 11;

function dotRadius(unique: number, max: number): number {
  if (max <= 0) return DOT_MIN_R;
  // sqrt compresses the long tail so one big city doesn't dwarf everything else.
  const t = Math.sqrt(unique / max);
  return DOT_MIN_R + t * (DOT_MAX_R - DOT_MIN_R);
}

const DOT_FILL = "#219EBC"; // HOME_THEME.cyan
const DOT_SELECTED_FILL = "#3DDC97"; // accent green for the pinned dot
const LAND_FILL = "rgba(255,255,255,0.045)";
const STROKE = "rgba(255,255,255,0.16)";

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

export function VisitorMap({ rows }: { rows: VisitorMapRow[] }) {
  const [features, setFeatures] = useState<Array<Feature<Geometry, { name?: string }>> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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
  const projection = useMemo(() => {
    if (!features || !width) return null;
    return geoNaturalEarth1().fitSize([width, height], {
      type: "FeatureCollection",
      features,
    } as FeatureCollection);
  }, [features, width, height]);

  const landPaths = useMemo(() => {
    if (!features || !projection) return [];
    const path = geoPath(projection);
    return features.map((f) => ({
      key: String(f.id ?? f.properties?.name ?? Math.random()),
      d: path(f) || "",
    }));
  }, [features, projection]);

  const dots = useMemo(() => {
    if (!projection) return [];
    return stats.points
      .map((p) => {
        const xy = projection([p.lon, p.lat]);
        if (!xy) return null;
        return { ...p, x: xy[0], y: xy[1] };
      })
      .filter((p): p is CityPoint & { x: number; y: number } => p != null);
  }, [projection, stats.points]);

  const selected = selectedKey ? stats.points.find((p) => p.key === selectedKey) ?? null : null;
  const hovered = !selected && hoverKey ? stats.points.find((p) => p.key === hoverKey) ?? null : null;
  const active = selected ?? hovered;

  const headline = active ? active.unique : stats.totalUnique;
  const headlineLabel = active ? active.city : "Worldwide";
  const subline = active
    ? `${active.visits.toLocaleString()} load${active.visits === 1 ? "" : "s"}`
    : `${stats.points.length} cit${stats.points.length === 1 ? "y" : "ies"}`;

  const cardStyle: CSSProperties = {
    background: HOME_THEME.panelBgStrong,
    border: `1px solid ${HOME_THEME.border}`,
    borderRadius: 18,
    padding: 0,
    position: "relative",
    overflow: "hidden",
    minWidth: 0,
  };

  const activeDot = dots.find((d) => d.key === (selected?.key ?? hovered?.key));

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
            Unique visitors · by city
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

      <div
        ref={wrapRef}
        style={{ position: "relative", width: "100%", minHeight: MIN_HEIGHT }}
        onClick={(e) => {
          // Clicking empty map area (not a dot) dismisses the pinned popup.
          if (e.target === e.currentTarget) setSelectedKey(null);
        }}
      >
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
          >
            {/* Faint basemap — no per-country coloring, just outlines. */}
            {landPaths.map((p) => (
              <path key={p.key} d={p.d} fill={LAND_FILL} stroke={STROKE} strokeWidth={0.4} />
            ))}

            {/* One dot per city, sized by unique visitors. Click pins the popup;
                clicking the same dot again (or empty map) dismisses it. */}
            {dots.map((d) => {
              const isSelected = selectedKey === d.key;
              const isHovered = !selectedKey && hoverKey === d.key;
              const r = dotRadius(d.unique, stats.maxUnique);
              return (
                <circle
                  key={d.key}
                  cx={d.x}
                  cy={d.y}
                  r={isSelected || isHovered ? r * 1.25 : r}
                  fill={isSelected ? DOT_SELECTED_FILL : DOT_FILL}
                  fillOpacity={isSelected ? 0.95 : 0.8}
                  stroke={isSelected ? DOT_SELECTED_FILL : "rgba(255,255,255,0.5)"}
                  strokeWidth={isSelected ? 1.5 : 0.8}
                  style={{ cursor: "pointer", transition: "r 120ms ease, fill 120ms ease" }}
                  onMouseEnter={() => setHoverKey(d.key)}
                  onMouseLeave={() => setHoverKey((k) => (k === d.key ? null : k))}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedKey((k) => (k === d.key ? null : d.key));
                  }}
                >
                  <title>{`${d.city} · ${d.unique.toLocaleString()} visitor${d.unique === 1 ? "" : "s"}`}</title>
                </circle>
              );
            })}
          </svg>
        )}

        {active && activeDot && (
          <div
            style={{
              position: "absolute",
              left: Math.min(Math.max(activeDot.x + 12, 8), Math.max((width || 0) - 220, 8)),
              top: Math.max(activeDot.y - 10, 8),
              pointerEvents: selected ? "auto" : "none",
              zIndex: 3,
              background: HOME_THEME.panelBgStrong,
              border: `1px solid ${selected ? DOT_SELECTED_FILL : HOME_THEME.borderStrong}`,
              borderRadius: 10,
              padding: "10px 12px",
              minWidth: 170,
              maxWidth: 280,
              boxShadow: `0 6px 22px ${ownerRgba("#000000", 0.55)}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: HOME_THEME.text }}>{active.city}</div>
              {selected && (
                <button
                  onClick={() => setSelectedKey(null)}
                  style={{
                    background: "none", border: "none", cursor: "pointer", color: HOME_THEME.text,
                    opacity: 0.5, fontSize: 13, lineHeight: 1, padding: 0,
                  }}
                  aria-label="Close"
                >
                  ✕
                </button>
              )}
            </div>
            <div
              style={{
                fontSize: 14,
                fontFamily: "var(--font-mono)",
                color: HOME_THEME.lightBlue,
                marginBottom: (active.visitors.length || active.pages.length) ? 8 : 0,
              }}
            >
              {active.unique.toLocaleString()} visitor{active.unique === 1 ? "" : "s"} · {active.visits.toLocaleString()} loads
            </div>
            {active.visitors.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: active.pages.length ? 8 : 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.5 }}>
                  Visitors
                </div>
                {active.visitors.slice(0, 6).map((v) => (
                  <div key={v.label} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: HOME_THEME.text, opacity: 0.85 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", color: HOME_THEME.lightBlue, flexShrink: 0 }}>{v.count}</span>
                  </div>
                ))}
                {active.visitors.length > 6 && (
                  <div style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.45 }}>+{active.visitors.length - 6} more</div>
                )}
              </div>
            )}
            {active.pages.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.5 }}>
                  Pages
                </div>
                {active.pages.slice(0, 6).map((p) => (
                  <div key={p.label} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: HOME_THEME.text, opacity: 0.85 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", color: HOME_THEME.lightBlue, flexShrink: 0 }}>{p.count}</span>
                  </div>
                ))}
                {active.pages.length > 6 && (
                  <div style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.45 }}>+{active.pages.length - 6} more</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Top cities + honest footnote about rows with no coordinates. */}
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
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.6 }}>
          Click a dot for details
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {stats.ranked.slice(0, 5).map((c) => (
            <button
              key={c.key}
              onClick={() => setSelectedKey((k) => (k === c.key ? null : c.key))}
              style={{
                fontSize: 14, color: HOME_THEME.text, opacity: 0.75, background: "none",
                border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit",
              }}
            >
              {c.city}{" "}
              <span style={{ fontFamily: "var(--font-mono)", color: HOME_THEME.lightBlue }}>
                {c.unique.toLocaleString()}
              </span>
            </button>
          ))}
          {stats.unmappedVisits > 0 && (
            <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.45 }}>
              {stats.unmappedVisits.toLocaleString()} unmapped
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
