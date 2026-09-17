// Part M — Confidence Score. How well today's Core Bullseye is scoring, plus
// the CB in force at three fixed checkpoints and whether price engaged it.
//
// This card does NOT use `useLiveData`: it has to compare each poll against the
// previous one to notice the CB moving strike, which needs its own loader.
//
// ALWAYS SCORES TODAY. There is no prior-session fallback and `isStale` is
// hardcoded false — before the first snapshot lands the card says so rather
// than showing yesterday's score under a live-looking timestamp.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FS,
  AnalysisCard,
  CardNote,
  CardState,
  CardTitle,
  Label,
  MoreLink,
  Row,
  Stat,
  TitleTag,
  UpdatedStamp,
  Value,
  divider,
  etDateISO,
  fmtElapsed,
  nowEtMinutesSec,
  useSecondTick,
} from '../kit'
import { V2, V2W } from '@/design/theme'

interface MvcSegment {
  strike: number
  /** "HH:MM" ET when this strike became the CB. */
  from: string
  /** "HH:MM" ET of its last snapshot. */
  to: string
  touched: boolean
  outcome: 'hit' | 'pivot' | 'chop' | 'miss'
}

interface ConfidenceResp {
  /** The current CB price level. */
  level?: number
  /** SPX at the snapshot. */
  price?: number
  spx?: number
  thresholds?: { hitPts?: number }
  /** 0..100, NOT fractions. */
  score?: { hit?: number; pivot?: number; chop?: number; break?: number }
  mvcTimeline?: MvcSegment[]
  error?: string
}

/** "H:MM" / "HH:MM" ET → minutes of day. */
function hhmmToMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/**
 * The segment in force at a target ET minute — the last one that had started by
 * then.
 *
 * If the target precedes the first snapshot of the day, fall back to the
 * EARLIEST segment: that is the CB that was in force around the open, which is
 * what the early checkpoints are asking about. Returning null there would print
 * a dash on a checkpoint that did have an answer.
 */
function segmentAt(timeline: MvcSegment[] | undefined, targetMin: number): MvcSegment | null {
  if (!timeline?.length) return null
  let best: MvcSegment | null = null
  for (const seg of timeline) {
    const from = hhmmToMin(seg.from)
    if (from != null && from <= targetMin) best = seg
  }
  if (best == null) best = timeline[0] ?? null
  return best
}

/**
 * The checkpoints the card pins hit/miss against.
 *
 * ⚠ v2's comment above this array says "9:35 / 10:30 / 12:00" and its code says
 * 9:45. The code is what shipped and what the scores were read against, so 9:45
 * is the parity value. Recorded in Part M of the parity doc.
 */
const CHECKPOINTS: Array<{ label: string; min: number }> = [
  { label: '9:45', min: 9 * 60 + 45 },
  { label: '10:30', min: 10 * 60 + 30 },
  { label: '12:00', min: 12 * 60 },
]

/**
 * outcome → chip. hit / pivot / chop all ENGAGED the level and all read HIT;
 * only `miss` means price never reached it. `chop` adds the qualifier.
 */
function outcomeChip(o: MvcSegment['outcome'] | null): { text: string; color: string } {
  if (o == null) return { text: '—', color: V2.muted }
  if (o === 'miss') return { text: 'MISS', color: V2.red }
  if (o === 'hit') return { text: 'HIT', color: V2.pos }
  if (o === 'pivot') return { text: 'HIT', color: V2.pos }
  return { text: 'HIT · CHOP', color: V2.orange }
}

