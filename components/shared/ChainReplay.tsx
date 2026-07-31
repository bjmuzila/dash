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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HOME_THEME, homeInputStyle, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { TickerListDropdown } from "@/components/shared/TickerListDropdown";

type Strike = { strike: number; net: number };
type Frame = {
  ts: string;
  spot: number;
  strikes: Strike[];
  /** Front active expiry covered by this snapshot (YYYY-MM-DD); can roll intraday. */
  expiry?: string | null;
  /** How many distinct expiries were summed into this frame's net. */
  expiryCount?: number;
};

const POS = HOME_THEME.green; // #8ECAE6 — positive net GEX
const NEG = HOME_THEME.red;   // #EF4444 — negative net GEX
const SUB = "rgba(255,255,255,0.55)";

const SPEEDS = [0.5, 1, 2, 4, 8];
const BASE_MS = 700; // frame interval at 1×

/** Brand mark stamped into the chart so screen-grabs/recordings carry attribution. */
const LOGO_SRC = "/cb-edge-logo.png";

function fmtClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch { return iso; }
}

/** Frame clock down to the second — the stamp is what a screenshot is read off. */
function fmtStampClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  } catch { return iso; }
}

/** "2026-07-31" → "Fri Jul 31". Parsed as noon UTC so no TZ off-by-one day. */
function fmtStampDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || "");
  if (!m) return ymd || "";
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

