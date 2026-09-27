import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import {
  useLists, useToggleListItem, useAddListItem, useDeleteListItem,
  useClearChecked, useDeleteMeal,
  useMealLibrary, useSetDinner, useMoveDinner, useAddLibraryMeal, useDeleteLibraryMeal,
} from '../hooks'
import { ApiError, type Aisle, type ListItem, type Meal, type MealRef, type LibraryMeal } from '../api'
import { T, SERIF, sectionTitle, label, body, hero, section, row, input, button, segment, checkbox, doneText } from '../theme'

/**
 * Lists — three views over the SAME two tables.
 *
 *   Week — one dinner per day beside a meal library (Cookbook + quick
 *          meals); each dinner's ingredients open under it.
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
          data={data} me={user.id} onToggle={(id) => toggle.mutate(id)}
          // Jump to the meal an ingredient came from: move the board to that
          // meal's week, expand it, and switch views. `week` is any date IN the
          // week — the server snaps it to the Monday.
          onGoToMeal={(m) => { setWeek(m.day); setOpenMeal(m.id); setView('week') }}
        />
      )}
    </div>
  )
}

// ── Week board: the dinner planner ───────────────────────────────────────────
//
// One dinner per day, Monday to Sunday, with the meal library beside it (under
// it on a phone). Three ways to fill a day:
//
//   1. Drag a meal from the library onto a day (desktop).
//   2. Type in the day's search box and pick from the library — or press Enter
//      on anything to use it as a one-off dinner.
//   3. Tap a meal in the library, then tap the day (the phone path — HTML5
//      drag and drop does nothing on touch screens).
//
// Dragging a planned dinner onto another day moves it, swapping if that day
// already has one. Tapping a dinner opens its ingredients, which are the same
// hh_list_items rows the grocery list shows.
//
// The library is the Cookbook's recipes (grouped by main ingredient) plus quick
// meals kept in hh_meal_library. Categories fold; the open set is remembered
// per browser.

type Drag = { kind: 'lib'; title: string; recipeId?: number } | { kind: 'day'; from: string }

/** What's being dragged. dataTransfer can't be read during dragover, so the
 *  payload lives here and the transfer only carries a token. */
let dragging: Drag | null = null

const LIB_OPEN_KEY = 'budget.dinnerLibrary.open'

function useWide(q = '(min-width: 860px)') {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [q])
  return wide
}

