import type { ReactNode } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Page } from '@/design/primitives/Page'
import { Card } from '@/design/primitives/Card'
import { Table, type Column } from '@/design/primitives/Table'
import { Stat } from '@/design/primitives/Stat'
import { SegGroup, Chip } from '@/design/primitives/Controls'
import { useQuery } from '@/data/api'

// Journal — the trade journal, replacing v2's components/pages/Trading.tsx
// ("Journaling Dashboard") at /app/trading. Entries live in Postgres behind
// /api/journal (day-level rows) and /api/journal/trades (per-trade detail
// derived from imported fills); /api/journal/import turns a broker CSV into
// both. v2 packed five bespoke analytics panes onto one page — a calendar
// heat map, six "leak finder" cards, a time-of-day breakdown and eight
// hand-drawn SVG charts — all built on canvas/SVG machinery this file does
// not bring across. Everything below reproduces the same five panes in the
// same order with the same controls; the four analytics panes render as
// named placeholders (see the TODO on each) while the Journal pane — the
// tables, the CRUD forms and the CSV import flow — is fully wired.

/** Wire shape from GET /api/journal (snake_case, straight off the row). */
interface JournalRow {
  id: number
  date: string // YYYY-MM-DD
  net_pnl: number
  trades: number
  win_rate: number // 0-100
  avg_win: number
  avg_loss: number
  profit_factor: number
  commissions: number
  notes: string | null
  kind: 'manual' | 'verified'
}

/** Wire shape from GET /api/journal/trades — one closed round-trip, derived
 *  live from the fills a CSV import persisted. */
interface JournalTrade {
  symbol: string
  underlying: string
  asset_type: string
  direction: 'long' | 'short'
  open_ts: number
  close_ts: number
  date: string
  qty: number
  entry: number
  exit: number
  fees: number
  pnl: number
  account: string
  open_ext_id: string
  close_ext_id: string
}

interface AccountStat {
  account: string
  sessions: number
  trades: number
  net_pnl: number
  win_rate: number
}

/** Preview payload from POST /api/journal/import with commit:false. Nothing
 *  is written until the user confirms against this preview. */
interface ImportPreview {
  broker: string
  counts: { fills: number; trades: number; days: number }
  days: JournalRow[]
  warnings: string[]
}

const BROKER_LABEL: Record<string, string> = {
  tastytrade: 'tastytrade',
  tos: 'Thinkorswim / Schwab',
  ibkr: 'Interactive Brokers',
  rithmic: 'Rithmic',
  motivewave: 'MotiveWave',
  tradovate: 'Tradovate',
  generic: 'Unrecognized format',
}

// Calendar is FIRST and is v2's landing pane — the month grid answers "how
// did I do?" at a glance, and every other pane is one click away from it.
// Same five panes, same order, same default.
const PANES = [
  { label: 'Calendar', value: 'calendar' },
  { label: 'Leaks', value: 'leaks' },
  { label: 'The clock', value: 'clock' },
  { label: 'Charts', value: 'charts' },
  { label: 'Journal', value: 'journal' },
] as const
type PaneKey = (typeof PANES)[number]['value']

// Day-level only — MAE/MFE are per-trade excursion stats this journal does
// not keep, matching v2's EMPTY_FORM.
const EMPTY_JOURNAL_FORM = {
  date: '',
  netPnl: '',
  trades: '',
  winRate: '',
  avgWin: '',
  avgLoss: '',
  profitFactor: '',
  commissions: '',
  notes: '',
}

const EMPTY_TRADE_FORM = {
  symbol: '',
  account: '',
  direction: 'long' as 'long' | 'short',
  openLocal: '',
  closeLocal: '',
  qty: '',
  entry: '',
  exit: '',
  fees: '',
}

