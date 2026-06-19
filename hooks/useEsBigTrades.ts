"use client";

/**
 * useEsBigTrades — live front-ES-future big-order footprint.
 *
 * Connects to the server-v2 broadcaster at /ws/gex and reads the `esBigTrades`
 * payload (also present on the initial `snapshot`). The server classifies each
 * ES Trade tick as an aggressive buy (lifted ask) or sell (hit bid), keeps a ring
 * buffer of the largest recent prints, and buckets signed volume per minute.
 *
 * Consumed by the Footprint page (Big Trade Bubbles + Delta Profile).
 */

import { useEffect, useRef, useState } from "react";

export interface EsBigTrade {
  ts: number;
  price: number;
  size: number;
  side: "buy" | "sell";
  signed: number;
}

export interface EsDeltaBucket {
  ts: number;
  buy: number;
  sell: number;
  net: number;
}

export interface EsBigTradesPayload {
  symbol: string | null;
  updatedAt: number;
  seeded: boolean;
  trades: EsBigTrade[];
  delta: EsDeltaBucket[];
}

const EMPTY: EsBigTradesPayload = { symbol: null, updatedAt: 0, seeded: false, trades: [], delta: [] };

export function useEsBigTrades() {
  const [data, setData] = useState<EsBigTradesPayload>(EMPTY);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;

    const ingest = (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const p = payload as Partial<EsBigTradesPayload>;
      setData({
        symbol: p.symbol ?? null,
        updatedAt: Number(p.updatedAt ?? Date.now()),
        seeded: Boolean(p.seeded),
        trades: Array.isArray(p.trades) ? p.trades : [],
        delta: Array.isArray(p.delta) ? p.delta : [],
      });
    };

    const handle = (rawMsg: string) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(rawMsg); } catch { return; }
      const type = String(msg.type ?? "");
      const body = (msg.data && typeof msg.data === "object" ? msg.data : msg) as Record<string, unknown>;
      if (type === "snapshot") {
        if (body.esBigTrades) ingest(body.esBigTrades);
      } else if (type === "esBigTrades") {
        ingest(body);
      }
    };

    const connect = () => {
      if (unmountedRef.current) return;
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
      if (unmountedRef.current) return;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(connect, 2500);
    };

    connect();
    return () => {
      unmountedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(); } catch {} }
    };
  }, []);

  return { ...data, connected };
}