function Week({ data, onToggle, onShift, openMeal, setOpenMeal }: {
  data: NonNullable<ReturnType<typeof useLists>['data']>
  onToggle: (id: number) => void
  onShift: (n: number) => void
  openMeal: number | null
  setOpenMeal: (id: number | null) => void
}) {
  const wide = useWide()
  const lib = useMealLibrary()
  const setDinner = useSetDinner()
  const moveDinner = useMoveDinner()
  const delMeal = useDeleteMeal()
  // A library meal tapped on a phone, waiting for a day to be tapped.
  const [armed, setArmed] = useState<LibraryMeal | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const items = lib.data?.items ?? []
  const planned = new Set(data.days.map((d) => d.meals[0]?.title).filter(Boolean) as string[])
  const filled = data.days.filter((d) => d.meals.length > 0).length
  const busy = setDinner.isPending || moveDinner.isPending
  const err = setDinner.error || moveDinner.error

  const pick = (day: string, m: { title: string; recipeId?: number }) => {
    setDinner.mutate({ day, title: m.title, recipeId: m.recipeId })
    setArmed(null)
  }

  const onDrop = (day: string) => {
    const d = dragging
    dragging = null
    setOver(null)
    if (!d) return
    if (d.kind === 'lib') pick(day, d)
    else if (d.from !== day) moveDinner.mutate({ from: d.from, to: day })
  }

  const week = (
    <div style={section()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={sectionTitle()}>Dinners</span>
        <span style={label()}>
          {filled} of 7{filled < 7 && <span style={{ color: T.warn }}> · {7 - filled} open</span>}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 0 4px' }}>
        <button onClick={() => onShift(-1)} style={nav} aria-label="Previous week">‹</button>
        <span style={label()}>{dayLabel(data.weekStart)} – {dayLabel(data.weekEnd)}</span>
        <button onClick={() => onShift(1)} style={nav} aria-label="Next week">›</button>
      </div>

      {armed && (
        <div style={{ ...label({ color: T.accent, letterSpacing: '0.08em' }), padding: '8px 0' }}>
          Tap a day for “{armed.title}” ·{' '}
          <button onClick={() => setArmed(null)} style={{ ...label({ color: T.accent }), background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
            cancel
          </button>
        </div>
      )}

      {data.days.map((d, idx) => {
        const dinner = d.meals[0]
        const extras = d.meals.slice(1)
        const isOver = over === d.day
        const dow = new Date(Number(d.day.slice(0, 4)), Number(d.day.slice(5, 7)) - 1, Number(d.day.slice(8, 10)))
        return (
          <div
            key={d.day}
            onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(d.day) } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null) }}
            onDrop={(e) => { e.preventDefault(); onDrop(d.day) }}
            onClick={armed ? () => pick(d.day, { title: armed.title, recipeId: armed.kind === 'recipe' ? armed.id : undefined }) : undefined}
            style={{
              borderTop: idx === 0 ? 'none' : `1px solid ${T.rule}`,
              padding: '12px 8px',
              borderRadius: 6,
              background: isOver || armed ? 'rgba(142,202,230,0.06)' : 'transparent',
              boxShadow: isOver ? `inset 0 0 0 1px ${T.accentSoft}` : d.isToday ? `inset 2px 0 0 ${T.accent}` : 'none',
              cursor: armed ? 'pointer' : undefined,
              transition: 'background 120ms',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr auto', gap: 12, alignItems: 'center' }}>
              <div>
                <div style={label(d.isToday ? { color: T.accent } : {})}>
                  {dow.toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
                <div style={{ ...hero(22), marginTop: 4 }}>{dow.getDate()}</div>
              </div>

              {dinner ? (
                <div
                  draggable
                  onDragStart={(e) => { dragging = { kind: 'day', from: d.day }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dinner.title) }}
                  onDragEnd={() => { dragging = null; setOver(null) }}
                  onClick={armed ? undefined : () => setOpenMeal(openMeal === dinner.id ? null : dinner.id)}
                  style={{ minWidth: 0, cursor: armed ? 'pointer' : 'grab' }}
                >
                  <div style={{ fontFamily: SERIF, fontSize: 20, lineHeight: 1.2, wordBreak: 'break-word' }}>{dinner.title}</div>
                  <div style={label({ marginTop: 4, letterSpacing: '0.1em' })}>
                    {dinner.recipe_id ? 'Cookbook' : 'Meal'}
                    {dinner.items.length > 0 && ` · ${dinner.items.filter((i) => !i.checked_at).length} of ${dinner.items.length} to get`}
                    {' · '}<span style={{ color: T.accent }}>{openMeal === dinner.id ? 'Hide' : 'Ingredients'}</span>
                  </div>
                </div>
              ) : armed ? (
                <div style={{ ...body(14), color: T.accent }}>Put it here</div>
              ) : (
                <DinnerSearch items={items} onPick={(m) => pick(d.day, m)} />
              )}

              <div>
                {dinner && !armed && (
                  <button onClick={() => delMeal.mutate(dinner.id)} aria-label={`Remove ${dinner.title}`}
                          style={{ background: 'none', border: 0, color: T.faint, fontSize: 18, cursor: 'pointer', padding: '4px 6px', minHeight: 36 }}>
                    ×
                  </button>
                )}
              </div>
            </div>

            {extras.length > 0 && (
              <div style={label({ marginTop: 6, marginLeft: 68, letterSpacing: '0.06em' })}>
                Also planned: {extras.map((m) => m.title).join(', ')}
              </div>
            )}

            {dinner && openMeal === dinner.id && !armed && (
              <div style={{ marginLeft: 68 }}>
                <MealDetail meal={dinner} onToggle={onToggle} />
              </div>
            )}
          </div>
        )
      })}

      {busy && <div style={label({ marginTop: 8 })}>Saving…</div>}
      {err && <div style={{ ...body(13), color: T.bad, marginTop: 8 }}>{(err as Error).message}</div>}
    </div>
  )

  const library = (
    <LibraryPanel
      loading={lib.isLoading}
      error={lib.error as Error | null}
      items={items}
      categories={lib.data?.categories ?? []}
      planned={planned}
      armed={armed}
      onArm={(m) => setArmed(armed?.key === m.key ? null : m)}
      onDragStart={(m) => { dragging = { kind: 'lib', title: m.title, recipeId: m.kind === 'recipe' ? m.id : undefined } }}
      onDragEnd={() => { dragging = null; setOver(null) }}
    />
  )

  return wide ? (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 14, alignItems: 'start' }}>
      {week}
      <div style={{ position: 'sticky', top: 0 }}>{library}</div>
    </div>
  ) : (
    <>{week}{library}</>
  )
}

