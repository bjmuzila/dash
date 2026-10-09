// ─────────────────────────────────────────────────────────────────────────────
// ALIGN SCORECARD — the Grades view of /scanner?tab=align (and Align · Main).
//
// Every LOCK and 0DTE PENDING over the last N saved sessions, graded by
// alignGrade.ts on what price did next, then rolled up: touch rate, the A–F
// split, how long a touch took, and the same split by distance from spot and by
// whether the ALL ex-0DTE wall agreed. The list underneath is every signal,
// newest first — click one for its replay on that day.
//
// DATA: today is the board's own (live) payload; each past day is that day's
// archived board (align_daily), fetched in parallel and cached by `query()`, so
// flipping between views costs nothing after the first load. Grades follow the
// page's settings — change Wall or Hold and the whole card re-grades.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react'
import { SegGroup } from '@/design/primitives/Controls'
import { T, V2W, alpha } from '@/design/theme'
import { query } from '@/data/api'
import { EM_DASH } from '@/pages/scanner/format'
import {
  alignUrl,
  buildRow,
  etToday,
  fmtEt,
  fmtExpiry,
  fmtStrike,
  type AlignResponse,
  type AlignSettings,
  type AlignSymbolRaw,
} from '@/pages/scanner/align'
import {
  DIST_BUCKETS,
  GRADES,
  GRADE_TEXT,
  distBucket,
  gradeLabel,
  gradeTitle,
  tally,
  touchRate,
  type Signal,
  type Tally,
} from '@/pages/scanner/alignGrade'
import { DIM, GRADE_COLOR, LABEL, STATE_COLOR, pillStyle } from '@/pages/scanner/alignStyle'

type Span = '1' | '5' | '10' | '20'
type Kind = 'LOCK' | 'PENDING' | 'both'

const MAX_LIST = 80

interface DaySigs {
  date: string
  sigs: Signal[]
}

