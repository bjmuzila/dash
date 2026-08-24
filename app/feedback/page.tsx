"use client";

/**
 * /feedback — the customer side of the support ticket system.
 *
 * Sending feedback used to be fire-and-forget: a form, a thank-you, silence.
 * Now every submission opens a TICKET the customer keeps. It lands as "Open",
 * they and CB Edge trade replies on it, and it closes when CB Edge marks it
 * complete (a customer reply on a closed ticket reopens it — the server does
 * that, not this page).
 *
 * Two views, one card: "New" (the original form) and "My tickets" (the list,
 * and a thread when one is picked). The thread itself is
 * components/shared/FeedbackThread so the owner inbox renders it identically.
 *
 * This page is Next-rendered (linked from UserMenu), not an SPA route — it is
 * support chrome, not a dashboard.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { SegGroup, DockButton, type SegOption } from "@/components/shared/DockToolbar";
import {
  FeedbackThread,
  CATEGORY_OPTIONS,
  CATEGORY_LABEL,
  StatusChip,
  UnreadDot,
  fmtWhen,
  num,
  type FeedbackTicket,
  type FeedbackMessage,
} from "@/components/shared/FeedbackThread";

type Category = "bug" | "idea" | "note" | "other";
type Tab = "new" | "mine";

/** Open threads are polled — an owner reply should land without a refresh. */
const THREAD_POLL_MS = 15_000;

