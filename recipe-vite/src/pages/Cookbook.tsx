import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { recipes as api, imageSrc, type Category, type RecipeCard, type SortKey } from '../api'
import { T, label, display, body, section, segment, input, minutes, SANS, SERIF, MONO } from '../theme'

/**
 * The cookbook index — the Julienne "Recipes" screen.
 *
 * Search, sort and every filter run on the SERVER. That isn't ceremony: search
 * covers ingredients, which the index rows don't even carry, and "sort by name"
 * has to order the whole library rather than the 20 rows that happen to be
 * loaded. Doing either client-side would quietly sort a page instead of a
 * cookbook.
 *
 * ★ is a filter chip here rather than its own tab. It was the Saved tab until
 * 2026-08-12 — a whole tab for one boolean, on a screen where everything is
 * already saved by definition. The slot went to Week.
 *
 * LAYOUT — "mood board", 2026-08-13. Was a stack of 64px-circle rows; now an
 * invitation ("What are you in the mood for?"), one large search, the filter
 * chips, a result bar carrying the sorts, and a masonry wall of photo cards.
 * Three notes on why it is built the way it is:
 *
 *   1. The wall is JS-distributed flex columns, NOT `columns:` and NOT a grid.
 *      CSS multi-column fills top-to-bottom per column, so on a phone recipe #2
 *      would sit halfway down the screen — wrong on the one surface that is
 *      pure scrolling. Round-robin across N flex columns keeps reading order
 *      left-to-right and still lets the cards have unequal heights.
 *   2. Card image heights come from a hash of the id. That's what gives the
 *      wall its rhythm; it must stay deterministic so nothing resizes on a
 *      re-render or a refetch.
 *   3. NO mood taxonomy was invented. The chips are the category facet the
 *      server already returns and already counts — a mood row that is really
 *      "dinner" wearing a costume helps nobody.
 */

const TITLE: Record<string, string> = {
  all: 'All', breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', dessert: 'Dessert',
  bread: 'Bread', cocktails: 'Cocktails', sides: 'Sides', sauces: 'Sauces', other: 'Other',
}

/** Card image height, stable per recipe. See note 2 above. */
function shotHeight(id: number): number {
  const h = Math.abs(Math.imul(id, 2654435761)) % 5
  return 132 + h * 18 // 132 – 204
}

/** How wide a card wants to be. Two columns on a 390px phone, five on a laptop. */
function columnsFor(width: number): number {
  return Math.max(2, Math.min(5, Math.floor(width / 210)))
}

