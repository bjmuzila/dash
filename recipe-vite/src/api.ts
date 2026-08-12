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
}

export type CookbookPayload = {
  recipes: RecipeCard[]
  categories: Category[]
  counts: Partial<Record<Category, number>>
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

export const recipes = {
  list: (opts: { q?: string; category?: string; favorite?: boolean } = {}) => {
    const p = new URLSearchParams()
    if (opts.q) p.set('q', opts.q)
    if (opts.category && opts.category !== 'all') p.set('category', opts.category)
    if (opts.favorite) p.set('favorite', '1')
    const qs = p.toString()
    return api.get<CookbookPayload>(`/api/hh/recipes${qs ? `?${qs}` : ''}`)
  },
  get: (id: number) => api.get<{ recipe: Recipe }>(`/api/hh/recipes?id=${id}`),

  /** Reads a link (or pasted text) and returns a DRAFT. Nothing is saved. */
  import: (src: { url?: string; text?: string }) =>
    api.post<{ draft: Draft }>('/api/hh/recipes', { action: 'import', ...src }),

  create: (recipe: Partial<Draft>) =>
    api.post<{ recipe: Recipe }>('/api/hh/recipes', { action: 'create', recipe }),
  update: (id: number, patch: Partial<Draft> & { notes?: string }) =>
    api.post<{ recipe: Recipe }>('/api/hh/recipes', { action: 'update', id, patch }),
  remove: (id: number) => api.post<{ ok: true }>('/api/hh/recipes', { action: 'delete', id }),
  favorite: (id: number) => api.post<{ recipe: RecipeCard }>('/api/hh/recipes', { action: 'favorite', id }),
  cooked: (id: number) => api.post<{ recipe: RecipeCard }>('/api/hh/recipes', { action: 'cooked', id }),

  /** Writes real rows into the household grocery list. `only` is a list of
   *  ingredient INDEXES — leave it out to send everything. */
  addToList: (id: number, opts: { servings?: number; only?: number[] } = {}) =>
    api.post<{ added: number; items: ListItem[]; scaledBy: number }>(
      '/api/hh/recipes', { action: 'addToList', id, ...opts }),

  /** Puts it on the week board, and (unless withList:false) the list too. */
  plan: (id: number, opts: { day: string; servings?: number; withList?: boolean }) =>
    api.post<{ meal: Meal; list: { added: number } | null }>(
      '/api/hh/recipes', { action: 'plan', id, ...opts }),
}
