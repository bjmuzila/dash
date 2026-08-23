/**
 * Feedback — the customer support ticket inbox, on owner.cbedge.net.
 *
 * The other end of /feedback on cbedge.net. A customer opens a ticket there; it
 * lands here as Open, we trade replies on it, and it closes when this page marks
 * it complete. A customer replying to a completed ticket reopens it (the server
 * does that), so nothing goes unanswered because it was closed early.
 *
 * Talks to the same /api/feedback routes the customer page does — nginx on this
 * subdomain proxies /api to the dashboard container, so these are same-origin
 * and carry the owner session cookie:
 *
 *   GET    /api/feedback?status=      every ticket (owner) — newest activity first
 *   GET    /api/feedback/:id          one ticket + its thread; also marks it read
 *   PATCH  /api/feedback/:id          {status:'open'|'resolved'}
 *   POST   /api/feedback/:id/messages {message}
 *
 * MIRROR: components/shared/FeedbackThread.tsx + app/owner/feedback/page.tsx in
 * the Next app render the same thing on cbedge.net. owner-vite has its own copy
 * of the theme/PageCard/DockToolbar primitives and no '@/components' alias, so
 * the thread is inlined here rather than imported — the same way Budget and Reta
 * exist on both sides. Change the shapes in one and check the other.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { OWNER_THEME, OWNER_LIGHT_BLUE, homeInputStyle } from "../lib/theme";
import { PageShell, Card } from "../components/PageCard";
import { SegGroup, DockButton } from "../components/DockToolbar";
import type { SegOption } from "../components/DockToolbar";

/* ------------------------------------------------------------------ types */

type FeedbackStatus = "open" | "resolved";

/**
 * COUNT columns come back from Postgres as strings (COUNT is bigint and
 * node-postgres does not narrow it) — hence `number | string` and num() below.
 * Never do arithmetic on these raw.
 */
type Ticket = {
  id: number;
  clerk_user_id: string | null;
  email: string | null;
  category: string;
  message: string;
  page: string | null;
  status: FeedbackStatus;
  created_at: string;
  updated_at: string;
  reply_count: number | string;
  last_activity_at: string;
  unread_user: number | string;
  unread_owner: number | string;
};

type Message = { id: number; author: "user" | "owner"; body: string; created_at: string };

type Filter = "open" | "resolved" | "all";

const FILTERS: SegOption[] = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Complete" },
  { value: "all", label: "All" },
];

const CATEGORY_LABEL: Record<string, string> = {
  bug: "🐞 Bug",
  idea: "💡 Idea",
  note: "📝 Note",
  other: "💬 Other",
};

/** The inbox is a working surface — keep it live without a manual refresh. */
const LIST_POLL_MS = 30_000;
const THREAD_POLL_MS = 15_000;

/* ---------------------------------------------------------------- helpers */

const num = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** "3m ago" / "yesterday" / "Aug 12" — short enough for a list row. */
function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Full stamp for a message bubble's footer. */
function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/* ------------------------------------------------------------------ chips */

function StatusChip({ status, size = 11 }: { status: FeedbackStatus; size?: number }) {
  const open = status !== "resolved";
  const color = open ? OWNER_THEME.orange : OWNER_LIGHT_BLUE;
  return (
    <span
      style={{
        fontSize: size,
        fontWeight: 800,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        padding: "3px 9px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        color,
        border: `1px solid ${color}59`,
        background: `${color}1a`,
      }}
    >
      {open ? "Open" : "Complete"}
    </span>
  );
}

