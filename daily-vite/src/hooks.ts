import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { today as todayApi, tasks as tasksApi, notes as notesApi, settings as settingsApi,
         calendar as calendarApi, markets as marketsApi, routines as routinesApi,
         projects as projectsApi, lists as listsApi, weather as weatherApi,
         type RoutinesPayload,
         type Task, type TodayPayload, type NewTask, type TaskPatch,
         type ListsPayload, type ListItem } from './api'

/**
 * Data hooks.
 *
 * Every task mutation is OPTIMISTIC: the cache updates the instant you tap, the
 * request goes out behind it, and a failure rolls the cache back and surfaces
 * the error. On a phone over cellular a checkbox that waits 400ms for a round
 * trip feels broken, and you tap it twice.
 *
 * `/api/daily/today` is the single source for the Today screen — one request
 * paints the whole thing. Mutations patch that cached payload in place rather
 * than refetching, so nothing flickers; the invalidate afterwards reconciles
 * with the server quietly.
 *
 * Nothing here filters by owner or visibility. Tenancy is a household-level
 * decision the server has already made by the time a row reaches this file, so
 * every row in every payload belongs on screen by definition.
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

const WEATHER_KEY = (zip: string) => ['weather', zip] as const

/**
 * Current conditions for a ZIP.
 *
 * Disabled — not just empty — when no ZIP is set, so an unconfigured tile makes
 * zero requests. `staleTime` is ten minutes to match the server's cache: any
 * shorter and every remount is a round trip that can only return the same
 * cached body. `retry: false` because the failure modes here (bad ZIP, upstream
 * down) do not improve on a second attempt, and the tile says so instead.
 */
export function useWeather(zip: string | undefined) {
  return useQuery({
    queryKey: WEATHER_KEY(zip ?? ''),
    queryFn: () => weatherApi.get(zip!),
    enabled: !!zip && /^\d{5}$/.test(zip),
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
}

export function useSettings() {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: settingsApi.get })
}

// ── Markets ──────────────────────────────────────────────────────────────────

/**
 * The week's economic and earnings calendars.
 *
 * `staleTime` ten minutes and `retry: 1` are not tuning, they are a rule. This
 * feed is cached hard server-side, so a retry storm cannot produce fresher data
 * — it can only hammer the upstream CDN, which is exactly how the trading
 * dashboard got itself rate-limited once already (there is a long note about
 * that incident in the backend). One retry covers a dropped connection;
 * anything beyond that is the client attacking its own data source.
 */
export function useMarkets() {
  return useQuery({
    queryKey: ['markets', 'week'],
    queryFn: marketsApi.week,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  })
}

// ── Calendar ─────────────────────────────────────────────────────────────────

/**
 * Calendar events — a SEPARATE query from useToday() on purpose.
 *
 * The events come from Google, which can take half a second or be down
 * entirely. Folding them into /api/daily/today would hold the whole screen
 * hostage to a third party; this way Today paints from our own database
 * immediately and the calendar card fills in on its own.
 *
 * `enabled` keeps it from firing at all until Today confirms the account is
 * actually connected. The query takes the endpoint's own `{date}` or
 * `{from,to}` shape so one hook serves both today's list and the upcoming
 * range, keyed distinctly so they cannot overwrite one another.
 */
export function useCalendarEvents(
  connected: boolean,
  q: { date?: string; from?: string; to?: string } = {},
) {
  const key = q.date ?? (q.from || q.to ? `${q.from ?? ''}..${q.to ?? ''}` : 'today')
  return useQuery({
    queryKey: ['calendar', key],
    queryFn: () => calendarApi.events(q),
    enabled: connected,
    // The server already caches 60s per user; matching it here stops a
    // foreground/background cycle from re-requesting on every glance.
    staleTime: 60_000,
    retry: 0,
  })
}

/** Every calendar the connected Google account can see. Only fetched when there
 *  IS a connection — there is nothing to configure otherwise. */
export function useCalendarList(connected: boolean) {
  return useQuery({
    queryKey: ['calendar-list'],
    queryFn: calendarApi.list,
    enabled: connected,
    staleTime: 5 * 60_000,
  })
}

export function useSaveCalendarSelection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: calendarApi.select,
    onSuccess: () => {
      // The save answers `{ok:true}`, not the new list, so the list is
      // invalidated rather than written from the response — writing an `ok`
      // into the list cache would blank the picker mid-tap.
      void qc.invalidateQueries({ queryKey: ['calendar-list'] })
      // Which calendars are read changes what everyone in the household sees,
      // so everything calendar-shaped goes, not just this day.
      void qc.invalidateQueries({ queryKey: ['calendar'] })
      void qc.invalidateQueries({ queryKey: TODAY_KEY })
    },
  })
}

