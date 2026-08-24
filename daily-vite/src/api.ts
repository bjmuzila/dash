/**
 * daily-vite API client — the one place that knows what the server's URLs and
 * shapes are.
 *
 * Every request goes to a RELATIVE path, so the nginx in front of this SPA
 * proxies it to the daily backend container. `credentials:'include'` is
 * required: the dy_session cookie is HttpOnly and host-only, and without this
 * flag fetch would omit it and every call would 401.
 *
 * Two things this file does that the private household app's client did not,
 * because this one has paying customers:
 *
 *   1. It distinguishes 401 (not signed in) from 402 (signed in, not paying).
 *      Those need completely different screens — one is a login form, the other
 *      is a pricing page — and conflating them signs a paying-but-lapsed
 *      customer out of an account they are perfectly entitled to be in.
 *   2. It never assumes a call succeeded because the HTTP status was 200. The
 *      calendar and markets endpoints deliberately answer 200 with an `error`
 *      or `warning` inside the body, so a Google outage renders as a card that
 *      says so rather than as a blank screen.
 */

export class ApiError extends Error {
  status: number
  /** The parsed error body, when there was one. Most callers only need
   *  `message`; PIN sign-in also reads `forgotten` / `attemptsLeft` off this. */
  body: any
  constructor(status: number, message: string, body: any = null) {
    super(message)
    this.status = status
    this.body = body
    this.name = 'ApiError'
  }
}

/** True when the failure was "you aren't signed in", not "you aren't paying". */
export const isSignedOut = (e: unknown) => e instanceof ApiError && e.status === 401
/** True when the account is real and signed in but the subscription is not
 *  current. The app routes these to /pricing, never to /sign-in. */
export const isUnpaid = (e: unknown) => e instanceof ApiError && e.status === 402

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      credentials: 'include',
      cache: 'no-store',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    })
  } catch {
    // Offline, tunnel down, container restarting. Status 0 is distinguished from
    // a real HTTP error so the UI can say "can't reach the server" instead of
    // implying the password was wrong.
    throw new ApiError(0, 'Could not reach the server.')
  }

  const text = await res.text()
  let body: any = null
  if (text) { try { body = JSON.parse(text) } catch { body = { error: text } } }

  if (!res.ok) throw new ApiError(res.status, body?.message || body?.error || `Request failed (${res.status})`, body)
  return body as T
}

export const api = {
  get: <T,>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
}

// ── Identity ─────────────────────────────────────────────────────────────────

export type SubStatus =
  | 'none' | 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete'
  | 'incomplete_expired' | 'paused'

