/**
 * Visitors · world map.
 *
 * The owner console's `/owner/visitors`, repainted in Voltick. The map itself is
 * the console's component (see the banner in VisitorMap.tsx); this file is the
 * console's page around it, in Voltick's surfaces and type, with two
 * substitutions:
 *
 *   · where the console fetches `/api/page-visits?days=…&limit=…`, this reads
 *     the same window out of a seeded synthetic set;
 *   · the header counts are the console's arithmetic, unchanged, so the header
 *     and the map still cannot disagree about what a visitor is.
 *
 * Not ported, because there is nothing behind them here: the hourly refresh and
 * refresh-on-focus, the beacon-stale warning, the truncation notice, the "no geo
 * data yet" notice. Refresh restamps the clock and its tooltip says so.
 *
 * Nothing on this page calls the backend.
 */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ACCENT,
  ACCENT_SOFT,
  ACCENT_TEXT,
  ELEV,
  GOOD,
  LINE,
  MONO,
  PANEL,
  PAPER,
  PAPER_QUIET,
  R_MD,
  R_SM,
  SANS,
  W_BOLD,
  W_DATA,
  W_MED,
  rgba,
} from "../../theme";
import { PageShell } from "../../components/PageCard";
import { VisitorMap } from "./VisitorMap";
import { SAMPLE_VISITS, visitsWithin } from "./sampleVisits";

