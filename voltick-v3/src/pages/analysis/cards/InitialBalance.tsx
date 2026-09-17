// Part O — Initial Balance. The 09:30–10:30 ET range on ES, the day type it
// implies, and the statistical rules that are in play because of it.
//
// The rules are not decoration — each one carries the base rate that makes it
// worth acting on, and the percentages are transcribed exactly. A rule whose
// number drifted would be worse than no rule.

import {
  FS,
  AnalysisCard,
  CardNote,
  CardState,
  CardTitle,
  Label,
  Row,
  Stat,
  UpdatedStamp,
  divider,
  etDateISO,
  nowEtMinutesSec,
  useGrace,
  useSecondTick,
} from '../kit'
import { IB_END_MIN, IB_OPEN_MIN, computeIbRead, type InitialBalance } from '../ib'
import { useEsCandles } from '@/data/esCandles'
import { V2, V2W } from '@/design/theme'

/**
 * A rule carries its own colour rather than a token, because that is how v2
 * declares them — as raw values that are then mapped onto the theme at render.
 * The mapping is kept (see RULE_COLOR) so the set of rules stays a plain data
 * list that reads like the trading logic it encodes.
 */
type RuleTone = 'forming' | 'info' | 'good' | 'neutral' | 'bad'

interface AppliedRule {
  title: string
  detail: string
  tone: RuleTone
}

const RULE_COLOR: Record<RuleTone, string> = {
  forming: V2.orange,
  info: V2.cyan,
  good: V2.pos,
  neutral: V2.text,
  bad: V2.red,
}

function applicableRules(ib: InitialBalance | null): AppliedRule[] {
  if (!ib) return []
  const out: AppliedRule[] = []

  const { min } = nowEtMinutesSec()
  const done = min >= IB_END_MIN
  // Every read taken before 10:30 is provisional and says so, because the range
  // it is computed from can still widen.
  const tag = done ? '' : ' (provisional — IB still forming)'

  if (!done) {
    out.push({
      title: 'IB Forming · Provisional Reads',
      tone: 'forming',
      detail: `Tracking the 9:30–10:30 ET range live — current IB H/L ${ib.high.toFixed(2)} / ${ib.low.toFixed(2)}. The reads below use the developing range and can still change; they lock at 10:30 ET.`,
    })
  } else {
    out.push({
      title: 'Inside Day Exception',
      tone: 'info',
      detail:
        'IB window complete. Only 0.6% of days stay fully inside the IB — plan for at least one breakout.',
    })
  }

  if (done && !ib.brokeHigh && !ib.brokeLow && min > 11 * 60) {
    out.push({
      title: 'Timing Curve · Range Mode',
      tone: 'neutral',
      detail:
        'Past 11:00 ET with no breakout — 84.1% of breakouts hit by now. Shift from breakout to range/premium-decay playbook.',
    })
  }

  // Both single-break branches produce the SAME title and text in v2. Kept as
  // one branch here; splitting them would imply a distinction that is not there.
  if (ib.brokeHigh !== ib.brokeLow) {
    out.push({
      title: 'Single-Break Trend Day',
      tone: 'good',
      detail: `One clean side broken — modern ES regime: 75.59% single-break trend days, 22.05% double-breach risk. Respect the first break${tag}.`,
    })
  } else if (ib.brokeHigh && ib.brokeLow) {
    out.push({
      title: 'Double Breach (ES)',
      tone: 'bad',
      detail: `Both IB sides broken — the ~40% ES double-cross whiplash profile. Trend-continuation conviction is reduced${tag}.`,
    })
  }

  return out
}