/** Unread count badge. Renders nothing at zero. */
function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      style={{
        minWidth: 18,
        height: 18,
        padding: "0 5px",
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 800,
        color: OWNER_THEME.bg,
        background: OWNER_THEME.orange,
      }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function Bubble({ mine, who, body, when }: { mine: boolean; who: string; body: string; when: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", gap: 4 }}>
      <div
        style={{
          maxWidth: "min(88%, 560px)",
          padding: "10px 13px",
          borderRadius: 14,
          borderTopRightRadius: mine ? 4 : 14,
          borderTopLeftRadius: mine ? 14 : 4,
          fontSize: 13,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          color: OWNER_THEME.text,
          border: `1px solid ${mine ? `${OWNER_THEME.cyan}59` : OWNER_THEME.border}`,
          background: mine
            ? `linear-gradient(180deg, ${OWNER_THEME.cyan}2e, ${OWNER_THEME.cyan}0d)`
            : "rgba(255,255,255,0.045)",
        }}
      >
        {body}
      </div>
      <div style={{ fontSize: 10, color: OWNER_THEME.muted, opacity: 0.45 }}>
        {who} · {when}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export default function Feedback() {
  const [filter, setFilter] = useState<Filter>("open");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [thread, setThread] = useState<{ ticket: Ticket; messages: Message[]; isAuthor: boolean } | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards a poll response landing after the selection moved on.
  const openIdRef = useRef<number | null>(null);
  openIdRef.current = openId;
  const endRef = useRef<HTMLDivElement | null>(null);

  const loadList = useCallback(async (f: Filter) => {
    try {
      const qs = f === "all" ? "" : `?status=${f}`;
      const res = await fetch(`/api/feedback${qs}`, { cache: "no-store", credentials: "include" });
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
      const res = await fetch(`/api/feedback/${id}`, { cache: "no-store", credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const j = await res.json();
      if (openIdRef.current !== id) return;
      // isAuthor: did I open this ticket myself? On a ticket I filed, my own
      // customer-side words must still read as "You".
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
    setDraft("");
    void loadThread(openId);
    const t = window.setInterval(() => { void loadThread(openId); }, THREAD_POLL_MS);
    return () => window.clearInterval(t);
  }, [openId, loadThread]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.ticket.id, thread?.messages.length]);

  async function sendReply() {
    const text = draft.trim();
    if (!text || sending || openId == null) return;
    setSending(true);
    setDraft("");
    try {
      const res = await fetch(`/api/feedback/${openId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed (${res.status})`);
      }
      await loadThread(openId);
      await loadList(filter);
      // Closing while filtered to Open drops the row — step back to the list
      // rather than leaving a thread open with nothing selected behind it.
      if (status === "resolved" && filter === "open") setOpenId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status change failed.");
    }
  }

  // Authoring the ticket wins over being staff, so a ticket I filed myself reads
  // the way the customer page reads it.
  const isAuthor = thread?.isAuthor ?? false;
  const isMine = (author: "user" | "owner") => (isAuthor ? author === "user" : author === "owner");
  const whoSaid = (author: "user" | "owner"): string => {
    if (author === "user") return isAuthor ? "You" : (thread?.ticket.email || "Customer");
    return isAuthor ? "CB Edge" : "You";
  };

  const closed = thread?.ticket.status === "resolved";

  let threadPane: ReactNode = <div style={emptyStyle}>Pick a ticket to read and reply.</div>;
  if (thread) {
    threadPane = (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingBottom: 10, borderBottom: `1px solid ${OWNER_THEME.border}` }}>
          <span style={{ fontSize: 13, fontWeight: 800 }}>
            #{thread.ticket.id} · {CATEGORY_LABEL[thread.ticket.category] ?? thread.ticket.category}
          </span>
          <span style={{ fontSize: 11, color: OWNER_THEME.muted, opacity: 0.6 }}>
            {thread.ticket.email || thread.ticket.clerk_user_id || "unknown"}
            {thread.ticket.page ? ` · from ${thread.ticket.page}` : ""}
            {` · opened ${fmtWhen(thread.ticket.created_at)}`}
          </span>
          <span style={{ marginLeft: "auto" }}>
            <StatusChip status={thread.ticket.status} />
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, height: 420, overflowY: "auto", padding: "4px 2px" }}>
          {/* The opening message is the ticket row itself, not a thread row —
              but it is always a CUSTOMER message, so it takes the same seat. */}
          <Bubble
            mine={isMine("user")}
            who={whoSaid("user")}
            body={thread.ticket.message}
            when={fmtStamp(thread.ticket.created_at)}
          />
          {thread.messages.map((m) => (
            <Bubble
              key={m.id}
              mine={isMine(m.author)}
              who={whoSaid(m.author)}
              body={m.body}
              when={fmtStamp(m.created_at)}
            />
          ))}
          <div ref={endRef} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line.
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendReply(); }
            }}
            placeholder="Reply to this customer…"
            rows={3}
            maxLength={5000}
            style={{ ...homeInputStyle, width: "100%", resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <DockButton
              onClick={() => void setStatus(closed ? "open" : "resolved")}
              title={closed ? "Put this ticket back in the open queue" : "Mark this ticket complete"}
              style={{
                height: 34,
                padding: "0 16px",
                fontSize: 11,
                color: closed ? OWNER_THEME.orange : OWNER_LIGHT_BLUE,
                border: `1px solid ${closed ? OWNER_THEME.orange : OWNER_LIGHT_BLUE}59`,
                background: `${closed ? OWNER_THEME.orange : OWNER_LIGHT_BLUE}14`,
              }}
            >
              {closed ? "Reopen" : "Mark complete"}
            </DockButton>
            <DockButton
              onClick={() => void sendReply()}
              style={{
                height: 34,
                padding: "0 20px",
                fontSize: 11,
                color: OWNER_THEME.cyan,
                border: `1px solid ${OWNER_THEME.cyan}59`,
                background: "linear-gradient(180deg,rgba(33,158,188,.18),rgba(33,158,188,.05))",
                opacity: sending || !draft.trim() ? 0.55 : 1,
                cursor: sending || !draft.trim() ? "default" : "pointer",
              }}
            >
              {sending ? "Sending…" : "Send"}
            </DockButton>
          </div>
        </div>
      </div>
    );
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
          <DockButton
            onClick={() => { void loadList(filter); if (openId != null) void loadThread(openId); }}
            style={{ height: 34, padding: "0 14px", fontSize: 11 }}
          >
            ↻ Refresh
          </DockButton>
          {error && <span style={{ fontSize: 11, color: OWNER_THEME.red, fontWeight: 600 }}>{error}</span>}
        </div>

        {/* Two panes on a desktop, stacked on a narrow window. */}
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
          <div style={listPaneStyle}>
            {!loaded && <div style={emptyStyle}>Loading…</div>}
            {loaded && tickets.length === 0 && (
              <div style={emptyStyle}>{filter === "open" ? "Nothing open. Inbox zero." : "No tickets here."}</div>
            )}
            {tickets.map((t) => {
              const active = t.id === openId;
              return (
                <button
                  key={t.id}
                  onClick={() => setOpenId(t.id)}
                  style={{
                    ...rowStyle,
                    borderColor: active ? `${OWNER_LIGHT_BLUE}66` : OWNER_THEME.border,
                    background: active ? `${OWNER_LIGHT_BLUE}14` : "rgba(255,255,255,0.03)",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                    <span style={{ fontSize: 11, opacity: 0.85 }}>{CATEGORY_LABEL[t.category] ?? t.category}</span>
                    <span style={{ fontSize: 11, color: OWNER_THEME.muted, opacity: 0.55, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {t.email || t.clerk_user_id || "unknown"}
                    </span>
                    <UnreadDot count={num(t.unread_owner)} />
                    <StatusChip status={t.status} size={9} />
                  </span>
                  <span style={rowTextStyle}>{t.message}</span>
                  <span style={{ fontSize: 10, color: OWNER_THEME.muted, opacity: 0.45 }}>
                    #{t.id} · {num(t.reply_count)} {num(t.reply_count) === 1 ? "reply" : "replies"} · {fmtWhen(t.last_activity_at)}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ minWidth: 0, padding: "0 4px" }}>{threadPane}</div>
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

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 5,
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${OWNER_THEME.border}`,
  color: OWNER_THEME.text,
  cursor: "pointer",
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
  color: OWNER_THEME.muted,
  opacity: 0.55,
  textAlign: "center",
  padding: "40px 8px",
};
