"use client";

/**
 * LogicOrderPanel — the "Logic & Order" 4-step flow (Check the bias / Find the
 * CB Level / Watch key levels / Wait for confirmation), wired to live GEX +
 * WAVE data per ticker over the Far CB Watch roster.
 *
 * Extracted from app/logic-order/page.tsx so it can be embedded elsewhere
 * WITHOUT a second <PageShell> — app/logic-order/page.tsx wraps this in its
 * own PageShell for the standalone route; app/scanner/page.tsx renders it
 * directly inside its existing PageShell as the "Logic & Order" tab.
 */

import { useEffect, useMemo, useState } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { TickerListDropdown } from "@/components/shared/TickerListDropdown";
import {
  GexRegimeCard,
  useRegimeData,
  synthesize,
  fmtUsdShort,
} from "@/components/dashboard/GexRegimeCard";

// Mirrors server-v2/far-cb-tickers.js CORE_TICKERS — the "Far CB Watch"
// roster (your actual TradingView "In positions" set). Same mirror pattern
// TickerListDropdown.tsx already uses for the scanner universe: the curated
// list is edited server-side and copied here, since it's a static constant.
const FAR_CB_CORE_TICKERS = [
  // Indices / broad ETFs
  "SPX", "SPY", "QQQ", "NDX", "IWM", "RSP", "MAGS", "VIX", "TLT", "UVXY",
  // Mega-cap / mains
  "AAPL", "AMD", "AMZN", "GOOGL", "META", "MSFT", "NVDA", "SPCX", "TSLA",
  // Shares
  "AAPU", "ASTS", "AVGO", "BYND", "CMG", "COIN", "CWVX", "ETHA", "FBL", "FIG",
  "GME", "HIMZ", "HOOD", "IBIT", "LLYX", "MSFU", "NFLX", "NOK", "NVDX", "OSCR",
  "PLTR", "PONY", "QBTS", "QUBT", "RGTI", "RIVN", "SLV", "SMCI", "SOFI", "SOUN",
  "SOXL", "TQQQ", "TSLL", "UUUU",
  // Spreads
  "ABNB", "AFRM", "ARM", "BA", "BABA", "CCJ", "CHWY", "COST", "CRCL", "CRM",
  "CRWD", "CRWV", "DJT", "FDX", "GS", "HIMS", "INTC", "IREN", "LAC", "LLY",
  "MA", "MARA", "MCD", "MRK", "MRNA", "MU", "NIO", "NKE", "NNE", "NXE", "OKLO",
  "OPEN", "OXY", "PDD", "PFE", "PTON", "RBLX", "RIOT", "RKLB", "ROKU", "SE",
  "SMH", "SNDK", "SNOW", "TGT", "TSM", "TTD", "U", "UNH", "UPS", "UPST", "V",
  "XPEV", "XYZ",
];

/** Far CB Watch roster = CORE_TICKERS ∪ your customer-added tickers
 * (/api/far-cb-tickers, requires sign-in). Falls back to CORE alone when
 * signed out or the fetch fails. */
function useFarCbTickers(): string[] {
  const [custom, setCustom] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/far-cb-tickers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        const rows = Array.isArray(j?.rows) ? j.rows : [];
        const syms = rows.map((r: { symbol?: string }) => String(r.symbol || "").toUpperCase()).filter(Boolean);
        if (syms.length) setCustom(syms);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return useMemo(() => [...new Set([...FAR_CB_CORE_TICKERS, ...custom])], [custom]);
}

type Step = { n: number; title: string; body: string; live: string; liveTone?: string };

function StepCard({ step }: { step: Step }) {
  return (
    <div
      style={{
        flex: "1 1 220px",
        minWidth: 220,
        background: HOME_THEME.panelBg,
        backdropFilter: "blur(16px)",
        border: `1px solid ${HOME_THEME.border}`,
        borderRadius: 16,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: HOME_THEME.green,
          color: HOME_THEME.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 800,
        }}
      >
        {step.n}
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: HOME_THEME.text, lineHeight: 1.3 }}>
        {step.title}
      </div>
      <div style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.6 }}>
        {step.body}
      </div>
      <div
        style={{
          marginTop: "auto",
          paddingTop: 10,
          borderTop: `1px solid ${HOME_THEME.border}`,
          fontSize: 13,
          fontWeight: 700,
          color: step.liveTone ?? HOME_THEME.cyan,
          lineHeight: 1.5,
        }}
      >
        {step.live}
      </div>
    </div>
  );
}

