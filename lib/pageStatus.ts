"use client";

import { useEffect } from "react";

type PageStatusOptions = {
  pageKey: string;
  pageLabel?: string;
  path?: string;
};

export function usePageLoadStatus({ pageKey, pageLabel, path }: PageStatusOptions) {
  useEffect(() => {
    const now = new Date().toISOString();
    const payload = {
      pageKey,
      pageLabel: pageLabel ?? pageKey,
      path: path ?? (typeof window !== "undefined" ? window.location.pathname : undefined),
      isLoaded: true,
      lastLoadedAt: now,
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