export type Subscription = {
  status: SubStatus
  plan: 'monthly' | 'annual' | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

export type User = {
  id: number
  email: string
  displayName: string
  tz: string
  role: 'owner' | 'member'
  householdId: number
  householdName: string | null
  emailVerified: boolean
  mustChangePassword: boolean
  /** False until the person has been through /welcome once. */
  onboarded: boolean
  googleEmail: string | null
  /** The entitlement decision, already made by the server. The SPA never
   *  reasons about Stripe statuses itself — see publicUser in daily-routes.cjs. */
  entitled: boolean
  /** The site owner. Comes from an env var on the server compared against this
   *  session's own email, so nothing in the browser can claim it — but it is
   *  still only a HINT for what to draw. Every admin route re-checks. */
  admin: boolean
  subscription: Subscription
  /** True when THIS browser is armed for quick (PIN) sign-in. Comes from the
   *  dy_device cookie, so it is per-device and not a property of the account. */
  pinOnThisDevice: boolean
}

export type PinStatus = { hasPin: boolean; names?: string[]; attemptsLeft?: number }

// ── Content ──────────────────────────────────────────────────────────────────

export type Task = {
  id: number
  household_id: number
  created_by: number | null
  title: string
  notes: string | null
  /** Always 'YYYY-MM-DD' or null — the server casts it to text so no timezone
   *  can shift it a day. Never wrap it in `new Date()` for display. */
  due_date: string | null
  starred: boolean
  /** Separate from `starred`: starred = one of my Top 3 today, urgent = can't
   *  wait. Overloading one flag would make pinning something mark it urgent. */
  urgent: boolean
  project_id: number | null
  done_at: string | null
  created_at: string
  updated_at: string
  touched_at: string
}

export type Note = {
  id: number
  created_by: number | null
  kind: 'note' | 'quote' | 'journal'
  body: string
  created_at: string
  last_surfaced_at: string | null
}

export type Person = { id: number; displayName: string }

export type NewTask = {
  title: string
  urgent?: boolean
  projectId?: number | null
  notes?: string
  dueDate?: string | null
  starred?: boolean
}
export type TaskPatch = Partial<NewTask> & { title?: string }

// ── Calendar ─────────────────────────────────────────────────────────────────

export type CalendarStatus = {
  configured: boolean
  connected: boolean
  googleEmail?: string | null
  shareWithHousehold?: boolean | null
  selectedCalendars?: string[] | null
  lastSyncedAt?: string | null
  /** Set when the stored connection stopped working — the token was revoked in
   *  the Google account, or the refresh failed. The UI offers Reconnect. */
  needsReconnect?: boolean
}

export type GoogleCalendar = {
  id: string
  name: string
  primary: boolean
  color: string | null
  accessRole: string | null
  /** Only a calendar you can write to may be the target of "add to calendar". */
  writable: boolean
}

export type CalendarEvent = {
  /** Calendar-qualified ('<calendarId>:<eventId>') — the same invite can appear
   *  on two calendars, and a bare event id would collide as a React key. */
  id: string
  calendarId: string
  calendarName: string | null
  /** The CALENDAR's colour, not the event's own colorId — two events on one
   *  calendar should look related. */
  colour: string | null
  summary: string
  allDay: boolean
  /** RFC3339 with offset for timed events, 'YYYY-MM-DD' for all-day ones. */
  start: string | null
  end: string | null
  location: string | null
  /** Whose connection this came from, when a household member shared theirs. */
  owner?: string | null
}

export type CalendarDay = {
  date: string
  from?: string
  to?: string
  events: CalendarEvent[]
  calendarCount?: number
  partialFailures?: number
  /** 'not-configured' | 'not-connected' | 'none-selected' | 'revoked' |
   *  'google-unavailable'. Always a 200 — the card renders its own state. */
  error?: string
}

// ── Markets ──────────────────────────────────────────────────────────────────

export type EconEvent = {
  date: string
  time: string
  time_formatted: string
  title: string
  country: string
  impact: string
  forecast: string
  previous: string
  actual: string
}

export type EarningsRow = {
  date: string
  symbol: string
  company: string | null
  session: string | null
  market_cap: number | null
  eps_est: number | null
}

export type MarketsWeek = {
  days: string[]
  econ: {
    events: EconEvent[]
    source: string
    savedAt?: string | null
    /** A human sentence when the feed is stale or unreachable. Rendered as-is:
     *  a hard failure that looks like a quiet week went unnoticed for six weeks
     *  on the trading dashboard, which is why this exists. */
    warning?: string | null
  }
  earnings: {
    rows: EarningsRow[]
    note?: string | null
  }
}

// ── Money ────────────────────────────────────────────────────────────────────

export type AccountKind = 'checking' | 'savings' | 'credit' | 'cash'

export type Account = {
  id: number
  name: string
  kind: AccountKind
  sortOrder: number
  archived: boolean
  createdAt: string
}

export type MonthAccount = Account & {
  /** Where the account started the month. */
  opening: number
  /** Cash on hand — the last logged balance, not a projection. */
  bankNow: number
  /** Where the month ends up once every scheduled line lands. */
  ending: number
}

export type BudgetRow = {
  /** Negative id = a projected recurring bill with no database row behind it.
   *  It cannot be edited or deleted — only marked paid, which materialises it. */
  id: number
  date: string
  label: string
  accountId: number
  accountName: string | null
  kind: 'income' | 'expense'
  amount: number
  categoryId: number | null
  recurring: boolean
  recurringTag: string | null
  ruleId: number | null
  balance: number
  balances: Record<string, number>
  total: number
  paid: boolean
  past: boolean
}

export type BudgetBill = {
  tag: string
  ruleId: number | null
  label: string
  accountId: number
  accountName: string | null
  kind: 'income' | 'expense'
  amount: number
  date: string
  overdue: boolean
}

export type BudgetCategory = {
  id: number
  name: string
  kind: 'income' | 'expense'
  color: string | null
  sortOrder: number
  spent: number
}

export type RecurringRule = {
  id: number
  accountId: number
  label: string
  amount: number
  kind: 'income' | 'expense'
  frequency: 'weekly' | 'biweekly' | 'monthly'
  anchorDate: string
  categoryId: number | null
  active: boolean
}

export type BudgetMonth = {
  month: string
  today: string
  tz: string
  currency: string
  /** True for a household that has not created a single account yet. Every
   *  money screen must render for this case — it is what a new customer sees. */
  needsAccount: boolean
  accounts: MonthAccount[]
  opening: Record<string, number>
  openingTotal: number
  balances: Record<string, number>
  bankNow: Record<string, number>
  inBank: number
  bankAsOf: string | null
  totals: {
    income: number
    expenses: number
    net: number
    endingBalance: number
    billsLeft: number
    payComing: number
  }
  rows: BudgetRow[]
  bills: BudgetBill[]
  categories: BudgetCategory[]
  unsortedSpend: number
  recurringCount: number
}

export type MoneySummary = {
  month: string
  today: string
  currency: string
  needsAccount: boolean
  accountCount: number
  balances: Record<string, number>
  inBank: number
  asOf: string | null
  spent: number
  income: number
  billsLeft: number
  remaining: number
  projectedEom: number
  overdueCount: number
  overdueTotal: number
  nextBill: BudgetBill | null
  nextBills: BudgetBill[]
  overdueBills: BudgetBill[]
}

// ── Routines / projects / lists ───────────────────────────────────────────────

export type RoutineBlock = 'morning' | 'afternoon' | 'evening'

export type Routine = {
  id: number
  title: string
  block: RoutineBlock
  sortOrder: number
  done: boolean
  /** Consecutive days, ending today OR yesterday — an unfinished today does
   *  not break it. */
  streak: number
  best: number
  last30: number
  history: { day: string; done: boolean }[]
}

export type RoutinesPayload = {
  date: string
  today: string
  blocks: { block: RoutineBlock; items: Routine[]; done: number; total: number }[]
  total: number
  doneToday: number
  history: { day: string; done: number; total: number }[]
}

export type ProjectStatus = 'active' | 'someday' | 'done'

export type Project = {
  id: number
  createdBy: number | null
  name: string
  description: string | null
  status: ProjectStatus
  target_date: string | null
  sortOrder: number
  created_at: string
  updated_at: string
  milestones?: { total: number; done: number }
  tasks?: { total: number; open: number }
  minutes?: number
  /** null when the project has no milestones — unknown, not zero. */
  progress?: number | null
}

export type Milestone = { id: number; title: string; sort_order: number; done_at: string | null }
export type TimeEntry = { id: number; day: string; minutes: number; note: string | null; user_id: number }

export type ProjectDetail = Project & {
  milestones: Milestone[]
  tasks: Task[]
  timeEntries: TimeEntry[]
  minutesThisWeek: number
}

export type Aisle = 'produce' | 'meat' | 'dairy' | 'bakery' | 'frozen' | 'pantry' | 'household' | 'other'

export type ListItem = {
  id: number
  created_by: number | null
  list: string
  text: string
  qty: string | null
  aisle: Aisle
  meal_id: number | null
  checked_at: string | null
  checked_by: number | null
  sort_order: number
  /** When it went on the list. On a shared list this is what separates "we need
   *  milk" from "that's been sitting there for three weeks". */
  created_at: string
}

export type Meal = {
  id: number
  created_by: number | null
  day: string
  title: string
  notes: string | null
  sort_order: number
  items: ListItem[]
}

export type MealRef = { id: number; day: string; title: string }

export type ListsPayload = {
  weekStart: string
  weekEnd: string
  today: string
  days: { day: string; isToday: boolean; meals: Meal[]; itemCount: number; openCount: number }[]
  mealRefs: MealRef[]
  aisles: { aisle: Aisle; items: ListItem[] }[]
  checked: ListItem[]
  other: ListItem[]
  counts: { open: number; checked: number; total: number; meals: number }
  aisleOptions: Aisle[]
}

// ── Settings / weather / today ────────────────────────────────────────────────

export type Settings = {
  /** US ZIP for the weather tile on Today. '' = tile stays quiet. */
  weatherZip: string
  showEconCalendar: boolean
  showEarnings: boolean
  todayOrder: string[] | null
}

export type Weather = { tempF: number; condition: string; code: number; place: string }

export type TodayMarkets = {
  date: string
  highImpactToday: number
  earningsToday: string[]
  earningsCount: number
  warning: string | null
  note: string | null
}

export type TodayPayload = {
  today: string
  tz: string
  slippingDays: number
  top3: Task[]
  open: Task[]
  slipping: Task[]
  counts: { open: number; overdue: number; due_today: number; done_today: number }
  resurfacing: Note | null
  people: Person[]
  settings: Settings | null
  calendar: CalendarStatus
  routines: { done: number; total: number; date: string } | null
  lists: { groceryOpen: number; tonight: string | null } | null
  money: MoneySummary | null
  markets: TodayMarkets | null
}

// ── Billing / household ───────────────────────────────────────────────────────

export type Plan = {
  id: 'monthly' | 'annual'
  priceId: string
  name: string
  /** Stripe minor units — 800 is $8.00. Prefer `priceLabel` for display; this
   *  is here for anything that needs to compare or sort. */
  amount: number
  currency: string
  interval: string
  /** Pre-formatted by the server, alongside the amount, so the marketing page
   *  and the Stripe checkout can never show two different prices. */
  priceLabel?: string
  intervalLabel?: string
  badge?: string
  blurb?: string
}

export type BillingStatus = Subscription & { needsAction: boolean; configured: boolean }

export type Member = {
  id: number
  email: string
  displayName: string
  role: 'owner' | 'member'
  emailVerified: boolean
  lastLoginAt: string | null
}

export type HouseholdPayload = {
  household: { id: number; name: string; role: 'owner' | 'member' }
  members: Member[]
  invites: { email: string; created_at: string; expires_at: string }[]
  seats: number
  seatsUsed: number
}

// ── Endpoints ────────────────────────────────────────────────────────────────

const P = '/api/daily'

export const auth = {
  me: () => api.get<{ user: User }>(`${P}/auth/me`),
  signup: (b: { email: string; password: string; displayName?: string; tz?: string }) =>
    api.post<{ ok: true; user: User; needsCheckout: boolean }>(`${P}/auth/signup`, b),
  login: (email: string, password: string) =>
    api.post<{ ok: true; user: User }>(`${P}/auth/login`, { email, password }),
  logout: () => api.post<{ ok: true }>(`${P}/auth/logout`),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: true }>(`${P}/auth/change-password`, { currentPassword, newPassword }),
  /** Name and timezone only. The email address is not editable here on purpose
   *  — changing it is an identity change that has to re-verify. */
  updateProfile: (p: { displayName?: string; tz?: string }) =>
    api.post<{ ok: true; user: User }>(`${P}/auth/profile`, p),
  /** Marks the first-run walkthrough finished. It has to be a server call: step
   *  two of onboarding navigates away to Google, so an in-memory flag would be
   *  gone by the time the person comes back. */
  completeOnboarding: () => api.post<{ ok: true; user: User }>(`${P}/auth/onboarded`),

  forgot: (email: string) => api.post<{ ok: true }>(`${P}/auth/forgot`, { email }),
  reset: (token: string, password: string) =>
    api.post<{ ok: true; user: User }>(`${P}/auth/reset`, { token, password }),
  verify: (token: string) =>
    api.post<{ ok: true; alreadyVerified?: boolean }>(`${P}/auth/verify`, { token }),
  resendVerification: () => api.post<{ ok: true; sent: boolean }>(`${P}/auth/resend-verification`),

  // Quick sign-in. No token is ever handed to JS: arming a PIN sets a second
  // HttpOnly cookie (dy_device) and the PIN is only half the credential.
  pinStatus: () => api.get<PinStatus>(`${P}/auth/pin-status`),
  pinLogin: (pin: string) => api.post<{ ok: true; user: User }>(`${P}/auth/pin-login`, { pin }),
  pinInfo: () => api.get<{ hasPinOnThisDevice: boolean; devices: number }>(`${P}/auth/pin`),
  setPin: (pin: string) => api.post<{ ok: true }>(`${P}/auth/pin`, { pin }),
  removePin: () => api.post<{ ok: true }>(`${P}/auth/pin/remove`),

  /**
   * A full page navigation, NOT a fetch — the browser has to follow the redirect
   * to Google's consent screen.
   *
   * There is deliberately no googleSignInUrl. Signing in is email and password
   * only; Google is a CALENDAR integration here and nothing else, so linking one
   * requires an account that already exists. The server refuses
   * `?purpose=signin` outright — see /api/daily/google/start.
   */
  googleConnectUrl: `${P}/google/start?purpose=connect`,
}

