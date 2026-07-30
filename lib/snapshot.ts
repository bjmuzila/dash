"use client";

/**
 * lib/snapshot.ts — THE snapshot engine. There is exactly one.
 *
 * Before this module there were eight independent `html2canvas()` call sites,
 * each with its own hardcoded background (six different values), its own scale
 * (four different values), and its own subset of the workarounds html2canvas
 * needs. The result was that the same panel captured through two different
 * buttons produced two different-looking PNGs, and five of the eight paths were
 * missing fixes that the other three had — which is why some snapshots came out
 * blank, invisible, or off-tone. Every capture in the app now goes through
 * `captureToCanvas()` below, so a fix applied here is a fix everywhere.
 *
 * `scripts/audit-ui.mjs --strict` fails the build if a second `html2canvas()`
 * call site reappears outside this file. Add options here instead.
 *
 * ─── The html2canvas gotchas this module owns ───────────────────────────────
 * These were each found the hard way. Do not "simplify" them away.
 *
 *  1. Text/images drawn onto the RETURNED canvas silently no-op in Chromium.
 *     Overlay content MUST be injected as real DOM inside `onclone`.
 *  2. Never set a clone's height to "auto" on a flex/percentage-height table —
 *     it collapses to 0 and html2canvas throws ("createPattern ... height of 0").
 *     Measure scrollHeight and set an explicit px height.
 *  3. `onclone` must NOT strip external <link rel="stylesheet"> tags. That also
 *     deletes Next's compiled Tailwind sheet, so every className-styled element
 *     loses its layout mid-capture (this is what collapsed the ES Candles
 *     CALL WALL / PUT WALL / FLIP / CB row). useCORS + allowTaint already keep a
 *     404'd stylesheet from aborting the render, so stripping buys nothing.
 *  4. `windowWidth` / `windowHeight` REFLOW the entire cloned document at that
 *     virtual viewport — they are for media-query fidelity, not cropping. Use
 *     `width` / `height` (pure output crop, no reflow) unless you specifically
 *     want a responsive re-layout, as the fixed-width Discord render does.
 *  5. Live <canvas> bitmaps do not survive the clone reliably — and when they
 *     DO copy, compositing our own bitmap on top yields the chart twice at two
 *     slightly different scales. So: blank every canvas in the clone, then draw
 *     the real bitmaps in ourselves, positioned off their live bounding rects.
 *  6. `background-clip: text` renders INVISIBLE. Gradient headings must be
 *     flattened to a solid color in the clone (see `data-snap-plain`).
 *  8. `overflow:hidden` on a truncated text span SHEARS the glyphs — only the
 *     top few pixels survive. Neither ellipsis nor text clipping is really
 *     implemented, so the truncation idiom is dropped for the capture.
 *  7. `backdrop-filter` is not implemented at all. Frosted panels come out as
 *     their raw low-alpha background over whatever the capture background is,
 *     which reads as washed out. We swap them to the solid panel color.
 */

import { HOME_THEME } from "@/components/shared/homeTheme";

/** Single source of truth for capture background. Never hardcode hex (AGENTS.md). */
export const SNAP_BG = HOME_THEME.bg;
export const SNAP_WATERMARK = "Data provided by CBEdge.net";
/**
 * Height of the framed-mode title band, in CSS px.
 *
 * The band's two lines carry EXPLICIT line-heights (see the band CSS below) so
 * this number is font-independent: 8 padding + 18 title + 3 gap + 13 watermark
 * + 8 padding = 50, leaving 2px of slack. Relying on the font's natural
 * line-height instead is what sliced the watermark in half on the GEX heatmap —
 * 44px was enough with the Arial fallback but not with Inter, which the app
 * actually loads, so it only reproduced on real pages and never in a fixture.
 */
export const SNAP_BAND_H = 52;
/** Band line-heights, in CSS px. SNAP_BAND_H is derived from these. */
const BAND_TITLE_LH = 18;
const BAND_WATERMARK_LH = 13;
/**
 * Breathing room between the band and the first row of content. The band holds
 * a 15px title + 3px gap + 11px watermark inside 8px/8px padding — about 45px,
 * i.e. slightly TALLER than SNAP_BAND_H. Reserving only SNAP_BAND_H meant the
 * band's bottom edge sat on top of whatever came first, clipping it (visible on
 * Multi-Greek as the toolbar's top border sliced off under the watermark).
 */
