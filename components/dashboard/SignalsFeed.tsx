"use client";

import { useEffect, useRef, useState } from "react";
import { HOME_THEME as HT } from "@/components/shared/homeTheme";

/**
 * Horizontal signals feed shown above the /home option-chain · heatmap panel
 * (replaced the old NET GEX / CALL WALL / … stat box — those same levels still
 * live on the left "Levels strip" above the GEX chart).
 *
 * Reads plain-text signals the user authors in public/signals.txt (served at
 * /signals.txt). One signal per line. The NEWEST signal renders LEFTMOST and
 * each chip shows its timestamp. Polls every 15s so edits to the file appear
 * without a page reload.
 *
 * Line format (see public/signals.txt for the live template):
 *     9:32   Net GEX flipped positive — long bias
 *     9:41   Call wall 7400 → 7410
 *     10:05  SHORT CB 7380 rejected
 * - A leading time token (9:32, 9:32am, 09:32, or 2026-07-09 09:32) becomes the
 *   timestamp; the remainder of the line is the signal text. An optional "|" or
 *   "-" between the time and the text is stripped.
 * - Lines are ordered newest-time-first (leftmost). Lines without a parseable
 *   time keep their file order and trail the timed ones.
 * - Blank lines and lines starting with "#" are ignored (comments).
 * - Direction tint: text starting LONG/BUY/BULL → green, SHORT/SELL/BEAR → red,
 *   otherwise cyan.
 */

type Signal = { time: string; minutes: number | null; text: string; key: string };

// Optional leading date, required HH:MM, optional am/pm, optional "ET", optional
// "|" / dash separator before the signal text.
const TIME_RE = /^\s*(?:\d{4}-\d{2}-\d{2}[ T])?(\d{1,2}):(\d{2})\s*([ap]\.?m?\.?)?\s*(?:ET)?\s*(?:[|\-–—]\s*)?/i;

function parseLine(raw: string, idx: number): Signal | null {
  const line = raw.trim();
  if (!line || line.startsWith("#")) return null;

  const m = line.match(TIME_RE);
  let time = "";
  let minutes: number | null = null;
  let text = line;

  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ap = (m[3] || "").toLowerCase();
    if (ap.startsWith("p") && h < 12) h += 12;
    if (ap.startsWith("a") && h === 12) h = 0;
    minutes = h * 60 + min;
    time = `${m[1]}:${m[2]}${ap ? " " + ap.replace(/\./g, "").toUpperCase() : ""}`;
    text = line.slice(m[0].length).trim() || line;
  }

  return { time, minutes, text, key: `${idx}:${line}` };
}

function parseSignals(txt: string): Signal[] {
  const parsed = txt
    .split(/\r?\n/)
    .map(parseLine)
    .filter((x): x is Signal => x != null);
  // Newest time first (leftmost). Untimed lines keep order and trail timed ones.
  const timed = parsed.filter((s) => s.minutes != null).sort((a, b) => b.minutes! - a.minutes!);
  const untimed = parsed.filter((s) => s.minutes == null);
  return [...timed, ...untimed];
}

function tint(text: string): string {
  const t = text.trim().toUpperCase();
  if (t.startsWith("LONG") || t.startsWith("BUY") || t.startsWith("BULL")) return HT.green;
  if (t.startsWith("SHORT") || t.startsWith("SELL") || t.startsWith("BEAR")) return HT.red;
  return HT.cyan;
}

export default function SignalsFeed({
  src = "/signals.txt",
  pollMs = 15000,
}: { src?: string; pollMs?: number } = {}) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const missingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`${src}?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) {
          if (!cancelled) { missingRef.current = true; setLoaded(true); }
          return;
        }
        const txt = await r.text();
        if (cancelled) return;
        missingRef.current = false;
        setSignals(parseSignals(txt));
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    };
    load();
    const id = setInterval(load, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [src, pollMs]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        overflowX: "auto",
        overflowY: "hidden",
        whiteSpace: "nowrap",
        paddingLeft: 13,
        paddingBottom: 2,
        scrollbarWidth: "thin",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: HT.cyan,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
        Signals
      </span>
      <span style={{ flexShrink: 0, width: 1, height: 18, background: "rgba(255,255,255,0.12)" }} />

      {signals.length === 0 ? (
        <span style={{ fontSize: 12, color: "#5a7a98", fontWeight: 600 }}>
          {!loaded ? "Loading…" : missingRef.current ? "signals.txt not found" : "No signals yet"}
        </span>
      ) : (
        signals.map((s) => {
          const c = tint(s.text);
          return (
            <span
              key={s.key}
              title={s.text}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                flexShrink: 0,
                padding: "4px 11px",
                borderRadius: 999,
                background: "rgba(13,17,25,0.55)",
                border: `1px solid ${c}44`,
              }}
            >
              {s.time && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: "#8da8c2" }}>
                  {s.time}
                </span>
              )}
              <span style={{ fontSize: 12.5, fontWeight: 700, color: c }}>{s.text}</span>
            </span>
          );
        })
      )}
    </div>
  );
}
