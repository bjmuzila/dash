"use client";

import { useEffect, useState } from "react";
import { HOME_THEME as T, LEVEL_COLORS, REFRESH_GREEN } from "@/components/shared/homeTheme";

// ─────────────────────────────────────────────────────────────────────────────
// The free live level tile.
//
// This is the whole argument of the new landing page in one component: a cold
// visitor sees a REAL gamma flip, computed off the live chain, before there is
// an account, a card or an email. The old fold sold the brand (a 210px logo and
// a sentence every GEX competitor also writes); this sells the thing itself.
//
// Rules this component exists to enforce:
//
//   1. NEVER render a partial tile. If /api/public-levels can't give us a flip,
//      the panel drops to a quiet "resumes next session" state rather than
//      printing three of four numbers. A page whose pitch is "these are real"
//      cannot show a level with a dash next to it.
//   2. NEVER widen it. The endpoint deliberately serves SPX / front expiry /
//      four scalars — no ladder, no rate of change, no history. Those are the
//      product. If a future version of this panel wants a strike ladder, that is
//      a decision about the free tier, not a UI tweak: change the route first
//      and read its header comment before you do.
//   3. The refresh cadence here (15s) matches the server cache TTL exactly. A
//      faster poll buys nothing but load; a slower one makes the "15s" label a
//      lie.
// ─────────────────────────────────────────────────────────────────────────────

const POLL_MS = 15_000;

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

function etClock(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch { return ""; }
}

