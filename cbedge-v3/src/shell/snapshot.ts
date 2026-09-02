// ─────────────────────────────────────────────────────────────────────────────
// COPYSHOT — v3's capture engine. A DOM subtree in, a framed PNG on the
// clipboard out.
//
// ── Why this is not html2canvas ──────────────────────────────────────────────
// v2 captures with html2canvas (`lib/snapshot.ts`), and the obvious move was to
// add the same dependency here. It does not work, for a reason specific to v3
// rather than a matter of taste: html2canvas re-implements CSS colour parsing,
// and its parser knows hex and the plain rgb / hsl forms only. Every wash, edge
// and ring in this app is an `alpha()` call, which is `color-mix()` — see
// design/theme.ts, where that is the SANCTIONED way to get a token at an
// opacity — and Chrome resolves those to the `color(srgb …)` form. html2canvas
// throws on the first one it meets, and no amount of writing the app carefully
// avoids them without giving up the token bridge. It would also cost ~45KB
// brotli of route budget for a button one person presses a few times a day.
//
// So the browser does the rendering instead. The subtree is cloned, every
// computed style is pinned onto the clone, the clone is serialised into an
// `<svg><foreignObject>` and drawn to a canvas through an `Image`. Whatever CSS
// Chrome can paint, this can photograph — `color-mix`, container queries, all
// of it — because Chrome is the one painting. No dependency, no budget line.
//
// ── What it cannot do ────────────────────────────────────────────────────────
// Known and accepted, because the alternative was nothing at all:
//
//   · PSEUDO-ELEMENTS (`::before` / `::after`) are not cloned. Nothing on the
//     board draws content with them today; a decorative rule or dot would go
//     missing rather than break the shot.
//   · SCROLLED CONTENT photographs from its own top. A capture is of the box,
//     not of the scroll position inside it.
//   · CROSS-ORIGIN images are dropped. An `<svg>` image whose subresources are
//     unreachable fails to load AT ALL — silently — so a picture that cannot be
//     inlined has to go rather than take the whole capture down with it.
//   · A card scrolled out of view has not painted (non-negotiable 5), so its
//     canvases photograph blank. That is the visibility gate working, not the
//     capture failing.
//
// ── The contract with the page ───────────────────────────────────────────────
// An element carrying `data-capture-hide` is removed from the clone. Use it on
// the control that STARTS a capture, so a button is never in its own PNG.
// ─────────────────────────────────────────────────────────────────────────────

import { tokenHex } from '@/design/theme'

/** What actually happened to the PNG. The clipboard is not always available. */
export type ShotResult = 'copied' | 'saved'

export interface ShotOptions {
  /** Printed in the frame's title band. Usually the card's own name. */
  title?: string
  /** Download name, used only when the clipboard write is refused. */
  filename?: string
}

/** Elements the page wants out of the picture — see the header. */
const HIDE_ATTR = 'data-capture-hide'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Frame geometry, in CSS pixels before the device-ratio multiply. */
const PAD = 18
const BAND_H = 40
const FOOT_H = 22

/**
 * Type sizes off `tokens.css`'s scale — 15 (`text-base`), 11 (`text-xs`),
 * 10 (`text-2xs`). A canvas cannot wear a class, so it reads the same numbers
 * the utilities are built from rather than inventing new ones.
 */
const TITLE_PX = 15
const META_PX = 11
const MARK_PX = 10

const WATERMARK = 'Data provided by CBEdge.net'

/**
 * Cap the multiply at 2. A full board at devicePixelRatio 3 is a bitmap Chrome
 * refuses to put on the clipboard, and nobody can tell 2× from 3× in a Discord
 * embed.
 */
function shotScale(): number {
  return Math.min(2, Math.max(1, window.devicePixelRatio || 1))
}

