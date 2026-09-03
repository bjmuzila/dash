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
//   · CROSS-ORIGIN images are dropped. An `<svg>` image whose subresources are
//     unreachable fails to load AT ALL — silently — so a picture that cannot be
//     inlined has to go rather than take the whole capture down with it.
//   · A card scrolled out of view has not painted (non-negotiable 5), so its
//     canvases photograph blank. That is the visibility gate working, not the
//     capture failing.
//   · A GRID that is scrolled shifts by transforming its children, which loses
//     any transform they had of their own. Nothing on the board does this; the
//     scrollers that matter are the flex and block ones. See carryScroll.
//
// ── The contract with the page ───────────────────────────────────────────────
// Two attributes, both optional:
//   · `data-capture-hide` — the element is removed from the clone. Use it on the
//     control that STARTS a capture, so a button is never in its own PNG.
//   · `data-capture-meta` — the card's own words for the caption strip, after
//     the name and the time. The contract date, the ticker, the basis.
// ─────────────────────────────────────────────────────────────────────────────

import { tokenHex, tokenHexAlpha } from '@/design/theme'

/** What actually happened to the PNG. The clipboard is not always available. */
export type ShotResult = 'copied' | 'saved'

export interface ShotOptions {
  /** Leads the caption strip. Usually the card's own name. */
  title?: string
  /**
   * Caption tail when the element publishes no `data-capture-meta` of its own —
   * for a surface the registration knows more about than the DOM does. The
   * attribute wins where both exist, because the card is closer to the truth.
   */
  meta?: string
  /** Download name, used only when the clipboard write is refused. */
  filename?: string
  /**
   * Deliver the pixels with no caption band and no mark.
   *
   * For a surface that IS the poster rather than a card photographed out of the
   * page — the Economic Calendar template (board/econCalendar/econTemplate.ts)
   * carries its own title bar, its own date and its own CB Edge mark, and the
   * caption would say every one of them a second time.
   */
  bare?: boolean
}

/** Elements the page wants out of the picture — see the header. */
const HIDE_ATTR = 'data-capture-hide'

/**
 * A card's own contribution to the caption — its ticker, its contract date, the
 * basis it is drawing. Put it on the card root or on anything inside it:
 *
 *   <div data-capture-meta={`${symbol} · ${expiry}`}>
 *
 * The caption reads `Net Premium · Sep 2, 17:15 ET · SPX · 9-2-26`.
 *
 * EVERY SHOT DROPS THE CARD'S OWN HEADER — that is not conditional on this
 * attribute, and every card is expected to publish here whatever its header was
 * carrying. One shape for every screenshot: the card, then one line under it.
 * A card with nothing to add (Quick Links, the Economic Calendar) publishes
 * nothing and its caption is just the name and the time, which is all its header
 * said anyway.
 */
const META_ATTR = 'data-capture-meta'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * THE FRAME. The picture is the card and nothing but the card — no matte, no
 * title band, no strip bolted underneath. The caption and the mark are laid ON
 * the bottom of it, over a scrim that fades up out of the app's own background,
 * so the whole image is the thing being shared and the attribution costs no
 * height at all.
 *
 * The earlier cut was v2's framing: a title band on top, 18px of matte all
 * round, a centred watermark below. Three pieces of furniture around a card that
 * already had a header saying the same name, and the card came out smaller than
 * the chrome around it.
 */
/**
 * A shallow band of plain background below the card, and the fade that joins
 * the two.
 *
 * The band is 32px rather than 0 because every card in this app has something
 * living on its bottom edge — Net Premium's "Last print" line, GEX Candles' time
 * axis, a ladder's last row — and a caption laid straight over that is two
 * strings on one line. 32px is enough to clear all of them and still read as the
 * card fading into its own footer rather than as a bar bolted underneath: there
 * is no rule, no plate, and the fade starts well up inside the card.
 */