/** Window in days, exactly as the console's range picker sends it. 0 = no floor. */
const RANGES = [
  { key: "1", label: "Today", days: 1 },
  { key: "7", label: "7d", days: 7 },
  { key: "30", label: "30d", days: 30 },
  { key: "90", label: "90d", days: 90 },
  { key: "all", label: "All", days: 0 },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function VisitorsMapPage() {
  // Opens on All, the way the console does: the point of keeping the whole
  // history is not to hide most of it behind a click.
  const [range, setRange] = useState<RangeKey>("all");
  const [lastRefresh, setLastRefresh] = useState<Date>(() => new Date());

  const days = RANGES.find((r) => r.key === range)!.days;
  const visits = useMemo(() => visitsWithin(days), [days]);

  // Ticks once a minute so the "last visit N ago" label counts up on its own.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  /* Headline counts, lifted from the console's page unchanged, including the
     identity rule (account, then IP, then the row) the map uses for its dots. */
  const { countries, plotted, locations, accounts, subscribers } = useMemo(() => {
    const c = new Set<string>();
    const places = new Set<string>();
    const dots = new Set<string>();
    const signedIn = new Set<string>();
    const paying = new Set<string>();
    let anon = 0;
    for (const v of visits) {
      const code = (v.country || "").toUpperCase();
      if (code && code !== "XX" && code !== "T1") c.add(code);
      const vid = v.userEmail
        ? `e:${v.userEmail.trim().toLowerCase()}`
        : v.userId
          ? `u:${v.userId}`
          : v.ip
            ? `ip:${v.ip}`
            : `anon:${++anon}`;
      if (v.userEmail || v.userId) signedIn.add(vid);
      if (v.isSubscriber) paying.add(vid);
      if (typeof v.lat === "number" && typeof v.lon === "number") {
        const pk = `${v.lat.toFixed(2)},${v.lon.toFixed(2)}`;
        places.add(pk);
        dots.add(`${pk}|${vid}`);
      }
    }
    return {
      countries: c.size,
      plotted: dots.size,
      locations: places.size,
      accounts: signedIn.size,
      subscribers: paying.size,
    };
  }, [visits]);

  /* The map also plots everyone whose row has a country and no coordinate, on
     that country's centroid. Counted here as one visitor per country, the way
     the map merges them, so the header does not read as a near-empty map. */
  const countryLevel = useMemo(() => {
    const located = new Set<string>();
    const seen = new Set<string>();
    let anon = 0;
    for (const v of visits) {
      const code = (v.country || "").toUpperCase();
      if (!code || code === "XX" || code === "T1") continue;
      const id = v.userEmail
        ? `e:${v.userEmail.trim().toLowerCase()}`
        : v.userId
          ? `u:${v.userId}`
          : v.ip
            ? `ip:${v.ip}`
            : null;
      if (typeof v.lat === "number" && typeof v.lon === "number") {
        if (id) located.add(`${id}|${code}`);
        continue;
      }
      seen.add(id ? `${id}|${code}` : `anon:${++anon}|${code}`);
    }
    let n = 0;
    for (const k of seen) if (!located.has(k)) n++;
    return n;
  }, [visits]);

  const newestMs = visits.length ? Date.parse(visits[0].createdAt ?? "") : NaN;
  const newestAge = Number.isFinite(newestMs) ? now - newestMs : null;
  const oldest = SAMPLE_VISITS.length
    ? new Date(SAMPLE_VISITS[SAMPLE_VISITS.length - 1].createdAt ?? "")
    : null;

  return (
    <div
      style={{
        // The copied component asks for these two by name. Defined here, so the
        // copy needs no edit to find the fonts this app actually ships.
        ["--font-mono" as string]: MONO,
        ["--font-inter" as string]: SANS,
      }}
    >
      <PageShell
        title="Visitors · world map"
        maxWidth={1480}
        lede={
          <>
            The owner console's map, repainted in Voltick and pointed at synthetic rows. One dot per
            visitor rather than per city, so a place with nine people on it looks like nine people.
            Narrow the range to look at a window, click a dot or a country to pin its card, scroll to
            zoom and drag to pan.
          </>
        }
      >
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            padding: "12px 15px",
            background: PANEL,
            border: `1px solid ${LINE}`,
            borderRadius: R_MD,
            marginBottom: 14,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: W_BOLD, color: PAPER, whiteSpace: "nowrap" }}>
            Visitors · World Map
          </span>
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: PAPER_QUIET, whiteSpace: "nowrap" }}>
            Updated {lastRefresh.toLocaleTimeString()}
          </span>
          {newestAge != null && (
            <span
              style={{ fontFamily: MONO, fontSize: 11.5, color: GOOD, whiteSpace: "nowrap" }}
              title="Age of the most recent logged page load."
            >
              ● last visit {agoLabel(newestAge)}
            </span>
          )}

          <span style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Stat n={visits.length} label="loads" />
            <Stat n={countries} label="countries" />
            <Stat n={plotted + countryLevel} label="visitors plotted" />
            <Stat n={locations} label="locations" />
            {countryLevel > 0 && <Stat n={countryLevel} label="country-level" />}
            <Stat n={subscribers} label="subscribers" />
            <Stat n={accounts} label="signed in" />
          </span>

          <span style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
            {RANGES.map((r) => {
              const on = r.key === range;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setRange(r.key)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: R_SM,
                    cursor: "pointer",
                    font: "inherit",
                    fontFamily: MONO,
                    fontSize: 11,
                    border: `1px solid ${on ? rgba(ACCENT, 0.55) : LINE}`,
                    background: on ? ACCENT_SOFT : "transparent",
                    color: on ? ACCENT_TEXT : PAPER_QUIET,
                  }}
                >
                  {r.label}
                </button>
              );
            })}
          </span>

          <Link to="/customer-card" style={buttonStyle}>
            Customers →
          </Link>
          <button
            type="button"
            onClick={() => setLastRefresh(new Date())}
            title="The rows are baked with a fixed seed. This restamps the clock."
            style={{ ...buttonStyle, font: "inherit", fontSize: 13, fontWeight: W_MED, cursor: "pointer" }}
          >
            ↻ Refresh
          </button>
        </div>

        <VisitorMap rows={visits} />

        <p style={{ margin: "14px 0 0", fontSize: 12.5, lineHeight: 1.75, color: PAPER_QUIET, maxWidth: 1180 }}>
          Opens on <Strong>All</Strong>, every load in the set. One dot per visitor, not per city:
          visitors sharing a location are fanned out around it, so zoom in to separate them. A{" "}
          <Strong>solid</Strong> dot is a paying subscriber (active or trialing), a <Strong>ring</Strong>{" "}
          in the same hue is a signed-in account that is not paying, and a quiet ring is an anonymous
          visitor known only by IP. Click any dot for the email, Discord, user id, member-since, last
          login and subscription status, or a country for its own card. A <Strong>dashed, dimmed</Strong>{" "}
          dot has no city on its row at all and is fanned out around the middle of its country: a real
          visitor at a position we are guessing. On the console those are the rows that lost their
          coordinates on the way into the database, which <code>backfill-visit-geo.js</code> geocodes
          back to a real place; only what that cannot resolve stays dashed. Solid positions are metro
          centroids from the visitor's IP, never device locations.{" "}
          {oldest && <>History goes back to {oldest.toLocaleDateString()}. </>}
          Every row here is synthetic and the set is baked with a fixed seed, so Refresh restamps the
          clock and changes nothing else.
        </p>
      </PageShell>
    </div>
  );
}

const buttonStyle = {
  padding: "7px 13px",
  borderRadius: R_MD,
  border: `1px solid ${LINE}`,
  background: ELEV,
  color: PAPER,
  fontSize: 13,
  fontWeight: W_MED,
  textDecoration: "none",
  whiteSpace: "nowrap",
} as const;

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, whiteSpace: "nowrap" }}>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 14,
          fontWeight: W_DATA,
          fontVariantNumeric: "tabular-nums",
          color: PAPER,
        }}
      >
        {n.toLocaleString()}
      </span>
      <span style={{ fontSize: 12, color: PAPER_QUIET }}>{label}</span>
    </span>
  );
}

function Strong({ children }: { children: ReactNode }) {
  return <span style={{ color: PAPER, fontWeight: W_MED }}>{children}</span>;
}
