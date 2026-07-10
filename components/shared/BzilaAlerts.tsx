"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { HOME_THEME, DOCK_THEME } from "./homeTheme";

/**
 * BzilaAlerts — the "Bzila" alerts bell in the GlobalToolbar (sits just right of
 * the CB Edge logo). Shows Brandon's last 5 broadcast alerts to paid subscribers.
 *
 * Behaviour:
 *   • Renders only for paid subscribers (or the owner).
 *   • Polls /api/bzila-alerts every 45s; the bell PULSES (orange ring + dot)
 *     whenever the newest alert id is greater than the last one this browser has
 *     acknowledged (localStorage). Opening the dropdown acknowledges them.
 *   • Click → DOCK-themed portal dropdown listing the latest 5 alerts.
 *   • OWNER only: a compose box (type + Send) plus Edit / Delete on each alert.
 *     The API route is the real gate; these controls are cosmetic.
 */

type Reaction = "up" | "down" | "";
type Alert = {
  id: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  up?: number;
  down?: number;
  mine?: Reaction;
};

const SEEN_KEY = "bzila:alerts:seen";
const ORANGE = HOME_THEME.orange; // #FB8501 — "new alert" accent
const CYAN = HOME_THEME.cyan;
function cyanA(a: number) { return `rgba(33,158,188,${a})`; }
function orangeA(a: number) { return `rgba(251,133,1,${a})`; }

function readSeen(): number {
  if (typeof window === "undefined") return 0;
  const v = Number(window.localStorage.getItem(SEEN_KEY));
  return Number.isFinite(v) ? v : 0;
}
function writeSeen(id: number) {
  try { window.localStorage.setItem(SEEN_KEY, String(id)); } catch { /* ignore */ }
}

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
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const GREEN = "#1FD98A";

/** One 👍 / 👎 pill with a live count; filled when it's the caller's pick. */
function ThumbBtn({ dir, active, count, onClick }: { dir: "up" | "down"; active: boolean; count: number; onClick: () => void }) {
  const color = active ? (dir === "up" ? GREEN : HOME_THEME.red) : "rgba(255,255,255,0.55)";
  const tint = dir === "up" ? "rgba(31,217,138,0.12)" : "rgba(239,68,68,0.12)";
  return (
    <button
      onClick={onClick}
      title={dir === "up" ? "Helpful" : "Not helpful"}
      aria-label={dir === "up" ? "Thumbs up" : "Thumbs down"}
      aria-pressed={active}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: 999,
        border: `1px solid ${active ? color : "rgba(255,255,255,0.14)"}`,
        background: active ? tint : "transparent",
        color,
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        lineHeight: 1,
      }}
    >
      <span aria-hidden style={{ fontSize: 13 }}>{dir === "up" ? "👍" : "👎"}</span>
      {count > 0 && <span style={{ fontVariantNumeric: "tabular-nums" }}>{count}</span>}
    </button>
  );
}

