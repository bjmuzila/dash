// /home in the SPA — MIGRATION.md seed-swap.
// The Next /home page seeds HomeClient from a server-only /proxy/gex read
// (127.0.0.1 localhost hop, unreachable from the browser). In the SPA we fetch
// the frozen snapshot (/api/home-snapshot, proxied to the backend) for a
// first-paint seed, then HomeClient opens the live /ws/gex socket and takes over.
import { useEffect, useState } from 'react'
import { HomeClient, type HomeInitial } from '@/app/home/HomeClient'

export default function HomeRoute() {
  const [initial, setInitial] = useState<HomeInitial>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/home-snapshot', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        const p = (d?.snapshot ?? null) as Record<string, any> | null
        const rows = Array.isArray(p?.gexRows) ? p!.gexRows : []
        setInitial(
          rows.length
            ? {
                gexRows: rows,
                spot: Number(p!.spot ?? 0),
                spotDisplay: Number(p!.spotDisplay ?? p!.spot ?? 0),
                prevClose: Number(p!.prevClose ?? 0),
                expiry: String(p!.expiry ?? ''),
                expirations: Array.isArray(p!.expirations) ? p!.expirations : [],
                callWall: p!.callWall ?? null,
                putWall: p!.putWall ?? null,
                chartReady: true,
              }
            : null,
        )
      })
      .catch(() => {})
      .finally(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [])

  // Wait for the seed attempt so HomeClient mounts once with its final initial.
  if (!ready) return null
  return <HomeClient initial={initial} />
}
