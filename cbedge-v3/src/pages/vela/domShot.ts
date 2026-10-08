// ─────────────────────────────────────────────────────────────────────────────
// A PICTURE OF THE CHARTS AS THEY LOOK ON SCREEN, overlays and all.
//
// 2026-10-07, Brandon: "vela screenshot missing gex rail and a few other
// things. it just shows the main chart." Vela's own screenshot composites only
// its chart canvases, so everything the page draws as HTML on top of them was
// missing: the GEX Rail, the legend cards (ticker, Volt / Coil / Reversal),
// lower panes' legends, the Voltick mark.
//
// 2026-10-08, Brandon (iPhone): "mobile screenshot messed up" — the legend and
// the mark sat in the top-left third of a white PNG and the chart was blank.
// Two WebKit facts, and every iPhone browser is WebKit:
//   1. an SVG drawn as an image does NOT apply its viewBox scale to
//      <foreignObject> content, so the overlay rendered at 1× inside a 3× PNG;
//   2. <img> pixels nested inside a <foreignObject> are not drawn at all, so
//      the chart (which went in as an <img>) came out empty.
// So the picture is now built in LAYERS on one canvas, and the SVG carries
// text and boxes only:
//
//   base     each chart's own screenshot (Vela's pixels: candles, studies, the
//            Path's beads), drawn straight onto the canvas at the chart's spot,
//            over the background colours of the boxes that hold it
//   overlay  the grid's HTML cloned and drawn through <foreignObject> with the
//            page's own stylesheets: legends, the rail, the mark. Scaled to the
//            screen's density by a CSS transform INSIDE the foreignObject (which
//            WebKit honours), not by the viewBox (which it ignores). Every canvas
//            and <img> in the clone is kept for layout but hidden, and the boxes
//            that hold a chart lose their background so it cannot paint over it.
//   top      every other canvas and every <img> (ticker icons, logos), drawn
//            straight onto the canvas where it sits on screen, clipped to its
//            scrolling/overflow box, with its opacity and rounded corners
//
// Selectors still match because the clone is wrapped in empty copies of its
// ancestors (same tags, classes, attributes); the root's custom properties (the
// theme tokens) ride on the outermost copy; @font-face sources are inlined as
// data URLs since an SVG image may load nothing. Everything is same-origin, so
// the canvas stays exportable. Nothing here imports Vela.
// ─────────────────────────────────────────────────────────────────────────────

const toDataUrl = (blob: Blob): Promise<string | null> =>
  new Promise((ok) => {
    const fr = new FileReader()
    fr.onload = () => ok(typeof fr.result === 'string' ? fr.result : null)
    fr.onerror = () => ok(null)
    fr.readAsDataURL(blob)
  })

/** Font files as data URLs, by absolute URL: fetched once a visit. */
const fontCache = new Map<string, Promise<string | null>>()
function fontData(url: string): Promise<string | null> {
  let p = fontCache.get(url)
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? toDataUrl(b) : null))
      .catch(() => null)
    fontCache.set(url, p)
  }
  return p
}

/** Every same-origin CSS rule on the page, its @font-face sources inlined. */
async function pageCss(): Promise<string> {
  const parts: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue // a cross-origin sheet: its rules cannot be read
    }
    for (const rule of Array.from(rules)) {
      let text = rule.cssText
      if (rule instanceof CSSFontFaceRule) {
        for (const m of Array.from(text.matchAll(/url\(["']?([^"')]+)["']?\)/g))) {
          const u = m[1]!
          if (u.startsWith('data:')) continue
          const data = await fontData(new URL(u, sheet.href ?? location.href).href)
          if (data) text = text.split(u).join(data)
        }
      }
      parts.push(text)
    }
  }
  return parts.join('\n')
}

export interface DomShotOptions {
  /** Leave this element (and what is inside it) out: toasts, menus. */
  skip?: (el: Element) => boolean
  /**
   * A canvas's stand-in: an image URL drawn in its place (a chart's own
   * screenshot — drawn UNDER the HTML), `null` to drop it. Absent, the canvas's
   * own pixels are used (2D canvases only), drawn over the HTML where it sits.
   */
  canvas?: (c: HTMLCanvasElement) => string | null | undefined
}

interface Box { x: number; y: number; w: number; h: number }

/** A thing drawn straight onto the output, in root-relative CSS px. */
interface Paint {
  src: string | HTMLCanvasElement
  box: Box
  clip: Box
  alpha: number
  radius: number
  fit: string
  natural?: { w: number; h: number }
}

const transparent = (c: string) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c.replace(/\s+/g, ' '))

function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = () => ok(null)
    img.src = src
  })
}

