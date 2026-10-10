// Part Q — Strategy Builder. The daily AI plan written by the VPS cron
// (strategy-generator.js → daily_strategy). The page never calls a model; it
// renders the stored structured plan for the latest session.
//
// GATED TO ITS WINDOW. Outside 09:00–16:00 ET on a weekday the card fetches
// NOTHING — the url passed to useLiveData is null — and renders one line saying
// when it is back. The window is re-checked every minute so the card gates
// itself in and out without a reload.
//
// Every price on this card is SPX cash: the generator is SPX-only, so the "SPX"
// suffix is hardcoded rather than derived from a symbol.

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  FS,
  AnalysisCard,
  CardNote,
  CardState,
  CardTitle,
  Placeholder,
  Row,
  Stat,
  TitleTag,
  UpdatedStamp,
  divider,
  etDateISO,
  isStrategyWindow,
  useLiveData,
} from '../kit'
import { V2, V2W } from '@/design/theme'

interface StrategyLevel {
  label?: string
  price?: string | number
  note?: string
}
interface StrategyIdea {
  direction?: 'long' | 'short'
  entry?: string
  stop?: string
  target?: string
  rationale?: string
}
interface StrategyPlan {
  bias?: 'long' | 'short' | 'neutral'
  headline?: string
  summary?: string
  levels?: StrategyLevel[]
  idea?: StrategyIdea
  triggers?: string[]
  risk?: string
}
interface StrategyResp {
  strategy?: { date?: string; plan?: StrategyPlan; generated_at?: number } | null
  error?: string
}

function biasColor(b?: string): string {
  if (b === 'long') return V2.pos
  if (b === 'short') return V2.red
  return V2.muted
}

/** The "SPX" suffix chip that follows every price on this card. */
function SpxTag() {
  return (
    <span
      style={{
        fontSize: FS.micro,
        fontWeight: 700,
        color: V2.muted,
        opacity: 0.65,
        marginLeft: 4,
        letterSpacing: '0.06em',
      }}
    >
      SPX
    </span>
  )
}

/** A level / entry / stop / target value with its SPX tag. Blank → em dash. */
function withSpx(v?: string | number | null): ReactNode {
  const s = v == null ? '' : String(v).trim()
  if (!s) return '—'
  return (
    <>
      {s}
      <SpxTag />
    </>
  )
}

function SectionTitle({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      style={{
        fontSize: FS.caption,
        fontWeight: 800,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color,
      }}
    >
      {children}
    </span>
  )
}

/** The em dash a whole missing section collapses to. */
function Dash() {
  return <span style={{ fontSize: FS.body, color: V2.muted, opacity: 0.6 }}>—</span>
}

