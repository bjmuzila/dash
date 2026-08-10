// ─────────────────────────────────────────────────────────────────────────────
// /owner/watchlists — the HOME of the CB Edge ticker rosters.
//
// The three CB Edge lists (scanner / em / far-cb) are LIVE and EDITABLE here:
// they come from GET /proxy/rosters, which resolves each roster as
// "file baseline + roster_overrides" (see server-v2/roster-store.js). Adding,
// removing or moving a ticker writes an override row and the recorders pick it
// up on their next sweep — no redeploy.
//
// The tastytrade tabs stay a STATIC snapshot from pages/watchlists/data.ts —
// they're reference exports, not something we own or can edit.
//
// data.ts's CB Edge entries are kept as the OFFLINE FALLBACK: if /proxy/rosters
// can't be reached the page still renders the file baseline read-only, clearly
// marked, rather than showing an empty roster.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageShell, Card } from "../components/PageCard";
import { OWNER_THEME as T, homeInputStyle, ownerRgba } from "../lib/theme";
import { WATCHLISTS, TT_PUBLIC_WATCHLISTS, TT_CAPTURED, SNAPSHOT_DATE } from "./watchlists/data";

const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

// ── API shapes (mirror roster-store.js's pack()) ─────────────────────────────

type ApiBucket = {
  id: string;
  label: string;
  note: string;
  hot: boolean;
  overlay: boolean;
  symbols: string[];
};
type ApiOverride = {
  symbol: string;
  action: "add" | "remove";
  bucket: string;
  note: string;
  createdAt: string | null;
};
type ApiRoster = {
  id: string;
  label: string;
  source: string;
  blurb: string;
  editable: boolean;
  live: boolean;
  version: number;
  buckets: ApiBucket[];
  symbols: string[];
  hot: string[];
  overrides: ApiOverride[];
};

/** data.ts ids that map to a server roster id. Everything else is tastytrade. */
const LIVE_LIST_IDS = ["scanner", "em", "farcb"] as const;
type LiveListId = (typeof LIVE_LIST_IDS)[number];
const isLiveList = (id: string): id is LiveListId =>
  (LIVE_LIST_IDS as readonly string[]).includes(id);

// ── styling helpers ──────────────────────────────────────────────────────────

function tabStyle(active: boolean, accent: string) {
  return {
    padding: "7px 13px",
    borderRadius: 8,
    border: `1px solid ${active ? accent : T.border}`,
    background: active ? ownerRgba(accent, 0.14) : "rgba(255,255,255,0.03)",
    color: active ? accent : T.text,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  };
}

function btnStyle(accent: string, opts: { solid?: boolean; disabled?: boolean } = {}) {
  return {
    padding: "5px 10px",
    borderRadius: 6,
    border: `1px solid ${opts.solid ? accent : T.border}`,
    background: opts.solid ? ownerRgba(accent, 0.16) : "rgba(255,255,255,0.04)",
    color: opts.disabled ? ownerRgba("#ffffff", 0.35) : opts.solid ? accent : T.text,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    cursor: opts.disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap" as const,
    opacity: opts.disabled ? 0.55 : 1,
  };
}

const ACCENTS = [T.cyan, T.orange, T.green, T.gold];

