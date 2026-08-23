import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import {
  useLists, useToggleListItem, useAddListItem, useDeleteListItem,
  useClearChecked, useAddMeal, useDeleteMeal,
} from '../hooks'
import { ApiError, type Aisle, type ListItem, type Meal, type MealRef } from '../api'
import { T, sectionTitle, label, body, hero, section, row, input, button, segment, checkbox, doneText } from '../theme'

/**
 * Lists — three views over the SAME two tables.
 *
 *   Week — meals per day, each meal's ingredients nested under it.
 *   Shop — every unchecked item, grouped in store-walk order.
 *   List — the plain grocery list plus anything not tied to a meal.
 *
 * Ticking "tortillas" in Shop marks the same row that sits under Tuesday on
 * Week. Any design where shopping generates separate rows ends with the two
 * views disagreeing about what you actually bought.
 */

type View = 'week' | 'shop' | 'list'

const AISLE_LABEL: Record<Aisle, string> = {
  produce: 'Produce', meat: 'Meat', dairy: 'Dairy', bakery: 'Bakery',
  frozen: 'Frozen', pantry: 'Pantry', household: 'Household', other: 'Other',
}

/** "Mon 4" from "2026-08-04" — split into numbers, never `new Date(iso)`.
 *  Parsing the bare string would land on UTC midnight and read a day early
 *  anywhere west of Greenwich. */