const CAPTION_BAND = 32
/** How far up the fade reaches, measured from the bottom of the whole image. */
const SCRIM_H = 76
/** Distance from the bottom edge to the caption's centre line. */
const CAPTION_BASE = 16
const CAPTION_PAD = 16
/** Type sizes off `tokens.css`'s scale — 13 is `text-sm`. */
const CAPTION_PX = 13
const LOGO_H = 24
const LOGO_ALPHA = 0.85
const SEP = '  ·  '

/** Served from the v2 public/ root, which is the same origin. */
const LOGO_SRC = '/cbedge3.0.png'

/**
 * THE PIXEL BUDGET, and why it exists.
 *
 * The whole board is not a card — it is every card, at full height, and on a
 * 27" monitor that is something like 2400×3000 CSS pixels. At devicePixelRatio
 * 2 that is a 29-megapixel bitmap, and Chrome will not put one of those on the
 * clipboard: `navigator.clipboard.write` rejects, and the capture used to fall
 * out of the bottom into a download. "Copy" quietly becoming "saved to
 * ~/Downloads" on exactly the shot you most want to paste is the worst possible
 * place for that fallback to fire.
 *
 * So the multiply is derived from the OUTPUT SIZE rather than from the display:
 * 2× while the picture is small enough to stay under the budget, sliding down
 * toward 1× as it grows. A card is unaffected — the budget is four times the
 * biggest card anyone has on a board — and the board comes back at whatever
 * fidelity fits in one clipboard write.
 */
const MAX_SHOT_PIXELS = 12_000_000
/** Never below this, however large the surface: a mush is not a screenshot. */
const MIN_SHOT_SCALE = 0.75

