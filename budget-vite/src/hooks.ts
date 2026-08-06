import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { today as todayApi, tasks as tasksApi, notes as notesApi, settings as settingsApi,
         calendar as calendarApi,
         type Task, type TodayPayload, type NewTask, type TaskPatch } from './api'

/**
 * Data hooks.
 *
 * Every task mutation is OPTIMISTIC: the cache updates the instant you tap, the
 * request goes out behind it, and a failure rolls the cache back and surfaces
 * the error. On a phone over cellular a checkbox that waits 400ms for a round
 * trip feels broken, and you tap it twice.
 *
 * `/api/hh/today` is the single source for the Today screen — one request paints
 * the whole thing. Mutations patch that cached payload in place rather than
 * refetching, so nothing flickers; the invalidate afterwards reconciles with the
 * server quietly.
 */

const TODAY_KEY = ['today'] as const
const TASKS_KEY = (scope: string) => ['tasks', scope] as const
const SETTINGS_KEY = ['settings'] as const
const NOTES_KEY = ['notes'] as const

export function useToday() {
  return useQuery({ queryKey: TODAY_KEY, queryFn: todayApi.get })
}

export function useTasks(scope: 'open' | 'done' | 'all' = 'open') {
  return useQuery({ queryKey: TASKS_KEY(scope), queryFn: () => tasksApi.list(scope) })
}

export function useNotes() {
  return useQuery({ queryKey: NOTES_KEY, queryFn: notesApi.list })
}

export function useSettings() {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: settingsApi.get })
}

/**
 * Today's calendar events — a SEPARATE query from useToday() on purpose.
 *
 * The events come from Google, which can take half a second or be down
 * entirely. Folding them into /api/hh/today would hold the whole screen
 * hostage to a third party; this way Today paints from our own database
 * immediately and the calendar card fills in on its own.
 *
 * `enabled` keeps it from firing at all until Today confirms the account is
 * actually connected.
 */
export function useCalendarEvents(connected: boolean, date?: string) {
  return useQuery({
    queryKey: ['calendar', date ?? 'today'],
    queryFn: () => calendarApi.events(date),
    enabled: connected,
    // The server already caches 60s per user; matching it here stops a
    // foreground/background cycle from re-requesting on every glance.
    staleTime: 60_000,
    retry: 0,
  })
}

export function useDisconnectCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: calendarApi.disconnect,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['calendar'] })
      void qc.invalidateQueries({ queryKey: TODAY_KEY })
    },
  })
}

// ── Optimistic plumbing ──────────────────────────────────────────────────────

/**
 * Apply `fn` to every task in the cached Today payload, across all four lists,
 * and drop any the function returns null for.
 *
 * Kept as one helper because Today holds the same task in more than one array
 * (a starred, overdue, stale task is in top3 AND open AND possibly slipping).
 * Patching one array and not the others is how a checkbox ends up ticked in the
 * top section and unticked twenty pixels below it.
 */
function patchToday(qc: QueryClient, fn: (t: Task) => Task | null) {
  qc.setQueryData<TodayPayload>(TODAY_KEY, (old) => {
    if (!old) return old
    const map = (arr: Task[]) => arr.map(fn).filter((t): t is Task => t !== null)
    return { ...old, top3: map(old.top3), open: map(old.open), slipping: map(old.slipping) }
  })
  qc.setQueryData<{ tasks: Task[] }>(TASKS_KEY('open'), (old) =>
    old ? { tasks: old.tasks.map(fn).filter((t): t is Task => t !== null) } : old)
}

/** Snapshot every cache this mutation could touch, for rollback. */
async function snapshot(qc: QueryClient) {
  await qc.cancelQueries({ queryKey: TODAY_KEY })
  await qc.cancelQueries({ queryKey: ['tasks'] })
  return {
    today: qc.getQueryData<TodayPayload>(TODAY_KEY),
    open: qc.getQueryData<{ tasks: Task[] }>(TASKS_KEY('open')),
  }
}