const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${dt.toLocaleDateString('en-US', { weekday: 'short' })} ${d}`
}

/** "Tue Aug 12" — the same date with its month, for when the meal is in a
 *  different week and "Tue 12" would be ambiguous. */
const dayLabelLong = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function Lists() {
  const { user } = useAuth()
  // Opens on the plain list. The week board and shopping mode are both things
  // you go TO deliberately; "what's on the list" is the question being asked
  // nine times out of ten.
  const [view, setView] = useState<View>('list')
  const [week, setWeek] = useState<string | undefined>(undefined)
  // Which meal is expanded on the week board. Lifted out of <Week> so tapping a
  // meal name on the plain list can open it — the board would otherwise mount
  // with everything collapsed and no way to say which one you meant.
  const [openMeal, setOpenMeal] = useState<number | null>(null)
  const { data, isLoading, error, refetch } = useLists(week)
  const toggle = useToggleListItem(week)

  if (isLoading) return <div style={{ ...body(14), color: T.muted }}>Loading…</div>
  if (error) {
    return (
      <div>
        <div style={{ ...body(15), color: T.bad }}>
          {error instanceof ApiError ? error.message : 'Something went wrong.'}
        </div>
        <button onClick={() => void refetch()} style={{ ...button('ghost'), marginTop: 14 }}>Try again</button>
      </div>
    )
  }
  // `user` is only a readiness gate here — nothing on this screen is filtered
  // by who you are. The list is the account's.
  if (!data || !user) return null

  const shift = (n: number) => {
    const [y, m, d] = data.weekStart.split('-').map(Number)
    const dt = new Date(y, m - 1, d + n * 7)
    setWeek(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {/* List first, because it is the default and the tab order should match
            what the screen actually opens on. */}
        <button onClick={() => setView('list')} style={segment(view === 'list')}>List</button>
        <button onClick={() => setView('week')} style={segment(view === 'week')}>Week</button>
        <button onClick={() => setView('shop')} style={segment(view === 'shop')}>
          Shop{data.counts.open > 0 ? ` · ${data.counts.open}` : ''}
        </button>
      </div>

      {view === 'week' && (
        <Week data={data} onToggle={(id) => toggle.mutate(id)} onShift={shift}
              openMeal={openMeal} setOpenMeal={setOpenMeal} />
      )}
      {view === 'shop' && <Shop data={data} onToggle={(id) => toggle.mutate(id)} />}
      {view === 'list' && (
        <Plain
          data={data} onToggle={(id) => toggle.mutate(id)}
          // Jump to the meal an ingredient came from: move the board to that
          // meal's week, expand it, and switch views. `week` is any date IN the
          // week — the server snaps it to the Monday.
          onGoToMeal={(m) => { setWeek(m.day); setOpenMeal(m.id); setView('week') }}
        />
      )}
    </div>
  )
}

// ── Week board ───────────────────────────────────────────────────────────────

function Week({ data, onToggle, onShift, openMeal, setOpenMeal }: {
  data: NonNullable<ReturnType<typeof useLists>['data']>
  onToggle: (id: number) => void
  onShift: (n: number) => void
  openMeal: number | null
  setOpenMeal: (id: number | null) => void
}) {
  const [addingTo, setAddingTo] = useState<string | null>(null)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => onShift(-1)} style={nav} aria-label="Previous week">‹</button>
        <span style={label()}>
          {dayLabel(data.weekStart)} – {dayLabel(data.weekEnd)}
        </span>
        <button onClick={() => onShift(1)} style={nav} aria-label="Next week">›</button>
      </div>

      {data.days.map((d) => (
        <div key={d.day} style={section()}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={label(d.isToday ? { color: T.accent } : {})}>
              {dayLabel(d.day)}{d.isToday ? ' · today' : ''}
            </span>
            {d.itemCount > 0 && (
              <span style={label()}>{d.openCount} of {d.itemCount}</span>
            )}
          </div>

          {d.meals.length === 0 && (
            <div style={{ ...body(14), color: T.faint, marginTop: 10 }}>Nothing planned</div>
          )}

          {d.meals.map((m) => (
            <MealBlock key={m.id} meal={m} open={openMeal === m.id}
                       onOpen={() => setOpenMeal(openMeal === m.id ? null : m.id)}
                       onToggle={onToggle} />
          ))}

          {addingTo === d.day ? (
            <AddMeal day={d.day} onDone={() => setAddingTo(null)} />
          ) : (
            <button onClick={() => setAddingTo(d.day)} style={textBtn}>+ Add meal</button>
          )}
        </div>
      ))}
    </>
  )
}

function MealBlock({ meal, open, onOpen, onToggle }: {
  meal: Meal; open: boolean; onOpen: () => void; onToggle: (id: number) => void
}) {
  const addItem = useAddListItem()
  const delMeal = useDeleteMeal()
  const [text, setText] = useState('')
  const ref = useRef<HTMLDivElement | null>(null)

  // Arriving from "from Taco night" on the plain list lands on the week board
  // with this meal already expanded — useless if it's four days down a
  // scrolling page. Only scrolls when the row is actually off-screen, so
  // expanding one by hand doesn't yank the page around under your thumb.
  useEffect(() => {
    if (!open) return
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const offscreen = r.top < 0 || r.bottom > window.innerHeight
    if (offscreen) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [open])

  return (
    <div ref={ref}>
      <div onClick={onOpen} style={row({ cursor: 'pointer' })}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...body(15), wordBreak: 'break-word' }}>{meal.title}</div>
          {meal.items.length > 0 && (
            <div style={label({ marginTop: 4, letterSpacing: '0.1em' })}>
              {meal.items.filter((i) => !i.checked_at).length} of {meal.items.length} to get
            </div>
          )}
        </div>
        <span style={label()}>{open ? '−' : '+'}</span>
      </div>

      {open && (
        <div style={{ paddingLeft: 14, paddingBottom: 12 }}>
          {meal.items.map((i) => (
            <div key={i.id} style={row({ padding: '9px 0' })}>
              <button onClick={() => onToggle(i.id)} style={checkbox(!!i.checked_at, 17)}
                      aria-label={i.checked_at ? 'Uncheck' : 'Check'}>
                {i.checked_at ? '✓' : ''}
              </button>
              <span style={{ ...body(14), ...doneText(!!i.checked_at), flex: 1, minWidth: 0 }}>
                {i.text}{i.qty ? ` · ${i.qty}` : ''}
              </span>
            </div>
          ))}

          <form onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (!text.trim()) return
            addItem.mutate({ text: text.trim(), mealId: meal.id })
            setText('')
          }} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input style={{ ...input(), flex: 1, minHeight: 38, fontSize: 16 }}
                   placeholder="Ingredient…" value={text} onChange={(e) => setText(e.target.value)} />
            <button type="submit" disabled={!text.trim()}
                    style={{ ...button(text.trim() ? 'primary' : 'ghost'), minHeight: 38, padding: '8px 13px' }}>
              Add
            </button>
          </form>

          <div style={label({ marginTop: 10, letterSpacing: '0.06em' })}>
            Ingredients go straight onto the shopping list
          </div>
          <button onClick={() => delMeal.mutate(meal.id)}
                  style={{ ...segment(false), marginTop: 10, color: T.bad, borderColor: 'rgba(239,68,68,0.35)' }}>
            Remove meal
          </button>
          <div style={label({ marginTop: 8, letterSpacing: '0.06em' })}>
            Its items stay on the list — you may still need them
          </div>
        </div>
      )}
    </div>
  )
}

function AddMeal({ day, onDone }: { day: string; onDone: () => void }) {
  const add = useAddMeal()
  const [title, setTitle] = useState('')
  return (
    <form onSubmit={(e: FormEvent) => {
      e.preventDefault()
      if (!title.trim()) return
      add.mutate({ day, title: title.trim() })
      setTitle(''); onDone()
    }} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
      <input style={{ ...input(), flex: 1 }} placeholder="What's for dinner?" value={title}
             onChange={(e) => setTitle(e.target.value)} autoFocus />
      <button type="button" onClick={onDone} style={segment(false)}>Cancel</button>
      <button type="submit" disabled={!title.trim()}
              style={{ ...button(title.trim() ? 'primary' : 'ghost'), padding: '12px 14px' }}>Add</button>
    </form>
  )
}

// ── Shop mode ────────────────────────────────────────────────────────────────

/**
 * A MODE, not a screen. Bigger targets, aisle order, ticked items drop out of
 * the walk and into a short "in the cart" list at the bottom.
 */
function Shop({ data, onToggle }: {
  data: NonNullable<ReturnType<typeof useLists>['data']>
  onToggle: (id: number) => void
}) {
  const clear = useClearChecked()
  const done = data.counts.total - data.counts.open
  const pct = data.counts.total ? (done / data.counts.total) * 100 : 0

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14 }}>
        <div style={hero(44)}>{data.counts.open}</div>
        <div style={{ flex: 1, paddingBottom: 8 }}>
          <div style={{ height: 3, background: T.paperSunk }}>
            <div style={{ width: `${pct}%`, height: '100%', background: T.accent, transition: 'width 160ms' }} />
          </div>
          <div style={label({ marginTop: 8, letterSpacing: '0.1em' })}>
            {done} of {data.counts.total} in the cart
          </div>
        </div>
      </div>

      {data.counts.open === 0 && data.counts.total === 0 && (
        <div style={{ ...body(14), color: T.muted }}>Nothing on the list.</div>
      )}

      {data.aisles.map((g) => (
        <div key={g.aisle} style={section()}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={sectionTitle()}>{AISLE_LABEL[g.aisle]}</span>
            <span style={label()}>{g.items.length}</span>
          </div>
          {g.items.map((i) => (
            // 16px padding and a 26px box: this is tapped one-handed, in a
            // shop, holding something else.
            <div key={i.id} onClick={() => onToggle(i.id)} style={row({ padding: '16px 0', cursor: 'pointer' })}>
              <div style={checkbox(false, 26)} />
              <span style={{ ...body(17), flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                {i.text}{i.qty ? <span style={{ color: T.muted }}> · {i.qty}</span> : null}
              </span>
            </div>
          ))}
        </div>
      ))}

      {data.checked.length > 0 && (
        <div style={section()}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={sectionTitle()}>In the cart</span>
            <span style={label()}>{data.checked.length}</span>
          </div>
          {data.checked.map((i) => (
            <div key={i.id} onClick={() => onToggle(i.id)} style={row({ padding: '10px 0', cursor: 'pointer' })}>
              <div style={checkbox(true, 20)}>✓</div>
              <span style={{ ...body(14), ...doneText(true), flex: 1, minWidth: 0 }}>{i.text}</span>
            </div>
          ))}
          <button onClick={() => clear.mutate(undefined as never)}
                  style={{ ...button('ghost'), width: '100%', marginTop: 14 }}>
            {clear.isPending ? 'Clearing…' : 'Done shopping — clear the cart'}
          </button>
          <div style={label({ marginTop: 9, letterSpacing: '0.06em' })}>
            Removes what you bought. Meal ingredients stay on the week board.
          </div>
        </div>
      )}
    </>
  )
}

// ── Plain list ───────────────────────────────────────────────────────────────

function Plain({ data, onToggle, onGoToMeal }: {
  data: NonNullable<ReturnType<typeof useLists>['data']>
  onToggle: (id: number) => void
  onGoToMeal: (meal: MealRef) => void
}) {
  const add = useAddListItem()
  const del = useDeleteListItem()
  const [text, setText] = useState('')
  const [aisle, setAisle] = useState<Aisle | ''>('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || add.isPending) return
    setText(''); setError(null)
    try { await add.mutateAsync({ text: t, aisle: aisle || undefined }) }
    catch (err) { setText(t); setError(err instanceof ApiError ? err.message : 'Could not add that.') }
  }

  const all: ListItem[] = [...data.aisles.flatMap((g) => g.items), ...data.checked]
  // Covers meals outside the week on screen too — see mealRefs in the lists
  // payload.
  const mealById = new Map((data.mealRefs ?? []).map((m) => [m.id, m]))

  return (
    <>
      <form onSubmit={submit}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...input(), flex: 1 }} placeholder="Add to the list…" value={text}
                 onChange={(e) => setText(e.target.value)} enterKeyHint="done" />
          <button type="submit" disabled={!text.trim()}
                  style={{ ...button(text.trim() ? 'primary' : 'ghost'), padding: '12px 15px' }}>Add</button>
        </div>
        <div style={{ display: 'flex', gap: 5, marginTop: 9, flexWrap: 'wrap' }}>
          {/* Left blank, the aisle is guessed from the name. These are for
              overriding a guess, not for filling in every time. */}
          <button type="button" onClick={() => setAisle('')} style={segment(aisle === '')}>Auto</button>
          {data.aisleOptions.map((a) => (
            <button key={a} type="button" onClick={() => setAisle(a)} style={segment(aisle === a)}>
              {AISLE_LABEL[a]}
            </button>
          ))}
        </div>
        {error && <div style={label({ color: T.bad, marginTop: 9, letterSpacing: '0.06em' })}>{error}</div>}
      </form>

      <div style={section()}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={sectionTitle()}>Grocery</span>
          <span style={label()}>{data.counts.open} to get</span>
        </div>
        {all.length === 0 && <div style={{ ...body(14), color: T.muted, marginTop: 10 }}>Nothing here yet.</div>}
        {all.map((i) => (
          <div key={i.id} style={row()}>
            <button onClick={() => onToggle(i.id)} style={checkbox(!!i.checked_at)}
                    aria-label={i.checked_at ? 'Uncheck' : 'Check'}>
              {i.checked_at ? '✓' : ''}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...body(15), ...doneText(!!i.checked_at), wordBreak: 'break-word' }}>
                {i.text}{i.qty ? ` · ${i.qty}` : ''}
              </div>
              <div style={label({ marginTop: 3, letterSpacing: '0.1em' })}>
                {AISLE_LABEL[i.aisle]}
                {/* Which meal, and when it's on — not just "from a meal". If
                    the ingredient is on the list because of Thursday's curry,
                    that IS the useful fact, and tapping it goes there. */}
                {i.meal_id && (() => {
                  const m = mealById.get(i.meal_id!)
                  if (!m) {
                    // The meal was deleted; its items deliberately stay. Say the
                    // honest thing rather than linking nowhere.
                    return <span style={{ color: T.faint }}> · from a meal</span>
                  }
                  return (
                    <>
                      {' · '}
                      <button
                        onClick={(e) => { e.stopPropagation(); onGoToMeal(m) }}
                        style={mealLink}
                      >
                        {m.title} · {dayLabelLong(m.day)} ›
                      </button>
                    </>
                  )
                })()}
                {' · '}
                <span title={full(i.checked_at ?? i.created_at)}>
                  {i.checked_at ? `checked ${when(i.checked_at)}` : `added ${when(i.created_at)}`}
                </span>
              </div>
            </div>
            {/* Anyone in the household can remove anything. The old app hid this
                unless you were the row's owner, which meant the person who put
                milk on the list was the only one allowed to take it off — a rule
                that made sense when rows had owners and makes none now that the
                list belongs to the household. */}
            <button onClick={() => del.mutate(i.id)} aria-label="Delete"
                    style={{ background: 'none', border: 'none', color: T.faint, fontSize: 17,
                             cursor: 'pointer', padding: '0 4px', minHeight: 32 }}>×</button>
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * When something went on the list — ALWAYS a day and a time.
 *
 *   Today 2:14 PM · Yesterday 8:41 AM · Tue 8:41 AM · Aug 3, 4:20 PM
 *
 * It used to print a bare "2:14 PM" for today and a bare "Jul 3" for anything
 * over a week old, which meant the two things you actually want to know — how
 * long has this been sitting here, and was it before or after the last shop —
 * were each missing exactly when they mattered. The day names carry the recent
 * end; the explicit date carries the rest; the time is on all of them.
 *
 * Parsed with `new Date()` on purpose: unlike a due date, created_at is a real
 * TIMESTAMPTZ with an offset, so it converts to local time correctly. The
 * date-ONLY fields elsewhere in this app must never be parsed this way — see
 * dayLabel above.
 */
function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  // Compared as calendar days, not as a 24-hour difference: something added at
  // 11pm last night is "Yesterday", not "today, 9 hours ago".
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000)

  if (days === 0) return `Today ${time}`
  if (days === 1) return `Yesterday ${time}`
  if (days > 1 && days < 7) return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
  const sameYear = d.getFullYear() === now.getFullYear()
  const date = d.toLocaleDateString('en-US',
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
  return `${date}, ${time}`
}

/** The unabbreviated timestamp, for the hover title. */
function full(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

/** The meal link on a list row. A button, not an <a> — it changes view state,
 *  it does not navigate, and a fake href would break middle-click. */
const mealLink: React.CSSProperties = {
  ...label({ color: T.accent, letterSpacing: '0.1em' }),
  background: 'none', border: 'none', padding: 0, margin: 0,
  cursor: 'pointer', textAlign: 'left',
}

const textBtn: React.CSSProperties = {
  ...label({ color: T.accent }),
  background: 'none', border: 'none', cursor: 'pointer',
  padding: '11px 0', minHeight: 40, textAlign: 'left',
}

const nav: React.CSSProperties = {
  appearance: 'none', width: 40, height: 40, borderRadius: 3,
  border: `1px solid ${T.ruleStrong}`, background: 'transparent',
  color: T.ink, fontSize: 17, cursor: 'pointer', lineHeight: 1,
}