export const billing = {
  plans: () => api.get<{ plans: Plan[]; configured: boolean }>(`${P}/billing/plans`),
  status: () => api.get<BillingStatus>(`${P}/billing/status`),
  /** Answers with a Stripe-hosted URL. Navigate to it; do not try to render it. */
  checkout: (plan: 'monthly' | 'annual') =>
    api.post<{ ok: true; url: string }>(`${P}/billing/checkout`, { plan }),
  portal: () => api.post<{ ok: true; url: string }>(`${P}/billing/portal`),
  /** The repair path after checkout: Stripe's webhook usually lands first, but
   *  when it doesn't, this pulls the subscription directly so a customer who
   *  has just paid never sees a paywall. */
  sync: () => api.post<BillingStatus>(`${P}/billing/sync`),
}

export const household = {
  get: () => api.get<HouseholdPayload>(`${P}/household`),
  rename: (name: string) => api.post<{ ok: true }>(`${P}/household`, { action: 'rename', name }),
  invite: (email: string) =>
    api.post<{ ok: true; sent: boolean; email: string }>(`${P}/household`, { action: 'invite', email }),
  revokeInvite: (email: string) =>
    api.post<{ ok: true }>(`${P}/household`, { action: 'revokeInvite', email }),
  removeMember: (userId: number) =>
    api.post<{ ok: true }>(`${P}/household`, { action: 'removeMember', userId }),
  peekInvite: (token: string) =>
    api.get<{ ok: boolean; householdName?: string | null; inviterName?: string | null; email?: string | null; error?: string }>(
      `${P}/household/invite?token=${encodeURIComponent(token)}`),
  join: (b: { token: string; password: string; displayName?: string }) =>
    api.post<{ ok: true; user: User }>(`${P}/household/join`, b),
}

