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
 *     the real bitmaps in ourselves, into the boxes measured in the clone
 *     (gotcha 11).
 *  6. `background-clip: text` renders INVISIBLE. Gradient headings must be
 *     flattened to a solid color in the clone (see `data-snap-plain`).
 *  8. `overflow:hidden` on a truncated text span SHEARS the glyphs — only the
 *     top few pixels survive. Neither ellipsis nor text clipping is really
 *     implemented, so the truncation idiom is dropped for the capture.
 *  7. `backdrop-filter` is not implemented at all. Frosted panels come out as
 *     their raw low-alpha background over whatever the capture background is,
 *     which reads as washed out. We swap them to the solid panel color.
 *  9. `allowTaint:false` does NOT protect a SAME-ORIGIN url that REDIRECTS to a
 *     foreign host. html2canvas decides whether to request an image in CORS mode
 *     by looking at the src string: a relative `/proxy/ticker-logo?...` reads as
 *     same-origin, so it is fetched without `crossOrigin`, the 302 lands on a
 *     third-party CDN, and the drawn image taints the canvas anyway — `toBlob()`
 *     then throws SecurityError and the whole PNG is lost over a 16px logo. The
 *     src heuristic cannot see the redirect, so those images are REMOVED from
 *     the clone instead (`stripUntrustedImages`) and replaced with a ticker-text
 *     placeholder. See `allowTaint` in SnapOptions.
 * 10. `canvas.toBlob()` yields NULL when the bitmap is too big to encode. A
 *     full-page capture of a long list at devicePixelRatio 2 gets there easily,
 *     so the scale is clamped to a pixel budget before rendering and the encode
 *     retries once at half size.
 * 11. The clone's layout is NOT the live page's layout, so the bitmaps from
 *     gotcha 5 cannot be positioned from live rects plus a hand-computed shift.
 *     Every drift (the title band's padding, dropped chrome, a row that
 *     re-flows, a portal that isn't in the subtree) had to be predicted, and one
 *     that wasn't put the ES Candles chart ~150px above its own panel, over the
 *     toolbar and the watermark, with a void where the chart should have been.
 *     The clone is a laid-out document by the time `onclone` runs and
 *     html2canvas crops at the clone root's own box — so the boxes are MEASURED
 *     there (see SNAP_TAG) and the composite draws into what was measured.
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
 * Marker attribute stamped on the live nodes whose bitmaps get composited, so
 * their counterparts can be found — and MEASURED — in the clone (gotcha 11).
 * Applied only for the duration of one capture and always removed afterwards.
 * Deliberately distinct from data-capture-hide / data-noshot: those say what to
 * DROP, this one says what to LOCATE.
 */
const SNAP_TAG = "data-snap-composite";

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
  /**
   * Hug the target: pin the CLONE to its measured content height instead of the
   * full `captureH`, so `SNAP_BOTTOM_SLACK` is reserved on the page background
   * BELOW the element rather than inside it.
   *
   * Why this exists: framed mode sets `clone.style.height = captureH`, which
   * bakes the 48px slack into the element itself. That is invisible on a target
   * whose background matches `SNAP_BG` — but a CARD paints its own frosted panel
   * fill, so the slack came out as a band of card interior under the last row,
   * and `trimTrailingBackground` cannot remove it: those pixels are not the
   * capture background, they are the card. The Level Log PNG was the reported
   * case — dead space between the last entry and the card's bottom border.
   *
   * With this flag the card ends where its content ends (bottom border and
   * radius sit right under the last row) and the slack lands on plain
   * background, which trims back to SNAP_BOTTOM_PAD exactly as designed.
   *
   * Only for targets that are themselves a bordered/filled card. Leave it off
   * for full-page or background-colored captures — there is nothing to hug.
   */
  hugTarget?: boolean;
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
  /**
   * html2canvas `allowTaint`. Defaults to TRUE — that is what every existing
   * caller has always had, so do not flip the default.
   *
   * Set FALSE when the subtree can contain images from a host that will not
   * send CORS headers. `/proxy/ticker-logo` 302s to third-party hosts, and
   * drawing one of those into the canvas TAINTS it; `canvas.toBlob()` then
   * throws SecurityError and the whole screenshot dies over a 16px image. With
   * allowTaint:false html2canvas SKIPS any image it cannot read, so the cost is
   * a missing logo rather than a missing snapshot.
   *
   * html2canvas's own skipping is NOT enough on its own — see gotcha 9: it
   * classifies by the src string, so a same-origin URL that redirects off-site
   * is fetched in no-CORS mode and taints regardless of this flag. So this flag
   * ALSO switches on `stripUntrustedImages()`, which drops those images from the
   * clone (anything `[data-snap-untrusted]`, anything under `/proxy/`, and any
   * cross-origin src) and leaves a ticker-text chip in their place.
   *
   * An option rather than the default because the trade runs the other way for
   * the chart panels: they carry no foreign images, and allowTaint:true is the
   * more forgiving setting for anything that fails a CORS preflight.
   */
  allowTaint?: boolean;
  /**
   * html2canvas `imageTimeout` (ms) — how long the clone waits on any one image
   * before giving up on it. html2canvas's own default is 15000ms, long enough
   * that a single stalled image holds the whole capture (and any
   * onBeforeCapture layout switch, like mult-greek's fit-content mode) hostage
   * for 15 seconds. Page-scale captures pass a short value: a skipped image
   * costs a logo, not the snapshot.
   */
  imageTimeout?: number;
  /**
   * Watchdog for the WHOLE capture, in ms. Defaults to CAPTURE_WATCHDOG_MS.
   *
   * html2canvas can stall indefinitely — observed on /mult-greek, where the
   * capture promise never settled: no error was ever logged, the clipboard
   * never got its PNG, the button sat on "…", and the page was left stuck in
   * its fit-content capture layout until a reload. A promise that never
   * settles skips every catch/finally downstream, so nothing could recover.
   * The watchdog turns that silent hang into a rejection: the button shows ✕,
   * the error reaches the console, and onAfterCapture/restore paths run.
   */
  timeoutMs?: number;
  /**
   * Chart-only capture mode (ES Candles' Snap/Discord buttons): skip the
   * framed band + DOM-clone pipeline entirely and bake these two labels
   * straight onto the chart's OWN bitmap (from `takeScreenshot()`) instead —
   * no toolbar, no stat row, no border, no title band. Only takes effect when
   * the target exposes `__ltScreenshot`; every other capture site is
   * untouched by this option.
   */
  cornerLabels?: { topLeft?: string; bottomLeft?: string };
};