export default function Cookbook() {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [main, setMain] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('recent')
  const [review, setReview] = useState(false)
  const [fav, setFav] = useState(false)
  /** The main-ingredient facet stays behind a toggle. It is a long row of
   *  words you have to read, and most visits are "open it and scroll". */
  const [tools, setTools] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)

  /** ⌘K is desktop chrome. On a phone the hint is a lie — there is no keyboard
   *  to press it on — and it eats 40px of an input that is already the biggest
   *  thing on the screen. */
  const [hasKeyboard] = useState(
    () => typeof window !== 'undefined'
      && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches,
  )

  /** ⌘K / Ctrl+K focuses search; Escape clears it while focused. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setQ('')
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const { data, isLoading, error } = useQuery({
    queryKey: ['recipes', q, cat, main, sort, fav, review],
    queryFn: () => api.list({
      q, category: cat, main: main ?? undefined, sort,
      favorite: fav, needsReview: review,
    }),
  })

  const chips = useMemo(() => {
    if (!data) return ['all'] as (Category | 'all')[]
    // Only offer a category you actually have something in. A row of nine
    // filters where six return nothing is a row you stop reading.
    const used = data.categories.filter((c) => (data.counts[c] ?? 0) > 0)
    return ['all', ...used] as (Category | 'all')[]
  }, [data])

  const filtered = !!q || cat !== 'all' || !!main || review || fav
  const clearAll = () => {
    setQ(''); setCat('all'); setMain(null); setReview(false); setFav(false)
  }

  const neverMade = useMemo(
    () => (data ? data.recipes.filter((r) => !r.cooked_count).length : 0),
    [data],
  )

  return (
    // minmax(0, 1fr), not the implicit `auto`: the chip and sort rows scroll
    // sideways, and a grid track sized to `auto` widens to their FULL content
    // instead — which pushes the whole page off a 390px screen.
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      {/* ─── the invitation ─────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', paddingTop: 4 }}>
        <h2 style={display(22)}>What are you in the mood for?</h2>
        <div style={{ ...label(), marginTop: 7, color: T.faint }}>
          {data
            ? `${data.libraryTotal} recipes · ${neverMade} you've never made`
            : ' '}
        </div>
      </div>

      {/* One large input. The ⌘K hint is desktop-only chrome — on a phone the
          box is already the biggest thing on the screen. */}
      <div style={{ maxWidth: 520, width: '100%', margin: '0 auto', position: 'relative' }}>
        <span style={{
          position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
          color: T.faint, fontSize: 15, fontFamily: SANS, pointerEvents: 'none',
        }}>⌕</span>
        <input
          ref={searchRef}
          style={{ ...input(), paddingLeft: 34, paddingRight: q ? 38 : hasKeyboard ? 52 : 12 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search recipes and ingredients"
          type="search"
          autoCapitalize="off"
          autoCorrect="off"
        />
        {q ? (
          <button
            onClick={() => setQ('')}
            aria-label="Clear search"
            style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: T.faint, fontSize: 18,
              width: 30, height: 30, cursor: 'pointer', lineHeight: 1,
            }}
          >×</button>
        ) : hasKeyboard ? (
          <span style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            fontFamily: MONO, fontSize: 9, letterSpacing: '0.06em', color: T.faint,
            border: `1px solid ${T.rule}`, borderRadius: 3, padding: '3px 5px', pointerEvents: 'none',
          }}>⌘K</span>
        ) : null}
      </div>

      {/* ─── filters ────────────────────────────────────────────────────── */}
      {chips.length > 1 && (
        <div className="no-bar" style={{
          display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, minWidth: 0,
        }}>
          {/* ★ leads the row: it is the one filter you reach for without
              reading the others. */}
          <button style={{ ...segment(fav), color: fav ? T.paper : T.accent,
                           borderColor: fav ? T.ink : T.rule }}
                  onClick={() => setFav((v) => !v)} aria-label="Saved only">★</button>
          {chips.map((c) => (
            <button key={c} style={segment(cat === c)} onClick={() => setCat(c)}>
              {TITLE[c] ?? c}
            </button>
          ))}
          {!!data?.needsReview && (
            <button onClick={() => setReview((v) => !v)} style={{
              ...segment(review),
              borderColor: review ? T.ink : T.warn, color: review ? T.paper : T.warn,
            }}>
              {data.needsReview} to review
            </button>
          )}
        </div>
      )}

      {/* ─── result bar: what you're looking at, and how it's ordered ───── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
        borderTop: `1px solid ${T.rule}`, borderBottom: `1px solid ${T.rule}`,
        padding: '8px 0',
      }}>
        <span style={{ ...label(), color: T.faint, whiteSpace: 'nowrap' }}>
          {data
            ? (filtered ? `${data.total} of ${data.libraryTotal}` : `All ${data.libraryTotal}`)
            : ' '}
        </span>

        {filtered && (
          <button onClick={clearAll} style={{
            ...label(), background: 'none', border: 'none', color: T.accent,
            padding: 0, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>Clear</button>
        )}

        <button onClick={() => setTools((v) => !v)} style={{
          ...label(), background: 'none', border: 'none',
          color: main ? T.accent : T.faint, padding: 0, cursor: 'pointer', whiteSpace: 'nowrap',
        }}>{main ?? 'Main'}</button>

        <div className="no-bar" style={{
          marginLeft: 'auto', display: 'flex', gap: 5, overflowX: 'auto', minWidth: 0,
        }}>
          {(data?.sorts ?? []).map((s) => {
            const on = sort === s.key
            return (
              <button key={s.key} onClick={() => setSort(s.key)} style={{
                fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
                whiteSpace: 'nowrap', cursor: 'pointer', borderRadius: 999, padding: '5px 10px',
                border: `1px solid ${on ? T.accentSoft : 'transparent'}`,
                background: on ? 'rgba(142,202,230,0.10)' : 'none',
                color: on ? T.accent : T.faint,
              }}>{s.label}</button>
            )
          })}
        </div>
      </div>

      {tools && !!data?.mains.length && (
        <div style={section({ padding: 12 })}>
          <div style={label()}>Main ingredient</div>
          <div className="no-bar" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 8 }}>
            <button style={segment(!main)} onClick={() => setMain(null)}>Any</button>
            {data.mains.map((m) => (
              <button key={m.name} style={segment(main === m.name)}
                      onClick={() => setMain(main === m.name ? null : m.name)}>
                {m.name} · {m.n}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── the wall ───────────────────────────────────────────────────── */}
      {isLoading && <Wall items={SKELETONS} render={(n) => <Skeleton key={`s${n}`} n={n} />} />}

      {error && (
        <div style={section()}>
          <div style={label({ color: T.bad })}>Couldn’t load</div>
          <p style={{ ...body(), marginTop: 8 }}>{(error as Error).message}</p>
        </div>
      )}

      {data && data.recipes.length === 0 && (
        <div style={section({ textAlign: 'center', padding: '34px 20px' })}>
          <h2 style={display(22)}>
            {filtered ? 'Nothing matches' : 'Your cookbook is empty'}
          </h2>
          <p style={{ ...body(), marginTop: 10 }}>
            {filtered
              ? 'Try a different word, or clear the filters.'
              : 'Paste a recipe link on the Add tab and it lands here.'}
          </p>
          {filtered ? (
            <button onClick={clearAll} style={{
              ...label(), background: 'none', border: 'none', color: T.accent,
              marginTop: 14, cursor: 'pointer',
            }}>Clear filters</button>
          ) : (
            <Link to="/add" style={{ ...body(), color: T.accent, display: 'inline-block', marginTop: 14 }}>
              Add your first recipe →
            </Link>
          )}
        </div>
      )}

      {data && data.recipes.length > 0 && (
        <Wall
          items={data.recipes}
          render={(r) => (
            // The main ingredient rides the card ONLY while sorting or
            // filtering by it. Everywhere else it is a derived guess competing
            // for the one line of metadata a card has.
            <Card key={r.id} r={r} showMain={sort === 'main' || !!main} />
          )}
        />
      )}
    </div>
  )
}

