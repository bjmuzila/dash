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
let connectWatchdog: ReturnType<typeof setTimeout> | null = null;
let healthyTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
/** Date.now() of the last frame actually received on the live socket. */
let lastFrameAt = 0;
/** Date.now() the live socket reached OPEN — 0 if it never got there. */
let openedAt = 0;
/** Frames received on the live socket. 1 = "the connect snapshot and nothing else". */
let framesThisSocket = 0;
/**
 * Consecutive connections that opened and then died without proving themselves.
 * Drives the BROKEN_TRANSPORT_FLOOR_MS escalation; cleared by any connection
 * that survives HEALTHY_CONNECTION_MS.
 */
let shortLivedStreak = 0;

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

/**
 * How long a connection must SURVIVE before its backoff credit is restored.
 *
 * WHY THIS EXISTS (2026-08-31, the 53GB/day Cloudflare bill).
 * `attempts = 0` used to live in `onopen`, which assumes "the handshake
 * succeeded" means "the connection works". Twice now it has not:
 *
 *   open   @136ms
 *   msg    @183ms   snapshot, 218,529 bytes
 *   close  @183ms   code 1006, wasClean=false
 *
 * The 101 succeeds, the server hands over the full connect snapshot, and the
 * socket is reset in the same millisecond — so every single retry reset the
 * backoff to its first rung and this "exponential" backoff was a flat 2s loop,
 * forever, at 218KB a go. That is 6.5MB/min PER OPEN TAB (9.4GB/day), and the
 * server's own accounting confirmed the shape of it: 99.96% of all /ws/gex
 * egress was connect snapshots, with `clients: 0` — nobody was ever actually
 * connected, everyone was looping.
 *
 * So: a connection earns back its backoff credit by staying up, not by opening.
 * Under a healthy server this changes nothing (sockets live for hours). Under a
 * broken transport the retry curve actually climbs, which is the whole point.
 */
const HEALTHY_CONNECTION_MS = 10_000;

/**
 * Consecutive open-then-die connections before we treat the transport itself as
 * broken and stop paying full price for the discovery.
 *
 * A socket that opens, takes the snapshot and dies is the most expensive failure
 * mode there is — it costs the FULL connect payload and delivers nothing. Three
 * in a row is not a blip, it is a broken pipe (tunnel, edge, proxy), and no
 * retry cadence we can pick will fix it from in here. Back off hard and let the
 * wake handlers (visibilitychange / online / focus) provide the fast path back
 * the moment it is actually repaired.
 */
const BROKEN_TRANSPORT_STREAK = 3;
const BROKEN_TRANSPORT_FLOOR_MS = 60_000;

/**
 * Up to +30% random padding on every retry delay.
 *
 * Every open tab of this app runs the same timer against the same server. When
 * the backend blinks they all fail together, all schedule the same delay, and
 * all come back in the same instant — a self-inflicted thundering herd on top of
 * whatever the original fault was. Jitter smears them out.
 */
const RECONNECT_JITTER = 0.3;

/**
 * How long a socket may sit in CONNECTING before we give up on it.
 *
 * MOBILE. A phone that changed radio (wifi <-> cell, or a lock/unlock that
 * re-homed the connection) routinely leaves a WebSocket stuck in CONNECTING
 * with no error and no close event — the TCP handshake is simply never
 * answered. `openSocket()` refuses to open a second connection while one is
 * CONNECTING, and `scheduleReconnect()` only ever runs from `onclose`, so
 * without this watchdog that one hung handshake wedges the feed permanently
 * and the page sits on "Connecting to the live feed…" until a manual reload.
 * Desktop rarely hits it, which is why this only ever looked like a phone bug.
 */
const CONNECT_TIMEOUT_MS = 12_000;

/**
 * On resume, how stale an OPEN socket may be before we distrust it.
 *
 * A backgrounded phone gets its socket reaped server-side (websocket-server.js
 * ping/terminate), but the browser can hand the frozen page back with the
 * WebSocket still reading OPEN — a half-open socket that will never deliver
 * another frame. If nothing has arrived in this long when we come back to the
 * foreground, reopen rather than trust readyState.
 */
const RESUME_STALE_MS = 20_000;

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

/**
 * Is `socket` a connection we can still expect frames from?
 *
 * `socket !== null` is NOT the same question, and conflating the two is what
 * broke the feed on phones. A socket the OS killed while the tab was frozen
 * comes back CLOSED, and its `onclose` — the only thing that nulls the ref and
 * arms the backoff — may never be delivered for a page that was frozen when it
 * fired. Every guard that used to test `socket` now tests this instead, so a
 * dead ref is treated as no connection rather than as a live one.
 */
function hasUsableSocket() {
  const rs = socket?.readyState;
  return rs === WebSocket.CONNECTING || rs === WebSocket.OPEN;
}

/** Drop a ref to a socket that is already CLOSING/CLOSED. */
function dropDeadSocket() {
  if (socket && !hasUsableSocket()) {
    socket.onmessage = socket.onerror = socket.onclose = socket.onopen = null;
    socket = null;
    currentScope = null;
  }
}