export type AdminOverview = {
  totals: { accounts: number; households: number; new_this_week: number; active_this_week: number }
  byStatus: { status: SubStatus; n: number }[]
  recent: {
    id: number
    email: string
    displayName: string
    createdAt: string
    lastLoginAt: string | null
    verified: boolean
    subStatus: SubStatus
    plan: string | null
    currentPeriodEnd: string | null
  }[]
}

/** Read-only, and 404s for anybody who isn't the site owner. */
export const admin = {
  overview: () => api.get<AdminOverview>(`${P}/admin/overview`),
}

export const tasks = {
  list: (scope: 'open' | 'done' | 'all' = 'open') =>
    api.get<{ tasks: Task[] }>(`${P}/tasks?scope=${scope}`),
  create: (t: NewTask) => api.post<{ task: Task }>(`${P}/tasks`, { action: 'create', ...t }),
  update: (id: number, patch: TaskPatch) =>
    api.post<{ task: Task }>(`${P}/tasks`, { action: 'update', id, ...patch }),
  toggleDone: (id: number) => api.post<{ task: Task }>(`${P}/tasks`, { action: 'toggleDone', id }),
  toggleStar: (id: number) => api.post<{ task: Task }>(`${P}/tasks`, { action: 'toggleStar', id }),
  toggleUrgent: (id: number) => api.post<{ task: Task }>(`${P}/tasks`, { action: 'toggleUrgent', id }),
  touch: (id: number) => api.post<{ task: Task }>(`${P}/tasks`, { action: 'touch', id }),
  remove: (id: number) => api.post<{ ok: true }>(`${P}/tasks`, { action: 'delete', id }),
}

