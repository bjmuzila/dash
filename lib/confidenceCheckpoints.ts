import { unstable_cache } from "next/cache";
import { queryAll, type MvcRecord } from "@/lib/db";

/**
 * Shared CB - Core Bullseye checkpoint computation.
 *
 * For each session we sample the MVC (CB) strike at three fixed ET checkpoints
 * (9:45 / 10:30 / 12:00) and report, per checkpoint: the active CB strike, SPX
 * at that time, the day's CLOSEST SPX got to that strike afterward, and whether
 * it was touched within HIT_PTS / each tier. Used by:
 *   - /api/confidence/checkpoints (owner results board, variable range), and
 *   - the public /explore/confidence-score 7-day tracker (EOD, completed days).
 */

export const HIT_PTS = 8;                       // SPX pts within strike = a touch
export const TIERS = [5, 10, 15] as const;      // additional touch thresholds (pts)
const CHECKPOINTS = [
  { key: "0945", label: "9:45", min: 9 * 60 + 45 },
  { key: "1030", label: "10:30", min: 10 * 60 + 30 },
  { key: "1200", label: "12:00", min: 12 * 60 },
] as const;
const MATCH_WINDOW = 20;                         // accept a snapshot within ±20 min of a checkpoint

export type CheckpointResult = {
  key: string;
  label: string;
  strike: number | null;
  spxAt: number | null;
  distAt: number | null;
  closest: number | null;
  hit: boolean;
  matched: boolean;
  tiers: Record<number, boolean | null>;
  changed: boolean;
};
export type DayRow = { date: string; checkpoints: CheckpointResult[] };
export type CheckpointSummary = {
  key: string;
  label: string;
  samples: number;
  hits: number;
  hitRate: number | null;
  avgClosest: number | null;
  tiers: Record<number, { hits: number; rate: number | null }>;
};
export type CheckpointData = {
  days: DayRow[];
  summary: CheckpointSummary[];
  hitPts: number;
  tiers: number[];
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function strikeOf(r: MvcRecord): number | null {
  return num(r.strikeOIVol) ?? num(r.strikeVolOnly) ?? null;
}
function rowMinutesET(r: MvcRecord): number | null {
  const t = String((r as { time?: unknown }).time ?? "");
  const mm = /^(\d{1,2}):(\d{2})/.exec(t);
  if (mm) return Number(mm[1]) * 60 + Number(mm[2]);
  const ms = Number(r.timestamp) || 0;
  if (!ms) return null;
  const hhmm = new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit",
  });
  const p = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return p ? Number(p[1]) * 60 + Number(p[2]) : null;
}

/** Compute checkpoint days + roll-up for a set of ET dates (newest first). */
export async function computeCheckpointData(dates: string[]): Promise<CheckpointData> {
  const days: DayRow[] = [];
  for (const date of dates) {
    const rows = await queryAll<MvcRecord>(
      `SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp ASC LIMIT 2000`,
      [date]
    );
    const timed = rows
      .map((r) => {
        const rawSpx = num(r.spxPrice);
        const spx = rawSpx != null && rawSpx > 1000 ? rawSpx : null;
        return { min: rowMinutesET(r), strike: strikeOf(r), spx };
      })
      .filter((x): x is { min: number; strike: number | null; spx: number | null } => x.min != null);
    if (!timed.length) continue;
    if (!timed.some((t) => t.spx != null)) continue;

    const resolved = CHECKPOINTS.map((cp) => {
      let best: typeof timed[number] | null = null;
      let bestGap = Infinity;
      let bestSpx: typeof timed[number] | null = null;
      let bestSpxGap = Infinity;
      for (const t of timed) {
        const gap = Math.abs(t.min - cp.min);
        if (gap < bestGap) { bestGap = gap; best = t; }
        if (t.spx != null && gap < bestSpxGap) { bestSpxGap = gap; bestSpx = t; }
      }
      const matched = best != null && bestGap <= MATCH_WINDOW;
      const spxMatched = bestSpx != null && bestSpxGap <= MATCH_WINDOW;
      return {
        cp, matched,
        strike: matched ? best!.strike : null,
        spxAt: spxMatched ? bestSpx!.spx : (matched ? best!.spx : null),
      };
    });

    const checkpoints: CheckpointResult[] = resolved.map((r, idx) => {
      const { cp, matched, strike, spxAt } = r;
      const distAt = strike != null && spxAt != null ? Math.abs(spxAt - strike) : null;

      let changed = false;
      for (let j = idx + 1; j < resolved.length; j++) {
        const nxt = resolved[j];
        if (nxt.matched && nxt.strike != null && strike != null && nxt.strike !== strike) {
          changed = true;
          break;
        }
      }

      let closest: number | null = null;
      if (strike != null) {
        for (const t of timed) {
          if (t.min < cp.min - MATCH_WINDOW) continue;
          if (t.spx == null || t.spx <= 0) continue;
          const d = Math.abs(t.spx - strike);
          if (closest == null || d < closest) closest = d;
        }
      }
      if (closest != null && strike != null && closest > strike * 0.5) closest = null;

      const tiers: Record<number, boolean | null> = {};
      for (const t of TIERS) tiers[t] = closest != null ? closest <= t : null;
      return {
        key: cp.key, label: cp.label, strike, spxAt, distAt, closest,
        hit: closest != null && closest <= HIT_PTS, matched, tiers, changed,
      };
    });

    days.push({ date, checkpoints });
  }

  const summary: CheckpointSummary[] = CHECKPOINTS.map((cp) => {
    const cells = days
      .map((d) => d.checkpoints.find((c) => c.key === cp.key))
      .filter((c): c is CheckpointResult => !!c && c.matched && c.strike != null);
    const hits = cells.filter((c) => c.hit).length;
    const dists = cells.map((c) => c.closest).filter((v): v is number => v != null);
    const avgClosest = dists.length ? dists.reduce((s, v) => s + v, 0) / dists.length : null;
    const tierStats: Record<number, { hits: number; rate: number | null }> = {};
    for (const t of TIERS) {
      const h = cells.filter((c) => c.tiers?.[t]).length;
      tierStats[t] = { hits: h, rate: cells.length ? h / cells.length : null };
    }
    return {
      key: cp.key, label: cp.label,
      samples: cells.length, hits,
      hitRate: cells.length ? hits / cells.length : null,
      avgClosest, tiers: tierStats,
    };
  });

  return { days, summary, hitPts: HIT_PTS, tiers: [...TIERS] };
}

/** Distinct ET dates with snapshot data, newest first. */
export async function checkpointDates(limit: number): Promise<string[]> {
  const rows = await queryAll<{ date: string }>(
    `SELECT DISTINCT date FROM mvc_snapshots ORDER BY date DESC LIMIT ?`,
    [limit]
  );
  return rows.map((d) => d.date);
}

function todayETStr(): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/**
 * Rolling last-7 COMPLETED sessions for the public tracker. Excludes today so
 * the numbers are always end-of-day final, and is cached per ET calendar day —
 * it recomputes once when the date rolls over (i.e. once at EOD) and stays
 * static in between.
 */
export async function getConfidence7dCompleted(): Promise<CheckpointData> {
  const today = todayETStr();
  return unstable_cache(
    async () => {
      const dates = (await checkpointDates(20)).filter((d) => d < today).slice(0, 7);
      return computeCheckpointData(dates);
    },
    ["confidence-7d", today],
    { revalidate: 21600, tags: ["confidence-7d"] }
  )();
}
