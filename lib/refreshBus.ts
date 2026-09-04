"use client";

/**
 * refreshBus — the registry behind the universal refresh button.
 *
 * WHY A BUS AND NOT A REMOUNT
 * ---------------------------
 * "Refresh" on a dashboard means "re-pull what this screen is showing". The
 * cheap version of that is to remount the route and let every hook run its
 * mount fetch again, and it is wrong twice over: it throws away the chart's
 * zoom, the expiry you picked and the panel you opened, and it does NOT touch
 * anything living on the shared socket, which does not re-open on a remount.
 *
 * So each data hook REGISTERS its own re-fetch here and the toolbar button
 * calls all of them. The registry is module-scoped and the registrations are
 * effect-scoped, which gives the routing property for free: a hook that is not
 * mounted is not registered, so pressing refresh re-pulls exactly what the
 * CURRENT route reads — no route table to keep in sync, and a page added
 * tomorrow is covered the moment its hooks call `useRefreshSource`.
 *
 * CONTRACT
 * --------
 * A source is an async function that resolves when its data is back and
 * REJECTS when the pull failed. `refreshAll()` runs every source in parallel
 * (they are independent network calls; serialising them would make the button
 * feel broken on a route with five panels) and rejects if any one of them did,
 * which is what puts the button in its error state. A source that throws does
 * not stop the others — `allSettled`, not `all`.
 *
 * Sources must not assume they are called once: the button is disabled while a
 * refresh is in flight, but a hook can also be re-registered by its own deps
 * changing mid-flight. Every source below is already idempotent (they all
 * guard on an in-flight ref or a monotonic sequence token); a new one must be
 * too.
 *
 * WHAT DOES NOT BELONG HERE
 * -------------------------
 * Anything whose "refresh" is a socket reconnect. Dropping /ws/gex re-opens it
 * for every consumer in the tab and clears gexSocket's replay cache — a much
 * bigger hammer than the button implies. Socket-backed hooks register a
 * re-request or their REST fallback instead (see useMobileGex).
 */

import { useEffect, useRef } from "react";

export type RefreshSource = () => void | Promise<unknown>;

type Entry = { fn: RefreshSource; label: string };

const sources = new Map<number, Entry>();
let nextId = 1;

/** Listeners for "the registered set changed" — the button uses it for its count. */
const countListeners = new Set<(n: number) => void>();

function announce(): void {
  const n = sources.size;
  for (const cb of countListeners) {
    try {
      cb(n);
    } catch {
      /* a listener must never break a registration */
    }
  }
}

/**
 * Register a re-fetch. Returns the unregister function — call it from an
 * effect cleanup, which is what `useRefreshSource` does for you.
 *
 * `label` is only ever used in the console warning for a failed source, so it
 * wants to be the hook's name, not a user-facing string.
 */
export function registerRefreshSource(fn: RefreshSource, label = "source"): () => void {
  const id = nextId++;
  sources.set(id, { fn, label });
  announce();
  return () => {
    if (sources.delete(id)) announce();
  };
}

export function refreshSourceCount(): number {
  return sources.size;
}

export function onRefreshSourceCount(cb: (n: number) => void): () => void {
  countListeners.add(cb);
  return () => {
    countListeners.delete(cb);
  };
}

/**
 * Fire every registered source.
 *
 * Resolves when they have all settled; REJECTS if any of them threw, so the
 * button can show a failure rather than a green tick over stale numbers. The
 * rejection carries the labels that failed — the individual reasons are logged
 * here because by the time the button sees this it only renders one word.
 */
export async function refreshAll(): Promise<void> {
  const entries = [...sources.values()];
  if (!entries.length) return;

  const results = await Promise.allSettled(
    entries.map(async (e) => {
      try {
        await e.fn();
      } catch (err) {
        console.warn(`[refresh] ${e.label} failed:`, err);
        throw err;
      }
    }),
  );

  const failed = results
    .map((r, i) => (r.status === "rejected" ? entries[i].label : null))
    .filter(Boolean) as string[];

  if (failed.length) throw new Error(`refresh failed: ${failed.join(", ")}`);
}

/**
 * Register a hook's re-fetch for as long as that hook is mounted.
 *
 * The function is held in a REF and the registration is made once, so a caller
 * may pass a fresh closure on every render without re-registering — which
 * matters because most of these `load` callbacks are `useCallback`s whose deps
 * include the very state they refresh, and re-registering on each change would
 * make the registry churn on every keystroke in a ticker box.
 */
export function useRefreshSource(fn: RefreshSource, label = "source"): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => registerRefreshSource(() => ref.current(), label), [label]);
}
