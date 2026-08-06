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

export type CalendarStatus = { configured: boolean; connected: boolean; email?: string | null }

export type CalendarEvent = {
  id: string
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
  /** 'not-configured' | 'not-connected' | 'revoked' | 'google-<status>' | other.
   *  Always a 200 — the card renders its own state from this. */
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
  money: null | { balances: Record<string, number>; nextBills: Array<{ label: string; amount: number; date: string }> }
}

export type Settings = { slippingDays: number }

export type NewTask = {
  title: string
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
  disconnect: () => api.post<{ ok: true }>('/api/hh/calendar/disconnect'),
  /** A full page navigation, NOT a fetch — the browser has to follow the
   *  redirect to Google's consent screen. */
  connectUrl: '/api/hh/calendar/connect',
}

export const settings = {
  get: () => api.get<{ settings: Settings }>('/api/hh/settings'),
  save: (s: Partial<Settings>) => api.post<{ settings: Settings }>('/api/hh/settings', s),
}
