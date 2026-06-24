"use client";

/**
 * useEsCandles — single source of truth for 5-minute ES futures candles.
 *
 * - Loads today's bars + ~20 days of history from SQLite on mount.
 * - Connects to the server-v2 broadcaster at /ws/gex and merges live `esCandles`
 *   messages (and the `esCandles` field of the initial `snapshot`).
 * - Computes per-slot average volume baselines over the previous 5 and 14
 *   trading days, attached to each of today's bars as avg5 / avg14.
 *
 * Consumed by the Relative Volume card and the live IB Logic component.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import {
  queryEsCandlesToday,
  queryEsCandlesHistorical,
  type EsCandleRecord,
} from "@/lib/snapdb";

export interface EsCandle extends EsCandleRecord {
  avg5?: number;   // avg volume for this 5m slot over previous 5 trading days
  avg14?: number;  // avg volume for this 5m slot over previous 14 trading days
}

function todayETStr(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const m: Record<string, string> = {};
  parts.forEach((p) => { m[p.type] = p.value; });
  return `${m.year}-${m.month}-${m.day}`;
}

function slotTimeOf(c: EsCandleRecord): string {
  // "YYYY-MM-DDTHH:MM" -> "HH:MM"
  return (c.slotKey ?? "").slice(11, 16) || (c.time ?? "").slice(0, 5);
}

function dateOf(c: EsCandleRecord): string {
  return c.date ?? (c.slotKey ?? "").slice(0, 10);
}

/**
 * Average volume per 5-min slot over the last `nDays` distinct trading days
 * (excluding today). Returns a map "HH:MM" -> avg volume.
 */
function buildSlotAverages(historical: EsCandleRecord[], today: string, nDays: number): Map<string, number> {
  // Most recent nDays distinct past dates.
  const dates = [...new Set(historical.map(dateOf).filter((d) => d && d < today))].sort().reverse().slice(0, nDays);
  const dateSet = new Set(dates);
  const acc = new Map<string, { sum: number; days: Set<string> }>();
  for (const c of historical) {
    const d = dateOf(c);
    if (!dateSet.has(d)) continue;
    const vol = Number(c.volume || 0);
    if (!(vol > 0)) continue;
    const slot = slotTimeOf(c);
    if (!slot) continue;
    const e = acc.get(slot) ?? { sum: 0, days: new Set() };
    e.sum += vol;
    e.days.add(d);
    acc.set(slot, e);
  }
  const out = new Map<string, number>();
  for (const [slot, e] of acc) {
    if (e.days.size) out.set(slot, e.sum / e.days.size);
  }
  return out;
}

