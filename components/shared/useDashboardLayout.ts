"use client";

/**
 * Saved card layouts for a dashboard page's DashGrid — per user, per page,
 * stored in Postgres as named "templates" (`dashboard_layouts`).
 *
 *   const L = useDashboardLayout("options", DEFAULT_LAYOUT);
 *   <LayoutBar {...L.bar} />
 *   <DashGrid layout={L.layout} onLayoutChange={L.setLayout} locked={!L.editing}>…</DashGrid>
 *
 * Contract with the page:
 *   - The PAGE owns the card ids and passes its built-in arrangement as
 *     `defaults`. Anything saved is reconciled against that on load, so adding
 *     or removing a card never invalidates someone's saved template: unknown
 *     ids are dropped, new ids are appended below the saved cards.
 *   - Nothing here throws. A logged-out user, a 401, a dead API — every failure
 *     path lands on the page's built-in layout with saving disabled, because a
 *     layout preference is never worth breaking a page over.
 *
 * Saving: edits autosave (debounced) into the ACTIVE template. Until the user
 * has saved one, edits stay local — the first explicit Save creates it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compactLayout } from "./DashGrid";
import type { GridItem } from "@/lib/layoutStore";

const API = "/api/dashboard-layout";
const AUTOSAVE_MS = 900;

export type LayoutTemplate = {
  name: string;
  layout: GridItem[];
  isDefault: boolean;
  updatedAt: string | null;
};

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Reconcile a saved layout against the page's current card set.
 * Saved geometry wins for ids that still exist; cards the user has never seen
 * are appended below everything else so nothing lands hidden.
 *
 * The result is run through compactLayout, so a template saved before a card
 * was added — or written by an older client that allowed overlaps — can never
 * come back as a stack of cards on top of each other.
 */
export function mergeLayout(saved: GridItem[], defaults: GridItem[]): GridItem[] {
  const savedById = new Map(saved.map((i) => [i.id, i]));
  const known = new Set(defaults.map((d) => d.id));
  const kept: GridItem[] = [];
  const missing: GridItem[] = [];

  for (const d of defaults) {
    const s = savedById.get(d.id);
    if (s) kept.push({ ...d, x: s.x, y: s.y, w: s.w, h: s.h });
    else missing.push(d);
  }
  // User-added cards (iframe tiles etc.) aren't in `defaults` — keep them.
  for (const s of saved) if (!known.has(s.id) && s.type) kept.push({ ...s });

  if (missing.length) {
    let y = kept.reduce((m, i) => Math.max(m, i.y + i.h), 0);
    for (const m of missing) {
      kept.push({ ...m, y });
      y += m.h;
    }
  }
  return compactLayout(kept);
}

function sameLayout(a: GridItem[], b: GridItem[]): boolean {
  if (a.length !== b.length) return false;
  const key = (l: GridItem[]) =>
    l.map((i) => `${i.id}:${i.x},${i.y},${i.w},${i.h}`).sort().join("|");
  return key(a) === key(b);
}

