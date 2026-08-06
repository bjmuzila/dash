import React, { useCallback, useEffect, useState } from "react";

/**
 * /changelog — the engineering changelogs, read LIVE off the backend.
 *
 * This page used to fetch `${BASE_URL}CHANGELOG.md`, i.e. owner-vite's own
 * public/CHANGELOG.md — a file somebody had to hand-copy into this app. That is
 * unfixable from inside owner-vite: its Docker build context is ./owner-vite, so
 * no build step here can reach the repo's real changelogs. The snapshot went
 * weeks stale and the page quietly showed history that stopped in July.
 *
 * It now calls `/api/changelog` (server-v2/api-router.js, owner-only, GET). The
 * dashboard image is built from the repo root, so that process has the files on
 * disk, and nginx already proxies /api → dashboard. The page is current the
 * moment a changelog is committed and the backend redeploys.
 *
 * The bundled public/CHANGELOG.md stays as a fallback for the offline/dev case
 * where /api isn't reachable — clearly labelled as the stale copy when used.
 */

type ChangelogFile = {
  key: string;
  label: string;
  ok: boolean;
  bytes?: number;
  mtime?: number;
  truncated?: boolean;
  error?: string;
  text: string;
};

const C = {
  cyan: "#7dd3fc",
  text: "#e8edf5",
  muted: "rgba(232,237,245,0.55)",
  amber: "#fbbf24",
  border: "rgba(255,255,255,0.10)",
};

function fmtBytes(n?: number): string {
  if (n == null) return "—";
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

function fmtWhen(ms?: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }) + " ET";
}

export default function Changelog() {
  const [files, setFiles] = useState<ChangelogFile[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setStale(false);
    try {
      const r = await fetch("/api/changelog", { cache: "no-store", credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const got: ChangelogFile[] = (j.files ?? []).filter((f: ChangelogFile) => f.ok && f.text);
      if (!got.length) throw new Error("no changelog files returned");
      setFiles(got);
      setOpenKey((cur) => cur ?? got[0].key);
    } catch (e) {
      // Fallback: the per-build snapshot bundled into this app. Better than an
      // error page, but it is the very file whose staleness caused this rewrite —
      // so it is labelled as such rather than passed off as current.
      try {
        const r2 = await fetch(`${import.meta.env.BASE_URL}CHANGELOG.md`, { cache: "no-store" });
        if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
        const t = await r2.text();
        setFiles([{ key: "bundled", label: "CHANGELOG.md (bundled snapshot)", ok: true, text: t }]);
        setOpenKey("bundled");
        setStale(true);
        setErr(String(e instanceof Error ? e.message : e));
      } catch {
        setFiles(null);
        setErr(String(e instanceof Error ? e.message : e));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const active = files?.find((f) => f.key === openKey) ?? files?.[0] ?? null;

  const tabBtn = (on: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
    border: `1px solid ${on ? C.cyan : C.border}`,
    background: on ? "rgba(125,211,252,0.16)" : "transparent",
    color: on ? C.cyan : C.muted,
    letterSpacing: "0.06em", fontFamily: "inherit",
  });

  return (
    <div
      className="wall-scroll"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        background: "radial-gradient(circle at top, rgba(33,158,188,0.08), transparent 40%), #05080d",
        padding: "24px 20px",
        color: C.text,
        fontFamily: "var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontSize: 12, color: "#FFFFFF", letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 800, marginBottom: 8 }}>
          Live Notes
        </div>
        <h1 style={{ fontSize: 28, lineHeight: 1.1, margin: "0 0 10px", fontWeight: 800 }}>Changelog</h1>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "#FFFFFF" }}>
          Read live from the backend at <span style={{ color: C.cyan }}>/api/changelog</span> — current as of the
          running deploy, not a copy bundled into this app.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
          {(files ?? []).map((f) => (
            <button key={f.key} onClick={() => setOpenKey(f.key)} style={tabBtn(f.key === (active?.key ?? ""))}>
              {f.label}
            </button>
          ))}
          <button
            onClick={() => void load()}
            disabled={loading}
            style={{
              marginLeft: "auto", fontSize: 14, fontWeight: 800, padding: "6px 14px", borderRadius: 8,
              cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1,
              border: `1px solid ${C.border}`, background: "transparent", color: C.muted,
              letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
            }}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {stale && (
          <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.amber}55`, background: "rgba(251,191,36,0.10)", fontSize: 14, color: C.amber }}>
            Couldn&apos;t reach <code>/api/changelog</code>{err ? ` (${err})` : ""} — showing the stale copy bundled
            into this build. It is not current.
          </div>
        )}
        {!stale && err && (
          <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.amber}55`, background: "rgba(251,191,36,0.10)", fontSize: 14, color: C.amber }}>
            Couldn&apos;t load the changelog: {err}
          </div>
        )}

        {active && (
          <div
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 18,
              background: "rgba(13,17,25,0.45)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#FFFFFF" }}>Source File</span>
              <span style={{ fontSize: 12, color: C.muted, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span>last written {fmtWhen(active.mtime)}</span>
                <span>{fmtBytes(active.bytes)}</span>
                <span style={{ color: C.cyan, fontWeight: 700 }}>{active.label}</span>
              </span>
            </div>
            {active.truncated && (
              <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 12, color: C.amber }}>
                Showing the newest ~400 KB of this file — the rest is older history, still in the repo.
              </div>
            )}
            <pre
              style={{
                margin: 0,
                padding: 16,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                overflowX: "auto",
                fontSize: 14,
                lineHeight: 1.65,
                color: C.text,
                fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
              }}
            >
              {active.text}
            </pre>
          </div>
        )}

        {!active && !loading && (
          <div style={{ fontSize: 14, color: C.muted }}>No changelog available.</div>
        )}
      </div>
    </div>
  );
}
