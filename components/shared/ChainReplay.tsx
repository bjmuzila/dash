// ─────────────────────────────────────────────────────────────────────────────
// ChainReplay — recorded per-strike net-GEX replay.
//
// Plays back the recorded per-strike net-GEX profile for any recorded ticker,
// frame-by-frame across the session, off the `strike_growth` table
// (/proxy/strike-growth/frames). Used two ways:
//   • embedded  → inline body (the /replay page wraps it in PageShell + Card)
//   • modal     → pass onClose to get a full-screen overlay (Options Chain "Replay")
//
// Data window = strike_growth retention (~5 trading days). Per-frame coverage =
// front active expiry, ±STRIKE_GROWTH_STRIKES_SIDE strikes, RTH.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HOME_THEME, homeInputStyle, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { TickerListDropdown } from "@/components/shared/TickerListDropdown";

type Strike = { strike: number; net: number };
type Frame = { ts: string; spot: number; strikes: Strike[] };

const POS = HOME_THEME.green; // #8ECAE6 — positive net GEX
const NEG = HOME_THEME.red;   // #EF4444 — negative net GEX
const SUB = "rgba(255,255,255,0.55)";

const SPEEDS = [0.5, 1, 2, 4, 8];
const BASE_MS = 700; // frame interval at 1×

function fmtClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch { return iso; }
}