export function useDashboardLayout(page: string, defaults: GridItem[]) {
  const [layout, setLayoutState] = useState<GridItem[]>(defaults);
  const [templates, setTemplates] = useState<LayoutTemplate[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [canSave, setCanSave] = useState(true); // false once the API says 401/404
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // `defaults` is almost always a module constant, but don't rely on that.
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeName;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API}?page=${encodeURIComponent(page)}`, { cache: "no-store" });
        if (!alive) return;
        if (!r.ok) {
          // 401 (no session) / 404 (route not deployed yet) → local-only mode.
          setCanSave(r.status !== 401 && r.status !== 404);
          setLoaded(true);
          return;
        }
        const j = (await r.json()) as { templates?: LayoutTemplate[] };
        if (!alive) return;
        const list = Array.isArray(j?.templates) ? j.templates : [];
        setTemplates(list);
        const pick = list.find((t) => t.isDefault) ?? list[0];
        if (pick) {
          setActiveName(pick.name);
          setLayoutState(mergeLayout(pick.layout ?? [], defaultsRef.current));
        }
      } catch {
        /* offline / blocked — built-in layout stands */
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [page]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // ── persistence ───────────────────────────────────────────────────────────
  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, ...body }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { error?: string })?.error || `HTTP ${r.status}`);
      }
      return r.json().catch(() => ({}));
    },
    [page],
  );

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${API}?page=${encodeURIComponent(page)}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { templates?: LayoutTemplate[] };
      setTemplates(Array.isArray(j?.templates) ? j.templates : []);
    } catch {
      /* the list just stays stale */
    }
  }, [page]);

  const saveNow = useCallback(
    async (next: GridItem[], name?: string, makeDefault?: boolean) => {
      const target = name ?? activeRef.current;
      if (!target || !canSave) return;
      setSaveState("saving");
      try {
        await post({ name: target, layout: next, ...(makeDefault ? { makeDefault: true } : {}) });
        setSaveState("saved");
        setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1600);
        void refresh();
      } catch {
        setSaveState("error");
      }
    },
    [canSave, post, refresh],
  );

  /** DashGrid's onLayoutChange — updates the view now, persists shortly after. */
  const setLayout = useCallback(
    (next: GridItem[]) => {
      setLayoutState(next);
      if (!activeRef.current || !canSave) return; // unsaved working layout
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void saveNow(next), AUTOSAVE_MS);
    },
    [canSave, saveNow],
  );

  /** Save the current arrangement under a (possibly new) name and switch to it. */
  const saveAs = useCallback(
    async (rawName: string) => {
      const name = rawName.trim().slice(0, 40);
      if (!name) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      setActiveName(name);
      await saveNow(layout, name, true);
    },
    [layout, saveNow],
  );

  const selectTemplate = useCallback(
    (name: string) => {
      const t = templates.find((x) => x.name === name);
      if (!t) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      setActiveName(name);
      setLayoutState(mergeLayout(t.layout ?? [], defaultsRef.current));
      void post({ name, action: "set-default" }).then(refresh).catch(() => {});
    },
    [templates, post, refresh],
  );

  const deleteTemplate = useCallback(
    async (name: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      try {
        await post({ name, action: "delete" });
      } catch {
        /* fall through — refresh will show the truth */
      }
      const rest = templates.filter((t) => t.name !== name);
      setTemplates(rest);
      if (activeRef.current === name) {
        const next = rest[0] ?? null;
        setActiveName(next?.name ?? null);
        setLayoutState(next ? mergeLayout(next.layout ?? [], defaultsRef.current) : defaultsRef.current);
      }
      void refresh();
    },
    [templates, post, refresh],
  );

  /** Back to the page's built-in arrangement (and persist it if a template is active). */
  const resetLayout = useCallback(() => {
    const d = defaultsRef.current;
    setLayoutState(d);
    if (activeRef.current && canSave) {
      if (timerRef.current) clearTimeout(timerRef.current);
      void saveNow(d);
    }
  }, [canSave, saveNow]);

  const dirty = useMemo(
    () => !activeName && !sameLayout(layout, defaults),
    [activeName, layout, defaults],
  );

  return {
    layout,
    setLayout,
    editing,
    setEditing,
    loaded,
    templates,
    activeName,
    saveState,
    canSave,
    /** true when there are unsaved changes and no template to autosave into */
    dirty,
    saveAs,
    selectTemplate,
    deleteTemplate,
    resetLayout,
    /** everything <LayoutBar /> needs, in one spread */
    bar: {
      editing,
      setEditing,
      templates,
      activeName,
      saveState,
      canSave,
      dirty,
      onSaveAs: saveAs,
      onSelect: selectTemplate,
      onDelete: deleteTemplate,
      onReset: resetLayout,
    },
  };
}

export type LayoutBarProps = ReturnType<typeof useDashboardLayout>["bar"];
