import { useEffect, useRef, useState } from 'react'
import type { ChainRow } from './calc'

// Live GEX feed — ports the /ws/gex consumer from app/home/HomeClient.tsx.
// Seeds from the hot /proxy/gex snapshot (falls back to /api/home-snapshot),
// then keeps everything live off the server-computed GEX broadcast.
// All URLs are relative → Vite dev proxy forwards them to VITE_BACKEND.

export type FeedState = {
  gexRows: ChainRow[]
  spot: number
  spotDisplay: number
  prevClose: number
  spxChange: number
  spxChangePct: number
  vix: number
  esFut: number
  esFutPrevClose: number
  vixPrevClose: number
  callWall: number | null
  putWall: number | null
  expirations: string[]
  expiry: string
  status: string
  chartReady: boolean
}

const EMPTY: FeedState = {
  gexRows: [], spot: 0, spotDisplay: 0, prevClose: 0, spxChange: 0, spxChangePct: 0,
  vix: 0, esFut: 0, esFutPrevClose: 0, vixPrevClose: 0,
  callWall: null, putWall: null, expirations: [], expiry: '', status: 'CONNECTING', chartReady: false,
}

export function useGexFeed(selectedExpiry: string) {
  const [state, setState] = useState<FeedState>(EMPTY)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unmountedRef = useRef(false)
  const expiryRef = useRef(selectedExpiry)
  expiryRef.current = selectedExpiry

  // Push a partial patch into state.
  const patch = (p: Partial<FeedState>) => setState((s) => ({ ...s, ...p }))

  const applyGex = (p: Record<string, unknown>) => {
    const next: Partial<FeedState> = {}
    if (Array.isArray(p.gexRows)) next.gexRows = p.gexRows as ChainRow[]
    const s = Number(p.spot ?? 0)
    if (s > 0) next.spot = s
    const disp = Number(p.spotDisplay ?? 0) > 0 ? Number(p.spotDisplay) : s
    const pc = Number(p.prevClose ?? 0)
    if (disp > 0) {
      next.spotDisplay = disp
      if (pc > 0) {
        next.prevClose = pc
        next.spxChange = disp - pc
        next.spxChangePct = ((disp - pc) / pc) * 100
      }
    }
    if (Number(p.vix ?? 0) > 0) next.vix = Number(p.vix)
    if (Number(p.esFut ?? 0) > 0) next.esFut = Number(p.esFut)
    if (Number(p.vixPrevClose ?? 0) > 0) next.vixPrevClose = Number(p.vixPrevClose)
    if (Number(p.esFutPrevClose ?? 0) > 0) next.esFutPrevClose = Number(p.esFutPrevClose)
    if (p.callWall != null) next.callWall = Number(p.callWall) || null
    if (p.putWall != null) next.putWall = Number(p.putWall) || null
    const exps = p.expirations as string[] | undefined
    if (Array.isArray(exps) && exps.length) {
      next.expirations = exps
      if (!expiryRef.current) next.expiry = String(p.expiry ?? exps[0] ?? '')
    } else if (p.expiry && !expiryRef.current) {
      next.expiry = String(p.expiry)
    }
    next.chartReady = true
    patch(next)
  }

  // Seed once from the hot snapshot so the chart paints before the socket opens.
  useEffect(() => {
    let cancelled = false
    const seed = async () => {
      for (const url of ['/proxy/gex', '/api/home-snapshot']) {
        try {
          const r = await fetch(url, { cache: 'no-store' })
          if (!r.ok) continue
          const j = await r.json()
          const p = (j.snapshot ?? j) as Record<string, unknown>
          if (Array.isArray(p.gexRows) && (p.gexRows as unknown[]).length) {
            if (!cancelled) applyGex(p)
            return
          }
        } catch { /* try next */ }
      }
    }
    seed()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live socket.
  useEffect(() => {
    unmountedRef.current = false

    const handle = (raw: string) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(raw) } catch { return }
      const type = String(msg.type ?? '')
      const data = (msg.data && typeof msg.data === 'object' ? msg.data : msg) as Record<string, unknown>
      switch (type) {
        case 'snapshot':
        case 'gex':
        case 'GEX_UPDATE':
          applyGex(data)
          patch({ status: 'LIVE' })
          break
        case 'spot': {
          const s = Number(data.spot ?? 0)
          const patchP: Partial<FeedState> = {}
          if (s > 0) patchP.spot = s
          const disp = Number(data.spotDisplay ?? 0) > 0 ? Number(data.spotDisplay) : s
          const pc = Number(data.prevClose ?? 0)
          if (disp > 0) {
            patchP.spotDisplay = disp
            if (pc > 0) { patchP.spxChange = disp - pc; patchP.spxChangePct = ((disp - pc) / pc) * 100 }
          }
          patch(patchP)
          break
        }
        case 'aux': {
          const patchP: Partial<FeedState> = {}
          if (Number(data.vix ?? 0) > 0) patchP.vix = Number(data.vix)
          if (Number(data.esFut ?? 0) > 0) patchP.esFut = Number(data.esFut)
          if (Number(data.vixPrevClose ?? 0) > 0) patchP.vixPrevClose = Number(data.vixPrevClose)
          if (Number(data.esFutPrevClose ?? 0) > 0) patchP.esFutPrevClose = Number(data.esFutPrevClose)
          if (Number(data.spotDisplay ?? 0) > 0) patchP.spotDisplay = Number(data.spotDisplay)
          patch(patchP)
          break
        }
        case 'EXPIRATIONS':
        case 'status': {
          const exps = data.expirations as string[] | undefined
          const patchP: Partial<FeedState> = {}
          if (Array.isArray(exps) && exps.length) {
            patchP.expirations = exps
            if (!expiryRef.current) patchP.expiry = String(data.expiry ?? exps[0] ?? '')
          }
          if (typeof data.chartReady === 'boolean') patchP.chartReady = data.chartReady
          patch(patchP)
          break
        }
        default:
          break
      }
    }

    const connect = () => {
      if (unmountedRef.current) return
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${proto}//${window.location.host}/ws/gex`
      let ws: WebSocket
      try { ws = new WebSocket(url) } catch { schedule(); return }
      wsRef.current = ws
      ws.onopen = () => {
        patch({ status: 'LIVE' })
        const exp = expiryRef.current
        if (exp) { try { ws.send(JSON.stringify({ type: 'SET_EXPIRY', expiry: exp })) } catch { /* ignore */ } }
      }
      ws.onmessage = (e) => handle(String(e.data))
      ws.onerror = () => { try { ws.close() } catch { /* ignore */ } }
      ws.onclose = () => { patch({ status: 'RECONNECTING' }); schedule() }
    }
    const schedule = () => {
      if (unmountedRef.current) return
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      reconnectRef.current = setTimeout(connect, 2000)
    }

    connect()
    return () => {
      unmountedRef.current = true
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      const ws = wsRef.current
      wsRef.current = null
      if (ws) { ws.onmessage = ws.onerror = ws.onclose = ws.onopen = null; try { ws.close() } catch { /* ignore */ } }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tell the server to switch expiry when the UI changes it.
  useEffect(() => {
    const ws = wsRef.current
    if (selectedExpiry && ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'SET_EXPIRY', expiry: selectedExpiry })) } catch { /* ignore */ }
    }
  }, [selectedExpiry])

  return state
}