// ── Which declarations actually have to travel ───────────────────────────────
//
// The clone is rendered inside an `<svg>` image, which is its own document: it
// cannot see the page's stylesheets, so a class name means nothing there and
// every value has to be pinned on as an inline declaration.
//
// Naively that is ~340 properties on every node — a mid-sized card serialises
// to several megabytes of `style="…"`, which is slow to build, slow to encode
// and slow for Chrome to parse back. Almost all of it is redundant, and there
// are exactly two ways a declaration can be redundant:
//
//   · it is INHERITED and matches the parent — the clone's parent carries it,
//     so the child gets the same value for free;
//   · it is at the UA DEFAULT for its tag — the SVG document runs the same UA
//     stylesheet, so leaving it out lands on the same value.
//
// Getting that wrong is a wrong-looking picture, so the test is conservative:
// a property listed in INHERITED is dropped when it matches the parent, and
// EVERY OTHER property must match the parent AND the tag default before it is
// dropped. Either way the value the clone ends up with is the value that was
// measured — by inheritance or by default — never a guess.

/**
 * Properties CSS inherits, spelled out rather than detected.
 *
 * Only entries that are certain are here. A property wrongly listed would be
 * dropped on a child whose parent differs, which paints the wrong thing; a
 * property wrongly MISSING just falls through to the stricter test above and
 * costs a few bytes. The asymmetry is the reason this is a short list of sure
 * things rather than a long list of likely ones.
 */
const INHERITED = new Set([
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-stretch',
  'font-kerning',
  'font-feature-settings',
  'font-variation-settings',
  'font-variant',
  'font-variant-caps',
  'font-variant-numeric',
  'font-variant-ligatures',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-indent',
  'text-transform',
  'text-shadow',
  'text-rendering',
  'white-space',
  'white-space-collapse',
  'word-break',
  'overflow-wrap',
  'hyphens',
  'tab-size',
  'direction',
  'visibility',
  'cursor',
  'caret-color',
  'pointer-events',
  'image-rendering',
  'user-select',
  '-webkit-user-select',
  '-webkit-font-smoothing',
  'list-style-type',
  'list-style-position',
  'list-style-image',
  'border-collapse',
  'border-spacing',
  'caption-side',
  'empty-cells',
  'quotes',
  'orphans',
  'widows',
  // SVG's inherited presentation properties. The sector wheel is hundreds of
  // arcs that all take their fill and stroke from one ancestor.
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'text-anchor',
  'dominant-baseline',
  'paint-order',
  'shape-rendering',
  'clip-rule',
  'color-interpolation',
  'color-interpolation-filters',
  'marker-start',
  'marker-mid',
  'marker-end',
])

/**
 * The UA's computed style for a bare element of each tag, read from a sandbox
 * document with no stylesheets — which is exactly the environment the clone is
 * about to be rendered in.
 *
 * Lives for one capture and is torn down in a `finally`.
 */
class TagDefaults {
  private frame: HTMLIFrameElement | null = null
  private doc: Document | null = null
  private svgHost: SVGSVGElement | null = null
  private cache = new Map<string, Map<string, string>>()

  private ensure(): Document | null {
    if (this.doc) return this.doc
    const f = document.createElement('iframe')
    f.setAttribute('aria-hidden', 'true')
    f.setAttribute('tabindex', '-1')
    f.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0;border:0;visibility:hidden'
    document.body.appendChild(f)
    this.frame = f
    this.doc = f.contentDocument
    return this.doc
  }

  /** Empty map when the sandbox is unavailable — the caller then keeps everything. */
  for(el: Element): Map<string, string> {
    const svg = el.namespaceURI === SVG_NS
    const tag = el.tagName.toLowerCase()
    const key = svg ? `svg:${tag}` : tag
    const hit = this.cache.get(key)
    if (hit) return hit

    const out = new Map<string, string>()
    const doc = this.ensure()
    const view = doc?.defaultView
    if (doc?.body && view) {
      try {
        let probe: Element
        if (svg) {
          let host = this.svgHost
          if (!host) {
            host = doc.createElementNS(SVG_NS, 'svg')
            doc.body.appendChild(host)
            this.svgHost = host
          }
          probe = doc.createElementNS(SVG_NS, tag)
          host.appendChild(probe)
        } else {
          probe = doc.createElement(tag)
          doc.body.appendChild(probe)
        }
        const cs = view.getComputedStyle(probe)
        for (let i = 0; i < cs.length; i++) {
          const prop = cs.item(i)
          if (prop) out.set(prop, cs.getPropertyValue(prop))
        }
        probe.remove()
      } catch {
        /* an exotic tag; keeping every declaration for it is only wasteful */
      }
    }
    this.cache.set(key, out)
    return out
  }