export default function FeedbackPage() {
  const [tab, setTab] = useState<Tab>("new");

  // ── new-ticket form ────────────────────────────────────────────────────────
  const [category, setCategory] = useState<Category>("note");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── ticket list + open thread ──────────────────────────────────────────────
  const [tickets, setTickets] = useState<FeedbackTicket[]>([]);
  const [unread, setUnread] = useState(0);
  const [listLoaded, setListLoaded] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [thread, setThread] = useState<
    { ticket: FeedbackTicket; messages: FeedbackMessage[]; isOwner: boolean; isAuthor: boolean } | null
  >(null);
  const [sending, setSending] = useState(false);

  // Guards a poll response landing after the user moved to another ticket.
  const openIdRef = useRef<number | null>(null);
  openIdRef.current = openId;

  const loadList = useCallback(async () => {
    try {
      // scope=mine, always. This page is "my tickets" — without it the owner
      // opening their own support page gets the whole customer queue.
      const res = await fetch("/api/feedback?scope=mine", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      setTickets(Array.isArray(j?.items) ? j.items : []);
      setUnread(num(j?.unreadCount));
    } catch {
      /* the list is a convenience — a failure here must not block sending */
    } finally {
      setListLoaded(true);
    }
  }, []);

  const loadThread = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/feedback/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      if (openIdRef.current !== id) return; // moved on while this was in flight
      setThread({
        ticket: j.ticket,
        messages: Array.isArray(j.messages) ? j.messages : [],
        isOwner: Boolean(j.isOwner),
        isAuthor: Boolean(j.isAuthor),
      });
    } catch {
      /* keep whatever is already on screen */
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  /**
   * Deep link. "New" stays the default — most arrivals are writing a ticket —
   * but the "My Tickets" entry in the account menu (and the unread badge on the
   * avatar) links here with ?tab=mine, and that arrival is coming to READ a
   * reply, not write one. ?ticket=<id> opens that thread directly.
   *
   * Read in an effect rather than in the initial state on purpose: this page is
   * server-rendered, and the server has no query string to read, so deciding
   * the tab during render would hydrate to a different tree than the HTML.
   */
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const id = Number(sp.get("ticket") ?? 0);
    const wantsMine = sp.get("tab") === "mine" || (Number.isFinite(id) && id > 0);
    if (!wantsMine) return;
    setTab("mine");
    if (Number.isFinite(id) && id > 0) setOpenId(id);
  }, []);

  useEffect(() => {
    if (openId == null) { setThread(null); return; }
    void loadThread(openId);
    const t = window.setInterval(() => { void loadThread(openId); }, THREAD_POLL_MS);
    return () => window.clearInterval(t);
  }, [openId, loadThread]);

  async function submit() {
    const msg = message.trim();
    if (!msg) { setError("Please write a message first."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message: msg, page: "/feedback" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed (${res.status})`);
      }
      const j = await res.json().catch(() => ({}));
      setMessage("");
      await loadList();
      // Drop straight into the ticket that was just opened — that IS the
      // confirmation, and it shows the customer where the reply will arrive.
      const id = Number(j?.id ?? j?.feedback?.id ?? 0);
      setTab("mine");
      if (id > 0) setOpenId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  async function reply(text: string) {
    if (openId == null) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/feedback/${openId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed (${res.status})`);
      }
      await loadThread(openId);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reply failed.");
    } finally {
      setSending(false);
    }
  }

  const TABS: SegOption[] = [
    { value: "new", label: "✍ New" },
    { value: "mine", label: `📬 My tickets${tickets.length ? ` (${tickets.length})` : ""}` },
  ];

  return (
    <PageShell maxWidth={720} align="center">
      <Card accent="cyan">
        {/* Header — logo + title + blurb, inside the card */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, marginBottom: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cb-edge-logo.png" alt="CB Edge" style={{ height: 168, width: "auto", display: "block" }} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.02em" }}>Feedback &amp; Support</div>
            <div style={{ fontSize: 12, color: HOME_THEME.green, marginTop: 4 }}>
              Your feedback shapes CB Edge — every bug you flag, idea you share, or note you leave helps make this
              platform one of the best out there. Send one and we&apos;ll pick it up right here.
            </div>
          </div>
        </div>

        {/* View switch */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <div className="seg-pill" style={{ position: "relative" }}>
            <SegGroup
              options={TABS}
              active={tab}
              onChange={(v) => { setTab(v as Tab); setError(null); if (v === "new") setOpenId(null); }}
            />
            {unread > 0 && (
              <span style={{ position: "absolute", top: -6, right: -8 }}>
                <UnreadDot count={unread} />
              </span>
            )}
          </div>
        </div>

        {/* Round the SegGroup track + tiles into a fuller pill, and give each
            tile (incl. inactive ones) a visible pill background so they read as
            distinct buttons, matching the toolbar. */}
        <style>{`
          .seg-pill > div { border-radius: 999px !important; padding: 5px !important; gap: 6px !important; }
          .seg-pill > div > button {
            border-radius: 999px !important;
            background: rgba(255,255,255,0.07) !important;
            border: 1px solid rgba(255,255,255,0.12) !important;
          }
          .seg-pill > div > button[style*="rgb(33, 158, 188)"] {
            background: linear-gradient(180deg, rgba(33,158,188,0.20), rgba(33,158,188,0.06)) !important;
            border: 1px solid rgba(33,158,188,0.45) !important;
            box-shadow: 0 0 14px rgba(33,158,188,0.25) !important;
          }
        `}</style>

        {error && (
          <div style={{ fontSize: 12, color: HOME_THEME.red, fontWeight: 600, marginBottom: 12 }}>{error}</div>
        )}

        {/* ── NEW TICKET ─────────────────────────────────────────────────── */}
        {tab === "new" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ ...labelStyle, textAlign: "center" }}>Type</div>
              <div className="seg-pill">
                <SegGroup
                  options={CATEGORY_OPTIONS}
                  active={category}
                  onChange={(v) => setCategory(v as Category)}
                />
              </div>
            </div>

            <div>
              <div style={labelStyle}>Message</div>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What's on your mind?"
                rows={7}
                maxLength={5000}
                style={{ ...homeInputStyle, width: "100%", resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }}
              />
              <div style={{ fontSize: 10, color: HOME_THEME.muted, opacity: 0.5, textAlign: "right", marginTop: 4 }}>
                {message.length}/5000
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <DockButton
                onClick={submit}
                style={{
                  height: 38,
                  padding: "0 22px",
                  fontSize: 12,
                  color: HOME_THEME.cyan,
                  border: `1px solid ${HOME_THEME.cyan}59`,
                  background: "linear-gradient(180deg,rgba(33,158,188,.18),rgba(33,158,188,.05))",
                  opacity: submitting ? 0.6 : 1,
                  cursor: submitting ? "default" : "pointer",
                }}
              >
                {submitting ? "Sending…" : "Open a ticket"}
              </DockButton>
            </div>
          </div>
        )}

        {/* ── MY TICKETS ─────────────────────────────────────────────────── */}
        {tab === "mine" && openId == null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {!listLoaded && <div style={emptyStyle}>Loading your tickets…</div>}
            {listLoaded && tickets.length === 0 && (
              <div style={emptyStyle}>
                No tickets yet. Send one from the <strong>New</strong> tab and it&apos;ll show up here.
              </div>
            )}
            {tickets.map((t) => (
              <button key={t.id} onClick={() => setOpenId(t.id)} style={rowStyle}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 12, opacity: 0.85 }}>{CATEGORY_LABEL[t.category] ?? t.category}</span>
                  <span style={rowTextStyle}>{t.message}</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {num(t.reply_count) > 0 && (
                    <span style={{ fontSize: 10, color: HOME_THEME.muted, opacity: 0.55 }}>💬 {num(t.reply_count)}</span>
                  )}
                  <UnreadDot count={num(t.unread_user)} />
                  <StatusChip status={t.status} size={10} />
                  <span style={{ fontSize: 10, color: HOME_THEME.muted, opacity: 0.45, minWidth: 58, textAlign: "right" }}>
                    {fmtWhen(t.last_activity_at)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ── ONE THREAD ─────────────────────────────────────────────────── */}
        {tab === "mine" && openId != null && thread && (
          <FeedbackThread
            ticket={thread.ticket}
            messages={thread.messages}
            isOwner={thread.isOwner}
            isAuthor={thread.isAuthor}
            sending={sending}
            onSend={reply}
            header={
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <DockButton
                  onClick={() => { setOpenId(null); void loadList(); }}
                  style={{ height: 30, padding: "0 12px", fontSize: 11 }}
                >
                  ← All tickets
                </DockButton>
                <span style={{ fontSize: 12, fontWeight: 700 }}>
                  {CATEGORY_LABEL[thread.ticket.category] ?? thread.ticket.category}
                </span>
                <span style={{ fontSize: 11, color: HOME_THEME.muted, opacity: 0.5 }}>
                  #{thread.ticket.id} · opened {fmtWhen(thread.ticket.created_at)}
                </span>
                <span style={{ marginLeft: "auto" }}>
                  <StatusChip status={thread.ticket.status} />
                </span>
              </div>
            }
          />
        )}

        {tab === "mine" && openId != null && !thread && <div style={emptyStyle}>Loading ticket…</div>}
      </Card>
    </PageShell>
  );
}

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: HOME_THEME.green,
  marginBottom: 8,
};

const emptyStyle: CSSProperties = {
  fontSize: 12,
  color: HOME_THEME.muted,
  opacity: 0.6,
  textAlign: "center",
  padding: "28px 8px",
  lineHeight: 1.6,
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${HOME_THEME.border}`,
  background: "rgba(255,255,255,0.035)",
  color: HOME_THEME.text,
  cursor: "pointer",
};

const rowTextStyle: CSSProperties = {
  fontSize: 12.5,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
  flex: 1,
};
