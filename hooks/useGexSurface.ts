"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Full-session GEX surface (strike × time) for the /gex-3d terrain map.
 *
 * Reads /proxy/gex-history?mode=series, which returns one column per recorded
 * snapshot (the writer persists every 60s) over today's ET session. Values are
 * raw net GEX; `norm` is the same grid scaled to roughly ±1 by the day's peak
 * |GEX| so the renderer's relief control means the same thing regardless of
 * whether it's a 200B or a 2B day.
 *
 * basis: "net" = OI+Vol composite (the dashboard default), "vol" = vol-only.
 */
export interface GexSurface {
  /** Strike ladder (ascending) — the X axis. */
  strikes: number[];
  /** Epoch ms per column — the Z axis. */
  times: number[];
  /** rows[t][s] raw net GEX; null where no row was recorded. */
  rows: (number | null)[][];
  /** rows scaled to ~[-1, 1] by peak |GEX|; nulls become 0. */
  norm: number[][];
  /** Spot at each column. */
  spotPath: (number | null)[];
  /** Epoch ms per 1-minute sample (undownsampled) — bubbles. */
  minuteTimes: number[];
  /** minuteRaw[m][s] raw net GEX at full 1-min resolution. */
  minuteRaw: (number | null)[][];
  /** minuteRows scaled by the SAME peak as `norm` so both layers agree. */
  minuteNorm: number[][];
  /** Peak |GEX| used for the scaling, in raw units. */
  peak: number;
  expiry: string;
  date: string;
  loading: boolean;
  error: string | null;
  /** Epoch ms of the last successful pull (not of the data itself). */
  fetchedAt: number;
  /**
   * Minutes between the columns that survived downsampling. Each column is
   * still ONE minute's snapshot — stride 13 means you're seeing every 13th
   * minute, NOT 13-minute averages.
   */
  strideMin: number;
  /** How many 1-min columns exist for the session before downsampling. */
  minutesAvailable: number;
  /**
   * True when the map is showing a FINISHED session rather than the current
   * one. The server holds the last completed session up until 08:00 ET before
   * rolling to the new contract, so this is expected overnight — not an error.
   */
  stale: boolean;
}

const EMPTY: GexSurface = {
  strikes: [], times: [], rows: [], norm: [], spotPath: [],
  minuteTimes: [], minuteRaw: [], minuteNorm: [],
  peak: 0, expiry: "", date: "", loading: true, error: null, fetchedAt: 0,
  strideMin: 1, minutesAvailable: 0, stale: false,
};

/**
 * Deliberately a SLOW poll. This is a session-shape view, not a tape — the
 * underlying writer only persists once a minute, and a 30-column terrain
 * doesn't visibly change between minutes anyway, so a fast poll would just
 * re-download ~400 minutes × 27 strikes to redraw the same picture. Callers
 * wanting a fresh pull on demand use the returned `refresh`.
 */
export const GEX_SURFACE_POLL_MS = 30 * 60_000; // 30 minutes

export function useGexSurface(
  basis: "net" | "vol" = "net",
  /** Max columns to render. 30 ≈ every ~13th minute; 400 = every minute. */
  buckets = 30,
  expiry?: string,
  pollMs = GEX_SURFACE_POLL_MS
): GexSurface & { refresh: () => void } {
  const [surface, setSurface] = useState<GexSurface>(EMPTY);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // minutes=1 is NOT requested: the 3D map draws towers only now (the
        // 1-min bubble layer was removed), so pulling ~390 extra rows per poll
        // would be dead weight. The server still supports it for future callers.
        const qs = new URLSearchParams({ mode: "series", basis, window: "13", buckets: String(buckets) });
        if (expiry) qs.set("expiry", expiry);
        const r = await fetch(`/proxy/gex-history?${qs}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`gex-history ${r.status}`);
        const j = await r.json();
        if (cancelled) return;

        const rows: (number | null)[][] = Array.isArray(j?.rows) ? j.rows : [];
        const minuteRaw: (number | null)[][] = Array.isArray(j?.minuteRows) ? j.minuteRows : [];

        // Scale by the day's peak |GEX| — NOT by each column's own max, which
        // would flatten the session into a uniform ridge and hide the whole
        // point of the view (walls growing/decaying through the day). The peak
        // is taken over the 1-min grid (a superset of the terrain columns) so
        // both layers share one scale and a bubble can't out-scale its ridge.
        let peak = 0;
        for (const row of (minuteRaw.length ? minuteRaw : rows)) for (const v of row) {
          if (v != null && Number.isFinite(v)) peak = Math.max(peak, Math.abs(v));
        }
        const scale = (g: (number | null)[][]) =>
          g.map((row) => row.map((v) => (peak > 0 && v != null && Number.isFinite(v) ? v / peak : 0)));

        setSurface({
          strikes: Array.isArray(j?.strikes) ? j.strikes : [],
          times: Array.isArray(j?.times) ? j.times : [],
          rows,
          norm: scale(rows),
          spotPath: Array.isArray(j?.spotPath) ? j.spotPath : [],
          minuteTimes: Array.isArray(j?.minuteTimes) ? j.minuteTimes : [],
          minuteRaw,
          minuteNorm: scale(minuteRaw),
          peak,
          expiry: j?.expiry || "",
          date: j?.date || "",
          loading: false,
          error: null,
          fetchedAt: Date.now(),
          strideMin: Number(j?.strideMin) || 1,
          minutesAvailable: Number(j?.minutesAvailable) || 0,
          stale: Boolean(j?.stale),
        });
      } catch (e) {
        if (cancelled) return;
        setSurface((s) => ({ ...s, loading: false, error: String((e as Error)?.message || e) }));
      }
    };
    load();
    const id = setInterval(load, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [basis, buckets, expiry, pollMs, nonce]);

  return { ...surface, refresh };
}
