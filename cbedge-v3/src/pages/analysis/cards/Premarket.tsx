// Part K — Premarket. The AI five-bullet read of the global pre-market tape,
// written daily by the VPS cron (premarket-summary-generator.js →
// premarket_summary). The page never calls a model; it reads the stored row.
//
// STALENESS IS THE WHOLE TRICK. A summary is only valid for the session it was
// written for, so anything whose date is not the NEXT premarket session is
// stale — Friday's read on a Monday pre-open, or yesterday's after the 16:00
// close. A stale summary shows the "coming at 8am" message, not itself.
//
// The /ES gap line under the bullets was removed 2026-10-10: its source
// (/api/es-gap, es-gap-tracker.js) stopped recording in 2026-09, so the card
// fetched it on every load and always got nothing back.

import {
  FS,
  AnalysisCard,
  CardNote,
  CardState,
  CardTitle,
  Row,
  UpdatedStamp,
  nextPremarketDate,
  useLiveData,
} from '../kit'
import { V2, V2W } from '@/design/theme'

interface PremarketSummaryResp {
  summary?: { date?: string; bullets?: string[]; generated_at?: number } | null
  error?: string
}

export function PremarketCard() {
  const { data, loading, error, lastUpdated } = useLiveData<PremarketSummaryResp>(
    '/api/premarket-summary',
    5 * 60_000,
  )

  const bullets = data?.summary?.bullets ?? []
  const sumDate = data?.summary?.date ?? null
  const nextDate = nextPremarketDate()
  const isStale = sumDate !== nextDate

  // Shown before 08:00, after the 16:00 close, at weekends, and whenever the
  // stored summary belongs to a session that has already been and gone.
  const emptyMsg = 'Summary will be up at 8:00 AM Eastern.'

  return (
    <AnalysisCard>
      <Row>
        <CardTitle>Premarket</CardTitle>
        <CardNote>{isStale ? nextDate : (sumDate ?? '')}</CardNote>
      </Row>
      {loading || error || bullets.length === 0 || isStale ? (
        <CardState
          loading={loading}
          // Both the transport error AND the route's own error field — the
          // generator reports a failed run in the body with a 200.
          error={error ?? data?.error ?? null}
          empty={emptyMsg}
        />
      ) : (
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: `${V2W.scrollThumb} transparent`,
          }}
        >
          {bullets.map((b, i) => (
            <li key={i} style={{ fontSize: FS.label, lineHeight: 1.45, color: V2.text }}>
              {b}
            </li>
          ))}
        </ul>
      )}
      <UpdatedStamp at={lastUpdated} />
    </AnalysisCard>
  )
}