export function StrategyBuilderCard() {
  const [active, setActive] = useState(isStrategyWindow)

  useEffect(() => {
    const id = setInterval(() => setActive(isStrategyWindow()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Null url outside the window means useLiveData never fetches. That also
  // means `loading` stays true forever — which is fine here and ONLY here,
  // because the `!active` branch below renders before anything reads it.
  const { data, loading, error, lastUpdated } = useLiveData<StrategyResp>(
    active ? '/api/strategy' : null,
    5 * 60_000,
  )

  const s = data?.strategy ?? null
  const plan = s?.plan ?? null
  const planDate = s?.date ?? null
  const isStale = planDate != null && planDate !== etDateISO()
  const ready = !!plan && (!!plan.summary || !!plan.headline)

  return (
    <AnalysisCard span height="auto">
      <Row>
        <CardTitle>
          Strategy Builder
          <TitleTag>NOT FINANCIAL ADVICE</TitleTag>
        </CardTitle>
        {planDate && active && (
          <CardNote color={isStale ? V2.orange : V2.muted} opacity={0.7}>
            {isStale ? `last · ${planDate}` : planDate}
          </CardNote>
        )}
      </Row>

      {!active ? (
        <Placeholder>Available 9:00 AM – 4:00 PM ET on weekdays.</Placeholder>
      ) : loading || error || !ready ? (
        <CardState
          loading={loading}
          error={error ?? data?.error ?? null}
          empty="No strategy yet — regenerates hourly on weekdays (~7am–4pm ET)."
        />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: FS.label,
                fontWeight: 800,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: biasColor(plan!.bias),
                border: `1px solid ${biasColor(plan!.bias)}`,
                borderRadius: 8,
                padding: '4px 12px',
              }}
            >
              {plan!.bias ?? 'neutral'}
            </span>
            {plan!.headline && (
              <span style={{ fontSize: FS.label, fontWeight: 700, color: V2.text, flex: 1 }}>
                {plan!.headline}
              </span>
            )}
          </div>

          {plan!.summary && (
            <p
              style={{
                fontSize: FS.body,
                lineHeight: 1.65,
                color: V2.text,
                margin: 0,
                opacity: 0.92,
              }}
            >
              {plan!.summary}
            </p>
          )}

          <div style={divider} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Levels */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <SectionTitle color={V2.cyan}>Key levels</SectionTitle>
              {(plan!.levels?.length ?? 0) === 0 ? (
                <Dash />
              ) : (
                plan!.levels!.map((lv, i) => (
                  <div
                    key={i}
                    style={{
                      borderBottom: `1px solid ${V2W.border}`,
                      paddingBottom: 6,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 6,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={{ fontSize: FS.body, fontWeight: 700, color: V2.cyan }}>
                        {lv.label ?? '—'}
                      </span>
                      {lv.price != null && String(lv.price) !== '' && (
                        <>
                          <span style={{ fontSize: FS.body, color: V2.muted, opacity: 0.6 }}>—</span>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: FS.body,
                              fontWeight: 800,
                              color: V2.text,
                            }}
                          >
                            {String(lv.price)}
                            <SpxTag />
                          </span>
                        </>
                      )}
                    </div>
                    {lv.note && (
                      <span style={{ fontSize: FS.body, color: V2.muted, lineHeight: 1.45 }}>
                        {lv.note}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Idea + triggers */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SectionTitle color={V2.orange}>Primary idea</SectionTitle>
              {plan!.idea ? (
                <div
                  style={{
                    border: `1px solid ${V2W.border}`,
                    borderRadius: 10,
                    padding: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <Row>
                    <span
                      style={{ fontSize: FS.label, fontWeight: 800, color: biasColor(plan!.idea.direction) }}
                    >
                      {plan!.idea.direction === 'long'
                        ? '▲ LONG'
                        : plan!.idea.direction === 'short'
                          ? '▼ SHORT'
                          : '—'}
                    </span>
                  </Row>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    <Stat label="Entry" value={withSpx(plan!.idea.entry)} size={FS.compact} />
                    <Stat label="Stop" value={withSpx(plan!.idea.stop)} color={V2.red} size={FS.compact} />
                    <Stat
                      label="Target"
                      value={withSpx(plan!.idea.target)}
                      color={V2.pos}
                      size={FS.compact}
                    />
                  </div>
                  {plan!.idea.rationale && (
                    <span style={{ fontSize: FS.body, color: V2.muted, lineHeight: 1.5 }}>
                      {plan!.idea.rationale}
                    </span>
                  )}
                </div>
              ) : (
                <Dash />
              )}

              {/* The ONLY use of v2's `green` on this page — and v2's green is a
                  light BLUE. Not a positive colour, and not V2.pos. */}
              <SectionTitle color={V2.green}>Confirmation triggers</SectionTitle>
              {(plan!.triggers?.length ?? 0) === 0 ? (
                <Dash />
              ) : (
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                  }}
                >
                  {plan!.triggers!.map((t, i) => (
                    <li key={i} style={{ fontSize: FS.label, lineHeight: 1.5, color: V2.text }}>
                      {t}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {plan!.risk && (
            <>
              <div style={divider} />
              <span style={{ fontSize: FS.label, color: V2.muted, lineHeight: 1.55 }}>
                <span style={{ fontWeight: 800, color: V2.orange, letterSpacing: '0.06em' }}>
                  RISK ·{' '}
                </span>
                {plan!.risk}
              </span>
            </>
          )}
        </>
      )}
      <UpdatedStamp at={lastUpdated} />
    </AnalysisCard>
  )
}
