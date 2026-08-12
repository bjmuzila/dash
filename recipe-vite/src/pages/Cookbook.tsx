import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { recipes as api, imageSrc, type Category, type RecipeCard } from '../api'
import { T, label, display, body, section, segment, input, minutes, SANS, SERIF } from '../theme'

/**
 * The cookbook index — the Julienne "Recipes" screen.
 *
 * One list, a search box and a row of category chips. Search runs on the SERVER
 * (title, description and ingredients) rather than filtering the loaded page,
 * because "what can I make with gochujang" is the question a cookbook is for
 * and the answer is in a field the index rows don't even carry.
 *
 * `favoritesOnly` is what the Saved tab passes. Same component, same query
 * shape — a second screen would be a copy of this one that drifts.
 */

const TITLE: Record<string, string> = {
  all: 'All', breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', dessert: 'Dessert',
  bread: 'Bread', cocktails: 'Cocktails', sides: 'Sides', sauces: 'Sauces', other: 'Other',
}

export default function Cookbook({ favoritesOnly = false }: { favoritesOnly?: boolean }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<Category | 'all'>('all')

  // Debouncing is skipped on purpose: this is a household cookbook of tens to
  // hundreds of rows on a LAN-speed backend, and react-query dedupes in-flight
  // keys. A 300ms delay would be the slowest part of the interaction.
  const { data, isLoading, error } = useQuery({
    queryKey: ['recipes', q, cat, favoritesOnly],
    queryFn: () => api.list({ q, category: cat, favorite: favoritesOnly }),
  })

  const chips = useMemo(() => {
    if (!data) return ['all'] as (Category | 'all')[]
    // Only offer a category you actually have something in. A chip row of nine
    // filters where six return nothing is a row you stop reading.
    const used = data.categories.filter((c) => (data.counts[c] ?? 0) > 0)
    return ['all', ...used] as (Category | 'all')[]
  }, [data])

  return (
    <div style={{ display: 'grid', gap: 14 }}>
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
        <div className="no-bar" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
          {chips.map((c) => (
            <button key={c} style={segment(cat === c)} onClick={() => setCat(c)}>
              {TITLE[c] ?? c}
            </button>
          ))}
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
            {q || cat !== 'all' ? 'Nothing matches' : favoritesOnly ? 'Nothing saved yet' : 'Your cookbook is empty'}
          </h2>
          <p style={{ ...body(), marginTop: 10 }}>
            {q || cat !== 'all'
              ? 'Try a different word, or clear the filters.'
              : 'Paste a recipe link on the Add tab and it lands here.'}
          </p>
          {!q && cat === 'all' && !favoritesOnly && (
            <Link to="/add" style={{ ...body(), color: T.accent, display: 'inline-block', marginTop: 14 }}>
              Add your first recipe →
            </Link>
          )}
        </div>
      )}

      {data && data.recipes.length > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          {data.recipes.map((r) => <Card key={r.id} r={r} />)}
        </div>
      )}
    </div>
  )
}

/**
 * A recipe row. Photo left, title and one metadata line right — the Julienne
 * cookbook row. The photo is a fixed 64px square so a list of twenty rows has
 * ONE alignment, whatever aspect ratios the source sites published.
 */
function Card({ r }: { r: RecipeCard }) {
  const time = (r.cook_minutes ?? 0) + (r.prep_minutes ?? 0)
  const meta = [
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
          // Round, like the reference. loading="lazy" matters here: a cookbook
          // of 200 rows would otherwise fire 200 image requests the moment the
          // tab loads — at the backend now, rather than at other people's CDNs.
          ? <img src={src} alt="" loading="lazy" decoding="async"
                 style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontFamily: SERIF, fontSize: 22, color: T.faint }}>
              {r.title.slice(0, 1).toUpperCase()}
            </span>}
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontFamily: SERIF, fontSize: 17, fontWeight: 500, lineHeight: 1.25, color: T.ink,
        }}>
          {r.title}
        </div>
        {meta && <div style={{ ...label(), marginTop: 5, letterSpacing: '0.08em' }}>{meta}</div>}
      </div>

      {r.favorite && (
        <span aria-label="Saved" style={{ color: T.accent, fontSize: 15, fontFamily: SANS }}>●</span>
      )}
    </Link>
  )
}
