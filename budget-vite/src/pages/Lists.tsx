import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../auth'
import {
  useLists, useToggleListItem, useAddListItem, useDeleteListItem,
  useClearChecked, useDeleteMeal,
  useMeals, usePreviewLink, useAddLibraryMeal, useUpdateLibraryMeal, useDeleteLibraryMeal, useMarkMade,
  useAddCategory, useRenameCategory, useMoveCategory, useDeleteCategory, usePlanMeal,
  useImportItems, useImportMeals,
} from '../hooks'
import { ApiError, lists as listsApi, type Aisle, type ListItem, type Meal, type MealRef, type LibraryMeal, type MealCategory, type ResolvedLink } from '../api'
import { T, SERIF, MONO, SANS, sectionTitle, label, body, hero, section, row, input, button, segment, checkbox, doneText } from '../theme'

/**
 * Lists — four views. Three are over the SAME two tables (meals, items):
 *
 *   Week — the seven dinners; tap one for its link, made-it and ingredients.
 *   Meals — your meal list (hh_meal_library): import links, categories,
 *          pick a day, mark made. Planning writes the Week's hh_meals rows.
 *   Shop — every unchecked item, grouped in store-walk order.
 *   List — the plain grocery list plus anything not tied to a meal.
 *
 * Ticking "tortillas" in Shop marks the same row that sits under Tuesday on
 * Week. Any design where shopping generates separate rows ends with the two
 * views disagreeing about what you actually bought.
 */

type View = 'week' | 'meals' | 'shop' | 'list'

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
        <button onClick={() => setView('meals')} style={segment(view === 'meals')}>Meals</button>
        <button onClick={() => setView('shop')} style={segment(view === 'shop')}>
          Shop{data.counts.open > 0 ? ` · ${data.counts.open}` : ''}
        </button>
      </div>

      {view === 'week' && (
        <Week data={data} onToggle={(id) => toggle.mutate(id)} onShift={shift}
              openMeal={openMeal} setOpenMeal={setOpenMeal} onPlan={() => setView('meals')} />
      )}
      {view === 'meals' && <Meals week={data} onShift={shift} />}
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

// ── Week: the seven dinners ──────────────────────────────────────────────────
//
// Just the week. One dinner per day ("the dinner" is the day's first meal);
// planning happens on the Meals tab. Tapping a dinner opens a sheet with its
// link, "made it" and its ingredients (the same rows the grocery list shows).
// Today is marked in its label only.

const dateOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const shortDate = (iso: string) =>
  dateOf(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function Week({ data, onToggle, onShift, openMeal, setOpenMeal, onPlan }: {
  data: NonNullable<ReturnType<typeof useLists>['data']>
  onToggle: (id: number) => void
  onShift: (n: number) => void
  openMeal: number | null
  setOpenMeal: (id: number | null) => void
  onPlan: () => void
}) {
  const delMeal = useDeleteMeal()
  const filled = data.days.filter((d) => d.meals.length > 0).length
  const open = data.days.flatMap((d) => d.meals).find((m) => m.id === openMeal) ?? null

  return (
    <>
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

        {data.days.map((d, idx) => {
          const dinner = d.meals[0]
          const extras = d.meals.slice(1)
          const dt = dateOf(d.day)
          return (
            <div key={d.day} style={{ borderTop: idx === 0 ? 'none' : `1px solid ${T.rule}`, padding: '12px 2px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr auto', gap: 12, alignItems: 'center' }}>
                <div>
                  <div style={label(d.isToday ? { color: T.accent } : {})}>
                    {dt.toLocaleDateString('en-US', { weekday: 'short' })}{d.isToday ? ' · Today' : ''}
                  </div>
                  <div style={{ ...hero(22), marginTop: 4 }}>{dt.getDate()}</div>
                </div>
                {dinner ? (
                  <button onClick={() => setOpenMeal(dinner.id)}
                          style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', color: T.ink, cursor: 'pointer', minWidth: 0 }}>
                    <div style={{ fontFamily: SERIF, fontSize: 20, lineHeight: 1.2, wordBreak: 'break-word' }}>{dinner.title}</div>
                    <div style={label({ marginTop: 4, letterSpacing: '0.1em' })}>
                      {[dinner.category,
                        dinner.library_id ? (dinner.made_count ? `Made ${dinner.made_count}×` : 'New') : null,
                        dinner.items.length ? `${dinner.items.filter((i) => !i.checked_at).length} of ${dinner.items.length} to get` : null,
                      ].filter(Boolean).join(' · ')}
                      {dinner.url && <span style={{ color: T.accent }}>{' · '}Link ↗</span>}
                    </div>
                  </button>
                ) : (
                  <button onClick={onPlan} style={{ ...label({ color: T.accent }), background: 'none', border: 0, padding: '10px 0', textAlign: 'left', cursor: 'pointer' }}>
                    Plan from Meals ›
                  </button>
                )}
                <div>
                  {dinner && (
                    <button onClick={() => delMeal.mutate(dinner.id)} aria-label={`Remove ${dinner.title}`}
                            style={{ background: 'none', border: 0, color: T.faint, fontSize: 18, cursor: 'pointer', padding: '4px 8px', minHeight: 40 }}>
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
            </div>
          )
        })}
      </div>

      {open && <DinnerSheet meal={open} onToggle={onToggle} onClose={() => setOpenMeal(null)} />}
    </>
  )
}

/** Bottom sheet over the week: link, made-it, ingredients. */
function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 560, maxHeight: '85dvh', overflowY: 'auto',
        background: T.paperRaised, borderTop: `1px solid ${T.ruleStrong}`, borderRadius: '18px 18px 0 0',
        padding: '10px 16px calc(20px + env(safe-area-inset-bottom))',
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: T.ruleStrong, margin: '0 auto 12px' }} />
        {children}
      </div>
    </div>
  )
}

