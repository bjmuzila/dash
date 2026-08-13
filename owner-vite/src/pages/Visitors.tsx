import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OWNER_THEME as T,
  ownerRgba,
  homeHeaderStyle,
  homePanelStyle,
  homeShellStyle,
  homeSecondaryButtonStyle,
} from "../lib/theme";
import { VisitorMap, type VisitorMapRow } from "../components/VisitorMap";

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
 * 2026-08-06 — three fixes for "it only shows 5000 loads and no new users":
 *
 *   1. The 5000 was never a display setting. page_visits self-trimmed to the
 *      newest 5000 rows on every insert, so anything older was DELETED. That
 *      trim is gone (lib/db.ts) — history is kept, and the range picker below
 *      chooses how far back to look instead.
 *   2. This page fetched once on mount and never again. A tab left open showed
 *      a snapshot from whenever it was opened, which reads as "nobody new".
 *      It now refreshes hourly, and immediately on tab re-focus.
 *   3. "No new visitors" and "the beacon stopped firing" looked identical.
 *      The header now shows the age of the newest row, and calls it out when
 *      nothing has been logged in over two hours.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface PageVisit extends VisitorMapRow {
  id?: number;
  pageKey?: string | null;
}

/** Server-side window, in days. 0 = no date floor. `all` is the default on open. */
const RANGES = [
  { key: "1", label: "Today", days: 1 },
  { key: "7", label: "7d", days: 7 },
  { key: "30", label: "30d", days: 30 },
  { key: "90", label: "90d", days: 90 },
  { key: "all", label: "All", days: 0 },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

/** Render budget. The map draws a dot per visitor, so this is about frame time,
 *  not storage — the API reports `truncated` when the window held more. */
const RENDER_LIMIT = 20000;

const REFRESH_MS = 60 * 60 * 1000; // hourly

/** Data older than this with no new rows means the beacon is probably broken,
 *  not that traffic stopped. Loud enough to notice, slack enough for a quiet
 *  overnight hour. */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function Visitors() {
  const [visits, setVisits] = useState<PageVisit[]>([]);
  // Opens on All. The point of dropping the retention trim was to have the whole
  // history — defaulting to a window would hide most of it behind a click, which
  // is the same "there's nobody here" impression the old 5000-row cap gave. The
  // 20k render cap and the truncation notice keep a large All range honest.
  const [range, setRange] = useState<RangeKey>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [meta, setMeta] = useState<{
    total: number;
    truncated: boolean;
    newestAt: string | null;
    oldestAt: string | null;
  } | null>(null);

  // Ticks once a minute so the "newest visit N ago" label counts up between
  // the hourly fetches — otherwise a stale beacon still looks fresh for an hour.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Read the range through a ref inside the interval/focus handlers so those
  // effects don't tear down and restart the hourly timer on every range change.
  const rangeRef = useRef<RangeKey>(range);
  rangeRef.current = range;

  const load = useCallback(async (rangeKey: RangeKey, opts?: { quiet?: boolean }) => {
    // A background refresh must not blank the map — only a range change or the
    // first load shows the spinner.
    if (!opts?.quiet) setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/page-visits?days=${rangeKey}&limit=${RENDER_LIMIT}`,
        { cache: "no-store" }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      const rows = (j?.visits ?? []) as PageVisit[];
      setVisits(rows);
      setMeta({
        total: Number(j?.total ?? rows.length),
        truncated: Boolean(j?.truncated),
        newestAt: j?.newestAt ?? null,
        oldestAt: j?.oldestAt ?? null,
      });
      setLastRefresh(new Date());
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load visits");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount and whenever the range changes.
  useEffect(() => { void load(range); }, [load, range]);

  // Hourly refresh, suspended while the tab is hidden. A backgrounded tab that
  // kept polling would burn a full owner query an hour for nobody to look at,
  // and browsers throttle the timer anyway — so instead we refresh the moment
  // the tab comes back, which is when accuracy actually matters.
  useEffect(() => {
    let timer: number | undefined;
    const start = () => {
      if (timer != null) return;
      timer = window.setInterval(() => { void load(rangeRef.current, { quiet: true }); }, REFRESH_MS);
    };
    const stop = () => {
      if (timer == null) return;
      window.clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) { stop(); return; }
      void load(rangeRef.current, { quiet: true });
      start();
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [load]);

  // Headline counts for the header strip. Cheap enough to do here rather than
  // reaching into the map's internal aggregate, and deliberately counted the same
  // way the map does — one dot per visitor per location — so the header and the
  // map can't disagree.
  const { countries, plotted, locations, accounts, geoCoded } = useMemo(() => {
    const c = new Set<string>();
    const places = new Set<string>();
    const dots = new Set<string>();
    const signedIn = new Set<string>();
    let geo = 0;
    let anon = 0;
    for (const v of visits) {
      const code = (v.country || "").toUpperCase();
      if (code && code !== "XX" && code !== "T1") c.add(code);
      // Same identity rule the map uses (see visitorKey in VisitorMap): account
      // first, then IP, then a per-row key.
      const vid = v.userEmail
        ? `e:${v.userEmail.trim().toLowerCase()}`
        : v.userId
          ? `u:${v.userId}`
          : v.ip
            ? `ip:${v.ip}`
            : `anon:${++anon}`;
      if (v.userEmail || v.userId) signedIn.add(vid);
      if (typeof v.lat === "number" && typeof v.lon === "number") {
        geo++;
        const pk = `${v.lat.toFixed(2)},${v.lon.toFixed(2)}`;
        places.add(pk);
        dots.add(`${pk}|${vid}`);
      }
    }
    return { countries: c.size, plotted: dots.size, locations: places.size, accounts: signedIn.size, geoCoded: geo };
  }, [visits]);

  // The map ALSO plots everyone whose row has a country but no coordinate, on
  // that country's centroid. Those dots are the bulk of the history (nothing
  // before 2026-08-13 has coordinates), so the header would read as a near-empty
  // map without them. Counted here as "one visitor per country" to match how the
  // map merges them.
  const countryLevel = useMemo(() => {
    const located = new Set<string>();
    const seen = new Set<string>();
    let anon = 0;
    for (const v of visits) {
      const code = (v.country || "").toUpperCase();
      if (!code || code === "XX" || code === "T1") continue;
      const id = v.userEmail
        ? `e:${v.userEmail.trim().toLowerCase()}`
        : v.userId ? `u:${v.userId}` : v.ip ? `ip:${v.ip}` : null;
      if (typeof v.lat === "number" && typeof v.lon === "number") {
        if (id) located.add(`${id}|${code}`);
        continue;
      }
      seen.add(id ? `${id}|${code}` : `anon:${++anon}|${code}`);
    }
    // A visitor already plotted on a city in that country isn't a second dot.
    let n = 0;
    for (const k of seen) if (!located.has(k)) n++;
    return n;
  }, [visits]);

  const newestMs = meta?.newestAt ? Date.parse(meta.newestAt) : NaN;
  const newestAge = Number.isFinite(newestMs) ? now - newestMs : null;
  const beaconStale = newestAge != null && newestAge > STALE_AFTER_MS;

  const Stat = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, fontSize: 14 }}>
      <span style={{ color: tone ?? T.text, fontFamily: "var(--font-mono)", fontWeight: 700 }}>{value}</span>
      <span style={{ color: T.textSecondary, opacity: 0.6 }}>{label}</span>
    </span>
  );

  return (
    <div style={homeShellStyle}>
      {/* Header */}
      <div style={homeHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "0.01em", color: T.text }}>
            Visitors · World Map
          </span>
          {lastRefresh && (
            <span style={{ fontSize: 14, color: T.muted, opacity: 0.6 }}>
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          {newestAge != null && (
            <span
              style={{
                fontSize: 14,
                fontFamily: "var(--font-mono)",
                color: beaconStale ? T.red : T.green,
                opacity: beaconStale ? 1 : 0.85,
              }}
              title={
                beaconStale
                  ? "No visit has been logged recently — check that the /api/page-status beacon is still reaching the server."
                  : "Age of the most recent logged page load."
              }
            >
              {beaconStale ? "⚠ " : "● "}last visit {agoLabel(newestAge)}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Stat label="loads" value={(meta?.total ?? visits.length).toLocaleString()} />
          <Stat label="countries" value={countries.toLocaleString()} />
          <Stat label="visitors plotted" value={(plotted + countryLevel).toLocaleString()} />
          <Stat label="locations" value={locations.toLocaleString()} />
          {countryLevel > 0 && <Stat label="country-level" value={countryLevel.toLocaleString()} />}
          <Stat label="signed in" value={accounts.toLocaleString()} />

          {/* Range picker — server-side window, so a wider range costs a query,
              not a bigger client-side filter over rows we already threw away. */}
          <div style={{ display: "inline-flex", borderRadius: 10, overflow: "hidden", border: `1px solid ${T.border}` }}>
            {RANGES.map((r) => {
              const active = r.key === range;
              return (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  disabled={loading && active}
                  style={{
                    padding: "5px 11px",
                    fontSize: 14,
                    fontWeight: active ? 700 : 400,
                    cursor: "pointer",
                    border: "none",
                    background: active ? ownerRgba(T.cyan, 0.22) : "transparent",
                    color: active ? T.text : T.textSecondary,
                    opacity: active ? 1 : 0.6,
                  }}
                >
                  {r.label}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => void load(range)}
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

        {/* Beacon health. "Nobody visited" and "we stopped recording visits"
            look the same on a map — say which one this is. */}
        {beaconStale && !error && (
          <div style={{ ...homePanelStyle, padding: "12px 16px", fontSize: 14, color: T.textSecondary, lineHeight: 1.6, borderColor: ownerRgba(T.red, 0.4) }}>
            <b style={{ color: T.red }}>No page load has been logged in {agoLabel(newestAge!)}.</b>{" "}
            Either traffic really has stopped, or the <code>/api/page-status</code> beacon is no longer
            reaching the server — check that the route is still public and that the SPA is loading
            <code> LayoutShell</code>.
          </div>
        )}

        {loading && visits.length === 0 ? (
          <div style={{ ...homePanelStyle, padding: 32, textAlign: "center", color: T.muted, fontSize: 14 }}>
            Loading visit log…
          </div>
        ) : (
          <VisitorMap rows={visits} />
        )}

        {/* Cloudflare only attaches geo headers once the managed transform is
            on, so rows logged before that have no country and no coords. Say so
            rather than letting the map read as "nobody visited". */}
        {visits.length > 0 && geoCoded === 0 && (
          <div style={{ ...homePanelStyle, padding: "12px 16px", fontSize: 14, color: T.textSecondary, lineHeight: 1.6 }}>
            None of the {visits.length.toLocaleString()} logged loads carry geo data yet. Enable Cloudflare's
            <b style={{ color: T.cyan }}> Add visitor location headers </b> managed transform — rows logged
            after that will start plotting.
          </div>
        )}

        {/* The old page silently capped at 5000 and looked complete. If the
            window really does hold more than we drew, say so. */}
        {meta?.truncated && (
          <div style={{ ...homePanelStyle, padding: "12px 16px", fontSize: 14, color: T.textSecondary, lineHeight: 1.6 }}>
            Showing the newest <b style={{ color: T.gold }}>{visits.length.toLocaleString()}</b> of{" "}
            <b style={{ color: T.gold }}>{meta.total.toLocaleString()}</b> loads in this range — the map is
            capped at {RENDER_LIMIT.toLocaleString()} points for frame rate. Narrow the range for a
            complete picture of a shorter window.
          </div>
        )}

        <div style={{ fontSize: 14, color: T.textSecondary, opacity: 0.55, lineHeight: 1.6 }}>
          Opens on <b>All</b> — every load ever recorded. Narrow the range to look at a window.{" "}
          One dot per visitor, not per city — visitors sharing a location are fanned out around it,
          so zoom in to separate them. A solid gold dot is a signed-in account (click it for the
          email, Discord, user id, member-since and last login); a hollow slate dot is an anonymous
          visitor, known only by IP. A <b>dashed, dimmed</b> dot is a visitor whose row carried a
          country but no coordinate — they are fanned out around the middle of that country, not
          located. Every row before 13 Aug 2026 is one of those: the coordinate columns were being
          read from Cloudflare and then dropped on the way into the database, so that history cannot
          be recovered. Click a country or a dot to pin its detail card. Scroll to zoom, drag to pan,
          double-click to zoom in. Solid positions are Cloudflare metro centroids from the visitor's
          IP, not device locations.
          {meta?.oldestAt && (
            <> History goes back to {new Date(meta.oldestAt).toLocaleDateString()}; the log is no longer
            trimmed, so this range grows on its own. Auto-refreshes hourly while this tab is visible.</>
          )}
        </div>
      </div>
    </div>
  );
}
