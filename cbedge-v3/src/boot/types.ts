// Shape of the object created by the inline script in index.html.
// Nothing else in the app may write to window.__CB_BOOT__ except src/data/socket.ts.
// (The three `prefs*` fields are written by that inline script only, and read
// by src/data/prefsSync.ts.)

/** POST /api/user-prefs/sync, as the inline script hands it over: null when the request never got an answer. */
export type PrefsBootResult = { status: number; body: unknown } | null

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
  /** This account's settings, requested before the bundle (src/data/prefsSync.ts). */
  prefs?: Promise<PrefsBootResult> | null
  /** That request's answer, once it has one. `undefined` while it is still out. */
  prefsResult?: PrefsBootResult
  /** Settles when the entry may run: the settings are in, or the wait ran out. */
  prefsReady?: Promise<void> | null
}

declare global {
  interface Window {
    __CB_BOOT__: CbBoot
  }
}

export function boot(): CbBoot {
  return window.__CB_BOOT__
}
