import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { recipes as api, type Draft, type Category, type Skill } from '../api'
import { T, label, display, body, section, button, input, SANS } from '../theme'

/**
 * Add a recipe. Three ways in, one way out.
 *
 *   Link  — paste a URL. The server reads the page's schema.org JSON-LD first
 *           (free, exact, and already there on most food blogs) and only falls
 *           back to Claude when there isn't any.
 *   Text  — paste an Instagram caption, a screenshot transcription, a note from
 *           your mum. Always the AI path; there's nothing structured to read.
 *   By hand — type it.
 *
 * All three land on the SAME review screen, and nothing is saved until you hit
 * save there. That is the whole design: import is the step most likely to get
 * something subtly wrong, and a cookbook that quietly fills up with half-read
 * blog posts is worse than one you paste into by hand.
 */

type Mode = 'link' | 'text' | 'manual'

const CATEGORIES: Category[] =
  ['breakfast', 'lunch', 'dinner', 'dessert', 'bread', 'cocktails', 'sides', 'sauces', 'other']
const SKILLS: Skill[] = ['easy', 'intermediate', 'hard']

const blankDraft = (): Draft => ({
  title: '', description: null, imageUrl: null, sourceUrl: null, sourceName: null,
  servings: null, prepMinutes: null, cookMinutes: null, calories: null,
  category: 'dinner', skill: 'easy', ingredients: [], steps: [], via: 'json-ld',
})