/** Default whole-capture watchdog. Generous — real captures finish in <5s. */
export const CAPTURE_WATCHDOG_MS = 20000;

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
 * Chromium refuses to allocate a canvas past ~16384px on either axis, and
 * `toBlob()` returns null well before that when the total pixel count gets
 * large. The budget below is deliberately conservative: a capture that comes
 * back one third smaller is still a capture, whereas a null blob is nothing.
 */
const MAX_CANVAS_DIM = 16384;
const MAX_CANVAS_PIXELS = 24_000_000;

/** Clamp a requested scale so the rendered bitmap stays inside the budget. */
function fitScale(scale: number, cssW: number, cssH: number): number {
  if (!(cssW > 0) || !(cssH > 0)) return scale;
  const byDim = Math.min(MAX_CANVAS_DIM / cssW, MAX_CANVAS_DIM / cssH);
  const byArea = Math.sqrt(MAX_CANVAS_PIXELS / (cssW * cssH));
  // Never scale UP past what was asked for, and never below 0.5 — a capture
  // that unreadable is not worth producing.
  return Math.max(0.5, Math.min(scale, byDim, byArea));
}

/** Half-size copy of a canvas, for the toBlob retry. Null if it can't be made. */
function downscaleCanvas(src: HTMLCanvasElement, factor: number): HTMLCanvasElement | null {
  try {
    const w = Math.max(1, Math.round(src.width * factor));
    const h = Math.max(1, Math.round(src.height * factor));
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src, 0, 0, w, h);
    return out;
  } catch {
    return null; // tainted source — a copy would be tainted too
  }
}

