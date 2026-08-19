// Shape of the object created by the inline script in index.html.
// Nothing else in the app may write to window.__CB_BOOT__ except src/data/socket.ts.

export interface CbBoot {
  /** performance.now() at the moment the inline script ran. */
  t0: number
  /** navigation entry startTime, for absolute timings. */
  navStart: number
  /** Raw messages buffered before the data layer took over. */
  frames: unknown[]
  /** Set by the data layer; once set, frames go straight through. */
  sink: ((raw: unknown) => void) | null
  ws: WebSocket | null
  status: 'connecting' | 'open' | 'closed' | 'error' | 'handoff'
  /** performance.now() of the first message from the server, ever. */
  firstFrameAt: number | null
  /** performance.now() of the first rendered frame. */
  firstPaintAt: number | null
  /** Last-known state read from IndexedDB, started before React booted. */
  cache: Promise<Record<string, unknown>> | null
  error: string | null
}

declare global {
  interface Window {
    __CB_BOOT__: CbBoot
  }
}

export function boot(): CbBoot {
  return window.__CB_BOOT__
}
