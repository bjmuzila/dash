import { useEffect, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// The container every chart mounts into.
//
// It exists to enforce one rule: charts are sized and updated IMPERATIVELY.
// The render callback receives a stable element and its measured size; it must
// not cause React renders on data ticks. Pair this with watchFrame() from
// src/data/hooks.ts and the chart library's own .update() API.
//
// Resize is debounced and delivered through a ref, because a chart library
// re-laying-out on every pixel of a drag is one of the most expensive things
// a dashboard can do.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChartHandle {
  el: HTMLDivElement
  width: number
  height: number
}

export interface ChartFrameProps {
  /**
   * Called once when the element is ready. Return a cleanup function.
   * Do all chart creation here — never in a render.
   */
  onMount: (handle: ChartHandle) => (() => void) | void
  /** Called on debounced resize. Call your chart's resize API here. */
  onResize?: (width: number, height: number) => void
  className?: string
  /** ms to wait after the last resize event. */
  debounceMs?: number
}

export function ChartFrame({
  onMount,
  onResize,
  className = '',
  debounceMs = 80,
}: ChartFrameProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const onMountRef = useRef(onMount)
  onMountRef.current = onMount
  const onResizeRef = useRef(onResize)
  onResizeRef.current = onResize
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cleanup = onMountRef.current({ el, width: rect.width, height: rect.height })
    setReady(true)

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
      ro.disconnect()
      cleanup?.()
    }
  }, [debounceMs])

  return (
    <div
      ref={ref}
      data-ready={ready}
      className={['min-h-0 min-w-0 flex-1', className].filter(Boolean).join(' ')}
    />
  )
}
