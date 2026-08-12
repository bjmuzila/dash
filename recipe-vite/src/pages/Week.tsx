import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { week as api, imageSrc, type PlannedMeal } from '../api'
import { T, label, display, body, section, button, minutes, SERIF, MONO } from '../theme'

/**
 * This week, by day — what the "Pick a day" button on a recipe was for.
 *
 * Before this screen you could plan a meal and then never see the plan without
 * opening budget.cbedge.net, which made planning feel like it went nowhere.
 *
 * It reads hh_meals: the SAME rows the household week board writes. A takeaway
 * typed over there with no recipe attached shows up here too, greyed and
 * unclickable — hiding it would make this screen quietly disagree with the board
 * it shares a table with, and "Thursday is free" would be a lie.
 */

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** 'YYYY-MM-DD' → weekday + date, WITHOUT new Date(str) — that parses as UTC and
 *  renders the day before for anyone west of Greenwich. */
function dayParts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return {
    name: DAY_NAMES[(dt.getDay() + 6) % 7],
    short: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }
}

export default function Week() {
  /** Week offset in days. 0 = this week; the arrows move by seven. */
  const [offset, setOffset] = useState(0)
  const anchor = (() => {
    if (!offset) return undefined
    const d = new Date()
    d.setDate(d.getDate() + offset)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })()

  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['week', offset],
    queryFn: () => api.get(anchor),
  })

  const unplan = useMutation({
    mutationFn: (mealId: number) => api.unplan(mealId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['week'] }),
  })

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => setOffset((o) => o - 7)} style={arrow}>‹</button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={label()}>
            {offset === 0 ? 'THIS WEEK' : offset < 0 ? `${-offset / 7} WEEK${offset === -7 ? '' : 'S'} BACK` : `${offset / 7} WEEK${offset === 7 ? '' : 'S'} AHEAD`}
          </div>
          {data && (
            <div style={{ ...body(12), color: T.faint, marginTop: 3 }}>
              {dayParts(data.weekStart).short} – {dayParts(data.weekEnd).short}
            </div>
          )}
        </div>
        <button onClick={() => setOffset((o) => o + 7)} style={arrow}>›</button>
      </div>

      {isLoading && <div style={{ ...body(), color: T.muted, padding: '30px 0', textAlign: 'center' }}>…</div>}

      {error && (
        <div style={section()}>
          <div style={label({ color: T.bad })}>Couldn’t load</div>
          <p style={{ ...body(), marginTop: 8 }}>{(error as Error).message}</p>
        </div>
      )}

      {data && data.planned === 0 && (
        <div style={section({ textAlign: 'center', padding: '30px 20px' })}>
          <h2 style={display(21)}>Nothing planned</h2>
          <p style={{ ...body(), marginTop: 10, color: T.faint }}>
            Open a recipe and hit <b>Pick a day</b>. It lands here, and its ingredients
            land on the grocery list.
          </p>
          <Link to="/cookbook" style={{ ...body(), color: T.accent, display: 'inline-block', marginTop: 14 }}>
            Browse the cookbook →
          </Link>
        </div>
      )}

      {data?.days.map((d) => {
        const { name, short } = dayParts(d.day)
        return (
          <div
            key={d.day}
            style={section({
              padding: 12,
              // Today gets the accent edge and nothing else. Filling the whole
              // card would make one of seven days shout on a screen you scan.
              borderLeft: d.isToday ? `2px solid ${T.accent}` : `1px solid ${T.rule}`,
            })}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
              <h3 style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 500,
                           color: d.isToday ? T.accent : T.ink }}>
                {name}
              </h3>
              <span style={label()}>{short}</span>
            </div>

            {d.meals.length === 0 ? (
              <div style={{ ...body(12.5), color: T.faint, marginTop: 7 }}>—</div>
            ) : (
              <div style={{ marginTop: 4 }}>
                {d.meals.map((m, i) => (
                  <Row key={m.id} m={m} first={i === 0} onUnplan={() => unplan.mutate(m.id)} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Row({ m, first, onUnplan }: { m: PlannedMeal; first: boolean; onUnplan: () => void }) {
  const time = (m.cook_minutes ?? 0) + (m.prep_minutes ?? 0)
  const meta = [
    m.main_ingredient ? m.main_ingredient.toUpperCase() : null,
    time ? minutes(time) : null,
    m.servings ? `SERVES ${m.servings}` : null,
  ].filter(Boolean).join(' · ')

  // The photo only exists for meals that came from a recipe. A takeaway typed
  // into the week board gets the same row minus the picture and the link.
  const src = m.recipe_id ? imageSrc({ id: m.recipe_id, image_etag: m.image_etag, image_url: m.image_url }) : null

  const inner = (
    <>
      <div style={{
        width: 42, height: 42, flexShrink: 0, borderRadius: 999, overflow: 'hidden',
        background: T.paperSunk, display: 'grid', placeItems: 'center',
      }}>
        {src
          ? <img src={src} alt="" loading="lazy" decoding="async"
                 style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 45%' }} />
          : <span style={{ fontFamily: SERIF, fontSize: 15, color: T.faint }}>
              {m.title.slice(0, 1).toUpperCase()}
            </span>}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ ...body(14), color: m.recipe_id ? T.ink : T.faint }}>{m.title}</div>
        {meta && <div style={{ ...label(), fontSize: 8, marginTop: 3, letterSpacing: '0.08em' }}>{meta}</div>}
      </div>
    </>
  )

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 0', borderTop: first ? 'none' : `1px solid ${T.rule}`,
    }}>
      {m.recipe_id ? (
        <Link to={`/r/${m.recipe_id}`} style={{
          display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0,
          textDecoration: 'none', color: T.ink,
        }}>{inner}</Link>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>{inner}</div>
      )}
      <button
        onClick={onUnplan}
        aria-label={`Unplan ${m.title}`}
        style={{
          ...button('ghost'), minHeight: 30, padding: '5px 9px', fontSize: 11,
          borderRadius: 3, color: T.faint, flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  )
}

const arrow: React.CSSProperties = {
  width: 38, height: 38, borderRadius: 999, flexShrink: 0,
  border: `1px solid ${T.rule}`, background: 'transparent', color: T.ink,
  fontFamily: MONO, fontSize: 16, lineHeight: 1, cursor: 'pointer',
  display: 'grid', placeItems: 'center',
}