function DinnerSheet({ meal, onToggle, onClose }: { meal: Meal; onToggle: (id: number) => void; onClose: () => void }) {
  const made = useMarkMade()
  return (
    <Sheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={label()}>{[meal.category, meal.source].filter(Boolean).join(' · ') || shortDate(meal.day)}</span>
        <button onClick={onClose} aria-label="Close" style={xBtn}>×</button>
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 24, lineHeight: 1.2, margin: '4px 0' }}>{meal.title}</div>
      <div style={label({ letterSpacing: '0.1em' })}>
        {dateOf(meal.day).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        {meal.library_id ? (meal.made_count ? ` · Made ${meal.made_count}×${meal.last_made ? `, last ${shortDate(meal.last_made)}` : ''}` : ' · New') : ''}
      </div>

      {meal.url && <LinkButton url={meal.url} source={meal.source} />}
      {meal.library_id ? (
        <MadeButton count={meal.made_count ?? 0} busy={made.isPending}
                    onMade={() => made.mutate({ id: meal.library_id! })} />
      ) : (
        <div style={{ ...body(13), color: T.faint, marginTop: 12 }}>Typed-in dinner, so there's no link or made count.</div>
      )}

      <div style={label({ marginTop: 16 })}>Ingredients</div>
      <MealDetail meal={meal} onToggle={onToggle} />
    </Sheet>
  )
}

function LinkButton({ url, source }: { url: string; source: string | null | undefined }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{
      display: 'flex', flexDirection: 'column', gap: 2, marginTop: 12, padding: '10px 12px', minHeight: 44,
      border: `1px solid ${T.ruleStrong}`, borderRadius: 3, color: T.accent, textDecoration: 'none',
    }}>
      <span style={body(15)}><span style={{ color: T.accent }}>Open on {source || 'the web'} ↗</span></span>
      <span style={{ fontFamily: MONO, fontSize: 11, color: T.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
    </a>
  )
}

function MadeButton({ count, onMade, busy, sub }: { count: number; onMade: () => void; busy?: boolean; sub?: string }) {
  return (
    <button onClick={onMade} disabled={busy} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%', marginTop: 10, minHeight: 44, padding: '0 12px',
      background: 'none', border: `1px solid ${T.ruleStrong}`, borderRadius: 3, color: T.ink, cursor: 'pointer',
    }}>
      <span style={checkbox(count > 0, 20)}>{count > 0 ? '✓' : ''}</span>
      <span style={{ ...body(14), flex: 1, textAlign: 'left' }}>{count > 0 ? `Made ${count}×${sub ? ` · ${sub}` : ''}` : 'Not made yet'}</span>
      <span style={label({ color: T.accent })}>{count > 0 ? '+1 today' : 'Mark made'}</span>
    </button>
  )
}

const xBtn: React.CSSProperties = {
  background: 'none', border: 0, color: T.faint, fontSize: 20, cursor: 'pointer', padding: '4px 8px', minHeight: 40,
}

/** A dinner's ingredients — the same rows the grocery list shows. */
function MealDetail({ meal, onToggle }: { meal: Meal; onToggle: (id: number) => void }) {
  const addItem = useAddListItem()
  const [text, setText] = useState('')
  return (
    <div style={{ paddingTop: 2 }}>
      {meal.items.length === 0 && <div style={{ ...body(13), color: T.faint, padding: '6px 0' }}>None yet.</div>}
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
        <input style={{ ...input(), flex: 1, minHeight: 40 }}
               placeholder="Ingredient…" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={!text.trim()}
                style={{ ...button(text.trim() ? 'primary' : 'ghost'), minHeight: 40, padding: '8px 13px' }}>
          Add
        </button>
      </form>
      <div style={label({ marginTop: 8, letterSpacing: '0.06em' })}>
        Ingredients go straight onto the shopping list
      </div>
    </div>
  )
}

// ── Meals: import, the list, pick a day ──────────────────────────────────────
//
// Your own list of dinners, grouped by category, each collapsed until tapped.
// Paste a link (usually TikTok) or type a name at the top; tap a meal to pick
// its day for the week shown on the Week tab, mark it made, open its link,
// move it to another category, rename or delete it. Categories are yours to
// add, rename, reorder and delete ("Other" catches the rest).

const OPEN_KEY = 'budget.meals.openCats'
const readOpenCats = (): Record<string, boolean> => {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {} } catch { return {} }
}
const writeOpenCats = (v: Record<string, boolean>) => {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(v)) } catch { /* private mode */ }
}

type Filter = 'all' | 'new' | 'made'

