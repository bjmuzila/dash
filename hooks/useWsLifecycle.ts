"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";

/**
 * Shared WebSocket lifecycle gate. Returns whether a live socket SHOULD be open,
 * based on:
 *   - tab visibility  — backgrounded/screen-locked => no socket (biggest mobile win)
 *   - user inactivity — no interaction for INACTIVITY_MS => no socket
 * The owner (Clerk id === NEXT_PUBLIC_OWNER_USER_ID) is exempt from the
 * inactivity timeout so the owner can leave a monitor running all day; the owner
 * is still subject to background-pause (a locked phone never needs the stream).
 *
 * Every /ws/gex consumer reads this single boolean and connects/disconnects to
 * match, so the bandwidth policy lives in one place instead of 5 copies.
 *
 * Tunable via NEXT_PUBLIC_WS_INACTIVITY_MS (default 15 min).
 *
 * ── Keep-alive (see `useKeepWsAlive`) ───────────────────────────────────────
 * The owner exemption above is NOT reachable on `/app/*`. Those routes are the
 * Vite bundle, and Vite does not inline arbitrary `process.env.X` — it compiles
 * to `{}`, so `OWNER_USER_ID` is "" and `isOwner` is permanently false there.
 * Rather than plumb a build-time define through two shells, a page that is meant
 * to be LEFT UP declares that for everyone with `useKeepWsAlive(true)`.
 *
 * That suppresses the INACTIVITY drop only. The visibility drop is untouched on
 * purpose: a hidden tab is the abandoned case worth shedding, and it is where
 * most of the bandwidth saving actually comes from. A VISIBLE tab with a live
 * chart on it is being watched — on a second monitor, or on a stream — and
 * "nobody moved the mouse for 15 minutes" is not evidence that it isn't.
 */
const INACTIVITY_MS = Number(
  process.env.NEXT_PUBLIC_WS_INACTIVITY_MS || 15 * 60 * 1000
);
const OWNER_USER_ID = (process.env.NEXT_PUBLIC_OWNER_USER_ID || "").trim();

// Refcounted so two mounted keep-alive consumers — or a remount that overlaps
// its own unmount — cannot cancel each other out. Module-level rather than a
// context: `useWsLifecycle` is called from a dozen unrelated trees and none of
// them share a provider.
let keepAliveCount = 0;
const keepAliveListeners = new Set<() => void>();
const notifyKeepAlive = () => {
  for (const fn of keepAliveListeners) {
    try { fn(); } catch { /* one listener must not break the others */ }
  }
};

/** Is anything currently asking for the inactivity timeout to be suspended? */
export function isWsKeptAlive(): boolean {
  return keepAliveCount > 0;
}

/**
 * Declare "this page is meant to be left up": suspend the inactivity timeout
 * for as long as this component is mounted with `on` true.
 *
 * Visibility is NOT affected — a hidden tab still drops its socket.
 */
export function useKeepWsAlive(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    keepAliveCount += 1;
    notifyKeepAlive();
    return () => {
      keepAliveCount = Math.max(0, keepAliveCount - 1);
      notifyKeepAlive();
    };
  }, [on]);
}

export function useWsLifecycle(): boolean {
  const { user } = useAuth();
  const isOwner = !!OWNER_USER_ID && (user?.id || "").trim() === OWNER_USER_ID;

  const [shouldConnect, setShouldConnect] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOwnerRef = useRef(isOwner);
  isOwnerRef.current = isOwner;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const visible = () =>
      typeof document === "undefined" || document.visibilityState !== "hidden";

    // Exempt from the IDLE timeout — never from the visibility drop.
    const idleExempt = () => isOwnerRef.current || keepAliveCount > 0;

    // Recompute the gate from current visibility (inactivity is handled by the
    // timer firing setShouldConnect(false) directly).
    const recompute = () => setShouldConnect(visible());

    const armIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
      if (idleExempt()) return; // owner, or a page that asked to stay live
      idleTimerRef.current = setTimeout(() => {
        setShouldConnect(false); // idle too long → drop the socket
      }, INACTIVITY_MS);
    };

    const onActivity = () => {
      // Any interaction: (re)connect if visible, and reset the idle countdown.
      if (visible()) setShouldConnect(true);
      armIdleTimer();
    };

    const onVisibility = () => {
      recompute();
      if (visible()) armIdleTimer();
      else if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };

    // Keep-alive is a TOGGLE (in the ES Candles cog), so it can flip mid-session.
    // Turning it on has to cancel a countdown that is already running AND
    // reconnect if that countdown had already fired; turning it off has to start
    // one. Without this the setting only took effect on the next mouse move —
    // which, on a page you have walked away from, is never.
    const onKeepAliveChange = () => {
      if (keepAliveCount > 0 && visible()) setShouldConnect(true);
      armIdleTimer();
    };
    keepAliveListeners.add(onKeepAliveChange);

    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"];
    for (const ev of activityEvents) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);

    // Initial state.
    recompute();
    armIdleTimer();

    return () => {
      for (const ev of activityEvents) window.removeEventListener(ev, onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      keepAliveListeners.delete(onKeepAliveChange);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  return shouldConnect;
}