/** `root` as it looks on screen, as a PNG Blob at the screen's pixel density. */
export async function domShot(root: HTMLElement, opts: DomShotOptions = {}): Promise<Blob> {
  const rect = root.getBoundingClientRect()
  const W = Math.max(1, Math.round(rect.width))
  const H = Math.max(1, Math.round(rect.height))
  const dpr = Math.min(3, window.devicePixelRatio || 1)
  const cssP = pageCss()
  const rootBox: Box = { x: 0, y: 0, w: W, h: H }
  const rel = (r: DOMRect): Box => ({ x: r.left - rect.left, y: r.top - rect.top, w: r.width, h: r.height })

  /** The visible part of `el`: clipped by every overflow box between it and root. */
  const clipOf = (el: Element): Box => {
    let c = rootBox
    for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') c = intersect(c, rel(a.getBoundingClientRect()))
    }
    return c
  }
  /** Its opacity as drawn: its own times every ancestor's up to root. */
  const alphaOf = (el: Element): number => {
    let a = 1
    for (let e: Element | null = el; e && e !== root.parentElement; e = e.parentElement) a *= Number(getComputedStyle(e).opacity) || 0
    return a
  }
  const shown = (el: Element, r: DOMRect) => r.width > 0.5 && r.height > 0.5 && getComputedStyle(el).visibility !== 'hidden'

  // ── walk the live tree and its clone together ──
  const clone = root.cloneNode(true) as HTMLElement
  const src = [root, ...Array.from(root.querySelectorAll('*'))]
  const dst = [clone, ...Array.from(clone.querySelectorAll('*'))]
  const base: Paint[] = []
  const top: Paint[] = []
  const holders = new Set<Element>() // the live boxes that hold a chart picture
  let skipped: Element | null = null
  for (let i = 0; i < src.length; i++) {
    const s = src[i]!
    const d = dst[i]!
    if (skipped && skipped.contains(s)) continue
    if (s !== root && opts.skip?.(s)) {
      skipped = s
      d.remove()
      continue
    }
    const isCanvas = s instanceof HTMLCanvasElement
    const isImg = s instanceof HTMLImageElement
    if (!isCanvas && !isImg) continue

    // the clone keeps the element for layout, sized as on screen, but paints nothing
    const r = s.getBoundingClientRect()
    const dh = d as HTMLElement
    dh.style.width = `${r.width}px`
    dh.style.height = `${r.height}px`
    dh.style.visibility = 'hidden'
    if (isImg) {
      dh.removeAttribute('src')
      dh.removeAttribute('srcset')
    }
    if (!shown(s, r)) continue
    const cs = getComputedStyle(s)
    const rad = cs.borderTopLeftRadius
    const radius = rad.endsWith('%') ? (Math.min(r.width, r.height) * parseFloat(rad)) / 100 : parseFloat(rad) || 0
    const paint = (p: string | HTMLCanvasElement, natural?: { w: number; h: number }): Paint => ({
      src: p,
      box: rel(r),
      clip: clipOf(s),
      alpha: alphaOf(s),
      radius,
      fit: cs.objectFit || 'fill',
      natural,
    })

    if (isCanvas) {
      const stand = opts.canvas?.(s)
      if (stand === null) continue // already inside a chart's picture
      if (typeof stand === 'string') {
        base.push(paint(stand))
        for (let a = s.parentElement; a; a = a.parentElement) {
          holders.add(a)
          if (a === root) break
        }
        continue
      }
      top.push(paint(s))
      continue
    }
    const img = s as HTMLImageElement
    if (img.complete && img.naturalWidth > 0) top.push(paint(img.currentSrc || img.src, { w: img.naturalWidth, h: img.naturalHeight }))
  }

  // the boxes behind a chart: their background is painted here, under the chart,
  // and taken off the clone so the overlay cannot paint it over the candles
  const under: Array<{ box: Box; clip: Box; color: string }> = []
  for (let i = 0; i < src.length; i++) {
    const s = src[i]!
    if (!holders.has(s)) continue
    const color = getComputedStyle(s).backgroundColor
    if (!transparent(color)) under.push({ box: s === root ? rootBox : rel(s.getBoundingClientRect()), clip: s === root ? rootBox : clipOf(s), color })
    const d = dst[i] as HTMLElement
    d.style.setProperty('background', 'transparent', 'important')
  }

  clone.style.position = 'relative'
  clone.style.left = '0'
  clone.style.top = '0'
  clone.style.width = `${W}px`
  clone.style.height = `${H}px`
  clone.style.margin = '0'

  // empty copies of the ancestors, so descendant selectors still match
  let outer: HTMLElement = clone
  for (let a = root.parentElement; a; a = a.parentElement) {
    const isTop = a === document.documentElement || a === document.body
    const shell = document.createElement(isTop ? 'div' : a.localName)
    for (const at of Array.from(a.attributes)) {
      if (at.name !== 'style' && at.name !== 'id') shell.setAttribute(at.name, at.value)
    }
    shell.style.cssText = `display:block;position:relative;width:${W}px;height:${H}px;margin:0;padding:0;border:0;overflow:hidden;transform:none;background:transparent;`
    shell.appendChild(outer)
    outer = shell
  }
  // the theme tokens and the body's type on the outermost copy, which is also
  // where the density scale lives (see the header: WebKit ignores the viewBox)
  const rcs = getComputedStyle(document.documentElement)
  const bcs = getComputedStyle(document.body)
  let vars = ''
  for (let i = 0; i < rcs.length; i++) {
    const p = rcs[i]!
    if (p.startsWith('--')) vars += `${p}:${rcs.getPropertyValue(p)};`
  }
  outer.setAttribute(
    'style',
    `${outer.getAttribute('style') ?? ''}${vars}font-family:${bcs.fontFamily};color:${bcs.color};font-size:${bcs.fontSize};line-height:${bcs.lineHeight};-webkit-font-smoothing:antialiased;` +
      `transform:scale(${dpr});transform-origin:0 0;`,
  )

  // ── the canvas ──
  const out = document.createElement('canvas')
  out.width = Math.round(W * dpr)
  out.height = Math.round(H * dpr)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('no 2d context')

  // the page behind it all: root's background, or the first one up the tree
  let bg = ''
  for (let e: Element | null = root; e && transparent(bg); e = e.parentElement) bg = getComputedStyle(e).backgroundColor
  // (nothing opaque anywhere up the tree: the PNG keeps a transparent background)
  if (transparent(bg)) bg = bcs.backgroundColor
  if (!transparent(bg)) {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, out.width, out.height)
  }

  const draw = async (p: Paint) => {
    const c = intersect(p.box, p.clip)
    if (c.w <= 0 || c.h <= 0 || p.alpha <= 0) return
    const im = typeof p.src === 'string' ? await loadImage(p.src) : p.src
    if (!im) return
    const nw = p.natural?.w ?? (im instanceof HTMLImageElement ? im.naturalWidth : im.width)
    const nh = p.natural?.h ?? (im instanceof HTMLImageElement ? im.naturalHeight : im.height)
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalAlpha = Math.min(1, p.alpha)
    ctx.beginPath()
    ctx.rect(c.x, c.y, c.w, c.h)
    ctx.clip()
    const { x, y, w, h } = p.box
    if (p.radius > 0) {
      const rr = Math.min(p.radius, w / 2, h / 2)
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, rr)
      else ctx.rect(x, y, w, h)
      ctx.clip()
    }
    if ((p.fit === 'cover' || p.fit === 'contain') && nw > 0 && nh > 0) {
      const s = p.fit === 'cover' ? Math.max(w / nw, h / nh) : Math.min(w / nw, h / nh)
      const dw = nw * s
      const dh = nh * s
      ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
    } else {
      ctx.drawImage(im, x, y, w, h)
    }
    ctx.restore()
  }

  // base: the backgrounds behind each chart, then the charts
  for (const u of under) {
    const c = intersect(u.box, u.clip)
    if (c.w <= 0 || c.h <= 0) continue
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = u.color
    ctx.fillRect(c.x, c.y, c.w, c.h)
    ctx.restore()
  }
  for (const p of base) await draw(p)

  // overlay: the HTML, already at the screen's density
  const css = (await cssP).split(']]>').join(']] >')
  const xml = new XMLSerializer().serializeToString(outer)
  const OW = out.width
  const OH = out.height
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OW}" height="${OH}">` +
    `<foreignObject x="0" y="0" width="${OW}" height="${OH}">` +
    `<style xmlns="http://www.w3.org/1999/xhtml"><![CDATA[${css}]]></style>${xml}` +
    `</foreignObject></svg>`
  // a data: URL, not a blob: one — Chrome taints a canvas drawn from a blob: SVG
  const ov = new Image()
  ov.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  try {
    await ov.decode()
  } catch {
    await new Promise<void>((ok) => {
      if (ov.complete) ok()
      else ov.onload = ov.onerror = () => ok()
    })
  }
  if (ov.naturalWidth > 0) ctx.drawImage(ov, 0, 0, OW, OH)

  // top: the other canvases and the images, where they sit
  for (const p of top) await draw(p)

  return new Promise((ok, fail) => out.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob failed'))), 'image/png'))
}
