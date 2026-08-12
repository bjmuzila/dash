import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { recipes as api, imageSrc, downscale, type Ingredient } from '../api'
import { T, label, display, body, section, button, input, minutes, SANS, SERIF } from '../theme'

/**
 * One recipe — the screen you actually stand in the kitchen holding.
 *
 * Three things make it different from a static page:
 *
 *   1. SERVINGS SCALE LIVE. The stepper at the bottom re-renders every parsed
 *      quantity. Lines the parser couldn't read (a pinch, to taste) are shown
 *      exactly as written — see scaled() below.
 *   2. INGREDIENTS GO TO THE REAL LIST. "Add all" writes hh_list_items rows,
 *      aisle-sorted, at the scaled amount. They appear on budget.cbedge.net's
 *      grocery list with no sync step, because it is the same table.
 *   3. THE PHOTO IS THE PAGE HEAD. No app chrome above it — Shell drops its
 *      header on /r/:id and this page floats its own back button over the image.
 */

// ── Quantity formatting ──────────────────────────────────────────────────────
// A deliberate duplicate of formatQty in server-v2/_lib-household-recipes.cjs.
// The server needs it to write list rows, this needs it to re-render on every
// tap of the stepper, and a round trip per tap would make the control feel
// broken. If you change one, change the other — the two are checked against
// each other in _lib-household-recipes.selftest.js.
const NEAR: [number, string][] = [
  [0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.375, '⅜'], [0.5, '½'],
  [0.625, '⅝'], [2 / 3, '⅔'], [0.75, '¾'], [0.875, '⅞'],
]

function formatQty(n: number): string {
  const rounded = Math.round(n * 1000) / 1000
  const whole = Math.floor(rounded + 1e-9)
  const frac = rounded - whole
  if (frac < 0.06) return String(whole || 0)
  for (const [v, s] of NEAR) {
    if (Math.abs(frac - v) < 0.04) return whole ? `${whole}${s}` : s
  }
  // Nothing close to a kitchen fraction — a decimal is more honest than a
  // fraction that's quietly 8% off.
  return String(Math.round(rounded * 100) / 100)
}

/** An ingredient at the chosen servings. Unparsed lines pass through untouched:
 *  you cannot double "a pinch", and inventing 0.375 tsp would be worse than
 *  leaving it alone. */