  dispose(): void {
    this.frame?.remove()
    this.frame = null
    this.doc = null
    this.svgHost = null
    this.cache.clear()
  }
}

// ── Cloning ──────────────────────────────────────────────────────────────────

/** Pin one element's computed style onto its clone. See the block above. */
function applyStyle(
  src: Element,
  dst: Element,
  cs: CSSStyleDeclaration,
  parentCs: CSSStyleDeclaration | null,
  defaults: TagDefaults,
): void {
  const style = (dst as HTMLElement).style
  if (!style) return

  // The root has no parent inside the capture, so nothing about it can be left
  // to inheritance and every declaration is written.
  const defs = parentCs ? defaults.for(src) : null

  for (let i = 0; i < cs.length; i++) {
    const prop = cs.item(i)
    if (!prop) continue
    const v = cs.getPropertyValue(prop)

    if (parentCs) {
      const inherited = prop.startsWith('--') || INHERITED.has(prop)
      const sameAsParent = parentCs.getPropertyValue(prop) === v
      if (inherited ? sameAsParent : sameAsParent && defs?.get(prop) === v) continue
    }

    style.setProperty(prop, v, cs.getPropertyPriority(prop))
  }

  // A background pointing at a URL we cannot inline. An unresolvable reference
  // inside the SVG does not degrade — it fails the whole image load, silently —
  // so anything that is not already a data: URI is dropped here.
  const bg = cs.getPropertyValue('background-image')
  if (bg.includes('url(') && !bg.includes('url("data:') && !bg.includes('url(data:')) {
    style.setProperty('background-image', 'none')
  }

  // ── Box pinning ────────────────────────────────────────────────────────────
  // `getComputedStyle().width` is the CONTENT width, whatever `box-sizing`
  // says. Copying that value verbatim alongside a copied `box-sizing:
  // border-box` shrinks the clone by its own padding and border — every card
  // came back narrower per nesting level, compounding down the tree. So the box
  // is restated from the measured border box, which is the one number that
  // cannot disagree with what is on screen.
  //
  // Skipped for inline boxes (width does not apply, and text must re-flow),
  // for transformed ones (`getBoundingClientRect` already has the transform
  // baked in and the copied `transform` would apply it a second time), and for
  // SVG, whose geometry travels in attributes the clone already carries.
  if (dst instanceof HTMLElement && cs.display !== 'inline' && cs.transform === 'none') {
    const r = src.getBoundingClientRect()
    style.setProperty('box-sizing', 'border-box')
    style.setProperty('width', `${r.width}px`)
    style.setProperty('height', `${r.height}px`)
  }
}

/**
 * Style the whole tree, top down.
 *
 * Recursive rather than a flat walk because every node needs its PARENT's
 * computed style to decide what it can leave out, and the parent's is already
 * in hand one frame up the stack.
 */
function styleTree(
  src: Element,
  dst: Element,
  parentCs: CSSStyleDeclaration | null,
  defaults: TagDefaults,
): void {
  const cs = getComputedStyle(src)
  applyStyle(src, dst, cs, parentCs, defaults)
  const a = src.children
  const b = dst.children
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const sc = a[i]
    const dc = b[i]
    if (sc && dc) styleTree(sc, dc, cs, defaults)
  }
}

/**
 * Every (source, clone) element pair, in document order.
 *
 * Collected BEFORE anything is mutated: the clone is about to have nodes
 * removed and canvases swapped out, and a walk over a tree changing underneath
 * it loses its place. `cloneNode(true)` guarantees the two trees are
 * structurally identical at this moment, which is what makes the index-wise
 * descent sound.
 */
function pairUp(src: Element, dst: Element, out: Array<[Element, Element]>): void {
  out.push([src, dst])
  const a = src.children
  const b = dst.children
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const sc = a[i]
    const dc = b[i]
    if (sc && dc) pairUp(sc, dc, out)
  }
}

