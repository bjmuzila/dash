/**
 * recipe-vite API client.
 *
 * Same shape as budget-vite's: relative paths so the nginx in front of this SPA
 * proxies them to the dashboard container, and credentials:'include' because
 * the hh_session cookie is HttpOnly — without it every call 401s.
 *
 * Deliberately a COPY, not a shared module. The two apps build and deploy
 * independently; a shared client would mean a change for the budget screens can
 * break the cookbook at build time, which is exactly the coupling the separate
 * subdomains exist to avoid. The auth block below is the only part that must
 * stay identical to budget-vite, and it is small enough to eyeball.
 */

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, message: string, body: any = null) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'include',
      cache: 'no-store',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  } catch {
    // Offline, tunnel down, container restarting. Distinguished from a real
    // HTTP error so the UI can say "can't reach the server" instead of
    // implying the password was wrong.
    throw new ApiError(0, 'Could not reach the server.');
  }

  const text = await res.text();
  let body: any = null;
  if (text) { try { body = JSON.parse(text); } catch { body = { error: text }; } }

  if (!res.ok) throw new ApiError(res.status, body?.error || `Request failed (${res.status})`, body);
  return body as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
};

// ── Types ────────────────────────────────────────────────────────────────────

export type HouseholdUser = {
  id: number
  email: string
  displayName: string
  budgetProfileKey: string
  tz: string
  mustChangePassword: boolean
  /** True when THIS browser is armed for quick (PIN) sign-in. */
  pinOnThisDevice: boolean
}

export type PinStatus = {
  hasPin: boolean
  displayName?: string
  /** EVERYONE armed on this browser, most recently used first. A shared tablet
   *  holds one device token and one row per person, so the pad greets both and
   *  the PIN itself picks which account opens. */
  names?: string[]
  attemptsLeft?: number
}

export type PinInfo = { hasPinOnThisDevice: boolean; devices: number }

export type Aisle = 'produce' | 'meat' | 'dairy' | 'bakery' | 'frozen' | 'pantry' | 'household' | 'other'

export type Category =
  | 'breakfast' | 'lunch' | 'dinner' | 'dessert' | 'bread' | 'cocktails' | 'sides' | 'sauces' | 'other'

export type Skill = 'easy' | 'intermediate' | 'hard'

/**
 * One ingredient, three ways.
 *
 * `raw` is the line as the recipe wrote it and is what you READ while cooking —
 * it always wins on screen. `qty`/`unit`/`item` are the parsed pieces and exist
 * for two jobs only: scaling ("cooking for 8") and the grocery hand-off. When
 * the parser couldn't make sense of a line, qty is null and the raw text is
 * used verbatim everywhere — you cannot double "a pinch".
 */
export type Ingredient = {
  raw: string
  qty: number | null
  unit: string | null
  item: string
  aisle: Aisle
}

/** The index row. No ingredients or steps — see CARD_COLS in the server lib. */
export type RecipeCard = {
  id: number
  owner_id: number
  visibility: 'private' | 'shared'
  title: string
  description: string | null
  image_url: string | null
  source_url: string | null
  source_name: string | null
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  calories: number | null
  category: Category
  skill: Skill
  favorite: boolean
  cooked_count: number
  last_cooked_at: string | null
  ingredient_count: number
  /** What the recipe is OF — derived at import from the title first, the
   *  ingredient aisles second, and left null when neither is confident. Stored
   *  rather than computed so it can be sorted and filtered on. */
  main_ingredient: string | null
  /** Set by bulk import, cleared when you review it. See the policy note in
   *  server-v2/_lib-household-recipes.cjs — bulk saves first and flags second. */
  needs_review: boolean
  /** Where the full write-up lives, when the caption linked it and we followed.
   *  `source_url` stays the VIDEO — that's what you saved and what dedupe is
   *  keyed on. */
  recipe_url: string | null
  /** The caption said the real recipe was elsewhere and there was nothing to
   *  follow. Imported anyway, flagged — half a recipe you don't know is half is
   *  worse than none, because you find out at step four. */
  partial: boolean
  /** The creator's own words: "recipe in bio". Quoting beats paraphrasing. */
  partial_note: string | null
  /** Content hash of the STORED photo, or null if we never copied one. Present
   *  on reads only — see IMG_ETAG in server-v2/_lib-household-recipes.cjs. */
  image_etag: string | null
  created_at: string
  updated_at: string
}

