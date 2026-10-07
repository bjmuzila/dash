// ─────────────────────────────────────────────────────────────────────────────
// VELA'S CAMERA → THE CLIPBOARD.
//
// Vela's topbar camera (and its mobile "more" row, and the Ctrl/Cmd+Alt+S
// chord) downloads a PNG. Here it COPIES the PNG to the clipboard instead, so a
// chart goes straight into Discord, X or a message without a trip through the
// downloads folder.
//
// How: Vela lets a host take over its `'screenshot'` topbar slot by
// registering a widget action under that id (OVERRIDABLE_TOPBAR_IDS). The
// override takes the slot's WHOLE surface — the desktop button in the same
// spot and look (`iconOnly` + the library's own `camera` icon), the mobile
// row, and the keyboard chord — and the shell resolves it when a workspace is
// CONSTRUCTED, which is why registerCopyScreenshot() runs at module scope in
// pages/Vela.tsx, before any workspace exists.
//
// THE PICTURE IS THE SCREEN (2026-10-07, Brandon: "vela screenshot missing gex
// rail and a few other things. it just shows the main chart"). Vela's own
// `ws.screenshot()` composites its chart canvases only, so the GEX Rail, the
// legend cards and every other overlay the page draws as HTML were missing.
// Now the whole chart grid is captured as it looks (domShot.ts): each chart's
// canvas stack is that chart's own screenshot, and the overlays sit on top of
// it where they are on screen. Vela's picture is still the fallback if that
// capture fails.
//
// The clipboard write is STARTED inside the click with the PNG as a promise
// (ClipboardItem takes one), because Safari only allows a clipboard write
// while the tap's user activation is still live, and the capture takes a
// moment. Where writing an image is not possible — an old browser, a denied
// permission, a page that is not focused — it falls back to a download and
// says so, rather than silently doing nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction, type WidgetContext } from '@luxalgo/vela'
import { track } from '@/pages/vela/telemetry'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { domShot } from '@/pages/vela/domShot'

/** The workspace the page has mounted. One at a time: /vela and /m/vela never coexist. */
let current: VelaWorkspace | null = null

/** Point the camera at a workspace. Returns the unbind for the page's cleanup. */
export function bindShotWorkspace(ws: VelaWorkspace): () => void {
  current = ws
  return () => {
    if (current === ws) current = null
  }
}

/** `data:image/png;base64,…` → a PNG Blob, synchronously. */
function pngBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  try {
    const bin = atob(dataUrl.slice(comma + 1))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: 'image/png' })
  } catch {
    return null
  }
}

/** Vela's own picture (charts only), as a PNG Blob, or null. */
function velaShot(ctx: WidgetContext): Blob | null {
  const ws = current
  const url = ws ? ws.screenshot() : ctx.chart.renderer.screenshot()
  return url ? pngBlob(url) : null
}

/** The chart grid as it looks on screen: Vela's pixels per chart, every overlay on top. */
async function screenShot(ctx: WidgetContext): Promise<Blob> {
  const ws = current
  const grid = ws?.root.querySelector<HTMLElement>('.vela-ws-grid')
  if (!ws || !grid) throw new Error('no grid')
  // each cell's canvas stack → that chart's own screenshot, drawn where the stack is
  const stacks = new Map<Element, { first: HTMLCanvasElement; rect: DOMRect; url: string | null }>()
  for (const c of ws.cells()) {
    const cell = ws.cell(c.id)
    const first = cell?.host.querySelector('canvas')
    if (!cell || !first) continue
    let url: string | null = null
    try {
      url = cell.chart.renderer.screenshot() || null
    } catch {
      url = null
    }
    stacks.set(cell.host, { first, rect: first.getBoundingClientRect(), url })
  }
  const near = (a: DOMRect, b: DOMRect) =>
    Math.abs(a.left - b.left) < 1.5 && Math.abs(a.top - b.top) < 1.5 && Math.abs(a.width - b.width) < 1.5 && Math.abs(a.height - b.height) < 1.5
  return domShot(grid, {
    // the toast saying "copied", the floating drawing pill: not part of the chart
    skip: (el) => el.classList.contains('vela-toast') || el.classList.contains('vela-drawpill'),
    canvas: (cv) => {
      for (const [host, st] of stacks) {
        if (!host.contains(cv)) continue
        if (cv === st.first) return st.url
        // the rest of the stack is already in the chart's picture
        if (near(cv.getBoundingClientRect(), st.rect)) return null
      }
      return undefined
    },
  }).catch(() => {
    const b = velaShot(ctx)
    if (!b) throw new Error('nothing to capture')
    return b
  })
}

function download(blob: Blob): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `vela-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

function copyScreenshot(ctx: WidgetContext): void {
  track('screenshot')
  if (!current && !ctx.chart.renderer.screenshot()) {
    ctx.toast('Nothing to capture yet', 'error')
    return
  }
  const shot = screenShot(ctx)
  const fallback = () => {
    void shot
      .then((b) => {
        download(b)
        ctx.toast('Clipboard blocked: screenshot downloaded instead', 'info')
      })
      .catch(() => ctx.toast('Nothing to capture yet', 'error'))
  }
  const canWrite = typeof ClipboardItem !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.clipboard?.write
  if (!canWrite) {
    fallback()
    return
  }
  let item: ClipboardItem
  try {
    // the PNG as a promise: the write starts inside the click, the pixels follow
    item = new ClipboardItem({ 'image/png': shot })
  } catch {
    fallback()
    return
  }
  navigator.clipboard
    .write([item])
    .then(() => ctx.toast('Screenshot copied to clipboard', 'success'))
    .catch(fallback)
}

let registered = false

/** Take over Vela's screenshot slot. Idempotent; must run before a workspace is built. */
export function registerCopyScreenshot(): void {
  if (registered) return
  registered = true
  registerWidgetAction({
    id: 'screenshot',
    target: 'topbar',
    label: 'Copy screenshot to clipboard',
    icon: 'camera',
    iconOnly: true,
    run: copyScreenshot,
  })
}