/**
 * Gotcha 9: remove images that would taint the canvas, so `toBlob()` can export.
 *
 * Risky = tagged `[data-snap-untrusted]` (the caller knows the URL redirects),
 * anything under `/proxy/` (our resolvers 302 to third-party hosts), or a plain
 * cross-origin src. Each one is replaced by a same-size chip carrying the img's
 * `alt` text — visually the same fallback ChipLogo shows when a logo 404s, so a
 * capture degrades to "ticker instead of logo" rather than failing outright.
 *
 * Runs on the CLONE only; the live page keeps its logos.
 */
function stripUntrustedImages(doc: Document, root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  // Tag test, not `instanceof`: these nodes belong to html2canvas's about:blank
  // iframe, so they are instances of THAT window's HTMLImageElement and every
  // `instanceof` against ours is false.
  if (root.tagName === "IMG") imgs.push(root as HTMLImageElement);
  const pageUrl = typeof window !== "undefined" ? window.location.href : "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  for (const img of imgs) {
    const raw = img.getAttribute("src") || "";
    if (!raw || raw.startsWith("data:")) continue;
    let risky = img.hasAttribute("data-snap-untrusted");
    if (!risky) {
      try {
        // Resolve against the LIVE page URL. `doc.baseURI` in the clone is
        // about:blank, which makes every relative src unparseable — that would
        // strip the mirrored /logos/*.png files, which are the ones that work.
        const u = new URL(raw, pageUrl || undefined);
        risky = u.origin !== origin || u.pathname.startsWith("/proxy/");
      } catch {
        risky = true; // unparseable src — assume the worst, it's one logo
      }
    }
    if (!risky) continue;

    const w = Number(img.getAttribute("width")) || img.width || 0;
    const h = Number(img.getAttribute("height")) || img.height || 0;
    const label = (img.getAttribute("alt") || "").slice(0, 4);
    const chip = doc.createElement("span");
    chip.textContent = label;
    chip.setAttribute("style", [
      "display:inline-flex", "align-items:center", "justify-content:center",
      "box-sizing:border-box", "overflow:hidden", "line-height:1",
      w ? `width:${w}px` : "", h ? `height:${h}px` : "",
      "border-radius:7px",
      `background:${HOME_THEME.cyan}1A`,
      `border:1px solid ${HOME_THEME.border}`,
      `color:${HOME_THEME.cyan}`,
      "font-weight:800",
      `font-size:${Math.max(9, Math.round((h || 24) / 3))}px`,
    ].filter(Boolean).join(";"));
    img.replaceWith(chip);
  }
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

  // ── Gotcha 9: 3D card flips rasterize as BOTH faces at once ───────────────
  // html2canvas has no 3D pipeline. It ignores `transform-style: preserve-3d`
  // and `backface-visibility: hidden` outright, but it DOES keep the 2D part of
  // the matrix — so a back face parked at `rotateY(180deg)` is painted as a
  // horizontal MIRROR image, stacked on top of the front face. That is the
  // "screenshot took both sides and put them on one" bug on the scanner's GEX
  // Change cards: front text and back text overlaid, the back one reversed.
  //
  // The DOM alone can't say which face is showing (the rotation lives on the
  // parent and may be mid-transition), so a flip container opts in by declaring
  // it: `data-flip3d="front" | "back"` on the rotating element, `data-face` on
  // each face. Here the hidden face is switched off, the visible one is
  // flattened, and the rotation is dropped — the capture ends up as a plain 2D
  // stack of one face, matching what is on screen.
  //
  // Style-only, per this function's contract: `display:none` KEEPS the node, so
  // the live↔clone canvas pairing by index downstream is untouched.
  root.querySelectorAll<HTMLElement>("[data-flip3d]").forEach((flipper) => {
    const showBack = flipper.getAttribute("data-flip3d") === "back";
    flipper.style.transform = "none";
    flipper.style.transition = "none";
    flipper.style.transformStyle = "flat";
    flipper.style.willChange = "auto";
    flipper.querySelectorAll<HTMLElement>("[data-face]").forEach((face) => {
      // Only this flipper's own faces — never a nested card's.
      if (face.closest("[data-flip3d]") !== flipper) return;
      const isBack = face.getAttribute("data-face") === "back";
      if (isBack === showBack) {
        face.style.transform = "none";
        face.style.backfaceVisibility = "visible";
        face.style.setProperty("-webkit-backface-visibility", "visible");
      } else {
        face.style.display = "none";
      }
    });
  });
  // `perspective` on the tile is meaningless once the rotation is gone, and
  // html2canvas mis-handles it on some paths.
  root.querySelectorAll<HTMLElement>('[style*="perspective"]').forEach((n) => {
    if (n.style.perspective) n.style.perspective = "none";
  });
  if (root.style.perspective) root.style.perspective = "none";

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

  // ── Gotcha 10: pill text rides high/low in the capture ────────────────────
  // The app centers badge text the CSS way: fixed `height` + a matching
  // `line-height`, so the glyphs sit on the line box's optical centre. html2canvas
  // does not use the line box. It takes the text node's bounding rect, then draws
  // at `top + fontMetrics.ascent` for the font IT resolved — and the clone lives
  // in an about:blank iframe where `var(--font-inter)` does not resolve, so the
  // fallback's ascent is not the one the live box was sized for. The taller the
  // line box relative to the font, the further that error throws the glyphs:
  // a 12px label in a 20px pill lands visibly off centre.
  //
  // Fix, part 1: for anything opted in with `data-cap-center`, stop centering
  // with a line box at all. Collapse `line-height` to 1 and re-express the
  // difference as vertical padding, so the box hugs the text and there is no
  // leading left for a wrong ascent to mis-split.
  //
  // Fix, part 2: part 1 alone still left every label sitting LOW in its pill,
  // because html2canvas's baseline is not the font's ascent — see
  // `captureBaselineBias()`. The padding is therefore split asymmetrically by the
  // measured bias, which pushes the glyphs back onto the box's optical centre.
  // Same painted height, same border, and the live page is untouched — this only
  // ever runs on the clone.
  const biasCache = new Map<string, number>();
  root.querySelectorAll<HTMLElement>("[data-cap-center]").forEach((n) => {
    const cs = styleOf(n);
    const h = parseFloat(n.style.height || "");
    const fs = parseFloat(n.style.fontSize || "") || parseFloat(cs?.fontSize || "") || 12;
    const bias = biasFor(n, fs, biasCache);

    if (h > 0) {
      // border-box: the declared height already contains the 1px borders.
      const bt = parseFloat(n.style.borderTopWidth || "") || (n.style.border ? 1 : 0);
      const bb = parseFloat(n.style.borderBottomWidth || "") || (n.style.border ? 1 : 0);
      const slack = Math.max(0, h - bt - bb - fs);
      // Collapsing the line box only works because the padding replaces it —
      // `slack` is exactly what the old `height` reserved around the glyphs.
      n.style.height = "auto";
      n.style.lineHeight = "1";
      setSplitPadding(n, slack / 2 - bias, slack);
    } else {
      // No declared height: the box is sized by its own padding, so leave both
      // the height and the line box alone and only move the text inside it.
      shiftTextByBias(n, bias, cs);
    }
    // inline-flex centering is its own html2canvas hazard (it lays the child out
    // but still draws text from the rect's top) — force the simple flow box.
    if ((n.style.display || "").includes("flex")) n.style.display = "inline-block";
  });

  // Same bias, no opt-in: the app's segmented switches and toolbar chips are
  // padding-sized <button>s (`homeButtonStyle`), not fixed-height pills, so
  // there is no line box to rewrite — the label was simply drawn ~2px low inside
  // the button. That is the TestLab Tape Field switcher (HEATMAP / TERRAIN /
  // GEX × DEX) and every control shaped like it. Text-only buttons only: one
  // with element children could be an icon + label whose parts would shift
  // apart, and the padding swap is a no-op on a button with no top padding, so
  // this can never resize a control.
  root.querySelectorAll<HTMLElement>("button").forEach((n) => {
    if (n.hasAttribute("data-cap-center")) return;
    if (n.firstElementChild) return;
    if (!(n.textContent || "").trim()) return;
    const cs = styleOf(n);
    const fs = parseFloat(cs?.fontSize || "") || parseFloat(n.style.fontSize || "") || 12;
    shiftTextByBias(n, biasFor(n, fs, biasCache), cs);
  });
}