/**
 * The search box on an empty day. Filters the whole library as you type;
 * arrows + Enter pick, and Enter on text that matches nothing uses it as a
 * one-off dinner (not saved to the library).
 */
function DinnerSearch({ items, onPick }: {
  items: LibraryMeal[]
  onPick: (m: { title: string; recipeId?: number }) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState(0)
  const needle = q.trim().toLowerCase()
  const hits = (needle ? items.filter((m) => m.title.toLowerCase().includes(needle)) : items).slice(0, 8)
  const exact = hits.some((m) => m.title.toLowerCase() === needle)
  const rows: { title: string; recipeId?: number; sub: string }[] = [
    ...hits.map((m) => ({ title: m.title, recipeId: m.kind === 'recipe' ? m.id : undefined, sub: m.category })),
    ...(needle && !exact ? [{ title: q.trim(), sub: 'One-off' }] : []),
  ]
  const choose = (r: { title: string; recipeId?: number }) => { onPick(r); setQ(''); setOpen(false) }

  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      <input
        style={{ ...input(), minHeight: 40, padding: '9px 11px' }}
        placeholder="Search or drop a meal…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setHl(0); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, rows.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); if (rows[hl]) choose(rows[hl]) }
          else if (e.key === 'Escape') { (e.target as HTMLInputElement).blur() }
        }}
      />
      {open && rows.length > 0 && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', zIndex: 20,
          background: T.paperRaised, border: `1px solid ${T.ruleStrong}`, borderRadius: 6,
          maxHeight: 260, overflowY: 'auto',
        }}>
          {rows.map((r, i) => (
            <div key={`${r.sub}-${r.title}`}
                 // mousedown, not click: click fires after the input's blur has
                 // already closed the list.
                 onMouseDown={(e) => { e.preventDefault(); choose(r) }}
                 onMouseEnter={() => setHl(i)}
                 style={{
                   display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 12px',
                   borderTop: i === 0 ? 'none' : `1px solid ${T.rule}`, cursor: 'pointer',
                   background: i === hl ? 'rgba(142,202,230,0.10)' : 'transparent',
                 }}>
              <span style={{ ...body(14), minWidth: 0, wordBreak: 'break-word' }}>
                {r.sub === 'One-off' ? `Use “${r.title}”` : r.title}
              </span>
              <span style={label({ color: T.faint, whiteSpace: 'nowrap' })}>{r.sub}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function readOpen(): Record<string, boolean> | null {
  try { const v = localStorage.getItem(LIB_OPEN_KEY); return v ? JSON.parse(v) : null } catch { return null }
}
function writeOpen(v: Record<string, boolean>) {
  try { localStorage.setItem(LIB_OPEN_KEY, JSON.stringify(v)) } catch { /* private mode — fine */ }
}

function LibraryPanel({ loading, error, items, categories, planned, armed, onArm, onDragStart, onDragEnd }: {
  loading: boolean
  error: Error | null
  items: LibraryMeal[]
  categories: string[]
  planned: Set<string>
  armed: LibraryMeal | null
  onArm: (m: LibraryMeal) => void
  onDragStart: (m: LibraryMeal) => void
  onDragEnd: () => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpenState] = useState<Record<string, boolean>>(() => readOpen() ?? {})
  const [adding, setAdding] = useState(false)
  const del = useDeleteLibraryMeal()
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  // First visit: open the first category so the panel isn't a wall of headers.
  useEffect(() => {
    if (categories.length && Object.keys(open).length === 0) setOpenState({ [categories[0]]: true })
  }, [categories]) // eslint-disable-line react-hooks/exhaustive-deps

  const setOpen = (v: Record<string, boolean>) => { setOpenState(v); writeOpen(v) }
  const needle = q.trim().toLowerCase()
  const groups = categories
    .map((c) => ({ c, meals: items.filter((m) => m.category === c && (!needle || m.title.toLowerCase().includes(needle))) }))
    .filter((g) => g.meals.length > 0)

  const small = { ...label({ color: T.accent }), background: 'none', border: 0, padding: '6px 0', cursor: 'pointer' }

  return (
    <div style={section()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={sectionTitle()}>Meal library</span>
        <span style={label()}>{items.length} meals</span>
      </div>

      <input style={{ ...input(), marginTop: 10, minHeight: 40, padding: '9px 11px' }}
             placeholder="Search meals…" value={q} onChange={(e) => setQ(e.target.value)} />

      <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
        <button style={small} onClick={() => setOpen(Object.fromEntries(categories.map((c) => [c, true])))}>Expand all</button>
        <button style={small} onClick={() => setOpen({})}>Collapse all</button>
      </div>

      {loading && <div style={{ ...body(14), color: T.faint, padding: '10px 0' }}>Loading…</div>}
      {error && <div style={{ ...body(13), color: T.bad, padding: '10px 0' }}>{error.message}</div>}
      {!loading && !error && groups.length === 0 && (
        <div style={{ ...body(14), color: T.faint, padding: '10px 0' }}>
          {needle ? 'No matches.' : 'No meals yet. Add one below, or import recipes in the Cookbook.'}
        </div>
      )}

      <div style={{ maxHeight: 'min(62vh, 560px)', overflowY: 'auto', marginTop: 4 }}>
        {groups.map(({ c, meals }, gi) => {
          // Searching opens every category with a hit.
          const isOpen = !!needle || !!open[c]
          return (
            <div key={c} style={{ borderTop: gi === 0 ? 'none' : `1px solid ${T.rule}`, padding: '10px 0' }}>
              <button onClick={() => setOpen({ ...open, [c]: !open[c] })}
                      style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center',
                               background: 'none', border: 0, padding: '4px 0', cursor: 'pointer', color: T.ink }}>
                <span style={sectionTitle({ fontSize: 15 })}>{c}</span>
                <span style={label()}>{meals.length} <span style={{ color: T.accent, marginLeft: 6 }}>{isOpen ? '▾' : '▸'}</span></span>
              </button>
              {isOpen && meals.map((m) => {
                const on = armed?.key === m.key
                const used = planned.has(m.title)
                return (
                  <div key={m.key}
                       draggable
                       onDragStart={(e) => { onDragStart(m); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', m.title) }}
                       onDragEnd={onDragEnd}
                       onClick={() => onArm(m)}
                       style={row({
                         padding: '9px 6px', cursor: 'grab', borderRadius: 4,
                         background: on ? 'rgba(142,202,230,0.10)' : 'transparent',
                         boxShadow: on ? `inset 0 0 0 1px ${T.accentSoft}` : 'none',
                       })}>
                    <span style={{ ...body(14), flex: 1, minWidth: 0, wordBreak: 'break-word', color: used ? T.faint : T.ink }}>
                      {m.title}
                      {used && <span style={label({ marginLeft: 8, fontSize: 9, color: T.faint })}>Planned</span>}
                    </span>
                    {m.kind === 'quick' ? (
                      confirmDel === m.key ? (
                        <button onClick={(e) => { e.stopPropagation(); del.mutate(m.id); setConfirmDel(null) }}
                                style={{ ...label({ color: T.bad }), background: 'none', border: 0, cursor: 'pointer', padding: 4 }}>
                          Delete?
                        </button>
                      ) : (
                        <button onClick={(e) => { e.stopPropagation(); setConfirmDel(m.key) }} aria-label={`Delete ${m.title}`}
                                style={{ background: 'none', border: 0, color: T.faint, cursor: 'pointer', padding: '0 4px', fontSize: 15 }}>
                          ×
                        </button>
                      )
                    ) : (
                      <span style={label({ fontSize: 9, color: T.faint })}>Cookbook</span>
                    )}
                    <span aria-hidden style={{ color: T.faint, letterSpacing: '-2px', fontSize: 12 }}>⋮⋮</span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {adding ? (
        <AddLibraryMeal categories={categories} onDone={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} style={{ ...button('primary'), marginTop: 12 }}>+ New meal</button>
      )}
    </div>
  )
}

function AddLibraryMeal({ categories, onDone }: { categories: string[]; onDone: () => void }) {
  const add = useAddLibraryMeal()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const ok = title.trim().length > 0
  return (
    <form onSubmit={(e: FormEvent) => {
      e.preventDefault()
      if (!ok) return
      add.mutate({ title: title.trim(), category: category.trim() || 'Other' }, { onSuccess: onDone })
    }} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
      <input style={input()} placeholder="Meal name" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <input style={input()} placeholder="Category (e.g. Chicken)" value={category}
             onChange={(e) => setCategory(e.target.value)} list="dinner-lib-cats" />
      <datalist id="dinner-lib-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      {add.error && <div style={{ ...body(13), color: T.bad }}>{(add.error as Error).message}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onDone} style={segment(false)}>Cancel</button>
        <button type="submit" disabled={!ok || add.isPending} style={{ ...button(ok ? 'primary' : 'ghost'), flex: 1 }}>
          {add.isPending ? 'Saving…' : 'Add to library'}
        </button>
      </div>
    </form>
  )
}

/** A dinner's ingredients — the same rows the grocery list shows. */
function MealDetail({ meal, onToggle }: { meal: Meal; onToggle: (id: number) => void }) {
  const addItem = useAddListItem()
  const [text, setText] = useState('')
  const ref = useRef<HTMLDivElement | null>(null)

  // Arriving from "from Taco night" on the plain list lands here with this
  // dinner already open — useless if it's four days down the page. Only
  // scrolls when it is actually off-screen.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  return (
    <div ref={ref} style={{ paddingTop: 6, paddingBottom: 4 }}>
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
      }} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input style={{ ...input(), flex: 1, minHeight: 38 }}
               placeholder="Ingredient…" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={!text.trim()}
                style={{ ...button(text.trim() ? 'primary' : 'ghost'), minHeight: 38, padding: '8px 13px' }}>
          Add
        </button>
      </form>
      <div style={label({ marginTop: 8, letterSpacing: '0.06em' })}>
        Ingredients go straight onto the shopping list
      </div>
    </div>
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
            // 18px padding and a 26px box: this is tapped one-handed, in a
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

function Plain({ data, me, onToggle, onGoToMeal }: {
  data: NonNullable<ReturnType<typeof useLists>['data']>
  me: number
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
  // Covers meals outside the week on screen too — see mealRefs in
  // _lib-household-lists.cjs.
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
                    // The meal was deleted; its items deliberately stay (ON
                    // DELETE SET NULL is pending on the next read). Say the
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
            {i.owner_id === me && (
              <button onClick={() => del.mutate(i.id)} aria-label="Delete"
                      style={{ background: 'none', border: 'none', color: T.faint, fontSize: 17,
                               cursor: 'pointer', padding: '0 4px', minHeight: 32 }}>×</button>
            )}
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

const nav: React.CSSProperties = {
  appearance: 'none', width: 40, height: 40, borderRadius: 3,
  border: `1px solid ${T.ruleStrong}`, background: 'transparent',
  color: T.ink, fontSize: 17, cursor: 'pointer', lineHeight: 1,
}
