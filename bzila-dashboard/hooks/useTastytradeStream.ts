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

  useEffect(() => {
    if (!enabled || symbols.length === 0) return;

    let ws: WebSocket;

    async function connect() {
      try {
        // 1. Get session + streamer token from our API route
        const res = await fetch("/api/tastytrade", { method: "POST" });
        if (!res.ok) throw new Error("Failed to get TT session");
        const { streamer_token, dxfeed_url } = await res.json();

        // 2. Connect to DXFeed WebSocket
        ws = new WebSocket(dxfeed_url);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          setError(null);

          // 3. Auth handshake
          ws.send(JSON.stringify({ type: "SETUP", channel: 0, keepaliveTimeout: 60, acceptKeepaliveTimeout: 60, version: "0.1" }));
          ws.send(JSON.stringify({ type: "AUTH", channel: 0, token: streamer_token }));
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

        ws.onerror = () => setError("WebSocket error");
        ws.onclose = () => {
          setConnected(false);
          // Reconnect after 3s
          setTimeout(connect, 3000);
        };

        // 4. Subscribe to symbols
        ws.addEventListener("open", () => {
          ws.send(JSON.stringify({
            type: "CHANNEL_REQUEST",
            channel: 1,
            service: "FEED",
            parameters: { contract: "AUTO" },
          }));
          ws.send(JSON.stringify({
            type: "FEED_SUBSCRIPTION",
            channel: 1,
            add: symbols.map((s) => ({ type: "Quote", symbol: s })),
          }));
        });
      } catch (e) {
        setError(String(e));
      }
    }

    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [enabled, symbols.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return { quotes, connected, error };
}
