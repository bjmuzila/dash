// ─────────────────────────────────────────────────────────────────────────────
// SCREENSHOT ATTACHMENTS — the browser half.
//
// A ticket or a reply can carry images. The wire format is a data URL inside
// the ordinary JSON body — `shots: [{dataUrl,name}]` on POST /api/feedback and
// POST /api/feedback/:id/messages — because server-v2 has no multipart parser
// and never needed one (the recipe photo path makes the same trade).
//
// That puts SIZE on this side. A raw 4K screenshot is 6-8MB and base64 inflates
// it by a third; downscaled to 1600px and re-encoded it is a couple of hundred
// KB, which is the difference between a reply that sends on a phone and one
// that times out. `prepareShot` is the only thing that should ever build a data
// URL for this API.
//
// PNG IS KEPT FOR SMALL IMAGES. A cropped screenshot of TEXT goes to mush in
// JPEG at any bearable quality, and re-encoding a 300KB crop buys nothing. Only
// images that are actually large get re-encoded, where the win is real and the
// content is a whole screen rather than a few glyphs.
//
// THIRD COPY, KNOWINGLY. components/shared/feedbackShots.ts (Next) and
// owner-vite/src/lib/feedbackShots.ts are the same file. v3 shares no code with
// v2 in either direction — that is the clean-slate rule, not an oversight — so
// this is a copy the way the thread itself is a copy. It is ~150 lines of pure
// function with no imports; when one changes, change all three.
// ─────────────────────────────────────────────────────────────────────────────

/** An attachment as /api/feedback/:id returns it — never the bytes. */
export interface FeedbackShot {
  id: number
  /** null = attached to the ticket's opening message. */
  message_id: number | null
  author: 'user' | 'owner'
  mime: string
  byte_len: number | string
  etag: string
  name: string | null
  created_at: string
}

/** The server caps this too; the number here is what makes the message honest. */
export const MAX_SHOTS = 6
/** Longest edge after downscaling. 1600 keeps UI text readable at 1:1. */
export const SHOT_MAX_PX = 1600
/** Under this, a PNG ships as-is rather than being re-encoded. */
export const PNG_KEEP_BYTES = 400 * 1024
export const SHOT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

/** A picked-but-not-yet-sent image. `dataUrl` is what goes on the wire. */
export interface PendingShot {
  /** Local key only — the server assigns the real id. */
  key: string
  name: string
  dataUrl: string
  bytes: number
}

/** Where the thread pulls an attachment's bytes from. */
export function shotUrl(s: Pick<FeedbackShot, 'id' | 'etag'>): string {
  return `/api/feedback/shot/${s.id}?v=${encodeURIComponent(s.etag)}`
}

export function shotKb(n: number | string): string {
  const b = Number(n ?? 0)
  if (!Number.isFinite(b) || b <= 0) return ''
  return b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`
}

/** A canvas would flatten an animated GIF to one frame, so it passes through whole. */
function passThrough(file: File): boolean {
  return file.type === 'image/gif'
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result || ''))
    fr.onerror = () => reject(new Error('Could not read that file.'))
    fr.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("That file isn't an image we can read."))
    img.src = src
  })
}

/**
 * One picked file → one PendingShot, downscaled.
 *
 * Throws with a sentence meant to be SHOWN: every caller renders the message
 * straight into the composer.
 */
export async function prepareShot(file: File): Promise<PendingShot> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name || 'That file'} isn't an image.`)
  const raw = await readAsDataUrl(file)
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const name = file.name || 'screenshot.png'

  if (passThrough(file)) {
    if (file.size > 5 * 1024 * 1024) throw new Error('That GIF is too big — 5MB max.')
    return { key, name, dataUrl: raw, bytes: file.size }
  }

  const img = await loadImage(raw)
  const scale = Math.min(1, SHOT_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight))
  if (scale === 1 && file.type === 'image/png' && file.size <= PNG_KEEP_BYTES) {
    return { key, name, dataUrl: raw, bytes: file.size }
  }

  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("Your browser wouldn't let us resize that image.")
  // A transparent PNG flattened onto a JPEG gets a BLACK mat by default. These
  // are screenshots of a dark UI, so the app's own canvas colour is the mat
  // that disappears — read off the token rather than typed, like everything
  // else. No token, no mat: black is a fine last resort and is what the encoder
  // would have done anyway, so there is nothing to hardcode here.
  const mat = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim()
  if (mat) {
    ctx.fillStyle = mat
    ctx.fillRect(0, 0, w, h)
  }
  ctx.drawImage(img, 0, 0, w, h)

  // 0.9 rather than the usual 0.8: this is a picture of TEXT, and ringing
  // around small glyphs is what makes a bug report unreadable.
  const out = canvas.toDataURL('image/jpeg', 0.9)
  const bytes = Math.round((out.length - out.indexOf(',') - 1) * 0.75)
  if (bytes > 5 * 1024 * 1024) throw new Error('That image is too big even after resizing.')
  return { key, name, dataUrl: out, bytes }
}

/** Prepare a batch, respecting how many slots are left. Throws on the first bad one. */
export async function prepareShots(files: File[], already: number): Promise<PendingShot[]> {
  const room = MAX_SHOTS - already
  if (room <= 0) throw new Error(`Up to ${MAX_SHOTS} images per message.`)
  const out: PendingShot[] = []
  for (const f of files.slice(0, room)) out.push(await prepareShot(f))
  return out
}

/** Image files out of a paste or a drop, or an empty array. */
export function imageFilesFrom(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return []
  const files: File[] = []
  for (const f of Array.from(dt.files ?? [])) {
    if (f.type.startsWith('image/')) files.push(f)
  }
  // A clipboard screenshot arrives as an ITEM rather than a file in some
  // browsers, and with no name — hence the fallback and the default above.
  if (!files.length) {
    for (const it of Array.from(dt.items ?? [])) {
      if (it.kind !== 'file' || !it.type.startsWith('image/')) continue
      const f = it.getAsFile()
      if (f) files.push(f)
    }
  }
  return files
}
