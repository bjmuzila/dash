"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { V3, V3_MONO, V3_RADIUS, V3_TEXT, v3CardStyle, v3Chip } from "@/components/landing/v3Theme";

// ─────────────────────────────────────────────────────────────────────────────
// The free live level tile.
//
// This is the whole argument of the landing page in one component: a cold
// visitor sees REAL levels — Core, the flip and both walls — computed off the
// live chain, before there is an account, a card or an email.
//
// Rules this component exists to enforce:
//
//   1. NEVER render a partial tile. If /api/public-levels can't give us the
//      headline level, the panel drops to a quiet "resumes next session" state
//      rather than printing three of four numbers. A page whose pitch is "these
//      are real" cannot show a level with a dash next to it.
//   2. NEVER widen it. The endpoint deliberately serves SPX / front expiry /
//      four scalars — no ladder, no rate of change, no history. Those are the
//      product. If a future version of this panel wants a strike ladder, that is
//      a decision about the free tier, not a UI tweak: change the route first
//      and read its header comment before you do.
//   3. The refresh cadence here (15s) matches the server cache TTL exactly. A
//      faster poll buys nothing but load; a slower one makes the "15s" label a
//      lie.
//   4. THE HEADLINE IS **CORE**, not the gamma flip (Brandon, 2026-09-05). Core
//      is the largest |net GEX| strike on the board — the magnet, the level the
//      rest of the app leads with, and the one a visitor who has never heard of
//      dealer gamma can act on without a second concept. The flip is still on
//      the tile, one row down with the walls, because the page's own copy is
//      about it; it is simply no longer the number in 48px type.
//      The API field is still `coreBullseye` — renaming a wire field to move a
//      label is how a public endpoint breaks for no reason.
//
// ── 2026-09-05: "it isn't updating", and the stamp said a time that looked live
//
// Three things were true at once and each one on its own is enough to make a
// visitor call this panel dead:
//
//   a. THE STAMP SHOWED ONLY A CLOCK. `as of 14:32 ET` on a Saturday reads as
//      "updated a minute ago" whichever session the numbers are actually from.
//      It now prints the DATE with the time, so a weekend, a holiday or a feed
//      that stopped mid-session is legible at a glance instead of looking like
//      live data that happens to be wrong.
//   b. A BACKGROUND TAB FREEZES THE POLL. `setInterval` is throttled hard in a
//      hidden tab, so a page left open and come back to shows whatever it had
//      when it was last visible — for as long as the browser feels like it,
//      not 15s. There is now a `visibilitychange` + `focus` listener that pulls
//      immediately on the way back, which is the moment somebody is actually
//      looking.
//   c. THE RESPONSE IS `Cache-Control: public, max-age=15`. `cache: "no-store"`
//      covers the browser's own HTTP cache and nothing in front of it; an
//      edge/CDN layer in front of the origin can and will hand every visitor
//      the same 15s-old body for longer than that. The URL now carries a
//      cache-buster, which no intermediary can collapse.
//
// And the panel now says when it is STALE rather than showing a live-green
// "15s" over frozen numbers — see FRESH_MS.
// ─────────────────────────────────────────────────────────────────────────────

const POLL_MS = 15_000;

/**
 * How old the server's `asOf` may get before the tile stops claiming to be
 * live. Four poll windows: one missed request is a blip, four in a row is a
 * feed that has stopped. The chip flips to STALE and the stamp is the only
 * thing that stays interesting.
 */
const FRESH_MS = 4 * POLL_MS;

interface PublicLevels {
  ok: boolean;
  ticker: string;
  spot: number | null;
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;
  coreBullseye: number | null;
  netGexB: number | null;
  regime: "positive" | "negative" | null;
  asOf: number;
}

const fmt = (v: number | null, digits = 0) =>
  v == null ? null : v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * DATE **and** time, in ET. The date is not decoration — it is the only thing
 * on the tile that can tell a visitor these numbers are from Friday. See note
 * (a) in the header.
 */
function etStamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