export default function BzilaAlerts() {
  const { user, isPaid, isOwnerClaim } = useAuth();

  // Owner detection mirrors NavMenu: prefer the build-time owner id, fall back to
  // the JWT claim. Middleware + the API route are the real write gate.
  const ownerId = (process.env.NEXT_PUBLIC_OWNER_USER_ID || "").trim();
  const isOwner = (ownerId ? user?.id === ownerId : false) || isOwnerClaim;
  const canSee = isOwner || isPaid;

  const [mounted, setMounted] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [hover, setHover] = useState(false);

  // compose (owner)
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [busy, setBusy] = useState(false);
  // inline edit (owner)
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(false);
  const seededRef = useRef(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { openRef.current = open; }, [open]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/bzila-alerts", { cache: "no-store" });
      const d = await r.json();
      const list: Alert[] = Array.isArray(d?.alerts) ? d.alerts : [];
      setAlerts(list);
      const latest = list[0]?.id ?? 0;
      // If the panel is open the user is actively looking — treat as seen.
      if (openRef.current) {
        if (latest) writeSeen(latest);
        setHasNew(false);
        return;
      }
      if (latest > 0) {
        const seen = readSeen();
        if (!seededRef.current && seen === 0) {
          // First-ever load: acknowledge existing history silently so the bell
          // only pulses for alerts that arrive AFTER this point.
          seededRef.current = true;
          writeSeen(latest);
          setHasNew(false);
        } else {
          setHasNew(latest > seen);
        }
      }
    } catch { /* offline / transient — keep prior state */ }
  }, []);

  // Poll every 45s while visible to this viewer.
  useEffect(() => {
    if (!canSee) return;
    load();
    const id = setInterval(load, 45000);
    return () => clearInterval(id);
  }, [canSee, load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if ((e.target as HTMLElement)?.closest?.("[data-bzila-bell]")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      if (next) {
        if (btnRef.current) setAnchor(btnRef.current.getBoundingClientRect());
        const latest = alerts[0]?.id ?? 0;
        if (latest) writeSeen(latest);
        setHasNew(false);
      }
      return next;
    });
  };

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

  // Toggle 👍/👎 — optimistic, then reconcile with the server's authoritative
  // count. Re-clicking the same thumb clears it.
  const react = async (alertId: number, reaction: "up" | "down") => {
    setAlerts((prev) => prev.map((a) => {
      if (a.id !== alertId) return a;
      const was = a.mine ?? "";
      const now: Reaction = was === reaction ? "" : reaction;
      let up = a.up ?? 0, down = a.down ?? 0;
      if (was === "up") up--; else if (was === "down") down--;
      if (now === "up") up++; else if (now === "down") down++;
      return { ...a, mine: now, up: Math.max(0, up), down: Math.max(0, down) };
    }));
    try {
      const r = await fetch("/api/bzila-alerts/react", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId, reaction }),
      });
      const d = await r.json();
      if (d?.ok) {
        setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, mine: d.mine as Reaction, up: d.up, down: d.down } : a)));
      }
    } catch { /* keep optimistic state */ }
  };

  if (!canSee) return null;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 13,
    padding: "8px 10px",
    border: `1px solid ${HOME_THEME.border}`,
    borderRadius: 8,
    background: "rgba(0,0,0,0.4)",
    color: HOME_THEME.text,
    outline: "none",
  };
  const pillBtn = (accent: string): React.CSSProperties => ({
    padding: "6px 12px",
    borderRadius: 8,
    border: `1px solid ${accent}`,
    background: "transparent",
    color: accent,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    cursor: "pointer",
    textTransform: "uppercase",
  });

  const left = anchor ? Math.max(8, Math.min(anchor.left, (typeof window !== "undefined" ? window.innerWidth : 1200) - 360)) : 12;
  const top = anchor ? anchor.bottom + 10 : 64;

  return (
    <div style={{ position: "relative", zIndex: 1, display: "flex", flexShrink: 0 }}>
      <style>{`
        @keyframes bzila-ring {
          0%   { box-shadow: 0 0 0 0 ${orangeA(0.55)}; }
          70%  { box-shadow: 0 0 0 9px ${orangeA(0)}; }
          100% { box-shadow: 0 0 0 0 ${orangeA(0)}; }
        }
        .bzila-panel { scrollbar-width: thin; scrollbar-color: ${cyanA(0.35)} transparent; }
        .bzila-panel::-webkit-scrollbar { width: 8px; }
        .bzila-panel::-webkit-scrollbar-track { background: transparent; margin: 6px 0; }
        .bzila-panel::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, ${cyanA(0.45)}, ${cyanA(0.22)});
          border-radius: 999px;
        }
      `}</style>

      <button
        ref={btnRef}
        data-bzila-bell
        onClick={toggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title="Bzila alerts"
        aria-label="Bzila alerts"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 40,
          flexShrink: 0,
          padding: 0,
          borderRadius: "50%",
          border: `1px solid ${open || hover ? orangeA(0.7) : (hasNew ? orangeA(0.6) : cyanA(0.35))}`,
          background: "rgba(255,255,255,0.04)",
          cursor: "pointer",
          overflow: "hidden",
          boxShadow: (open || hover) ? `0 4px 12px -2px ${orangeA(0.5)}` : "none",
          transform: hover ? "translateY(-1px)" : "none",
          transition: "border-color 0.14s, box-shadow 0.14s, transform 0.14s",
          animation: hasNew ? "bzila-ring 1.6s ease-in-out infinite" : "none",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/bzila-hero.png"
          alt="Bzila"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        {hasNew && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 1,
              right: 1,
              width: 11,
              height: 11,
              borderRadius: "50%",
              background: ORANGE,
              border: "2px solid rgba(10,13,20,0.96)",
              boxSizing: "border-box",
            }}
          />
        )}
      </button>

      {mounted && open && createPortal(
        <div
          ref={panelRef}
          className="bzila-panel"
          role="menu"
          style={{
            position: "fixed",
            top,
            left,
            width: 348,
            maxHeight: "calc(100vh - 90px)",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: DOCK_THEME.bg,
            border: `1px solid ${HOME_THEME.border}`,
            borderTop: `2px solid ${DOCK_THEME.cyanTop}`,
            borderRadius: 16,
            boxShadow: DOCK_THEME.shadow,
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            zIndex: 100000,
            padding: 14,
          }}
        >
          {/* header */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bzila-hero.png" alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }} />
            <span style={{ fontSize: 15, fontWeight: 800, color: HOME_THEME.text, letterSpacing: "0.02em" }}>
              Bzila Alerts
            </span>
          </div>

          {/* owner compose */}
          {isOwner && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 10,
                borderRadius: 12,
                border: `1px solid ${cyanA(0.25)}`,
                background: cyanA(0.06),
              }}
            >
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Title (optional)"
                maxLength={120}
                style={inputStyle}
              />
              <textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                placeholder="Type an alert…"
                maxLength={2000}
                rows={3}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={send}
                  disabled={busy || !draftBody.trim()}
                  style={{
                    ...pillBtn(CYAN),
                    background: cyanA(0.14),
                    opacity: busy || !draftBody.trim() ? 0.5 : 1,
                    cursor: busy || !draftBody.trim() ? "not-allowed" : "pointer",
                  }}
                >
                  {busy ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          )}

          {/* list */}
          {alerts.length === 0 ? (
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", padding: "8px 2px" }}>
              No alerts yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {alerts.map((a) => {
                const editing = editingId === a.id;
                return (
                  <div
                    key={a.id}
                    style={{
                      padding: 10,
                      borderRadius: 12,
                      border: `1px solid ${HOME_THEME.border}`,
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    {editing ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="Title (optional)"
                          maxLength={120}
                          style={inputStyle}
                        />
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          maxLength={2000}
                          rows={3}
                          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                        />
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button onClick={() => setEditingId(null)} style={pillBtn("rgba(255,255,255,0.4)")}>Cancel</button>
                          <button onClick={saveEdit} disabled={busy || !editBody.trim()} style={{ ...pillBtn(CYAN), opacity: busy || !editBody.trim() ? 0.5 : 1 }}>Save</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {a.title && (
                          <div style={{ fontSize: 13.5, fontWeight: 800, color: HOME_THEME.text, marginBottom: 3 }}>
                            {a.title}
                          </div>
                        )}
                        <div style={{ fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.9)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {a.body}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                          <ThumbBtn dir="up" active={a.mine === "up"} count={a.up ?? 0} onClick={() => react(a.id, "up")} />
                          <ThumbBtn dir="down" active={a.mine === "down"} count={a.down ?? 0} onClick={() => react(a.id, "down")} />
                          <span style={{ flex: 1 }} />
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 600 }}>{ago(a.created_at)}</span>
                          {isOwner && (
                            <span style={{ display: "flex", gap: 12, marginLeft: 4 }}>
                              <button
                                onClick={() => { setEditingId(a.id); setEditTitle(a.title); setEditBody(a.body); }}
                                style={{ background: "none", border: "none", padding: 0, color: CYAN, fontSize: 11, fontWeight: 700, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em" }}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => del(a.id)}
                                style={{ background: "none", border: "none", padding: 0, color: HOME_THEME.red, fontSize: 11, fontWeight: 700, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em" }}
                              >
                                Delete
                              </button>
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {isOwner && (
            <a
              href="/owner/dev/bzila-alerts"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                marginTop: 2,
                padding: "9px",
                borderRadius: 10,
                border: `1px solid ${cyanA(0.25)}`,
                background: cyanA(0.06),
                color: CYAN,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                textDecoration: "none",
              }}
            >
              View reactions →
            </a>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
