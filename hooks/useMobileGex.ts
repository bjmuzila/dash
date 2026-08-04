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
 * The expiry the user picked, remembered across mobile tabs.
 *
 * Each phone page mounts its own copy of this hook, so without this, picking
 * 08/07 on the GEX chart and then tapping "Heat" would silently drop you back
 * to the front expiry — two views of the same book disagreeing about which
 * book. sessionStorage rather than localStorage on purpose: an expiry is a
 * within-session intent, and a stale one restored days later would be wrong
 * (and by then usually expired).
 */
const EXPIRY_KEY = "cb-mobile-expiry-v1";

function readStoredExpiry(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(EXPIRY_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredExpiry(e: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(EXPIRY_KEY, e);
  } catch {
    /* private mode — the choice just doesn't survive the tab switch */
  }
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
  expirations: string[];
  expiry: string;
  setExpiry: (e: string) => void;
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
      // Only adopt the server's expiry while the user hasn't chosen one, so a
      // late snapshot replay can't yank the view back off their selection.
      if (!wantExpiryRef.current) setExpiryState(p.expiry);
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
            setExpiryState(data.expiry);
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

  const setExpiry = useCallback((e: string) => {
    wantExpiryRef.current = e;
    setExpiryState(e);
    writeStoredExpiry(e);
    sendGex({ type: "SET_EXPIRY", expiry: e });
  }, []);

  // Re-apply the expiry chosen on another mobile tab. Read in an effect, never
  // in a useState initializer: this route is server-rendered by Next before the
  // SPA hydrates, and sessionStorage doesn't exist there.
  useEffect(() => {
    const saved = readStoredExpiry();
    if (!saved) return;
    wantExpiryRef.current = saved;
    setExpiryState(saved);
    sendGex({ type: "SET_EXPIRY", expiry: saved });
  }, []);

  // findGEXFlip is a pure client computation; prefer it over the server value
  // because it is derived from the exact rows on screen.
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
    expirations,
    expiry,
    setExpiry,
    profile,
    connected,
    hasData,
    updatedAt,
    source,
  };
}
