"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendGex, subscribeGex, type GexMessage } from "@/lib/gexSocket";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import { computeGEXProfile, findGEXFlip, type ChainRow, type GEXProfile } from "@/lib/calculations/calculations";

/**
 * useMobileGex — the one live-GEX data source for every phone page.
 *
 * WHY NOT COPY /mobile's OLD FETCH
 * --------------------------------
 * The previous app/mobile/page.tsx pulled a single REST snapshot from
 * /api/chains and then never updated: it declared a `wsRef` and read it in
 * three places but never assigned one, so its "reconnect" interval was a no-op
 * and `wsStatus` was pinned at "connecting" forever. This hook rides the
 * SHARED socket in lib/gexSocket instead — refcounted, one connection for the
 * whole tab, last frame of each type replayed synchronously on subscribe, so a
 * lazily-mounted phone route has data on its first paint instead of after the
 * server's next publish.
 *
 * REST is kept strictly as a fallback: if the socket has not delivered a frame
 * within FALLBACK_AFTER_MS (blocked upgrade, captive wifi, backgrounded tab
 * that dropped the connection), we start polling /api/gex and stop again the
 * moment a live frame lands.
 *
 * COALESCING
 * ----------
 * The feed pushes continuously and a phone GPU is not a desktop's. Frames are
 * applied on a leading edge then trailing-timer at FRAME_MS, so a burst of
 * updates costs one React render rather than one per frame.
 */

const MOBILE_GEX_TOPICS = ["gex", "spot", "aux", "status"] as const;

const FRAME_MS = 900;
const FALLBACK_AFTER_MS = 6_000;
const FALLBACK_POLL_MS = 8_000;

/**
 * The phone build has no expiry picker: every mobile GEX surface shows the
 * FRONT expiry of the session you are currently trading, and nothing else.
 * This replaced a chip row plus a sessionStorage remembered-selection — on a
 * phone the expiry you want is essentially always the front one, and the
 * picker cost a row of vertical space on the two most space-constrained pages
 * in the app.
 *
 * WHICH DAY IS "THE SESSION"
 * --------------------------
 * Not the calendar day. The CME/globex session opens at 18:00 ET, so from 6pm
 * Eastern onward the book everyone is trading is TOMORROW's — an SPX heatmap
 * still pinned to today's already-expired 0DTE at 7pm is showing a dead chain.
 * `sessionDateEt()` therefore returns today's ET date before 18:00 ET and the
 * next calendar date from 18:00 ET on.
 *
 * That target date is then resolved against the listed expirations by
 * `pickExpiry()`: the first listed expiry ON or AFTER it, falling back to the
 * last listed one. So Friday 6pm rolls to Saturday, finds no Saturday series,
 * and lands on Monday — the closest expiry, which is the right answer on
 * weekends, holidays, and any symbol without a daily series.
 *
 * All of it is ET, not the device's clock — a trader in London must get New
 * York's session.
 */
const ROLL_HOUR_ET = 18;

function etDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

function etHour(d: Date = new Date()): number {
  const h = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(d),
  );
  // Some ICU builds render midnight as "24" under h23.
  return Number.isFinite(h) ? h % 24 : 0;
}

