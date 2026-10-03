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
// The picture is the workspace's own: `ws.screenshot()` — every visible chart
// in its grid slot, or the one chart — the exact pixels the old button saved.
//
// The clipboard write happens SYNCHRONOUSLY inside the click (the screenshot
// is synchronous, and the PNG is decoded from its data URL without a fetch),
// because Safari only allows a clipboard write while the tap's user activation
// is still live. Where writing an image is not possible — an old browser, a
// denied permission, a page that is not focused — it falls back to the
// download it replaced and says so, rather than silently doing nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction, type WidgetContext } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'

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

function copyScreenshot(ctx: WidgetContext): void {
  const ws = current
  const url = ws ? ws.screenshot() : ctx.chart.renderer.screenshot()
  if (!url) {
    ctx.toast('Nothing to capture yet', 'error')
    return
  }
  const blob = pngBlob(url)
  const canWrite =
    !!blob && typeof ClipboardItem !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.clipboard?.write
  const fallback = () => {
    ws?.downloadScreenshot()
    ctx.toast('Clipboard blocked — screenshot downloaded instead', 'info')
  }
  if (!canWrite || !blob) {
    fallback()
    return
  }
  navigator.clipboard
    .write([new ClipboardItem({ 'image/png': blob })])
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
