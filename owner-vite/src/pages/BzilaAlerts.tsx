import { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell, Card } from "../components/PageCard";
import { OWNER_THEME, rgba, homeInputStyle, homeButtonStyle, homeSecondaryButtonStyle } from "../lib/theme";
import { useRefreshButton } from "../hooks/useRefreshButton";

/* ────────────────────────────────────────────────────────────────────────────
 * Bzila Alerts — owner-vite port of the old /owner/dev/bzila-alerts page (the
 * "View reactions →" target from the GlobalToolbar bell). Full management view:
 * compose a broadcast, see every alert Brandon has sent, and read the 👍/👎
 * reaction tally each one earned. Same API the bell uses:
 *   GET    /api/bzila-alerts            → { alerts: Alert[] }
 *   POST   /api/bzila-alerts            → { title, body }
 *   PATCH  /api/bzila-alerts            → { id, title, body }
 *   DELETE /api/bzila-alerts?id=<id>
 * AuthGate already restricts the whole owner-vite app to the owner, so the
 * compose / edit / delete controls render unconditionally here.
 * ════════════════════════════════════════════════════════════════════════════ */

type Alert = {
  id: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  up?: number;
  down?: number;
};

const GREEN = "#1FD98A";
const CYAN = OWNER_THEME.cyan;

function ago(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatTile({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 120,
        padding: "12px 16px",
        borderRadius: 14,
        border: `1px solid ${OWNER_THEME.border}`,
        background: `radial-gradient(circle at 50% 0%, ${rgba(color, 0.1)} 0%, transparent 60%), ${OWNER_THEME.panelBg}`,
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: OWNER_THEME.text, opacity: 0.6, marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

export default function BzilaAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/bzila-alerts", { cache: "no-store" });
      const d = await r.json();
      setAlerts(Array.isArray(d?.alerts) ? d.alerts : []);
      setErr(null);
    } catch {
      setErr("Failed to load alerts.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 45000);
    return () => clearInterval(id);
  }, [load]);

  const refresh = useRefreshButton(load);

  const send = async () => {
    const body = draftBody.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await fetch("/api/bzila-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draftTitle.trim(), body }),
      });
      setDraftTitle("");
      setDraftBody("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    const body = editBody.trim();
    if (!editingId || !body || busy) return;
    setBusy(true);
    try {
      await fetch("/api/bzila-alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, title: editTitle.trim(), body }),
      });
      setEditingId(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/bzila-alerts?id=${id}`, { method: "DELETE" });
      if (editingId === id) setEditingId(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const stats = useMemo(() => {
    const total = alerts.length;
    const up = alerts.reduce((s, a) => s + (a.up ?? 0), 0);
    const down = alerts.reduce((s, a) => s + (a.down ?? 0), 0);
    return { total, up, down };
  }, [alerts]);

  const linkBtn = (color: string): React.CSSProperties => ({
    background: "none",
    border: "none",
    padding: 0,
    color,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  });

  return (
    <PageShell maxWidth={860}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img src="/bzila-hero.png" alt="" style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", border: `1px solid ${rgba(OWNER_THEME.orange, 0.5)}` }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: OWNER_THEME.text, letterSpacing: "0.01em" }}>Bzila Alerts</div>
          <div style={{ fontSize: 12, color: OWNER_THEME.text, opacity: 0.55 }}>Broadcasts to paid subscribers · reaction tally</div>
        </div>
        <button onClick={refresh.trigger} style={refresh.style}>{refresh.label}</button>
      </div>

      {/* Stat row */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatTile label="Alerts sent" value={stats.total} color={CYAN} />
        <StatTile label="👍 Total" value={stats.up} color={GREEN} />
        <StatTile label="👎 Total" value={stats.down} color={OWNER_THEME.red} />
      </div>

      {/* Compose */}
      <Card title="New alert" variant="classic">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Title (optional)"
            maxLength={120}
            style={{ ...homeInputStyle, width: "100%", boxSizing: "border-box" }}
          />
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            placeholder="Type an alert…"
            maxLength={2000}
            rows={3}
            style={{ ...homeInputStyle, width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={send}
              disabled={busy || !draftBody.trim()}
              style={{ ...homeButtonStyle, opacity: busy || !draftBody.trim() ? 0.5 : 1, cursor: busy || !draftBody.trim() ? "not-allowed" : "pointer" }}
            >
              {busy ? "Sending…" : "Send alert"}
            </button>
          </div>
        </div>
      </Card>

      {/* List */}
      <Card title={`All alerts${loaded ? ` · ${alerts.length}` : ""}`} variant="classic">
        {err && <div style={{ fontSize: 13, color: OWNER_THEME.red, marginBottom: 10 }}>{err}</div>}
        {!loaded ? (
          <div style={{ fontSize: 14, color: OWNER_THEME.text, opacity: 0.5, padding: "8px 2px" }}>Loading…</div>
        ) : alerts.length === 0 ? (
          <div style={{ fontSize: 14, color: OWNER_THEME.text, opacity: 0.5, padding: "8px 2px" }}>No alerts yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {alerts.map((a) => {
              const editing = editingId === a.id;
              return (
                <div
                  key={a.id}
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    border: `1px solid ${OWNER_THEME.border}`,
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  {editing ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="Title (optional)"
                        maxLength={120}
                        style={{ ...homeInputStyle, width: "100%", boxSizing: "border-box" }}
                      />
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        maxLength={2000}
                        rows={3}
                        style={{ ...homeInputStyle, width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }}
                      />
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button onClick={() => setEditingId(null)} style={homeSecondaryButtonStyle}>Cancel</button>
                        <button onClick={saveEdit} disabled={busy || !editBody.trim()} style={{ ...homeButtonStyle, opacity: busy || !editBody.trim() ? 0.5 : 1 }}>Save</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {a.title && (
                        <div style={{ fontSize: 15, fontWeight: 800, color: OWNER_THEME.text, marginBottom: 4 }}>{a.title}</div>
                      )}
                      <div style={{ fontSize: 14, lineHeight: 1.5, color: rgba(OWNER_THEME.text as string, 0.9), whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {a.body}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700, color: GREEN, fontVariantNumeric: "tabular-nums" }}>
                          👍 {a.up ?? 0}
                        </span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700, color: OWNER_THEME.red, fontVariantNumeric: "tabular-nums" }}>
                          👎 {a.down ?? 0}
                        </span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 12, color: OWNER_THEME.text, opacity: 0.45, fontWeight: 600 }}>{ago(a.created_at)}</span>
                        <button onClick={() => { setEditingId(a.id); setEditTitle(a.title); setEditBody(a.body); }} style={linkBtn(CYAN)}>Edit</button>
                        <button onClick={() => del(a.id)} style={linkBtn(OWNER_THEME.red)}>Delete</button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </PageShell>
  );
}
