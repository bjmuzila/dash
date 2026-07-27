import { useCallback, useEffect, useMemo, useState } from "react";
import {
  OWNER_THEME as T,
  homeHeaderStyle,
  homePanelStyle,
  homeShellStyle,
  homeSecondaryButtonStyle,
  ownerRgba,
} from "../lib/theme";
import { VisitorMap, type VisitorMapRow } from "../components/VisitorMap";
import AcquisitionPanel, { type AcquisitionRow } from "../components/AcquisitionPanel";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VISITORS — the world map on its own route.
 *
 * It used to live on Owner → Overview, where it dominated that tab's frame
 * budget: a d3 Natural Earth projection, ~177 country paths and a bubble layer
 * all re-rendering underneath everything else. On its own page it gets the
 * whole viewport and stops taxing the metrics tab.
 *
 * Click any country or visitor dot for a pinned detail card (top pages, recent
 * visits, IPs) — that lives inside VisitorMap.
 *
 * Two views over the SAME fetch: the map (where visitors are) and Acquisition
 * (how they got here — referrer, campaign, device). They're a toggle rather than
 * a stacked scroll on purpose: the map's whole reason for moving to its own route
 * was to stop it re-rendering underneath other content, and putting a second
 * panel above it would walk that straight back.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface PageVisit extends VisitorMapRow, AcquisitionRow {
  id?: number;
  pageKey?: string | null;
}

type View = "map" | "acquisition";

export default function Visitors() {
  const [visits, setVisits] = useState<PageVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [view, setView] = useState<View>("map");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/page-visits?limit=5000", { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setVisits((j?.visits ?? []) as PageVisit[]);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load visits");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Headline counts for the header strip. Cheap enough to do here rather than
  // reaching into the map's internal aggregate, and deliberately counted the same
  // way the map does — one dot per visitor per location — so the header and the
  // map can't disagree.
  const { countries, plotted, locations, geoCoded } = useMemo(() => {
    const c = new Set<string>();
    const places = new Set<string>();
    const dots = new Set<string>();
    let geo = 0;
    let anon = 0;
    for (const v of visits) {
      const code = (v.country || "").toUpperCase();
      if (code && code !== "XX" && code !== "T1") c.add(code);
      if (typeof v.lat === "number" && typeof v.lon === "number") {
        geo++;
        const pk = `${v.lat.toFixed(2)},${v.lon.toFixed(2)}`;
        places.add(pk);
        dots.add(`${pk}|${v.userId ? `u:${v.userId}` : v.ip ? `ip:${v.ip}` : `anon:${++anon}`}`);
      }
    }
    return { countries: c.size, plotted: dots.size, locations: places.size, geoCoded: geo };
  }, [visits]);

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, fontSize: 14 }}>
      <span style={{ color: T.text, fontFamily: "var(--font-mono)", fontWeight: 700 }}>{value}</span>
      <span style={{ color: T.textSecondary, opacity: 0.6 }}>{label}</span>
    </span>
  );

  return (
    <div style={homeShellStyle}>
      {/* Header */}
      <div style={homeHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "0.01em", color: T.text }}>
            Visitors · {view === "map" ? "World Map" : "Acquisition"}
          </span>
          {/* View toggle — both views read the same already-loaded `visits`, so
              switching costs nothing and never refetches. */}
          <div style={{ display: "flex", gap: 6 }}>
            {([["map", "Map"], ["acquisition", "Acquisition"]] as [View, string][]).map(([k, label]) => {
              const on = view === k;
              return (
                <button
                  key={k}
                  onClick={() => setView(k)}
                  style={{
                    padding: "4px 12px",
                    fontSize: 13,
                    fontWeight: 700,
                    borderRadius: 8,
                    cursor: "pointer",
                    color: on ? T.cyan : T.text,
                    background: on ? ownerRgba(T.cyan, 0.12) : ownerRgba(T.text, 0.04),
                    border: `1px solid ${on ? ownerRgba(T.cyan, 0.3) : T.border}`,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {lastRefresh && (
            <span style={{ fontSize: 14, color: T.muted }}>Updated {lastRefresh.toLocaleTimeString()}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Stat label="loads" value={visits.length.toLocaleString()} />
          <Stat label="countries" value={countries.toLocaleString()} />
          <Stat label="visitors plotted" value={plotted.toLocaleString()} />
          <Stat label="locations" value={locations.toLocaleString()} />
          <button
            onClick={load}
            disabled={loading}
            style={{ ...homeSecondaryButtonStyle, padding: "5px 14px", fontSize: 14, opacity: loading ? 0.5 : 1 }}
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* Body — the map takes the whole page. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(14px,2vw,22px)", display: "flex", flexDirection: "column", gap: 14 }}>
        {error && (
          <div style={{ ...homePanelStyle, padding: "14px 18px", color: T.red, fontSize: 14 }}>
            {error}
          </div>
        )}

        {loading && visits.length === 0 ? (
          <div style={{ ...homePanelStyle, padding: 32, textAlign: "center", color: T.muted, fontSize: 14 }}>
            Loading visit log…
          </div>
        ) : view === "acquisition" ? (
          <AcquisitionPanel rows={visits} />
        ) : (
          <VisitorMap rows={visits} />
        )}

        {/* Cloudflare only attaches geo headers once the managed transform is
            on, so rows logged before that have no country and no coords. Say so
            rather than letting the map read as "nobody visited". */}
        {view === "map" && visits.length > 0 && geoCoded === 0 && (
          <div style={{ ...homePanelStyle, padding: "12px 16px", fontSize: 14, color: T.textSecondary, lineHeight: 1.6 }}>
            None of the {visits.length.toLocaleString()} logged loads carry geo data yet. Enable Cloudflare's
            <b style={{ color: T.cyan }}> Add visitor location headers </b> managed transform — rows logged
            after that will start plotting.
          </div>
        )}

        {view === "map" && (
          <div style={{ fontSize: 14, color: T.textSecondary, opacity: 0.55, lineHeight: 1.6 }}>
            One dot per visitor, not per city — visitors sharing a location are fanned out around it,
            so zoom in to separate them. Click a country or a dot to pin its detail card. Scroll to
            zoom, drag to pan, double-click to zoom in. Positions are Cloudflare metro centroids from
            the visitor's IP, not device locations.
          </div>
        )}
      </div>
    </div>
  );
}
