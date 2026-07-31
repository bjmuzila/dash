// /home in the SPA — MIGRATION.md seed-swap.
// The Next /home page seeds HomeClient from a server-only /proxy/gex read
// (127.0.0.1 localhost hop, unreachable from the browser). In the SPA we take
// the frozen snapshot as a first-paint seed, then HomeClient opens the live
// /ws/gex socket and takes over.
//
// The seed now arrives INLINE with the document: app/app/home/route.ts reads it
// server-side and writes window.__SPA_SEED__.homeSnapshot into the shell. That
// removes a serialised round trip — the old fetch could not start until the
// entry chunk and this route chunk had both downloaded and executed, so first
// paint waited on a 4th hop. The fetch is kept as a fallback for when the key
// is absent (seed query timed out, or a shell served before this deploy).
import { useEffect, useState } from 'react'
import { HomeClient, type HomeInitial } from '@/app/home/HomeClient'

type SnapshotEnvelope = { ts?: number | null; snapshot?: Record<string, any> | null } | null

declare global {
  interface Window {
    __SPA_SEED__?: { homeSnapshot?: SnapshotEnvelope }
  }
}

function toInitial(payload: Record<string, any> | null | undefined): HomeInitial {
  const rows = Array.isArray(payload?.gexRows) ? payload!.gexRows : []
  if (!rows.length) return null
  return {
    gexRows: rows,
    spot: Number(payload!.spot ?? 0),
    spotDisplay: Number(payload!.spotDisplay ?? payload!.spot ?? 0),
    prevClose: Number(payload!.prevClose ?? 0),
    expiry: String(payload!.expiry ?? ''),
    expirations: Array.isArray(payload!.expirations) ? payload!.expirations : [],
    callWall: payload!.callWall ?? null,
    putWall: payload!.putWall ?? null,
    chartReady: true,
  }
}

// Read once at module scope: the inline <script> in the shell runs before this
// module is evaluated, so the value is already there on the very first render.
const INLINE_SEED: SnapshotEnvelope =
  typeof window !== 'undefined' ? window.__SPA_SEED__?.homeSnapshot ?? null : null

export default function HomeRoute() {
  const [initial, setInitial] = useState<HomeInitial>(() => toInitial(INLINE_SEED?.snapshot))
  // With an inline seed we are ready on the first render — no blank frame, no
  // network wait. Without one we keep the old behaviour and wait for the fetch
  // so HomeClient still mounts exactly once with its final `initial`.
  const [ready, setReady] = useState(() => INLINE_SEED != null)

  useEffect(() => {
    if (INLINE_SEED != null) return
    let alive = true
    fetch('/api/home-snapshot', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        setInitial(toInitial((d?.snapshot ?? null) as Record<string, any> | null))
      })
      .catch(() => {})
      .finally(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [])

  // Wait for the seed attempt so HomeClient mounts once with its final initial.
  if (!ready) return null
  return <HomeClient initial={initial} />
}