/** The real ET calendar date. Used for the DTE label, never for pinning. */
function todayEt(): string {
  return etDate();
}

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(ymd + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return ymd;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today in ET before 6pm; tomorrow from 6pm ET on. */
function sessionDateEt(): string {
  const today = etDate();
  return etHour() >= ROLL_HOUR_ET ? addDaysYmd(today, 1) : today;
}

/** First listed expiry on or after `target`; the last listed one if none is. */
function pickExpiry(list: string[], target: string): string {
  const sorted = Array.from(new Set(list.filter(Boolean))).sort();
  if (!sorted.length) return "";
  return sorted.find((e) => e >= target) ?? sorted[sorted.length - 1];
}

/** Whole calendar days from today (ET) to `expiry`. */
function dteFrom(expiry: string): number | null {
  if (!expiry) return null;
  const a = Date.parse(todayEt() + "T00:00:00Z");
  const b = Date.parse(expiry + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export type GexDataMode = "oi-vol" | "vol-only";

export type MobileGexState = {
  chain: ChainRow[];
  spot: number;
  prevClose: number;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  totalNetGex: number | null;
  /** The expiry on screen: the session's front expiry (see sessionDateEt). */
  expiry: string;
  /**
   * True only when the expiry on screen really is today's ET date. It goes
   * false the moment the 6pm roll moves the view to tomorrow's book, and on
   * weekends/holidays where no daily series is listed — so a page can label the
   * chip "1DTE"/"3DTE" rather than lying with "0DTE".
   */
  isZeroDte: boolean;
  /**
   * Whole calendar days from today (ET) to the expiry on screen — 0 during the
   * day session, 1 after the 6pm roll on a weekday, 3 after Friday's roll.
   */
  dte: number | null;
  /** Front ES future last, from the feed's `aux` frame. 0 when unknown. */
  esFut: number;
  /**
   * ES − SPX basis, or null when it can't be trusted.
   *
   * Only the LIVE pair is used (approach 1 of EsChartCard's three-tier ladder).
   * The off-hours fallbacks — /proxy/es-spx-basis, then the eod_gex anchor —
   * exist because cash SPX freezes at 16:00 while ES keeps trading, so the
   * difference stops being a basis. Rather than reimplement that ladder here,
   * the phone chart simply hides its SPX-derived level lines when the live pair
   * isn't available. A missing line beats a line drawn 14 points wrong.
   */
  basis: number | null;
  /** Client-side GEX profile for the flip curve — never a fetch. */
  profile: GEXProfile | null;
  connected: boolean;
  /** True once any data (socket or REST) has landed. */
  hasData: boolean;
  updatedAt: number | null;
  /** "live" = socket frames arriving; "rest" = polling; "off" = gate closed. */
  source: "live" | "rest" | "off";
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function useMobileGex(dataMode: GexDataMode = "oi-vol"): MobileGexState {
  const enabled = useWsLifecycle();

  const [chain, setChain] = useState<ChainRow[]>([]);
  const [spot, setSpot] = useState(0);
  const [prevClose, setPrevClose] = useState(0);
  const [callWall, setCallWall] = useState<number | null>(null);
  const [putWall, setPutWall] = useState<number | null>(null);
  const [serverFlip, setServerFlip] = useState<number | null>(null);
  const [totalNetGex, setTotalNetGex] = useState<number | null>(null);
  const [expirations, setExpirations] = useState<string[]>([]);
  const [expiry, setExpiryState] = useState("");
  const [connected, setConnected] = useState(false);
  const [esFut, setEsFut] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [source, setSource] = useState<"live" | "rest" | "off">(enabled ? "live" : "off");

  // Frame coalescer: latest payload wins, applied at most once per FRAME_MS.
  const pendingRef = useRef<Record<string, unknown> | null>(null);
  const frameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFrameAtRef = useRef(0);
  // Expiry the USER picked. Held in a ref so the socket effect never re-subscribes.
  const wantExpiryRef = useRef("");
  // Expiry the session roll resolved to. Read inside frame handlers, so a ref.
  const desiredExpiryRef = useRef("");
  const hasDataRef = useRef(false);
  const [hasData, setHasData] = useState(false);

  const applyPayload = useCallback((p: Record<string, unknown>) => {
    if (Array.isArray(p.gexRows)) {
      setChain(p.gexRows as ChainRow[]);
      if (!hasDataRef.current) {
        hasDataRef.current = true;
        setHasData(true);
      }
    }
    const s = num(p.spot);
    if (s > 0) setSpot(s);
    const pc = num(p.prevClose);
    if (pc > 0) setPrevClose(pc);
    if (p.callWall != null) setCallWall(num(p.callWall) || null);
    if (p.putWall != null) setPutWall(num(p.putWall) || null);
    if (p.gexFlip != null) setServerFlip(num(p.gexFlip) || null);
    if (p.totalNetGex != null) setTotalNetGex(num(p.totalNetGex) || null);
    const es = num(p.esFut);
    if (es > 0) setEsFut(es);
    if (Array.isArray(p.expirations)) setExpirations(p.expirations as string[]);
    if (typeof p.expiry === "string" && p.expiry) {
      // The server's current expiry, used only until the pin effect below has
      // resolved a target for this session. Once it has, that target wins: a
      // frame landing between the roll and the server's SET_EXPIRY ack would
      // otherwise flash yesterday's book back onto the screen.
      setExpiryState(desiredExpiryRef.current || (p.expiry as string));
    }
    const ts = num(p.updatedAt);
    setUpdatedAt(ts > 0 ? ts : Date.now());
  }, []);

  const flushFrame = useCallback(() => {
    frameTimerRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p) applyPayload(p);
  }, [applyPayload]);

  const queueFrame = useCallback(
    (p: Record<string, unknown>, immediate: boolean) => {
      lastFrameAtRef.current = Date.now();
      setSource("live");
      if (immediate) {
        if (frameTimerRef.current) {
          clearTimeout(frameTimerRef.current);
          frameTimerRef.current = null;
        }
        pendingRef.current = null;
        applyPayload(p);
        return;
      }
      pendingRef.current = { ...(pendingRef.current ?? {}), ...p };
      if (!frameTimerRef.current) frameTimerRef.current = setTimeout(flushFrame, FRAME_MS);
    },
    [applyPayload, flushFrame],
  );

  // ── shared socket ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      setSource("off");
      return;
    }
    setSource("live");
    const handle = (msg: GexMessage) => {
      const type = String(msg.type ?? "");
      // server-v2 nests under `data`; legacy frames put fields on the message.
      const data = msg.data && typeof msg.data === "object" ? asRecord(msg.data) : asRecord(msg);
      switch (type) {
        case "snapshot":
          queueFrame(data, true);
          break;
        case "gex":
        case "GEX_UPDATE":
          queueFrame(data, false);
          break;
        case "spot":
          queueFrame({ spot: data.spot, prevClose: data.prevClose }, false);
          break;
        case "aux":
          queueFrame({ esFut: data.esFut }, false);
          break;
        case "status":
        case "EXPIRATIONS":
          if (Array.isArray(data.expirations)) setExpirations(data.expirations as string[]);
          if (typeof data.expiry === "string" && data.expiry && !wantExpiryRef.current) {
            setExpiryState(desiredExpiryRef.current || data.expiry);
          }
          break;
        default:
          break;
      }
    };
    const off = subscribeGex({
      // gex → gexRows/totals; spot → price; aux → esFut for the ES/SPX basis;
      // status → the expiry + expirations list the chips render.
      topics: MOBILE_GEX_TOPICS,
      onMessage: handle,
      onStatus: (c) => {
        setConnected(c);
        // Re-assert the user's expiry on every (re)connect — the server tracks
        // it per-connection, and a reconnect resets it to the front month.
        if (c && wantExpiryRef.current) {
          sendGex({ type: "SET_EXPIRY", expiry: wantExpiryRef.current });
        }
      },
    });
    return () => {
      off();
      if (frameTimerRef.current) {
        clearTimeout(frameTimerRef.current);
        frameTimerRef.current = null;
      }
    };
  }, [enabled, queueFrame]);

  // ── REST fallback ──────────────────────────────────────────────────────────
  // Only runs while the socket has been silent for FALLBACK_AFTER_MS. /api/gex
  // returns the same shape (chain / spotPrice / gexFlip / walls), so the page
  // degrades to a slower refresh rather than an empty screen.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const r = await fetch("/api/gex", { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as Record<string, unknown>;
        if (!alive) return;
        // A live frame may have arrived while this was in flight — don't stomp it.
        if (Date.now() - lastFrameAtRef.current < FALLBACK_AFTER_MS) return;
        setSource("rest");
        applyPayload({
          gexRows: d.chain,
          spot: d.spotPrice,
          prevClose: d.prevClose,
          gexFlip: d.gexFlip,
          callWall: d.callWall,
          putWall: d.putWall,
          totalNetGex: d.totalNetGex,
          expirations: d.expirations,
          expiry: d.expiration,
          updatedAt: d.updatedAt,
        });
      } catch {
        /* offline — keep the last good frame on screen */
      }
    };

    const watchdog = setInterval(() => {
      const silent = Date.now() - lastFrameAtRef.current > FALLBACK_AFTER_MS;
      if (silent && !pollTimer) {
        void poll();
        pollTimer = setInterval(poll, FALLBACK_POLL_MS);
      } else if (!silent && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }, 2_000);

    return () => {
      alive = false;
      clearInterval(watchdog);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [enabled, applyPayload]);

  /**
   * The session clock.
   *
   * The roll has to happen on a PHONE THAT IS ALREADY OPEN — that is the whole
   * failure mode: the app is left running through the close, 6pm passes, and
   * the heatmap sits on an expired chain because nothing recomputed the date.
   * A 30s tick is far below the resolution anyone would notice and costs one
   * `Intl.format` per tick; visibilitychange/focus cover the case where the
   * phone was asleep across the boundary and timers were throttled.
   */
  const [sessionDate, setSessionDate] = useState(sessionDateEt);
  useEffect(() => {
    const tick = () =>
      setSessionDate((prev) => {
        const next = sessionDateEt();
        return next === prev ? prev : next;
      });
    const id = setInterval(tick, 30_000);
    const onWake = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") tick();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onWake);
    if (typeof window !== "undefined") window.addEventListener("focus", onWake);
    return () => {
      clearInterval(id);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onWake);
      if (typeof window !== "undefined") window.removeEventListener("focus", onWake);
    };
  }, []);

  /**
   * Pin the feed to the session's front expiry as soon as the expirations list
   * arrives, and re-pin whenever the session rolls.
   *
   * The server tracks the chosen expiry PER CONNECTION, so this re-asserts on
   * every (re)connect too — including the reconnects the socket now performs
   * when its topic scope changes. Without that, a re-scope would silently drop
   * the view back to the feed's front expiry.
   */
  const pinnedRef = useRef("");
  useEffect(() => {
    if (!expirations.length) return;
    const target = pickExpiry(expirations, sessionDate);
    if (!target) return;
    desiredExpiryRef.current = target;
    setExpiryState(target);
    if (pinnedRef.current === target && connected) return;
    pinnedRef.current = target;
    sendGex({ type: "SET_EXPIRY", expiry: target });
  }, [expirations, connected, sessionDate]);

  // findGEXFlip is a pure client computation; prefer it over the server value
  // because it is derived from the exact rows on screen. Still exposed even
  // though the phone GEX CHART no longer draws a flip curve — the levels bar
  // and the ES chart's γ lines both read it.
  const flip = useMemo(() => findGEXFlip(chain, spot) ?? serverFlip, [chain, spot, serverFlip]);
  const profile = useMemo(
    () => (chain.length ? computeGEXProfile(chain, spot, dataMode) : null),
    [chain, spot, dataMode],
  );

  // Live pair only, and only when the difference is in the range a real ES−SPX
  // basis occupies. Anything outside it means one of the two legs is stale.
  const basis = useMemo(() => {
    if (esFut <= 0 || spot <= 0) return null;
    const b = esFut - spot;
    return Math.abs(b) <= 120 ? b : null;
  }, [esFut, spot]);

  return {
    chain,
    spot,
    prevClose,
    esFut,
    basis,
    flip,
    callWall,
    putWall,
    totalNetGex,
    expiry,
    isZeroDte: expiry === todayEt(),
    dte: dteFrom(expiry),
    profile,
    connected,
    hasData,
    updatedAt,
    source,
  };
}