/**
 * Add an event to Google.
 *
 * Deliberately NOT optimistic. Everything else in this file paints first and
 * reconciles after, because the row is ours and a rollback is invisible. This
 * row is Google's: it can be refused for reasons we cannot predict from here
 * (the calendar turned read-only, the token lost its write scope), and an event
 * that appears on the card and then silently vanishes is worse than one that
 * takes a second to show up. The card waits, then says what happened.
 */
export function useCreateCalendarEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: calendarApi.createEvent,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['calendar'] })
      void qc.invalidateQueries({ queryKey: TODAY_KEY })
    },
  })
}

export function useDisconnectCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: calendarApi.disconnect,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['calendar'] })
      void qc.invalidateQueries({ queryKey: ['calendar-list'] })
      void qc.invalidateQueries({ queryKey: TODAY_KEY })
    },
  })
}

// ── Lists ────────────────────────────────────────────────────────────────────

export function useLists(week?: string) {
  return useQuery({ queryKey: ['lists', week ?? 'this'], queryFn: () => listsApi.week(week) })
}

/**
 * Ticking an item is optimistic and moves it between sections immediately.
 *
 * This is the one interaction that happens standing in a shop on bad signal,
 * one-handed, holding something. A checkbox that waits for a round trip gets
 * tapped twice, and the second tap un-ticks it.
 */
export function useToggleListItem(week?: string) {
  const qc = useQueryClient()
  const key = ['lists', week ?? 'this'] as const
  return useMutation({
    mutationFn: (id: number) => listsApi.toggleItem(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<ListsPayload>(key)
      qc.setQueryData<ListsPayload>(key, (old) => {
        if (!old) return old
        const now = new Date().toISOString()
        const all = [...old.aisles.flatMap((a) => a.items), ...old.checked]
        const target = all.find((i) => i.id === id)
        if (!target) return old
        const nowChecked = !target.checked_at
        const flip = (i: ListItem) => (i.id === id ? { ...i, checked_at: nowChecked ? now : null } : i)

        const aisles = old.aisles
          .map((a) => ({ ...a, items: a.items.filter((i) => i.id !== id) }))
          .filter((a) => a.items.length > 0)
        const checked = old.checked.filter((i) => i.id !== id)
        if (nowChecked) {
          checked.unshift({ ...target, checked_at: now })
        } else {
          const back = { ...target, checked_at: null }
          const g = aisles.find((a) => a.aisle === back.aisle)
          if (g) g.items.push(back)
          else aisles.push({ aisle: back.aisle, items: [back] })
        }
        return {
          ...old,
          aisles,
          checked,
          // The week board holds the SAME rows, so it has to move with them or
          // Tuesday keeps claiming an ingredient you just put in the cart.
          days: old.days.map((d) => {
            const meals = d.meals.map((m) => ({ ...m, items: m.items.map(flip) }))
            return { ...d, meals, openCount: meals.reduce((n, m) => n + m.items.filter((i) => !i.checked_at).length, 0) }
          }),
          counts: {
            ...old.counts,
            open: Math.max(0, old.counts.open + (nowChecked ? -1 : 1)),
            checked: Math.max(0, old.counts.checked + (nowChecked ? 1 : -1)),
          },
        }
      })
      return prev
    },
    onError: (_e, _id, prev) => { if (prev) qc.setQueryData(key, prev) },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['lists'] })
      void qc.invalidateQueries({ queryKey: TODAY_KEY })
    },
  })
}

function useListMutation<T>(fn: (a: T) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lists'] })
      void qc.invalidateQueries({ queryKey: TODAY_KEY })
    },
  })
}

export const useAddListItem = () => useListMutation(listsApi.addItem)
export const useDeleteListItem = () => useListMutation(listsApi.deleteItem)
export const useClearChecked = () => useListMutation(listsApi.clearChecked)
export const useAddMeal = () => useListMutation(listsApi.addMeal)
export const useDeleteMeal = () => useListMutation(listsApi.deleteMeal)

// ── Projects ─────────────────────────────────────────────────────────────────

export function useProjects(archived = false) {
  return useQuery({ queryKey: ['projects', archived], queryFn: () => projectsApi.list(archived) })
}

export function useProject(id: number | null) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id as number),
    enabled: !!id,
  })
}

/** Any project write refreshes both the list and the open detail — progress
 *  and totals appear in both, and a stale bar is the thing you'd notice. */
function useProjectMutation<T>(fn: (a: T) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
      void qc.invalidateQueries({ queryKey: ['project'] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: TODAY_KEY })
    },
  })
}

