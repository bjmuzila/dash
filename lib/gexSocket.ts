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
  /**
   * Frame types this consumer needs (see TOPICS below). OPTIONAL and opt-in:
   * a subscriber that omits it forces the socket back to the unscoped
   * firehose for as long as it is mounted, which is the safe default for any
   * consumer that has not been audited.
   *
   * List every type your handler branches on. Getting this wrong does not
   * throw — the frames simply stop arriving and the panel quietly goes stale,
   * so err wide. Extra topics cost a few hundred bytes; a missing one costs a
   * broken page.
   */
  topics?: readonly string[];
}

/**
 * The frame types the server can scope on (`/ws/gex?topics=a,b,c`).
 *
 * Server side: `parseTopics`/`scopeSnapshot` in server-v2/websocket-server.js
 * trim the connect snapshot's heavy arrays, and the broadcast loop drops any
 * frame whose type isn't in the set — INCLUDING the small scalar ones (`spot`,
 * `aux`, `status`), so those must be listed explicitly by anyone who reads them.
 *
 * NOT listed here, deliberately: `regime-fit-updated` and `pairs-regime-updated`
 * go out through `broadcastEvent()`, which writes to every open client without
 * consulting `client.topics`. They are unaffected by scoping and must not be
 * requested (an unknown topic is harmless, but listing it implies a filter that
 * doesn't exist).
 */
export const TOPICS = {
  /** Per-strike gexRows + totals. Needed for the snapshot's heavy GEX arrays. */
  gex: "gex",
  /** The flow tape. */
  flow: "flow",
  /** 5-minute ES bars. */
  esCandles: "esCandles",
  /** 1-minute ES bars — its own topic, NOT implied by esCandles. */
  es1mCandles: "es1mCandles",
  /** NQ bars. */
  nqCandles: "nqCandles",
  /** spot / prevClose / basis. */
  spot: "spot",
  /** vix / esFut / spotDisplay / prev closes. */
  aux: "aux",
  /** Feed status, and the expiry + expirations list. */
  status: "status",
} as const;

/** Frame types that carry STATE (safe + necessary to replay to late joiners). */
const REPLAYABLE = new Set([
  "snapshot",
  "gex",
  "GEX_UPDATE",
  "spot",
  "aux",
  "esCandles",
  "es1mCandles",
  // Added when HomeClient moved onto this socket. With its own connection it
  // received these on every (re)connect; sharing one socket means a late mount
  // would otherwise sit with no expiry list and an empty flow tape until the
  // server's next push. All three are whole-state frames, so replay is exact.
  "status",
  "EXPIRATIONS",
  "flow",
]);

const subscribers = new Set<GexSubscriber>();
/** Last frame seen per replayable type, in arrival order. */
const lastByType = new Map<string, GexMessage>();
/**
 * Frames a consumer asked to send before the socket was OPEN. Flushed on open.
 * Bounded because a consumer that spams while offline must not grow unbounded;
 * the only real user is SET_EXPIRY, where only the newest value matters.
 */
const pendingSends: string[] = [];
const MAX_PENDING_SENDS = 8;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let rescopeTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;

/**
 * The topic scope the LIVE connection was opened with: a sorted CSV, or null
 * for the unscoped firehose. Compared against `desiredScope()` to decide
 * whether the set of mounted consumers still matches the wire.
 */
let currentScope: string | null = null;

/**
 * Settle window before opening or widening a connection.
 *
 * A route's consumers do NOT mount together. The globally-mounted ToolbarTicker
 * is up first (it wants aux+spot), then the lazy route chunk resolves and its
 * hooks subscribe one after another. Acting on each of those immediately meant
 * visiting two pages opened FOUR connections:
 *
 *   [aux,spot] → [aux,gex,spot,status] → [aux,es1m,es,spot] → [aux,es1m,es,gex,spot,status]
 *
 * and every one of those reconnects costs a fresh server snapshot carrying the
 * whole gexRows array. That is strictly worse than the firehose it replaced.
 * 250ms is long enough to swallow a mount cascade and short enough to be
 * invisible next to the lazy-chunk fetch the page is already waiting on.
 */
