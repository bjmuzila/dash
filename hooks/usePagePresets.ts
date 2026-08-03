"use client";

/**
 * Named page presets, stored per user in Postgres via /api/page-preset.
 *
 * Mirrors the contract of components/shared/useDashboardLayout.ts on purpose —
 * same table, same per-user/per-page/per-name identity, same "one is default"
 * rule — so the two behave identically from a page's point of view even though
 * one stores a grid and the other an arbitrary blob.
 *
 * The rule inherited from that hook, and worth restating: NOTHING HERE THROWS.
 * A logged-out user, a 401, a dead API — every failure path lands on "no
 * presets, saving disabled" and leaves the page working off localStorage
 * exactly as it does today. A layout preference is never worth breaking a
 * trading page over.
 *
 * Deliberately NOT autosaving, which is the one place it departs from
 * useDashboardLayout. That hook debounces edits into the active template
 * because dragging a card IS the edit. Here every toggle on the page already
 * persists to localStorage, so autosaving would quietly rewrite a named preset
 * every time you flipped an overlay to look at something — and you'd lose the
 * preset by using the page. Saving is explicit.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const API = "/api/page-preset";

export type Preset<T> = {
  name: string;
  preset: T;
  isDefault: boolean;
  updatedAt: string | null;
};

export type SaveState = "idle" | "saving" | "saved" | "error";

export type UsePagePresets<T> = {
  presets: Array<Preset<T>>;
  /** Name of the preset marked default, or null. */
  defaultName: string | null;
  loading: boolean;
  /** False when the API is unreachable or the user isn't signed in. */
  canSave: boolean;
  saveState: SaveState;
  /** Last error, for surfacing in the UI. Cleared on the next successful call. */
  error: string | null;
  save: (name: string, value: T, makeDefault?: boolean) => Promise<boolean>;
  remove: (name: string) => Promise<boolean>;
  setDefault: (name: string) => Promise<boolean>;
  reload: () => void;
};

export function usePagePresets<T>(page: string): UsePagePresets<T> {
  const [presets, setPresets] = useState<Array<Preset<T>>>([]);
  const [loading, setLoading] = useState(true);
  const [canSave, setCanSave] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  // Guards the state setters after unmount, and drops a stale list if `page`
  // changes while a fetch is in flight.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API}?page=${encodeURIComponent(page)}`, { cache: "no-store" });
        if (!res.ok) {
          // 401 is the common one: not signed in. Not an error worth showing —
          // the page works fine without presets.
          if (!cancelled) { setPresets([]); setCanSave(false); }
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        setPresets(Array.isArray(json?.presets) ? json.presets : []);
        setCanSave(true);
        setError(null);
      } catch {
        if (!cancelled) { setPresets([]); setCanSave(false); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [page, epoch]);

  const reload = useCallback(() => setEpoch((n) => n + 1), []);

  const post = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    setSaveState("saving");
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ page, ...body }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        // The server's message is the useful one — "Preset limit reached (12)"
        // beats a generic failure toast.
        setError(String(json?.error ?? `HTTP ${res.status}`));
        setSaveState("error");
        return false;
      }
      setError(null);
      setSaveState("saved");
      // Re-read rather than patching local state: the server decides is_default
      // (first preset auto-defaults), and guessing that here would drift.
      setEpoch((n) => n + 1);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaveState("error");
      return false;
    }
  }, [page]);

  const save = useCallback(
    (name: string, value: T, makeDefault = false) =>
      post({ action: "save", name, preset: value, makeDefault }),
    [post],
  );
  const remove = useCallback((name: string) => post({ action: "delete", name }), [post]);
  const setDefault = useCallback((name: string) => post({ action: "set-default", name }), [post]);

  // Reset the transient "saved" tick so the button doesn't sit on a stale
  // confirmation for the rest of the session.
  useEffect(() => {
    if (saveState !== "saved") return;
    const id = setTimeout(() => setSaveState("idle"), 1800);
    return () => clearTimeout(id);
  }, [saveState]);

  return {
    presets,
    defaultName: presets.find((p) => p.isDefault)?.name ?? null,
    loading,
    canSave,
    saveState,
    error,
    save,
    remove,
    setDefault,
    reload,
  };
}
