"use client";

/**
 * /owner/feedback — the ticket inbox.
 *
 * The owner half of the support system the customer sees at /feedback. Every
 * ticket anyone has opened, newest activity first, with the same thread view
 * the customer is looking at (components/shared/FeedbackThread) so a reply
 * cannot read differently on the two ends.
 *
 * Only this side can change a ticket's status — "Mark complete" flips it to
 * 'resolved', "Reopen" puts it back. The server enforces that; the buttons here
 * are just the affordance. A customer replying to a completed ticket reopens it
 * automatically, so nothing goes unanswered because it was closed early.
 *
 * Owner-only by app/owner/layout.tsx (OwnerGuard) — no per-page gate needed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { SegGroup, DockButton, type SegOption } from "@/components/shared/DockToolbar";
import {
  FeedbackThread,
  CATEGORY_LABEL,
  StatusChip,
  UnreadDot,
  fmtWhen,
  num,
  type FeedbackTicket,
  type FeedbackMessage,
  type FeedbackStatus,
} from "@/components/shared/FeedbackThread";

type Filter = "open" | "resolved" | "all";

const FILTERS: SegOption[] = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Complete" },
  { value: "all", label: "All" },
];

/** The inbox is a working surface — keep it live without a refresh. */
const LIST_POLL_MS = 30_000;
const THREAD_POLL_MS = 15_000;