function shotScale(w: number, h: number): number {
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  const area = Math.max(1, w * h)
  return Math.max(MIN_SHOT_SCALE, Math.min(dpr, Math.sqrt(MAX_SHOT_PIXELS / area)))
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
 * Properties that are NEVER pruned, however redundant they look.
 *
 * The prune test above rests on one assumption: a property left out lands on
 * the tag default, and the tag default is what the sandbox measured. Border
 * width breaks that assumption, and it cost a whole afternoon of white
 * rectangles round every card.
 *
 * Tailwind's preflight sets `border: 0 solid currentColor` on every element, so
 * a plain div computes to `border-style: solid`, `border-width: 0px`,
 * `border-color: <the text colour>` — white, in this app. Against a bare div in
 * the sandbox (`none` / `0px` / black) that reads as: style DIFFERS, keep it;
 * colour DIFFERS, keep it; width MATCHES at 0px, drop it. Both zeros are real,
 * and they mean completely different things — the sandbox's is zero because the
 * style is `none`, and an omitted width under a written `border-style: solid`
 * falls back to the initial value, which is `medium`. Three white pixels around
 * every element in the picture.
 *
 * The shape of the bug is a computed value that another property FIXES UP, and
 * that is a short, closed list in CSS: the width of a border, an outline or a
 * column rule is reported as 0 whenever its style is none. Writing those
 * families whole costs ~19 declarations a node and takes the whole class of
 * mistake off the table.
 */
const ALWAYS = new Set([
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-width',
  'outline-style',
  'outline-color',
  'outline-offset',
  'column-rule-width',
  'column-rule-style',
  'column-rule-color',
  // The two that decide where everything else lands. They are effectively never
  // prunable in practice, and a layout that silently collapses because one of
  // them was is not a failure worth risking to save two declarations.
  'width',
  'height',
])

/**
 * The UA's computed style for a bare element of each tag, read from a sandbox
 * document with no stylesheets — which is exactly the environment the clone is
 * about to be rendered in.
 *
 * `baseline()` is the same reading for a tag the UA stylesheet says NOTHING
 * about (a plain `div`, or a plain `g` inside SVG). Comparing a tag's defaults
 * against the baseline is how the prune tells "this value is just inherited" —
 * safe to leave out — from "the UA declares this for this tag", which is not:
 * a UA rule beats inheritance, so an `<h2>` whose font-size was dropped because
 * it matched its parent comes back at the UA's 1.5em and bold. Same disease as
 * the border-width note above, on the inherited side.
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
    return this.read(el.namespaceURI === SVG_NS, el.tagName.toLowerCase())
  }

  /**
   * The defaults of a tag the UA stylesheet has no opinion about, in the same
   * namespace. Anything a tag's own defaults differ from here is UA-declared.
   */
  baseline(el: Element): Map<string, string> {
    const svg = el.namespaceURI === SVG_NS
    return this.read(svg, svg ? 'g' : 'div')
  }

  private read(svg: boolean, tag: string): Map<string, string> {
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
  const base = parentCs ? defaults.baseline(src) : null

  for (let i = 0; i < cs.length; i++) {
    const prop = cs.item(i)
    if (!prop) continue
    const v = cs.getPropertyValue(prop)

    if (parentCs && !ALWAYS.has(prop)) {
      const inherited = prop.startsWith('--') || INHERITED.has(prop)
      const sameAsParent = parentCs.getPropertyValue(prop) === v
      // Inherited: the clone gets it from its parent — UNLESS the UA stylesheet
      // declares this property for this tag, which beats inheritance. Custom
      // properties are in neither map, so they compare equal and stay prunable.
      const uaSilent = defs?.get(prop) === base?.get(prop)
      if (inherited ? sameAsParent && uaSilent : sameAsParent && defs?.get(prop) === v) continue
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

  // No scrollbars in a photograph. A scroller's offset travels as a margin (see
  // carryScroll), so the clone has nothing left to scroll — but `overflow: auto`
  // over overflowing content still draws the bar, and the SVG document draws the
  // CLASSIC one, eating 15px of the numbers it was pointing at. The app hides
  // these on screen anyway; this makes the picture agree.
  for (const axis of ['overflow-x', 'overflow-y'] as const) {
    const o = cs.getPropertyValue(axis)
    if (o === 'auto' || o === 'scroll') style.setProperty(axis, 'hidden')
  }

  // NOTE ON THE BOX, because the obvious "fix" here is a bug:
  //
  // An earlier cut restated every element's box from `getBoundingClientRect`,
  // on the belief that `getComputedStyle().width` is the CONTENT width whatever
  // `box-sizing` says — which would shrink the clone by its own padding at
  // every level of nesting. It is not: Chrome's resolved `width` HONOURS
  // `box-sizing`, so a border-box element reports its border box and a
  // content-box element its content box. Copying `width` and `box-sizing`
  // together, which the loop above already does, reproduces the geometry
  // exactly.
  //
  // Measuring instead was strictly worse: the rect is fractional and a text box
  // pinned to its own exact width re-wraps on the tiniest metric difference in
  // the SVG document, and a transformed element's rect already has the
  // transform in it, which the copied `transform` would then apply twice.
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
  // After the children, never before: it rewrites the first child's margin and
  // the style pass would otherwise put the live value straight back.
  carryScroll(src, dst, cs)
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

/**
 * Carry a scroll offset across to the clone.
 *
 * A scroll position is not a style, so `cloneNode` starts every scroller at the
 * top — which is how the Multi Greek ladder photographed at strike 950 for a
 * $324 stock. That ladder auto-scrolls so ATM sits in the middle of the box, and
 * the middle is the entire point of the card; a shot of the top of it is a shot
 * of a column of dashes.
 *
 * The offset travels as a NEGATIVE MARGIN on the first element child rather
 * than as a scroll: the container keeps its own `overflow`, so everything above
 * the offset is clipped exactly as it is on screen, and normal flow carries the
 * shift down through every sibling. A transform on the container would move its
 * background and border too; a wrapper element around the children would break
 * the flex and grid containers this app is built out of.
 *
 * Grid is the one layout this cannot shift — margin on one item does not move
 * the rest of the track — so those children are translated individually
 * instead.
 */
function carryScroll(src: Element, dst: Element, cs: CSSStyleDeclaration): void {
  const top = src.scrollTop
  const left = src.scrollLeft
  if (!top && !left) return

  if (cs.display.includes('grid')) {
    for (const child of Array.from(dst.children)) {
      const s = (child as HTMLElement).style
      if (s) s.setProperty('transform', `translate(${-left}px, ${-top}px)`)
    }
    return
  }

  const first = dst.firstElementChild as HTMLElement | null
  if (!first?.style) return
  // Added to whatever margin the child already carries, which the style pass
  // has already written out in full.
  const mt = parseFloat(getComputedStyle(src.firstElementChild ?? src).marginTop) || 0
  const ml = parseFloat(getComputedStyle(src.firstElementChild ?? src).marginLeft) || 0
  if (top) first.style.setProperty('margin-top', `${mt - top}px`)
  if (left) first.style.setProperty('margin-left', `${ml - left}px`)
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
 *
 * Returns the clone AND the height it should be rendered at: dropping the card's
 * own header takes that many pixels off the picture as well as out of it. The
 * body is a chart at a fixed bitmap size, so leaving the height alone would just
 * open a band of empty plate under it.
 */
function buildClone(el: HTMLElement, w: number, h: number): { clone: HTMLElement; height: number } {
  const clone = el.cloneNode(true) as HTMLElement
  const defaults = new TagDefaults()

  try {
    // Styles first: this measures the LIVE element, so it has to run while the
    // two trees still line up and before anything is pulled out of the clone.
    styleTree(el, clone, null, defaults)
  } finally {
    defaults.dispose()
  }

  // The Card primitive's own header — the row carrying the card's name and its
  // toolbar. It always comes off: the caption under the picture says the name,
  // the time and whatever the card published (see META_ATTR), so leaving the
  // header in prints all of it twice with the chart squeezed underneath.
  //
  // `:scope >` deliberately: a Multi Greek column or any nested Card has a
  // header of its own and that one is content, not chrome.
  const header = el.querySelector<HTMLElement>(':scope > header')
  const height = header ? Math.max(1, h - header.getBoundingClientRect().height) : h

  const pairs: Array<[Element, Element]> = []
  pairUp(el, clone, pairs)

  for (const [src, dst] of pairs) {
    // A descendant of something already removed. Its own turn is a no-op.
    if (dst !== clone && !clone.contains(dst)) continue

    if (src === header || src.hasAttribute(HIDE_ATTR)) {
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
  clone.style.setProperty('height', `${height}px`)
  clone.style.setProperty('margin', '0')
  clone.style.setProperty('position', 'static')
  clone.style.setProperty('inset', 'auto')
  clone.style.setProperty('transform', 'none')
  clone.style.setProperty('max-width', 'none')
  clone.style.setProperty('max-height', 'none')

  return { clone, height }
}

// ── Rasterising ──────────────────────────────────────────────────────────────

/** The subtree, rendered by the browser itself. See shotScale for the multiply. */
async function rasterise(el: HTMLElement): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  const rect = el.getBoundingClientRect()
  const w = Math.max(1, Math.ceil(rect.width))

  // Text inside the SVG document is measured against the same faces the page is
  // using — but only once they have actually loaded.
  await document.fonts?.ready?.catch(() => undefined)

  const { clone, height } = buildClone(el, w, Math.max(1, Math.ceil(rect.height)))
  const h = Math.ceil(height)
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

  // The caption band rides under the card, so the budget has to cover both or
  // the frame is the thing that tips the write over the limit.
  const scale = shotScale(w, h + CAPTION_BAND)
  const out = document.createElement('canvas')
  out.width = Math.round(w * scale)
  out.height = Math.round(h * scale)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(img, 0, 0, out.width, out.height)
  return { canvas: out, scale }
}

/** ET, the only clock this app tells time in. */
function stampNow(): string {
  return `${new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })} ET`
}

/**
 * The mark, loaded once per tab and kept.
 *
 * Resolves to null on any failure — a missing logo prints a caption without one
 * rather than losing the shot.
 */
let logoPromise: Promise<HTMLImageElement | null> | null = null
function loadLogo(): Promise<HTMLImageElement | null> {
  if (!logoPromise) {
    logoPromise = new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = LOGO_SRC
    })
  }
  return logoPromise
}

/**
 * The card, with the caption and the mark laid over its bottom edge.
 *
 * `Net Premium · Sep 2, 17:15 ET · SPX · 9-2-26` on the left, the CB Edge mark
 * on the right, both sitting on a scrim that fades up out of the app's own
 * background. Nothing is added below the card, so the image is exactly the card
 * and the attribution rides for free.
 */
function frame(
  shot: HTMLCanvasElement,
  scale: number,
  title: string,
  meta: string | null,
  logo: HTMLImageElement | null,
): HTMLCanvasElement {
  const w = shot.width / scale
  const cardH = shot.height / scale
  const h = cardH + CAPTION_BAND

  const out = document.createElement('canvas')
  out.width = Math.round(w * scale)
  out.height = Math.round(h * scale)
  const ctx = out.getContext('2d')
  if (!ctx) return shot
  ctx.scale(scale, scale)

  const face = getComputedStyle(document.body).fontFamily

  ctx.fillStyle = tokenHex('--color-bg')
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(shot, 0, 0, w, cardH)

  // The scrim. Transparent at the top so it reads as the card dimming into its
  // own footer rather than as a bar someone stuck on.
  const scrimTop = Math.max(0, h - SCRIM_H)
  const g = ctx.createLinearGradient(0, scrimTop, 0, h)
  g.addColorStop(0, tokenHexAlpha('--color-bg', 0))
  g.addColorStop(1, tokenHexAlpha('--color-bg', 0.92))
  ctx.fillStyle = g
  ctx.fillRect(0, scrimTop, w, h - scrimTop)

  const mid = h - CAPTION_BASE
  ctx.textBaseline = 'middle'

  // The mark goes down first so the caption knows how much room is left.
  let logoW = 0
  if (logo?.naturalWidth && logo.naturalHeight) {
    logoW = (logo.naturalWidth / logo.naturalHeight) * LOGO_H
    ctx.globalAlpha = LOGO_ALPHA
    ctx.drawImage(logo, w - CAPTION_PAD - logoW, mid - LOGO_H / 2, logoW, LOGO_H)
    ctx.globalAlpha = 1
  }

  const room = Math.max(40, w - CAPTION_PAD * 2 - logoW - 16)
  ctx.textAlign = 'left'
  ctx.font = `600 ${CAPTION_PX}px ${face}`
  ctx.fillStyle = tokenHex('--color-fg')
  const titleW = Math.min(ctx.measureText(title).width, room)
  ctx.fillText(title, CAPTION_PAD, mid, room)

  // Time and the card's own note in the quieter weight, so the name still reads
  // first at a glance in a Discord thumbnail. `--color-muted` is white today
  // (every text token is — see tokens.css), and the whole difference between fg
  // and muted in this app is the opacity utility a class would carry; a canvas
  // has no class, so it takes the alpha from the token itself.
  const tail = meta ? `${SEP}${stampNow()}${SEP}${meta}` : `${SEP}${stampNow()}`
  ctx.font = `400 ${CAPTION_PX}px ${face}`
  ctx.fillStyle = tokenHexAlpha('--color-muted', 0.7)
  ctx.fillText(tail, CAPTION_PAD + titleW, mid, Math.max(20, room - titleW))

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
 * PLAIN TEXT to the clipboard.
 *
 * The other half of this file photographs pixels; some things are better as
 * characters. A levels line pasted into Discord as text can be quoted, searched
 * and read by a phone's screen reader, and it survives being copied on again —
 * a PNG of six numbers is none of those. See board/keyLevels/KeyLevelsCard.tsx.
 *
 * `writeText` is the modern path. The `execCommand` fallback is not superstition:
 * it is the one that still works when the async clipboard is unavailable (an
 * insecure origin, a permission the user declined), and for text there is no
 * sensible download to fall back to instead — a .txt in ~/Downloads is not what
 * anybody meant by copy. Throws when both fail, so the caller shows the error
 * rather than reporting a copy that did not happen.
 */
export async function copyText(text: string): Promise<ShotResult> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return 'copied'
    }
  } catch {
    /* fall through to the legacy path */
  }

  // Off-screen rather than hidden: `display:none` cannot hold a selection, and
  // a selection is what execCommand copies.
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.setAttribute('aria-hidden', 'true')
  ta.style.cssText = 'position:fixed;left:-99999px;top:0;opacity:0'
  document.body.appendChild(ta)
  try {
    ta.select()
    ta.setSelectionRange(0, text.length)
    if (document.execCommand('copy')) return 'copied'
  } catch {
    /* reported below */
  } finally {
    ta.remove()
  }
  throw new Error('the browser refused the clipboard')
}

/** One attempt at the clipboard. False means "not this blob", not "never". */
async function copyBlob(blob: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return false
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}

/** Half-size copy of a canvas, for the retry ladder below. */
function shrink(src: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(src.width * factor))
  out.height = Math.max(1, Math.round(src.height * factor))
  const ctx = out.getContext('2d')
  if (!ctx) return src
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, out.width, out.height)
  return out
}