export default function Add() {
  const nav = useNavigate()
  const qc = useQueryClient()

  const [mode, setMode] = useState<Mode>('link')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)

  // Only for the "AI import isn't set up" notice — cheap, cached, and it means
  // the Text tab can tell you up front instead of after a 20-second wait.
  const { data: cookbook } = useQuery({ queryKey: ['recipes', '', 'all', false], queryFn: () => api.list() })

  const doImport = useMutation({
    mutationFn: () => api.import(mode === 'link' ? { url } : { text }),
    onSuccess: (res) => setDraft(res.draft),
  })

  const save = useMutation({
    mutationFn: (d: Draft) => api.create(d),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['recipes'] })
      nav(`/r/${res.recipe.id}`, { replace: true })
    },
  })

  if (draft) {
    return (
      <Review
        draft={draft}
        onChange={setDraft}
        onCancel={() => setDraft(null)}
        onSave={() => save.mutate(draft)}
        saving={save.isPending}
        error={save.error ? (save.error as Error).message : null}
      />
    )
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {(['link', 'text', 'manual'] as Mode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)} style={{
            ...button(mode === m ? 'primary' : 'ghost'),
            flex: 1, minHeight: 40, fontSize: 13, padding: '10px 8px',
          }}>
            {m === 'link' ? 'Link' : m === 'text' ? 'Paste' : 'By hand'}
          </button>
        ))}
      </div>

      {mode === 'link' && (
        <div style={section()}>
          <h2 style={{ ...display(21), margin: 0 }}>Paste a recipe link</h2>
          <p style={{ ...body(14), marginTop: 8 }}>
            Any recipe site. The page’s own structured data is read first, so most
            imports are instant and exact.
          </p>
          <input
            style={{ ...input(), marginTop: 12 }}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) doImport.mutate() }}
          />
          <button
            onClick={() => doImport.mutate()}
            disabled={!url.trim() || doImport.isPending}
            style={{ ...button('primary'), width: '100%', marginTop: 10, opacity: url.trim() ? 1 : 0.5 }}
          >
            {doImport.isPending ? 'Reading the page…' : 'Import'}
          </button>
        </div>
      )}

      {mode === 'text' && (
        <div style={section()}>
          <h2 style={{ ...display(21), margin: 0 }}>Paste the recipe</h2>
          <p style={{ ...body(14), marginTop: 8 }}>
            An Instagram caption, a screenshot you typed out, a note. This one always
            goes through the AI — there’s no structured data in loose text to read.
          </p>
          {cookbook && !cookbook.aiConfigured && (
            <div style={{
              ...body(13), marginTop: 10, padding: '10px 12px', borderRadius: 10,
              background: T.accentSoft, border: `1px solid ${T.rule}`,
            }}>
              AI import isn’t set up on the server yet — add <code>ANTHROPIC_API_KEY</code> to
              .env.local and redeploy. Link imports of sites with structured data still work.
            </div>
          )}
          <textarea
            style={{ ...input(), marginTop: 12, minHeight: 220, padding: 13, lineHeight: 1.5, resize: 'vertical' }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Sticky banana bread pudding cake\n\n4 ripe bananas\n2 tsp vanilla…'}
          />
          <button
            onClick={() => doImport.mutate()}
            disabled={!text.trim() || doImport.isPending}
            style={{ ...button('primary'), width: '100%', marginTop: 10, opacity: text.trim() ? 1 : 0.5 }}
          >
            {doImport.isPending ? 'Reading it…' : 'Import'}
          </button>
        </div>
      )}

      {mode === 'manual' && (
        <div style={section()}>
          <h2 style={{ ...display(21), margin: 0 }}>Type it in</h2>
          <p style={{ ...body(14), marginTop: 8 }}>
            Family recipes, things off a card, anything that was never on the internet.
          </p>
          <button onClick={() => setDraft(blankDraft())}
                  style={{ ...button('primary'), width: '100%', marginTop: 12 }}>
            Start a blank recipe
          </button>
        </div>
      )}

      {doImport.error && (
        <div style={section()}>
          <div style={label({ color: T.bad })}>Import failed</div>
          <p style={{ ...body(14), marginTop: 8 }}>{(doImport.error as Error).message}</p>
          <p style={{ ...body(13), marginTop: 8, color: T.muted }}>
            Some sites block automated readers. Copy the recipe text and use the Paste tab,
            or start a blank one.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Review ───────────────────────────────────────────────────────────────────

/**
 * The review screen. Everything is editable BEFORE it becomes a row, because
 * fixing one wrong ingredient here is a tap and fixing it later means opening
 * the recipe you were about to cook from.
 *
 * Ingredients and steps are edited as plain text areas, one per line. A
 * per-ingredient form with qty/unit/item fields would be more "correct" and far
 * worse to use: recipe text arrives as lines and the server re-parses whatever
 * lines it's given, so the textarea IS the right shape.
 */
function Review({ draft, onChange, onCancel, onSave, saving, error }: {
  draft: Draft
  onChange: (d: Draft) => void
  onCancel: () => void
  onSave: () => void
  saving: boolean
  error: string | null
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v })
  const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v))) || null)

  return (
    <div style={{ display: 'grid', gap: 14, paddingBottom: 20 }}>
      <div style={section()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div style={label()}>Review</div>
          {/* An AI-read import is worth a closer look than a JSON-LD one, and
              saying which is which is cheaper than making you guess. */}
          <div style={label({ color: draft.via === 'ai' ? T.warn : T.good })}>
            {draft.via === 'ai' ? 'Read by AI' : 'From the page'}
          </div>
        </div>
        <input
          style={{ ...input(), marginTop: 10, fontFamily: SANS, fontSize: 17 }}
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Recipe name"
        />
        <textarea
          style={{ ...input(), marginTop: 8, minHeight: 70, padding: 13, lineHeight: 1.5, resize: 'vertical' }}
          value={draft.description ?? ''}
          onChange={(e) => set('description', e.target.value || null)}
          placeholder="A line about it (optional)"
        />
      </div>

      <div style={section()}>
        <div style={label()}>Details</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <Field k="Servings" v={draft.servings} onChange={(v) => set('servings', num(v))} />
          <Field k="Calories" v={draft.calories} onChange={(v) => set('calories', num(v))} />
          <Field k="Prep (min)" v={draft.prepMinutes} onChange={(v) => set('prepMinutes', num(v))} />
          <Field k="Cook (min)" v={draft.cookMinutes} onChange={(v) => set('cookMinutes', num(v))} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <div>
            <div style={label()}>Category</div>
            <select style={{ ...input(), marginTop: 6 }} value={draft.category}
                    onChange={(e) => set('category', e.target.value as Category)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div style={label()}>Skill</div>
            <select style={{ ...input(), marginTop: 6 }} value={draft.skill}
                    onChange={(e) => set('skill', e.target.value as Skill)}>
              {SKILLS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div style={section()}>
        <div style={label()}>Ingredients — one per line</div>
        <textarea
          style={{ ...input(), marginTop: 8, minHeight: 190, padding: 13, lineHeight: 1.6, resize: 'vertical' }}
          // Edited as `raw` lines and re-parsed server-side on save, so a hand
          // correction gets the same quantity/aisle treatment as an import.
          value={draft.ingredients.map((i) => i.raw).join('\n')}
          onChange={(e) => set('ingredients', e.target.value.split('\n').filter((l) => l.trim()).map((raw) => ({
            raw: raw.trim(), qty: null, unit: null, item: raw.trim(), aisle: 'other' as const,
          })))}
          placeholder={'1 1/2 cups whole milk\n4 ripe bananas\nA pinch of salt'}
        />
      </div>

      <div style={section()}>
        <div style={label()}>Method — one step per line</div>
        <textarea
          style={{ ...input(), marginTop: 8, minHeight: 190, padding: 13, lineHeight: 1.6, resize: 'vertical' }}
          value={draft.steps.join('\n')}
          onChange={(e) => set('steps', e.target.value.split('\n').filter((l) => l.trim()))}
          placeholder={'Heat the oven to 350°F.\nWhisk the eggs and sugar…'}
        />
      </div>

      {error && (
        <div style={section()}>
          <div style={label({ color: T.bad })}>Couldn’t save</div>
          <p style={{ ...body(14), marginTop: 8 }}>{error}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onCancel} style={{ ...button('ghost'), flex: 1 }}>Cancel</button>
        <button
          onClick={onSave}
          disabled={saving || !draft.title.trim() || draft.ingredients.length === 0}
          style={{ ...button('primary'), flex: 2, opacity: draft.title.trim() && draft.ingredients.length ? 1 : 0.5 }}
        >
          {saving ? 'Saving…' : 'Save to cookbook'}
        </button>
      </div>
    </div>
  )
}

function Field({ k, v, onChange }: { k: string; v: number | null; onChange: (v: string) => void }) {
  return (
    <div>
      <div style={label()}>{k}</div>
      <input
        style={{ ...input(), marginTop: 6 }}
        value={v ?? ''}
        onChange={(e) => onChange(e.target.value)}
        type="number"
        inputMode="numeric"
        min={0}
        placeholder="—"
      />
    </div>
  )
}
