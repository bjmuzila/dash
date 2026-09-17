import { useCallback, useEffect, useRef, useState } from 'react'
import { loadProbeBars, type Bar, type ProbeKey } from '@/board/topFlow/ContractProbe'
import type { TopFlowRow } from '@/board/topFlow/TopFlowCard'

// ─────────────────────────────────────────────────────────────────────────────
// TRACKED CONTRACTS — the client half.
//
// A tracked contract is a CONTRACT you flagged, not a notification. Nothing
// fires, nothing emails: the row sits in the card at the bottom of /whales with
// your note on it, and opening it draws the same probe the table draws. That is
// the whole promise, and it is worth being exact about because "alert" reads
// like a trigger and this deliberately is not one.
//
// ── WHY THE SERVER AND NOT localStorage ──────────────────────────────────────
// Every other remembered thing on this page — the filters, the sort — is per
// browser, and that is right for a question you re-ask each morning. A flagged
// contract is not that. You flag it on the desktop at 9:44 and you want it on
// the laptop at lunch, so it is a row in Postgres keyed on the login and
// nothing else.
//
// ── MARKS ARE LAZY, AND THEY SAY SO ──────────────────────────────────────────
// There is no bulk "mark for these twenty contracts" route, and inventing one
// means a second thing that can disagree with the probe. So the card asks the
// SAME route the probe asks, once per tracked contract, four at a time, and the
// marks fill in as they land. A row with no mark yet prints a dash rather than
// a zero — see the fetchMarks note below.
//
// ── EXPIRY REMOVES THE ROW ───────────────────────────────────────────────────
// Past its expiry a tracked contract is not a position, a watch or a question;
// it is a dead symbol whose bars the vault will drop anyway. The SERVER deletes
// them on read (see /api/whale-alerts), so the list is self-cleaning and no
// client is responsible for remembering to prune.
// ─────────────────────────────────────────────────────────────────────────────

const ENDPOINT = '/api/whale-alerts'

/** What the probe froze the moment the contract was tracked. */
export interface AlertSnapshot {
  bars: Bar[]
  /** Epoch ms the freeze was taken. */
  at: number
  /** Which window it was frozen at, so the pane can label itself honestly. */
  range: string
}

export interface WhaleAlert {
  id: number
  underlying: string
  strike: number
  optType: 'C' | 'P'
  /** YYYY-MM-DD. */
  expiry: string
  osi: string | null
  source: 'whale' | 'lookup'
  /** Epoch ms of the print this was tracked from, or null for a lookup. */
  printTs: number | null
  printSize: number | null
  printPremium: number | null
  /** The fill, or a typed cost basis. Null means "a watch, with no cost". */
  entryPrice: number | null
  note: string
  snapshot: AlertSnapshot | null
  createdAt: number
}

/** The four fields that make a contract, plus the two that make it a position. */
export interface TrackInput {
  underlying: string
  strike: number
  optType: 'C' | 'P'
  expiry: string
  osi?: string | null
  source: 'whale' | 'lookup'
  printTs?: number | null
  printSize?: number | null
  printPremium?: number | null
  entryPrice?: number | null
  note?: string
}

/** A tracked row, dressed as the row ContractProbe draws. */
export function alertToRow(a: WhaleAlert): TopFlowRow {
  return {
    // Keyed on the alert, so editing one never leaves another's bars on screen.
    id: `alert:${a.id}`,
    // The probe measures its 1D/3D/1W/1M windows BACK from this, so a tracked
    // print anchors to the print and a tracked lookup anchors to now. Using the
    // print's own moment is what makes "3D" mean the three days around it.
    ts: a.printTs ?? Date.now(),
    osi: a.osi,
    underlying: a.underlying,
    type: a.optType,
    strike: a.strike,
    expiry: a.expiry,
    dte: null,
    size: a.printSize,
    price: a.entryPrice,
    premium: a.printPremium ?? 0,
    spot: null,
    side: null, action: null, sideReason: null,
    bid: null, ask: null, quoteAgeMs: null, vol: null, oi: null,
  }
}

function keyOf(a: WhaleAlert): ProbeKey {
  return {
    underlying: a.underlying,
    expiry: a.expiry,
    strike: a.strike,
    type: a.optType,
    osi: a.osi,
    ts: a.printTs ?? Date.now(),
  }
}

/** Identity for de-duping in the UI — the same four fields the table is unique on. */
export const contractKey = (a: Pick<WhaleAlert, 'underlying' | 'strike' | 'optType' | 'expiry'>) =>
  `${a.underlying}|${a.strike}|${a.optType}|${a.expiry}`

export interface AlertsStore {
  alerts: WhaleAlert[]
  /** Last mark per alert id. Absent = not fetched yet; null = fetched, nothing there. */
  marks: Map<number, number | null>
  loading: boolean
  /** Set when the list itself could not be read. A failed WRITE surfaces on the row. */
  error: string | null
  /** True once a GET has come back — tells "empty list" apart from "not asked yet". */
  ready: boolean
  /** Signed out, or the server has no such route: the card hides itself. */
  unavailable: boolean
  track: (t: TrackInput) => Promise<WhaleAlert | null>
  remove: (id: number) => Promise<void>
  setNote: (id: number, note: string) => Promise<void>
  resnapshot: (id: number) => Promise<void>
  reload: () => void
}

