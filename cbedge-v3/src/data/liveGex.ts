import { useEffect, useMemo, useState } from 'react'
import { useFrame } from './hooks'
import { send } from './socket'
import { computeGEXProfile, findGEXFlip, type ChainRow, type GEXProfile } from './calculations'
import type { AuxFrame, GexFrame, SpotFrame, StatusFrame } from '@/contract/frames'

// ─────────────────────────────────────────────────────────────────────────────
// useLiveGex — the live-GEX layer, in the shape the premarket board reads.
//
// This is v2's hooks/useMobileGex.ts rebuilt on v3's plumbing, and it is much
// shorter than the original for one reason: v2's hook owned a subscription, a
// frame coalescer, a REST watchdog and a reconnect handler, and in v3 all four
// of those live below the hook —
//
//   subscription + reconnect   data/socket.ts
//   coalescing                 data/store.ts (one rAF, all frames)
//   last-known state           data/cache.ts (painted under the first frame)
//
// so what is left here is the part that was ever about GEX: read three frames,
// pin the expiry, derive the flip and the profile.
//
// The REST fallback v2 carried (/api/gex on a poll when the socket had been
// silent) is deliberately NOT reproduced. server-v2 DEDUPES the `gex` frame —
// an unchanged chain broadcasts nothing at all — so "silent" is a normal
// overnight state rather than evidence of a broken socket, and v3 answers the
// same problem better: the connect SNAPSHOT replays the whole ladder on every
// (re)connect, and the IndexedDB cache paints the last known one before that.
// A watchdog poll on top of those would fire nightly against a working feed.
//
// ── SPX ONLY ────────────────────────────────────────────────────────────────
// The socket carries ONE underlying. Every other ticker gets the same shape
// from pages/premarket/chainGex.ts, off /api/chains on a poll.
// ─────────────────────────────────────────────────────────────────────────────

export type GexDataMode = 'oi-vol' | 'vol-only'

export interface LiveGexState {
  chain: ChainRow[]
  spot: number
  prevClose: number
  flip: number | null
  callWall: number | null
  putWall: number | null
  totalNetGex: number | null
  /** The expiry on screen. Always today's when the market lists one. */
  expiry: string
  /**
   * False when today has no listed expiry (weekend, holiday) and the feed's
   * front expiry is showing instead — so a page can say "FRONT" rather than
   * lying with a "0DTE" badge.
   */
  isZeroDte: boolean
  /** Front ES future last, from the feed's `aux` frame. 0 when unknown. */
  esFut: number
  /**
   * ES − SPX basis, or null when it cannot be trusted.
   *
   * Only the LIVE pair is used. Cash SPX freezes at 16:00 while ES keeps
   * trading, so after the bell the difference stops being a basis at all —
   * and a level drawn 14 points wrong is worse than a level not drawn.
   */
  basis: number | null
  /** Client-side GEX profile for the flip curve — never a fetch. */
  profile: GEXProfile | null
  connected: boolean
  /** True once any data has landed. */
  hasData: boolean
  updatedAt: number | null
}

/** ET calendar date, not the device's — a trader in London gets New York's 0DTE. */
function todayEt(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function useLiveGex(dataMode: GexDataMode = 'oi-vol'): LiveGexState {
  const gex = useFrame<GexFrame>('gex')
  const spotFrame = useFrame<SpotFrame>('spot')
  const aux = useFrame<AuxFrame>('aux')
  const status = useFrame<StatusFrame>('status')

  const chain = (gex?.data?.gexRows ?? []) as ChainRow[]
  const spot = num(spotFrame?.data?.spot)
  const prevClose = num(spotFrame?.data?.prevClose)
  const esFut = num(aux?.data?.esFut)
  const callWall = gex?.data?.callWall ?? null
  const putWall = gex?.data?.putWall ?? null
  const serverFlip = gex?.data?.gexFlip ?? null
  const totalNetGex = gex?.data?.totalNetGex ?? null
  const updatedAt = gex?.data?.updatedAt ?? gex?.ts ?? null

  const expirations = useMemo<string[]>(() => {
    const raw = (status as { expirations?: unknown } | undefined)?.expirations
    return Array.isArray(raw) ? (raw as string[]) : []
  }, [status])

  const feedExpiry = String(gex?.data?.expiry ?? (status as { expiry?: unknown } | undefined)?.expiry ?? '')

  /**
   * Pin the feed to today's expiry as soon as the expirations list arrives.
   *
   * server-v2 tracks the chosen expiry PER CONNECTION, so this has to be
   * re-asserted after every reconnect — including the ones data/socket.ts makes
   * when the topic scope changes. `send()` queues while the socket is down and
   * replays on open, which is exactly that guarantee; the local `pinned` state
   * only stops the effect re-sending the same request on every render.
   */
  const [pinned, setPinned] = useState('')
  const today = todayEt()
  const wantToday = expirations.includes(today)
  useEffect(() => {
    if (!wantToday) return
    if (pinned === today) return
    setPinned(today)
    send({ type: 'SET_EXPIRY', expiry: today })
  }, [wantToday, today, pinned])

  const expiry = wantToday ? today : feedExpiry

  // findGEXFlip is a pure client computation, and preferred over the server's
  // value because it is derived from the exact rows on screen — so the flip
  // line and the bars under it can never disagree.
  const flip = useMemo(() => findGEXFlip(chain, spot) ?? serverFlip, [chain, spot, serverFlip])
  const profile = useMemo(
    () => (chain.length ? computeGEXProfile(chain, spot, dataMode) : null),
    [chain, spot, dataMode],
  )

  // Live pair only, and only when the difference is in the range a real ES−SPX
  // basis occupies. Anything outside it means one of the two legs is stale.
  const basis = useMemo(() => {
    if (esFut <= 0 || spot <= 0) return null
    const b = esFut - spot
    return Math.abs(b) <= 120 ? b : null
  }, [esFut, spot])

  return {
    chain,
    spot,
    prevClose,
    esFut,
    basis,
    flip,
    callWall,
    putWall,
    totalNetGex,
    expiry,
    isZeroDte: expiry === today,
    profile,
    connected: gex !== undefined || spotFrame !== undefined,
    hasData: chain.length > 0,
    updatedAt,
  }
}

/** v2's name for this hook, so a ported page's import list reads unchanged. */
export const useMobileGex = useLiveGex
