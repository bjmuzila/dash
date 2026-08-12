import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { recipes as api, bulk as bulkApi, type Draft, type Category, type Skill, type ImportMiss } from '../api'
import { T, label, display, body, section, button, segment, input, track, fill, SANS, MONO } from '../theme'

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

type Mode = 'link' | 'text' | 'bulk' | 'manual'

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
    mutationFn: (force?: boolean) => api.import(mode === 'link' ? { url, force } : { text }),
    onSuccess: (res) => setDraft(res.draft),
  })
  /** The gate is tuned to be generous, but it will occasionally reject a caption
   *  that is genuinely a recipe — a video with the method spoken rather than
   *  written, say. One tap overrides it rather than sending you to Paste. */
  const gateRejected = /doesn.t look like a recipe/i.test((doImport.error as Error)?.message ?? '')

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
        {/* A segmented control, not three buttons. `button('primary')` is the
            page's one filled action and belongs on Import — spending it on a
            mode switch leaves nothing to mark the actual verb. */}
        {(['link', 'text', 'bulk', 'manual'] as Mode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)} style={{
            ...segment(mode === m), flex: 1, minHeight: 40, padding: '7px 6px',
          }}>
            {m === 'link' ? 'Link' : m === 'text' ? 'Paste' : m === 'bulk' ? 'Bulk' : 'By hand'}
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
            onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) doImport.mutate(undefined) }}
          />
          <button
            onClick={() => doImport.mutate(undefined)}
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
            onClick={() => doImport.mutate(undefined)}
            disabled={!text.trim() || doImport.isPending}
            style={{ ...button('primary'), width: '100%', marginTop: 10, opacity: text.trim() ? 1 : 0.5 }}
          >
            {doImport.isPending ? 'Reading it…' : 'Import'}
          </button>
        </div>
      )}

      {mode === 'bulk' && <BulkImport />}

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
          {gateRejected ? (
            <>
              <p style={{ ...body(13), marginTop: 8, color: T.muted }}>
                The caption had no amounts and no food words, so it was skipped before
                spending an AI call. If the method is spoken rather than written, import
                it anyway.
              </p>
              <button onClick={() => doImport.mutate(true)} disabled={doImport.isPending}
                      style={{ ...button('ghost'), width: '100%', marginTop: 10 }}>
                {doImport.isPending ? 'Reading it…' : 'Import anyway'}
              </button>
            </>
          ) : (
            <p style={{ ...body(13), marginTop: 8, color: T.muted }}>
              Some sites block automated readers. Copy the recipe text and use the Paste tab,
              or start a blank one.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Bulk ─────────────────────────────────────────────────────────────────────

/**
 * Paste a list of links, walk away.
 *
 * This is the one import path that SAVES WITHOUT REVIEW, and the copy says so
 * out loud. The reasoning: a review queue you must clear before anything lands
 * is a queue nobody clears at thirty items — you'd sit through twenty screens or
 * abandon the batch and lose the lot. Saving first and flagging second means the
 * work is never wasted; "to review" becomes a filter on the Cookbook you work
 * through when you feel like it.
 *
 * The job runs on the server and this polls it, because thirty TikToks is
 * minutes of fetching and AI calls — far past any request timeout, and far past
 * how long a phone screen stays awake.
 */
function BulkImport() {
  const qc = useQueryClient()
  const [urls, setUrls] = useState('')
  const [jobId, setJobId] = useState<number | null>(null)

  // No id on the first fetch: that returns the LATEST job, so reopening this tab
  // mid-batch shows the run in progress instead of an empty box and no way back.
  const { data } = useQuery({
    queryKey: ['bulk', jobId],
    queryFn: () => bulkApi.get(jobId ?? undefined),
    // Poll only while there is something to poll. 2s is fast enough to feel live
    // and slow enough that a 30-item batch is 30-odd requests, not 300.
    refetchInterval: (query) => (query.state.data?.job?.status === 'running' ? 2000 : false),
  })
  const job = data?.job ?? null
  const items = data?.items ?? []
  const running = job?.status === 'running'

  // Each save invalidates the cookbook so the new rows appear behind you rather
  // than after a manual refresh.
  useEffect(() => {
    if (!job) return
    qc.invalidateQueries({ queryKey: ['recipes'] })
    // The by-hand pile changes as the batch runs — a link that fails joins it,
    // a retry that works removes it.
    qc.invalidateQueries({ queryKey: ['bulk-misses'] })
  }, [job?.ok, job?.failed, job?.notrecipe, job?.nowritten, job?.status, qc, job])

  const start = useMutation({
    mutationFn: () => bulkApi.start(urls),
    onSuccess: (res) => { setJobId(res.id); setUrls('') },
  })
  const cancel = useMutation({
    mutationFn: () => bulkApi.cancel(job!.id),
    onSuccess: (res) => qc.setQueryData(['bulk', jobId], res),
  })
  const retry = useMutation({
    mutationFn: () => bulkApi.retry(job!.id),
    onSuccess: (res) => qc.setQueryData(['bulk', jobId], res),
  })

  const linkCount = (urls.match(/https?:\/\//gi) || []).length

  return (
    <>
      <div style={section()}>
        <h2 style={{ ...display(21), margin: 0 }}>Paste a list of links</h2>
        <p style={{ ...body(14), marginTop: 8 }}>
          One per line, or just paste the lot — commas, quotes and JSON are fine.
          Links you already have are skipped, and anything whose caption isn’t food
          is dropped before it costs an AI call. Up to 60 at a time.
        </p>
        <div style={{
          ...body(13), marginTop: 10, padding: '10px 12px', borderRadius: 10,
          background: T.accentSoft, border: `1px solid ${T.rule}`,
        }}>
          Unlike a single import, these <b>save straight away</b> and get flagged
          <b> to review</b>. Thirty review screens is not a thing anyone finishes —
          this way nothing is lost and you tidy them up from the Cookbook.
        </div>
        <textarea
          style={{ ...input(), marginTop: 12, minHeight: 170, padding: 13, lineHeight: 1.6, resize: 'vertical' }}
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder={'https://www.tiktok.com/@…/video/…\nhttps://www.tiktok.com/@…/video/…\nhttps://someblog.com/recipe'}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          onClick={() => start.mutate()}
          disabled={!linkCount || start.isPending || running}
          style={{ ...button('primary'), width: '100%', marginTop: 10, opacity: linkCount && !running ? 1 : 0.5 }}
        >
          {running ? 'A batch is already running…'
            : start.isPending ? 'Starting…'
            : linkCount ? `Import ${linkCount} link${linkCount === 1 ? '' : 's'}` : 'Import'}
        </button>
        {start.error && (
          <p style={{ ...body(13), marginTop: 8, color: T.bad }}>{(start.error as Error).message}</p>
        )}
      </div>

      <Misses />

      {job && (
        <div style={section()}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <h3 style={{ ...display(19), margin: 0 }}>
              {running ? 'Importing…' : job.status === 'cancelled' ? 'Cancelled' : 'Done'}
            </h3>
            <span style={label()}>{job.done} / {job.total}</span>
          </div>

          <div style={{ ...track({ marginTop: 10 }) }}>
            <div style={fill(job.total ? (job.done / job.total) * 100 : 0)} />
          </div>
          <div style={{ ...label(), marginTop: 8 }}>
            {job.ok} saved
            {job.skipped ? ` · ${job.skipped} already had` : ''}
            {job.nowritten ? ` · ${job.nowritten} no recipe` : ''}
            {job.notrecipe ? ` · ${job.notrecipe} not food` : ''}
            {job.failed ? ` · ${job.failed} failed` : ''}
          </div>

          {running && (
            <button onClick={() => cancel.mutate()} disabled={cancel.isPending}
                    style={{ ...button('ghost'), width: '100%', marginTop: 10 }}>
              Stop after the current one
            </button>
          )}

          {/* A hundred-link batch always throws off a few timeouts. Re-pasting
              the list to catch six of them would re-check a hundred URLs. */}
          {!running && !!job.failed && (
            <button onClick={() => retry.mutate()} disabled={retry.isPending}
                    style={{ ...button('primary'), width: '100%', marginTop: 10 }}>
              {retry.isPending ? 'Requeuing…' : `Retry ${job.failed} failed`}
            </button>
          )}

          <div style={{ marginTop: 4 }}>
            {items.map((it, i) => (
              <div key={it.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0',
                borderTop: i ? `1px solid ${T.rule}` : 'none',
              }}>
                <span style={{
                  fontFamily: MONO, fontSize: 8, letterSpacing: '.1em', marginTop: 3, width: 46,
                  flexShrink: 0,
                  // NO RECIPE gets the warn colour, not the faint one: it is
                  // the only miss you are meant to act on.
                  color: it.status === 'saved' ? T.accent
                    : it.status === 'failed' ? T.bad
                    : it.status === 'nowritten' ? T.warn
                    : it.status === 'skipped' || it.status === 'notrecipe' ? T.faint
                    : it.status === 'importing' ? T.warn : T.faint,
                }}>
                  {it.status === 'saved' ? 'SAVED'
                    : it.status === 'failed' ? 'FAILED'
                    : it.status === 'skipped' ? 'HAVE IT'
                    : it.status === 'nowritten' ? 'NO RECIPE'
                    : it.status === 'notrecipe' ? 'NOT FOOD'
                    : it.status === 'importing' ? '···' : 'QUEUED'}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  {it.recipe_id ? (
                    <Link to={`/r/${it.recipe_id}`} style={{ ...body(13.5), color: T.ink, textDecoration: 'none' }}>
                      {it.title}
                    </Link>
                  ) : (
                    // The URL, truncated from the LEFT: the tail is the video id
                    // and the handle, which is what identifies it. The
                    // "https://www.tiktok.com/@" prefix is the same on all of them.
                    <div style={{
                      ...body(12), color: T.faint, direction: 'rtl', textAlign: 'left',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{it.url}</div>
                  )}
                  {it.error && <div style={{ ...body(11.5), color: T.bad, marginTop: 3 }}>{it.error}</div>}
                  {it.via === 'ai' && (
                    <div style={{ ...label({ color: T.warn }), fontSize: 8, marginTop: 3 }}>READ BY AI</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/**
 * The by-hand pile — every link that never became a recipe, across every batch.
 *
 * Not part of the job panel above it, deliberately. Twenty-five batches means
 * twenty-five panels, and nobody is going to open each one to copy six URLs out.
 * This is one list that spans all of them, and it SHRINKS BY ITSELF: anything
 * later imported — by retry, by a re-paste, or typed in by hand — drops off,
 * because the query excludes any URL that ever succeeded and any URL whose
 * recipe now exists.
 */
function Misses() {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const { data } = useQuery({ queryKey: ['bulk-misses'], queryFn: () => bulkApi.misses() })
  if (!data?.total) return null

  const text = data.misses.map((m) => m.url).join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard is blocked outside a secure context and on some in-app
      // browsers. Opening the list is the fallback — you can still select it.
      setOpen(true)
    }
  }

  const download = () => {
    // Built in the browser from data already fetched: no endpoint, nothing to
    // authenticate, and it works offline once the list is on screen.
    const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `recipes-not-imported-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={section()}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <h3 style={{ ...display(19), margin: 0 }}>Not imported</h3>
        <span style={label()}>{data.total}</span>
      </div>
      <p style={{ ...body(13), marginTop: 6, color: T.faint }}>
        {data.nowritten ? `${data.nowritten} are food with the recipe spoken in the video · ` : ''}
        {data.failed} failed · {data.notrecipe} had no food in the caption.
        The spoken ones are listed first — those are the ones worth typing up.
        This list clears itself as they get imported.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={copy} style={{ ...button('ghost'), flex: 1 }}>
          {copied ? 'Copied' : 'Copy URLs'}
        </button>
        <button onClick={download} style={{ ...button('ghost'), flex: 1 }}>Download .txt</button>
        <button onClick={() => setOpen((v) => !v)} style={{ ...button('ghost'), flex: 1 }}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 4, maxHeight: 320, overflowY: 'auto' }}>
          {data.misses.map((m, i) => <MissRow key={m.url} m={m} first={i === 0} />)}
        </div>
      )}
    </div>
  )
}

function MissRow({ m, first }: { m: ImportMiss; first: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '9px 0', borderTop: first ? 'none' : `1px solid ${T.rule}`,
    }}>
      <span style={{
        fontFamily: MONO, fontSize: 8, letterSpacing: '.1em', marginTop: 3,
        width: 46, flexShrink: 0,
        color: m.status === 'failed' ? T.bad : m.status === 'nowritten' ? T.warn : T.faint,
      }}>
        {m.status === 'failed' ? 'FAILED' : m.status === 'nowritten' ? 'NO RECIPE' : 'NOT FOOD'}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        {/* Opens the video so you can look at it before deciding. rel=noreferrer
            because there is no reason to tell TikTok where the click came from. */}
        <a href={m.url} target="_blank" rel="noreferrer" style={{
          ...body(12), color: T.accent, textDecoration: 'none',
          // Truncated from the LEFT: the tail is the video id, which is the part
          // that identifies it. The prefix is identical on all of them.
          display: 'block', direction: 'rtl', textAlign: 'left',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{m.url}</a>
        {m.error && <div style={{ ...body(11.5), color: T.faint, marginTop: 3 }}>{m.error}</div>}
      </div>
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