/** A canvas's bitmap as an `<img>`, or null when the canvas cannot be read. */
function canvasToImg(src: HTMLCanvasElement, dst: Element): HTMLImageElement | null {
  let url: string
  try {
    url = src.toDataURL('image/png')
  } catch {
    return null // tainted by a cross-origin draw; there is nothing to photograph
  }
  const img = document.createElement('img')
  img.setAttribute('style', dst.getAttribute('style') ?? '')
  const r = src.getBoundingClientRect()
  img.setAttribute('width', String(Math.round(r.width)))
  img.setAttribute('height', String(Math.round(r.height)))
  img.setAttribute('src', url)
  return img
}

/** Re-encode a same-origin `<img>` as a data URI. Null when it cannot be read. */
function imgToDataUrl(src: HTMLImageElement): string | null {
  if (src.currentSrc.startsWith('data:')) return src.currentSrc
  const w = src.naturalWidth
  const h = src.naturalHeight
  if (!w || !h || !src.complete) return null
  try {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(src, 0, 0)
    return c.toDataURL('image/png')
  } catch {
    return null // cross-origin, so the canvas is tainted
  }
}

/**
 * A detached, self-contained copy of `el`, sized to its border box.
 *
 * Everything the SVG document cannot reach back into the page for — styles,
 * canvas bitmaps, image bytes, live form values — is materialised here.
 */
function buildClone(el: HTMLElement, w: number, h: number): HTMLElement {
  const clone = el.cloneNode(true) as HTMLElement
  const defaults = new TagDefaults()

  try {
    // Styles first: this measures the LIVE element, so it has to run while the
    // two trees still line up and before anything is pulled out of the clone.
    styleTree(el, clone, null, defaults)
  } finally {
    defaults.dispose()
  }

  const pairs: Array<[Element, Element]> = []
  pairUp(el, clone, pairs)

  for (const [src, dst] of pairs) {
    // A descendant of something already removed. Its own turn is a no-op.
    if (dst !== clone && !clone.contains(dst)) continue

    if (src.hasAttribute(HIDE_ATTR)) {
      dst.remove()
      continue
    }
    if (src instanceof HTMLScriptElement || src instanceof HTMLIFrameElement) {
      dst.remove()
      continue
    }
    if (src instanceof HTMLCanvasElement) {
      const img = canvasToImg(src, dst)
      if (img) dst.replaceWith(img)
      else dst.remove()
      continue
    }
    if (src instanceof HTMLImageElement) {
      const url = imgToDataUrl(src)
      // An image that cannot be inlined has to go: an unresolvable reference
      // fails the whole SVG load, not just itself.
      if (url) dst.setAttribute('src', url)
      else dst.remove()
      continue
    }
    // `cloneNode` copies the ATTRIBUTE, which is not the live value.
    if (src instanceof HTMLInputElement && dst instanceof HTMLInputElement) {
      dst.setAttribute('value', src.value)
      if (src.checked) dst.setAttribute('checked', '')
    }
    if (src instanceof HTMLTextAreaElement) dst.textContent = src.value
  }

  // The root sheds whatever was positioning it on the page — it is the whole
  // picture now, at 0,0.
  clone.style.setProperty('box-sizing', 'border-box')
  clone.style.setProperty('width', `${w}px`)
  clone.style.setProperty('height', `${h}px`)
  clone.style.setProperty('margin', '0')
  clone.style.setProperty('position', 'static')
  clone.style.setProperty('inset', 'auto')
  clone.style.setProperty('transform', 'none')
  clone.style.setProperty('max-width', 'none')
  clone.style.setProperty('max-height', 'none')

  return clone
}

// ── Rasterising ──────────────────────────────────────────────────────────────