function Meals({ week, onShift }: {
  week: NonNullable<ReturnType<typeof useLists>['data']>
  onShift: (n: number) => void
}) {
  const { data, isLoading, error } = useMeals()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [openCats, setOpenCatsState] = useState<Record<string, boolean>>(readOpenCats)
  const [openItem, setOpenItem] = useState<number | null>(null)
  const [editCats, setEditCats] = useState(false)
  const setOpenCats = (v: Record<string, boolean>) => { setOpenCatsState(v); writeOpenCats(v) }

  if (isLoading) return <div style={{ ...body(14), color: T.faint }}>Loading…</div>
  if (error || !data) return <div style={{ ...body(14), color: T.bad }}>{(error as Error)?.message || 'Could not load meals.'}</div>

  const needle = q.trim().toLowerCase()
  const pass = (m: LibraryMeal) =>
    (!needle || m.title.toLowerCase().includes(needle)) &&
    (filter === 'all' || (filter === 'new' ? m.made_count === 0 : m.made_count > 0))
  const groups = data.categories
    .map((c) => ({ c, meals: data.meals.filter((m) => m.category === c.name && pass(m)) }))
    .filter((g) => g.meals.length > 0 || (!needle && filter === 'all'))

  // Which day of the week on screen each meal sits on.
  const planned = new Map<number, string[]>()
  for (const d of week.days) {
    const m = d.meals[0]
    if (m?.library_id) planned.set(m.library_id, [...(planned.get(m.library_id) ?? []), d.day])
  }

  return (
    <>
      <Importer categories={data.categories.map((c) => c.name)} titles={data.meals.map((m) => m.title)}
                onSaved={(m) => { setOpenCats({ ...openCats, [m.category]: true }); setOpenItem(m.id) }}
                onImported={(cats) => setOpenCats({ ...openCats, ...Object.fromEntries(cats.map((c) => [c, true])) })} />

      <div style={section()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <span style={sectionTitle()}>My meals</span>
          <span style={label()}>
            {data.meals.length} ·{' '}
            <button onClick={() => setEditCats(true)} style={{ ...label({ color: T.accent }), background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
              Edit categories
            </button>
          </span>
        </div>

        <input style={{ ...input(), marginTop: 10 }} placeholder="Search meals…" value={q} onChange={(e) => setQ(e.target.value)} />

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '10px 0 2px' }}>
          {([['all', 'All'], ['new', 'Not tried'], ['made', 'Made']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} style={segment(filter === k)}>{l}</button>
          ))}
          <span style={{ flex: 1 }} />
          <button onClick={() => { setOpenCats({}); setOpenItem(null) }}
                  style={{ ...label({ color: T.accent }), background: 'none', border: 0, cursor: 'pointer', padding: '8px 0' }}>
            Collapse all
          </button>
        </div>

        {data.meals.length === 0 && (
          <div style={{ ...body(14), color: T.faint, padding: '12px 0 4px' }}>No meals yet. Paste a link above to start.</div>
        )}
        {data.meals.length > 0 && groups.length === 0 && (
          <div style={{ ...body(14), color: T.faint, padding: '12px 0 4px' }}>No matches.</div>
        )}

        {data.meals.length > 0 && groups.map(({ c, meals }, gi) => {
          const isOpen = !!needle || filter !== 'all' || !!openCats[c.name]
          return (
            <div key={c.id} style={{ borderTop: gi === 0 ? 'none' : `1px solid ${T.rule}`, padding: '4px 0' }}>
              <button onClick={() => setOpenCats({ ...openCats, [c.name]: !openCats[c.name] })}
                      style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center',
                               background: 'none', border: 0, color: T.ink, cursor: 'pointer', padding: '8px 0', minHeight: 44 }}>
                <span style={sectionTitle({ fontSize: 15 })}>{c.name}</span>
                <span style={label()}>{meals.length}<span style={{ color: T.accent, marginLeft: 8 }}>{isOpen ? '▾' : '▸'}</span></span>
              </button>
              {isOpen && meals.length === 0 && <div style={{ ...body(13), color: T.faint, padding: '0 0 8px' }}>Empty</div>}
              {isOpen && meals.map((m) => (
                <MealItem key={m.id} meal={m} week={week} categories={data.categories.map((x) => x.name)}
                          days={planned.get(m.id) ?? []} open={openItem === m.id}
                          onToggle={() => setOpenItem(openItem === m.id ? null : m.id)} onShift={onShift} />
              ))}
            </div>
          )
        })}
      </div>

      {editCats && <CategoryEditor categories={data.categories} onClose={() => setEditCats(false)} />}
    </>
  )
}

