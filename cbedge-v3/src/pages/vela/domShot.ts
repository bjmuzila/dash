// ─────────────────────────────────────────────────────────────────────────────
// A PICTURE OF THE CHARTS AS THEY LOOK ON SCREEN, overlays and all.
//
// 2026-10-07, Brandon: "vela screenshot missing gex rail and a few other
// things. it just shows the main chart." Vela's own screenshot composites only
// its chart canvases, so everything the page draws as HTML on top of them was
// missing: the GEX Rail, the legend cards (ticker, Volt / Coil / Reversal),
// lower panes' legends, the Voltick mark.
//
// This takes the whole chart grid instead. The grid's HTML is cloned with each
// chart's canvas stack swapped for that chart's own screenshot (Vela's pixels,
// candles, studies and the Path's beads included), then the clone is drawn
// through an SVG <foreignObject> with the page's own stylesheets, so every
// overlay lands where it sits on screen, at the screen's pixel density:
//
//   · the page's CSS rules go in as text (fonts inlined as data URLs, since an
//     SVG image may not load anything), and the grid is wrapped in empty copies
//     of its ancestors (same tags, classes and attributes) so selectors like
//     `.vela-workspace .cb-lc …` still match
//   · the root's custom properties (the theme tokens) ride on the outermost copy
//   · <img> elements are inlined as data URLs; scroll offsets are not kept
//
// Takes about 0.1 s. Everything is same-origin, so the canvas it is drawn on
// stays exportable. Nothing here imports Vela.
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
   * A canvas's stand-in: an image URL drawn in its place, `null` to drop it.
   * Absent, the canvas's own pixels are used (2D canvases only).
   */
  canvas?: (c: HTMLCanvasElement) => string | null | undefined
}

/** `root` as it looks on screen, as a PNG Blob at the screen's pixel density. */
export async function domShot(root: HTMLElement, opts: DomShotOptions = {}): Promise<Blob> {
  const rect = root.getBoundingClientRect()
  const W = Math.max(1, Math.round(rect.width))
  const H = Math.max(1, Math.round(rect.height))
  const dpr = window.devicePixelRatio || 1
  const cssP = pageCss()

  // the clone: canvases swapped, images inlined
  const clone = root.cloneNode(true) as HTMLElement
  const src = [root, ...Array.from(root.querySelectorAll('*'))]
  const dst = [clone, ...Array.from(clone.querySelectorAll('*'))]
  const pending: Array<Promise<void>> = []
  for (let i = 0; i < src.length; i++) {
    const s = src[i]!
    const d = dst[i]!
    if (s !== root && opts.skip?.(s)) {
      d.remove()
      continue
    }
    if (s instanceof HTMLCanvasElement) {
      let url: string | null | undefined = opts.canvas?.(s)
      if (url === undefined) {
        try {
          url = s.toDataURL()
        } catch {
          url = null
        }
      }
      if (url == null) {
        d.remove()
        continue
      }
      const img = document.createElement('img')
      img.setAttribute('style', s.getAttribute('style') ?? '')
      img.className = s.className
      const r = s.getBoundingClientRect()
      img.style.width = `${r.width}px`
      img.style.height = `${r.height}px`
      img.src = url
      d.replaceWith(img)
      continue
    }
    if (s instanceof HTMLImageElement && s.currentSrc && !s.currentSrc.startsWith('data:')) {
      const el = d as HTMLImageElement
      pending.push(
        fetch(s.currentSrc)
          .then((r) => (r.ok ? r.blob() : null))
          .then((b) => (b ? toDataUrl(b) : null))
          .then((u) => {
            if (u) el.setAttribute('src', u)
            else el.removeAttribute('src')
          })
          .catch(() => el.removeAttribute('src')),
      )
      el.removeAttribute('srcset')
    }
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
    const top = a === document.documentElement || a === document.body
    const shell = document.createElement(top ? 'div' : a.localName)
    for (const at of Array.from(a.attributes)) {
      if (at.name !== 'style' && at.name !== 'id') shell.setAttribute(at.name, at.value)
    }
    shell.style.cssText = `display:block;position:relative;width:${W}px;height:${H}px;margin:0;padding:0;border:0;overflow:hidden;transform:none;`
    shell.appendChild(outer)
    outer = shell
  }
  // the theme tokens and the body's type, on the outermost copy
  const rcs = getComputedStyle(document.documentElement)
  const bcs = getComputedStyle(document.body)
  let vars = ''
  for (let i = 0; i < rcs.length; i++) {
    const p = rcs[i]!
    if (p.startsWith('--')) vars += `${p}:${rcs.getPropertyValue(p)};`
  }
  outer.setAttribute(
    'style',
    `${outer.getAttribute('style') ?? ''}${vars}font-family:${bcs.fontFamily};color:${bcs.color};font-size:${bcs.fontSize};line-height:${bcs.lineHeight};background:${bcs.backgroundColor};-webkit-font-smoothing:antialiased;`,
  )

  await Promise.all(pending)
  const css = (await cssP).split(']]>').join(']] >')
  const xml = new XMLSerializer().serializeToString(outer)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W * dpr}" height="${H * dpr}" viewBox="0 0 ${W} ${H}">` +
    `<foreignObject x="0" y="0" width="${W}" height="${H}">` +
    `<style xmlns="http://www.w3.org/1999/xhtml"><![CDATA[${css}]]></style>${xml}` +
    `</foreignObject></svg>`
  // a data: URL, not a blob: one — Chrome taints a canvas drawn from a blob: SVG
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()
  const out = document.createElement('canvas')
  out.width = Math.round(W * dpr)
  out.height = Math.round(H * dpr)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(img, 0, 0, out.width, out.height)
  return new Promise((ok, fail) => out.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob failed'))), 'image/png'))
}