const CONNECT_SETTLE_MS = 250;

/**
 * How long to wait before reconnecting when the needed scope NARROWS.
 *
 * Longer than the settle window because nothing is waiting on a narrow: during
 * a route change the scope typically drops and re-widens within a few hundred
 * milliseconds, and riding that out means one reconnect instead of two.
 */
const RESCOPE_NARROW_DEBOUNCE_MS = 1200;

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

/**
 * The scope the currently-mounted consumers need, as a sorted CSV — or null
 * meaning "unscoped", which is both the safe default and what any subscriber
 * that declared no topics forces.
 */
function desiredScope(): string | null {
  if (!subscribers.size) return null;
  const union = new Set<string>();
  for (const s of subscribers) {
    // One undeclared subscriber and we cannot narrow anything: we have no idea
    // what it reads, so it must keep receiving everything.
    if (!s.topics) return null;
    for (const t of s.topics) union.add(t);
  }
  return union.size ? [...union].sort().join(",") : null;
}

/** True when `want` asks for anything `have` isn't already receiving. */
function isWidening(have: string | null, want: string | null): boolean {
  if (have === null) return false; // already receiving everything
  if (want === null) return true; // going unscoped IS the widest
  const haveSet = new Set(have.split(","));
  return want.split(",").some((t) => !haveSet.has(t));
}

function clearRescope() {
  if (rescopeTimer) {
    clearTimeout(rescopeTimer);
    rescopeTimer = null;
  }
}

/**
 * Drop and reopen the connection so the server applies a new ?topics= set.
 *
 * The replay cache MUST be cleared here. Its whole job is to hand a
 * late-mounting consumer the last frame of each type synchronously — but those
 * frames were received under the OLD scope. Replaying a narrow-scoped snapshot
 * (gexRows already stripped) to a consumer that just widened the scope
 * precisely to get gexRows would leave it blank until the next server publish,
 * which is the failure the cache exists to prevent.
 */
function reopenWithScope() {
  clearRescope();
  clearReconnect();
  lastByType.clear();
  const sock = socket;
  socket = null;
  if (sock) {
    // Detach first: this close is intentional, so onclose must not fire the
    // backoff path or emit a spurious disconnect before we reopen.
    sock.onmessage = sock.onerror = sock.onclose = null;
    if (sock.readyState === WebSocket.CONNECTING) {
      sock.onopen = () => { try { sock.close(); } catch { /* ignore */ } };
    } else {
      sock.onopen = null;
      try { sock.close(); } catch { /* ignore */ }
    }
  }
  attempts = 0;
  openSocket();
}

/**
 * Called whenever the subscriber set changes. Reopens the socket if the topics
 * the live connection was opened with no longer match what is mounted.
 *
 * Asymmetric on purpose:
 *   - WIDENING is immediate. Something just mounted and is sitting there with
 *     no data; making it wait out a debounce is a visible stall.
 *   - NARROWING is debounced. Nothing is waiting on it, and during a route
 *     change the scope typically narrows and re-widens within a few hundred
 *     milliseconds — collapsing that into one reconnect (or none) is the point.
 */
function reconcileScope() {
  const want = desiredScope();
  if (want === currentScope) {
    clearRescope();
    return;
  }
  // No live connection yet: scheduleConnect() owns this case and will read
  // desiredScope() when its settle timer fires.
  if (!socket) {
    clearRescope();
    return;
  }
  const delay = isWidening(currentScope, want) ? CONNECT_SETTLE_MS : RESCOPE_NARROW_DEBOUNCE_MS;
  // A pending WIDEN must not be pushed back by a subsequent narrow — someone is
  // waiting on the wider scope. Keep the earlier deadline by leaving the timer
  // alone unless this call is the more urgent one.
  if (rescopeTimer && delay >= RESCOPE_NARROW_DEBOUNCE_MS) return;
  clearRescope();
  rescopeTimer = setTimeout(() => {
    rescopeTimer = null;
    // Re-check: the subscriber set may have changed again while we waited.
    if (socket && desiredScope() !== currentScope) reopenWithScope();
  }, delay);
}