export function ConfidenceCard() {
  const [data, setData] = useState<ConfidenceResp | null>(null)
  const [forDate, setForDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  // CB-change tracking: the prior level, when it changed, and whether price has
  // reached the new one since — which is what stops the timer.
  const prevLevelRef = useRef<number | null>(null)
  const [changedAt, setChangedAt] = useState<number | null>(null)
  const [hitAfterChange, setHitAfterChange] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const date = etDateISO()
      const res = await fetch(`/api/confidence?date=${date}`, { cache: 'no-store' })
      const json = (await res.json()) as ConfidenceResp
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)

      const newLevel = json.level ?? null
      const prev = prevLevelRef.current
      if (newLevel != null && prev != null && Math.round(newLevel) !== Math.round(prev)) {
        setChangedAt(Date.now())
        setHitAfterChange(false)
      }
      const hitPts = json.thresholds?.hitPts ?? 8
      const px = json.price ?? json.spx
      if (newLevel != null && px != null && Math.abs(px - newLevel) <= hitPts) {
        setHitAfterChange(true)
      }
      if (newLevel != null) prevLevelRef.current = newLevel

      setData(json)
      setForDate(date)
      setLastUpdated(Date.now())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 120_000)
    return () => clearInterval(id)
  }, [load])

  // The 1s clock runs ONLY while a CB change is outstanding — there is nothing
  // else on this card that ticks, and a permanent interval would re-render it
  // sixty times a minute for a number nobody is watching.
  const now = useSecondTick(changedAt != null && !hitAfterChange)

  const s = data?.score
  const score = s?.hit != null ? Math.round(s.hit) : null
  const cb = data?.level ?? null
  const px = data?.price ?? data?.spx ?? null
  const distToCb = cb != null && px != null ? px - cb : null

  const band =
    s == null
      ? '—'
      : (s.hit ?? 0) >= (s.pivot ?? 0) && (s.hit ?? 0) >= (s.chop ?? 0)
        ? 'HIT'
        : (s.pivot ?? 0) >= (s.chop ?? 0)
          ? 'PIVOT'
          : 'CHOP'
  const bandColor = band === 'HIT' ? V2.pos : band === 'PIVOT' ? V2.orange : V2.red
  const showChange = changedAt != null

  return (
    <AnalysisCard>
      <Row>
        <CardTitle>
          Confidence Score
          <TitleTag>BETA</TitleTag>
        </CardTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {forDate && <CardNote>{forDate}</CardNote>}
          <MoreLink href="/app/confidence-score" />
        </div>
      </Row>
      {loading || error || score == null ? (
        <CardState
          loading={loading}
          error={error}
          empty="Waiting for today's first CB snapshot."
        />
      ) : (
        <>
          <Row>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <Value color={bandColor} size={FS.hero}>
                {score}
              </Value>
              <span style={{ fontSize: FS.body, color: V2.muted, opacity: 0.6 }}>/100</span>
            </div>
            <span
              style={{
                fontSize: FS.label,
                fontWeight: 800,
                letterSpacing: '0.1em',
                color: bandColor,
              }}
            >
              {band}
            </span>
          </Row>

          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: V2W.border,
              overflow: 'hidden',
            }}
          >
            <div style={{ width: `${score}%`, height: '100%', background: bandColor }} />
          </div>

          <Row>
            <Stat
              label="Current SPX CB"
              value={cb != null ? Math.round(cb).toLocaleString() : '—'}
              color={V2.cyan}
            />
            <Stat
              label="Distance to CB"
              value={distToCb != null ? `${distToCb >= 0 ? '+' : ''}${distToCb.toFixed(1)}` : '—'}
              color={
                distToCb == null
                  ? V2.muted
                  : Math.abs(distToCb) <= (data?.thresholds?.hitPts ?? 8)
                    ? V2.pos
                    : V2.text
              }
            />
          </Row>

          <div style={divider} />
          <Label>CB checkpoints</Label>
          <Checkpoints data={data} />

          {showChange && (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: FS.caption, paddingTop: 2 }}
            >
              <span style={{ fontWeight: 800, letterSpacing: '0.06em', color: V2.orange }}>
                CB CHANGED
              </span>
              {hitAfterChange ? (
                <span style={{ color: V2.pos, fontWeight: 700 }}>hit ✓</span>
              ) : (
                <span style={{ color: V2.muted, fontFamily: 'var(--font-mono)' }}>
                  {fmtElapsed(now - changedAt!)} — awaiting hit
                </span>
              )}
            </div>
          )}
        </>
      )}
      <UpdatedStamp at={lastUpdated} />
    </AnalysisCard>
  )
}

/**
 * The three checkpoint rows.
 *
 * THE CHIP PRIORITY IS ORDERED AND THE ORDER MATTERS:
 *   1. still in the future        → "pending"
 *   2. recorded "pivot", but a LATER checkpoint sits on a lower strike → it was
 *      never a pivot, just a hit. Show HIT.
 *   3. any recorded outcome       → that outcome
 *   4. live, and the CB moved since the previous checkpoint → "CB CHANGED ·
 *      PENDING", because the level under it is not the one that was scored
 *   5. otherwise                  → "pending"
 */
function Checkpoints({ data }: { data: ConfidenceResp | null }) {
  const nowMin = nowEtMinutesSec().min
  const timeline = data?.mvcTimeline

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {CHECKPOINTS.map((cp, ci) => {
        const seg = segmentAt(timeline, cp.min)
        const prev = ci > 0 ? CHECKPOINTS[ci - 1] : undefined
        const prevSeg = prev ? segmentAt(timeline, prev.min) : null
        const future = nowMin < cp.min
        // Is THIS checkpoint's CB the one still live? Only if no later
        // checkpoint that has already happened moved the strike.
        const laterChanged = CHECKPOINTS.some(
          (o, oi) => oi > ci && nowMin >= o.min && segmentAt(timeline, o.min)?.strike !== seg?.strike,
        )
        const live = !future && !laterChanged
        const cbChanged = seg != null && prevSeg != null && seg.strike !== prevSeg.strike
        const laterLower =
          seg && ci < CHECKPOINTS.length - 1
            ? CHECKPOINTS.slice(ci + 1).some((o) => {
                const laterSeg = segmentAt(timeline, o.min)
                return !!laterSeg && laterSeg.strike < seg.strike
              })
            : false

        const chip = future
          ? { text: 'pending', color: V2.muted }
          : seg?.outcome === 'pivot' && laterLower
            ? { text: 'HIT', color: V2.pos }
            : seg?.outcome != null
              ? outcomeChip(seg.outcome)
              : live && cbChanged
                ? { text: 'CB CHANGED · PENDING', color: V2.orange }
                : { text: 'pending', color: V2.muted }

        return (
          <div
            key={cp.label}
            style={{
              display: 'grid',
              gridTemplateColumns: '46px 64px 1fr',
              alignItems: 'center',
              columnGap: 8,
              borderBottom: `1px solid ${V2W.border}`,
              paddingBottom: 6,
            }}
          >
            <span style={{ fontSize: FS.body, fontFamily: 'var(--font-mono)', color: V2.muted }}>
              {cp.label}
            </span>
            <span style={{ textAlign: 'right' }}>
              <Value size={FS.body} color={V2.cyan}>
                {seg ? Math.round(seg.strike).toLocaleString() : '—'}
              </Value>
            </span>
            <span
              style={{
                fontSize: FS.micro,
                fontWeight: 800,
                letterSpacing: '0.06em',
                color: chip.color,
                textAlign: 'right',
                whiteSpace: 'nowrap',
              }}
            >
              {chip.text}
            </span>
          </div>
        )
      })}
    </div>
  )
}