export type Recipe = Omit<RecipeCard, 'ingredient_count'> & {
  notes: string | null
  ingredients: Ingredient[]
  steps: string[]
}

/** What `import` returns. Not saved yet — the review screen posts it to
 *  `create`. camelCase, unlike the snake_case rows: this never touched the DB. */
export type Draft = {
  title: string
  description: string | null
  imageUrl: string | null
  sourceUrl: string | null
  sourceName: string | null
  servings: number | null
  prepMinutes: number | null
  cookMinutes: number | null
  calories: number | null
  category: Category
  skill: Skill
  ingredients: Ingredient[]
  steps: string[]
  /** How we read it — 'json-ld' (free and exact) or 'ai' (the fallback). Shown
   *  on the review screen so a hand-parsed import gets a closer look. */
  via: 'json-ld' | 'ai'
  recipeUrl?: string | null
  partial?: boolean
  partialNote?: string | null
}

export type SortKey = 'recent' | 'updated' | 'name' | 'main' | 'time' | 'cooked' | 'calories'

export type CookbookPayload = {
  recipes: RecipeCard[]
  categories: Category[]
  counts: Partial<Record<Category, number>>
  /** Main-ingredient facet, most common first — so the UI can offer
   *  "chicken (7)" instead of making you search for a word you'd have to
   *  already know is in there. */
  mains: { name: string; n: number }[]
  sorts: { key: SortKey; label: string }[]
  sort: SortKey
  /** How many recipes are flagged needs_review across the whole library (not
   *  just this filtered page) — drives the badge on the Review chip. */
  needsReview: number
  libraryTotal: number
  total: number
  /** False when ANTHROPIC_API_KEY isn't set on the server — the Add screen
   *  says so up front rather than failing after a 20-second fetch. */
  aiConfigured: boolean
}

export type ListItem = {
  id: number
  text: string
  qty: string | null
  aisle: Aisle
  meal_id: number | null
  recipe_id: number | null
}

export type Meal = {
  id: number
  day: string
  title: string
  notes: string | null
  recipe_id: number | null
}

// ── Endpoints ────────────────────────────────────────────────────────────────

