// ─────────────────────────────────────────────────────────────────────────────
// CHART SETUPS: named workspace layouts, saved and loaded in one click.
//
// A setup is the whole workspace as Vela snapshots it (workspace.getState()):
// the grid and its splitters, each chart's symbol, timeframe, session and chart
// style, every study and script with its settings, the synced links, the open
// side panel. Your DRAWINGS are left out: they belong to the charts, not to a
// template. Loading a setup keeps the drawings of any chart that stays on the
// same symbol.
//
// Stored on your account (the page-preset store, page `vela-setups`, up to 12),
// so a setup made on one computer is there on the next. Signed out, or if the
// account store refuses, they are kept in this browser instead, and the menu
// says which.
// ─────────────────────────────────────────────────────────────────────────────

import type { WidgetContext } from '@luxalgo/vela'
import { readPage, writePreset } from '@/pages/vela/script/library'
import { setupsWorkspace } from './setups'

const PAGE = 'vela-setups'
const LOCAL_KEY = 'cb-vela-setups'
const MAX = 12

interface Setup {
  name: string
  state: Record<string, unknown>
  at: number
}

type ChartDoc = { id?: string; symbol?: string; timeframe?: string; drawings?: unknown } & Record<string, unknown>

const bare = (s: string | undefined) => (s ?? '').replace(/^[^:]*:/, '')
const tfText = (tf: string | undefined) => (!tf ? '' : /^\d+$/.test(tf) ? (Number(tf) % 60 === 0 ? `${Number(tf) / 60}h` : `${tf}m`) : tf)

function charts(state: Record<string, unknown>): ChartDoc[] {
  return Array.isArray(state.charts) ? (state.charts as ChartDoc[]) : []
}

function summary(state: Record<string, unknown>): string {
  const cs = charts(state)
  const list = cs.slice(0, 3).map((c) => `${bare(c.symbol)} ${tfText(c.timeframe)}`.trim())
  return `${cs.length} chart${cs.length === 1 ? '' : 's'} · ${list.join(', ')}${cs.length > 3 ? '…' : ''}`
}

function withoutDrawings(state: Record<string, unknown>): Record<string, unknown> {
  return { ...state, charts: charts(state).map(({ drawings: _d, ...rest }) => rest) }
}

function readLocal(): Setup[] {
  try {
    const j: unknown = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]')
    return Array.isArray(j) ? (j as Setup[]).filter((s) => s && typeof s.name === 'string' && s.state && typeof s.state === 'object') : []
  } catch {
    return []
  }
}
function writeLocal(list: Setup[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    /* private mode */
  }
}

/** The setups, from the account when it answers, else this browser. */
async function loadSetups(): Promise<{ list: Setup[]; where: 'account' | 'browser' }> {
  try {
    const r = await readPage(PAGE)
    if (r === 'auth') return { list: readLocal(), where: 'browser' }
    const list = r
      .map((p) => ({ name: p.name, ...(p.preset as { state?: Record<string, unknown>; at?: number }) }))
      .filter((s): s is Setup => !!s.state && typeof s.state === 'object')
      .map((s) => ({ name: s.name, state: s.state, at: Number(s.at) || 0 }))
    return { list, where: 'account' }
  } catch {
    return { list: readLocal(), where: 'browser' }
  }
}

async function save(name: string, state: Record<string, unknown>, where: 'account' | 'browser'): Promise<'account' | 'browser'> {
  const setup: Setup = { name, state: withoutDrawings(state), at: Date.now() }
  if (where === 'account') {
    try {
      await writePreset(PAGE, name, { state: setup.state, at: setup.at })
      return 'account'
    } catch {
      /* too big, over the limit, or offline: keep it here instead */
    }
  }
  const list = readLocal().filter((s) => s.name !== name)
  writeLocal([setup, ...list])
  return 'browser'
}

async function remove(name: string, where: 'account' | 'browser'): Promise<void> {
  if (where === 'account') {
    try {
      await writePreset(PAGE, name, null)
    } catch {
      /* ignore */
    }
  }
  writeLocal(readLocal().filter((s) => s.name !== name))
}

/** Apply a setup, carrying over the drawings of charts that keep their symbol. */
function apply(setup: Setup): boolean {
  const ws = setupsWorkspace()
  if (!ws) return false
  const cur = ws.getState() as unknown as Record<string, unknown>
  const now = charts(cur)
  const next = charts(setup.state).map((c, k) => {
    const same = now.find((x) => x.id === c.id && bare(x.symbol) === bare(c.symbol)) ?? (now[k] && bare(now[k]!.symbol) === bare(c.symbol) ? now[k] : undefined)
    return same?.drawings ? { ...c, drawings: same.drawings } : c
  })
  ws.applyState({ ...setup.state, charts: next })
  return true
}

