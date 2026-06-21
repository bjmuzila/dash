"use client";

import { useEffect, useRef, useState } from "react";

export interface StreamQuote {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  timestamp: number;
}

interface UseTastytradeStreamOptions {
  symbols: string[];
  enabled?: boolean;
}

export function useTastytradeStream({
  symbols,
  enabled = true,
}: UseTastytradeStreamOptions) {
  const [quotes, setQuotes] = useState<Record<string, StreamQuote>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const attemptRef = useRef(0);

  const symbolsKey = symbols.join(",");

  useEffect(() => {
    if (!enabled || symbols.length === 0) return;

    // This effect owns one socket. Reset the teardown guard on (re)mount so a
    // socket from a previous run can't suppress this one's lifecycle.
    unmountedRef.current = false;
    attemptRef.current = 0;
    const subSymbols = symbolsKey.split(",").filter(Boolean);

    const scheduleReconnect = () => {
      if (unmountedRef.current) return;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      // Exponential backoff capped at 30s (3s, 6s, 12s, 24s, 30s…) so a flapping
      // upstream doesn't get hammered every 3s by every open tab.
      const delay = Math.min(3000 * 2 ** attemptRef.current, 30_000);
      attemptRef.current += 1;
      reconnectRef.current = setTimeout(connect, delay);
    };

    async function connect() {
      if (unmountedRef.current) return;
      try {
        // 1. Get session + streamer token from our API route
        const res = await fetch("/api/tastytrade", { method: "POST" });
        if (!res.ok) throw new Error("Failed to get TT session");
        const { streamer_token, dxfeed_url } = await res.json();
        if (unmountedRef.current) return; // unmounted during the await

        // 2. Connect to DXFeed WebSocket
        const ws = new WebSocket(dxfeed_url);
        wsRef.current = ws;

        ws.onopen = () => {
          attemptRef.current = 0; // reset backoff on a clean connect
          setConnected(true);
          setError(null);

          // 3. Auth handshake
          ws.send(JSON.stringify({ type: "SETUP", channel: 0, keepaliveTimeout: 60, acceptKeepaliveTimeout: 60, version: "0.1" }));
          ws.send(JSON.stringify({ type: "AUTH", channel: 0, token: streamer_token }));
          // 4. Subscribe to symbols
          ws.send(JSON.stringify({
            type: "CHANNEL_REQUEST",
            channel: 1,
            service: "FEED",
            parameters: { contract: "AUTO" },
          }));
          ws.send(JSON.stringify({
            type: "FEED_SUBSCRIPTION",
            channel: 1,
            add: subSymbols.map((s) => ({ type: "Quote", symbol: s })),
          }));
        };

        ws.onmessage = (evt) => {
          try {
            const msgs = JSON.parse(evt.data);
            const arr = Array.isArray(msgs) ? msgs : [msgs];
            for (const msg of arr) {
              if (msg.type === "FEED_DATA" && msg.data) {
                const [eventType, ...fields] = msg.data;
                if (eventType === "Quote") {
                  // DXFeed Quote fields: symbol, bidPrice, askPrice, ...
                  const [sym, , bidPrice, , askPrice] = fields;
                  setQuotes((prev) => ({
                    ...prev,
                    [sym]: {
                      symbol: sym,
                      price: (bidPrice + askPrice) / 2,
                      bid: bidPrice,
                      ask: askPrice,
                      timestamp: Date.now(),
                    },
                  }));
                }
              }
            }
          } catch {
            // ignore parse errors
          }
        };

        ws.onerror = () => { setError("WebSocket error"); try { ws.close(); } catch {} };
        ws.onclose = () => {
          setConnected(false);
          scheduleReconnect();
        };
      } catch (e) {
        setError(String(e));
        scheduleReconnect(); // token fetch / construction failed — retry with backoff
      }
    }

    connect();
    return () => {
      // Tear down for real: stop any pending reconnect, then detach handlers so
      // the close we trigger can't schedule a new (orphaned) reconnect loop.
      unmountedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        try { ws.close(); } catch {}
      }
    };
  }, [enabled, symbolsKey]);

  return { quotes, connected, error };
}
