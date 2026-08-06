/**
 * budget-vite API client.
 *
 * Every request goes to a relative path so the nginx in front of this SPA
 * proxies it to the dashboard container. credentials:'include' is required —
 * the hh_session cookie is HttpOnly and same-site, and without this fetch would
 * omit it and every call would 401.
 */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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

  if (!res.ok) throw new ApiError(res.status, body?.error || `Request failed (${res.status})`);
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
}

export type Visibility = 'private' | 'shared'

export type Task = {
  id: number
  owner_id: number
  visibility: Visibility
  title: string
  notes: string | null
  /** Always 'YYYY-MM-DD' or null — the server casts it to text so no timezone
   *  can shift it a day. Never wrap it in `new Date()` for display. */
  due_date: string | null
  starred: boolean
  project: string | null
  project_id: number | null
  done_at: string | null
  created_at: string
  updated_at: string
  touched_at: string
}

export type Note = {
  id: number
  owner_id: number
  visibility: Visibility
  kind: 'note' | 'quote' | 'journal'
  body: string
  created_at: string
  last_surfaced_at: string | null
}

export type Person = { id: number; displayName: string }

export type CalendarStatus = {
  configured: boolean
  /** True when SOMETHING feeds your calendar — your own link or the shared one. */
  connected: boolean
  /** Where the events come from. 'household' = someone else's shared connection. */
  source?: 'own' | 'household' | null
  /** True only when YOU have linked a Google account. */
  ownConnection?: boolean
  /** Display name of whoever shared it, when source is 'household'. */
  sharedBy?: string | null
  email?: string | null
  shareWithHousehold?: boolean | null
  selectedCalendars?: string[] | null
}

export type GoogleCalendar = {
  id: string
  name: string
  description: string | null
  primary: boolean
  color: string | null
  accessRole: string | null
  selectedInGoogle: boolean
}

export type CalendarListResponse = {
  calendars: GoogleCalendar[]
  /** null = never chosen (falls back to primary). [] = deliberately none. */
  selected: string[] | null
  shareWithHousehold?: boolean
  error?: string
}

export type CalendarEvent = {
  /** Calendar-qualified ('<calendarId>:<eventId>') — the same invite can appear
   *  on two calendars, and a bare event id would collide as a React key. */
  id: string
  calendarId: string
  summary: string
  allDay: boolean
  /** RFC3339 with offset for timed events, 'YYYY-MM-DD' for all-day ones. */
  start: string | null
  end: string | null
  location: string | null
}

export type CalendarDay = {
  date: string
  events: CalendarEvent[]
  source?: 'own' | 'household'
  calendarCount?: number
  /** >0 means some calendars couldn't be reached, so the list may be incomplete. */
  partialFailures?: number
  /** 'not-configured' | 'not-connected' | 'none-selected' | 'revoked' |
   *  'google-<status>' | other. Always a 200 — the card renders its own state. */
  error?: string
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
  calendar: CalendarStatus
  routines: { done: number; total: number; date: string } | null
  money: MoneySummary | null
}

export type Bank = 'coastal' | 'truist' | 'secu'

export type BudgetRow = {
  /** Negative id = a projected recurring bill with no database row behind it.
   *  It cannot be edited or deleted — only marked paid, which materialises it. */
  id: number
  entry_date: string
  label: string
  bank: Bank
  amount: number
  recurring: boolean
  recurring_tag: string | null
  category_id: number | null
  balance: number
  balances: Record<Bank, number>
  total: number
  paid: boolean
  past: boolean
}

export type BudgetBill = {
  tag: string
  label: string
  bank: Bank
  amount: number
  date: string
  overdue: boolean
}

export type BudgetCategory = {
  id: number; name: string; amount: number; period: string
  color: string | null; spent: number
}

export type BudgetMonth = {
  month: string
  today: string
  currency: string
  balances: Record<Bank, number>
  beginning: Record<Bank, number | null> | null
  totals: { income: number; expenses: number; net: number; endingBalance: number }
  rows: BudgetRow[]
  bills: BudgetBill[]
  categories: BudgetCategory[]
  unsortedSpend: number
  recurringCount: number
}

