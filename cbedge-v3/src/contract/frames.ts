// ─────────────────────────────────────────────────────────────────────────────
// THE WIRE CONTRACT — WebSocket side.
//
// This file is the seam between v3 and server-v2. If a frame is not described
// here, v3 does not know about it. Nothing in src/ may reach for a field that
// is not in this file.
//
// Fill these in as you wire each panel. Every entry should be transcribed from
// what server-v2/websocket-server.js actually emits — read the emitter, do not
// infer the shape from a console.log.
// ─────────────────────────────────────────────────────────────────────────────

/** Every message off the socket is a tagged union on `type`. */
export interface BaseFrame {
  type: string
  /** Server-side timestamp, ms epoch, where the emitter provides one. */
  ts?: number
}

// ── Scalar frames ────────────────────────────────────────────────────────────
// Small and high-frequency. Note these are NOT implicitly included when the
// socket is topic-scoped — server-v2 drops them like any other frame unless
// they are named. The topic derivation in src/data/socket.ts handles that
// automatically because it derives from what is actually subscribed.

export interface SpotFrame extends BaseFrame {
  type: 'spot'
  // TODO(contract): transcribe real fields from server-v2/websocket-server.js
  [k: string]: unknown
}

export interface AuxFrame extends BaseFrame {
  type: 'aux'
  [k: string]: unknown
}

export interface StatusFrame extends BaseFrame {
  type: 'status'
  [k: string]: unknown
}

// ── Add real frames below as each panel is built ─────────────────────────────
// export interface GexFrame extends BaseFrame { type: 'gex'; ... }

export type KnownFrame = SpotFrame | AuxFrame | StatusFrame

/**
 * Frames that server-v2 pushes via broadcastEvent(), which ignores topic
 * scoping entirely. Requesting these as topics is a no-op at best and
 * confusing at worst, so the topic deriver filters them out.
 *
 * Carried over from v2's hard-won rules — see AGENTS.md in the v2 repo.
 */
export const BROADCAST_ONLY: ReadonlySet<string> = new Set([
  'regime-fit-updated',
  'pairs-regime-updated',
])

/** Narrow an unknown parsed message to something with a usable `type`. */
export function isFrame(v: unknown): v is BaseFrame {
  return typeof v === 'object' && v !== null && typeof (v as BaseFrame).type === 'string'
}