export default function OwnerFeedbackPage() {
  const [filter, setFilter] = useState<Filter>("open");
  const [tickets, setTickets] = useState<FeedbackTicket[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [thread, setThread] = useState<
    { ticket: FeedbackTicket; messages: FeedbackMessage[]; isAuthor: boolean } | null
  >(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter and selection are read inside intervals; refs keep those closures
  // from pinning a stale value without re-creating the timers on every change.
  const openIdRef = useRef<number | null>(null);
  openIdRef.current = openId;

  const loadList = useCallback(async (f: Filter) => {
    try {
      const qs = f === "all" ? "" : `?status=${f}`;
      const res = await fetch(`/api/feedback${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const j = await res.json();
      setTickets(Array.isArray(j?.items) ? j.items : []);
      setOpenCount(num(j?.openCount));
      setUnreadCount(num(j?.unreadCount));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tickets.");
    } finally {
      setLoaded(true);
    }
  }, []);

  const loadThread = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/feedback/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const j = await res.json();
      if (openIdRef.current !== id) return; // selection moved while in flight
      // isAuthor matters here too — a ticket the owner opened themselves must
      // not label its own opening message as the customer's.
      setThread({
        ticket: j.ticket,
        messages: Array.isArray(j.messages) ? j.messages : [],
        isAuthor: Boolean(j.isAuthor),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that ticket.");
    }
  }, []);

  useEffect(() => {
    void loadList(filter);
    const t = window.setInterval(() => { void loadList(filter); }, LIST_POLL_MS);
    return () => window.clearInterval(t);
  }, [filter, loadList]);

  useEffect(() => {
    if (openId == null) { setThread(null); return; }
    void loadThread(openId);
    const t = window.setInterval(() => { void loadThread(openId); }, THREAD_POLL_MS);
    return () => window.clearInterval(t);
  }, [openId, loadThread]);

  async function reply(text: string) {
    if (openId == null) return;
    setSending(true);
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
      await loadList(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reply failed.");
    } finally {
      setSending(false);
    }
  }

  async function setStatus(status: FeedbackStatus) {
    if (openId == null) return;
    try {
      const res = await fetch(`/api/feedback/${openId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed (${res.status})`);
      }
      await loadThread(openId);
      await loadList(filter);
      // Closing a ticket while filtered to "Open" removes it from the list —
      // step back to the list rather than leaving a thread with no row.
      if (status === "resolved" && filter === "open") setOpenId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status change failed.");
    }
  }

  return (
    <PageShell>
      <Card
        accent="cyan"
        title="Customer feedback"
        subtitle={`${openCount} open${unreadCount ? ` · ${unreadCount} needing a look` : ""}`}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <SegGroup options={FILTERS} active={filter} onChange={(v) => { setFilter(v as Filter); setOpenId(null); }} />
          <DockButton onClick={() => { void loadList(filter); if (openId != null) void loadThread(openId); }} style={{ height: 34, padding: "0 14px", fontSize: 11 }}>
            ↻ Refresh
          </DockButton>
          {error && <span style={{ fontSize: 11, color: HOME_THEME.red, fontWeight: 600 }}>{error}</span>}
        </div>

        {/* The inbox/thread split is two panes on a desktop and stacked on a
            phone. globals.css's GLOBAL GRID COLLAPSE only rewrites `repeat(N…)`
            and `1fr 1fr` signatures, neither of which this uses, so the
            breakpoint is declared here rather than inherited. */}
        <style>{`
          .fb-inbox-grid {
            display: grid;
            grid-template-columns: minmax(260px, 360px) minmax(0, 1fr);
            gap: 18px;
            align-items: start;
          }
          @media (max-width: 900px) {
            .fb-inbox-grid { grid-template-columns: 1fr; }
          }
        `}</style>

        <div className="fb-inbox-grid">
          {/* ── inbox ──────────────────────────────────────────────────────── */}
          <div style={listPaneStyle}>
            {!loaded && <div style={emptyStyle}>Loading…</div>}
            {loaded && tickets.length === 0 && (
              <div style={emptyStyle}>
                {filter === "open" ? "Nothing open. Inbox zero." : "No tickets here."}
              </div>
            )}
            {tickets.map((t) => {
              const active = t.id === openId;
              const unread = num(t.unread_owner);
              return (
                <button
                  key={t.id}
                  onClick={() => setOpenId(t.id)}
                  style={{
                    ...rowStyle,
                    borderColor: active ? `${LIGHT_BLUE}66` : HOME_THEME.border,
                    background: active ? `${LIGHT_BLUE}14` : "rgba(255,255,255,0.03)",
                  }}
                >
                  <span style={rowTopStyle}>
                    <span style={{ fontSize: 11, opacity: 0.85 }}>{CATEGORY_LABEL[t.category] ?? t.category}</span>
                    <span style={{ fontSize: 11, color: HOME_THEME.muted, opacity: 0.55, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {t.email || t.clerk_user_id || "unknown"}
                    </span>
                    <UnreadDot count={unread} />
                    <StatusChip status={t.status} size={9} />
                  </span>
                  <span style={rowTextStyle}>{t.message}</span>
                  <span style={{ fontSize: 10, color: HOME_THEME.muted, opacity: 0.45 }}>
                    #{t.id} · {num(t.reply_count)} {num(t.reply_count) === 1 ? "reply" : "replies"} · {fmtWhen(t.last_activity_at)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── thread ─────────────────────────────────────────────────────── */}
          <div style={threadPaneStyle}>
            {thread ? (
              <FeedbackThread
                ticket={thread.ticket}
                messages={thread.messages}
                isOwner
                isAuthor={thread.isAuthor}
                sending={sending}
                onSend={reply}
                onSetStatus={setStatus}
                height={420}
                header={
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingBottom: 10, borderBottom: `1px solid ${HOME_THEME.border}` }}>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>
                      #{thread.ticket.id} · {CATEGORY_LABEL[thread.ticket.category] ?? thread.ticket.category}
                    </span>
                    <span style={{ fontSize: 11, color: HOME_THEME.muted, opacity: 0.6 }}>
                      {thread.ticket.email || thread.ticket.clerk_user_id || "unknown"}
                      {thread.ticket.page ? ` · from ${thread.ticket.page}` : ""}
                      {` · opened ${fmtWhen(thread.ticket.created_at)}`}
                    </span>
                    <span style={{ marginLeft: "auto" }}>
                      <StatusChip status={thread.ticket.status} />
                    </span>
                  </div>
                }
              />
            ) : (
              <div style={emptyStyle}>Pick a ticket to read and reply.</div>
            )}
          </div>
        </div>
      </Card>
    </PageShell>
  );
}

const listPaneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  maxHeight: 620,
  overflowY: "auto",
  paddingRight: 4,
};

const threadPaneStyle: CSSProperties = {
  minWidth: 0,
  padding: "0 4px",
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 5,
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${HOME_THEME.border}`,
  color: HOME_THEME.text,
  cursor: "pointer",
};

const rowTopStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  minWidth: 0,
};

const rowTextStyle: CSSProperties = {
  fontSize: 12.5,
  lineHeight: 1.45,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const emptyStyle: CSSProperties = {
  fontSize: 12,
  color: HOME_THEME.muted,
  opacity: 0.55,
  textAlign: "center",
  padding: "40px 8px",
};
