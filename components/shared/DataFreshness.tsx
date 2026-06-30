"use client";

/**
 * DataFreshness — a drop-in LIVE / STALE badge for the trading dashboard.
 *
 * WHY: a frozen chart that still *looks* live is worse than an outage banner on
 * a trading product. This badge reads the feed's `updatedAt` and turns amber →
 * red as the data ages, so users (and you) can see at a glance when the GEX/flow
 * numbers stopped refreshing.
 *
 * USAGE: drop anywhere, no props required —
 *   <DataFreshness />
 * or feed it an updatedAt you already have (e.g. from the WS frame) to avoid the
 * extra poll:
 *   <DataFreshness updatedAt={snap.updatedAt} />
 *
 * Self-contained: polls /proxy/status every 5s when no updatedAt prop is given.
 * Thresholds are tuned for an RTH feed that ticks every ~2s.
 */

import { useEffect, useState } from "react";

const FRESH_MS = 15_000;   // ≤15s → LIVE (green)
const STALE_MS = 60_000;   // 15–60s → DELAYED (amber); >60s → STALE (red)

function ageMs(updatedAt: string | number | null | undefined): number | null {
  if (updatedAt == null) return null;
  const t = typeof updatedAt === "number" ? updatedAt : Date.parse(updatedAt);
  if (!Number.isFinite(t)) return null;
  return Date.now() - t;
}

type Level = "live" | "delayed" | "stale" | "unknown";

function levelFor(age: number | null): Level {
  if (age == null) return "unknown";
  if (age <= FRESH_MS) return "live";
  if (age <= STALE_MS) return "delayed";
  return "stale";
}

const STYLE: Record<Level, { dot: string; text: string; label: (s: string) => string }> = {
  live:    { dot: "#22d3aa", text: "#22d3aa", label: (s) => `LIVE · ${s}` },
  delayed: { dot: "#f5b14c", text: "#f5b14c", label: (s) => `DELAYED · ${s}` },
  stale:   { dot: "#ff5d5d", text: "#ff5d5d", label: (s) => `STALE · ${s}` },
  unknown: { dot: "#6b7280", text: "#9ca3af", label: () => "NO DATA" },
};

function fmtAge(age: number | null): string {
  if (age == null) return "";
  const s = Math.max(0, Math.round(age / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}

export default function DataFreshness({
  updatedAt: updatedAtProp,
  pollMs = 5000,
}: {
  updatedAt?: string | number | null;
  pollMs?: number;
}) {
  const [updatedAt, setUpdatedAt] = useState<string | number | null>(updatedAtProp ?? null);
  const [, force] = useState(0);

  // Re-render every second so the "Ns ago" / level updates even between polls.
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // When a prop is provided, mirror it; otherwise self-poll /proxy/status.
  useEffect(() => {
    if (updatedAtProp != null) {
      setUpdatedAt(updatedAtProp);
      return;
    }
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/proxy/status", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (alive && j?.updatedAt != null) setUpdatedAt(j.updatedAt);
      } catch {
        /* leave last-known; the age will climb and flip to STALE on its own */
      }
    };
    pull();
    const id = setInterval(pull, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [updatedAtProp, pollMs]);

  const age = ageMs(updatedAt);
  const level = levelFor(age);
  const s = STYLE[level];

  return (
    <span
      role="status"
      aria-live="polite"
      title={updatedAt ? `Feed last updated ${fmtAge(age)}` : "No feed data"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.3,
        color: s.text,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: s.dot,
          boxShadow: level === "live" ? `0 0 6px ${s.dot}` : "none",
        }}
      />
      {s.label(fmtAge(age))}
    </span>
  );
}