function Importer({ categories, titles, onSaved, onImported }: {
  categories: string[]
  titles: string[]
  onSaved: (m: LibraryMeal) => void
  onImported: (categories: string[]) => void
}) {
  const preview = usePreviewLink()
  const add = useAddLibraryMeal()
  const [bulk, setBulk] = useState(false)
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<{ title: string; category: string; url: string | null; source: string | null } | null>(null)
  const isLink = (s: string) => /^https?:\/\//i.test(s.trim()) || /(tiktok|instagram|youtu)\S*\.\S+/i.test(s)

  const start = (e: FormEvent) => {
    e.preventDefault()
    const v = q.trim()
    if (!v) return
    if (isLink(v)) {
      const url = /^https?:\/\//i.test(v) ? v : `https://${v}`
      setDraft(null)
      preview.mutate(url, {
        onSuccess: ({ preview: p }) => { setDraft({ title: p.title, category: p.category, url: p.url, source: p.source }); setQ('') },
      })
    } else {
      setDraft({ title: v, category: categories.includes('Other') ? 'Other' : categories[0] ?? 'Other', url: null, source: null })
      setQ('')
    }
  }

  return (
    <div style={section()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span style={sectionTitle()}>Add a meal</span>
        <span style={label()}>TikTok · Insta · web</span>
      </div>
      <form onSubmit={start} style={{ display: 'flex', gap: 6 }}>
        <input style={{ ...input(), flex: 1 }} placeholder="Paste a TikTok link or type a meal"
               value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        <button type="submit" disabled={!q.trim() || preview.isPending} style={{ ...button(q.trim() ? 'primary' : 'ghost'), padding: '12px 14px' }}>
          Add
        </button>
        <button type="button" onClick={() => setBulk(true)} style={{ ...button('ghost'), padding: '12px 12px' }}>
          Import
        </button>
      </form>
      {bulk && (
        <BulkImport mode="meals" existing={titles}
                    onDone={onImported} onClose={() => setBulk(false)} />
      )}

      {preview.isPending && <div style={{ ...body(14), color: T.faint, marginTop: 10 }}>Reading the link…</div>}
      {preview.error && <div style={{ ...body(13), color: T.bad, marginTop: 10 }}>{(preview.error as Error).message}</div>}

      {draft && (
        <div style={{ marginTop: 12, padding: 12, border: `1px solid ${T.accentSoft}`, borderRadius: 10, background: 'rgba(142,202,230,0.05)' }}>
          {draft.url && <div style={label({ marginBottom: 6 })}>{draft.source} · {draft.title ? 'check the name' : 'name it'}</div>}
          <input style={{ ...input(), fontFamily: SERIF, fontSize: 18 }} placeholder="Meal name" value={draft.title}
                 onChange={(e) => setDraft({ ...draft, title: e.target.value })} autoFocus={!draft.title} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 8 }}>
            <select style={{ ...input(), appearance: 'auto' }} value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button disabled={!draft.title.trim() || add.isPending}
                    onClick={() => add.mutate({ title: draft.title.trim(), category: draft.category, url: draft.url },
                                              { onSuccess: ({ meal }) => { setDraft(null); onSaved(meal) } })}
                    style={{ ...button(draft.title.trim() ? 'primary' : 'ghost'), padding: '12px 16px' }}>
              {add.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
          {add.error && <div style={{ ...body(13), color: T.bad, marginTop: 8 }}>{(add.error as Error).message}</div>}
          <button onClick={() => setDraft(null)} style={{ ...label({ color: T.faint }), background: 'none', border: 0, cursor: 'pointer', padding: '10px 0 0' }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

function MealItem({ meal, week, categories, days, open, onToggle, onShift }: {
  meal: LibraryMeal
  week: NonNullable<ReturnType<typeof useLists>['data']>
  categories: string[]
  days: string[]
  open: boolean
  onToggle: () => void
  onShift: (n: number) => void
}) {
  const plan = usePlanMeal()
  const made = useMarkMade()
  const update = useUpdateLibraryMeal()
  const del = useDeleteLibraryMeal()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(meal.title)
  const [link, setLink] = useState('')
  const [confirm, setConfirm] = useState(false)
  const err = plan.error || made.error || update.error || del.error

  const badge = (text: string, tone: 'plan' | 'made' | 'plain'): ReactNode => (
    <span style={{
      fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', borderRadius: 3, padding: '2px 6px',
      whiteSpace: 'nowrap',
      ...(tone === 'plan' ? { color: T.accent, border: `1px solid ${T.accentSoft}` }
        : tone === 'made' ? { color: T.ink, background: 'rgba(255,255,255,0.10)' }
        : { color: T.faint, border: `1px solid ${T.rule}` }),
    }}>{text}</span>
  )

  return (
    <div style={{ borderTop: `1px solid ${T.rule}` }}>
      <button onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 0', minHeight: 52,
        background: 'none', border: 0, color: T.ink, cursor: 'pointer', textAlign: 'left',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...body(15), wordBreak: 'break-word' }}>{meal.title}</div>
          <div style={{ display: 'flex', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
            {days.length > 0 && badge(days.map((d) => dateOf(d).toLocaleDateString('en-US', { weekday: 'short' })).join(', '), 'plan')}
            {meal.made_count > 0 ? badge(`✓ Made ${meal.made_count}×`, 'made') : badge('New', 'plain')}
            {meal.source && badge(meal.source, 'plain')}
          </div>
        </div>
        <span style={{ color: T.accent, fontSize: 13 }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div style={{ padding: '2px 0 14px' }}>
          {renaming ? (
            <form onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; update.mutate({ id: meal.id, title: name.trim() }, { onSuccess: () => setRenaming(false) }) }}
                  style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...input(), flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <button type="submit" style={{ ...button('primary'), padding: '12px 14px' }}>Save</button>
            </form>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 6px' }}>
                <span style={label()}>Pick a day</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button onClick={() => onShift(-1)} style={miniNav} aria-label="Previous week">‹</button>
                  <span style={label()}>{dayLabel(week.weekStart)} – {dayLabel(week.weekEnd)}</span>
                  <button onClick={() => onShift(1)} style={miniNav} aria-label="Next week">›</button>
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {week.days.map((d) => {
                  const cur = d.meals[0]
                  const on = cur?.library_id === meal.id
                  const other = cur && !on ? cur.title : ''
                  return (
                    <button key={d.day} disabled={plan.isPending}
                            onClick={() => plan.mutate({ id: meal.id, day: on ? null : d.day, week: week.weekStart })}
                            style={{ ...chip(on), color: on ? T.paper : d.isToday ? T.accent : T.ink }}>
                      {dateOf(d.day).toLocaleDateString('en-US', { weekday: 'short' })} {dateOf(d.day).getDate()}
                      {other && <small style={chipSub(on)}>{other}</small>}
                    </button>
                  )
                })}
                <button disabled={plan.isPending || days.length === 0}
                        onClick={() => plan.mutate({ id: meal.id, day: null, week: week.weekStart })}
                        style={{ ...chip(false), opacity: days.length ? 1 : 0.4 }}>
                  None
                </button>
              </div>

              <div style={label({ margin: '14px 0 0' })}>Made it</div>
              <MadeButton count={meal.made_count} busy={made.isPending}
                          sub={meal.last_made ? `last ${shortDate(meal.last_made)}` : undefined}
                          onMade={() => made.mutate({ id: meal.id })} />
              {meal.made_count > 0 && (
                <button onClick={() => made.mutate({ id: meal.id, undo: true })}
                        style={{ ...label({ color: T.accent }), background: 'none', border: 0, cursor: 'pointer', padding: '8px 0 0' }}>
                  Undo last
                </button>
              )}

              <div style={label({ margin: '14px 0 0' })}>Recipe link</div>
              {meal.url ? (
                <>
                  <LinkButton url={meal.url} source={meal.source} />
                  <button onClick={() => update.mutate({ id: meal.id, url: null })}
                          style={{ ...label({ color: T.faint }), background: 'none', border: 0, cursor: 'pointer', padding: '8px 0 0' }}>
                    Remove link
                  </button>
                </>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); if (!link.trim()) return; update.mutate({ id: meal.id, url: link.trim() }, { onSuccess: () => setLink('') }) }}
                      style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input style={{ ...input(), flex: 1 }} placeholder="Paste a TikTok or recipe link" value={link} onChange={(e) => setLink(e.target.value)} />
                  <button type="submit" disabled={!link.trim()} style={{ ...button(link.trim() ? 'primary' : 'ghost'), padding: '12px 14px' }}>Save</button>
                </form>
              )}

              <div style={label({ margin: '14px 0 6px' })}>Category</div>
              <select style={{ ...input(), appearance: 'auto' }} value={meal.category}
                      onChange={(e) => update.mutate({ id: meal.id, category: e.target.value })}>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>

              <div style={{ display: 'flex', gap: 18, marginTop: 10 }}>
                <button onClick={() => { setName(meal.title); setRenaming(true) }}
                        style={{ ...label({ color: T.accent }), background: 'none', border: 0, cursor: 'pointer', padding: '8px 0' }}>
                  Rename
                </button>
                {confirm ? (
                  <button onClick={() => del.mutate(meal.id)}
                          style={{ ...label({ color: T.bad }), background: 'none', border: 0, cursor: 'pointer', padding: '8px 0' }}>
                    Delete for good?
                  </button>
                ) : (
                  <button onClick={() => setConfirm(true)}
                          style={{ ...label({ color: T.faint }), background: 'none', border: 0, cursor: 'pointer', padding: '8px 0' }}>
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
          {err && <div style={{ ...body(13), color: T.bad, marginTop: 8 }}>{(err as Error).message}</div>}
        </div>
      )}
    </div>
  )
}

const chip = (on: boolean): React.CSSProperties => ({
  fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', lineHeight: 1.2,
  minHeight: 44, padding: '4px 2px', borderRadius: 3, cursor: 'pointer', minWidth: 0,
  background: on ? T.ink : 'transparent', color: on ? T.paper : T.ink,
  border: `1px solid ${on ? T.ink : T.ruleStrong}`,
})
const chipSub = (on: boolean): React.CSSProperties => ({
  display: 'block', fontFamily: SANS, fontSize: 9, letterSpacing: 0, textTransform: 'none',
  color: on ? 'rgba(5,6,10,0.6)' : T.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 3px',
})
const miniNav: React.CSSProperties = {
  background: 'none', border: 0, color: T.accent, fontSize: 16, cursor: 'pointer', padding: '2px 8px', minHeight: 32,
}

function CategoryEditor({ categories, onClose }: { categories: MealCategory[]; onClose: () => void }) {
  const add = useAddCategory()
  const rename = useRenameCategory()
  const move = useMoveCategory()
  const del = useDeleteCategory()
  const [name, setName] = useState('')
  const busy = add.isPending || rename.isPending || move.isPending || del.isPending
  const err = add.error || rename.error || move.error || del.error
  const ib: React.CSSProperties = {
    minWidth: 40, minHeight: 40, background: 'none', border: `1px solid ${T.ruleStrong}`, borderRadius: 3, color: T.ink, cursor: 'pointer',
  }
  return (
    <Sheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={sectionTitle()}>Edit categories</span>
        <button onClick={onClose} aria-label="Close" style={xBtn}>×</button>
      </div>
      {categories.map((c, i) => (
        <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 6, alignItems: 'center', padding: '6px 0', borderTop: i ? `1px solid ${T.rule}` : 'none' }}>
          <input style={{ ...input(), minHeight: 40, padding: '8px 10px' }} defaultValue={c.name} disabled={c.name === 'Other'}
                 onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) rename.mutate({ id: c.id, name: v }); else e.target.value = c.name }}
                 onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
          <button style={{ ...ib, opacity: i === 0 ? 0.3 : 1 }} disabled={busy || i === 0} onClick={() => move.mutate({ id: c.id, dir: -1 })} aria-label={`Move ${c.name} up`}>↑</button>
          <button style={{ ...ib, opacity: i === categories.length - 1 ? 0.3 : 1 }} disabled={busy || i === categories.length - 1} onClick={() => move.mutate({ id: c.id, dir: 1 })} aria-label={`Move ${c.name} down`}>↓</button>
          <button style={{ ...ib, opacity: c.name === 'Other' ? 0.3 : 1 }} disabled={busy || c.name === 'Other'} onClick={() => del.mutate(c.id)} aria-label={`Delete ${c.name}`}>×</button>
        </div>
      ))}
      <form onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; add.mutate(name.trim(), { onSuccess: () => setName('') }) }}
            style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <input style={{ ...input(), flex: 1, minHeight: 40 }} placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={!name.trim() || busy} style={{ ...button(name.trim() ? 'primary' : 'ghost'), padding: '10px 14px', minHeight: 40 }}>Add</button>
      </form>
      <div style={{ ...body(13), color: T.faint, marginTop: 8 }}>Deleting a category moves its meals to Other.</div>
      {err && <div style={{ ...body(13), color: T.bad, marginTop: 8 }}>{(err as Error).message}</div>}
      <button onClick={onClose} style={{ ...button('primary'), width: '100%', marginTop: 12 }}>Done</button>
    </Sheet>
  )
}