export default function LiveLevelPanel() {
  const [d, setD] = useState<PublicLevels | null>(null);
  // false = first load still in flight; true = we asked and have an answer.
  const [ready, setReady] = useState(false);
  // Re-renders on the poll tick so the STALE check below is evaluated against
  // wall-clock now, not against whenever the last successful body arrived.
  const [now, setNow] = useState(() => Date.now());
  const live = useRef(true);

  const pull = useCallback(async () => {
    try {
      // Cache-buster: see note (c). The route's own 15s module cache is what
      // actually protects /proxy/gex, so this costs the origin nothing.
      const r = await fetch(`/api/public-levels?t=${Date.now()}`, { cache: "no-store" });
      const j = r.ok ? ((await r.json()) as PublicLevels) : null;
      if (!live.current) return;
      setD(j);
      setReady(true);
      setNow(Date.now());
    } catch {
      if (!live.current) return;
      setD(null);
      setReady(true);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void pull();
    const t = setInterval(() => { void pull(); }, POLL_MS);

    // A hidden tab throttles the interval to a crawl — note (b). Pull the
    // moment the page is looked at again rather than up to a minute later.
    const wake = () => {
      if (document.visibilityState === "visible") void pull();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);

    return () => {
      live.current = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [pull]);

  // Core is the headline. Without it there is no panel — see rules 1 and 4.
  const hasCore = !!d?.ok && d.coreBullseye != null;
  // Distance is measured to the HEADLINE level, so it moves with rule 4.
  const spotVsCore = d?.spot != null && d?.coreBullseye != null ? d.spot - d.coreBullseye : null;
  const fresh = hasCore && now - Number(d!.asOf) <= FRESH_MS;
  const stamp = hasCore ? etStamp(Number(d!.asOf)) : "";

  return (
    <div style={wrap} className="live-level">
      <div style={head}>
        <span style={topLabel}>SPX · Core</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={v3Chip(V3.up)}>FREE · NO ACCOUNT</span>
          <span style={fresh ? liveDot : staleTag}>
            {fresh && <i style={dot} />}
            {hasCore ? (fresh ? "15s" : "STALE") : "IDLE"}
          </span>
        </span>
      </div>

      <div style={body}>
        {hasCore ? (
          <>
            {/* Core, in 48px type. See rule 4. "Core", not "Core Bullseye" —
                the rails, the Multi Greek badges and the Key Levels tiles all
                say Core, and this was the last surface using the long name. */}
            <div style={bigNo}>{fmt(d!.coreBullseye)}</div>
            <div style={bigNoSub}>
              {d!.spot != null ? (
                <>
                  Spot <b style={{ fontFamily: V3_MONO, color: V3.fg, fontWeight: 700 }}>{fmt(d!.spot)}</b>
                  {spotVsCore != null && (
                    <>
                      {" · "}
                      <span style={{ color: spotVsCore >= 0 ? V3.up : V3.down, fontWeight: 700 }}>
                        {spotVsCore >= 0 ? "+" : "−"}{fmt(Math.abs(spotVsCore))} {spotVsCore >= 0 ? "above" : "below"} Core
                      </span>
                    </>
                  )}
                  {d!.regime && ` · ${d!.regime} gamma regime`}
                </>
              ) : (
                "Front expiry, open interest + volume"
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              {/* The flip drops to a row. It is still the level the page's copy
                  is about, so it leads the list. */}
              <LevelRow label="Gamma flip" value={fmt(d!.gammaFlip)} color={V3.violet} />
              <LevelRow label="Call wall" value={fmt(d!.callWall)} color={V3.levelCw} />
              <LevelRow label="Put wall" value={fmt(d!.putWall)} color={V3.levelPw} />
              {d!.netGexB != null && (
                <LevelRow
                  label="Net GEX"
                  value={`${d!.netGexB >= 0 ? "+" : "−"}${Math.abs(d!.netGexB).toFixed(2)}B`}
                  color={V3.fg}
                />
              )}
            </div>

            <div style={stampRow}>
              <span>Front expiry · open interest + volume</span>
              {/* DATE and time. The whole point of note (a). */}
              <span style={{ fontFamily: V3_MONO, color: fresh ? V3.fg : V3.warn }}>
                {stamp ? `${stamp} ET` : "—"}
              </span>
            </div>
          </>
        ) : (
          // Honest empty state. Weekends, holidays and any feed interruption
          // land here. It says WHEN it comes back rather than pretending to be
          // loading forever, and it never shows a number it doesn't have.
          <div style={idleBox}>
            <div style={idleTitle}>{ready ? "Levels resume at the next session" : "Loading live levels…"}</div>
            <div style={idleBody}>
              {ready
                ? "The SPX chain is only live during market hours. This tile fills itself the moment the session opens — no account needed then either."
                : "Reading the live SPX chain."}
            </div>
          </div>
        )}

        <div style={locked}>
          <span aria-hidden style={{ color: V3.cyan, fontSize: V3_TEXT.base, lineHeight: 1 }}>🔒</span>
          <span style={lockedText}>
            <b style={{ color: V3.fg, fontWeight: 700 }}>Rate of change, strike history, flow and alerts</b>
            {" — inside the trial. This panel stays free either way."}
          </span>
        </div>
      </div>
    </div>
  );
}

function LevelRow({ label, value, color }: { label: string; value: string | null; color: string }) {
  // A level we don't have is omitted, not dashed — same rule as the panel.
  if (value == null) return null;
  return (
    <div style={levelRow}>
      <span style={levelKey}>
        <span style={{ ...swatch, background: color }} aria-hidden />
        {label}
      </span>
      <span style={{ ...levelVal, color }}>{value}</span>
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */
/* v3 surfaces only — see components/landing/v3Theme.ts. No blur, no glow, no
   text opacity: every string on this tile is #ffffff or a level colour. */

const wrap: React.CSSProperties = {
  ...v3CardStyle,
  overflow: "hidden",
};

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
  padding: "10px 14px",
  borderBottom: `1px solid ${V3.line}`,
  background: V3.surface2,
};

const body: React.CSSProperties = { padding: 16 };

const topLabel: React.CSSProperties = {
  fontFamily: V3_MONO,
  fontSize: V3_TEXT.xs,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: V3.fg,
};

const liveDot: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  fontFamily: V3_MONO,
  fontSize: V3_TEXT.xs,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: V3.refresh,
};

const staleTag: React.CSSProperties = { ...liveDot, color: V3.warn };

const dot: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: V3.refresh,
  display: "inline-block",
};

const bigNo: React.CSSProperties = {
  fontFamily: V3_MONO,
  fontSize: "clamp(32px, 4.6vw, 48px)",
  fontWeight: 700,
  letterSpacing: "-0.03em",
  lineHeight: 1,
  // The headline takes CORE's own colour (--color-level-cb), the same yellow
  // the rails and the Multi Greek badges tag that strike with.
  color: V3.levelCb,
};

const bigNoSub: React.CSSProperties = {
  fontSize: V3_TEXT.base,
  color: V3.fg,
  marginTop: 8,
  lineHeight: 1.5,
};

const levelRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  padding: "9px 0",
  borderBottom: `1px solid ${V3.line}`,
  fontSize: V3_TEXT.base,
};

const levelKey: React.CSSProperties = {
  color: V3.fg,
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const swatch: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: V3_RADIUS.sm / 2,
  display: "inline-block",
  flexShrink: 0,
};

const levelVal: React.CSSProperties = { fontFamily: V3_MONO, fontWeight: 700, fontSize: V3_TEXT.body };

const stampRow: React.CSSProperties = {
  marginTop: 12,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: 10,
  flexWrap: "wrap",
  fontSize: V3_TEXT.xs,
  color: V3.fg,
  letterSpacing: "0.04em",
};

const idleBox: React.CSSProperties = { padding: "18px 0 14px" };

const idleTitle: React.CSSProperties = {
  fontSize: V3_TEXT.lg,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  marginBottom: 8,
  color: V3.fg,
};

const idleBody: React.CSSProperties = {
  fontSize: V3_TEXT.base,
  color: V3.fg,
  lineHeight: 1.55,
  maxWidth: "42ch",
};

const locked: React.CSSProperties = {
  marginTop: 14,
  padding: "11px 12px",
  borderRadius: V3_RADIUS.sm,
  border: `1px solid ${V3.line}`,
  background: V3.surface2,
  display: "flex",
  alignItems: "center",
  gap: 11,
};

const lockedText: React.CSSProperties = {
  fontSize: V3_TEXT.base,
  color: V3.fg,
  lineHeight: 1.5,
};