export function useEsCandles() {
  const shouldConnect = useWsLifecycle();
  const shouldConnectRef = useRef(shouldConnect);
  shouldConnectRef.current = shouldConnect;
  const [todayRows, setTodayRows] = useState<EsCandleRecord[]>([]);
  const [historical, setHistorical] = useState<EsCandleRecord[]>([]);
  const [connected, setConnected] = useState(false);
  const liveMapRef = useRef<Map<string, EsCandleRecord>>(new Map());
  // Live bars for the rolling-session view, kept REGARDLESS of date so the
  // overnight session (prior-day-dated bars) survives — liveMapRef above is
  // today-only and feeds `candles` (IB / RelVol consumers expect today-only).
  const sessionMapRef = useRef<Map<string, EsCandleRecord>>(new Map());
  const [sessionTick, setSessionTick] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  // SQLite load (today + history). Reused by mount and manual reload.
  const loadFromDb = useCallback(async () => {
    const [today, hist] = await Promise.all([queryEsCandlesToday(), queryEsCandlesHistorical(20)]);
    if (unmountedRef.current) return;
    if (hist.length) setHistorical(hist);
    if (today.length) {
      // Merge — never wipe live bars already in the map.
      for (const r of today) {
        if (!liveMapRef.current.has(r.slotKey)) liveMapRef.current.set(r.slotKey, r);
        if (!sessionMapRef.current.has(r.slotKey)) sessionMapRef.current.set(r.slotKey, r);
      }
      setTodayRows([...liveMapRef.current.values()]);
      setSessionTick((n) => n + 1);
    }
  }, []);

  // Initial SQLite load.
  useEffect(() => { loadFromDb().catch(() => {}); }, [loadFromDb]);

  /**
   * Manual refresh — re-pulls from SQLite ONLY when nothing is loaded yet.
   * Never clears existing bars and never resets the IB window; if data is
   * already present this is a no-op so the live range keeps running.
   */
  const refresh = useCallback(async () => {
    if (liveMapRef.current.size > 0) return;
    await loadFromDb();
  }, [loadFromDb]);

  // Live WS merge.
  useEffect(() => {
    unmountedRef.current = false;
    const today = todayETStr();

    const ingest = (rows: unknown) => {
      if (!Array.isArray(rows)) return;
      let changed = false;
      let sessionChanged = false;
      for (const raw of rows as EsCandleRecord[]) {
        if (!raw || !raw.slotKey) continue;
        // Rolling-session map keeps every live bar (incl. overnight, any date).
        sessionMapRef.current.set(raw.slotKey, raw);
        sessionChanged = true;
        // Today set is today-only (feeds `candles` for IB / RelVol).
        if (dateOf(raw) !== today) continue;
        liveMapRef.current.set(raw.slotKey, raw);
        changed = true;
      }
      if (changed) setTodayRows([...liveMapRef.current.values()]);
      if (sessionChanged) setSessionTick((n) => n + 1);
    };

    const handle = (rawMsg: string) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(rawMsg); } catch { return; }
      const type = String(msg.type ?? "");
      const data = (msg.data && typeof msg.data === "object" ? msg.data : msg) as Record<string, unknown>;
      if (type === "snapshot") ingest(data.esCandles);
      else if (type === "esCandles") ingest(Array.isArray(data) ? data : data.esCandles);
    };

    const connect = () => {
      if (unmountedRef.current || !shouldConnectRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      let ws: WebSocket;
      try { ws = new WebSocket(`${proto}//${window.location.host}/ws/gex`); }
      catch { schedule(); return; }
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => handle(String(e.data));
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onclose = () => { setConnected(false); schedule(); };
    };
    const schedule = () => {
      if (unmountedRef.current || !shouldConnectRef.current) return;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(connect, 2500);
    };

    // Value-driven bandwidth gate: re-runs when shouldConnect flips. Connect when
    // allowed; the cleanup tears down when not (no polling).
    if (shouldConnect) connect();
    return () => {
      unmountedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => { try { ws.close(); } catch {} };
        else { ws.onopen = null; try { ws.close(); } catch {} }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldConnect]);

  // Enrich today's bars with 5/14-day slot averages.
  const candles = useMemo<EsCandle[]>(() => {
    const today = todayETStr();
    const avg5 = buildSlotAverages(historical, today, 5);
    const avg14 = buildSlotAverages(historical, today, 14);
    return [...todayRows]
      .sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey))
      .map((c) => {
        const slot = slotTimeOf(c);
        return { ...c, avg5: avg5.get(slot) ?? 0, avg14: avg14.get(slot) ?? 0 };
      });
  }, [todayRows, historical]);

  // Rolling continuous-session view: ~30h of bars regardless of ET date, so the
  // overnight (prior-day-dated) session is included and the chart follows into a
  // new day. Merge DB history with the live session map; live wins on slotKey.
  const sessionCandles = useMemo<EsCandleRecord[]>(() => {
    void sessionTick; // re-run when live session bars arrive
    const WINDOW_MS = 30 * 60 * 60 * 1000;
    const cutoff = Date.now() - WINDOW_MS;
    const map = new Map<string, EsCandleRecord>();
    for (const c of historical) if (c.slotKey && c.timestamp >= cutoff) map.set(c.slotKey, c);
    for (const c of sessionMapRef.current.values()) if (c.timestamp >= cutoff) map.set(c.slotKey, c);
    return [...map.values()].sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey));
  }, [historical, sessionTick]);

  return { candles, sessionCandles, historical, connected, refresh };
}