// ── The menu ─────────────────────────────────────────────────────────────────

let open: { el: HTMLElement; close: () => void } | null = null

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}

export function openSetups(ctx: WidgetContext, anchor: HTMLElement | null): void {
  if (open) {
    open.close()
    return
  }
  const menu = el('div', 'cb-scr cb-setups')
  menu.setAttribute('role', 'dialog')
  menu.setAttribute('aria-label', 'Chart setups')
  menu.style.cssText = 'position:fixed;z-index:80'
  for (const t of ['keydown', 'keyup', 'keypress'] as const) menu.addEventListener(t, (e) => e.stopPropagation())
  document.body.appendChild(menu)
  const place = () => {
    const r = anchor?.getBoundingClientRect()
    const w = Math.min(320, window.innerWidth - 16)
    menu.style.width = `${w}px`
    const left = r ? Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) : Math.max(8, (window.innerWidth - w) / 2)
    menu.style.left = `${left}px`
    menu.style.top = `${r ? r.bottom + 6 : 60}px`
  }
  place()

  let where: 'account' | 'browser' = 'account'
  let list: Setup[] = []
  let msg = ''

  const close = () => {
    menu.remove()
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('keydown', esc, true)
    window.removeEventListener('resize', place)
    open = null
  }
  const outside = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node) && e.target !== anchor && !anchor?.contains(e.target as Node)) close()
  }
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', esc, true)
  window.addEventListener('resize', place)
  open = { el: menu, close }

  const draw = () => {
    menu.replaceChildren()
    menu.append(el('div', 'cb-setups-h', 'Chart setups'))
    const row = el('div', 'cb-setups-save')
    const name = el('input', 'cb-scr-name')
    name.placeholder = `Setup ${list.length + 1}`
    name.maxLength = 40
    name.setAttribute('aria-label', 'Setup name')
    const btn = el('button', 'cb-scr-btn cb-scr-primary cb-scr-small', 'Save current')
    btn.type = 'button'
    const doSave = async () => {
      const ws = setupsWorkspace()
      if (!ws) return
      const n = (name.value.trim() || name.placeholder).slice(0, 40)
      if (!list.some((s) => s.name === n) && list.length >= MAX) {
        msg = `Up to ${MAX} setups: delete one first.`
        return draw()
      }
      btn.disabled = true
      const got = await save(n, ws.getState() as unknown as Record<string, unknown>, where)
      if (got !== where) {
        where = got
        msg = 'Saved in this browser (the account store did not take it).'
      } else msg = ''
      ctx.toast(`Setup “${n}” saved`, 'success')
      await refresh()
    }
    btn.addEventListener('click', () => void doSave())
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void doSave()
    })
    row.append(name, btn)
    menu.append(row)
    if (msg) menu.append(el('div', 'cb-setups-msg', msg))
    if (!list.length) menu.append(el('div', 'cb-setups-empty', 'No setups yet. Arrange the charts the way you like, name it, and save.'))
    for (const s of list) {
      const item = el('div', 'cb-setups-item')
      const go = el('button', 'cb-setups-go')
      go.type = 'button'
      go.append(el('span', 'cb-setups-name', s.name), el('span', 'cb-setups-sub', summary(s.state)))
      go.title = 'Load this setup'
      go.addEventListener('click', () => {
        if (apply(s)) {
          ctx.toast(`Loaded “${s.name}”`, 'success')
          close()
        }
      })
      const del = el('button', 'cb-setups-del', '✕')
      del.type = 'button'
      del.title = 'Delete'
      del.setAttribute('aria-label', `Delete ${s.name}`)
      del.addEventListener('click', async () => {
        await remove(s.name, where)
        await refresh()
      })
      item.append(go, del)
      menu.append(item)
    }
    menu.append(el('div', 'cb-setups-foot', where === 'account' ? 'Saved to your account: on every computer you sign in on.' : 'Saved in this browser.'))
  }

  const refresh = async () => {
    const r = await loadSetups()
    list = r.list.sort((a, b) => b.at - a.at)
    where = r.where
    if (open?.el === menu) draw()
  }
  menu.append(el('div', 'cb-setups-empty', 'Loading…'))
  void refresh()
  setTimeout(() => menu.querySelector<HTMLInputElement>('input')?.focus(), 30)
}