function clearConnectWatchdog() {
  if (connectWatchdog) {
    clearTimeout(connectWatchdog);
    connectWatchdog = null;
  }
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearHealthyTimer() {
  if (healthyTimer) {
    clearTimeout(healthyTimer);
    healthyTimer = null;
  }
}

function scheduleReconnect() {
  if (!subscribers.size) return;
  clearReconnect();
  // Exponential backoff, capped. The old per-consumer sockets each retried on a
  // flat 2-2.5s forever, so a backend outage meant N sockets hammering it.
  let delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempts);
  // Transport is open-then-die (see BROKEN_TRANSPORT_STREAK): every retry costs
  // a full connect snapshot and returns nothing, so stop paying 30s-often for
  // an answer that is not going to change without a server-side fix.
  if (shortLivedStreak >= BROKEN_TRANSPORT_STREAK) {
    delay = Math.max(delay, BROKEN_TRANSPORT_FLOOR_MS);
  }
  delay = Math.round(delay * (1 + Math.random() * RECONNECT_JITTER));
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
  clearConnectWatchdog();
  clearHealthyTimer();
  // This close is ours, not a failure — it must not feed the broken-transport
  // streak, so the per-socket counters are cleared before the detach below.
  openedAt = 0;
  framesThisSocket = 0;
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
  dropDeadSocket();
  if (!hasUsableSocket()) {
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
    if (hasUsableSocket() && desiredScope() !== currentScope) reopenWithScope();
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
  // A CLOSED ref must not be mistaken for "already connected" — see
  // hasUsableSocket(). This early-return on a zombie socket was the phone bug:
  // resume re-subscribed, found a dead ref, and never opened anything.
  dropDeadSocket();
  if (hasUsableSocket() || reconnectTimer || rescopeTimer) return;
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

  // Give up on a handshake that never completes (see CONNECT_TIMEOUT_MS).
  clearConnectWatchdog();
  connectWatchdog = setTimeout(() => {
    connectWatchdog = null;
    if (socket !== sock) return;
    if (sock.readyState !== WebSocket.CONNECTING) return;
    // Abandon it: detach so the late close can't double-fire the backoff, then
    // go straight to the normal retry path.
    sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null;
    try { sock.close(); } catch { /* ignore */ }
    socket = null;
    currentScope = null;
    emitStatus(false);
    scheduleReconnect();
  }, CONNECT_TIMEOUT_MS);

  sock.onopen = () => {
    if (socket !== sock) return;
    clearConnectWatchdog();
    // NOT `attempts = 0` — see HEALTHY_CONNECTION_MS. Opening is not working.
    // The credit is restored on a timer, and only if this socket is still the
    // live one and still OPEN when it fires.
    openedAt = Date.now();
    framesThisSocket = 0;
    clearHealthyTimer();
    healthyTimer = setTimeout(() => {
      healthyTimer = null;
      if (socket !== sock || sock.readyState !== WebSocket.OPEN) return;
      attempts = 0;
      shortLivedStreak = 0;
    }, HEALTHY_CONNECTION_MS);
    lastFrameAt = Date.now();
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
    lastFrameAt = Date.now();
    framesThisSocket += 1;
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
    clearConnectWatchdog();
    clearHealthyTimer();
    // Classify the death before wiping the per-socket counters. `openedAt === 0`
    // means the handshake never completed — that is a plain connect failure and
    // costs nothing, so it rides the ordinary exponential curve. The expensive
    // one is open -> snapshot -> 1006, which is what this streak counts.
    if (openedAt) {
      const lifetime = Date.now() - openedAt;
      if (lifetime < HEALTHY_CONNECTION_MS && framesThisSocket <= 1) {
        shortLivedStreak += 1;
      } else if (lifetime >= HEALTHY_CONNECTION_MS) {
        shortLivedStreak = 0;
      }
    }
    openedAt = 0;
    framesThisSocket = 0;
    socket = null;
    currentScope = null;
    emitStatus(false);
    scheduleReconnect();
  };
}

/**
 * Come back from a background/offline stretch immediately.
 *
 * WHY (this is the mobile fix). Two things happen to a phone that a desktop tab
 * almost never sees:
 *
 *   1. The tab is frozen. Timers stop, so a pending backoff — already out at
 *      several seconds, and up to 30 — does not run while hidden and then runs
 *      out its FULL remaining delay after the user is looking at the page
 *      again. That is the "keeps struggling to reconnect" wait.
 *   2. The socket is killed underneath the frozen page (the server's own
 *      ping/terminate reaper does it), and the close event that would have
 *      armed a retry is delivered to a frozen page, or not at all.
 *
 * So on any resume signal: forget the backoff (this is a fresh attempt, not the
 * n-th failure of the old one), drop a dead or stale socket, and reconnect now.
 * Idempotent and cheap — several of these events fire together on a real wake.
 */
function handleWake() {
  if (typeof window === "undefined") return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (!subscribers.size) return;

  // A wake is not a failure: never make the user wait out the old backoff. This
  // is also the fast path back from BROKEN_TRANSPORT_FLOOR_MS — the moment the
  // pipe is fixed, looking at the page reconnects immediately instead of waiting
  // out the floor. `shortLivedStreak` is deliberately NOT cleared here: a wake
  // buys one immediate attempt, not a fresh licence to loop, so if the transport
  // is still broken the next failure lands straight back on the floor.
  attempts = 0;
  clearReconnect();
  dropDeadSocket();

  // An OPEN socket that has gone quiet across the background stretch is
  // half-open — readyState lies. Reopen instead of trusting it.
  if (isLive() && lastFrameAt && Date.now() - lastFrameAt > RESUME_STALE_MS) {
    reopenWithScope();
    return;
  }
  if (hasUsableSocket()) return;
  openSocket();
}

if (typeof window !== "undefined") {
  // visibilitychange = unlock / app switch back; pageshow = bfcache restore
  // (iOS Safari's back-swipe and app-switcher path, where no visibilitychange
  // is guaranteed); online = radio came back; focus = catch-all.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") handleWake();
  });
  window.addEventListener("pageshow", handleWake);
  window.addEventListener("online", handleWake);
  window.addEventListener("focus", handleWake);
}

function teardown() {
  clearReconnect();
  clearRescope();
  clearConnectWatchdog();
  clearHealthyTimer();
  lastFrameAt = 0;
  openedAt = 0;
  framesThisSocket = 0;
  shortLivedStreak = 0;
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
