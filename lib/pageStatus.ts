"use client";

import { useEffect } from "react";

type PageStatusOptions = {
  pageKey: string;
  pageLabel?: string;
  path?: string;
};

/**
 * Session-entry attribution.
 *
 * document.referrer and the ?utm_* query string describe how someone ARRIVED.
 * Inside the SPA they stay unchanged for the whole visit — document.referrer
 * still says "google.com" on the twentieth client-side navigation — so sending
 * them on every beacon would turn one inbound visit into twenty and make the
 * top-referrers list meaningless.
 *
 * So we send them exactly once, on the first beacon of the browser session, and
 * flag that row is_entry. Session count = COUNT(*) WHERE is_entry; every later
 * beacon posts null attribution.
 *
 * The marker lives in sessionStorage (per tab, cleared when the tab closes —
 * the same lifetime as a "visit"). Private modes and locked-down browsers can
 * throw on access, so a module-level flag backs it up; worst case the marker is
 * lost on a hard reload and we log one extra entry row.
 */
const ENTRY_KEY = "cb:visit-entry";
let entryClaimedInMemory = false;

type EntryAttribution = { isEntry: boolean; referrer: string | null; query: string | null };

function claimSessionEntry(): EntryAttribution {
  const none: EntryAttribution = { isEntry: false, referrer: null, query: null };
  if (typeof window === "undefined") return none;
  if (entryClaimedInMemory) return none;

  let alreadyClaimed = false;
  try {
    alreadyClaimed = window.sessionStorage.getItem(ENTRY_KEY) === "1";
  } catch {
    /* storage blocked — fall back to the in-memory flag alone */
  }
  if (alreadyClaimed) {
    entryClaimedInMemory = true;
    return none;
  }

  // Claim BEFORE the network call so a fast second mount can't also claim it.
  entryClaimedInMemory = true;
  try {
    window.sessionStorage.setItem(ENTRY_KEY, "1");
  } catch {
    /* non-fatal */
  }

  return {
    isEntry: true,
    // Empty string = direct navigation (typed URL, bookmark). Send null, not "".
    referrer: document.referrer || null,
    query: window.location.search || null,
  };
}

export function usePageLoadStatus({ pageKey, pageLabel, path }: PageStatusOptions) {
  useEffect(() => {
    const now = new Date().toISOString();
    const entry = claimSessionEntry();
    const payload = {
      pageKey,
      pageLabel: pageLabel ?? pageKey,
      path: path ?? (typeof window !== "undefined" ? window.location.pathname : undefined),
      isLoaded: true,
      lastLoadedAt: now,
      // Acquisition — only ever set on the first beacon of the session. The server
      // parses these (lib/visitorAttribution.ts). It must NOT read its own Referer
      // header instead: that points at the page firing the beacon, not the source.
      isEntry: entry.isEntry,
      referrer: entry.referrer,
      query: entry.query,
    };

    void fetch("/api/page-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});

    const unload = () => {
      const unloadedAt = new Date().toISOString();
      const data = {
        ...payload,
        isLoaded: false,
        lastUnloadedAt: unloadedAt,
        lastLoadedAt: now,
        // The unload beacon writes no visit row, and re-sending the entry flag
        // here would let a stray handler double-count the session.
        isEntry: false,
        referrer: null,
        query: null,
      };
      const body = JSON.stringify(data);
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/page-status", new Blob([body], { type: "application/json" }));
        return;
      }
      void fetch("/api/page-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    };

    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("beforeunload", unload);
      unload();
    };
  }, [pageKey, pageLabel, path]);
}