export default function LiveLevelPanel() {
  const [d, setD] = useState<PublicLevels | null>(null);
  // null = first load in flight, false = we asked and there is nothing to show.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    const pull = async () => {
      try {
        const r = await fetch("/api/public-levels", { cache: "no-store" });
        const j = r.ok ? ((await r.json()) as PublicLevels) : null;
        if (live) { setD(j); setReady(true); }
      } catch {
        if (live) { setD(null); setReady(true); }
      }
    };
    void pull();
    const t = setInterval(() => { void pull(); }, POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, []);

  // The flip is the headline. Without it there is no panel — see rule 1.
  const hasFlip = !!d?.ok && d.gammaFlip != null;
  const spotAbove = d?.spot != null && d?.gammaFlip != null ? d.spot - d.gammaFlip : null;

  return (
    <div style={wrap} className="live-level">
      <span style={freeTag}>FREE · NO ACCOUNT</span>

      <div style={topRow}>
        <span style={topLabel}>SPX · Gamma Flip</span>
        <span style={liveDot}>
          <i style={dot} />
          {hasFlip ? "15s" : "IDLE"}
        </span>
      </div>

      {hasFlip ? (
        <>
          <div style={bigNo}>{fmt(d!.gammaFlip)}</div>
          <div style={bigNoSub}>
            {d!.spot != null ? (
              <>
                Spot <b style={{ fontFamily: MONO, color: T.text, fontWeight: 700 }}>{fmt(d!.spot)}</b>
                {spotAbove != null && (
                  <>
                    {" · "}
                    <span style={{ color: spotAbove >= 0 ? GREEN : T.red, fontWeight: 700 }}>
                      {spotAbove >= 0 ? "+" : "−"}{fmt(Math.abs(spotAbove))} {spotAbove >= 0 ? "above" : "below"} flip
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
            <LevelRow label="Call wall" value={fmt(d!.callWall)} color={LEVEL_COLORS.cw} />
            <LevelRow label="Put wall" value={fmt(d!.putWall)} color={LEVEL_COLORS.pw} />
            <LevelRow label="Core bullseye" value={fmt(d!.coreBullseye)} color={LEVEL_COLORS.cb} />
            {d!.netGexB != null && (
              <LevelRow
                label="Net GEX"
                value={`${d!.netGexB >= 0 ? "+" : "−"}${Math.abs(d!.netGexB).toFixed(2)}B`}
                color="rgba(255,255,255,0.3)"
              />
            )}
          </div>

          <div style={stamp}>
            Front expiry · open interest + volume · as of {etClock(d!.asOf)} ET
          </div>
        </>
      ) : (
        // Honest empty state. Weekends, holidays and any feed interruption land
        // here. It says WHEN it comes back rather than pretending to be loading
        // forever, and it never shows a number it doesn't have.
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
        <span aria-hidden style={{ color: T.cyan, fontSize: 13, lineHeight: 1 }}>🔒</span>
        <span style={lockedText}>
          <b style={{ color: T.text, fontWeight: 700 }}>Rate of change, strike history, flow and alerts</b>
          {" — inside the trial. This panel stays free either way."}
        </span>
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

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
// The app's one "up / success" green, from the theme. HOME_THEME.green is a
// LIGHT BLUE (#8ECAE6) — the status palette's accent, not a green — so reaching
// for it here would print the wrong colour. See the REFRESH_GREEN comment in
// homeTheme.ts.
const GREEN = REFRESH_GREEN;

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
const cyanA = (a: number) => hexA(T.cyan, a);
const greenA = (a: number) => hexA(REFRESH_GREEN, a);

const wrap: React.CSSProperties = {
  position: "relative",
  background: "rgba(13,17,25,0.62)",
  border: `1px solid ${cyanA(0.26)}`,
  borderRadius: 18,
  padding: 20,
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  boxShadow: "0 30px 70px -25px rgba(0,0,0,0.85)",
};

const freeTag: React.CSSProperties = {
  position: "absolute",
  top: -11,
  right: 18,
  fontFamily: MONO,
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: "0.14em",
  padding: "4px 10px",
  borderRadius: 999,
  background: greenA(0.16),
  color: GREEN,
  border: `1px solid ${greenA(0.45)}`,
  whiteSpace: "nowrap",
};

const topRow: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16,
};

const topLabel: React.CSSProperties = {
  fontFamily: MONO, fontSize: 10, fontWeight: 800, letterSpacing: "0.14em",
  textTransform: "uppercase", color: T.muted, opacity: 0.55,
};

const liveDot: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 7, fontFamily: MONO,
  fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: GREEN,
};

const dot: React.CSSProperties = {
  width: 7, height: 7, borderRadius: "50%", background: GREEN,
  boxShadow: `0 0 10px ${GREEN}`, display: "inline-block",
};

const bigNo: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: "clamp(38px, 5vw, 54px)",
  fontWeight: 800,
  letterSpacing: "-0.03em",
  lineHeight: 1,
  color: T.cyan,
  textShadow: `0 0 34px ${cyanA(0.45)}`,
};

const bigNoSub: React.CSSProperties = {
  fontSize: 12, color: T.muted, opacity: 0.85, marginTop: 6, lineHeight: 1.45,
};

const levelRow: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "baseline",
  padding: "9px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 13,
};

const levelKey: React.CSSProperties = {
  color: T.muted, opacity: 0.85, display: "flex", alignItems: "center", gap: 8,
};

const swatch: React.CSSProperties = {
  width: 9, height: 9, borderRadius: 2, display: "inline-block", flexShrink: 0,
};

const levelVal: React.CSSProperties = { fontFamily: MONO, fontWeight: 700, fontSize: 14 };

const stamp: React.CSSProperties = {
  marginTop: 12, fontSize: 10, fontFamily: MONO, color: T.muted, opacity: 0.5, letterSpacing: "0.04em",
};

const idleBox: React.CSSProperties = {
  padding: "22px 4px 18px",
};

const idleTitle: React.CSSProperties = {
  fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 8,
};

const idleBody: React.CSSProperties = {
  fontSize: 12.5, color: T.muted, opacity: 0.8, lineHeight: 1.5, maxWidth: "42ch",
};

const locked: React.CSSProperties = {
  marginTop: 14,
  padding: "11px 13px",
  borderRadius: 10,
  border: `1px dashed ${cyanA(0.35)}`,
  background: cyanA(0.05),
  display: "flex",
  alignItems: "center",
  gap: 11,
};

const lockedText: React.CSSProperties = {
  fontSize: 11.5, color: T.muted, opacity: 0.9, lineHeight: 1.45,
};