// ── Bulk import: the paste box ───────────────────────────────────────────────
//
// One name per line. `# Header` lines set the category (meals) or aisle (list)
// for the lines under them. `Name | link` (meals) or `Name | qty` (list) carry
// the extra; a tab works too, so a copied spreadsheet column pastes cleanly.
// Leading bullets / numbers / checkboxes from Notes are stripped. Anything
// already there, or repeated in the paste, is shown and skipped — the server
// checks again, so re-pasting the same list never duplicates.
//
// Meals only: a line that is JUST a link (a TikTok data export is nothing but
// links) waits for "Look up names", which asks the server for each video's
// caption in chunks and turns it into a name. Imported meals are not sorted
// into categories (Brandon: "no need to have categories") — they all land in
// Other; headers and second columns are ignored for meals.

type BulkMode = 'items' | 'meals'
type BulkRow = {
  name: string
  key: string
  group: string          // aisle label (items); always 'Other' for meals
  aisle?: Aisle | null   // items: null = guessed on the server
  qty?: string | null
  url?: string | null
  status: 'new' | 'exists' | 'repeat'
}

const nameKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim())

function aisleOf(header: string): Aisle | null {
  const k = nameKey(header).replace(/s$/, '')
  const hit = (Object.keys(AISLE_LABEL) as Aisle[]).find((a) => a === k || nameKey(AISLE_LABEL[a]).replace(/s$/, '') === k)
  return hit ?? null
}