function scaled(ing: Ingredient, factor: number): string {
  if (ing.qty === null || ing.qty === undefined) return ing.raw
  return [formatQty(ing.qty * factor), ing.unit, ing.item].filter(Boolean).join(' ')
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function Recipe() {
  const { id } = useParams()
  const rid = Number(id)
  const nav = useNavigate()
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['recipe', rid],
    queryFn: () => api.get(rid),
    enabled: Number.isInteger(rid) && rid > 0,
  })
  const r = data?.recipe

  const [servings, setServings] = useState<number | null>(null)
  // Only once the recipe lands, and only if it declared a base — a recipe with
  // no stated yield has nothing to scale FROM, so the stepper stays hidden.
  useEffect(() => { if (r?.servings) setServings(r.servings) }, [r?.servings])

  const factor = r?.servings && servings ? servings / r.servings : 1

  /** Ingredient indexes the user unticked, i.e. already in the cupboard. */
  const [skip, setSkip] = useState<Set<number>>(new Set())
  const toggleSkip = (i: number) => setSkip((s) => {
    const next = new Set(s)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    return next
  })

  const [note, setNote] = useState<string | null>(null)
  const [planning, setPlanning] = useState(false)

  const addToList = useMutation({
    mutationFn: () => api.addToList(rid, {
      servings: servings ?? undefined,
      only: r ? r.ingredients.map((_, i) => i).filter((i) => !skip.has(i)) : undefined,
    }),
    onSuccess: (res) => setNote(`${res.added} added to the grocery list.`),
    onError: (e: Error) => setNote(e.message),
  })

  const plan = useMutation({
    mutationFn: (day: string) => api.plan(rid, { day, servings: servings ?? undefined }),
    onSuccess: (res) => {
      setPlanning(false)
      setNote(res.list
        ? `Planned for ${res.meal.day} — ${res.list.added} ingredients on the list.`
        : `Planned for ${res.meal.day}.`)
    },
    onError: (e: Error) => setNote(e.message),
  })

  const favorite = useMutation({
    mutationFn: () => api.favorite(rid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipe', rid] })
      qc.invalidateQueries({ queryKey: ['recipes'] })
    },
  })

  const cooked = useMutation({
    mutationFn: () => api.cooked(rid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipe', rid] })
      setNote('Nice. Logged it.')
    },
  })

  // ── Photo ────────────────────────────────────────────────────────────────
  // A hidden file input driven by a button, because the native
  // <input type=file> control is unstyleable and reads as a form on a screen
  // that has none. capture is deliberately NOT set: "photo library" is the
  // common case (a shot you already took of the finished dish), and forcing the
  // camera would make re-picking an old photo impossible.
  const fileRef = useRef<HTMLInputElement>(null)
  const setImage = useMutation({
    mutationFn: async (file: File) => {
      const dataUrl = await downscale(file)
      return api.setImage(rid, dataUrl)
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['recipe', rid] })
      qc.invalidateQueries({ queryKey: ['recipes'] })
      setNote(`Photo updated (${Math.round(res.bytes / 1024)}KB).`)
    },
    onError: (e: Error) => setNote(e.message),
  })

  const remove = useMutation({
    mutationFn: () => api.remove(rid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] })
      nav('/cookbook', { replace: true })
    },
  })

  const heroSrc = r ? imageSrc(r) : null

  const totalTime = useMemo(
    () => (r ? (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0) : 0),
    [r],
  )

  if (isLoading) {
    return <div style={{ ...body(), color: T.muted, padding: 40, textAlign: 'center' }}>…</div>
  }
  if (error || !r) {
    return (
      <div style={{ padding: 16 }}>
        <div style={section()}>
          <div style={label({ color: T.bad })}>Couldn’t load</div>
          <p style={{ ...body(), marginTop: 8 }}>{(error as Error)?.message || 'Recipe not found.'}</p>
          <Link to="/cookbook" style={{ ...body(), color: T.accent }}>Back to the cookbook</Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: 96 }}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div style={{
        position: 'relative',
        // 4:3 rather than a fixed height: a fixed height crops portrait food
        // photos through the middle of the plate on a narrow phone.
        aspectRatio: '4 / 3',
        maxHeight: 420,
        background: T.paperSunk,
        overflow: 'hidden',
      }}>
        {heroSrc
          ? <>
              <img src={heroSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {/* Without this the photo ends on a hard horizontal edge against
                  the near-black page and reads as a rendering seam. */}
              <div style={{
                position: 'absolute', left: 0, right: 0, bottom: 0, height: 90,
                background: `linear-gradient(to bottom, transparent, ${T.paper})`,
                pointerEvents: 'none',
              }} />
            </>
          : (
            <div style={{ display: 'grid', placeItems: 'center', height: '100%', gap: 10 }}>
              <span style={{ fontFamily: SERIF, fontSize: 44, color: T.faint }}>
                {r.title.slice(0, 1).toUpperCase()}
              </span>
            </div>
          )}
        <div style={{
          position: 'absolute', top: 'max(12px, env(safe-area-inset-top))', left: 12, right: 12,
          display: 'flex', justifyContent: 'space-between', gap: 8,
        }}>
          <button onClick={() => nav(-1)} style={roundBtn} aria-label="Back">←</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => favorite.mutate()}
              style={{ ...roundBtn, color: r.favorite ? T.accent : T.ink }}
              aria-label={r.favorite ? 'Remove from saved' : 'Save'}
            >
              {r.favorite ? '★' : '☆'}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={setImage.isPending}
              style={roundBtn}
              aria-label="Change photo"
            >
              {setImage.isPending ? '…' : '⌾'}
            </button>
            {r.source_url && (
              <a href={r.source_url} target="_blank" rel="noreferrer" style={roundBtn} aria-label="Open the original">↗</a>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            // Reset the input's value or picking the SAME file twice (after a
            // failed upload) fires no change event and looks like a dead button.
            e.target.value = ''
            if (f) setImage.mutate(f)
          }}
        />
      </div>

      <div style={{ padding: '18px 16px 0', display: 'grid', gap: 16 }}>
        <div>
          <h1 style={display(30)}>{r.title}</h1>
          {(r.source_name || r.source_url) && (
            <div style={{ ...body(13), marginTop: 8, color: T.muted }}>
              {r.source_name && <span>by {r.source_name}</span>}
              {r.source_name && r.source_url && ' · '}
              {r.source_url && (
                <a href={r.source_url} target="_blank" rel="noreferrer"
                   style={{ color: T.muted, textDecoration: 'underline' }}>
                  See original
                </a>
              )}
            </div>
          )}
          {r.description && <p style={{ ...body(15), marginTop: 12 }}>{r.description}</p>}
        </div>

        {/* ── Stat row ───────────────────────────────────────────────────── */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
          paddingTop: 14, borderTop: `1px solid ${T.rule}`,
        }}>
          <Stat k="Skill" v={r.skill === 'easy' ? 'Easy' : r.skill === 'hard' ? 'Hard' : 'Medium'} />
          <Stat k="Time" v={minutes(totalTime)} />
          <Stat k="Ingredients" v={String(r.ingredients.length)} />
          <Stat k="Calories" v={r.calories ? String(r.calories) : '—'} />
        </div>

        {note && (
          <div style={{
            ...body(13), background: T.accentSoft, border: `1px solid ${T.rule}`,
            borderRadius: 10, padding: '10px 12px', color: T.ink,
          }}>
            {note}
          </div>
        )}

        {/* ── Ingredients ────────────────────────────────────────────────── */}
        <div style={section()}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <h2 style={{ ...display(21), margin: 0 }}>Ingredients</h2>
            <button
              onClick={() => addToList.mutate()}
              disabled={addToList.isPending || skip.size === r.ingredients.length}
              style={{ ...button('ghost'), minHeight: 36, padding: '8px 14px', fontSize: 13 }}
            >
              {addToList.isPending
                ? 'Adding…'
                : skip.size ? `Add ${r.ingredients.length - skip.size} +` : 'Add all +'}
            </button>
          </div>

          {/* Untick what's already in the cupboard — the row stays readable,
              it just won't be sent to the shop. */}
          <div style={{ marginTop: 4 }}>
            {r.ingredients.map((ing, i) => {
              const off = skip.has(i)
              return (
                <button
                  key={i}
                  onClick={() => toggleSkip(i)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 11, width: '100%',
                    textAlign: 'left', background: 'none', border: 'none',
                    borderTop: i ? `1px solid ${T.rule}` : 'none',
                    padding: '11px 0', cursor: 'pointer',
                  }}
                >
                  <span style={{
                    flexShrink: 0, marginTop: 2, width: 18, height: 18, borderRadius: 5,
                    border: `1.5px solid ${off ? T.rule : T.ruleStrong}`,
                    background: off ? 'transparent' : T.ink,
                    color: T.paper, display: 'grid', placeItems: 'center',
                    fontSize: 11, lineHeight: 1,
                  }}>{off ? '' : '✓'}</span>
                  <span style={{ ...body(15), color: off ? T.faint : T.ink }}>
                    {scaled(ing, factor)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Method ─────────────────────────────────────────────────────── */}
        {r.steps.length > 0 && (
          <div style={section()}>
            <h2 style={{ ...display(21), margin: '0 0 4px' }}>Method</h2>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {r.steps.map((s, i) => (
                <li key={i} style={{
                  display: 'flex', gap: 13, padding: '13px 0',
                  borderTop: i ? `1px solid ${T.rule}` : 'none',
                }}>
                  <span style={{
                    fontFamily: SERIF, fontSize: 20, lineHeight: 1.2, color: T.accent,
                    flexShrink: 0, width: 24,
                  }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span style={body(15)}>{s}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {r.notes && (
          <div style={section()}>
            <div style={label()}>Notes</div>
            <p style={{ ...body(15), marginTop: 8, whiteSpace: 'pre-wrap' }}>{r.notes}</p>
          </div>
        )}

        {/* ── Plan ───────────────────────────────────────────────────────── */}
        <div style={section()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <div style={label()}>Plan it</div>
              <p style={{ ...body(13), marginTop: 6, color: T.muted }}>
                Puts it on the week board and the ingredients on the list.
              </p>
            </div>
            {!planning && (
              <button onClick={() => setPlanning(true)}
                      style={{ ...button('ghost'), minHeight: 38, padding: '9px 15px', fontSize: 13 }}>
                Pick a day
              </button>
            )}
          </div>
          {planning && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input
                type="date"
                style={{ ...input(), flex: 1 }}
                onChange={(e) => { if (e.target.value) plan.mutate(e.target.value) }}
                disabled={plan.isPending}
              />
              <button onClick={() => setPlanning(false)}
                      style={{ ...button('ghost'), minHeight: 44, padding: '12px 15px', fontSize: 13 }}>
                Cancel
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={label()}>
            {r.cooked_count ? `Cooked ${r.cooked_count}×` : 'Never cooked'}
          </span>
          <button
            onClick={() => { if (confirm(`Delete “${r.title}”?`)) remove.mutate() }}
            style={{ ...body(13), background: 'none', border: 'none', color: T.bad, cursor: 'pointer', padding: 8 }}
          >
            Delete recipe
          </button>
        </div>
      </div>

      {/* ── Action bar ───────────────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', left: 0, right: 0,
        // Sits on top of the tab bar, which is 52px plus the home indicator.
        bottom: 'calc(52px + env(safe-area-inset-bottom))',
        background: T.paperRaised,
        borderTop: `1px solid ${T.rule}`,
        padding: '10px 13px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        {r.servings ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flex: 1,
            border: `1px solid ${T.rule}`, borderRadius: 12, padding: '6px 10px',
          }}>
            <Step onClick={() => setServings((s) => Math.max(1, (s ?? r.servings!) - 1))}>−</Step>
            <span style={{ ...body(13), flex: 1, textAlign: 'center', whiteSpace: 'nowrap' }}>
              Cooking for {servings ?? r.servings}
            </span>
            <Step onClick={() => setServings((s) => Math.min(99, (s ?? r.servings!) + 1))}>+</Step>
          </div>
        ) : <div style={{ flex: 1 }} />}
        <button onClick={() => cooked.mutate()} disabled={cooked.isPending} style={button('primary')}>
          Cook
        </button>
      </div>
    </div>
  )
}

/**
 * The controls floating over the hero photo.
 *
 * Near-black at 62% with a blur, not a white pill: the photo is the only light
 * surface in the whole app now, so a white control on it disappears against a
 * plate or a bowl of cream, while a dark one reads against food of any colour
 * and matches the page it scrolls into. The hairline is white — a dark border
 * on a dark chip over an unpredictable photo has no edge at all.
 */
const roundBtn: React.CSSProperties = {
  width: 38, height: 38, borderRadius: 999,
  background: 'rgba(5,6,10,0.62)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,0.22)',
  color: T.ink,
  fontSize: 16, lineHeight: 1,
  display: 'grid', placeItems: 'center',
  cursor: 'pointer', textDecoration: 'none',
}

function Step({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: 32, height: 32, borderRadius: 8, border: `1px solid ${T.rule}`,
      background: 'transparent', color: T.ink, fontSize: 16, lineHeight: 1,
      display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0,
    }}>{children}</button>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={label({ fontSize: 9, letterSpacing: '0.1em' })}>{k}</div>
      <div style={{ fontFamily: SANS, fontSize: 14, marginTop: 5, color: T.ink }}>{v}</div>
    </div>
  )
}