function fmtGex(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

export function ChainReplay({
  symbol: initialSymbol,
  onClose,
  embedded = false,
}: {
  symbol?: string;
  onClose?: () => void;
  embedded?: boolean;
}) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState<string>((initialSymbol || "").toUpperCase());
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState<string>("");
  const [frames, setFrames] = useState<Frame[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [scaleMode, setScaleMode] = useState<"frame" | "day">("frame");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  const [mounted, setMounted] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => setMounted(true), []);

  // Symbol list once.
  useEffect(() => {
    fetch("/proxy/strike-growth/replay-meta", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) return;
        const syms: string[] = j.symbols || [];
        setSymbols(syms);
        setSymbol((cur) => cur || (syms.includes("MSFT") ? "MSFT" : syms[0] || ""));
      })
      .catch(() => setErr("Could not load recorded symbols."));
  }, []);

  // Dates for symbol.
  useEffect(() => {
    if (!symbol) return;
    fetch(`/proxy/strike-growth/replay-meta?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) return;
        const ds: string[] = j.dates || [];
        setDates(ds);
        setDate(ds[0] || "");
      })
      .catch(() => setErr("Could not load recorded dates."));
  }, [symbol]);

  // Frames for symbol+date.
  useEffect(() => {
    if (!symbol || !date) return;
    setLoading(true); setErr(""); setPlaying(false);
    fetch(`/proxy/strike-growth/frames?symbol=${encodeURIComponent(symbol)}&date=${encodeURIComponent(date)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) { setErr(j?.error || "No data."); setFrames([]); return; }
        setFrames(j.frames || []); setIdx(0);
      })
      .catch(() => { setErr("Could not load frames."); setFrames([]); })
      .finally(() => setLoading(false));
  }, [symbol, date]);

  // Play loop.
  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (!playing || frames.length === 0) return;
    timer.current = setInterval(() => {
      setIdx((i) => { if (i >= frames.length - 1) { setPlaying(false); return i; } return i + 1; });
    }, BASE_MS / speed);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, speed, frames.length]);

  // Esc closes the modal.
  useEffect(() => {
    if (!onClose) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const frame = frames[idx];

  const maxAbs = useMemo(() => {
    let m = 0;
    for (const f of frames) for (const s of f.strikes) m = Math.max(m, Math.abs(s.net));
    return m || 1;
  }, [frames]);

  const allStrikes = useMemo(() => {
    const set = new Set<number>();
    for (const f of frames) for (const s of f.strikes) set.add(s.strike);
    return Array.from(set).sort((a, b) => b - a);
  }, [frames]);

  const netByStrike = useMemo(() => {
    const m = new Map<number, number>();
    if (frame) for (const s of frame.strikes) m.set(s.strike, s.net);
    return m;
  }, [frame]);

  // Largest |net| in the CURRENT frame — used when scaling per-frame so the
  // biggest bar of every snapshot fills the row, even early in the day when the
  // session-wide peak (usually EOD) would otherwise squash it to a sliver.
  const frameMax = useMemo(() => {
    let m = 0;
    if (frame) for (const s of frame.strikes) m = Math.max(m, Math.abs(s.net));
    return m;
  }, [frame]);

  // "day" = fixed session-wide scale (magnitudes comparable across time).
  // "frame" = rescale each snapshot to its own max (bars always readable).
  const denom = (scaleMode === "day" ? maxAbs : frameMax) || 1;

  const spot = frame?.spot || 0;
  const selStyle: React.CSSProperties = { ...homeInputStyle, padding: "6px 10px", cursor: "pointer" };

  const body = (
    <>
      {/* Controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: HOME_THEME.cyan, letterSpacing: "0.06em", fontFamily: "var(--font-mono)", minWidth: 46 }}>
          {symbol || "—"}
        </span>
        <TickerListDropdown activeTicker={symbol} onSelect={setSymbol} universe={symbols} />
        <select value={date} style={selStyle} onChange={(e) => setDate(e.target.value)}>
          {dates.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <button
          style={{
            ...homeInputStyle, padding: "6px 16px", cursor: "pointer", minWidth: 74,
            background: playing ? "rgba(239,68,68,0.15)" : "rgba(125,211,252,0.15)",
            borderColor: playing ? NEG : LIGHT_BLUE, color: HOME_THEME.text, fontWeight: 600,
          }}
          disabled={!frames.length}
          onClick={() => { if (idx >= frames.length - 1) setIdx(0); setPlaying((p) => !p); }}
        >
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: SUB }}>Speed</span>
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              onClick={() => setSpeed(sp)}
              style={{
                ...homeInputStyle, padding: "4px 8px", cursor: "pointer", fontSize: 12,
                borderColor: speed === sp ? LIGHT_BLUE : HOME_THEME.border,
                color: speed === sp ? LIGHT_BLUE : SUB,
              }}
            >
              {sp}×
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: SUB }}>Scale</span>
          {(["frame", "day"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setScaleMode(m)}
              title={m === "frame" ? "Rescale each snapshot to its own peak — bars always readable" : "Fixed session-wide scale — magnitudes comparable across time"}
              style={{
                ...homeInputStyle, padding: "4px 8px", cursor: "pointer", fontSize: 12,
                textTransform: "capitalize",
                borderColor: scaleMode === m ? LIGHT_BLUE : HOME_THEME.border,
                color: scaleMode === m ? LIGHT_BLUE : SUB,
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Scrubber */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <input
          type="range" min={0} max={Math.max(0, frames.length - 1)} value={idx}
          disabled={!frames.length}
          onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
          style={{ flex: 1, accentColor: LIGHT_BLUE }}
        />
        <div style={{ fontVariantNumeric: "tabular-nums", minWidth: 150, textAlign: "right", fontSize: 14, color: HOME_THEME.text }}>
          {frame ? (<><strong>{fmtClock(frame.ts)}</strong> ET<span style={{ color: SUB }}> · spot {spot.toFixed(2)}</span></>) : "—"}
        </div>
      </div>
      <div style={{ fontSize: 12, color: SUB, marginBottom: 14 }}>
        {frames.length ? `Frame ${idx + 1} / ${frames.length}` : ""}
      </div>

      {/* Body */}
      {loading && <div style={{ padding: 40, textAlign: "center", color: SUB }}>Loading…</div>}
      {!loading && err && <div style={{ padding: 24, textAlign: "center", color: NEG }}>{err}</div>}
      {!loading && !err && !frames.length && (
        <div style={{ padding: 40, textAlign: "center", color: SUB }}>
          No recorded frames for {symbol} on {date || "this date"}.
        </div>
      )}

      {!loading && !err && frame && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {allStrikes.map((k, i) => {
            const net = netByStrike.get(k) ?? 0;
            const pct = Math.min(100, (Math.abs(net) / denom) * 100);
            const positive = net >= 0;
            const prev = allStrikes[i - 1];
            const showSpot = spot > 0 && ((prev === undefined && spot > k) || (prev !== undefined && spot < prev && spot >= k));
            return (
              <div key={k}>
                {showSpot && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0" }}>
                    <div style={{ width: 56 }} />
                    <div style={{ flex: 1, height: 0, borderTop: `1px dashed ${HOME_THEME.text}`, position: "relative" }}>
                      <span style={{ position: "absolute", right: 0, top: -8, fontSize: 10, color: HOME_THEME.text, background: HOME_THEME.panel, padding: "0 4px" }}>
                        spot {spot.toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 56, textAlign: "right", fontSize: 12, color: HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>{k}</div>
                  <div style={{ flex: 1, display: "flex", alignItems: "center", height: 16 }}>
                    <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                      {!positive && <div style={{ width: `${pct}%`, height: 12, background: NEG, borderRadius: "3px 0 0 3px", opacity: 0.9 }} />}
                    </div>
                    <div style={{ width: 1, height: 16, background: HOME_THEME.border }} />
                    <div style={{ flex: 1, display: "flex", justifyContent: "flex-start" }}>
                      {positive && <div style={{ width: `${pct}%`, height: 12, background: POS, borderRadius: "0 3px 3px 0", opacity: 0.9 }} />}
                    </div>
                  </div>
                  <div style={{ width: 68, textAlign: "left", fontSize: 11, color: positive ? POS : NEG, fontVariantNumeric: "tabular-nums" }}>{fmtGex(net)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 11, color: SUB, lineHeight: 1.5 }}>
        Net GEX = OI + volume (gex_now + gex_open), front active expiry, ±14 strikes.
        Green = positive, red = negative. Scale <strong>Frame</strong> = each
        snapshot scaled to its own peak (bars stay readable all day);{" "}
        <strong>Day</strong> = fixed session-wide scale (magnitudes comparable
        across time). History window ≈ 5 trading days.
      </div>
    </>
  );

  if (embedded || !onClose) return <div>{body}</div>;

  // Modal overlay.
  if (!mounted) return null;
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.72)", display: "flex",
        alignItems: "flex-start", justifyContent: "center",
        padding: "40px 16px", overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(760px, 100%)", background: HOME_THEME.panel,
          border: `1px solid ${HOME_THEME.border}`, borderRadius: 14,
          padding: "18px 20px 20px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: HOME_THEME.text, letterSpacing: "0.02em" }}>Option Chain Replay</div>
            <div style={{ fontSize: 12, color: SUB }}>Play back the recorded per-strike net-GEX profile through the session.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/cb-edge-logo.png" alt="CB Edge" style={{ height: 26, width: "auto", display: "block" }} />
            <button
              onClick={onClose}
              style={{
                ...homeInputStyle, width: 34, height: 34, padding: 0, cursor: "pointer",
                fontSize: 18, lineHeight: 1, color: HOME_THEME.text, display: "flex",
                alignItems: "center", justifyContent: "center",
              }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
        {body}
        <div style={{ textAlign: "right", marginTop: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: SUB }}>
          cbedge.net
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ChainReplay;