/** Computed style of a cloned node, or null if the clone has no view yet. */
function styleOf(n: HTMLElement): CSSStyleDeclaration | null {
  const view = n.ownerDocument ? n.ownerDocument.defaultView : null;
  return view ? view.getComputedStyle(n) : null;
}

/** `captureBaselineBias` for an element, with its font resolved off the clone. */
function biasFor(n: HTMLElement, fontSize: number, cache: Map<string, number>): number {
  const cs = styleOf(n);
  // Computed, not inline: `var(--font-sans)` has to be resolved before the probe
  // can measure the family html2canvas will actually draw with.
  const family = cs?.fontFamily || n.style.fontFamily || "sans-serif";
  const weight = cs?.fontWeight || n.style.fontWeight || "400";
  return captureBaselineBias(n.ownerDocument, family, weight, fontSize, cache);
}

/**
 * Write `padTop` / `total - padTop` as the element's vertical padding, clamped
 * so neither side goes negative — a negative pad would shrink the box and move
 * the border, and the whole point is that only the TEXT moves.
 */
function setSplitPadding(n: HTMLElement, padTop: number, total: number): void {
  let top = padTop;
  let bottom = total - top;
  if (top < 0) { bottom = Math.max(0, bottom + top); top = 0; }
  if (bottom < 0) { top = Math.max(0, top + bottom); bottom = 0; }
  n.style.paddingTop = `${top}px`;
  n.style.paddingBottom = `${bottom}px`;
}