/** The subtree, rendered by the browser itself, at `shotScale()`. */
async function rasterise(el: HTMLElement): Promise<HTMLCanvasElement> {
  const rect = el.getBoundingClientRect()
  const w = Math.max(1, Math.ceil(rect.width))
  const h = Math.max(1, Math.ceil(rect.height))

  // Text inside the SVG document is measured against the same faces the page is
  // using — but only once they have actually loaded.
  await document.fonts?.ready?.catch(() => undefined)

  const clone = buildClone(el, w, h)
  const body = new XMLSerializer().serializeToString(clone)
  const svg =
    `<svg xmlns="${SVG_NS}" width="${w}" height="${h}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${body}</foreignObject>` +
    `</svg>`

  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () =>
      reject(new Error('the browser refused the serialised page — usually an asset it could not reach'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })

  const scale = shotScale()
  const out = document.createElement('canvas')
  out.width = Math.round(w * scale)
  out.height = Math.round(h * scale)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(img, 0, 0, out.width, out.height)
  return out
}

/**
 * The shot, matted on the app's own background with a title band and the
 * watermark — the framing v2's `captureToCanvas({framed:true})` produces, so a
 * v2 snapshot and a v3 one look like they came from the same product.
 */
function frame(shot: HTMLCanvasElement, title: string): HTMLCanvasElement {
  const scale = shotScale()
  const innerW = shot.width / scale
  const innerH = shot.height / scale
  const w = innerW + PAD * 2
  const h = innerH + BAND_H + FOOT_H + PAD * 2

  const out = document.createElement('canvas')
  out.width = Math.round(w * scale)
  out.height = Math.round(h * scale)
  const ctx = out.getContext('2d')
  if (!ctx) return shot
  ctx.scale(scale, scale)

  const face = getComputedStyle(document.body).fontFamily

  ctx.fillStyle = tokenHex('--color-bg')
  ctx.fillRect(0, 0, w, h)

  ctx.textBaseline = 'middle'
  const bandMid = PAD + BAND_H / 2 - 2

  // The stamp is drawn and measured first so the title can be given the space
  // that is actually left — a long card name is squeezed to fit rather than
  // drawn straight through the time.
  const stamp = `${new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })} ET`
  ctx.font = `500 ${META_PX}px ${face}`
  ctx.fillStyle = tokenHex('--color-muted')
  ctx.textAlign = 'right'
  ctx.fillText(stamp, w - PAD, bandMid)
  const stampW = ctx.measureText(stamp).width

  ctx.textAlign = 'left'
  ctx.fillStyle = tokenHex('--color-fg')
  ctx.font = `600 ${TITLE_PX}px ${face}`
  ctx.fillText(title, PAD, bandMid, Math.max(40, w - PAD * 2 - stampW - 12))

  ctx.strokeStyle = tokenHex('--color-line')
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, PAD + BAND_H - 0.5)
  ctx.lineTo(w - PAD, PAD + BAND_H - 0.5)
  ctx.stroke()

  ctx.drawImage(shot, PAD, PAD + BAND_H, innerW, innerH)

  ctx.font = `500 ${MARK_PX}px ${face}`
  ctx.fillStyle = tokenHex('--color-faint')
  ctx.textAlign = 'center'
  ctx.fillText(WATERMARK, w / 2, PAD + BAND_H + innerH + FOOT_H / 2 + 2)

  return out
}

// ── Delivery ─────────────────────────────────────────────────────────────────

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png')
  })
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Clipboard first, a download second.
 *
 * The clipboard is the point — the shot is going into Discord or a DM, and a
 * file in ~/Downloads is two more steps. But `navigator.clipboard.write` is
 * refused on an insecure origin, in a background tab, and whenever the browser
 * decides the user gesture has gone stale, and none of those are worth losing
 * the capture over.
 */
export async function copyOrDownload(blob: Blob, filename: string): Promise<ShotResult> {
  try {
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      return 'copied'
    }
  } catch {
    /* fall through to the download */
  }
  download(blob, filename)
  return 'saved'
}

/** Photograph `el`, frame it, and put it on the clipboard. */
export async function captureAndCopy(el: HTMLElement, opts: ShotOptions = {}): Promise<ShotResult> {
  const shot = await rasterise(el)
  const blob = await toBlob(frame(shot, opts.title ?? 'CB Edge'))
  return copyOrDownload(blob, opts.filename ?? 'snapshot.png')
}
