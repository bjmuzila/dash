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
 */
const INACTIVITY_MS = Number(
  process.env.NEXT_PUBLIC_WS_INACTIVITY_MS || 15 * 60 * 1000
);
const OWNER_USER_ID = (process.env.NEXT_PUBLIC_OWNER_USER_ID || "").trim();

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

    // Recompute the gate from current visibility (inactivity is handled by the
    // timer firing setShouldConnect(false) directly).
    const recompute = () => setShouldConnect(visible());

    const armIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (isOwnerRef.current) return; // owner: never idle out
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
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  return shouldConnect;
}
