import { NextRequest, NextResponse } from "next/server";
import { queryAll, type MvcRecord } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * /api/confidence/checkpoints — per-day MVC checkpoint tracking.
 *
 * For each session we sample the MVC strike at three fixed ET checkpoints
 * (9:45, 10:30, 12:00). For each checkpoint we report:
 *   - the MVC strike that was active at that time,
 *   - SPX at that time,
 *   - the day's CLOSEST that SPX got to that strike afterward (min |spx-strike|),
 *   - whether SPX ever touched it (within HIT_PTS) after the checkpoint.
 *
 * ?since=N  → last N calendar days with data (default 20). ?all=1 → no cap.
 */

const HIT_PTS = 8;                       // SPX pts within strike = a touch
const TIERS = [5, 10, 15] as const;      // additional touch thresholds (pts)
const CHECKPOINTS = [
  { key: "0945", label: "9:45", min: 9 * 60 + 45 },
  { key: "1030", label: "10:30", min: 10 * 60 + 30 },
  { key: "1200", label: "12:00", min: 12 * 60 },
] as const;
const MATCH_WINDOW = 20;                 // accept a snapshot within ±20 min of the checkpoint

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

type CheckpointResult = {
  key: string;
  label: string;
  strike: number | null;   // MVC strike at the checkpoint
  spxAt: number | null;    // SPX at the checkpoint
  distAt: number | null;   // |spxAt - strike| at the checkpoint
  closest: number | null;  // min |spx - strike| after the checkpoint (incl. checkpoint)
  hit: boolean;            // closest <= HIT_PTS
  matched: boolean;        // a snapshot was found near this checkpoint
  tiers: Record<number, boolean | null>; // touched within 5/10/15 pts
};

type DayRow = {
  date: string;
  checkpoints: CheckpointResult[];
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const all = searchParams.get("all") === "1";
    const since = Number(searchParams.get("since")) || 20;

    // Distinct dates with data, newest first.
    const dateRows = await queryAll<{ date: string }>(
      `SELECT DISTINCT date FROM mvc_snapshots ORDER BY date DESC LIMIT ?`,
      [all ? 365 : since]
    );
    const dates = dateRows.map((d) => d.date);

    const days: DayRow[] = [];
    for (const date of dates) {
      const rows = await queryAll<MvcRecord>(
        `SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp ASC LIMIT 2000`,
        [date]
      );
      const timed = rows
        .map((r) => {
          // SPX must be a plausible index print; 0/null/garbage (feed not yet
          // populated) is treated as missing so it can't poison closest.
          const rawSpx = num(r.spxPrice);
          const spx = rawSpx != null && rawSpx > 1000 ? rawSpx : null;
          return { min: rowMinutesET(r), strike: strikeOf(r), spx };
        })
        .filter((x): x is { min: number; strike: number | null; spx: number | null } => x.min != null);
      if (!timed.length) continue;
      // Skip a day entirely if it never had a single valid SPX print.
      if (!timed.some((t) => t.spx != null)) continue;

      const checkpoints: CheckpointResult[] = CHECKPOINTS.map((cp) => {
        // Nearest snapshot to the checkpoint, within the match window.
        let best: typeof timed[number] | null = null;
        let bestGap = Infinity;
        for (const t of timed) {
          const gap = Math.abs(t.min - cp.min);
          if (gap < bestGap) { bestGap = gap; best = t; }
        }
        const matched = best != null && bestGap <= MATCH_WINDOW;
        const strike = matched ? best!.strike : null;
        const spxAt = matched ? best!.spx : null;
        const distAt = strike != null && spxAt != null ? Math.abs(spxAt - strike) : null;

        // Closest SPX got to that strike from the checkpoint onward.
        // Ignore bad snapshots where SPX is missing/zero (feed defaulted), which
        // otherwise produce an absurd closest (~strike) and poison avg-closest.
        let closest: number | null = null;
        if (strike != null) {
          for (const t of timed) {
            if (t.min < cp.min - MATCH_WINDOW) continue;
            if (t.spx == null || t.spx <= 0) continue;
            const d = Math.abs(t.spx - strike);
            if (closest == null || d < closest) closest = d;
          }
        }
        // A closest on the order of the strike itself means no valid SPX print
        // was found — treat as no data rather than a giant miss.
        if (closest != null && strike != null && closest > strike * 0.5) closest = null;
        // Tiered touches: did SPX get within 5 / 10 / 15 pts of the strike?
        const tiers: Record<number, boolean | null> = {};
        for (const t of TIERS) tiers[t] = closest != null ? closest <= t : null;
        return {
          key: cp.key, label: cp.label, strike, spxAt, distAt, closest,
          hit: closest != null && closest <= HIT_PTS, matched, tiers,
        };
      });

      days.push({ date, checkpoints });
    }

    // Per-checkpoint hit-rate roll-up across all returned days.
    const summary = CHECKPOINTS.map((cp) => {
      const cells = days
        .map((d) => d.checkpoints.find((c) => c.key === cp.key))
        .filter((c): c is CheckpointResult => !!c && c.matched && c.strike != null);
      const hits = cells.filter((c) => c.hit).length;
      const dists = cells.map((c) => c.closest).filter((v): v is number => v != null);
      const avgClosest = dists.length ? dists.reduce((s, v) => s + v, 0) / dists.length : null;
      // Per-tier hit counts + rates across the same valid days.
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

    return NextResponse.json({ days, summary, hitPts: HIT_PTS, tiers: TIERS });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
