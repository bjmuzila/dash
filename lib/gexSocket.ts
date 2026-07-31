"use client";

import { useEffect, useRef } from "react";

/**
 * Single shared /ws/gex connection for the whole app.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every consumer used to open its own `new WebSocket(.../ws/gex)`. On
 * /es-candles that meant THREE sockets on one page load (the toolbar ticker,
 * the ES candle feed, and the page's own GEX-levels listener), each receiving a
 * full copy of the same broadcast — 3x the server fan-out, 3x the bytes, and 3x
 * the JSON.parse work per frame on a feed that pushes continuously. The count
 * grew with every new card that wanted the feed.
 *
 * Now: ONE socket, refcounted. Consumers subscribe; the socket opens on the
 * first subscriber and closes shortly after the last one leaves. Frames are
 * parsed ONCE here and the parsed object is handed to every subscriber.
 *
 * SNAPSHOT REPLAY
 * ---------------
 * With a socket per consumer, each one got a fresh `snapshot` frame on connect.
 * Sharing one socket breaks that for anything mounting later (a lazy route
 * mounting after the toolbar already connected would sit empty until the next
 * server publish). So the last frame of each *state* type is cached and
 * replayed to new subscribers synchronously. One-shot notices
 * (regime-fit-updated, …) are deliberately NOT cached — replaying those would
 * re-fire a stale event.
 *
 * BANDWIDTH GATE
 * --------------
 * Unchanged: each consumer still passes its own `useWsLifecycle()` boolean.
 * A consumer with the gate off simply doesn't subscribe, and the socket is open
 * iff at least one consumer wants it. Same policy, one connection.
 */

export type GexMessage = Record<string, unknown> & {
  type?: string;
  data?: unknown;
};

export interface GexSubscriber {
  onMessage?: (msg: GexMessage) => void;
  /** Fired on open/close, and once immediately on subscribe with current state. */
  onStatus?: (connected: boolean) => void;
}

/** Frame types that carry STATE (safe + necessary to replay to late joiners). */
const REPLAYABLE = new Set([
  "snapshot",
  "gex",
  "GEX_UPDATE",
  "spot",
  "aux",
  "esCandles",
  "es1mCandles",
]);

const subscribers = new Set<GexSubscriber>();
/** Last frame seen per replayable type, in arrival order. */
const lastByType = new Map<string, GexMessage>();

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;

/**
 * Grace period before tearing down after the last unsubscribe. StrictMode
 * double-mounts and client-side route changes both unsubscribe-then-resubscribe
 * within a tick; without this the socket would drop and immediately reconnect.
 */
const CLOSE_GRACE_MS = 500;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30_000;

function emitStatus(connected: boolean) {
  for (const s of [...subscribers]) {
    try {
      s.onStatus?.(connected);
    } catch {
      /* a broken consumer must not take down the feed */
    }
  }
}

function isLive() {
  return socket?.readyState === WebSocket.OPEN;
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (!subscribers.size) return;
  clearReconnect();
  // Exponential backoff, capped. The old per-consumer sockets each retried on a
  // flat 2-2.5s forever, so a backend outage meant N sockets hammering it.
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempts);
  attempts += 1;
  reconnectTimer = setTimeout(openSocket, delay);
}

function openSocket() {
  if (typeof window === "undefined") return;
  if (!subscribers.size) return;
  if (
    socket &&
    (socket.readyState === WebSocket.CONNECTING ||
      socket.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  let sock: WebSocket;
  try {
    sock = new WebSocket(`${proto}//${window.location.host}/ws/gex`);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = sock;

  sock.onopen = () => {
    if (socket !== sock) return;
    attempts = 0;
    emitStatus(true);
  };

  sock.onmessage = (evt) => {
    if (socket !== sock) return;
    let msg: GexMessage;
    // Parsed ONCE for all subscribers (previously once per socket per frame).
    try {
      msg = JSON.parse(String(evt.data)) as GexMessage;
    } catch {
      return;
    }
    const type = String(msg?.type ?? "");
    if (REPLAYABLE.has(type)) lastByType.set(type, msg);
    for (const s of [...subscribers]) {
      try {
        s.onMessage?.(msg);
      } catch {
        /* isolate consumer errors — one bad handler must not kill the others */
      }
    }
  };

  sock.onerror = () => {
    try {
      sock.close();
    } catch {
      /* ignore */
    }
  };

  sock.onclose = () => {
    if (socket !== sock) return;
    socket = null;
    emitStatus(false);
    scheduleReconnect();
  };
}

function teardown() {
  clearReconnect();
  const sock = socket;
  socket = null;
  if (!sock) return;
  sock.onmessage = sock.onerror = sock.onclose = null;
  if (sock.readyState === WebSocket.CONNECTING) {
    // Closing a CONNECTING socket throws in some browsers — wait for open.
    sock.onopen = () => {
      try {
        sock.close();
      } catch {
        /* ignore */
      }
    };
  } else {
    sock.onopen = null;
    try {
      sock.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Subscribe to the shared feed. Returns an unsubscribe function.
 * Safe to call from anywhere; the socket is managed for you.
 */
export function subscribeGex(sub: GexSubscriber): () => void {
  subscribers.add(sub);

  // A pending teardown means someone else just left — cancel it, we're staying.
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  // Give the new subscriber the current state immediately, exactly like the
  // per-consumer socket used to via its own `snapshot` frame on connect.
  const live = isLive();
  try {
    sub.onStatus?.(live);
  } catch {
    /* ignore */
  }
  if (live) {
    // snapshot first (it's the full-state frame), then any newer deltas.
    const snap = lastByType.get("snapshot");
    if (snap) {
      try {
        sub.onMessage?.(snap);
      } catch {
        /* ignore */
      }
    }
    for (const [type, msg] of lastByType) {
      if (type === "snapshot") continue;
      try {
        sub.onMessage?.(msg);
      } catch {
        /* ignore */
      }
    }
  }

  openSocket();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    subscribers.delete(sub);
    if (subscribers.size) return;
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (subscribers.size) return; // someone re-subscribed during the grace
      teardown();
    }, CLOSE_GRACE_MS);
  };
}

/**
 * React binding. `enabled` is the caller's bandwidth gate (useWsLifecycle() &&
 * whatever else the caller cares about). Handlers are read through refs, so
 * passing inline closures does NOT churn the subscription.
 */
export function useGexSocket(
  enabled: boolean,
  onMessage: (msg: GexMessage) => void,
  onStatus?: (connected: boolean) => void
) {
  const msgRef = useRef(onMessage);
  msgRef.current = onMessage;
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  useEffect(() => {
    if (!enabled) return;
    return subscribeGex({
      onMessage: (m) => msgRef.current?.(m),
      onStatus: (c) => statusRef.current?.(c),
    });
  }, [enabled]);
}
