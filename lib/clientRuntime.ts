"use client";

let lastLiveFeedCheckAt = 0;
let lastLiveFeedReady = false;
let pendingLiveFeedCheck: Promise<boolean> | null = null;

function normalizeBaseUrl(url: string, secureProtocol: "http" | "ws"): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed) || /^wss?:\/\//i.test(trimmed)) return trimmed;
  return `${secureProtocol === "ws" ? "wss" : "https"}://${trimmed}`;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function getClientProxyBase(): string {
  if (typeof window === "undefined") return "";
  const envUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_PROXY_URL ?? "", "http");
  if (envUrl) return envUrl;
  if (isLocalHost(window.location.hostname)) {
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }
  // Use same-origin requests (relative path) for production
  return window.location.origin;
}

export function getClientWsUrl(): string { return ""; }

export async function isLiveFeedReady(force = false): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const now = Date.now();

  if (!force && now - lastLiveFeedCheckAt < 15000) {
    return lastLiveFeedReady;
  }

  if (pendingLiveFeedCheck) return pendingLiveFeedCheck;

  pendingLiveFeedCheck = fetch("/api/keepalive", {
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
  })
    .then(async (res) => {
      if (!res.ok) return false;
      const json = await res.json().catch(() => ({ ok: false }));
      return Boolean(json?.ok);
    })
    .catch(() => false)
    .then((ready) => {
      lastLiveFeedReady = ready;
      lastLiveFeedCheckAt = Date.now();
      pendingLiveFeedCheck = null;
      return ready;
    });

  return pendingLiveFeedCheck;
}