/** Stable accent per list, so a tab's colour does not shift when lists are added. */
function accentFor(id: string): string {
  const i = WATCHLISTS.findIndex((w) => w.id === id);
  return ACCENTS[(i < 0 ? 0 : i) % ACCENTS.length];
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function Watchlists() {
  const [tab, setTab] = useState<string>(WATCHLISTS[0].id);
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const [rosters, setRosters] = useState<Record<string, ApiRoster> | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Which chip's action menu is open, and where to draw it.
  const [menu, setMenu] = useState<{ list: string; bucket: string; symbol: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const say = useCallback((kind: "ok" | "err", text: string) => {
    setFlash({ kind, text });
    window.setTimeout(() => setFlash((f) => (f && f.text === text ? null : f)), 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/proxy/rosters", { credentials: "include", cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setRosters(j.rosters as Record<string, ApiRoster>);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(String((e as Error)?.message || e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Close the chip menu on any outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const edit = useCallback(
    async (body: { list: string; action: "add" | "remove" | "move"; symbol: string; bucket?: string }) => {
      setBusy(true);
      try {
        const r = await fetch("/proxy/roster", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
        if (!j?.ok) { say("err", j?.error || `HTTP ${r.status}`); return false; }
        setRosters((prev) => (prev ? { ...prev, [body.list]: j.roster as ApiRoster } : prev));
        const verb = body.action === "remove" ? "removed" : body.action === "move" ? "moved" : "added";
        say("ok", `${body.symbol.toUpperCase()} ${verb}${body.bucket ? ` → ${body.bucket}` : ""}`);
        return true;
      } catch (e) {
        say("err", String((e as Error)?.message || e));
        return false;
      } finally {
        setBusy(false);
        setMenu(null);
      }
    },
    [say],
  );

  const resetList = useCallback(async (list: string) => {
    setBusy(true);
    try {
      const r = await fetch("/proxy/roster-reset", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list }),
      });
      const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
      if (!j?.ok) { say("err", j?.error || `HTTP ${r.status}`); return; }
      setRosters((prev) => (prev ? { ...prev, [list]: j.roster as ApiRoster } : prev));
      say("ok", `${list}: ${j.cleared ?? 0} override(s) cleared — back to the file`);
    } catch (e) {
      say("err", String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  }, [say]);

  // ── active list, resolved from the API where possible ──────────────────────

  const staticActive = WATCHLISTS.find((w) => w.id === tab) ?? WATCHLISTS[0];
  const liveActive = isLiveList(staticActive.id) ? rosters?.[staticActive.id] : undefined;
  const editable = !!liveActive?.editable;
  const accent = accentFor(staticActive.id);
  const query = q.trim().toUpperCase();

  const source = liveActive?.source ?? staticActive.source;
  const blurb = liveActive?.blurb ?? staticActive.blurb;

  // Normalise both shapes to one render model.
  const allGroups = useMemo(() => {
    if (liveActive) {
      return liveActive.buckets.map((b) => ({
        id: b.id, label: b.label, note: b.note, symbols: b.symbols, hot: b.hot, overlay: b.overlay,
      }));
    }
    return staticActive.groups.map((g) => ({
      id: g.id, label: g.label, note: g.note, symbols: g.symbols, hot: false, overlay: false,
    }));
  }, [liveActive, staticActive]);

  // Filter within the active list; groups that empty out are dropped entirely
  // so a search never leaves a wall of empty headers. Editable lists keep their
  // empty groups when unfiltered, so there's somewhere to add the first ticker.
  const groups = useMemo(
    () =>
      allGroups
        .map((g) => ({ ...g, symbols: g.symbols.filter((s) => !query || s.includes(query)) }))
        .filter((g) => g.symbols.length > 0 || (!query && editable)),
    [allGroups, query, editable],
  );

  const shown = groups.reduce((n, g) => n + g.symbols.length, 0);
  const total = allGroups.reduce((n, g) => n + g.symbols.length, 0);

  // symbol -> override, for the "added / moved" chip badges.
  const overrideBy = useMemo(() => {
    const m = new Map<string, ApiOverride>();
    for (const o of liveActive?.overrides ?? []) m.set(o.symbol, o);
    return m;
  }, [liveActive]);
  const removedOverrides = (liveActive?.overrides ?? []).filter((o) => o.action === "remove");

  const copy = (label: string, syms: string[]) => {
    void navigator.clipboard?.writeText(syms.join(", "));
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1400);
  };

  const bucketIds = allGroups.map((g) => g.id);

  return (
    <PageShell maxWidth={1240}>
      <div>
        <div style={{ fontSize: 12, color: T.text, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 800, marginBottom: 6 }}>
          Reference
        </div>
        <h1 style={{ fontSize: 28, lineHeight: 1.1, margin: "0 0 8px", fontWeight: 800, color: T.text }}>
          Watchlists
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: T.text, opacity: 0.75, lineHeight: 1.6 }}>
          The <span style={{ color: T.lightBlue, fontWeight: 700 }}>CB Edge</span> lists are live and editable — an add
          or remove here writes a roster override and the recorders pick it up on their next sweep, no redeploy. The
          file in <span style={{ fontFamily: MONO }}>server-v2/</span> stays the baseline; <b>Reset to file</b> drops
          every override and hands control back to it.
          <br />
          The <span style={{ color: T.lightBlue, fontWeight: 700 }}>Tastytrade</span> tabs are still a static snapshot
          captured {SNAPSHOT_DATE} — reference exports, nothing to edit.
        </p>
      </div>

      {loadErr && (
        <Card variant="classic" padding={14} style={{ borderColor: ownerRgba(T.orange, 0.5) }}>
          <div style={{ fontSize: 13, color: T.orange, fontWeight: 700 }}>
            Couldn’t reach /proxy/rosters — {loadErr}
          </div>
          <div style={{ fontSize: 12, color: T.text, opacity: 0.7, marginTop: 5 }}>
            Showing the file baseline from <span style={{ fontFamily: MONO }}>pages/watchlists/data.ts</span>, read-only.
            Any overrides already saved in the database are NOT reflected below.
          </div>
        </Card>
      )}

      {/* Tabs, split by who owns the list */}
      {(["mine", "tastytrade"] as const).map((owner) => (
        <div key={owner}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: T.text, opacity: 0.5, marginBottom: 7 }}>
            {owner === "mine" ? "CB Edge — server-v2 (editable)" : "Tastytrade (static)"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {WATCHLISTS.filter((w) => w.owner === owner).map((w) => {
              const live = isLiveList(w.id) ? rosters?.[w.id] : undefined;
              const count = live
                ? live.symbols.length
                : w.groups.reduce((n, g) => n + g.symbols.length, 0);
              const edits = live?.overrides.length ?? 0;
              return (
                <button key={w.id} onClick={() => setTab(w.id)} style={tabStyle(w.id === tab, accentFor(w.id))}>
                  {w.label}
                  <span style={{ marginLeft: 7, opacity: 0.65, fontWeight: 700 }}>{count}</span>
                  {edits > 0 && (
                    <span style={{ marginLeft: 6, color: T.gold, fontWeight: 800 }} title={`${edits} override(s)`}>
                      ✎{edits}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <Card variant="classic" padding={0} style={{ overflow: "hidden" }}>
        {/* Header strip: source path + status + filter */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            gap: 14,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "space-between",
          }}
        >
          <div style={{ minWidth: 260, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: T.text, opacity: 0.6 }}>
              Source
            </div>
            <div style={{ fontFamily: MONO, fontSize: 13, color: accent, fontWeight: 700, marginTop: 3 }}>
              {source}
              {liveActive && (
                <span
                  style={{ marginLeft: 10, fontSize: 11, color: liveActive.live ? T.green : T.orange, fontWeight: 800 }}
                  title={liveActive.live
                    ? "Resolved from the database: file baseline + overrides"
                    : "Database unreachable — serving the file baseline only, edits are disabled"}
                >
                  {liveActive.live ? "● LIVE" : "● BASELINE (no DB)"}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {editable && (
              <>
                <button onClick={() => void load()} disabled={busy} style={btnStyle(T.cyan, { disabled: busy })}>
                  Refresh
                </button>
                <button
                  onClick={() => {
                    if (!liveActive?.overrides.length) { say("ok", "no overrides — already at the file baseline"); return; }
                    void resetList(liveActive.id);
                  }}
                  disabled={busy || !liveActive?.overrides.length}
                  style={btnStyle(T.orange, { disabled: busy || !liveActive?.overrides.length })}
                  title="Delete every override for this list and fall back to the file"
                >
                  Reset to file
                </button>
              </>
            )}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value.toUpperCase())}
              placeholder="Filter ticker…"
              spellCheck={false}
              autoComplete="off"
              style={{ ...homeInputStyle, width: 180, fontFamily: MONO, fontSize: 13 }}
            />
          </div>
        </div>

        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, fontSize: 13, color: T.text, opacity: 0.8, lineHeight: 1.6 }}>
          {blurb}
        </div>

        {flash && (
          <div
            style={{
              padding: "9px 18px",
              borderBottom: `1px solid ${T.border}`,
              fontSize: 12,
              fontWeight: 700,
              color: flash.kind === "ok" ? T.green : T.orange,
              background: ownerRgba(flash.kind === "ok" ? T.green : T.orange, 0.08),
            }}
          >
            {flash.text}
          </div>
        )}

        {query && (
          <div style={{ padding: "9px 18px", borderBottom: `1px solid ${T.border}`, fontSize: 12, color: T.lightBlue, fontWeight: 700 }}>
            {shown} of {total} match “{query}”
          </div>
        )}

        {/* Groups */}
        <div style={{ padding: "4px 0 8px" }}>
          {groups.length === 0 && (
            <div style={{ padding: "26px 18px", fontSize: 13, color: T.text, opacity: 0.55 }}>
              No ticker matches “{query}” in {staticActive.label}.
            </div>
          )}
          {groups.map((g) => (
            <div key={g.id} style={{ padding: "14px 18px", borderTop: `1px solid ${ownerRgba("#ffffff", 0.05)}` }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase", color: accent }}>
                  {g.label}
                </span>
                {g.hot && (
                  <span style={{ fontSize: 10, fontWeight: 800, color: T.orange, letterSpacing: "0.08em" }} title="Fast lane — 2-minute sweeps">
                    HOT
                  </span>
                )}
                <span style={{ fontSize: 12, color: T.text, opacity: 0.55, fontWeight: 700 }}>{g.symbols.length}</span>
                <span style={{ fontSize: 12, color: T.text, opacity: 0.55 }}>· {g.note}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 7, alignItems: "center" }}>
                  {editable && liveActive && (
                    <AddTicker
                      accent={accent}
                      busy={busy}
                      bucket={g.id}
                      onAdd={(sym) => edit({ list: liveActive.id, action: "add", symbol: sym, bucket: g.id })}
                    />
                  )}
                  <button onClick={() => copy(g.label, g.symbols)} style={btnStyle(copied === g.label ? T.green : T.cyan)}>
                    {copied === g.label ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              {g.symbols.length === 0 ? (
                <div style={{ fontSize: 12, color: T.text, opacity: 0.45, fontStyle: "italic" }}>
                  Empty — add a ticker with the field above.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 5 }}>
                  {g.symbols.map((s) => {
                    const ov = overrideBy.get(s);
                    const isAdded = ov?.action === "add";
                    return (
                      <button
                        key={s}
                        disabled={!editable || busy}
                        onClick={(e) => {
                          if (!editable || !liveActive) return;
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setMenu({ list: liveActive.id, bucket: g.id, symbol: s, x: r.left, y: r.bottom + 4 });
                        }}
                        title={
                          editable
                            ? isAdded ? `${s} — added/moved here from the owner page. Click to move or remove.` : `${s} — click to move or remove`
                            : s
                        }
                        style={{
                          fontFamily: MONO,
                          fontSize: 12,
                          fontWeight: 700,
                          color: isAdded ? T.gold : T.text,
                          background: isAdded ? ownerRgba(T.gold, 0.10) : T.panelInset,
                          border: `1px solid ${isAdded ? ownerRgba(T.gold, 0.45) : T.border}`,
                          borderRadius: 5,
                          padding: "5px 7px",
                          textAlign: "center",
                          letterSpacing: "0.02em",
                          cursor: editable && !busy ? "pointer" : "default",
                        }}
                      >
                        {s}{isAdded ? " ✎" : ""}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Removed-by-override footer: the only place a stripped ticker is still
            visible, so a removal is reversible without reading the database. */}
        {editable && removedOverrides.length > 0 && (
          <div style={{ padding: "14px 18px", borderTop: `1px solid ${T.border}`, background: ownerRgba(T.orange, 0.05) }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.orange, marginBottom: 9 }}>
              Removed from the file baseline ({removedOverrides.length})
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {removedOverrides.map((o) => (
                <button
                  key={o.symbol}
                  disabled={busy}
                  onClick={() => liveActive && void resetSymbol(liveActive.id, o.symbol)}
                  title={`Restore ${o.symbol} to its bucket in ${source}`}
                  style={{
                    fontFamily: MONO,
                    fontSize: 12,
                    fontWeight: 700,
                    color: T.orange,
                    background: "rgba(255,255,255,0.03)",
                    border: `1px dashed ${ownerRgba(T.orange, 0.5)}`,
                    borderRadius: 5,
                    padding: "5px 9px",
                    cursor: busy ? "not-allowed" : "pointer",
                    textDecoration: "line-through",
                  }}
                >
                  {o.symbol} ↺
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Chip action menu */}
      {menu && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: Math.min(menu.x, window.innerWidth - 210),
            top: menu.y,
            zIndex: 10001,
            width: 196,
            background: "rgba(13,17,25,0.97)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: `1px solid ${T.border}`,
            borderTop: `2px solid ${ownerRgba(T.cyan, 0.5)}`,
            borderRadius: 6,
            boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "8px 11px", borderBottom: `1px solid ${T.border}`, fontFamily: MONO, fontSize: 13, fontWeight: 800, color: T.cyan }}>
            {menu.symbol}
          </div>
          {bucketIds.filter((b) => b !== menu.bucket).map((b) => (
            <div
              key={b}
              onClick={() => void edit({ list: menu.list, action: "move", symbol: menu.symbol, bucket: b })}
              style={{ padding: "7px 11px", fontSize: 12, fontWeight: 700, color: T.text, cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              Move to <span style={{ color: T.cyan }}>{b}</span>
            </div>
          ))}
          <div
            onClick={() => void edit({ list: menu.list, action: "remove", symbol: menu.symbol })}
            style={{ padding: "7px 11px", fontSize: 12, fontWeight: 800, color: T.orange, cursor: "pointer", borderTop: `1px solid ${T.border}` }}
            onMouseEnter={(e) => (e.currentTarget.style.background = ownerRgba(T.orange, 0.12))}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Remove from list
          </div>
        </div>
      )}

      {/* Tastytrade catalog — names only */}
      <Card variant="classic" title="Tastytrade public watchlists" subtitle={`${TT_PUBLIC_WATCHLISTS.length} available · ${TT_CAPTURED.length} captured above`}>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: T.text, opacity: 0.75, lineHeight: 1.6 }}>
          Everything tastytrade exposes at <span style={{ fontFamily: MONO, color: T.lightBlue }}>GET /public-watchlists</span>.
          Highlighted names are captured in the tabs above. To pull another, hit{" "}
          <span style={{ fontFamily: MONO, color: T.lightBlue }}>/public-watchlists/&#123;name&#125;</span> with the name
          URL-encoded and the OAuth token as <span style={{ fontFamily: MONO }}>Bearer</span>.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 5 }}>
          {TT_PUBLIC_WATCHLISTS.map((n) => {
            const got = TT_CAPTURED.includes(n);
            return (
              <div
                key={n}
                style={{
                  fontSize: 12,
                  color: got ? T.green : T.text,
                  opacity: got ? 1 : 0.6,
                  fontWeight: got ? 700 : 400,
                  background: got ? ownerRgba(T.green, 0.10) : T.panelInset,
                  border: `1px solid ${got ? ownerRgba(T.green, 0.35) : T.border}`,
                  borderRadius: 5,
                  padding: "6px 9px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={got ? `${n} — captured above` : n}
              >
                {got ? "✓ " : ""}{n}
              </div>
            );
          })}
        </div>
      </Card>
    </PageShell>
  );

  /** Drop the single override pinning `symbol`, restoring the file baseline. */
  async function resetSymbol(list: string, symbol: string) {
    setBusy(true);
    try {
      const r = await fetch("/proxy/roster-reset", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list, symbol }),
      });
      const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
      if (!j?.ok) { say("err", j?.error || `HTTP ${r.status}`); return; }
      setRosters((prev) => (prev ? { ...prev, [list]: j.roster as ApiRoster } : prev));
      say("ok", `${symbol} restored from ${source}`);
    } catch (e) {
      say("err", String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  }
}

// ── add-a-ticker input ───────────────────────────────────────────────────────

function AddTicker({
  accent, bucket, busy, onAdd,
}: {
  accent: string;
  bucket: string;
  busy: boolean;
  onAdd: (symbol: string) => Promise<boolean>;
}) {
  const [v, setV] = useState("");
  const submit = async () => {
    const sym = v.trim().toUpperCase();
    if (!sym) return;
    const ok = await onAdd(sym);
    if (ok) setV("");
  };
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
      <input
        value={v}
        onChange={(e) => setV(e.target.value.toUpperCase())}
        onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
        placeholder={`Add to ${bucket}…`}
        spellCheck={false}
        autoComplete="off"
        disabled={busy}
        style={{ ...homeInputStyle, width: 132, fontFamily: MONO, fontSize: 12, padding: "5px 8px" }}
      />
      <button onClick={() => void submit()} disabled={busy || !v.trim()} style={btnStyle(accent, { solid: true, disabled: busy || !v.trim() })}>
        Add
      </button>
    </div>
  );
}