/** "2026-07-31" → "Jul 31" for the compact expiry chip. */
function fmtExpiry(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || "");
  if (!m) return ymd || "";
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
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
  // Distinct expiries recorded for symbol+date — the fallback label when an
  // individual frame carries no expiry (older server build, pre-`expiry` field).
  const [expiries, setExpiries] = useState<string[]>([]);
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
        if (!j?.ok) { setErr(j?.error || "No data."); setFrames([]); setExpiries([]); return; }
        setFrames(j.frames || []); setExpiries(j.expiries || []); setIdx(0);
      })
      .catch(() => { setErr("Could not load frames."); setFrames([]); setExpiries([]); })
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

  // Smoothly glide the displayed spot (and its line) toward the recorded
  // frame's spot instead of snapping — recorded frames land every N events,
  // so a hard jump every 6-8 events read as choppy. Tween over the same
  // window as one playback tick (capped so scrubbing still feels responsive).
  const animSpot = useRef(0);
  const animSpotInit = useRef(false);
  const [, forceTick] = useState(0);
  useEffect(() => {
    const target = frame?.spot || 0;
    if (!animSpotInit.current) { animSpot.current = target; animSpotInit.current = true; forceTick((x) => x + 1); return; }
    const start = animSpot.current;
    if (start === target) return;
    // Scrubbing (or any non-playback idx change) should snap instantly —
    // animating here would restart a fresh tween on every intermediate
    // frame while dragging, stacking overlapping tweens that overshoot and
    // make the value bounce around instead of tracking the handle.
    if (!playing) { animSpot.current = target; forceTick((x) => x + 1); return; }
    const duration = Math.min(BASE_MS / speed, 450);
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const ease = 1 - Math.pow(1 - t, 2); // ease-out
      animSpot.current = start + (target - start) * ease;
      forceTick((x) => x + 1);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame?.ts, frame?.spot, playing]);

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

  const spot = animSpot.current;

  // Stamp metadata. Prefer the frame's own front expiry (it can roll intraday as
  // a new front contract takes over), and fall back to the day's first recorded
  // expiry so the stamp still labels correctly against an older server build
  // that doesn't send per-frame `expiry`.
  const frameExpiry = frame?.expiry || expiries[0] || "";
  const extraExpiries = Math.max(0, (frame?.expiryCount ?? expiries.length) - 1);
  const isZeroDte = !!frameExpiry && frameExpiry === date;

  // Continuous vertical position of the spot line among the rendered strike
  // rows (interpolated between the two bracketing strikes), so the line and
  // label glide smoothly instead of hopping row-to-row. Measured directly
  // off the actual row DOM nodes — a guessed pixel-per-row constant drifts
  // further off the further it is from the top of the list (compounding
  // rounding error), which is why the line used to land on the wrong strike.
  const rowsContainerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [spotTop, setSpotTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const container = rowsContainerRef.current;
    if (!allStrikes.length || spot <= 0 || !container) { setSpotTop(null); return; }
    let i = 0;
    while (i < allStrikes.length && allStrikes[i] > spot) i++;
    const containerTop = container.getBoundingClientRect().top;
    const midOf = (idx: number) => {
      const el = rowRefs.current[idx];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.top - containerTop + r.height / 2;
    };
    if (i === 0) {
      const m = midOf(0);
      setSpotTop(m === null ? null : m - 19);
      return;
    }
    if (i >= allStrikes.length) {
      const m = midOf(allStrikes.length - 1);
      setSpotTop(m === null ? null : m + 19);
      return;
    }
    const hiMid = midOf(i - 1);
    const loMid = midOf(i);
    if (hiMid === null || loMid === null) { setSpotTop(null); return; }
    const hi = allStrikes[i - 1], lo = allStrikes[i];
    const frac = hi === lo ? 0 : (hi - spot) / (hi - lo);
    setSpotTop(hiMid + frac * (loMid - hiMid));
  }, [allStrikes, spot]);

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
        <div ref={rowsContainerRef} style={{ position: "relative" }}>
          {/* ── Provenance stamp (top-left) ───────────────────────────────────
              Ticker + expiry + the frame's own wall clock, burned into the
              ladder itself so a screen-grab or screen-recording of the replay
              carries what it is and when, with no surrounding chrome needed.
              pointerEvents:none — must never intercept a scrub/click. Frosted
              chip so it stays legible if a bar runs under it. */}
          <div
            style={{
              position: "absolute", left: 64, top: 0, zIndex: 3, pointerEvents: "none",
              display: "flex", flexDirection: "column", gap: 3,
              padding: "6px 10px", borderRadius: 8,
              background: "rgba(5,6,10,0.62)",
              border: `1px solid ${HOME_THEME.border}`,
              backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", color: HOME_THEME.cyan, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                {symbol || "—"}
              </span>
              {frameExpiry && (
                <span
                  style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", lineHeight: 1,
                    padding: "3px 6px", borderRadius: 4,
                    color: isZeroDte ? HOME_THEME.orange : LIGHT_BLUE,
                    border: `1px solid ${isZeroDte ? "rgba(251,133,1,0.45)" : "rgba(125,211,252,0.35)"}`,
                    background: isZeroDte ? "rgba(251,133,1,0.10)" : "rgba(125,211,252,0.10)",
                  }}
                >
                  {isZeroDte ? "0DTE" : `EXP ${fmtExpiry(frameExpiry)}`}
                </span>
              )}
              {extraExpiries > 0 && (
                <span
                  title={`Net summed across ${extraExpiries + 1} expiries`}
                  style={{ fontSize: 10, fontWeight: 700, color: SUB, lineHeight: 1 }}
                >
                  +{extraExpiries}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: SUB, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
              {date ? fmtStampDate(date) : ""}
              {frame ? `${date ? " · " : ""}${fmtStampClock(frame.ts)} ET` : ""}
            </div>
          </div>

          {/* ── Brand mark (bottom-right) ─────────────────────────────────────
              Same reason as the stamp: the ladder travels as an image, so the
              attribution has to live inside it. */}
          <div
            style={{
              position: "absolute", right: 0, bottom: 0, zIndex: 3,
              pointerEvents: "none", opacity: 0.92,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={LOGO_SRC}
              alt="CB Edge"
              style={{ height: 30, width: "auto", display: "block", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.8))" }}
            />
          </div>

          {spotTop !== null && (
            <div
              style={{
                position: "absolute", left: 64, right: 0, top: spotTop,
                height: 0, borderTop: `1px dashed ${HOME_THEME.text}`,
                pointerEvents: "none", zIndex: 1,
                transition: "top 90ms linear",
              }}
            >
              <span style={{ position: "absolute", right: 0, top: -8, fontSize: 10, color: HOME_THEME.text, background: HOME_THEME.panel, padding: "0 4px" }}>
                spot {spot.toFixed(2)}
              </span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {allStrikes.map((k, i) => {
              const net = netByStrike.get(k) ?? 0;
              const pct = Math.min(100, (Math.abs(net) / denom) * 100);
              const positive = net >= 0;
              return (
                <div key={k} ref={(el) => { rowRefs.current[i] = el; }} style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
              );
            })}
          </div>
        </div>
      )}
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
            <img src={LOGO_SRC} alt="CB Edge" style={{ height: 26, width: "auto", display: "block" }} />
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
        {/* No trailing logo here — the mark now lives inside the ladder itself
            (bottom-right), so it survives a crop of just the chart. */}
        {body}
      </div>
    </div>,
    document.body,
  );
}

export default ChainReplay;
