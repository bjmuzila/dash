// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS (/v3/analytics) — a 1:1 port of v2's /app/analytics.
//
// THE SPEC IS docs/parity/analysis.md, 419 checklist rows. Every value, format,
// threshold, colour rule and empty state on this page was transcribed from
// components/pages/Analytics.tsx rather than re-derived. If you are about to
// change what a card SAYS, check the doc first — several things that look like
// bugs are recorded there as v2's behaviour and are deliberate.
//
// COLOUR. Brandon, 2026-08-30: "keep colors the same as the v2 version." This
// page renders v2's palette, not v3's dark-slate one, via the V2 / V2W tokens in
// design/theme.ts. Do NOT reach for T.cyan / T.orange / T.red / T.green here —
// theme.ts maps v2's NAMES onto v3's VALUES and those four resolve to different
// colours. Part S of the parity doc is the full audit.
//
// THE GRID. Four columns, `alignItems: start`, with every small card at a FIXED
// 480px. That combination is what stops one card growing its whole row: a card
// that overflows scrolls inside itself. The two full-width cards span 1 / -1.
//
// NO SOCKET. Every value on this page is REST. The one live-ish feed is
// useEsCandles, behind the Initial Balance card, and it rides the shared socket
// through data/esCandles.ts — this page never touches a topic list.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { TickerLookupCard } from './analysis/lookup/TickerLookup'
import { MultiGreekCard } from './analysis/cards/MultiGreek'
import { EstimatedMoveCard } from './analysis/cards/EstimatedMove'
import { PremarketCard } from './analysis/cards/Premarket'
import { EconCalendarCard } from './analysis/cards/EconCalendar'
import { ConfidenceCard } from './analysis/cards/Confidence'
import { NetGreeksCard } from './analysis/cards/NetGreeks'
import { InitialBalanceCard } from './analysis/cards/InitialBalance'
import { TickerLevelsCard } from './analysis/cards/TickerLevels'
import { StrategyBuilderCard } from './analysis/cards/StrategyBuilder'
import './analysis/analysis.css'

export default function AnalysisPage() {
  // In the GEX dock this page is iframed at ?embed=1 into a narrow column. The
  // frosted cards are 45% translucent, so stacked there they show through to
  // whatever is behind them and read as smeared — embed mode makes them opaque
  // and forces a single column.
  //
  // Read in an EFFECT, so the first paint is always the four-column layout and
  // then it swaps. That is v2's behaviour; reading it during render would be a
  // hydration mismatch in the Next build this was ported from.
  const [embed, setEmbed] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setEmbed(new URLSearchParams(window.location.search).get('embed') === '1')
    }
  }, [])

  return (
    <main className="cb-analysis-page">
      <div
        className={`analysis-grid${embed ? ' analysis-embed' : ''}`}
        style={{
          display: 'grid',
          gap: 14,
          gridTemplateColumns: embed ? '1fr' : 'repeat(4, 1fr)',
          alignItems: 'start',
        }}
      >
        {/* Full-width ticker lookup: any symbol → its live GEX ladder and walls.
            Sits FIRST — the symbol you type here is the page's entry point, so
            it leads rather than sitting under the card stack. */}
        <TickerLookupCard />

        <MultiGreekCard />
        <EstimatedMoveCard />
        <PremarketCard />
        <EconCalendarCard />
        <ConfidenceCard />
        <NetGreeksCard />
        <InitialBalanceCard />
        <TickerLevelsCard />

        {/* Full-width AI daily strategy. */}
        <StrategyBuilderCard />
      </div>
    </main>
  )
}
