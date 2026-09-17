import { useEffect, useState } from 'react'
import { boot } from '@/boot/types'
import { socketState } from '@/data/socket'
import { stats } from '@/data/store'

// ─────────────────────────────────────────────────────────────────────────────
// The numbers that matter, on screen, all the time in dev.
//
// LCP and TTI are the wrong metrics for this app. What matters is:
//
//   paint      how long until the user sees the shell
//   1st frame  how long until the first message arrives from the server
//   flush/s    how often the store notifies — the render-storm canary
//
// If "1st frame" creeps past ~900ms cold, something reintroduced a waterfall.
// If "flush/s" sits near the display refresh rate while idle, something is
// writing to the store on a timer that should be event-driven.
//
// Dev-only: App.tsx imports this behind import.meta.env.DEV so it is tree-shaken
// out of the production bundle entirely. Toggle with the ` key.
// ─────────────────────────────────────────────────────────────────────────────

const READY_LABEL = ['connecting', 'open', 'closing', 'closed']

export default function PerfOverlay() {
  const [, tick] = useState(0)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '`') setOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(id)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const b = boot()
  const s = socketState()
  const st = stats()

  const ms = (v: number | null) => (v === null ? '—' : `${Math.round(v)}ms`)

  if (!open) return null

  return (
    <div className="tabular pointer-events-none fixed bottom-2 right-2 z-50 rounded-sm border border-line bg-surface/95 px-2.5 py-2 text-xs leading-relaxed text-muted shadow-lg">
      <Row label="paint" value={ms(b.firstPaintAt)} />
      <Row label="1st frame" value={ms(b.firstFrameAt)} warn={(b.firstFrameAt ?? 0) > 900} />
      <Row label="flush/s" value={st.flushesPerSec.toFixed(1)} warn={st.flushesPerSec > 30} />
      <Row label="socket" value={READY_LABEL[s.ready] ?? String(s.ready)} />
      <Row label="topics" value={s.topics ? String(s.topics.length) : 'all'} />
      <Row label="types" value={`${st.subscribedTypes}/${st.types}`} />
      <div className="mt-1 text-faint">` to hide</div>
    </div>
  )
}

function Row({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-faint">{label}</span>
      <span className={warn ? 'text-warn' : 'text-fg'}>{value}</span>
    </div>
  )
}