export const auth = {
  me: () => api.get<{ user: HouseholdUser }>('/api/hh/auth/me'),
  login: (email: string, password: string) =>
    api.post<{ ok: true; user: HouseholdUser }>('/api/hh/auth/login', { email, password }),
  logout: () => api.post<{ ok: true }>('/api/hh/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: true }>('/api/hh/auth/change-password', { currentPassword, newPassword }),

  pinStatus: () => api.get<PinStatus>('/api/hh/auth/pin-status'),
  pinLogin: (pin: string) =>
    api.post<{ ok: true; user: HouseholdUser }>('/api/hh/auth/pin-login', { pin }),
  pinInfo: () => api.get<PinInfo>('/api/hh/auth/pin'),
  setPin: (pin: string) => api.post<{ ok: true }>('/api/hh/auth/pin', { pin }),
  removePin: (allDevices = false) =>
    api.post<{ ok: true }>('/api/hh/auth/pin/remove', { allDevices }),
}

/**
 * Where to actually load a recipe's photo from.
 *
 * Stored bytes win. `image_url` is only a fallback for the seconds between
 * saving a recipe and the background copy finishing — and for old rows whose
 * capture failed. It is NOT a long-term source: a TikTok or Instagram cover URL
 * is signed and expires within a day or two, which is the whole reason the
 * bytes get copied at all.
 *
 * The ?v=<etag> is load-bearing. The server sends `immutable, max-age=1 year`
 * only when it's present, so a replaced photo changes the URL and every phone
 * refetches instead of showing last month's picture until next year.
 */
export function imageSrc(r: { id: number; image_etag?: string | null; image_url?: string | null }): string | null {
  if (r.image_etag) return `/api/hh/recipes/image?id=${r.id}&v=${r.image_etag}`
  return r.image_url || null
}

export const recipes = {
  list: (opts: {
    q?: string; category?: string; main?: string; sort?: SortKey
    favorite?: boolean; needsReview?: boolean
  } = {}) => {
    const p = new URLSearchParams()
    if (opts.q) p.set('q', opts.q)
    if (opts.category && opts.category !== 'all') p.set('category', opts.category)
    if (opts.main) p.set('main', opts.main)
    if (opts.sort) p.set('sort', opts.sort)
    if (opts.favorite) p.set('favorite', '1')
    if (opts.needsReview) p.set('review', '1')
    const qs = p.toString()
    return api.get<CookbookPayload>(`/api/hh/recipes${qs ? `?${qs}` : ''}`)
  },
  get: (id: number) => api.get<{ recipe: Recipe }>(`/api/hh/recipes?id=${id}`),

  /** Reads a link (or pasted text) and returns a DRAFT. Nothing is saved. */
  /** `force` skips the "is this even a recipe" caption gate — offered when the
   *  gate rejects something you know perfectly well is food. */
  import: (src: { url?: string; text?: string; force?: boolean }) =>
    api.post<{ draft: Draft }>('/api/hh/recipes', { action: 'import', ...src }),

  create: (recipe: Partial<Draft>) =>
    api.post<{ recipe: Recipe }>('/api/hh/recipes', { action: 'create', recipe }),
  update: (id: number, patch: Partial<Draft> & { notes?: string; partial?: boolean }) =>
    api.post<{ recipe: Recipe }>('/api/hh/recipes', { action: 'update', id, patch }),
  remove: (id: number) => api.post<{ ok: true }>('/api/hh/recipes', { action: 'delete', id }),
  favorite: (id: number) => api.post<{ recipe: RecipeCard }>('/api/hh/recipes', { action: 'favorite', id }),
  cooked: (id: number) => api.post<{ recipe: RecipeCard }>('/api/hh/recipes', { action: 'cooked', id }),

  /** Writes real rows into the household grocery list. `only` is a list of
   *  ingredient INDEXES — leave it out to send everything. */
  addToList: (id: number, opts: { servings?: number; only?: number[] } = {}) =>
    api.post<{ added: number; items: ListItem[]; scaledBy: number }>(
      '/api/hh/recipes', { action: 'addToList', id, ...opts }),

  /** Puts it on the week board. `withList` defaults to FALSE on the server —
   *  planning and shopping happen at different moments, and "Add all" is a
   *  button on the recipe for when you're actually going. */
  plan: (id: number, opts: { day: string; servings?: number; withList?: boolean }) =>
    api.post<{ meal: Meal; list: { added: number } | null }>(
      '/api/hh/recipes', { action: 'plan', id, ...opts }),

  // ── Photo ────────────────────────────────────────────────────────────────
  /** Upload a photo. `dataUrl` must already be downscaled — see downscale(). */
  setImage: (id: number, dataUrl: string) =>
    api.post<{ etag: string; bytes: number; mime: string }>(
      '/api/hh/recipes/image', { id, dataUrl }),
  /** Re-copy from a link. The repair path when the import-time capture failed. */
  setImageFromUrl: (id: number, url: string) =>
    api.post<{ etag: string; bytes: number; mime: string }>(
      '/api/hh/recipes/image', { id, url }),
  removeImage: (id: number) =>
    api.post<{ ok: true; removed: true }>('/api/hh/recipes/image', { id, remove: true }),

  /** Clear the needs-review flag — "yes, I've looked at this one". */
  markReviewed: (id: number) =>
    api.post<{ recipe: Recipe }>('/api/hh/recipes', { action: 'update', id, patch: { needsReview: false } }),
  /** "I went and got the rest" — clears the partial flag and its note. */
  markComplete: (id: number) =>
    api.post<{ recipe: Recipe }>('/api/hh/recipes', { action: 'update', id, patch: { partial: false } }),
}

// ── Bulk import ──────────────────────────────────────────────────────────────

export type ImportJob = {
  id: number
  total: number
  done: number
  ok: number
  failed: number
  /** Links that resolved to a recipe already in the cookbook. Counted apart
   *  from failures because it isn't one — it's the dedupe working. */
  skipped: number
  /** Links the caption gate rejected before any AI call — a favourites export
   *  is full of them. Also not a failure, and not retried. */
  notrecipe: number
  /** Food, but no written recipe — the method is spoken in the video. The one
   *  miss pile worth working through by hand. */
  nowritten: number
  status: 'running' | 'done' | 'cancelled'
  created_at: string
  finished_at: string | null
}

export type ImportItem = {
  id: number
  url: string
  status: 'pending' | 'importing' | 'saved' | 'skipped' | 'notrecipe' | 'nowritten' | 'failed'
  recipe_id: number | null
  title: string | null
  error: string | null
  via: 'json-ld' | 'ai' | null
  updated_at: string
}

// ── The week ─────────────────────────────────────────────────────────────────

/** A row on the week board. `recipe_id` is null for a meal typed straight into
 *  budget.cbedge.net ("chinese takeaway") — those still show, greyed, because
 *  hiding them would make "Thursday is free" a lie. */
export type PlannedMeal = {
  id: number
  day: string
  title: string
  notes: string | null
  recipe_id: number | null
  main_ingredient: string | null
  prep_minutes: number | null
  cook_minutes: number | null
  servings: number | null
  image_url: string | null
  image_etag: string | null
}

export type WeekPayload = {
  weekStart: string
  weekEnd: string
  today: string
  days: { day: string; isToday: boolean; meals: PlannedMeal[] }[]
  planned: number
}

export const week = {
  /** `date` is any day inside the week you want; the server finds the Monday. */
  get: (date?: string) =>
    api.get<WeekPayload>(`/api/hh/recipes/week${date ? `?date=${date}` : ''}`),
  /** Deletes the hh_meals row only — the ingredients stay on the grocery list,
   *  because you may well still want them. */
  unplan: (mealId: number) =>
    api.post<{ ok: true }>('/api/hh/recipes/week', { mealId, remove: true }),
  move: (mealId: number, day: string) =>
    api.post<{ ok: true; meal: PlannedMeal }>('/api/hh/recipes/week', { mealId, day }),
}

export const bulk = {
  /** Starts a job and returns immediately — the imports keep running on the
   *  server. Thirty TikToks is minutes of fetching and AI calls, well past any
   *  request timeout, so this is polled rather than awaited. */
  start: (urls: string) =>
    api.post<{ ok: true; id: number; total: number; status: string; urls: number }>(
      '/api/hh/recipes/bulk', { urls }),
  /** No id = the most recent job, so reopening Add finds a batch still running
   *  instead of an empty form with no way back to it. */
  get: (id?: number) =>
    api.get<{ job: ImportJob | null; items: ImportItem[] }>(
      `/api/hh/recipes/bulk${id ? `?id=${id}` : ''}`),
  cancel: (id: number) =>
    api.post<{ job: ImportJob; items: ImportItem[] }>('/api/hh/recipes/bulk', { id, cancel: true }),
  /** Requeue only the failed rows. Saved and skipped ones are left alone, so
   *  this is safe to press repeatedly on a big batch. */
  retry: (id: number) =>
    api.post<{ job: ImportJob; items: ImportItem[] }>('/api/hh/recipes/bulk', { id, retry: true }),

  /** The by-hand pile: every link never imported, across EVERY job. Anything
   *  that later succeeded — by retry, re-paste, or typed in by hand — drops off
   *  by itself, so this list only ever shrinks. */
  misses: () => api.get<MissesPayload>('/api/hh/recipes/bulk?misses=1'),
}

export type ImportMiss = {
  url: string
  /** `failed` is worth retrying (a timeout, a block). `nowritten` is food with
   *  the method spoken aloud — open the video and type it. `notrecipe` saw no
   *  food at all — worth an eyeball before you bother. */
  status: 'failed' | 'notrecipe' | 'nowritten'
  error: string | null
  updated_at: string
  job_id: number
}

export type MissesPayload = {
  misses: ImportMiss[]
  total: number
  failed: number
  notrecipe: number
  nowritten: number
}

/**
 * Shrink a picked photo in the BROWSER before upload.
 *
 * A phone original is 3-5MB of 4032px JPEG; the app displays it at 390px wide
 * on a 4:3 hero. Downscaling here rather than server-side means no native image
 * library in the backend (sharp is a build-breaking dependency on a base-image
 * bump) and no multi-megabyte upload over a phone connection — a 1400px q0.82
 * JPEG lands around 200-300KB.
 *
 * 1400 rather than 800: this also has to look right on a desktop browser and on
 * a 3x phone screen, and storage is not the constraint at household scale.
 */
export function downscale(file: File, maxDim = 1400, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Could not read that image.')); return }
      ctx.drawImage(img, 0, 0, w, h)
      // Always JPEG: a photo re-encoded as PNG is several times larger for no
      // visible gain, and every browser can encode JPEG.
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')) }
    img.src = url
  })
}