export function LogicOrderPanel() {
  const roster = useFarCbTickers();
  const [ticker, setTicker] = useState(FAR_CB_CORE_TICKERS[0]);

  const { wave, gex, err, loadedAt } = useRegimeData(ticker);
  const cond = useMemo(() => synthesize(wave, gex, ticker), [wave, gex, ticker]);

  const steps: Step[] = [
    {
      n: 1,
      title: "Check the bias",
      body: "Net GEX (aggregate across the chain) vs. the gamma flip. Positive GEX above the flip leans bullish/stable — dealers dampen moves. Negative GEX below the flip leans bearish/volatile — moves accelerate. Near the flip is neutral.",
      live: gex
        ? `${gex.biasLabel} — net GEX ${fmtUsdShort(gex.totalGex)}, spot ${gex.spot.toFixed(2)}${gex.flip != null ? ` vs. flip ${gex.flip.toFixed(1)}` : " (no flip found)"}.`
        : "Loading chain…",
      liveTone: gex?.biasTone,
    },
    {
      n: 2,
      title: "Find the CB Level",
      body: "The CB Level (Core Bullseye) is the strongest pull on the map — the strike with the largest dealer gamma concentration, drawing price toward it like a magnet, especially near expiration.",
      live: gex?.cbLevel
        ? `CB Level: ${Math.round(gex.cbLevel.strike)} (${fmtUsdShort(gex.cbLevel.gex)}) — heaviest dealer hedging on the chain.`
        : "Loading chain…",
    },
    {
      n: 3,
      title: "Watch key levels",
      body: "Call Wall = top resistance (fade rallies / watch for a break). Put Wall = key support (expect a bounce or an accelerated break). In positive gamma, price ranges between the walls; in negative gamma, breaks accelerate.",
      live: gex
        ? `Call Wall ${gex.callWall ? Math.round(gex.callWall.strike) : "–"} · Put Wall ${gex.putWall ? Math.round(gex.putWall.strike) : "–"}. ${gex.totalGex > 0 ? "Positive gamma — expect range between the walls." : "Negative gamma — breaks can accelerate."}`
        : "Loading chain…",
    },
    {
      n: 4,
      title: "Wait for confirmation",
      body: "Confirm with price action at the CB level/flip/walls plus options flow — aggressive call or put buying, or price respecting/rejecting a level intraday. Don't fight the regime.",
      live: cond.stars > 0
        ? `${cond.label} · ${cond.stars}/5 — ${cond.bullets[0]}`
        : "Awaiting flow…",
      liveTone: cond.stars > 0 ? cond.tone : undefined,
    },
  ];

  return (
    <>
      <Card
        variant="budget"
        title="Logic & Order"
        subtitle={
          loadedAt
            ? `Live read for ${ticker} · updated ${new Date(loadedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })} ET`
            : `Far CB Watch roster · ${roster.length} tickers`
        }
      >
        <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 16 }}>
          <div style={{ transform: "scale(1.3)", transformOrigin: "left center" }}>
            <TickerListDropdown
              activeTicker={ticker}
              onSelect={setTicker}
              universe={roster}
              triggerLabel={ticker}
            />
          </div>
        </div>

        {err && (
          <div style={{ fontSize: 12, color: HOME_THEME.red, marginBottom: 12 }}>
            Feed error: {err}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {steps.map((s) => (
            <StepCard key={s.n} step={s} />
          ))}
        </div>
      </Card>

      <GexRegimeCard symbol={ticker} subtitle="Full WAVE + 0-DTE structure breakdown for the ticker above." />
    </>
  );
}

export default LogicOrderPanel;