export const notes = {
  list: () => api.get<{ notes: Note[] }>(`${P}/notes`),
  create: (body: string, kind: Note['kind'] = 'note') =>
    api.post<{ note: Note }>(`${P}/notes`, { action: 'create', body, kind }),
  remove: (id: number) => api.post<{ ok: true }>(`${P}/notes`, { action: 'delete', id }),
}

export const today = {
  get: () => api.get<TodayPayload>(`${P}/today`),
}

export const calendar = {
  status: () => api.get<CalendarStatus>(`${P}/calendar/status`),
  events: (q: { date?: string; from?: string; to?: string } = {}) => {
    const s = new URLSearchParams()
    if (q.date) s.set('date', q.date)
    if (q.from) s.set('from', q.from)
    if (q.to) s.set('to', q.to)
    const qs = s.toString()
    return api.get<CalendarDay>(`${P}/calendar/events${qs ? `?${qs}` : ''}`)
  },
  list: () => api.get<{ calendars: GoogleCalendar[]; selected: string[] | null; shareWithHousehold?: boolean; error?: string }>(
    `${P}/calendar/calendars`),
  select: (b: { calendarIds?: string[]; shareWithHousehold?: boolean }) =>
    api.post<{ ok: true }>(`${P}/calendar/select`, b),
  disconnect: () => api.post<{ ok: true }>(`${P}/calendar/disconnect`),
  createEvent: (e: {
    calendarId: string; title: string; start: string; end?: string
    allDay?: boolean; description?: string; location?: string
  }) => api.post<{ ok: true; event: CalendarEvent }>(`${P}/calendar/event`, { action: 'create', ...e }),
  deleteEvent: (calendarId: string, eventId: string) =>
    api.post<{ ok: true }>(`${P}/calendar/event`, { action: 'delete', calendarId, eventId }),
  connectUrl: auth.googleConnectUrl,
}