export const useCreateProject = () => useProjectMutation(projectsApi.create)
export const useArchiveProject = () =>
  useProjectMutation((a: { id: number; archived?: boolean }) => projectsApi.archive(a.id, a.archived))
export const useUpdateProject = () =>
  useProjectMutation((a: { id: number; patch: Parameters<typeof projectsApi.update>[1] }) =>
    projectsApi.update(a.id, a.patch))
export const useAddMilestone = () =>
  useProjectMutation((a: { id: number; title: string }) => projectsApi.addMilestone(a.id, a.title))
export const useToggleMilestone = () => useProjectMutation(projectsApi.toggleMilestone)
export const useDeleteMilestone = () => useProjectMutation(projectsApi.deleteMilestone)
export const useLogTime = () =>
  useProjectMutation((a: { id: number; minutes: number; note?: string }) =>
    projectsApi.logTime(a.id, a.minutes, a.note))
export const useDeleteTime = () => useProjectMutation(projectsApi.deleteTime)

// ── Routines ─────────────────────────────────────────────────────────────────

const ROUTINES_KEY = (date?: string) => ['routines', date ?? 'today'] as const

export function useRoutines(date?: string) {
  return useQuery({ queryKey: ROUTINES_KEY(date), queryFn: () => routinesApi.get(date) })
}

/**
 * Ticking is optimistic — including the streak.
 *
 * A habit tracker that pauses before the checkbox fills is the one interaction
 * you do half-asleep at 6am, and hesitation there is what makes people stop.
 * The streak is bumped locally too: seeing it go up is the entire point of the
 * gesture, and a number that lags a second reads as "it didn't count".
 */
export function useToggleRoutine(date?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => routinesApi.toggle(id, date),
    onMutate: async (id) => {
      const key = ROUTINES_KEY(date)
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<RoutinesPayload>(key)
      qc.setQueryData<RoutinesPayload>(key, (old) => {
        if (!old) return old
        let delta = 0
        const blocks = old.blocks.map((b) => {
          const items = b.items.map((it) => {
            if (it.id !== id) return it
            const done = !it.done
            delta += done ? 1 : -1
            return { ...it, done, streak: Math.max(0, it.streak + (done ? 1 : -1)) }
          })
          return { ...b, items, done: items.filter((i) => i.done).length }
        })
        return { ...old, blocks, doneToday: Math.max(0, old.doneToday + delta) }
      })
      return prev
    },
    onError: (_e, _id, prev) => { if (prev) qc.setQueryData(ROUTINES_KEY(date), prev) },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['routines'] })
      void qc.invalidateQueries({ queryKey: TODAY_KEY })
    },
  })
}

function useRoutineMutation<T>(fn: (a: T) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['routines'] })
      void qc.invalidateQueries({ queryKey: TODAY_KEY })
    },
  })
}

export const useCreateRoutine = () => useRoutineMutation(routinesApi.create)
export const useArchiveRoutine = () => useRoutineMutation(routinesApi.archive)
export const useUpdateRoutine = () =>
  useRoutineMutation((a: { id: number; patch: Parameters<typeof routinesApi.update>[1] }) =>
    routinesApi.update(a.id, a.patch))

// Money has no hooks here on purpose: the Money screen owns its own queries,
// down to which month it is looking at, and a shared hook would have had to
// carry that state for it. Today reads the money strip off the /today payload
// like everything else on that screen.

// ── Optimistic plumbing ──────────────────────────────────────────────────────

/**
 * Apply `fn` to every task in the cached Today payload, across all its lists,
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

/** Urgent flips instantly and re-sorts on the refetch — urgent is a server-side
 *  ordering decision, so guessing at the new position locally makes rows jump. */
export function useToggleUrgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => tasksApi.toggleUrgent(id),
    onMutate: async (id) => {
      const snap = await snapshot(qc)
      patchToday(qc, (t) => (t.id === id ? { ...t, urgent: !t.urgent } : t))
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
      // Settings decide what Today renders — the weather ZIP, the markets
      // toggles, the card order — so the screen has to be re-read, not just
      // the settings themselves.
      void qc.invalidateQueries({ queryKey: TODAY_KEY })
    },
  })
}

export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({
    // `kind` is optional and defaults to 'note', so the saved-notes box in More
    // is unchanged. Today's journal capture and the Journal screen both pass
    // 'journal' — the column has always accepted it.
    mutationFn: ({ body, kind }: { body: string; kind?: 'note' | 'quote' | 'journal' }) =>
      notesApi.create(body, kind),
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