export const SNAP_BAND_GAP = 10;
/**
 * Slack reserved below the content in framed mode, then trimmed back at the
 * pixel level (see `trimTrailingBackground`).
 *
 * `contentH` is a sum of the direct children's box heights, which is an
 * estimate: it misses margins, it misses a row that re-flows a pixel taller in
 * the clone, and it over-counts when a [data-capture-hide] element is nested
 * inside a child rather than being a child itself. Guessing low clips the last
 * row (this is what sliced the bottom strike off the options-chain capture);
 * guessing high leaves a black void. So: deliberately guess high, then measure
 * the rendered bitmap and cut back to a fixed margin. Correct either way.
 */
export const SNAP_BOTTOM_SLACK = 48;
/** Background margin left below the content after trimming, in CSS px. */
export const SNAP_BOTTOM_PAD = 10;

/**
 * One scale policy for the whole app. Capped at 2 — beyond that PNGs get large
 * enough that Discord re-compresses them, which costs more fidelity than the
 * extra pixels buy.
 */
export function snapScale(): number {
  if (typeof window === "undefined") return 1;
  return Math.min(2, window.devicePixelRatio || 1);
}

export type SnapOptions = {
  /**
   * Framed mode: bake in the title band + watermark, expand the clone to its
   * true content height so nothing is cut off by a scroll container, and drop
   * `[data-capture-hide]` elements.
   *
   * This is a separate flag from `title` on purpose. Most DataBox callers pass
   * no title at all (es-candles, mult-greek, premarket, options-chain, the flow
   * SnapshotPanel, IB Logic) and rely on the "SPX GEX" default — so keying
   * framed mode off `title` being present would silently drop the band and, far
   * worse, the content-height expansion for exactly those pages.
   */
  framed?: boolean;
  /** Title band text. Defaults to "SPX GEX". Implies `framed`. */
  title?: string;
  /** Crop the PNG to the real content box (framed mode). */
  fitContent?: boolean;
  /** Override the capture background. Defaults to the theme background. */
  background?: string;
  /** Override the scale. Defaults to `snapScale()`. */
  scale?: number;
  /**
   * Reflow the cloned document at this virtual viewport size. Only for
   * fixed-size renders (the Discord econ image, which is laid out in an
   * off-screen 1280x720 iframe and genuinely wants a media-query reflow) — see
   * gotcha 4. Everything else must use `width`/`height`.
   */
  windowWidth?: number;
  windowHeight?: number;
  /** Output crop width / height in CSS px. Pure crop, no reflow. */
  width?: number;
  height?: number;
};

type LtProvider = () => { canvas: HTMLCanvasElement; target: HTMLElement } | null;
type SnapRedraw = (capturing: boolean) => void;

/**
 * Ask every canvas in the subtree that exposes `__snapRedraw` to repaint for (or
 * back from) a capture.
 *
 * A <canvas> is opaque to the DOM fixes above — anything painted into it is just
 * pixels, so live-only chrome drawn on a chart cannot be removed with
 * [data-capture-hide]. The GEX chart's "scroll=zoom · drag=pan · dbl=recenter"
 * hint was being baked into every shared PNG for exactly that reason. Components
 * opt in by tagging their canvas [data-snap-redraw] and attaching the hook; this
 * must be synchronous, since the bitmap is read immediately after.
 */
function setCanvasCaptureMode(el: HTMLElement, capturing: boolean) {
  const nodes: Element[] = [...el.querySelectorAll("[data-snap-redraw]")];
  if (el.matches("[data-snap-redraw]")) nodes.push(el);
  for (const n of nodes) {
    const fn = (n as unknown as { __snapRedraw?: SnapRedraw }).__snapRedraw;
    if (typeof fn === "function") {
      try { fn(capturing); } catch { /* a chart that can't redraw is not fatal */ }
    }
  }
}

/**
 * True when `el` is, for capture purposes, just a canvas — exactly one canvas
 * that covers essentially the whole element box. That's the shape the
 * bare-canvas fast path is written for (GexChart and friends: a fixed-pixel
 * bitmap that will not re-flow). A panel that merely contains a canvas
 * somewhere is a normal DOM capture and must not take that path.
 */
function canvasCoversElement(el: HTMLElement): boolean {
  const canvases = el.querySelectorAll("canvas");
  if (canvases.length !== 1) return false;
  const r = el.getBoundingClientRect();
  const c = canvases[0].getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const coverage = (c.width * c.height) / (r.width * r.height);
  return coverage >= 0.9;
}