function restore(qc: QueryClient, snap: Awaited<ReturnType<typeof snapshot>>) {
  if (snap.today) qc.setQueryData(TODAY_KEY, snap.today)
  if (snap.open) qc.setQueryData(TASKS_KEY('open'), snap.open)
}

const settleAll = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: TODAY_KEY })
  void qc.invalidateQueries({ queryKey: ['tasks'] })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useToggleDone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => tasksApi.toggleDone(id),
    onMutate: async (id) => {
      const snap = await snapshot(qc)
      // Completing removes it from every open list immediately. The counts move
      // with it, or the header would disagree with the list under it.
      patchToday(qc, (t) => (t.id === id ? null : t))
      qc.setQueryData<TodayPayload>(TODAY_KEY, (old) =>
        old ? { ...old, counts: { ...old.counts,
          open: Math.max(0, old.counts.open - 1),
          done_today: old.counts.done_today + 1 } } : old)
      return snap
    },
    onError: (_e, _id, snap) => { if (snap) restore(qc, snap) },
    onSettled: () => settleAll(qc),
  })
}

export function useToggleStar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => tasksApi.toggleStar(id),
    onMutate: async (id) => {
      const snap = await snapshot(qc)
      patchToday(qc, (t) => (t.id === id ? { ...t, starred: !t.starred } : t))
      // top3 membership is a server-side decision (starred + ordered + capped at
      // 3), so it is deliberately NOT recomputed here — the star fills in
      // instantly and the section settles on the refetch. Guessing at it locally
      // makes items jump between sections and then jump back.
      return snap
    },
    onError: (_e, _id, snap) => { if (snap) restore(qc, snap) },
    onSettled: () => settleAll(qc),
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: TaskPatch }) => tasksApi.update(id, patch),
    onMutate: async ({ id, patch }) => {
      const snap = await snapshot(qc)
      patchToday(qc, (t) => (t.id === id ? {
        ...t,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes ?? null } : {}),
        ...(patch.dueDate !== undefined ? { due_date: patch.dueDate ?? null } : {}),
        ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
        touched_at: new Date().toISOString(),
      } : t))
      return snap
    },
    onError: (_e, _v, snap) => { if (snap) restore(qc, snap) },
    onSettled: () => settleAll(qc),
  })
}

export function useTouchTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => tasksApi.touch(id),
    onMutate: async (id) => {
      const snap = await snapshot(qc)
      // "I've seen it" — it leaves Slipping right away but stays in the open list.
      qc.setQueryData<TodayPayload>(TODAY_KEY, (old) =>
        old ? { ...old, slipping: old.slipping.filter((t) => t.id !== id) } : old)
      return snap
    },
    onError: (_e, _id, snap) => { if (snap) restore(qc, snap) },
    onSettled: () => settleAll(qc),
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => tasksApi.remove(id),
    onMutate: async (id) => {
      const snap = await snapshot(qc)
      patchToday(qc, (t) => (t.id === id ? null : t))
      return snap
    },
    onError: (_e, _id, snap) => { if (snap) restore(qc, snap) },
    onSettled: () => settleAll(qc),
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (t: NewTask) => tasksApi.create(t),
    // No optimistic insert: the row needs a real server id before it can be
    // tapped, and a placeholder that rejects taps for 300ms is worse than the
    // list appearing a beat later. The input clears immediately either way.
    onSuccess: () => settleAll(qc),
  })
}

export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: settingsApi.save,
    onSuccess: (data) => {
      qc.setQueryData(SETTINGS_KEY, data)
      void qc.invalidateQueries({ queryKey: TODAY_KEY }) // slippingDays changes the list
    },
  })
}

export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ body, visibility }: { body: string; visibility?: 'private' | 'shared' }) =>
      notesApi.create(body, visibility),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NOTES_KEY })
      void qc.invalidateQueries({ queryKey: TODAY_KEY })
    },
  })
}

export function useDeleteNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => notesApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NOTES_KEY })
      void qc.invalidateQueries({ queryKey: TODAY_KEY })
    },
  })
}