function parseBulk(raw: string, mode: BulkMode, existing: string[],
                   resolved: Map<string, ResolvedLink> = new Map()) {
  const have = new Set(existing.map(nameKey))
  const seen = new Set<string>()
  const rows: BulkRow[] = []
  const notAisles = new Set<string>()
  let header: string | null = null
  const pending = new Set<string>()   // bare links not looked up yet
  let unreadable = 0

  for (const src of raw.split(/\r?\n/)) {
    let s = src.trim()
    if (!s) continue
    const h = s.match(/^#+\s*(.*?):?\s*$/)
    if (h) { header = h[1] || null; continue }
    s = s.replace(/^(?:[-*•·–]|\d+[.)]|\[[ xX]?\])\s*/, '').trim()
    if (!s) continue

    const parts = s.split(/\s*\|\s*|\t+/).map((p) => p.trim()).filter(Boolean)
    let name = parts[0] ?? ''
    const rest = parts.slice(1)
    let url: string | null = null
    let qty: string | null = null

    if (mode === 'meals') {
      url = rest.find(isUrl) ?? null
      const other = rest.find((p) => !isUrl(p)) ?? null
      // "link | name" — the other way round.
      if (isUrl(name) && other) { url = name; name = other }
      // "Name https://…" with no separator.
      if (!url) {
        const m = name.match(/^(.*\S)\s+(https?:\/\/\S+)$/)
        if (m) { name = m[1]; url = m[2] }
      }
    } else {
      qty = rest.join(' ') || null
    }

    // A bare link: its name comes from the lookup.
    let looked: ResolvedLink | null = null
    if (mode === 'meals' && isUrl(name)) {
      const r = resolved.get(name)
      if (!r) { pending.add(name); continue }
      if (!r.title) { unreadable++; continue }
      looked = r
      url = r.url ?? name
      name = r.title
    }

    name = name.slice(0, 200).trim()
    if (!name) continue
    const key = nameKey(name)
    const status: BulkRow['status'] =
      have.has(key) || looked?.exists ? 'exists'
        : seen.has(key) ? 'repeat'
        : 'new'
    seen.add(key)

    if (mode === 'meals') {
      rows.push({ name, key, url, status, group: 'Other' })
    } else {
      const aisle = header ? aisleOf(header) : null
      if (header && !aisle) notAisles.add(header)
      rows.push({ name, key, qty, aisle, status, group: aisle ? AISLE_LABEL[aisle] : 'Auto' })
    }
  }

  const fresh = rows.filter((r) => r.status === 'new')
  const groups: { name: string; rows: BulkRow[] }[] = []
  for (const r of rows) {
    let g = groups.find((x) => x.name === r.group)
    if (!g) { g = { name: r.group, rows: [] }; groups.push(g) }
    g.rows.push(r)
  }
  return {
    rows, fresh, groups, pending: [...pending], unreadable,
    exists: rows.filter((r) => r.status === 'exists').length,
    repeats: rows.filter((r) => r.status === 'repeat').length,
    notAisles: [...notAisles],
  }
}

const LOOKUP_CHUNK = 50

const BULK_EXAMPLE: Record<BulkMode, string> = {
  meals: 'Honey garlic chicken\nBuffalo chicken wraps | https://www.tiktok.com/@…\nMarry me pasta\n\nOr just TikTok links, one per line:\nhttps://www.tiktok.com/@…/video/…',
  items: '# Produce\nAvocados | 3\nLimes\n# Dairy\nMilk\nShredded cheese\n# Household\nPaper towels',
}