/** "IB forms in 12m 04s" / "Forming — 8m 30s left" / "IB locked". */
function ibCountdown(): { phase: 'pre' | 'forming' | 'done'; text: string } {
  const { min, sec } = nowEtMinutesSec()
  const fmtMS = (totalSec: number) => {
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${m}m ${String(s).padStart(2, '0')}s`
  }
  if (min < IB_OPEN_MIN) return { phase: 'pre', text: `IB forms in ${fmtMS((IB_OPEN_MIN - min) * 60 - sec)}` }
  if (min < IB_END_MIN) return { phase: 'forming', text: `Forming — ${fmtMS((IB_END_MIN - min) * 60 - sec)} left` }
  return { phase: 'done', text: 'IB locked' }
}

export function InitialBalanceCard() {
  const { candles } = useEsCandles(true)
  const grace = useGrace()
  const today = etDateISO()
  // A 1s clock so the countdown actually counts down.
  useSecondTick(true)

  const cd = ibCountdown()

  // Newest candle timestamp IS the feed's last update — there is no fetch to
  // stamp, because the bars arrive over the shared socket.
  const newest = candles[candles.length - 1]
  const lastUpdated = newest ? Number(newest.timestamp) : null

  // ES only. The feed can carry more than one contract, so prefer explicit ESU
  // bars and fall back to everything when the symbol tag is absent.
  const esu = candles.filter((c) => (c.symbol ?? '').toUpperCase().includes('ESU'))
  const src = esu.length ? esu : candles
  const amt = candles.length ? computeIbRead(src, today) : null
  const ib = amt?.ib ?? null

  const fmt = (n: number | null | undefined) => (n != null ? Math.round(n).toLocaleString() : '—')
  const rangePts = ib ? ib.high - ib.low : null
  const rules = applicableRules(ib)

  const leanColor =
    amt?.bias.lean === 'long' ? V2.pos : amt?.bias.lean === 'short' ? V2.red : V2.muted

  return (
    <AnalysisCard>
      <Row>
        <CardTitle>Initial Balance</CardTitle>
        <CardNote>ES</CardNote>
      </Row>

      <div
        style={{
          fontSize: FS.caption,
          fontFamily: 'var(--font-mono)',
          color: cd.phase === 'forming' ? V2.orange : cd.phase === 'done' ? V2.pos : V2.muted,
        }}
      >
        {cd.text}
      </div>

      {ib == null ? (
        <CardState
          loading={candles.length === 0 && grace}
          error={null}
          empty={
            cd.phase === 'pre'
              ? "IB hasn't formed yet — waiting for 9:30 ET open."
              : 'No ES data for this session.'
          }
        />
      ) : (
        <>
          <Row>
            <Stat label="IB High" value={fmt(ib.high)} color={V2.pos} />
            <Stat label="IB Mid" value={fmt(ib.mid)} color={V2.cyan} />
            <Stat label="IB Low" value={fmt(ib.low)} color={V2.red} />
            <Stat
              label="Range"
              value={
                cd.phase === 'forming'
                  ? 'forming'
                  : rangePts != null
                    ? `${Math.round(rangePts)} pts`
                    : '—'
              }
            />
          </Row>

          <div style={divider} />
          <Label>IB read</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Row style={{ marginBottom: 2 }}>
              <span style={{ fontSize: FS.body, fontWeight: 800, color: leanColor }}>
                {amt?.dayTypeLabel ?? '—'}
              </span>
              <span
                style={{
                  fontSize: FS.micro,
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: leanColor,
                }}
              >
                {amt?.bias.lean ?? 'neutral'}
              </span>
            </Row>
            <span style={{ fontSize: FS.body, color: V2.text, lineHeight: 1.4 }}>{amt?.bias.text}</span>
          </div>

          {rules.length > 0 && (
            <>
              <div style={divider} />
              <Label>Rules in play ({rules.length})</Label>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  flex: 1,
                  overflowY: 'auto',
                  minHeight: 0,
                }}
              >
                {rules.map((rule) => {
                  const c = RULE_COLOR[rule.tone]
                  return (
                    <div
                      key={rule.title}
                      style={{
                        border: `1px solid ${V2W.border}`,
                        borderLeft: `3px solid ${c}`,
                        borderRadius: 8,
                        padding: '8px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                      }}
                    >
                      <span style={{ fontSize: FS.body, fontWeight: 800, color: c }}>{rule.title}</span>
                      <span style={{ fontSize: FS.caption, color: V2.text, lineHeight: 1.4 }}>
                        {rule.detail}
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
      <UpdatedStamp at={lastUpdated} />
    </AnalysisCard>
  )
}