export type MoneySummary = {
  currency: string
  balances: Record<Bank, number>
  total: number
  net: number
  overdue: number
  nextBills: BudgetBill[]
  overdueBills: BudgetBill[]
}

export type RoutineBlock = 'morning' | 'afternoon' | 'evening'

export type Routine = {
  id: number
  ownerId: number
  visibility: Visibility
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
  owner_id: number
  visibility: Visibility
  name: string
  description: string | null
  status: ProjectStatus
  color: string | null
  target_date: string | null
  archived_at: string | null
  milestones: { total: number; done: number }
  tasks: { total: number; open: number }
  minutes: number
  /** null when the project has no milestones — unknown, not zero. */
  progress: number | null
}

export type Milestone = {
  id: number; title: string; sort_order: number
  done_at: string | null; done_by: number | null
}

export type TimeEntry = { id: number; day: string; minutes: number; note: string | null; user_id: number }

export type ProjectDetail = Omit<Project, 'milestones' | 'tasks'> & {
  milestones: Milestone[]
  tasks: Task[]
  timeEntries: TimeEntry[]
  minutesThisWeek: number
}

export type Settings = { slippingDays: number }

export type NewTask = {
  title: string
  projectId?: number | null
  notes?: string
  dueDate?: string | null
  starred?: boolean
  visibility?: Visibility
  project?: string
}

export type TaskPatch = Partial<Omit<NewTask, 'title'>> & { title?: string }

// ── Endpoints ────────────────────────────────────────────────────────────────

