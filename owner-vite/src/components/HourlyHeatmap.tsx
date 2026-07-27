import { Fragment, useEffect, useState } from "react";
import { OWNER_THEME as HOME_THEME, homePanelStyle } from "../lib/theme";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * HOURLY LOAD HEATMAP — visits by hour × weekday (ET).
 *
 * Deliberately cheap. It used to be rebuilt from the shared 5,000-row visit log
 * on every ControlPanel render — including the once-a-second uptime tick — for
 * a picture that barely changes between one day and the next.
 *
 * Now it fetches and folds the log at most once per ET day, caches the finished
 * 7×24 grid in localStorage, and renders straight from that. A day-boundary
 * crossing (or a cache miss) triggers exactly one fetch; everything else is a
 * read. Per-cell tooltips are gone too — this is a texture, not a data table.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ET_TZ = "America/New_York";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const CACHE_KEY = "owner-hourly-heatmap-v1";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TZ,
  weekday: "short",
  hour: "numeric",
  hour12: false,
});

interface HeatmapData {
  /** grid[weekdayIdx][hour] = visit count */
  grid: number[][];
  max: number;
  total: number;
  /** ET calendar day this snapshot was built on — the cache key's real payload. */
  day: string;
  sampled: number;
}

/** Today in ET, as a stable YYYY-MM-DD-ish string. */
function etDay(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: ET_TZ });
}

function fold(rows: Array<{ createdAt?: string | null }>): Omit<HeatmapData, "day"> {
  const grid: number[][] = WEEKDAYS.map(() => Array(24).fill(0));
  const weekdayIdx: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  let total = 0;
  for (const v of rows) {
    if (!v.createdAt) continue;
    const t = new Date(v.createdAt);
    if (isNaN(t.getTime())) continue;
    const parts = partsFmt.formatToParts(t);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    let hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
    if (hour === 24) hour = 0; // some locales format midnight as "24"
    const di = weekdayIdx[weekday];
    if (di == null || isNaN(hour) || hour < 0 || hour > 23) continue;
    grid[di][hour] += 1;
    total++;
  }
  return { grid, max: Math.max(1, ...grid.flat()), total, sampled: rows.length };
}

function readCache(): HeatmapData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as HeatmapData;
    if (!Array.isArray(j?.grid) || j.grid.length !== 7) return null;
    return j;
  } catch {
    return null;
  }
}

export function HourlyHeatmap() {
  // Seed synchronously from cache so a same-day revisit paints immediately with
  // no fetch and no empty frame.
  const [data, setData] = useState<HeatmapData | null>(() => {
    const cached = readCache();
    return cached && cached.day === etDay() ? cached : null;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const today = etDay();
    if (data?.day === today) return; // already have today's snapshot

    let alive = true;
    setLoading(true);
    fetch("/api/page-visits?limit=5000", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return;
        const next: HeatmapData = { ...fold(j.visits ?? []), day: today };
        setData(next);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* quota — cosmetic */ }
      })
      .catch(() => { /* non-fatal: keep whatever snapshot we already had */ })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
    // `data` is intentionally read once here, not tracked: refetching whenever
    // it changes would loop, and the only thing that should retrigger a fetch
    // is a day rollover, which the mount check above covers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grid = data?.grid ?? WEEKDAYS.map(() => Array(24).fill(0));
  const max = data?.max ?? 1;

  return (
    <div style={{ ...homePanelStyle, padding: "13px 15px", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: HOME_THEME.cyan, marginBottom: 11, display: "flex", justifyContent: "space-between", gap: 10 }}>
        <span>Hourly load heatmap · visits by hour × weekday (ET)</span>
        <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.6, fontFamily: "var(--font-mono)", fontWeight: 500 }}>
          {loading && !data
            ? "loading…"
            : data
              ? `${data.total.toLocaleString()} visits · snapshot ${data.day}`
              : "no data"}
        </span>
      </div>

      {/* No per-cell tooltips by design — the value here is the shape of the
          week, and 168 hover targets was 168 reasons to re-render. */}
      <div style={{ display: "grid", gridTemplateColumns: "32px repeat(24, 1fr)", gap: 2 }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={"h" + h} style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, textAlign: "center" }}>
            {h % 6 === 0 ? h : ""}
          </div>
        ))}
        {WEEKDAYS.map((d, di) => (
          <Fragment key={d}>
            <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, lineHeight: "30px" }}>{d}</div>
            {grid[di].map((count, h) => {
              const v = count > 0 ? 0.06 + (count / max) * 0.85 : 0.03;
              return (
                <div
                  key={d + h}
                  style={{ height: 30, borderRadius: 2, background: `rgba(91,155,213,${v.toFixed(2)})` }}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export default HourlyHeatmap;
