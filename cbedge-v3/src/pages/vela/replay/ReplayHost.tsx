// The replay dock's mount point on /vela. It renders nothing until the start
// picker opens or a replay runs. Only then does the dock's chunk (ReplayBar +
// the tick source) load, so the page itself carries just this and replay.ts.

import { lazy, Suspense, useSyncExternalStore } from 'react'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { replayStore } from './replay'

const ReplayBar = lazy(() => import('./ReplayBar'))

export function ReplayHost({ ws }: { ws: VelaWorkspace | null }) {
  const s = useSyncExternalStore(replayStore.subscribe, replayStore.get)
  if (!ws || (s.phase === 'off' && !s.picking)) return null
  return (
    <Suspense fallback={null}>
      <ReplayBar ws={ws} />
    </Suspense>
  )
}