export const auth = {
  me: () => api.get<{ user: HouseholdUser }>('/api/hh/auth/me'),
  login: (email: string, password: string) =>
    api.post<{ ok: true; user: HouseholdUser }>('/api/hh/auth/login', { email, password }),
  logout: () => api.post<{ ok: true }>('/api/hh/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: true }>('/api/hh/auth/change-password', { currentPassword, newPassword }),
}

export const tasks = {
  list: (scope: 'open' | 'done' | 'all' = 'open') =>
    api.get<{ tasks: Task[] }>(`/api/hh/tasks?scope=${scope}`),
  create: (t: NewTask) => api.post<{ task: Task }>('/api/hh/tasks', { action: 'create', ...t }),
  update: (id: number, patch: TaskPatch) =>
    api.post<{ task: Task }>('/api/hh/tasks', { action: 'update', id, ...patch }),
  toggleDone: (id: number) => api.post<{ task: Task }>('/api/hh/tasks', { action: 'toggleDone', id }),
  toggleStar: (id: number) => api.post<{ task: Task }>('/api/hh/tasks', { action: 'toggleStar', id }),
  touch: (id: number) => api.post<{ task: Task }>('/api/hh/tasks', { action: 'touch', id }),
  remove: (id: number) => api.post<{ ok: true }>('/api/hh/tasks', { action: 'delete', id }),
}

export const notes = {
  list: () => api.get<{ notes: Note[] }>('/api/hh/notes'),
  create: (body: string, visibility: Visibility = 'private', kind: Note['kind'] = 'note') =>
    api.post<{ note: Note }>('/api/hh/notes', { action: 'create', body, visibility, kind }),
  remove: (id: number) => api.post<{ ok: true }>('/api/hh/notes', { action: 'delete', id }),
}

export const today = {
  get: () => api.get<TodayPayload>('/api/hh/today'),
}

export const calendar = {
  status: () => api.get<CalendarStatus>('/api/hh/calendar/status'),
  events: (date?: string) =>
    api.get<CalendarDay>(`/api/hh/calendar/events${date ? `?date=${date}` : ''}`),
  list: () => api.get<CalendarListResponse>('/api/hh/calendar/calendars'),
  select: (body: { calendarIds?: string[]; shareWithHousehold?: boolean }) =>
    api.post<CalendarListResponse>('/api/hh/calendar/select', body),
  disconnect: () => api.post<{ ok: true }>('/api/hh/calendar/disconnect'),
  /** A full page navigation, NOT a fetch — the browser has to follow the
   *  redirect to Google's consent screen. */
  connectUrl: '/api/hh/calendar/connect',
}

export const projects = {
  list: (archived = false) =>
    api.get<{ projects: Project[] }>(`/api/hh/projects${archived ? '?archived=1' : ''}`),
  get: (id: number) => api.get<{ project: ProjectDetail }>(`/api/hh/projects?id=${id}`),
  create: (p: { name: string; description?: string; visibility?: Visibility; targetDate?: string | null }) =>
    api.post<{ project: Project }>('/api/hh/projects', { action: 'create', ...p }),
  update: (id: number, patch: Partial<{ name: string; description: string; visibility: Visibility; status: ProjectStatus; targetDate: string | null }>) =>
    api.post<{ project: Project }>('/api/hh/projects', { action: 'update', id, ...patch }),
  archive: (id: number, archived = true) =>
    api.post<{ ok: true }>('/api/hh/projects', { action: 'archive', id, archived }),
  remove: (id: number) => api.post<{ ok: true }>('/api/hh/projects', { action: 'delete', id }),
  addMilestone: (id: number, title: string) =>
    api.post<{ milestone: Milestone }>('/api/hh/projects', { action: 'addMilestone', id, title }),
  toggleMilestone: (milestoneId: number) =>
    api.post<{ milestone: Milestone }>('/api/hh/projects', { action: 'toggleMilestone', milestoneId }),
  deleteMilestone: (milestoneId: number) =>
    api.post<{ ok: true }>('/api/hh/projects', { action: 'deleteMilestone', milestoneId }),
  logTime: (id: number, minutes: number, note?: string, day?: string) =>
    api.post<{ entry: TimeEntry }>('/api/hh/projects', { action: 'logTime', id, minutes, note, day }),
  deleteTime: (entryId: number) =>
    api.post<{ ok: true }>('/api/hh/projects', { action: 'deleteTime', entryId }),
}

export const routines = {
  get: (date?: string) =>
    api.get<RoutinesPayload>(`/api/hh/routines${date ? `?date=${date}` : ''}`),
  create: (r: { title: string; block: RoutineBlock; visibility?: Visibility }) =>
    api.post<{ routine: Routine }>('/api/hh/routines', { action: 'create', ...r }),
  toggle: (id: number, date?: string) =>
    api.post<{ done: boolean; day: string }>('/api/hh/routines', { action: 'toggle', id, date }),
  update: (id: number, patch: { title?: string; block?: RoutineBlock; visibility?: Visibility }) =>
    api.post<{ routine: Routine }>('/api/hh/routines', { action: 'update', id, ...patch }),
  archive: (id: number) => api.post<{ ok: true }>('/api/hh/routines', { action: 'archive', id }),
  remove: (id: number) => api.post<{ ok: true }>('/api/hh/routines', { action: 'delete', id }),
}

export const budget = {
  month: (month?: string) =>
    api.get<BudgetMonth>(`/api/hh/budget${month ? `?month=${month}` : ''}`),
  addRow: (r: { date: string; label: string; bank: Bank; amount: number; kind: 'pay' | 'income' }) =>
    api.post<{ ok: true }>('/api/hh/budget', { action: 'addRow', ...r }),
  markPaid: (b: BudgetBill) =>
    api.post<{ ok: true; already?: boolean }>('/api/hh/budget', {
      action: 'markBillPaid', tag: b.tag, date: b.date, label: b.label, bank: b.bank, amount: b.amount,
    }),
  updateRow: (id: number, patch: { date?: string; label?: string; bank?: Bank; amount?: number }) =>
    api.post<{ ok: true }>('/api/hh/budget', { action: 'updateRow', id, ...patch }),
  deleteRow: (id: number) => api.post<{ ok: true }>('/api/hh/budget', { action: 'deleteRow', id }),
  setDailyBalance: (b: { day: string; coastal: number; truist: number; secu: number }) =>
    api.post<{ ok: true }>('/api/hh/budget', { action: 'setDailyBalance', ...b }),
}

export const settings = {
  get: () => api.get<{ settings: Settings }>('/api/hh/settings'),
  save: (s: Partial<Settings>) => api.post<{ settings: Settings }>('/api/hh/settings', s),
}