export const markets = {
  week: () => api.get<MarketsWeek>(`${P}/markets/week`),
}

export const money = {
  month: (month?: string) =>
    api.get<BudgetMonth>(`${P}/budget${month ? `?month=${month}` : ''}`),
  accounts: (openOnly = false) =>
    api.get<{ accounts: Account[] }>(`${P}/budget/accounts${openOnly ? '?open=1' : ''}`),
  createAccount: (a: { name: string; kind?: AccountKind }) =>
    api.post<{ ok: true; account: Account }>(`${P}/budget/accounts`, { action: 'create', ...a }),
  updateAccount: (id: number, patch: Partial<Pick<Account, 'name' | 'kind' | 'sortOrder' | 'archived'>>) =>
    api.post<{ ok: true; account: Account }>(`${P}/budget/accounts`, { action: 'update', id, ...patch }),
  archiveAccount: (id: number) =>
    api.post<{ ok: true; account: Account }>(`${P}/budget/accounts`, { action: 'archive', id }),

  addRow: (r: { accountId: number; date: string; label: string; amount: number; kind: 'income' | 'expense'; categoryId?: number | null }) =>
    api.post<{ ok: true }>(`${P}/budget`, { action: 'addRow', ...r }),
  updateRow: (id: number, patch: { date?: string; label?: string; accountId?: number; amount?: number }) =>
    api.post<{ ok: true }>(`${P}/budget`, { action: 'updateRow', id, ...patch }),
  deleteRow: (id: number) => api.post<{ ok: true }>(`${P}/budget`, { action: 'deleteRow', id }),
  setRowCategory: (id: number, categoryId: number | null) =>
    api.post<{ ok: true }>(`${P}/budget`, { action: 'setRowCategory', id, categoryId }),
  /** Materialises a projected occurrence into a real row. Idempotent server-side
   *  — a double tap on a slow connection cannot pay the same bill twice. */
  markPaid: (b: BudgetBill) =>
    api.post<{ ok: true; already?: boolean }>(`${P}/budget`, {
      action: 'markBillPaid', ruleId: b.ruleId, date: b.date,
      label: b.label, accountId: b.accountId, amount: b.amount,
    }),
  setBalance: (b: { accountId: number; day: string; balance: number }) =>
    api.post<{ ok: true }>(`${P}/budget`, { action: 'setBalance', ...b }),

  rules: () => api.get<{ rules: RecurringRule[] }>(`${P}/budget/rules`),
  createRule: (r: Omit<RecurringRule, 'id' | 'active'> & { active?: boolean }) =>
    api.post<{ ok: true; rule: RecurringRule }>(`${P}/budget/rules`, { action: 'create', ...r }),
  updateRule: (id: number, patch: Partial<RecurringRule>) =>
    api.post<{ ok: true; rule: RecurringRule }>(`${P}/budget/rules`, { action: 'update', id, ...patch }),
  deleteRule: (id: number) => api.post<{ ok: true }>(`${P}/budget/rules`, { action: 'delete', id }),

  categories: () => api.get<{ categories: BudgetCategory[] }>(`${P}/budget/categories`),
  createCategory: (c: { name: string; kind?: 'income' | 'expense'; color?: string | null }) =>
    api.post<{ ok: true; category: BudgetCategory }>(`${P}/budget/categories`, { action: 'create', ...c }),
  deleteCategory: (id: number) => api.post<{ ok: true }>(`${P}/budget/categories`, { action: 'delete', id }),
}

