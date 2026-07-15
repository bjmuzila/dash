"use client";

import { useEffect, useState } from "react";

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
  /** Peak |GEX| used for the scaling, in raw units. */
  peak: number;
  expiry: string;
  date: string;
  loading: boolean;
  error: string | null;
}

const EMPTY: GexSurface = {
  strikes: [], times: [], rows: [], norm: [], spotPath: [],
  peak: 0, expiry: "", date: "", loading: true, error: null,
};

export function useGexSurface(
  basis: "net" | "vol" = "net",
  expiry?: string,
  pollMs = 60_000
): GexSurface {
  const [surface, setSurface] = useState<GexSurface>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const qs = new URLSearchParams({ mode: "series", basis, window: "13", buckets: "30" });
        if (expiry) qs.set("expiry", expiry);
        const r = await fetch(`/proxy/gex-history?${qs}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`gex-history ${r.status}`);
        const j = await r.json();
        if (cancelled) return;

        const rows: (number | null)[][] = Array.isArray(j?.rows) ? j.rows : [];
        // Scale by the day's peak |GEX| — NOT by each column's own max, which
        // would flatten the session into a uniform ridge and hide the whole
        // point of the view (walls growing/decaying through the day).
        let peak = 0;
        for (const row of rows) for (const v of row) {
          if (v != null && Number.isFinite(v)) peak = Math.max(peak, Math.abs(v));
        }
        const norm = rows.map((row) => row.map((v) => (peak > 0 && v != null && Number.isFinite(v) ? v / peak : 0)));

        setSurface({
          strikes: Array.isArray(j?.strikes) ? j.strikes : [],
          times: Array.isArray(j?.times) ? j.times : [],
          rows,
          norm,
          spotPath: Array.isArray(j?.spotPath) ? j.spotPath : [],
          peak,
          expiry: j?.expiry || "",
          date: j?.date || "",
          loading: false,
          error: null,
        });
      } catch (e) {
        if (cancelled) return;
        setSurface((s) => ({ ...s, loading: false, error: String((e as Error)?.message || e) }));
      }
    };
    load();
    const id = setInterval(load, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [basis, expiry, pollMs]);

  return surface;
}
