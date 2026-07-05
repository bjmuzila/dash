"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HOME_THEME, homeButtonStyle, statTileStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

type PreviewRow = {
  ts: number;
  date: string;
  time: string | null;
  spx_price: number | null;
  gex_flip: number | null;
  call_wall: number | null;
  put_wall: number | null;
  expiration: string | null;
};

// Polls the /preview data route (not the live feed) — the row itself only
// changes every ~30m (server-v2/preview-snapshot-recorder.js), so this poll is
// just "pick up the next row once it lands," not a live stream.
const POLL_MS = 30_000;

function fmtNum(n: number | null | undefined, digits = 2) {
  return n == null || !Number.isFinite(n) ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function minutesAgo(ts: number) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  return m < 1 ? "just now" : `${m} min ago`;
}

export default function PreviewPage() {
  const [row, setRow] = useState<PreviewRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/preview", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) { setRow(json.row ?? null); setError(null); }
      } catch {
        if (!cancelled) setError("Couldn't load the preview feed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <PageShell maxWidth={640} align="center">
      <Card
        accent="cyan"
        title="SPX Snapshot — Delayed Preview"
        subtitle={row ? `Updated ${minutesAgo(row.ts)} · ${row.date} ${row.time ?? ""} ET` : undefined}
      >
        <p style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.75, lineHeight: 1.6, marginBottom: 20 }}>
          A ~30-minute-delayed look at the same gamma-exposure levels the live
          dashboard tracks in real time. Refreshes automatically as new
          snapshots land.
        </p>

        {loading && !row ? (
          <div style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.6 }}>Loading…</div>
        ) : error ? (
          <div style={{ fontSize: 13, color: HOME_THEME.red }}>{error}</div>
        ) : !row ? (
          <div style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.6 }}>
            No snapshot yet — check back once the market's open.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Stat label="SPX (delayed)" value={fmtNum(row.spx_price)} accent={HOME_THEME.cyan} />
            <Stat label="Gamma Flip" value={fmtNum(row.gex_flip, 0)} accent={HOME_THEME.green} />
            <Stat label="Call Wall" value={fmtNum(row.call_wall, 0)} accent={HOME_THEME.green} />
            <Stat label="Put Wall" value={fmtNum(row.put_wall, 0)} accent={HOME_THEME.red} />
          </div>
        )}
      </Card>

      <Card accent="orange" title="Want it live?" subtitle="Real-time levels, Confidence Score, options flow & more.">
        <p style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.75, lineHeight: 1.6, marginBottom: 16 }}>
          Members see every level update the moment it happens — no 30-minute
          lag — plus the full dashboard: Confidence Score, live options flow,
          Estimated Moves, and the ES Candles GEX heatmap.
        </p>
        <Link href="/pricing" style={{ textDecoration: "none" }}>
          <button style={{ ...homeButtonStyle, padding: "10px 20px" }}>See plans →</button>
        </Link>
      </Card>
    </PageShell>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ ...statTileStyle, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: HOME_THEME.text, opacity: 0.55 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent, marginTop: 4 }}>{value}</div>
    </div>
  );
}
