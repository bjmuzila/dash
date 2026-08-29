// ─────────────────────────────────────────────────────────────────────────────
// THE WIRE CONTRACT — WebSocket side.
//
// This file is the seam between v3 and server-v2. If a frame is not described
// here, v3 does not know about it. Nothing in src/ may reach for a field that
// is not in this file.
//
// Transcribed from server-v2 source, not inferred from a log:
//   - envelope + spot:  server-v2/websocket-server.js (msg(), the 'spot' push)
//   - gex:              server-v2/websocket-server.js (the 'gex' push) +
//                        server-v2/computation/gex-calculator.js (computeGexRows)
//   - aux:              server-v2/websocket-server.js (the 'aux' push)
//   - flow:             server-v2/websocket-server.js (the 'flow' push) +
//                        server-v2/computation/flow-processor.js (FlowAggregator)
//
// There is NO 'chain' (options chain) topic on the socket — that data is REST
// only (/api/chains, /api/gex — see src/data/api.ts callers). Don't invent one.
// ─────────────────────────────────────────────────────────────────────────────

/** Every message off the socket is `{ type, symbol, ts, data }` — msg() in
 *  server-v2/websocket-server.js wraps every push this way. */
export interface BaseFrame {
  type: string
  symbol?: string
  /** Server-side timestamp, ms epoch, where the emitter provides one. */
  ts?: number
}

// ── spot ─────────────────────────────────────────────────────────────────────
export interface SpotData {
  spot: number
  prevClose: number
  /**
   * ⚠ esFut − spot, and NOT a usable ES/SPX basis. server-v2/es-spx-basis.js
   * documents why: the broker's "SPX" quote really tracks ES, so this value
   * collapses toward zero and then freezes on the expired contract across a
   * quarterly roll. Anything converting SPX strikes to ES prices must use
   * /proxy/es-spx-basis instead. Kept in the contract because it is on the
   * wire, not because anything should read it.
   */
  basis: number
}
export interface SpotFrame extends BaseFrame {
  type: 'spot'
  data: SpotData
}

// ── gex ──────────────────────────────────────────────────────────────────────
// One row per strike, straight off computeGexRows(). Only the fields v3
// actually reads are given real types; the rest ride along as unknown so a
// future consumer isn't blocked on this file, but nothing here is invented.
export interface GexRow {
  strike: number
  /**
   * The spot computeGexRows() priced THIS row at. Not the live tick — the live
   * tick is the `spot` frame, and it has moved since. It is here so a consumer
   * recomputing a leg (the GEX Chart's call/put split) can price it at the same
   * spot the row's own `netGEX` was priced at and land on the same number.
   */
  spotPrice?: number
  netGEX: number
  netVolGEX: number
  callGEX: number
  putGEX: number
  callOI: number
  putOI: number
  callVolume: number
  putVolume: number
  callGamma: number
  putGamma: number
  dte: number
  /**
   * ── The three OPTIONAL exposure legs ──────────────────────────────────────
   *
   * All three come off computeGexRows() unconditionally, so on the socket path
   * they are always there. They are optional HERE because the other producer of
   * this shape — board/chainGex.ts, which derives a ladder from /api/chains for
   * every non-socket ticker — cannot always fill them:
   *
   *   netDEX / volNetDEX  delta × contracts × spot × 100 — the OI leg and the
   *                       volume leg of dealer DELTA exposure. The chain path
   *                       fills them when the feed carries a delta on the leg.
   *   flowGEX             gamma × the DEALER'S OWN signed inventory, built from
   *                       the classified tape. There is no tape for anything
   *                       but the socket symbol, so the chain path never fills
   *                       it — which is why the chart's FLOW basis falls back
   *                       to net instead of drawing an empty pane.
   *
   * Read them through gexChart/gexChartRender.ts's accessors rather than
   * inline, so "which fields make up which basis" is answered in one place.
   */
  netDEX?: number
  volNetDEX?: number
  flowGEX?: number
  [k: string]: unknown
}
export interface GexData {
  gexRows: GexRow[]
  callWall: number | null
  putWall: number | null
  gexFlip: number | null
  totalNetGex: number
  totals: unknown
  expiry?: string
  updatedAt?: number
}
export interface GexFrame extends BaseFrame {
  type: 'gex'
  data: GexData
}

// ── aux ──────────────────────────────────────────────────────────────────────
// The slow scalars that ride alongside spot. Same `basis` caveat as above.
export interface AuxData {
  vix: number
  esFut: number
  basis: number
  vixPrevClose: number
  esFutPrevClose: number
  spotDisplay: number
}
export interface AuxFrame extends BaseFrame {
  type: 'aux'
  data: AuxData
}

// ── flow ─────────────────────────────────────────────────────────────────────
export interface FlowTapePrint {
  ts: number
  underlying: string
  expiration: string
  strike: number
  type: 'call' | 'put' | string
  side: string
  action: string
  bucket: string
  price: number
  size: number
  premium: number
  isOtm: boolean
}
export interface FlowData {
  symbol: string
  windowMs: number
  asOf: number
  callBuyVol: number
  callSellVol: number
  putBuyVol: number
  putSellVol: number
  netPremium: number
  buyPct: number
  prints: number
  tape: FlowTapePrint[]
}
export interface FlowFrame extends BaseFrame {
  type: 'flow'
  data: FlowData
}

// ── low-value scalar frames — shape not needed by any panel yet ─────────────
export interface StatusFrame extends BaseFrame {
  type: 'status'
  [k: string]: unknown
}

export type KnownFrame = SpotFrame | GexFrame | FlowFrame | AuxFrame | StatusFrame

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