export const routines = {
  get: (date?: string) => api.get<RoutinesPayload>(`${P}/routines${date ? `?date=${date}` : ''}`),
  create: (r: { title: string; block: RoutineBlock }) =>
    api.post<{ routine: Routine }>(`${P}/routines`, { action: 'create', ...r }),
  toggle: (id: number, date?: string) =>
    api.post<{ done: boolean; day: string }>(`${P}/routines`, { action: 'toggle', id, date }),
  update: (id: number, patch: { title?: string; block?: RoutineBlock }) =>
    api.post<{ routine: Routine }>(`${P}/routines`, { action: 'update', id, ...patch }),
  archive: (id: number) => api.post<{ ok: true }>(`${P}/routines`, { action: 'archive', id }),
  remove: (id: number) => api.post<{ ok: true }>(`${P}/routines`, { action: 'delete', id }),
}

export const projects = {
  list: (archived = false) =>
    api.get<{ projects: Project[] }>(`${P}/projects${archived ? '?archived=1' : ''}`),
  get: (id: number) => api.get<{ project: ProjectDetail }>(`${P}/projects?id=${id}`),
  create: (p: { name: string; description?: string; targetDate?: string | null }) =>
    api.post<{ project: Project }>(`${P}/projects`, { action: 'create', ...p }),
  update: (id: number, patch: Partial<{ name: string; description: string; status: ProjectStatus; targetDate: string | null }>) =>
    api.post<{ project: Project }>(`${P}/projects`, { action: 'update', id, ...patch }),
  archive: (id: number, archived = true) =>
    api.post<{ ok: true }>(`${P}/projects`, { action: 'archive', id, archived }),
  remove: (id: number) => api.post<{ ok: true }>(`${P}/projects`, { action: 'delete', id }),
  addMilestone: (id: number, title: string) =>
    api.post<{ milestone: Milestone }>(`${P}/projects`, { action: 'addMilestone', id, title }),
  toggleMilestone: (milestoneId: number) =>
    api.post<{ milestone: Milestone }>(`${P}/projects`, { action: 'toggleMilestone', milestoneId }),
  deleteMilestone: (milestoneId: number) =>
    api.post<{ ok: true }>(`${P}/projects`, { action: 'deleteMilestone', milestoneId }),
  logTime: (id: number, minutes: number, note?: string, day?: string) =>
    api.post<{ entry: TimeEntry }>(`${P}/projects`, { action: 'logTime', id, minutes, note, day }),
  deleteTime: (entryId: number) =>
    api.post<{ ok: true }>(`${P}/projects`, { action: 'deleteTime', entryId }),
}

export const lists = {
  week: (week?: string) => api.get<ListsPayload>(`${P}/lists${week ? `?week=${week}` : ''}`),
  addItem: (i: { text: string; qty?: string; aisle?: Aisle; mealId?: number }) =>
    api.post<{ item: ListItem }>(`${P}/lists`, { action: 'addItem', ...i }),
  toggleItem: (id: number) => api.post<{ item: ListItem }>(`${P}/lists`, { action: 'toggleItem', id }),
  updateItem: (id: number, patch: { text?: string; qty?: string; aisle?: Aisle }) =>
    api.post<{ item: ListItem }>(`${P}/lists`, { action: 'updateItem', id, ...patch }),
  deleteItem: (id: number) => api.post<{ ok: true }>(`${P}/lists`, { action: 'deleteItem', id }),
  clearChecked: () => api.post<{ removed: number }>(`${P}/lists`, { action: 'clearChecked' }),
  addMeal: (m: { day: string; title: string; notes?: string }) =>
    api.post<{ meal: Meal }>(`${P}/lists`, { action: 'addMeal', ...m }),
  updateMeal: (id: number, patch: { title?: string; notes?: string; day?: string }) =>
    api.post<{ meal: Meal }>(`${P}/lists`, { action: 'updateMeal', id, ...patch }),
  deleteMeal: (id: number) => api.post<{ ok: true }>(`${P}/lists`, { action: 'deleteMeal', id }),
}

export const weather = {
  get: (zip: string) => api.get<Weather>(`${P}/weather?zip=${encodeURIComponent(zip)}`),
}

export const settings = {
  get: () => api.get<{ settings: Settings }>(`${P}/settings`),
  save: (s: Partial<Settings>) => api.post<{ settings: Settings }>(`${P}/settings`, s),
}