/**
 * Open the first connection, after the same settle window a widen gets.
 *
 * Called instead of openSocket() from subscribeGex so the toolbar's subscribe
 * doesn't claim the scope before the route's own consumers have mounted — that
 * ordering is exactly what produced the doubled connection count.
 */
function scheduleConnect() {
  if (socket || reconnectTimer || rescopeTimer) return;
  rescopeTimer = setTimeout(() => {
    rescopeTimer = null;
    openSocket();
  }, CONNECT_SETTLE_MS);
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
  // Snapshot the scope at connect time: it is a property of THIS connection,
  // and reconcileScope() compares against it to decide when to reopen.
  const scope = desiredScope();
  const query = scope ? `?topics=${encodeURIComponent(scope)}` : "";
  let sock: WebSocket;
  try {
    sock = new WebSocket(`${proto}//${window.location.host}/ws/gex${query}`);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = sock;
  currentScope = scope;

  sock.onopen = () => {
    if (socket !== sock) return;
    attempts = 0;
    // Flush before emitStatus so a consumer re-asserting state in its onStatus
    // handler lands AFTER anything queued while we were down (last write wins).
    while (pendingSends.length) {
      const frame = pendingSends.shift()!;
      try { sock.send(frame); } catch { /* socket died mid-flush */ }
    }
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
  clearRescope();
  // The next connection recomputes its own scope from whoever is mounted then.
  currentScope = null;
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
 * Send a control frame upstream (currently only { type: 'SET_EXPIRY', expiry }).
 *
 * Queues when the socket isn't OPEN yet and flushes on connect, so callers don't
 * have to hold their own socket ref just to talk back — which is exactly why
 * HomeClient used to keep a private connection. Returns true if it went out on
 * the wire immediately.
 */
export function sendGex(payload: unknown): boolean {
  let frame: string;
  try {
    frame = JSON.stringify(payload);
  } catch {
    return false;
  }
  if (isLive()) {
    try {
      socket!.send(frame);
      return true;
    } catch {
      /* fall through to queue */
    }
  }
  pendingSends.push(frame);
  while (pendingSends.length > MAX_PENDING_SENDS) pendingSends.shift();
  return false;
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

  // Widen the wire BEFORE replaying, if this consumer needs frame types the
  // live connection isn't receiving. reopenWithScope() clears the replay cache
  // in that case, so the block below correctly replays nothing rather than
  // handing over frames that were captured under the narrower scope.
  reconcileScope();

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

  scheduleConnect();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    subscribers.delete(sub);
    if (subscribers.size) {
      // Others are still here — the union may have narrowed (debounced).
      reconcileScope();
      return;
    }
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
  onStatus?: (connected: boolean) => void,
  /**
   * Frame types this consumer reads — see GexSubscriber.topics. Omit and the
   * socket stays on the full firehose while this component is mounted.
   * Pass a module-level constant, not an inline array: the value is joined into
   * the subscription's dep key, so a fresh array each render would resubscribe
   * (and, if it changed the union, reconnect) on every render.
   */
  topics?: readonly string[]
) {
  const msgRef = useRef(onMessage);
  msgRef.current = onMessage;
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  // Identity-stable key so an inline array literal doesn't churn the effect.
  const topicsKey = topics ? [...topics].sort().join(",") : "";

  useEffect(() => {
    if (!enabled) return;
    return subscribeGex({
      onMessage: (m) => msgRef.current?.(m),
      onStatus: (c) => statusRef.current?.(c),
      topics: topicsKey ? topicsKey.split(",") : undefined,
    });
  }, [enabled, topicsKey]);
}
