import { useEffect, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// The container every chart mounts into.
//
// It exists to enforce two rules.
//
// 1. CHARTS ARE SIZED AND UPDATED IMPERATIVELY. The render callback receives a
//    stable element and its measured size; it must not cause React renders on
//    data ticks. Pair this with watchFrame() from src/data/hooks.ts and the
//    chart library's own .update() API.
//
//    Resize is debounced and delivered through a ref, because a chart library
//    re-laying-out on every pixel of a drag is one of the most expensive things
//    a dashboard can do.
//
// 2. A CHART THAT NOBODY CAN SEE DOES NOT PAINT. The board mounts N cards on
//    ONE main thread sharing ONE animation frame. On a four-card board the
//    difference is nothing; on a scrolling twelve-card board the cards below
//    the fold are, between them, most of the frame budget — spent on pixels
//    inside a clipped scroll container that no one is looking at. Nothing in
//    the browser stops that on its own: an offscreen <canvas> accepts draw
//    calls exactly as fast as an onscreen one.
//
//    So this frame tracks its own visibility (IntersectionObserver, plus the
//    tab's own visibility) and hands it to the renderer three ways:
//
//      • `handle.visible()` — a predicate a per-frame loop can check.
//      • `onVisibility(visible)` — an edge callback for an on-demand renderer
//        that needs to repaint the work it skipped.
//      • `data-visible="1"|"0"` on the element — how scripts/perf-check.mjs
//        tells an idle card from a hidden one, and how you check it by eye in
//        devtools.
//
//    Visibility is deliberately GENEROUS: rootMargin extends the viewport by
//    200px, so a card is painted just before it is scrolled into view rather
//    than a frame after. The gate exists to skip work nobody will see, not to
//    save the last hundred pixels of scroll.
//
//    IMPORTANT: this frame does not (and cannot) stop a renderer painting. It
//    only reports. A renderer that ignores all three signals is not gated, and
//    scripts/perf-check.mjs is what says so out loud.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChartHandle {
  el: HTMLDivElement
  width: number
  height: number
  /**
   * Is this frame worth painting right now? False when the card is scrolled
   * out of the board's viewport, or the browser tab is in the background.
   *
   * Safe to call from inside a requestAnimationFrame loop — it reads a
   * closed-over boolean, it does not query layout.
   */
  visible: () => boolean
}

export interface ChartFrameProps {
  /**
   * Called once when the element is ready. Return a cleanup function.
   * Do all chart creation here — never in a render.
   */
  onMount: (handle: ChartHandle) => (() => void) | void
  /** Called on debounced resize. Call your chart's resize API here. */
  onResize?: (width: number, height: number) => void
  /**
   * Called when the frame enters or leaves view (and on tab show/hide).
   * An on-demand renderer should stop painting on `false` and repaint whatever
   * it skipped on `true`. A per-frame loop should use `handle.visible()`
   * instead — it does not need the edge.
   *
   * Not called for the initial state; read `handle.visible()` in onMount.
   */
  onVisibility?: (visible: boolean) => void
  className?: string
  /** ms to wait after the last resize event. */
  debounceMs?: number
  /**
   * How far outside the viewport still counts as visible. Bigger = paint
   * sooner when scrolling, at the cost of painting more cards.
   */
  rootMargin?: string
}

export function ChartFrame({
  onMount,
  onResize,
  onVisibility,
  className = '',
  debounceMs = 80,
  rootMargin = '200px',
}: ChartFrameProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const onMountRef = useRef(onMount)
  onMountRef.current = onMount
  const onResizeRef = useRef(onResize)
  onResizeRef.current = onResize
  const onVisibilityRef = useRef(onVisibility)
  onVisibilityRef.current = onVisibility
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Both halves of "can this be seen". Start optimistic: the observer's first
    // callback is asynchronous, and a first paint that is thrown away costs far
    // less than a card that renders blank for a frame on every single mount.
    let onScreen = true
    let tabAwake = !document.hidden
    const visible = () => onScreen && tabAwake

    let last = visible()
    el.dataset.visible = last ? '1' : '0'
    const publish = () => {
      const now = visible()
      el.dataset.visible = now ? '1' : '0'
      if (now === last) return
      last = now
      onVisibilityRef.current?.(now)
    }

    const rect = el.getBoundingClientRect()
    const cleanup = onMountRef.current({ el, width: rect.width, height: rect.height, visible })
    setReady(true)

    // Default root = the viewport, but the intersection rect is clipped by
    // every scrolling ancestor — which is what makes this work for a card
    // inside the board's own overflow-y-auto container.
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (!entry) return
        onScreen = entry.isIntersecting
        publish()
      },
      { rootMargin },
    )
    io.observe(el)

    const onTabChange = () => {
      tabAwake = !document.hidden
      publish()
    }
    document.addEventListener('visibilitychange', onTabChange)

    let timer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => onResizeRef.current?.(width, height), debounceMs)
    })
    ro.observe(el)

    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onTabChange)
      io.disconnect()
      ro.disconnect()
      cleanup?.()
    }
  }, [debounceMs, rootMargin])

  return (
    <div
      ref={ref}
      data-ready={ready}
      className={['min-h-0 min-w-0 flex-1', className].filter(Boolean).join(' ')}
    />
  )
}