// ── number/text helpers — never leave a raw float on screen ─────────────────
const fmtMoney = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : (v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(2)
const fmtPct = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`
const fmtNum = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2))
const num = (s: string) => (s.trim() === '' ? 0 : Number(s))
const dirOf = (v: number): 'up' | 'down' | 'flat' => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat')

const toLocalInput = (ts: number) => {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
const fromLocalInput = (s: string) => (s ? new Date(s).getTime() : 0)

// A stub for a pane whose v2 implementation is bespoke canvas/SVG machinery
// this file does not reproduce — never fake data, never a silently dropped
// section; name exactly what still needs porting.
function StubPane({ title, note, todo }: { title: string; note: string; todo: string }) {
  return (
    <Card title={title} className="flex-1">
      <p className="text-xs text-faint">{note}</p>
      {/* TODO(v3): port the v2 implementation named below. */}
      <span hidden data-todo={todo} />
    </Card>
  )
}

// A labelled text input, styled from tokens only. Used by both CRUD forms.
function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-sm border border-line bg-surface2 px-2 py-1 text-sm text-fg outline-none focus:border-accent'

// Overlay shared by both CRUD forms and the import preview — a fixed
// backdrop plus a centered Card. No modal primitive exists in v3 yet, but a
// panel this small does not need one; it is plain layout, drawn entirely
// from tokens.
function Overlay({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-app/70 p-4"
      onClick={onClose}
    >
      <div
        className={wide ? 'w-full max-w-3xl' : 'w-full max-w-lg'}
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="max-h-[85vh] overflow-auto">
          {children}
        </Card>
      </div>
    </div>
  )
}

export default function Journal() {
  // ── Reads — both fired in parallel up front, never inside a child that
  //    waits on the other. Day KPIs work even if the trade-level fetch is
  //    still supplementary (no CSV imported yet). ──────────────────────────
  const journalQ = useQuery<{ rows: JournalRow[] }>('/api/journal', { staleMs: 15_000 })
  const tradesQ = useQuery<{ trades: JournalTrade[]; accounts: AccountStat[] }>('/api/journal/trades', {
    staleMs: 15_000,
  })
  const journals = journalQ.data?.rows ?? []
  const trades = tradesQ.data?.trades ?? []
  const accounts = tradesQ.data?.accounts ?? []

  const [pane, setPane] = useState<PaneKey>('calendar')
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const [hideAccounts, setHideAccounts] = useState(false)

  // Journal entry form
  const [showJournalForm, setShowJournalForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [jf, setJf] = useState(EMPTY_JOURNAL_FORM)
  const [jfErr, setJfErr] = useState('')
  const [jfSaving, setJfSaving] = useState(false)

  // Trade edit form — writes an override, never the underlying fills, so it
  // cannot bleed into a sibling trade sharing one of the two fills.
  const [editingTrade, setEditingTrade] = useState<JournalTrade | null>(null)
  const [tf, setTf] = useState(EMPTY_TRADE_FORM)
  const [tfErr, setTfErr] = useState('')
  const [tfSaving, setTfSaving] = useState(false)

  // CSV import — two-step: the file is parsed server-side and shown back as
  // day rows before anything is written.
  const fileRef = useRef<HTMLInputElement>(null)
  const [csvText, setCsvText] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [importErr, setImportErr] = useState('')
  const [importing, setImporting] = useState(false)

  // Stable real-name → alias map ("Account 1", "Account 2", …), render-time
  // only — never fed back into state or the API. Keeps the panel readable
  // while masked: you can tell two accounts apart without reading the name.
  const acctAlias = useMemo(() => {
    const m = new Map<string, string>()
    const add = (raw: string) => {
      const label = raw || 'Unlabeled'
      if (!m.has(label)) m.set(label, `Account ${m.size + 1}`)
    }
    accounts.forEach((a) => add(a.account))
    trades.forEach((t) => add(t.account))
    return m
  }, [accounts, trades])
  const maskAcct = useCallback(
    (raw: string | null | undefined) => {
      const label = raw || 'Unlabeled'
      return hideAccounts ? (acctAlias.get(label) ?? 'Account •') : label
    },
    [hideAccounts, acctAlias],
  )

  const visible = useMemo(() => {
    const v = selectedDay ? journals.filter((j) => j.date === selectedDay) : journals
    return [...v].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  }, [journals, selectedDay])

  const visibleTrades = useMemo(() => {
    let v = trades
    if (selectedDay) v = v.filter((t) => t.date === selectedDay)
    if (selectedAccount) v = v.filter((t) => (t.account || 'Unlabeled') === selectedAccount)
    return v
  }, [trades, selectedDay, selectedAccount])

  // ── Header KPIs — the reference figures v2 puts inline in the page header,
  //    not as their own cards. Day-level; trade-level averages are weighted
  //    by each day's stored win/loss counts (day KPIs cannot otherwise tell
  //    an all-green day with individual losing trades from a clean sweep). ──
  const k = useMemo(() => {
    const wins = visible.filter((j) => j.net_pnl > 0)
    const losses = visible.filter((j) => j.net_pnl < 0)
    const totalPnl = visible.reduce((s, j) => s + j.net_pnl, 0)
    const totalTrades = visible.reduce((s, j) => s + j.trades, 0)
    let grossWin = 0
    let grossLoss = 0
    let winCt = 0
    let lossCt = 0
    for (const j of visible) {
      const lc = Math.round(j.trades * (1 - j.win_rate / 100))
      const wc = j.trades - lc
      winCt += wc
      lossCt += lc
      grossWin += (j.avg_win || 0) * wc
      grossLoss += Math.abs(j.avg_loss || 0) * lc
    }
    const cum: number[] = []
    let run = 0
    for (const j of visible) {
      run += j.net_pnl
      cum.push(run)
    }
    return {
      sessions: visible.length,
      totalPnl,
      totalTrades,
      winPct: wins.length + losses.length > 0 ? (wins.length / (wins.length + losses.length)) * 100 : null,
      pnlPerTrade: totalTrades > 0 ? totalPnl / totalTrades : null,
      avgWin: winCt ? grossWin / winCt : 0,
      avgLoss: lossCt ? -grossLoss / lossCt : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
      commissions: visible.reduce((s, j) => s + j.commissions, 0),
      cum,
    }
  }, [visible])

  // ── Journal entry CRUD (POST / PATCH / DELETE /api/journal) ─────────────
  const openNewJournal = () => {
    setEditId(null)
    setJf(EMPTY_JOURNAL_FORM)
    setJfErr('')
    setShowJournalForm(true)
  }
  const openEditJournal = (j: JournalRow) => {
    setEditId(j.id)
    setJf({
      date: j.date,
      netPnl: String(j.net_pnl),
      trades: String(j.trades),
      winRate: String(j.win_rate),
      avgWin: String(j.avg_win),
      avgLoss: String(j.avg_loss),
      profitFactor: String(j.profit_factor),
      commissions: String(j.commissions),
      notes: j.notes ?? '',
    })
    setJfErr('')
    setShowJournalForm(true)
  }
  const saveJournal = async () => {
    if (!jf.date) {
      setJfErr('Trading date is required.')
      return
    }
    if (jf.netPnl.trim() === '' || !Number.isFinite(num(jf.netPnl))) {
      setJfErr('Net P&L is required and must be a number.')
      return
    }
    setJfSaving(true)
    try {
      const payload = {
        ...(editId != null ? { id: editId } : {}),
        date: jf.date,
        netPnl: num(jf.netPnl),
        trades: num(jf.trades),
        winRate: num(jf.winRate),
        avgWin: num(jf.avgWin),
        avgLoss: num(jf.avgLoss),
        profitFactor: num(jf.profitFactor),
        commissions: num(jf.commissions),
        notes: jf.notes,
        kind: 'manual',
      }
      const res = await fetch('/api/journal', {
        method: editId != null ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body: { error?: string } = await res.json()
      if (!res.ok) {
        setJfErr(body.error || 'Save failed.')
        return
      }
      setShowJournalForm(false)
      await journalQ.refetch()
    } catch (e) {
      setJfErr(String(e))
    } finally {
      setJfSaving(false)
    }
  }
  const removeJournal = async (id: number) => {
    const res = await fetch(`/api/journal?id=${id}`, { method: 'DELETE' })
    if (res.ok) await journalQ.refetch()
  }

  // ── Trade CRUD (PATCH / DELETE /api/journal/trades) ──────────────────────
  const openEditTrade = (t: JournalTrade) => {
    setTf({
      symbol: t.symbol,
      account: t.account,
      direction: t.direction,
      openLocal: toLocalInput(t.open_ts),
      closeLocal: toLocalInput(t.close_ts),
      qty: String(t.qty),
      entry: String(t.entry),
      exit: String(t.exit),
      fees: String(t.fees),
    })
    setTfErr('')
    setEditingTrade(t)
  }
  const saveTrade = async () => {
    if (!editingTrade) return
    if (!tf.symbol.trim()) {
      setTfErr('Symbol is required.')
      return
    }
    if (tf.entry.trim() === '' || !Number.isFinite(num(tf.entry))) {
      setTfErr('Price In must be a number.')
      return
    }
    if (tf.exit.trim() === '' || !Number.isFinite(num(tf.exit))) {
      setTfErr('Price Out must be a number.')
      return
    }
    setTfSaving(true)
    try {
      const res = await fetch('/api/journal/trades', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openExtId: editingTrade.open_ext_id,
          closeExtId: editingTrade.close_ext_id,
          symbol: tf.symbol,
          account: tf.account,
          direction: tf.direction,
          openTs: fromLocalInput(tf.openLocal),
          closeTs: fromLocalInput(tf.closeLocal),
          qty: num(tf.qty),
          entry: num(tf.entry),
          exit: num(tf.exit),
          fees: num(tf.fees),
        }),
      })
      const body: { error?: string } = await res.json()
      if (!res.ok) {
        setTfErr(body.error || 'Save failed.')
        return
      }
      setEditingTrade(null)
      await tradesQ.refetch()
    } catch (e) {
      setTfErr(String(e))
    } finally {
      setTfSaving(false)
    }
  }
  const deleteTrade = async (t: JournalTrade) => {
    const res = await fetch(
      `/api/journal/trades?openExtId=${encodeURIComponent(t.open_ext_id)}&closeExtId=${encodeURIComponent(t.close_ext_id)}`,
      { method: 'DELETE' },
    )
    if (res.ok) await tradesQ.refetch()
  }

  // ── CSV import (POST /api/journal/import, commit:false then commit:true) ─
  const onFile = async (file: File | undefined) => {
    if (!file) return
    setImportErr('')
    setPreview(null)
    const text = await file.text()
    setCsvText(text)
    setImporting(true)
    try {
      const res = await fetch('/api/journal/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: text, commit: false }),
      })
      const body = await res.json()
      if (!res.ok) {
        setImportErr(body.error || 'Could not read that file.')
        return
      }
      setPreview(body as ImportPreview)
    } catch (e) {
      setImportErr(String(e))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  const commitImport = async () => {
    if (!csvText) return
    setImporting(true)
    try {
      const res = await fetch('/api/journal/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText, commit: true }),
      })
      const body = await res.json()
      if (!res.ok) {
        setImportErr(body.error || 'Import failed.')
        return
      }
      setPreview(null)
      setCsvText('')
      await Promise.all([journalQ.refetch(), tradesQ.refetch()])
    } catch (e) {
      setImportErr(String(e))
    } finally {
      setImporting(false)
    }
  }
  const exportCSV = () => {
    const header = 'date,netPnl,trades,winRate,avgWin,avgLoss,profitFactor,commissions,notes,kind'
    const rows = journals.map((j) =>
      [
        j.date,
        j.net_pnl,
        j.trades,
        j.win_rate,
        j.avg_win,
        j.avg_loss,
        j.profit_factor,
        j.commissions,
        JSON.stringify(j.notes ?? ''),
        j.kind,
      ].join(','),
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `trading-journals-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── Journal pane table columns ────────────────────────────────────────────
  const accountCols: Column<AccountStat>[] = [
    { key: 'account', header: 'Account', cell: (a) => maskAcct(a.account || 'Unlabeled') },
    { key: 'sessions', header: 'Sessions', numeric: true, cell: (a) => a.sessions },
    { key: 'trades', header: 'Trades', numeric: true, cell: (a) => a.trades },
    {
      key: 'net_pnl',
      header: 'Net P&L',
      numeric: true,
      cell: (a) => <span className={a.net_pnl >= 0 ? 'text-up' : 'text-down'}>{fmtMoney(a.net_pnl)}</span>,
    },
    { key: 'win_rate', header: 'Win %', numeric: true, cell: (a) => fmtPct(a.win_rate) },
  ]

  const logCols: Column<JournalRow>[] = [
    { key: 'date', header: 'Date', cell: (j) => j.date },
    {
      key: 'net_pnl',
      header: 'Net P&L',
      numeric: true,
      cell: (j) => <span className={j.net_pnl >= 0 ? 'text-up' : 'text-down'}>{fmtMoney(j.net_pnl)}</span>,
    },
    {
      key: 'cum_pnl',
      header: 'Cum P&L',
      numeric: true,
      // `visible` is the exact array passed to this table as `rows`, so index
      // i lines up with k.cum, which is built by walking that same array.
      cell: (_j, i) => {
        const v = k.cum[i] ?? 0
        return <span className={v >= 0 ? 'text-up' : 'text-down'}>{fmtMoney(v)}</span>
      },
    },
    { key: 'trades', header: 'Trades', numeric: true, cell: (j) => j.trades },
    { key: 'win_rate', header: 'Win %', numeric: true, cell: (j) => (j.win_rate ? fmtPct(j.win_rate) : '—') },
    {
      key: 'result',
      header: 'Result',
      cell: (j) => (
        <span className={j.net_pnl >= 0 ? 'font-semibold text-up' : 'font-semibold text-down'}>
          {j.net_pnl >= 0 ? 'WIN' : 'LOSS'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (j) => (
        <div className="flex justify-end gap-1">
          <button className="rounded-sm border border-line px-2 py-0.5 text-xs hover:bg-raised" onClick={() => openEditJournal(j)}>
            Edit
          </button>
          <button className="rounded-sm border border-line px-2 py-0.5 text-xs hover:bg-raised" onClick={() => removeJournal(j.id)}>
            ✕
          </button>
        </div>
      ),
    },
  ]

  const tradeCols: Column<JournalTrade>[] = [
    { key: 'date', header: 'Date', cell: (t) => t.date },
    { key: 'symbol', header: 'Symbol', cell: (t) => t.symbol },
    {
      key: 'side',
      header: 'Side',
      cell: (t) => (
        <span className={t.direction === 'long' ? 'text-up' : 'text-down'}>{t.direction === 'long' ? 'Long' : 'Short'}</span>
      ),
    },
    { key: 'account', header: 'Account', cell: (t) => (t.account ? maskAcct(t.account) : '—') },
    {
      key: 'time_in',
      header: 'Time In',
      cell: (t) => new Date(t.open_ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
    {
      key: 'time_out',
      header: 'Time Out',
      cell: (t) => new Date(t.close_ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
    { key: 'entry', header: 'Price In', numeric: true, cell: (t) => t.entry.toFixed(2) },
    { key: 'exit', header: 'Price Out', numeric: true, cell: (t) => t.exit.toFixed(2) },
    { key: 'qty', header: 'Qty', numeric: true, cell: (t) => t.qty },
    {
      key: 'pnl',
      header: 'P&L',
      numeric: true,
      cell: (t) => <span className={t.pnl >= 0 ? 'font-semibold text-up' : 'font-semibold text-down'}>{fmtMoney(t.pnl)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (t) => (
        <div className="flex justify-end gap-1">
          <button className="rounded-sm border border-line px-2 py-0.5 text-xs hover:bg-raised" onClick={() => openEditTrade(t)}>
            Edit
          </button>
          <button className="rounded-sm border border-line px-2 py-0.5 text-xs hover:bg-raised" onClick={() => deleteTrade(t)}>
            ✕
          </button>
        </div>
      ),
    },
  ]

  const previewCols: Column<JournalRow>[] = [
    { key: 'date', header: 'Date', cell: (d) => d.date },
    {
      key: 'net_pnl',
      header: 'Net P&L',
      numeric: true,
      cell: (d) => <span className={d.net_pnl >= 0 ? 'font-semibold text-up' : 'font-semibold text-down'}>{fmtMoney(d.net_pnl)}</span>,
    },
    { key: 'trades', header: 'Trades', numeric: true, cell: (d) => d.trades },
    { key: 'win_rate', header: 'Win %', numeric: true, cell: (d) => fmtPct(d.win_rate) },
    { key: 'avg_win', header: 'Avg Win', numeric: true, cell: (d) => (d.avg_win ? fmtMoney(d.avg_win) : '—') },
    { key: 'avg_loss', header: 'Avg Loss', numeric: true, cell: (d) => (d.avg_loss ? fmtMoney(d.avg_loss) : '—') },
    { key: 'pf', header: 'PF', numeric: true, cell: (d) => (d.profit_factor ? d.profit_factor.toFixed(2) : '—') },
    { key: 'fees', header: 'Fees', numeric: true, cell: (d) => fmtMoney(d.commissions) },
  ]

  const anyError = journalQ.error || tradesQ.error

  return (
    <Page title="Journaling Dashboard">
      {/* Header KPIs — v2 keeps these inline in the page header rather than as
          their own cards: reference figures, not findings. */}
      <Card>
        <div className="flex flex-wrap items-center gap-6">
          <Stat label="Net P&L" value={visible.length ? fmtMoney(k.totalPnl) : '—'} direction={dirOf(k.totalPnl)} size="lg" />
          <Stat label="Sessions" value={String(k.sessions || 0)} size="lg" />
          <Stat label="Trades" value={String(k.totalTrades || 0)} size="lg" />
          <Stat label="Day win" value={fmtPct(k.winPct)} size="lg" />
          <Stat
            label="Per trade"
            value={k.pnlPerTrade != null ? fmtMoney(k.pnlPerTrade) : '—'}
            direction={k.pnlPerTrade != null ? dirOf(k.pnlPerTrade) : undefined}
            size="lg"
          />
          <div className="flex-1" />
          {anyError && <span className="text-xs text-down">Refresh failed — showing last known data.</span>}
          <span className="text-xs text-faint">
            {journalQ.loading && !journalQ.data ? 'Loading…' : `${journals.length} saved`}
          </span>
        </div>
      </Card>

      {/* Toolbar — filter chips plus the CSV import/export and account-mask
          controls, matching v2's journal-toolbar row. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {selectedDay && (
            <Chip label={`Day: ${selectedDay} ✕`} on onClick={() => setSelectedDay(null)} />
          )}
          {selectedAccount && (
            <Chip label={`Account: ${maskAcct(selectedAccount)} ✕`} on onClick={() => setSelectedAccount(null)} />
          )}
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <button
            className="rounded-sm border border-line bg-surface2 px-3 py-1 text-xs hover:bg-raised disabled:opacity-50"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            {importing ? 'Reading…' : 'Import Broker CSV'}
          </button>
          <button className="rounded-sm border border-line bg-surface2 px-3 py-1 text-xs hover:bg-raised" onClick={exportCSV}>
            Export CSV
          </button>
          <Chip
            label={hideAccounts ? '🙈 Accounts Hidden' : '👁 Hide Accounts'}
            on={hideAccounts}
            onClick={() => setHideAccounts((v) => !v)}
            title={hideAccounts ? 'Account names are hidden — click to show' : 'Hide account names (for screen shares)'}
          />
          <button className="rounded-sm border border-accent bg-accent px-3 py-1 text-xs font-semibold text-bg" onClick={openNewJournal}>
            + New Journal
          </button>
        </div>
      </div>

      {importErr && <Card className="text-sm text-down">{importErr}</Card>}

      {/* Focus nav — one pane on screen at a time, same five panes as v2. */}
      <SegGroup options={[...PANES]} value={pane} onChange={(v) => setPane(v as PaneKey)} />

      {pane === 'calendar' && (
        <StubPane
          title="Calendar"
          note="Month heat-map of daily P&L, click-to-filter into the other panes — not yet ported."
          todo="port the calCells month-grid memo and its heat-map render (Trading.tsx, ~L1162-1194 and ~L1900-1994)."
        />
      )}

      {pane === 'leaks' && (
        <StubPane
          title="Leaks"
          note="Six trade-level 'leak finder' cards (hold-time asymmetry, overtrading curve, revenge trades, fee drag, loss-cap discipline, size discipline) derived from imported fills — not yet ported."
          todo="port the `leaks` useMemo and insightCard() renderer (Trading.tsx, ~L951-1317)."
        />
      )}

      {pane === 'clock' && (
        <StubPane
          title="The clock"
          note="Time-of-day P&L breakdown — best window, dead zone, and a weekday × hour heat grid — not yet ported."
          todo="port the `tod` useMemo and its 30-minute bucket / weekday-hour grid render (Trading.tsx, ~L1060-1162, ~L1730-1860)."
        />
      )}

      {pane === 'charts' && (
        <StubPane
          title="Charts"
          note="Eight hand-drawn SVG charts (Profit Factor, Cumulative PnL, Drawdown, PnL Per Day, Win/Loss, Expectancy, P&L Distribution, Median PnL vs Day of Week) with hover tooltips and a pop-out view — not yet ported."
          todo="port `chartDefs`, ChartFrame/ChartTip and the axis helpers (Trading.tsx, ~L260-425, ~L1317-1440)."
        />
      )}

      {pane === 'journal' && (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_2fr]">
            <Card title={`By Account${selectedAccount ? ` — ${maskAcct(selectedAccount)} ✕` : ''}`} flush>
              <Table
                columns={accountCols}
                rows={accounts}
                rowKey={(a) => a.account || 'Unlabeled'}
                rowClassName={(a) => (selectedAccount === (a.account || 'Unlabeled') ? 'bg-raised' : undefined)}
                empty="No account column found on the imported CSV yet — every trade is grouped as one account."
              />
            </Card>

            <Card title="Session vs Targets">
              <table className="w-full text-sm">
                <tbody>
                  {(
                    [
                      ['Avg Win', k.avgWin ? fmtMoney(k.avgWin) : '—'],
                      ['Avg Loss', k.avgLoss ? fmtMoney(k.avgLoss) : '—'],
                      ['Profit Factor', k.profitFactor != null ? fmtNum(k.profitFactor) : '—'],
                      ['Commissions', visible.length ? fmtMoney(k.commissions) : '—'],
                      ['Win Ratio', fmtPct(k.winPct, 1)],
                    ] as [string, string][]
                  ).map(([l, v]) => (
                    <tr key={l} className="border-b border-line/50 last:border-0">
                      <td className="py-1.5 text-muted">{l}</td>
                      <td className="py-1.5 text-right tabular text-fg">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title={`Journal Log (${visible.length} entries)`} flush>
              <Table
                columns={logCols}
                rows={visible}
                rowKey={(j) => j.id}
                empty={journalQ.loading && !journalQ.data ? 'Loading…' : 'No journal entries yet — click + New Journal.'}
              />
            </Card>
          </div>

          {/* Trade-level detail — symbol, time in/out, price in/out, direction,
              account. Populated from the fills a CSV import already saved. */}
          <Card title={`Trades (${visibleTrades.length})`} flush>
            <Table
              columns={tradeCols}
              rows={[...visibleTrades].sort((a, b) => b.close_ts - a.close_ts).slice(0, 300)}
              rowKey={(t, i) => `${t.open_ext_id}-${t.close_ext_id}-${i}`}
              empty="No per-trade detail yet — import a broker CSV to populate symbol / time in-out / price in-out per trade."
            />
            {visibleTrades.length > 300 && (
              <p className="px-2 py-1.5 text-xs text-faint">Showing the most recent 300 of {visibleTrades.length} trades.</p>
            )}
          </Card>
        </>
      )}

      {/* CSV import preview — nothing is written until "Import" is clicked. */}
      {preview && (
        <Overlay onClose={() => setPreview(null)} wide>
          <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
            <h2 className="text-base font-semibold text-fg">
              Import Preview — {BROKER_LABEL[preview.broker] ?? preview.broker}
            </h2>
            <button className="text-lg text-muted" onClick={() => setPreview(null)}>
              ×
            </button>
          </div>
          <p className="mb-3 text-sm text-muted">
            {preview.counts.fills} fills → {preview.counts.trades} closed trades →{' '}
            <span className="text-fg">{preview.counts.days} journal days</span>. Stats are recomputed from the
            executions, not read from the broker's summary.
          </p>
          {preview.warnings.map((w, i) => (
            <p key={i} className="mb-2 text-sm text-warn">
              ⚠ {w}
            </p>
          ))}
          <div className="max-h-72 overflow-auto">
            <Table columns={previewCols} rows={preview.days} rowKey={(d) => d.date} />
          </div>
          <p className="mt-3 text-xs text-faint">
            Existing days with the same date are overwritten (your notes are kept). Re-importing the same statement
            is safe — duplicate fills are ignored.
          </p>
          <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
            <button className="rounded-sm border border-line px-3 py-1 text-xs" onClick={() => setPreview(null)} disabled={importing}>
              Cancel
            </button>
            <button
              className="rounded-sm border border-accent bg-accent px-3 py-1 text-xs font-semibold text-bg disabled:opacity-50"
              onClick={commitImport}
              disabled={importing}
            >
              {importing ? 'Importing…' : `Import ${preview.counts.days} Days`}
            </button>
          </div>
        </Overlay>
      )}

      {/* Edit trade — writes an override, never the underlying fills. */}
      {editingTrade && (
        <Overlay onClose={() => setEditingTrade(null)}>
          <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
            <h2 className="text-base font-semibold text-fg">Edit Trade</h2>
            <button className="text-lg text-muted" onClick={() => setEditingTrade(null)}>
              ×
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Symbol">
                <input className={inputCls} value={tf.symbol} onChange={(e) => setTf({ ...tf, symbol: e.target.value })} />
              </Field>
              <Field label="Side">
                <select
                  className={inputCls}
                  value={tf.direction}
                  onChange={(e) => setTf({ ...tf, direction: e.target.value === 'short' ? 'short' : 'long' })}
                >
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </Field>
              {/* While masked, the alias shows read-only — editing the account is
                  the one thing you can't do with accounts hidden, by design. */}
              <Field label="Account">
                <input
                  className={inputCls + (hideAccounts ? ' cursor-not-allowed opacity-60' : '')}
                  readOnly={hideAccounts}
                  title={hideAccounts ? 'Unhide accounts to edit this field' : undefined}
                  value={hideAccounts ? maskAcct(tf.account) : tf.account}
                  onChange={(e) => !hideAccounts && setTf({ ...tf, account: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Time In">
                <input
                  type="datetime-local"
                  step={1}
                  className={inputCls}
                  value={tf.openLocal}
                  onChange={(e) => setTf({ ...tf, openLocal: e.target.value })}
                />
              </Field>
              <Field label="Time Out">
                <input
                  type="datetime-local"
                  step={1}
                  className={inputCls}
                  value={tf.closeLocal}
                  onChange={(e) => setTf({ ...tf, closeLocal: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <Field label="Price In">
                <input type="number" step="0.01" className={inputCls} value={tf.entry} onChange={(e) => setTf({ ...tf, entry: e.target.value })} />
              </Field>
              <Field label="Price Out">
                <input type="number" step="0.01" className={inputCls} value={tf.exit} onChange={(e) => setTf({ ...tf, exit: e.target.value })} />
              </Field>
              <Field label="Qty">
                <input type="number" step="1" min="1" className={inputCls} value={tf.qty} onChange={(e) => setTf({ ...tf, qty: e.target.value })} />
              </Field>
              <Field label="Fees ($)">
                <input type="number" step="0.01" className={inputCls} value={tf.fees} onChange={(e) => setTf({ ...tf, fees: e.target.value })} />
              </Field>
            </div>
            <p className="text-xs text-faint">P&L recalculates from Price In/Out × Qty × the contract's point value, minus Fees.</p>
          </div>
          {tfErr && <p className="mt-2 text-sm text-down">{tfErr}</p>}
          <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
            <button className="rounded-sm border border-line px-3 py-1 text-xs" onClick={() => setEditingTrade(null)} disabled={tfSaving}>
              Cancel
            </button>
            <button
              className="rounded-sm border border-accent bg-accent px-3 py-1 text-xs font-semibold text-bg disabled:opacity-50"
              onClick={saveTrade}
              disabled={tfSaving}
            >
              {tfSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </Overlay>
      )}

      {/* New / edit journal entry */}
      {showJournalForm && (
        <Overlay onClose={() => setShowJournalForm(false)}>
          <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
            <h2 className="text-base font-semibold text-fg">{editId != null ? 'Edit Journal Entry' : 'New Journal Entry'}</h2>
            <button className="text-lg text-muted" onClick={() => setShowJournalForm(false)}>
              ×
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <Field label="Trading Date">
              <input type="date" className={inputCls} value={jf.date} onChange={(e) => setJf({ ...jf, date: e.target.value })} />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Net P&L ($)">
                <input type="number" step="0.01" placeholder="e.g. 312.50" className={inputCls} value={jf.netPnl} onChange={(e) => setJf({ ...jf, netPnl: e.target.value })} />
              </Field>
              <Field label="Total Trades">
                <input type="number" step="1" min="0" placeholder="e.g. 8" className={inputCls} value={jf.trades} onChange={(e) => setJf({ ...jf, trades: e.target.value })} />
              </Field>
              <Field label="Win Rate (%)">
                <input type="number" step="0.1" min="0" max="100" placeholder="e.g. 62.5" className={inputCls} value={jf.winRate} onChange={(e) => setJf({ ...jf, winRate: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Avg Win ($)">
                <input type="number" step="0.01" placeholder="e.g. 187.00" className={inputCls} value={jf.avgWin} onChange={(e) => setJf({ ...jf, avgWin: e.target.value })} />
              </Field>
              <Field label="Avg Loss ($)">
                <input type="number" step="0.01" placeholder="e.g. -95.00" className={inputCls} value={jf.avgLoss} onChange={(e) => setJf({ ...jf, avgLoss: e.target.value })} />
              </Field>
              <Field label="Profit Factor">
                <input type="number" step="0.01" min="0" placeholder="e.g. 1.87" className={inputCls} value={jf.profitFactor} onChange={(e) => setJf({ ...jf, profitFactor: e.target.value })} />
              </Field>
            </div>
            <Field label="Commissions ($)">
              <input type="number" step="0.01" placeholder="e.g. -24.00" className={inputCls} value={jf.commissions} onChange={(e) => setJf({ ...jf, commissions: e.target.value })} />
            </Field>
            <Field label="Notes">
              <textarea
                rows={2}
                placeholder="Market conditions, key trades, observations…"
                className={inputCls + ' resize-y'}
                value={jf.notes}
                onChange={(e) => setJf({ ...jf, notes: e.target.value })}
              />
            </Field>
          </div>
          {jfErr && <p className="mt-2 text-sm text-down">{jfErr}</p>}
          <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
            <button className="rounded-sm border border-line px-3 py-1 text-xs" onClick={() => setShowJournalForm(false)} disabled={jfSaving}>
              Cancel
            </button>
            <button
              className="rounded-sm border border-accent bg-accent px-3 py-1 text-xs font-semibold text-bg disabled:opacity-50"
              onClick={saveJournal}
              disabled={jfSaving}
            >
              {jfSaving ? 'Saving…' : editId != null ? 'Save Changes' : 'Save Entry'}
            </button>
          </div>
        </Overlay>
      )}
    </Page>
  )
}