function BulkImport({ mode, existing, onDone, onClose }: {
  mode: BulkMode
  existing: string[]
  onDone?: (touchedGroups: string[]) => void
  onClose: () => void
}) {
  const importItems = useImportItems()
  const importMeals = useImportMeals()
  const [text, setText] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [resolved, setResolved] = useState<Map<string, ResolvedLink>>(() => new Map())
  const [lookup, setLookup] = useState<{ done: number; total: number } | null>(null)
  const [lookupErr, setLookupErr] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const busy = importItems.isPending || importMeals.isPending || !!lookup
  const err = importItems.error || importMeals.error
  const p = parseBulk(text, mode, existing, resolved)

  // Chunked so a few hundred links show progress instead of one long wait,
  // and a failure part-way keeps everything already looked up.
  const lookUp = async () => {
    const todo = p.pending
    if (!todo.length || lookup) return
    setLookupErr(null)
    setLookup({ done: 0, total: todo.length })
    const next = new Map(resolved)
    for (let i = 0; i < todo.length && alive.current; i += LOOKUP_CHUNK) {
      try {
        const { links } = await listsApi.resolveLinks(todo.slice(i, i + LOOKUP_CHUNK))
        for (const l of links) next.set(l.input, l)
      } catch (e) {
        if (alive.current) setLookupErr(e instanceof ApiError ? e.message : 'Lookup stopped part-way — tap again to continue.')
        break
      }
      if (!alive.current) return
      setResolved(new Map(next))
      setLookup({ done: Math.min(i + LOOKUP_CHUNK, todo.length), total: todo.length })
    }
    if (alive.current) setLookup(null)
  }
  // Untick to leave something out. Keyed by name, so it survives the list
  // re-parsing as names come back from the lookup.
  const [skip, setSkip] = useState<Set<string>>(() => new Set())
  const picked = p.fresh.filter((r) => !skip.has(r.key))
  const toggle = (key: string) => {
    const next = new Set(skip)
    if (next.has(key)) next.delete(key); else next.add(key)
    setSkip(next)
  }
  const noun = mode === 'meals' ? (picked.length === 1 ? 'meal' : 'meals') : (picked.length === 1 ? 'item' : 'items')
  const SHOW = 2500
  let shown = 0

  const save = async () => {
    if (!picked.length || busy) return
    try {
      if (mode === 'meals') {
        const r = await importMeals.mutateAsync(picked.map((x) => ({ title: x.name, category: x.group, url: x.url ?? null })))
        onDone?.([...new Set(picked.map((x) => x.group))])
        setResult([
          `Added ${r.added} ${r.added === 1 ? 'meal' : 'meals'}.`,
          r.skipped ? `${r.skipped} already there.` : '',
          r.badLinks ? `${r.badLinks} ${r.badLinks === 1 ? 'link' : 'links'} didn't look right, so those meals were saved without one.` : '',
        ].filter(Boolean).join(' '))
      } else {
        const r = await importItems.mutateAsync(picked.map((x) => ({ text: x.name, qty: x.qty ?? null, aisle: x.aisle ?? null })))
        onDone?.([])
        setResult([
          `Added ${r.added} ${r.added === 1 ? 'item' : 'items'} to the list.`,
          r.skipped ? `${r.skipped} already on it.` : '',
        ].filter(Boolean).join(' '))
      }
      setText('')
      setSkip(new Set())
    } catch { /* shown below via err */ }
  }

  return (
    <Sheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={sectionTitle()}>{mode === 'meals' ? 'Import meals' : 'Import to the list'}</span>
        <button onClick={onClose} aria-label="Close" style={xBtn}>×</button>
      </div>

      {result ? (
        <>
          <div style={{ ...body(15), marginTop: 10 }}>{result}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={() => setResult(null)} style={{ ...button('ghost'), flex: 1 }}>Import more</button>
            <button onClick={onClose} style={{ ...button('primary'), flex: 1 }}>Done</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ ...body(13), color: T.faint, margin: '6px 0 10px' }}>
            {mode === 'meals' ? (
              <>One meal per line. Add a link with <span style={{ fontFamily: MONO }}>Name | link</span>, or paste
                bare TikTok links and look up their names. Anything already there is skipped.</>
            ) : (
              <>One per line. <span style={{ fontFamily: MONO }}># Header</span> lines set the aisle for the lines
                below. Add a quantity with <span style={{ fontFamily: MONO }}>Name | qty</span>. Anything already there is skipped.</>
            )}
          </div>
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} placeholder={BULK_EXAMPLE[mode]}
            rows={9} autoFocus spellCheck={false}
            style={{ ...input(), width: '100%', boxSizing: 'border-box', fontSize: 16, lineHeight: 1.45,
                     minHeight: 180, resize: 'vertical', fontFamily: SANS }}
          />

          {text.trim() && (
            <>
              <div style={label({ marginTop: 10, letterSpacing: '0.08em' })}>
                {[
                  p.fresh.length && picked.length < p.fresh.length ? `${picked.length} of ${p.fresh.length} new picked` : `${p.fresh.length} new`,
                  mode === 'items' && p.groups.length > 1 ? `${p.groups.length} aisles` : null,
                  p.exists ? `${p.exists} already there` : null,
                  p.repeats ? `${p.repeats} repeated` : null,
                  p.unreadable ? `${p.unreadable} couldn't be read` : null,
                ].filter(Boolean).join(' · ')}
              </div>

              {mode === 'meals' && (p.pending.length > 0 || lookup) && (
                <div style={{ marginTop: 10, padding: 12, border: `1px solid ${T.accentSoft}`, borderRadius: 10 }}>
                  <div style={body(14)}>
                    {lookup
                      ? `Looking up names… ${lookup.done} of ${lookup.total}`
                      : `${p.pending.length} ${p.pending.length === 1 ? 'link needs' : 'links need'} a name`}
                  </div>
                  {lookup ? (
                    <div style={{ height: 3, background: T.paperSunk, marginTop: 10 }}>
                      <div style={{ width: `${lookup.total ? (lookup.done / lookup.total) * 100 : 0}%`, height: '100%', background: T.accent, transition: 'width 160ms' }} />
                    </div>
                  ) : (
                    <button onClick={() => void lookUp()} style={{ ...button('primary'), width: '100%', marginTop: 10 }}>
                      Look up names
                    </button>
                  )}
                  <div style={label({ marginTop: 8, letterSpacing: '0.06em' })}>
                    About a second per link. Keep this open until it finishes.
                  </div>
                  {lookupErr && <div style={{ ...body(13), color: T.bad, marginTop: 8 }}>{lookupErr}</div>}
                </div>
              )}

              {p.notAisles.length > 0 && (
                <div style={{ ...body(12), color: T.faint, marginTop: 4 }}>
                  {p.notAisles.map((h) => `“${h}”`).join(', ')} {p.notAisles.length === 1 ? "isn't an aisle" : "aren't aisles"}, so
                  those are sorted automatically.
                </div>
              )}

              {p.fresh.length > 1 && (
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 10 }}>
                  <span style={{ ...body(12), color: T.faint, flex: 1 }}>Untick anything you don't want.</span>
                  <button onClick={() => setSkip(new Set())} style={linkBtn}>All</button>
                  <button onClick={() => setSkip(new Set(p.fresh.map((r) => r.key)))} style={linkBtn}>None</button>
                </div>
              )}

              <div style={{ marginTop: 8, maxHeight: '45dvh', overflowY: 'auto', borderTop: `1px solid ${T.rule}` }}>
                {p.groups.map((g) => {
                  if (shown >= SHOW) return null
                  // New ones first — they're the ones to decide on.
                  const ordered = [...g.rows.filter((r) => r.status === 'new'), ...g.rows.filter((r) => r.status !== 'new')]
                  const rows = ordered.slice(0, SHOW - shown)
                  shown += rows.length
                  return (
                    <div key={g.name} style={{ padding: '6px 0' }}>
                      {mode === 'items' && (
                        <div style={label()}>{g.name} · {g.rows.filter((r) => r.status === 'new').length}</div>
                      )}
                      {rows.map((r, i) => {
                        const isNew = r.status === 'new'
                        const on = isNew && !skip.has(r.key)
                        return (
                          <div key={`${r.key}-${i}`} style={{ ...body(14), display: 'flex', alignItems: 'center', gap: 10,
                                                               minHeight: isNew ? 44 : 30, borderTop: i ? `1px solid ${T.rule}` : 'none',
                                                               color: on ? T.ink : T.faint }}>
                            {isNew ? (
                              <button onClick={() => toggle(r.key)} aria-label={on ? `Leave out ${r.name}` : `Add ${r.name}`}
                                      style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, minHeight: 44,
                                               background: 'none', border: 0, padding: 0, color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                                <span style={checkbox(on, 18)}>{on ? '✓' : ''}</span>
                                <span style={{ ...body(14), color: 'inherit', flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                                  {r.name}{r.qty ? ` · ${r.qty}` : ''}
                                </span>
                              </button>
                            ) : (
                              <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word', textDecoration: 'line-through', paddingLeft: 28 }}>
                                {r.name}{r.qty ? ` · ${r.qty}` : ''}
                              </span>
                            )}
                            {/* Watch it before deciding. */}
                            {r.url && isNew && (
                              <a href={r.url} target="_blank" rel="noreferrer"
                                 style={{ ...label({ color: T.accent }), textDecoration: 'none', padding: '12px 4px' }}>
                                Watch ↗
                              </a>
                            )}
                            {r.status === 'exists' && <span style={label()}>already there</span>}
                            {r.status === 'repeat' && <span style={label()}>repeat</span>}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
                {p.rows.length > SHOW && (
                  <div style={label({ padding: '6px 0' })}>+ {p.rows.length - SHOW} more</div>
                )}
              </div>
            </>
          )}

          {err && <div style={{ ...body(13), color: T.bad, marginTop: 8 }}>{(err as Error).message}</div>}
          <button onClick={() => void save()} disabled={!picked.length || busy}
                  style={{ ...button(picked.length ? 'primary' : 'ghost'), width: '100%', marginTop: 12 }}>
            {busy ? 'Adding…' : picked.length ? `Add ${picked.length} ${noun}` : p.fresh.length ? 'Nothing picked' : 'Nothing new to add'}
          </button>
        </>
      )}
    </Sheet>
  )
}

const linkBtn: React.CSSProperties = {
  ...label({ color: T.accent }), background: 'none', border: 0, cursor: 'pointer', padding: '8px 0',
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
  const [bulk, setBulk] = useState(false)

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
          <button type="button" onClick={() => setBulk(true)}
                  style={{ ...button('ghost'), padding: '12px 12px' }}>Import</button>
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
      {bulk && (
        <BulkImport mode="items" existing={data.aisles.flatMap((g) => g.items.map((i) => i.text))}
                    onClose={() => setBulk(false)} />
      )}

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
