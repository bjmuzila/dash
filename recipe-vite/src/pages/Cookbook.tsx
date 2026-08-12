import { useMemo, useState } from 'react'
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
 */

const TITLE: Record<string, string> = {
  all: 'All', breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', dessert: 'Dessert',
  bread: 'Bread', cocktails: 'Cocktails', sides: 'Sides', sauces: 'Sauces', other: 'Other',
}

export default function Cookbook() {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [main, setMain] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('recent')
  const [review, setReview] = useState(false)
  const [fav, setFav] = useState(false)
  /** The sort row and the ingredient row are hidden behind one toggle. On a
   *  390px screen three stacked filter rows push the first recipe off the fold,
   *  and most visits are "open it and scroll". */
  const [tools, setTools] = useState(false)

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

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <input
        style={input()}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search recipes and ingredients"
        type="search"
        autoCapitalize="off"
        autoCorrect="off"
      />

      {chips.length > 1 && (
        <div className="no-bar" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
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
        </div>
      )}

      {/* Sort + review live on one line with the toggle, so the default screen
          costs 34px of chrome rather than a hundred. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => setTools((v) => !v)} style={{
          ...label(), background: 'none', border: 'none', color: T.accent,
          padding: '4px 0', cursor: 'pointer', display: 'inline-flex', gap: 6,
        }}>
          {tools ? 'HIDE' : 'SORT'} · {(data?.sorts.find((s) => s.key === sort)?.label ?? 'Recently added').toUpperCase()}
        </button>
        <div style={{ flex: 1 }} />
        {!!data?.needsReview && (
          <button onClick={() => setReview((v) => !v)} style={{
            ...segment(review), minHeight: 28, padding: '5px 9px', fontSize: 9,
            borderColor: review ? T.ink : T.warn, color: review ? T.paper : T.warn,
          }}>
            {data.needsReview} TO REVIEW
          </button>
        )}
      </div>

      {tools && (
        <div style={section({ padding: 12, display: 'grid', gap: 10 })}>
          <div>
            <div style={label()}>Sort by</div>
            <div className="no-bar" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 7 }}>
              {(data?.sorts ?? []).map((s) => (
                <button key={s.key} style={segment(sort === s.key)} onClick={() => setSort(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          {!!data?.mains.length && (
            <div>
              <div style={label()}>Main ingredient</div>
              <div className="no-bar" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 7 }}>
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
        </div>
      )}

      {isLoading && <div style={{ ...body(), color: T.muted, padding: '30px 0', textAlign: 'center' }}>…</div>}

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
          {!filtered && (
            <Link to="/add" style={{ ...body(), color: T.accent, display: 'inline-block', marginTop: 14 }}>
              Add your first recipe →
            </Link>
          )}
        </div>
      )}

      {data && data.recipes.length > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          {data.recipes.map((r) => (
            // The main ingredient is shown on the row ONLY while sorting or
            // filtering by it. Everywhere else it is a derived guess competing
            // with the cook time for the one line of metadata a row has.
            <Card key={r.id} r={r} showMain={sort === 'main' || !!main} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A recipe row. Photo left, title and one metadata line right. The photo is a
 * fixed 64px circle so twenty rows share ONE alignment, whatever aspect ratios
 * the source sites published.
 */
function Card({ r, showMain }: { r: RecipeCard; showMain: boolean }) {
  const time = (r.cook_minutes ?? 0) + (r.prep_minutes ?? 0)
  const meta = [
    showMain && r.main_ingredient ? r.main_ingredient.toUpperCase() : null,
    time ? `${minutes(time)} cook time` : null,
    r.ingredient_count ? `${r.ingredient_count} ingredients` : null,
  ].filter(Boolean).join(' · ')
  const src = imageSrc(r)

  return (
    <Link
      to={`/r/${r.id}`}
      style={{
        ...section({ padding: 12 }),
        display: 'flex', alignItems: 'center', gap: 13, textDecoration: 'none', color: T.ink,
      }}
    >
      <div style={{
        width: 64, height: 64, flexShrink: 0, borderRadius: 999, overflow: 'hidden',
        background: T.paperSunk, display: 'grid', placeItems: 'center',
      }}>
        {src
          // loading="lazy" matters here: a cookbook of 200 rows would otherwise
          // fire 200 image requests the moment the tab loads.
          ? <img src={src} alt="" loading="lazy" decoding="async"
                 style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 45%' }} />
          : <span style={{ fontFamily: SERIF, fontSize: 22, color: T.faint }}>
              {r.title.slice(0, 1).toUpperCase()}
            </span>}
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 500, lineHeight: 1.25, color: T.ink }}>
          {r.title}
        </div>
        {meta && <div style={{ ...label(), marginTop: 5, letterSpacing: '0.08em' }}>{meta}</div>}
      </div>

      {/* An unreviewed bulk import is worth flagging on the row itself — the
          filter chip tells you how many, this tells you which. */}
      {/* PART beats NEW: "this recipe is incomplete" is worth knowing before
          you open it, where "nobody has checked this yet" can wait. */}
      {r.partial ? (
        <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '0.1em', color: T.warn }}>PART</span>
      ) : r.needs_review ? (
        <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '0.1em', color: T.warn }}>NEW</span>
      ) : null}
      {r.favorite && (
        <span aria-label="Saved" style={{ color: T.accent, fontSize: 15, fontFamily: SANS }}>●</span>
      )}
    </Link>
  )
}