/**
 * The clipboard, and only then a download.
 *
 * The clipboard is the whole point — the shot is going into Discord or a DM,
 * and a file in ~/Downloads is two more steps. Chrome refuses a write for two
 * different reasons and they want different answers: it refuses because the
 * bitmap is too big, which SHRINKING fixes, and it refuses on an insecure
 * origin or a stale gesture, which nothing here fixes.
 *
 * There is no way to tell the two apart from the rejection, so this tries
 * smaller twice before giving up. `shotScale` already sizes the capture to stay
 * under the limit; this is the belt to that pair of braces, and it is what
 * stopped "Whole board" quietly arriving in ~/Downloads instead of on the
 * clipboard. The download is still there for the cases that are genuinely not
 * about size — losing the capture entirely would be worse than either.
 */
const RETRY_FACTORS = [0.62, 0.45]

export async function copyOrDownload(blob: Blob, filename: string): Promise<ShotResult> {
  if (await copyBlob(blob)) return 'copied'
  download(blob, filename)
  return 'saved'
}

async function deliver(canvas: HTMLCanvasElement, filename: string): Promise<ShotResult> {
  let blob = await toBlob(canvas)
  if (await copyBlob(blob)) return 'copied'

  for (const f of RETRY_FACTORS) {
    blob = await toBlob(shrink(canvas, f))
    if (await copyBlob(blob)) return 'copied'
  }

  download(blob, filename)
  return 'saved'
}

/** The card's own contribution to the caption. See META_ATTR. */
function metaOf(el: HTMLElement): string | null {
  const own = el.getAttribute(META_ATTR)
  if (own) return own
  return el.querySelector(`[${META_ATTR}]`)?.getAttribute(META_ATTR) || null
}

/** Photograph `el`, frame it, and put it on the clipboard. */
export async function captureAndCopy(el: HTMLElement, opts: ShotOptions = {}): Promise<ShotResult> {
  // The DOM wins where both exist: the card is closer to the truth than the
  // menu entry that pointed at it.
  const meta = metaOf(el) ?? opts.meta ?? null
  const [{ canvas, scale }, logo] = await Promise.all([
    rasterise(el),
    opts.bare ? Promise.resolve(null) : loadLogo(),
  ])
  const out = opts.bare ? canvas : frame(canvas, scale, opts.title ?? 'CB Edge', meta, logo)
  return deliver(out, opts.filename ?? 'snapshot.png')
}