/**
 * Style-only fixes that must apply to EVERY capture, framed or plain. Runs
 * inside `onclone` against the cloned subtree.
 *
 * Style-only is deliberate: this must not add or remove nodes, because the live
 * <canvas> handling downstream pairs the clone's canvases to the live ones by
 * index and any structural edit before that point desyncs the pairing.
 */
function applyUniversalCloneFixes(root: HTMLElement) {
  // ── Gotcha 6: background-clip:text captures invisible ──────────────────────
  // Elements opted in with data-snap-plain="#RRGGBB" get flattened to that
  // color. Anything else carrying an inline background-clip:text is flattened
  // to the theme text color — washed out beats invisible, and it means a new
  // gradient heading can't silently disappear from a snapshot.
  const flatten = (n: HTMLElement, color: string) => {
    n.style.background = "none";
    n.style.backgroundImage = "none";
    n.style.webkitTextFillColor = color;
    n.style.color = color;
  };
  root.querySelectorAll<HTMLElement>("[data-snap-plain]").forEach((n) => {
    flatten(n, n.getAttribute("data-snap-plain") || HOME_THEME.text);
  });
  root
    .querySelectorAll<HTMLElement>('[style*="background-clip"]')
    .forEach((n) => {
      if (n.hasAttribute("data-snap-plain")) return;
      const clip = n.style.webkitBackgroundClip || n.style.backgroundClip;
      if (clip === "text") flatten(n, HOME_THEME.text);
    });

  // ── position:sticky has no meaning in a static capture ────────────────────
  // A sticky header sticks to the top of its scroll container. The capture
  // reserves space at the top for the title band and sets the root's overflow
  // to visible, which changes which ancestor is the scroll container — so a
  // sticky `top: 0` header slides UP out of the content and paints its opaque
  // background over the band. That is what covered the watermark on the GEX
  // heatmap (its header is position:sticky, top:0, background #070c14) and it
  // affects every sticky header in the app: the options-chain toolbar, the
  // scanner tables, the fails and budget pages.
  //
  // Nothing scrolls in a PNG, so demote sticky to static and let the header sit
  // where it belongs in the flow.
  root.querySelectorAll<HTMLElement>('[style*="sticky"]').forEach((n) => {
    if (n.style.position === "sticky") n.style.position = "static";
  });
  if (root.style.position === "sticky") root.style.position = "static";

  // ── Gotcha 8: overflow:hidden shears text ────────────────────────────────
  // An `overflow:hidden + text-overflow:ellipsis + white-space:nowrap` span is
  // the standard one-line-truncation idiom. html2canvas implements NEITHER
  // ellipsis nor reliable text clipping: instead it shears the glyphs, keeping
  // only the top slice of each letter. On the Sector Wheel's SECTORS list that
  // left ~2px of every name — the dots of the i's and the crossbars of the t's,
  // nothing else. (Same trap the econ-calendar template hit, where it rendered
  // "NFLX" as "NFLY"; see the .chip-sym note there.)
  //
  // The clipping is already non-functional in a capture, so drop it and give the
  // line some leading. Losing a truncation is a far smaller defect than losing
  // the text — and only elements using the full truncation idiom are touched,
  // so real clipping containers are left alone.
  root
    .querySelectorAll<HTMLElement>('[style*="ellipsis"]')
    .forEach((n) => {
      if (n.style.overflow !== "hidden") return;
      n.style.overflow = "visible";
      n.style.textOverflow = "clip";
      const fs = parseFloat(n.style.fontSize || "") || 0;
      if (fs > 0) n.style.lineHeight = `${Math.ceil(fs * 1.35)}px`;
      else if (!n.style.lineHeight) n.style.lineHeight = "1.35";
    });

  // ── Gotcha 7: backdrop-filter is a no-op in html2canvas ───────────────────
  // A frosted panel is a low-alpha fill that only reads correctly because of the
  // blur behind it. With no blur it looks washed out, so promote the fill to the
  // solid panel color for the capture only.
  root.querySelectorAll<HTMLElement>('[style*="backdrop-filter"]').forEach((n) => {
    n.style.setProperty("backdrop-filter", "none");
    n.style.setProperty("-webkit-backdrop-filter", "none");
    if (/rgba\(13\s*,\s*17\s*,\s*25/.test(n.style.background || n.style.backgroundColor || "")) {
      n.style.background = HOME_THEME.panelBgStrong;
    }
  });
}

/**
 * Capture `el` to a canvas. This is the only html2canvas call in the codebase.
 */
export async function captureToCanvas(
  el: HTMLElement,
  opts: SnapOptions = {},
): Promise<HTMLCanvasElement> {
  setCanvasCaptureMode(el, true);
  try {
    return await captureToCanvasInner(el, opts);
  } finally {
    // Always restore, including on failure — otherwise the live chart silently
    // loses its interaction hint until the next unrelated redraw.
    setCanvasCaptureMode(el, false);
  }
}

async function captureToCanvasInner(
  el: HTMLElement,
  opts: SnapOptions = {},
): Promise<HTMLCanvasElement> {
  const framed = opts.framed ?? !!opts.title;
  const titleText = opts.title && opts.title.trim() ? opts.title : "SPX GEX";
  const bg = opts.background ?? SNAP_BG;
  const fitContent = !!opts.fitContent;

  // A lightweight-charts target (ES Candles) is a FLEX COLUMN (chart card +
  // lanes), not a bare bitmap. It happens to contain a <canvas>, but it must
  // take the flex-summation path below — not the bare-canvas fast path — or
  // html2canvas clips to the clamped flex height and captures only the bottom
  // of the chart. Detect it via the __ltScreenshot hook.
  const ltProvider = (el as unknown as { __ltScreenshot?: LtProvider }).__ltScreenshot;
  const lt = ltProvider?.();
  const inner = framed ? (el.querySelector("table") as HTMLElement | null) : null;
  // The fast path below is only valid when the element IS a canvas chart —
  // nothing but the bitmap plus maybe a hover tooltip. Merely *containing* a
  // canvas is not enough: `!!el.querySelector("canvas")` claimed any panel with
  // a sparkline, a gauge, or a mini-chart in it, and the capture came back as
  // that sparkline alone. A 5-row stat panel with a 120x30 sparkline captured
  // as a 120x74 PNG — verified, and a strong candidate for "some snaps are just
  // wrong and strange". Require the canvas to actually cover the element.
  const isBareCanvas = framed && !inner && !lt && canvasCoversElement(el);

  // ── Bare-canvas fast path (e.g. GexChart) ─────────────────────────────────
  // The element's only content is the canvas itself. After four rounds of
  // chasing html2canvas's clone/reflow/width-vs-windowWidth quirks (crops,
  // double-scaling, off-center frames) the robust fix is to skip the DOM-clone
  // pipeline entirely and build the PNG from the canvas's own pixel buffer plus
  // a manually drawn title band. No clone, no reflow, no rect math to get wrong.
  if (isBareCanvas) {
    const src = el.querySelector("canvas") as HTMLCanvasElement;
    // Derive the scale from the canvas's own backing ratio rather than
    // snapScale() — the band must be sized in the same pixel space as the
    // buffer we're copying, whatever ratio that buffer was allocated at.
    const rect = src.getBoundingClientRect();
    const scale = rect.width > 0 ? src.width / rect.width : window.devicePixelRatio || 1;
    const bandH = Math.round(SNAP_BAND_H * scale);
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height + bandH;
    const octx = out.getContext("2d")!;
    octx.fillStyle = bg;
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(src, 0, bandH);
    octx.textBaseline = "alphabetic";
    octx.textAlign = "left";
    octx.fillStyle = HOME_THEME.text;
    octx.font = `700 ${Math.round(15 * scale)}px Inter, Arial, sans-serif`;
    octx.fillText(titleText, 12 * scale, (8 + BAND_TITLE_LH - 4) * scale);
    octx.fillStyle = "rgba(255,255,255,0.7)";
    octx.font = `700 ${Math.round(11 * scale)}px Inter, Arial, sans-serif`;
    octx.fillText(SNAP_WATERMARK, 12 * scale, (8 + BAND_TITLE_LH + 3 + BAND_WATERMARK_LH - 3) * scale);
    return out;
  }

  const { default: html2canvas } = await import("html2canvas");
  const scale = opts.scale ?? snapScale();
  const bandShift = framed ? SNAP_BAND_H + SNAP_BAND_GAP : 0;

  // ── Gotcha 5: live <canvas> bitmaps ───────────────────────────────────────
  // Every canvas in the subtree gets blanked in the clone and composited in
  // afterwards from its live bitmap. `lt` canvases are handled by the provider's
  // own screenshot; everything else is drawn from the element directly.
  //
  // ONLY in framed mode (or when a lightweight-charts provider is present).
  // In plain mode the blank-and-composite round trip was losing the bitmap
  // outright — a Sector Wheel capture came back with the header text and an
  // empty space where the wheel should be — which is strictly worse than what
  // CopySnapButton did before, i.e. just letting html2canvas draw the canvas
  // itself. Blanking without a working composite is the one combination that
  // must never happen, so plain mode leaves canvases alone.
  const compositeCanvases = framed || !!lt;
  const otherLiveCanvases = compositeCanvases
    ? (Array.from(el.querySelectorAll("canvas")).filter(
        (c) => !(lt && lt.target.contains(c)),
      ) as HTMLCanvasElement[])
    : [];

  // Elements tagged [data-capture-hide] are live-page chrome (toolbars, control
  // docks) that shouldn't appear in the PNG. Framed mode drops them at the END
  // of onclone (after the index-paired children loop, so pairing stays exact).
  // A tagged DIRECT child sitting ABOVE the chart also removes its own height
  // from the flow, so everything below shifts up by that much — the canvas
  // composites must mirror that, since they position off LIVE rects.
  // Live-page chrome, dropped in BOTH modes. This used to be framed-only, which
  // meant every CopySnapButton capture (the S&P Sector Wheel, the traders
  // dashboard) kept its own control cluster in the PNG — cap toggles, full
  // screen, close, and the snap button itself mid-click reading "Capturing…".
  const hideEls = Array.from(el.querySelectorAll("[data-capture-hide]")) as HTMLElement[];
  const chartTop = lt ? lt.target.getBoundingClientRect().top : Infinity;
  let hiddenShift = 0;
  for (const h of hideEls) {
    if (h.parentElement !== el) continue; // only direct children affect the flow
    if (h.getBoundingClientRect().bottom > chartTop) continue; // not above the chart
    hiddenShift += h.offsetHeight;
  }
  // Same compensation for plain mode: removing chrome above the content shifts
  // everything below it up, and the canvas composites position off LIVE rects
  // that still include that chrome.
  const firstCanvasTop = otherLiveCanvases.length
    ? Math.min(...otherLiveCanvases.map((c) => c.getBoundingClientRect().top))
    : Infinity;
  if (!framed) {
    hiddenShift = 0;
    for (const h of hideEls) {
      if (h.parentElement !== el) continue;
      if (h.getBoundingClientRect().bottom > Math.min(chartTop, firstCanvasTop)) continue;
      hiddenShift += h.offsetHeight;
    }
  }

  // ── Framed mode: measure the true content height ──────────────────────────
  let contentH = 0;
  let captureH = opts.height;
  if (framed) {
    if (inner) {
      contentH = inner.scrollHeight;
    } else {
      // Sum every direct child up to and including the scroll body, measuring
      // the scroll body by scrollHeight rather than its clamped client height.
      let h = 0;
      Array.from(el.children).forEach((c) => {
        const ch = c as HTMLElement;
        if (ch.hasAttribute("data-capture-hide")) return; // dropped from the clone
        h += ch.scrollHeight > ch.clientHeight ? ch.scrollHeight : ch.offsetHeight;
      });
      contentH = h || el.scrollHeight;
    }
    // fitContent (element hugs its content during capture, e.g. mult-greek
    // screenshot mode): measure the REAL rendered content box — bottom of the
    // last child relative to the element's top — instead of the child-sum
    // heuristic, which overshoots and leaves a blank void below the data.
    if (fitContent) {
      // Measure the FURTHEST-DOWN child, not `lastElementChild`. DOM order is
      // not visual order: an absolutely-positioned overlay, a zero-height
      // <style> node, or a reordered flex child can all be last in the markup
      // while sitting well above the real bottom of the content — and when the
      // measurement comes up short the capture clips the data off the bottom.
      const r = el.getBoundingClientRect();
      let bottom = r.top;
      for (const c of Array.from(el.children) as HTMLElement[]) {
        if (c.hasAttribute("data-capture-hide")) continue;
        const cb = c.getBoundingClientRect().bottom;
        if (cb > bottom) bottom = cb;
      }
      if (bottom > r.top) contentH = Math.ceil(bottom - r.top);
      contentH -= hiddenShift;
    }
    captureH = contentH + SNAP_BAND_H + SNAP_BAND_GAP + SNAP_BOTTOM_SLACK;
  }

  // Output crop width, matching the live element. See gotcha 4: pairing this
  // with `windowWidth` would reflow every ancestor flex container and change
  // the chart's real size in the clone.
  //
  // scrollWidth ONLY in fitContent mode. fitContent means the element has been
  // switched to width:fit-content for the capture and genuinely extends past
  // the viewport (mult-greek), so the overflow is the content. Everywhere else
  // the element clips its overflow on screen, and scrollWidth drags that hidden
  // overflow into the PNG: on ES Candles it added ~215px of empty panels to the
  // right of the GEX rail — boxes you cannot see on the page.
  const visibleW = Math.round(el.getBoundingClientRect().width) || el.clientWidth;
  const contentW = framed
    ? opts.width ?? (fitContent ? (el.scrollWidth || visibleW) : visibleW)
    : opts.width;

  const base = await html2canvas(el, {
    backgroundColor: bg,
    useCORS: true,
    allowTaint: true,
    scale,
    logging: false,
    ...(contentW ? { width: contentW } : {}),
    ...(captureH ? { height: captureH } : {}),
    // Only ever set deliberately — see gotcha 4.
    ...(opts.windowWidth ? { windowWidth: opts.windowWidth } : {}),
    ...(opts.windowHeight ? { windowHeight: opts.windowHeight } : {}),
    onclone: (doc: Document, clone: HTMLElement) => {
      // ── Strip <script> from the cloned document ──────────────────────────
      // html2canvas clones the whole document into an about:blank iframe. Every
      // <script src> in that clone is then re-requested with its URL resolved
      // against about:blank, so each one 404s from `about:client`. On /home that
      // is a dozen failed requests per snapshot (the Vite chunks: HomeRoute,
      // DataBox, DockToolbar, IbStatsTab, useNqCandles, the page chunks…) plus
      // one that succeeds and re-downloads lightweight-charts at 59 kB.
      //
      // Safe to remove, and different from the <link rel="stylesheet"> case in
      // gotcha 3: stylesheets are what make the clone LOOK right, whereas a
      // script can only re-run or waste a request. A capture is a static
      // snapshot; nothing in it needs to execute.
      doc.querySelectorAll("script").forEach((n) => n.remove());

      applyUniversalCloneFixes(clone);

      // Blank the clone's canvases so the composited live bitmaps are the only
      // copy. Snapshot BOTH lists once, up front: index-matching between the
      // live tree and its deep clone is exact only while the clone's canvas
      // list is untouched, and the placeholder swap below mutates it. On
      // /es-candles the heatmap overlay is stripped here and sits BEFORE the
      // chart's canvases in DOM order, so re-querying shifted every later index
      // and left one live copy of the chart visible under the composite — two
      // candle series at slightly different scales in the PNG.
      const liveAll = Array.from(el.querySelectorAll("canvas"));
      const cloneCanvases = Array.from(clone.querySelectorAll("canvas")) as HTMLElement[];
      otherLiveCanvases.forEach((liveCanvas) => {
        const idx = liveAll.indexOf(liveCanvas);
        const cloned = idx >= 0 ? cloneCanvases[idx] : undefined;
        if (!cloned) return;
        // A placeholder div keeps the layout box that the canvas occupied.
        const placeholder = doc.createElement("div");
        placeholder.style.cssText = cloned.style.cssText;
        cloned.replaceWith(placeholder);
      });
      if (lt) {
        liveAll.forEach((liveCanvas, i) => {
          if (!lt.target.contains(liveCanvas)) return;
          const cloned = cloneCanvases[i];
          if (!cloned) return;
          cloned.style.visibility = "hidden";
          // visibility alone leaves html2canvas free to paint a parent's
          // background over the composite region on some paths; belt and braces
          // so the clone's copy can never contribute pixels.
          cloned.style.opacity = "0";
        });
      }

      // Controls that must never appear in an image — date pickers, the capture
      // buttons themselves. Dropped AFTER the canvas pairing above, never
      // before. (If a dropped element sits above a live <canvas> it shifts that
      // canvas up, which the composite doesn't know about; framed mode accounts
      // for that via hiddenShift, plain mode assumes the chrome is not stacked
      // above a chart. That holds everywhere this is used today.)
      clone.querySelectorAll('[data-noshot="1"]').forEach((n) => n.remove());

      if (!framed) {
        // Plain mode drops the chrome here (framed mode does it at the very end
        // of this callback, after its index-paired children loop). Either way it
        // happens AFTER the canvas pairing above, never before.
        clone.querySelectorAll("[data-capture-hide]").forEach((n) => n.remove());
        return;
      }

      // ── Framed mode: expand the clone and bake in the title band ──────────
      clone.style.position = "relative";
      // Explicit px height — never auto/0 (gotcha 2) — plus room for the band.
      clone.style.height = `${captureH}px`;
      clone.style.maxHeight = "none";
      clone.style.overflow = "visible";
      clone.style.paddingTop = `${SNAP_BAND_H + SNAP_BAND_GAP}px`;
      const tbl = clone.querySelector("table") as HTMLElement | null;
      if (tbl) {
        tbl.style.height = `${contentH}px`;
      } else {
        // Grid/card layout (e.g. options chain): un-clamp the flex scroll body
        // so every row renders and the clone collapses to its real content
        // height — no blank space below the data box. Pair clone children with
        // the LIVE element's children to read real rendered heights, since the
        // clone isn't laid out yet.
        const liveKids = Array.from(el.children) as HTMLElement[];
        Array.from(clone.children).forEach((c, i) => {
          const ch = c as HTMLElement;
          const live = liveKids[i];
          ch.style.flex = "none";
          ch.style.flexShrink = "0";
          // A flex-1 chart card holds its chart via absolute inset-0 children,
          // so height:auto collapses it to 0. Pin the real rendered height.
          // The clamped offsetHeight is deliberate and sufficient: `overflow`
          // is forced to visible on the next line, so a scroll body still
          // paints all of its rows outside that box. (Pinning scrollHeight
          // here instead produces a byte-identical capture — verified — so
          // there is no reason to change it.)
          const liveH = live ? live.offsetHeight : ch.offsetHeight;
          if (liveH > 0) ch.style.height = `${liveH}px`;
          ch.style.overflow = "visible";
        });
      }
      // Gotcha 1: inject the band as real DOM, not as canvas draw calls.
      const inter = "var(--font-inter), Inter, Arial, sans-serif";
      const band = doc.createElement("div");
      band.style.cssText = [
        "position:absolute", "top:0", "left:0", "right:0",
        "padding:8px 12px 8px", `background:${bg}`,
        `height:${SNAP_BAND_H}px`, "box-sizing:border-box",
        // Deliberately NOT overflow:hidden — with the explicit line-heights
        // below the band cannot outgrow its height, and clipping its own
        // watermark is the exact failure this is guarding against.
        "z-index:9999", "pointer-events:none",
      ].join(";");
      const t1 = doc.createElement("div");
      t1.textContent = titleText;
      t1.style.cssText = `font:700 15px/${BAND_TITLE_LH}px ${inter};color:${HOME_THEME.text};white-space:nowrap;`;
      const t2 = doc.createElement("div");
      t2.textContent = SNAP_WATERMARK;
      t2.style.cssText = `font:700 11px/${BAND_WATERMARK_LH}px ${inter};color:rgba(255,255,255,0.7);white-space:nowrap;margin-top:3px;`;
      band.appendChild(t1);
      band.appendChild(t2);
      clone.appendChild(band);
      // Drop live-page chrome LAST — the children loop above pairs clone kids to
      // live kids by index, so removing anything before it desyncs them. The
      // attribute survives cloneNode, so no index matching is needed here.
      clone.querySelectorAll("[data-capture-hide]").forEach((n) => n.remove());
    },
  });

  // ── Composite the live canvas bitmaps (gotcha 5) ──────────────────────────
  const ctx = base.getContext("2d");
  if (ctx) {
    const elRect = el.getBoundingClientRect();
    const paint = (src: HTMLCanvasElement, rect: DOMRect) => {
      if (!src.width || !src.height) return;
      ctx.drawImage(
        src,
        (rect.left - elRect.left) * scale,
        (rect.top - elRect.top + bandShift - hiddenShift) * scale,
        rect.width * scale,
        rect.height * scale,
      );
    };
    // The lightweight-charts provider hands us its own correctly rendered
    // bitmap; draw it at the chart layer's position.
    if (lt) paint(lt.canvas, lt.target.getBoundingClientRect());
    for (const liveCanvas of otherLiveCanvases) {
      paint(liveCanvas, liveCanvas.getBoundingClientRect());
    }
  }

  // Cut the reserved slack back to a fixed margin by measuring actual pixels —
  // the only estimate-free way to get "no clipped last row AND no black void".
  // fitContent additionally trims the right-hand edge.
  if (framed) {
    const trimmed = trimTrailingBackground(base, bg, scale, { right: fitContent });
    if (trimmed) return trimmed;
  }

  return base;
}

/**
 * Parse "#rgb" / "#rrggbb" / "rgb(a)(...)" to an [r,g,b] triple. Null if the
 * format isn't one of those.
 */
function parseColor(c: string): [number, number, number] | null {
  const s = c.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (d) => d + d) : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/**
 * Trim uniform background off the bottom (and optionally the right) edge, down
 * to SNAP_BOTTOM_PAD. Null when there is nothing worth re-encoding.
 */
function trimTrailingBackground(
  base: HTMLCanvasElement,
  bg: string,
  scale: number,
  opts: { right?: boolean } = {},
): HTMLCanvasElement | null {
  try {
    const ctx = base.getContext("2d");
    if (!ctx || base.width <= 4 || base.height <= 4) return null;
    const { width: bw, height: bh } = base;
    const data = ctx.getImageData(0, 0, bw, bh).data;
    // Reference against the background we actually asked html2canvas to paint,
    // not a sampled corner pixel. Corner sampling breaks whenever content
    // reaches the bottom-right — which is the normal case for a wide table
    // captured at width:fit-content, like the mult-greek grid. When that
    // happened the reference colour WAS content, so "differs from background"
    // inverted and the crop bounds came out arbitrary: a PNG cut off in a
    // place that corresponds to nothing on screen.
    const parsed = parseColor(bg);
    const ci = ((bh - 2) * bw + (bw - 2)) * 4;
    const [bgR, bgG, bgB] = parsed ?? [data[ci], data[ci + 1], data[ci + 2]];
    const isContent = (i: number) =>
      Math.abs(data[i] - bgR) + Math.abs(data[i + 1] - bgG) + Math.abs(data[i + 2] - bgB) > 24;
    let bottom = bh - 1;
    outerY: for (let y = bh - 1; y >= 0; y--) {
      for (let x = 0; x < bw; x += 2) {
        if (isContent((y * bw + x) * 4)) { bottom = y; break outerY; }
      }
    }
    let right = bw - 1;
    if (opts.right) {
      outerX: for (let x = bw - 1; x >= 0; x--) {
        for (let y = 0; y <= bottom; y += 2) {
          if (isContent((y * bw + x) * 4)) { right = x; break outerX; }
        }
      }
    }
    // Same scale the capture ran at — not devicePixelRatio, which differs from
    // it on >2x displays and made the padding inconsistent there.
    const pad = Math.round(SNAP_BOTTOM_PAD * scale);
    const newH = Math.min(bh, bottom + 1 + pad);
    const newW = Math.min(bw, right + 1 + pad);
    // Only re-encode if the crop removes something meaningful.
    if (newH >= bh - 4 && newW >= bw - 4) return null;
    // Backstop: this trims blank margin, so a crop that throws away most of the
    // image means the scan misread the background, not that 80% of the capture
    // was empty. Return the uncropped bitmap rather than a mangled one.
    if (newH < bh * 0.2 || newW < bw * 0.2) return null;
    const out = document.createElement("canvas");
    out.width = newW;
    out.height = newH;
    const octx = out.getContext("2d")!;
    octx.fillStyle = bg;
    octx.fillRect(0, 0, newW, newH);
    octx.drawImage(base, 0, 0);
    return out;
  } catch {
    return null; // tainted canvas or getImageData failure — return uncropped
  }
}

/** Capture to a PNG data URL. */
export async function captureToDataUrl(el: HTMLElement, opts: SnapOptions = {}): Promise<string> {
  return (await captureToCanvas(el, opts)).toDataURL("image/png");
}

/** Capture to a PNG blob. */
export async function captureToBlob(el: HTMLElement, opts: SnapOptions = {}): Promise<Blob> {
  const canvas = await captureToCanvas(el, opts);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("canvas.toBlob returned null");
  return blob;
}

/** Save a PNG blob to the user's downloads. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Put a PNG on the clipboard, falling back to a download.
 *
 * Clipboard image writes need a secure context and aren't implemented
 * everywhere (Firefox, older Safari), so a failed write saves the file instead —
 * the snapshot always lands somewhere. Returns which one happened.
 */
export async function copyOrDownload(blob: Blob, filename: string): Promise<"copied" | "saved"> {
  try {
    // Promise-valued rather than Blob-valued because Safari only accepts that
    // form, and it types cleanly against both lib.dom signatures.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": Promise.resolve(blob) })]);
    return "copied";
  } catch {
    downloadBlob(blob, filename);
    return "saved";
  }
}

/** Capture and copy in one call — the common case for a snapshot button. */
export async function captureAndCopy(
  el: HTMLElement,
  filename: string,
  opts: SnapOptions = {},
): Promise<"copied" | "saved"> {
  return copyOrDownload(await captureToBlob(el, opts), filename);
}