const SKELETONS = [1, 2, 3, 4, 5, 6, 7, 8]

/**
 * The masonry wall. Items are dealt round-robin across N flex columns, so the
 * reading order stays left-to-right while the cards keep unequal heights — see
 * note 1 at the top of the file for why this isn't `columns:` or a grid.
 */
function Wall<Item>({ items, render }: { items: Item[]; render: (item: Item) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(2)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setCols(columnsFor(el.clientWidth))
    measure()
    // ResizeObserver rather than a window listener: the wall also changes width
    // when the filter rows above it grow, not just on rotate.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const lanes = useMemo(() => {
    const out: Item[][] = Array.from({ length: cols }, () => [])
    items.forEach((it, i) => out[i % cols].push(it))
    return out
  }, [items, cols])

  return (
    <div ref={ref} style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
      {lanes.map((lane, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, display: 'grid', gap: 11, alignContent: 'start' }}>
          {lane.map(render)}
        </div>
      ))}
    </div>
  )
}

/**
 * A recipe card. Photo on top at a stable pseudo-random height, then the title
 * and one metadata line. No photo falls back to the initial on a sunk panel,
 * the same treatment the old rows used.
 */
function Card({ r, showMain }: { r: RecipeCard; showMain: boolean }) {
  const time = (r.cook_minutes ?? 0) + (r.prep_minutes ?? 0)
  const src = imageSrc(r)
  const h = shotHeight(r.id)

  // ONE fact, not three. A card is ~170px wide on a phone — about 26 characters
  // of 9px mono — so "5 ingredients · never made" wraps to a ragged second line
  // on half the wall. "Never made" wins when it applies (it is the number the
  // header counts and the thing you act on); otherwise the ingredient count
  // stands in. The cook time moved onto the photo, and the main ingredient
  // still only appears while you are sorting or filtering by it.
  const meta = [
    showMain && r.main_ingredient ? r.main_ingredient.toUpperCase() : null,
    // The cook time used to be a pill in the bottom-left of the photo, which is
    // where the title now sits. It reads better here anyway — next to the other
    // fact rather than floating over the food.
    time ? minutes(time) : null,
    r.cooked_count
      ? (r.ingredient_count ? `${r.ingredient_count} ingredients` : null)
      : 'Never made',
  ].filter(Boolean).join(' · ')

  return (
    <Link
      to={`/r/${r.id}`}
      style={{
        display: 'block', textDecoration: 'none', color: T.ink, overflow: 'hidden',
        background:
          'radial-gradient(circle at 50% 0%, rgba(33,158,188,0.07) 0%, transparent 55%), rgba(13,17,25,0.55)',
        border: `1px solid ${T.rule}`,
        borderRadius: 16,
      }}
    >
      <div style={{
        position: 'relative', height: h, background: T.paperSunk,
        borderBottom: `1px solid ${T.rule}`, display: 'grid', placeItems: 'center',
      }}>
        {src
          // loading="lazy" matters here: a cookbook of 200 cards would otherwise
          // fire 200 image requests the moment the tab loads.
          ? <img src={src} alt="" loading="lazy" decoding="async"
                 style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 45%' }} />
          : <span style={{ fontFamily: SERIF, fontSize: 34, color: T.faint }}>
              {r.title.slice(0, 1).toUpperCase()}
            </span>}

        {/* PART beats NEW: "this recipe is incomplete" is worth knowing before
            you open it, where "nobody has checked this yet" can wait. */}
        {r.partial ? (
          <Pill style={{ left: 7, top: 7, color: T.warn }}>PART</Pill>
        ) : r.needs_review ? (
          <Pill style={{ left: 7, top: 7, color: T.warn }}>NEW</Pill>
        ) : r.source_name ? (
          <Pill style={{ right: 7, top: 7 }}>{r.source_name}</Pill>
        ) : null}

        {/* THE NAME LIVES ON THE PHOTO, not in a row beneath it.
            A row under the picture is the obvious layout and it was the first
            one built — but on a wall of eighty photos it makes every card two
            things stacked, and the eye reads the pictures and skips the text.
            Laid over the bottom of the shot, under a scrim dark enough to
            survive a bright food photo, the name reads as part of the card.
            It also puts the title in the same layer as the NEW and cook-time
            pills, which is the layer that is unmistakably visible. */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          padding: '26px 10px 9px',
          // Tall soft gradient rather than a bar: a hard-edged panel across the
          // bottom of a photo looks like a caption box pasted on top of it.
          background: 'linear-gradient(to top, rgba(3,4,8,0.92) 0%, rgba(3,4,8,0.78) 45%, transparent 100%)',
          pointerEvents: 'none',
        }}>
          <div style={{
            fontFamily: SERIF, fontSize: 14.5, fontWeight: 500, lineHeight: 1.22, color: '#FFFFFF',
            // Two lines, then ellipsis. Three-line titles push the picture out
            // of a card that is mostly picture.
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textShadow: '0 1px 8px rgba(0,0,0,0.85)',
          }}>
            {r.title}
          </div>
          {meta && (
            <div style={{
              ...label(), marginTop: 4, fontSize: 8.5, letterSpacing: '0.05em',
              color: 'rgba(255,255,255,0.72)', textShadow: '0 1px 6px rgba(0,0,0,0.9)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              paddingRight: r.favorite ? 14 : 0,
            }}>
              {meta}
            </div>
          )}
        </div>

        {/* After the scrim, so it sits on top of it rather than under. */}
        {r.favorite && (
          <span aria-label="Saved" style={{
            position: 'absolute', right: 8, bottom: 8, color: T.accent,
            fontSize: 13, fontFamily: SANS, textShadow: '0 1px 6px rgba(0,0,0,0.9)',
          }}>●</span>
        )}
      </div>
    </Link>
  )
}

/** A scrim badge over the photo. Dark enough to survive a bright food shot. */
function Pill({ children, style }: { children: ReactNode; style: CSSProperties }) {
  return (
    <span style={{
      position: 'absolute',
      fontFamily: MONO, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: T.ink,
      // A photo scrim, not a theme surface: it has to read over an arbitrary
      // image, which a translucent panel colour does not.
      background: 'rgba(5,6,10,0.78)',
      border: `1px solid ${T.rule}`,
      backdropFilter: 'blur(6px)',
      padding: '3px 6px', borderRadius: 5, maxWidth: '72%',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      ...style,
    }}>{children}</span>
  )
}

function Skeleton({ n }: { n: number }) {
  return (
    <div style={{
      border: `1px solid ${T.rule}`, borderRadius: 16, overflow: 'hidden',
      background: 'rgba(13,17,25,0.55)',
    }}>
      {/* One block, because the card is now one block: the title lives ON the
          photo, so a separate text row below would make the wall jump the
          moment the real cards replace these. */}
      <div style={{ height: shotHeight(n), background: T.paperSunk }} />
    </div>
  )
}