/**
 * Move an element's text up by `bias` without changing anything else about it:
 * the vertical padding is re-split, so the sum — and therefore the painted box —
 * is identical. A box with no top padding has nowhere to give and is left alone.
 */
function shiftTextByBias(n: HTMLElement, bias: number, cs: CSSStyleDeclaration | null): void {
  const pt = parseFloat(cs?.paddingTop || "") || 0;
  const pb = parseFloat(cs?.paddingBottom || "") || 0;
  if (!(pt > 0) && bias > 0) return;
  setSplitPadding(n, pt - bias, pt + pb);
}

/** 1x1 GIF — the same probe image html2canvas measures its own metrics with. */
const PROBE_GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * How many px LOWER than the browser html2canvas will draw a run of text.
 *
 * html2canvas paints every run at `textRect.top + baseline`, and that `baseline`
 * comes from its own probe (`FontMetrics.parseMetrics` in the bundle): an inline
 * <span> of sample text followed by a 1px baseline-aligned <img>, measured with
 * INTEGER `offsetTop`s and then padded by a hardcoded `+ 2`. The result overshoots
 * the real ascent by ~1–2px, so EVERY label is drawn low — which inside a
 * fixed-height pill is exactly the "text doesn't sit in the middle of the box"
 * the wall log's PNG showed.
 *
 * The overshoot depends on the font the CLONE resolved and on the font size, so
 * it is measured, not guessed: run html2canvas's probe verbatim, compare it with
 * where the baseline really is (the 1px img's bottom edge sits on it), and return
 * the difference.
 *
 * The probe is appended to the clone document's <body> and removed again before
 * returning — never inside `root`, so the canvas index-pairing downstream is
 * untouched. Cached per capture, per font + weight + size.
 */
function captureBaselineBias(
  doc: Document,
  fontFamily: string,
  fontWeight: string,
  fontSize: number,
  cache: Map<string, number>,
): number {
  const key = `${fontFamily}|${fontWeight}|${fontSize}`;
  const hit = cache.get(key);
  if (hit != null) return hit;

  let bias = 0;
  try {
    const host = doc.body || doc.documentElement;
    const size = `${fontSize}px`;
    const container = doc.createElement("div");
    const span = doc.createElement("span");
    const img = doc.createElement("img");
    container.style.cssText =
      "visibility:hidden;position:absolute;left:-99999px;top:0;margin:0;padding:0;white-space:nowrap;";
    container.style.fontFamily = fontFamily;
    container.style.fontSize = size;
    span.style.cssText = "margin:0;padding:0;";
    span.style.fontFamily = fontFamily;
    span.style.fontSize = size;
    span.style.fontWeight = fontWeight;
    span.appendChild(doc.createTextNode("Hidden Text"));
    img.src = PROBE_GIF;
    img.width = 1;
    img.height = 1;
    img.style.cssText = "margin:0;padding:0;vertical-align:baseline;";
    container.appendChild(span);
    container.appendChild(img);
    host.appendChild(container);

    const assumed = img.offsetTop - span.offsetTop + 2; // what html2canvas will use
    const actual = img.getBoundingClientRect().bottom - span.getBoundingClientRect().top;
    container.remove();
    if (Number.isFinite(assumed) && Number.isFinite(actual)) bias = assumed - actual;
  } catch {
    bias = 0;
  }
  // A sub-pixel-to-2px nudge, never a layout move. If the probe comes back wild
  // (no layout yet, a font that failed to load), ignore it rather than shove the
  // label out of its box.
  if (!Number.isFinite(bias) || Math.abs(bias) > 4) bias = 0;
  cache.set(key, bias);
  return bias;
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
    // Watchdog: html2canvas's promise is not guaranteed to settle (see the
    // timeoutMs doc above — /mult-greek hung forever with zero symptoms). Race
    // it so a stall becomes a normal, catchable failure. If the stalled
    // capture does resolve later its canvas is simply discarded.
    const ms = opts.timeoutMs ?? CAPTURE_WATCHDOG_MS;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      watchdog = setTimeout(
        () => reject(new Error(
          `[snapshot] capture timed out after ${ms}ms — html2canvas never settled ` +
          `(stalled image or resource in the clone?)`,
        )),
        ms,
      );
    });
    try {
      return await Promise.race([captureToCanvasInner(el, opts), timeout]);
    } finally {
      if (watchdog !== undefined) clearTimeout(watchdog);
    }
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
  const hugTarget = !!opts.hugTarget;

  // A lightweight-charts target (ES Candles) is a FLEX COLUMN (chart card +
  // lanes), not a bare bitmap. It happens to contain a <canvas>, but it must
  // take the flex-summation path below — not the bare-canvas fast path — or
  // html2canvas clips to the clamped flex height and captures only the bottom
  // of the chart. Detect it via the __ltScreenshot hook.
  const ltProvider = (el as unknown as { __ltScreenshot?: LtProvider }).__ltScreenshot;
  const lt = ltProvider?.();

  // ── Corner-label chart-only capture ───────────────────────────────────────
  // See SnapOptions.cornerLabels. Returns straight from the chart's own
  // bitmap — no html2canvas, no band, no chrome.
  if (opts.cornerLabels && lt) {
    const src = lt.canvas;
    const rect = lt.target.getBoundingClientRect();
    const cScale = rect.width > 0 ? src.width / rect.width : (opts.scale ?? snapScale());
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const octx = out.getContext("2d")!;
    octx.drawImage(src, 0, 0);
    const drawCorner = (text: string | undefined, corner: "top" | "bottom") => {
      if (!text) return;
      const fontPx = Math.round(11 * cScale);
      octx.font = `700 ${fontPx}px Inter, Arial, sans-serif`;
      octx.textBaseline = "alphabetic";
      const padX = Math.round(8 * cScale);
      const padY = Math.round(6 * cScale);
      const inset = Math.round(8 * cScale);
      const tw = octx.measureText(text).width;
      const boxW = tw + padX * 2;
      const boxH = fontPx + padY * 2;
      const x = inset;
      const y = corner === "top" ? inset : out.height - boxH - inset;
      octx.fillStyle = "rgba(6,12,20,0.55)";
      octx.fillRect(x, y, boxW, boxH);
      octx.fillStyle = "rgba(255,255,255,0.92)";
      octx.fillText(text, x + padX, y + boxH - padY - Math.round(fontPx * 0.22));
    };
    drawCorner(opts.cornerLabels.topLeft, "top");
    drawCorner(opts.cornerLabels.bottomLeft, "bottom");
    return out;
  }

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
  const requestedScale = opts.scale ?? snapScale();
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

  // NOTE: `hiddenShift` below is now only the FALLBACK for a composite target
  // whose clone box could not be measured — see gotcha 11 and `cloneBoxes`. It
  // is kept because a measurement can legitimately come back empty (a clone box
  // of zero size), and a rough position beats none.
  //
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

  // Gotcha 10: clamp the scale to the canvas budget. A whole-page capture of a
  // long list (the /economic-calendar earnings tab, every row expanded) at
  // devicePixelRatio 2 renders a bitmap big enough that toBlob() hands back
  // null — no error, no PNG. Measured against the dimensions actually being
  // rendered, so ordinary panels keep the full 2x.
  const budgetW = contentW || Math.round(el.getBoundingClientRect().width) || el.clientWidth || 0;
  const budgetH = captureH || el.scrollHeight || 0;
  const scale = fitScale(requestedScale, budgetW, budgetH);

  // ── Gotcha 11: composite where the CLONE put the box, not where the live
  // page put it ─────────────────────────────────────────────────────────────
  // The composited bitmaps used to be positioned from LIVE rects, offset by
  // `bandShift - hiddenShift` — an estimate of how far the clone's layout had
  // moved relative to the page. Every source of clone/live drift had to be
  // predicted and subtracted by hand, and any one that wasn't put the chart
  // somewhere it isn't: on /es-candles the candle bitmap landed ~150px above
  // its own panel, straight over the toolbar and the watermark band, with a
  // matching void at the bottom of the PNG where the chart should have been.
  //
  // The clone is laid out in a real (iframe) document by the time `onclone`
  // runs, and html2canvas crops at the clone root's own box — so the clone can
  // simply be MEASURED. Every canvas we intend to composite is tagged here, its
  // clone counterpart's rect is recorded relative to the clone root at the very
  // end of `onclone` (after every removal and style change, so it reflects the
  // final layout), and the composite draws into that. No estimate, no drift,
  // and it holds for anything that moves the clone — dropped chrome, the title
  // band's padding, a reflow, a portal that isn't in the subtree.
  //
  // The live-rect math is kept as the fallback for anything that has no
  // measurable counterpart (a canvas whose clone is display:none, or a
  // capture path where onclone never ran).
  const cloneBoxes = new Map<string, { left: number; top: number; width: number; height: number }>();
  const tagged: Element[] = [];
  const tag = (n: Element, v: string) => { n.setAttribute(SNAP_TAG, v); tagged.push(n); };
  otherLiveCanvases.forEach((c, i) => tag(c, `c${i}`));
  if (lt) tag(lt.target, "lt");

  const base = await html2canvas(el, {
    backgroundColor: bg,
    useCORS: true,
    allowTaint: opts.allowTaint ?? true,
    scale,
    logging: false,
    ...(opts.imageTimeout != null ? { imageTimeout: opts.imageTimeout } : {}),
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
        //
        // className as well as cssText: most canvases in this app are sized and
        // positioned by CLASSES ("absolute inset-0", "w-full h-full"), not by
        // inline style, so copying only the inline style handed back a static
        // zero-height div — the box the composite is supposed to land in
        // vanished, and anything laid out around it moved.
        const placeholder = doc.createElement("div");
        placeholder.className = cloned.className;
        placeholder.style.cssText = cloned.style.cssText;
        // Pin the rendered size for a canvas that is IN FLOW. An out-of-flow one
        // (absolute/fixed) is already pinned by its own insets, and forcing a
        // width onto it would fight them.
        const cbox = cloned.getBoundingClientRect();
        const cpos = doc.defaultView?.getComputedStyle(cloned).position ?? "static";
        if ((cpos === "static" || cpos === "relative") && cbox.width > 0 && cbox.height > 0) {
          placeholder.style.width = `${cbox.width}px`;
          placeholder.style.height = `${cbox.height}px`;
        }
        // Carry the composite tag onto the placeholder — the placeholder IS the
        // box the bitmap has to land in, and the canvas it replaces is gone.
        const t = cloned.getAttribute(SNAP_TAG);
        if (t) placeholder.setAttribute(SNAP_TAG, t);
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

      // Gotcha 9: drop images the canvas would not be allowed to export. AFTER
      // the canvas pairing above (an <img> swap cannot move a <canvas>, but the
      // ordering rule there is absolute) and only when the caller has declared
      // the subtree taint-sensitive.
      if (opts.allowTaint === false) stripUntrustedImages(doc, clone);

      // Record where the clone actually put each composite target. Must be the
      // LAST thing either branch does — a rect read before a removal or a style
      // change measures a layout that will not be the one html2canvas renders.
      const measureCloneBoxes = () => {
        const cr = clone.getBoundingClientRect();
        const record = (n: Element) => {
          const key = n.getAttribute(SNAP_TAG);
          if (!key) return;
          const r = n.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return; // no box — fall back to live math
          cloneBoxes.set(key, {
            left: r.left - cr.left, top: r.top - cr.top, width: r.width, height: r.height,
          });
        };
        // The capture target itself can be the lightweight-charts host.
        if (clone.hasAttribute(SNAP_TAG)) record(clone);
        clone.querySelectorAll(`[${SNAP_TAG}]`).forEach(record);
      };

      if (!framed) {
        // Plain mode drops the chrome here (framed mode does it at the very end
        // of this callback, after its index-paired children loop). Either way it
        // happens AFTER the canvas pairing above, never before.
        clone.querySelectorAll("[data-capture-hide]").forEach((n) => n.remove());
        measureCloneBoxes();
        return;
      }

      // ── Framed mode: expand the clone and bake in the title band ──────────
      clone.style.position = "relative";
      // Explicit px height — never auto/0 (gotcha 2) — plus room for the band.
      //
      // hugTarget stops at the content instead of at captureH, leaving the
      // SNAP_BOTTOM_SLACK to fall on the page background below the element
      // where trimTrailingBackground can actually cut it (see the option's
      // doc). +2 covers the element's own top/bottom hairline borders, which
      // the child-height sum in `contentH` does not include. box-sizing is
      // pinned so the padded band is inside that height either way, rather
      // than depending on whatever the page's reset happens to set.
      clone.style.boxSizing = "border-box";
      clone.style.height = hugTarget
        ? `${contentH + SNAP_BAND_H + SNAP_BAND_GAP + 2}px`
        : `${captureH}px`;
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
      measureCloneBoxes();
    },
  // The tags are ours and they sit on the LIVE page — drop them whatever
  // happened, so a failed capture can't leave stray attributes behind.
  }).finally(() => tagged.forEach((n) => n.removeAttribute(SNAP_TAG)));

  // ── Composite the live canvas bitmaps (gotcha 5) ──────────────────────────
  const ctx = base.getContext("2d");
  if (ctx) {
    const elRect = el.getBoundingClientRect();
    // Where the CLONE put the box (gotcha 11), falling back to the live rect
    // plus the estimated shift when there is nothing measured to use.
    const paint = (src: HTMLCanvasElement, rect: DOMRect, key: string) => {
      if (!src.width || !src.height) return;
      const box = cloneBoxes.get(key);
      const x = box ? box.left : rect.left - elRect.left;
      const y = box ? box.top : rect.top - elRect.top + bandShift - hiddenShift;
      const w = box ? box.width : rect.width;
      const h = box ? box.height : rect.height;
      if (w <= 0 || h <= 0) return;
      ctx.drawImage(src, x * scale, y * scale, w * scale, h * scale);
    };
    // The lightweight-charts provider hands us its own correctly rendered
    // bitmap; draw it at the chart layer's position.
    if (lt) paint(lt.canvas, lt.target.getBoundingClientRect(), "lt");
    otherLiveCanvases.forEach((liveCanvas, i) => {
      paint(liveCanvas, liveCanvas.getBoundingClientRect(), `c${i}`);
    });
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

/**
 * Capture to a PNG blob.
 *
 * Gotcha 10: `toBlob()` reports "too big to encode" as a null blob rather than
 * an error. The scale is already clamped to a pixel budget during the render,
 * but the budget is a guess about the encoder's limit and the encode also has
 * to fit in whatever memory the tab has left — so a null result retries once at
 * half size instead of throwing away a capture that already succeeded.
 */
export async function captureToBlob(el: HTMLElement, opts: SnapOptions = {}): Promise<Blob> {
  const canvas = await captureToCanvas(el, opts);
  const encode = (c: HTMLCanvasElement) =>
    new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  let blob = await encode(canvas);
  if (!blob) {
    const half = downscaleCanvas(canvas, 0.5);
    if (half) blob = await encode(half);
  }
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