export function useWhaleAlerts(): AlertsStore {
  const [alerts, setAlerts] = useState<WhaleAlert[]>([])
  const [marks, setMarks] = useState<Map<number, number | null>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [nonce, setNonce] = useState(0)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    let on = true
    setLoading(true)
    fetch(ENDPOINT, { credentials: 'same-origin' })
      .then(async (r) => {
        // 401 is "not signed in", 404 is "this server predates the feature".
        // Neither is an error worth a red box on a page that works without the
        // card — both just take the card off the page.
        if (r.status === 401 || r.status === 403 || r.status === 404) {
          if (on) { setUnavailable(true); setReady(true) }
          return null
        }
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return (await r.json()) as { alerts?: WhaleAlert[] }
      })
      .then((j) => {
        if (!on || !j) return
        setAlerts(Array.isArray(j.alerts) ? j.alerts : [])
        setError(null)
        setReady(true)
      })
      .catch((e: Error) => { if (on) { setError(e.message); setReady(true) } })
      .finally(() => { if (on) setLoading(false) })
    return () => { on = false }
  }, [nonce])

  // ── MARKS ─────────────────────────────────────────────────────────────────
  // Four at a time, once per alert, never re-fetched while the page is up. An
  // alert that answers with no bars is recorded as null and not asked again:
  // retrying a contract the vault does not have is a request that will fail the
  // same way every time.
  useEffect(() => {
    const todo = alerts.filter((a) => !marks.has(a.id))
    if (!todo.length) return
    let on = true
    const ctrl = new AbortController()
    let i = 0
    const worker = async () => {
      while (on && i < todo.length) {
        const a = todo[i++]!
        try {
          const bars = await loadProbeBars(keyOf(a), 0, ctrl.signal)
          const last = bars.length ? bars[bars.length - 1]!.close : null
          if (on) setMarks((m) => new Map(m).set(a.id, last))
        } catch {
          if (on) setMarks((m) => new Map(m).set(a.id, null))
        }
      }
    }
    void Promise.all([worker(), worker(), worker(), worker()])
    return () => { on = false; ctrl.abort() }
    // `marks` is deliberately NOT a dependency: every fill would re-run this
    // and the has() filter above already makes each alert a one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts])

  const track = useCallback(async (t: TrackInput): Promise<WhaleAlert | null> => {
    // The freeze is taken BEFORE the POST and sent with it, so the picture
    // stored is the one that was on screen when you pressed the button. Taking
    // it afterwards would be a second round-trip and a different minute.
    let snapshot: AlertSnapshot | null = null
    try {
      const bars = await loadProbeBars(
        { underlying: t.underlying, expiry: t.expiry, strike: t.strike,
          type: t.optType, osi: t.osi ?? null, ts: t.printTs ?? Date.now() },
        2,
      )
      if (bars.length) snapshot = { bars, at: Date.now(), range: '3d' }
    } catch {
      /* a contract with no bars still tracks — the note is the point */
    }
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...t, snapshot }),
      })
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      const j = (await r.json()) as { alert?: WhaleAlert }
      if (!j.alert) return null
      if (alive.current) {
        setAlerts((cur) => {
          const rest = cur.filter((a) => a.id !== j.alert!.id)
          return [j.alert!, ...rest]
        })
        // Re-tracking an existing contract replaces the row, so its old mark is
        // still the right one — dropping it would blank the column for nothing.
      }
      return j.alert
    } catch (e) {
      if (alive.current) setError((e as Error).message)
      return null
    }
  }, [])

  const remove = useCallback(async (id: number) => {
    // Optimistic: the row goes now and comes back if the server refuses. A
    // delete that sits there for 300ms reads as a dead button.
    const before = alerts
    setAlerts((cur) => cur.filter((a) => a.id !== id))
    try {
      const r = await fetch(`${ENDPOINT}/${id}`, { method: 'DELETE', credentials: 'same-origin' })
      if (!r.ok) throw new Error(`${r.status}`)
    } catch {
      if (alive.current) setAlerts(before)
    }
  }, [alerts])

  const patch = useCallback(async (id: number, body: Record<string, unknown>) => {
    try {
      const r = await fetch(`${ENDPOINT}/${id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      const j = (await r.json()) as { alert?: WhaleAlert }
      if (j.alert && alive.current) {
        setAlerts((cur) => cur.map((a) => (a.id === id ? j.alert! : a)))
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message)
    }
  }, [])

  const setNote = useCallback((id: number, note: string) => patch(id, { note }), [patch])

  /** Re-freeze the picture at today's bars — the "this is where it is now" save. */
  const resnapshot = useCallback(async (id: number) => {
    const a = alerts.find((x) => x.id === id)
    if (!a) return
    const bars = await loadProbeBars(keyOf(a), 2)
    if (!bars.length) return
    await patch(id, { snapshot: { bars, at: Date.now(), range: '3d' } })
  }, [alerts, patch])

  return {
    alerts, marks, loading, error, ready, unavailable,
    track, remove, setNote, resnapshot,
    reload: () => setNonce((n) => n + 1),
  }
}