export default function AlignScorecard({
  settings,
  dates,
  live,
  liveDate,
  pick,
  onOpen,
}: {
  settings: AlignSettings
  /** Every openable session, newest first. */
  dates: string[]
  /** Today's board payload (already loaded by the board), or undefined on a past day. */
  live: AlignResponse | undefined
  liveDate: string | undefined
  /** Which tickers count — the tab's universe filter (Main = hot only). Keep it stable (useCallback). */
  pick: (s: AlignSymbolRaw[]) => AlignSymbolRaw[]
  onOpen: (symbol: string, date: string | undefined) => void
}) {
  const [span, setSpan] = useState<Span>('10')
  const [kind, setKind] = useState<Kind>('LOCK')
  const [past, setPast] = useState<Record<string, AlignResponse | null>>({})
  const [loading, setLoading] = useState(false)

  const today = etToday()
  const pastDates = useMemo(() => {
    const n = Number(span)
    const list = dates.filter((d) => d < today && d !== liveDate)
    // "1" = today only when today is live, else the latest saved day.
    const want = liveDate === today ? n - 1 : n
    return list.slice(0, Math.max(0, want))
  }, [dates, span, today, liveDate])

  // Past days: one request each, in parallel, cached by query().
  useEffect(() => {
    const need = pastDates.filter((d) => !(`${settings.mode}|${d}` in past))
    if (!need.length) return
    let cancelled = false
    setLoading(true)
    void Promise.all(
      need.map((d) =>
        query<AlignResponse>(alignUrl(settings.mode, d), { staleMs: 24 * 3600_000 })
          .then((r) => [d, r] as const)
          .catch(() => [d, null] as const),
      ),
    ).then((pairs) => {
      if (cancelled) return
      setPast((prev) => {
        const next = { ...prev }
        for (const [d, r] of pairs) next[`${settings.mode}|${d}`] = r
        return next
      })
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [pastDates, past, settings.mode])

  const days = useMemo<DaySigs[]>(() => {
    const out: DaySigs[] = []
    const grade = (date: string, resp: AlignResponse | null | undefined) => {
      if (!resp?.symbols) return
      const syms = pick(resp.symbols)
      const endT = Math.max(0, ...syms.map((s) => s.t))
      const sigs: Signal[] = []
      for (const s of syms) {
        const row = buildRow(s, settings, date, date === today ? Date.now() : endT)
        sigs.push(...row.signals)
      }
      out.push({ date, sigs })
    }
    if (liveDate && live) grade(liveDate, live)
    for (const d of pastDates) grade(d, past[`${settings.mode}|${d}`])
    return out.sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [live, liveDate, pastDates, past, settings, pick, today])

  const all = useMemo(() => days.flatMap((d) => d.sigs.map((s) => ({ ...s, date: d.date }))), [days])
  const chosen = useMemo(() => all.filter((s) => kind === 'both' || s.kind === kind), [all, kind])
  const total = useMemo(() => tally(chosen), [chosen])
  const noPx = days.length > 0 && days.every((d) => d.sigs.length === 0)

  const groups = useMemo(() => {
    const rows: Array<{ label: string; t: Tally }> = []
    for (const b of DIST_BUCKETS) rows.push({ label: `${b} strikes away`, t: tally(chosen.filter((s) => distBucket(s) === b)) })
    rows.push({ label: 'ALL ex-0D agreed', t: tally(chosen.filter((s) => s.allOn === true)) })
    rows.push({ label: 'ALL ex-0D elsewhere', t: tally(chosen.filter((s) => s.allOn === false)) })
    if (kind === 'both') {
      rows.push({ label: 'LOCK signals', t: tally(chosen.filter((s) => s.kind === 'LOCK')) })
      rows.push({ label: '0DTE PENDING signals', t: tally(chosen.filter((s) => s.kind === 'PENDING')) })
    }
    return rows
  }, [chosen, kind])

  const list = useMemo(() => [...chosen].sort((a, b) => b.t0 - a.t0).slice(0, MAX_LIST), [chosen])
  const rate = touchRate(total)

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide" style={{ color: LABEL }}>
            Sessions
          </span>
          <SegGroup<Span>
            options={[
              { value: '1', label: '1' },
              { value: '5', label: '5' },
              { value: '10', label: '10' },
              { value: '20', label: '20' },
            ]}
            value={span}
            onChange={setSpan}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide" style={{ color: LABEL }}>
            Signal
          </span>
          <SegGroup<Kind>
            options={[
              { value: 'LOCK', label: 'Lock', title: '0DTE joined the later expiries on the wall' },
              { value: 'PENDING', label: '0DTE pending', title: 'Later expiries agreed; 0DTE not on it yet' },
              { value: 'both', label: 'Both' },
            ]}
            value={kind}
            onChange={setKind}
          />
        </div>
        <span className="text-xs" style={{ color: DIM }}>
          {days.length} session{days.length === 1 ? '' : 's'}
          {days.length ? ` (${days[days.length - 1]?.date} → ${days[0]?.date})` : ''}
          {loading ? ' · loading…' : ''} · graded with your Wall / Hold / tolerance settings
        </span>
      </div>

      {noPx && (
        <div className="text-xs" style={{ color: DIM }}>
          No price path in these sessions yet — grading starts with sessions recorded after this update.
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        <Tile label="Signals" value={String(total.n)} sub={`${total.graded} graded · ${total.open} open · ${total.atWall} at wall`} />
        <Tile
          label="Touched the wall"
          value={rate == null ? EM_DASH : `${Math.round(rate * 100)}%`}
          sub={`${total.byGrade.A + total.byGrade.B} of ${total.graded}`}
          color={GRADE_COLOR.A}
        />
        <Tile
          label="Within 60m (A)"
          value={total.graded ? `${Math.round((total.byGrade.A / total.graded) * 100)}%` : EM_DASH}
          sub={`${total.byGrade.A} signals`}
          color={GRADE_COLOR.A}
        />
        <Tile label="Median time to touch" value={total.medMins == null ? EM_DASH : `${total.medMins}m`} sub="over the touched ones" />
        <Tile
          label="Went the other way (F)"
          value={total.graded ? `${Math.round((total.byGrade.F / total.graded) * 100)}%` : EM_DASH}
          sub={`${total.byGrade.F} signals`}
          color={GRADE_COLOR.F}
        />
      </div>

      <div className="rounded-md border border-line p-3" style={{ background: V2W.wash03 }}>
        <div className="mb-2 flex flex-wrap items-baseline gap-3">
          <span className="text-sm font-bold uppercase tracking-wide" style={{ color: LABEL }}>
            Grade split
          </span>
          {GRADES.map((g) => (
            <span key={g} className="flex items-center gap-1.5 text-xs" style={{ color: DIM }}>
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: GRADE_COLOR[g] }} />
              <b style={{ color: GRADE_COLOR[g] }}>{g}</b> {GRADE_TEXT[g]}
            </span>
          ))}
        </div>
        <GradeBar t={total} />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ color: LABEL }}>
                <th className="border-b border-line px-2 py-1.5 text-left text-xs font-bold uppercase tracking-wide">Group</th>
                <th className="border-b border-line px-2 py-1.5 text-right text-xs font-bold uppercase tracking-wide">Graded</th>
                {GRADES.map((g) => (
                  <th key={g} className="border-b border-line px-2 py-1.5 text-right text-xs font-bold" style={{ color: GRADE_COLOR[g] }}>
                    {g}
                  </th>
                ))}
                <th className="border-b border-line px-2 py-1.5 text-right text-xs font-bold uppercase tracking-wide">Touch</th>
                <th className="border-b border-line px-2 py-1.5 text-right text-xs font-bold uppercase tracking-wide">Med time</th>
                <th className="w-48 border-b border-line px-2 py-1.5 text-left text-xs font-bold uppercase tracking-wide">Split</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(({ label, t }) => {
                const r = touchRate(t)
                return (
                  <tr key={label}>
                    <td className="border-b border-line/50 px-2 py-1.5 text-fg">{label}</td>
                    <td className="border-b border-line/50 px-2 py-1.5 text-right tabular">{t.graded}</td>
                    {GRADES.map((g) => (
                      <td key={g} className="border-b border-line/50 px-2 py-1.5 text-right tabular" style={{ color: t.byGrade[g] ? T.text : DIM }}>
                        {t.byGrade[g]}
                      </td>
                    ))}
                    <td className="border-b border-line/50 px-2 py-1.5 text-right font-bold tabular">
                      {r == null ? EM_DASH : `${Math.round(r * 100)}%`}
                    </td>
                    <td className="border-b border-line/50 px-2 py-1.5 text-right tabular">
                      {t.medMins == null ? EM_DASH : `${t.medMins}m`}
                    </td>
                    <td className="border-b border-line/50 px-2 py-1.5">
                      <GradeBar t={t} thin />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-md border border-line p-3" style={{ background: V2W.wash03 }}>
        <div className="mb-1 flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-bold uppercase tracking-wide" style={{ color: LABEL }}>
            Every signal
          </span>
          <span className="text-xs" style={{ color: DIM }}>
            newest first{chosen.length > MAX_LIST ? ` · latest ${MAX_LIST} of ${chosen.length}` : ''} — click for the replay
          </span>
        </div>
        {list.length === 0 && (
          <div className="py-3 text-xs" style={{ color: DIM }}>
            No signals in these sessions.
          </div>
        )}
        <div className="overflow-x-auto">
          <div style={{ minWidth: 640 }}>
            {list.map((s, i) => (
              <button
                key={`${s.date}-${s.symbol}-${s.t0}-${i}`}
                type="button"
                onClick={() => onOpen(s.symbol, s.date === today ? undefined : s.date)}
                title={gradeTitle(s)}
                className="grid w-full items-center gap-3 border-t border-line/50 py-1.5 text-left text-xs transition-colors hover:bg-raised"
                style={{ gridTemplateColumns: '78px 44px 60px 96px 64px 64px 40px minmax(0, 1fr)' }}
              >
                <span className="tabular" style={{ color: DIM }}>
                  {fmtExpiry(s.date)}
                </span>
                <span className="tabular" style={{ color: DIM }}>
                  {fmtEt(s.t0)}
                </span>
                <span className="font-bold text-fg">{s.symbol}</span>
                <span
                  className="justify-self-start rounded-full px-2 py-0.5 text-2xs font-bold tracking-wide"
                  style={pillStyle(STATE_COLOR[s.kind === 'LOCK' ? 'LOCKED' : 'PENDING'])}
                >
                  {s.kind === 'LOCK' ? 'LOCK' : '0DTE PEND'}
                </span>
                <span className="tabular text-fg">{fmtStrike(s.k)}</span>
                <span className="tabular" style={{ color: DIM }}>
                  {s.distStrikes > 0 ? '+' : ''}
                  {s.distStrikes} str
                </span>
                <GradePill s={s} />
                <span className="truncate" style={{ color: DIM }}>
                  {s.atWall
                    ? 'fired at the wall'
                    : s.touched
                      ? `touched in ${s.minsToTouch}m`
                      : `${Math.round(s.progress * 100)}% of the way · ${s.maeStrikes.toFixed(1)} str against`}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function GradePill({ s }: { s: Signal }) {
  const label = gradeLabel(s)
  const c = s.grade ? GRADE_COLOR[s.grade] : DIM
  return (
    <span
      className="inline-flex min-w-6 justify-center justify-self-start rounded-sm px-1.5 py-0.5 text-2xs font-bold"
      style={s.grade ? pillStyle(c) : { color: DIM, border: `1px dashed ${alpha(T.text, 0.25)}` }}
      title={gradeTitle(s)}
    >
      {label}
    </span>
  )
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-line p-3" style={{ background: V2W.wash03 }}>
      <span className="text-2xs uppercase tracking-wide" style={{ color: LABEL }}>
        {label}
      </span>
      <span className="text-xl font-bold tabular" style={{ color: color ?? T.text }}>
        {value}
      </span>
      {sub && (
        <span className="text-2xs" style={{ color: DIM }}>
          {sub}
        </span>
      )}
    </div>
  )
}

function GradeBar({ t, thin = false }: { t: Tally; thin?: boolean }) {
  if (!t.graded) return <div className={thin ? 'h-2' : 'h-4'} />
  return (
    <div className={['flex w-full overflow-hidden rounded-sm', thin ? 'h-2' : 'h-4'].join(' ')}>
      {GRADES.map((g) =>
        t.byGrade[g] ? (
          <span
            key={g}
            title={`${g} — ${GRADE_TEXT[g]}: ${t.byGrade[g]}`}
            style={{ width: `${(t.byGrade[g] / t.graded) * 100}%`, background: GRADE_COLOR[g] }}
          />
        ) : null,
      )}
    </div>
  )
}
