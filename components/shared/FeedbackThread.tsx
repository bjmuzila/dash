"use client";

/**
 * FeedbackThread — ONE ticket conversation, shared by both surfaces.
 *
 * A feedback ticket is read from two sides: the customer at /feedback and the
 * owner at /owner/feedback. Those pages differ in what surrounds a thread (a
 * customer picks between "new" and "my tickets"; the owner works an inbox), but
 * the thread itself — who said what, in what order, and the box you reply in —
 * must read identically on both, so it lives here rather than being written
 * twice and drifting.
 *
 * The types and the small formatting helpers are exported from here too, for
 * the same reason: both pages talk to the same /api/feedback shapes.
 *
 * "Mine" is whichever side is looking. The owner sees their own replies on the
 * right; the customer sees theirs there. Nobody has to decode a color.
 *
 * That side is decided by `isAuthor` — did the VIEWER open this ticket — not by
 * which page is rendering. isOwner and isAuthor are different questions and all
 * four combinations happen: the owner reading a customer's ticket is not its
 * author, and the owner reading one they opened themselves is both. Both flags
 * come from the server, because only it knows who the caller is.
 */

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { HOME_THEME, homeInputStyle, LIGHT_BLUE } from "./homeTheme";
import { DockButton, type SegOption } from "./DockToolbar";

/* ------------------------------------------------------------------ types */

/** Only two, on purpose — "resolved" is what the UI labels "Complete". */
export type FeedbackStatus = "open" | "resolved";

/**
 * A ticket row as /api/feedback returns it. The count columns come back from
 * Postgres as strings (COUNT is bigint and node-postgres does not narrow it),
 * hence `number | string` and the `num()` helper below — never do arithmetic on
 * these raw.
 */
export type FeedbackTicket = {
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

export type FeedbackMessage = {
  id: number;
  author: "user" | "owner";
  body: string;
  created_at: string;
};

/* ---------------------------------------------------------------- helpers */

/** Category tiles for the "new ticket" segmented control. */
export const CATEGORY_OPTIONS: SegOption[] = [
  { value: "bug", label: "🐞 Bug" },
  { value: "idea", label: "💡 Idea" },
  { value: "note", label: "📝 Note" },
  { value: "other", label: "💬 Other" },
];

export const CATEGORY_LABEL: Record<string, string> = {
  bug: "🐞 Bug",
  idea: "💡 Idea",
  note: "📝 Note",
  other: "💬 Other",
};

/** COUNT columns arrive as strings. One place that knows it. */
export const num = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** "3m ago" / "yesterday" / "Aug 12" — short enough for a list row. */
export function fmtWhen(iso: string | null | undefined): string {
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
export function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ chips */

export function StatusChip({ status, size = 11 }: { status: FeedbackStatus; size?: number }) {
  const open = status !== "resolved";
  const color = open ? HOME_THEME.orange : LIGHT_BLUE;
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

/** Small unread count badge. Renders nothing at zero. */
export function UnreadDot({ count }: { count: number }) {
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
        color: HOME_THEME.bg,
        background: HOME_THEME.orange,
      }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/* ----------------------------------------------------------------- thread */

function Bubble({ mine, who, body, when }: { mine: boolean; who: string; body: string; when: string }) {
  const wrap: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: mine ? "flex-end" : "flex-start",
    gap: 4,
  };
  const bubble: CSSProperties = {
    maxWidth: "min(88%, 520px)",
    padding: "10px 13px",
    borderRadius: 14,
    borderTopRightRadius: mine ? 4 : 14,
    borderTopLeftRadius: mine ? 14 : 4,
    fontSize: 13,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: HOME_THEME.text,
    border: `1px solid ${mine ? `${HOME_THEME.cyan}59` : HOME_THEME.border}`,
    background: mine
      ? `linear-gradient(180deg, ${HOME_THEME.cyan}2e, ${HOME_THEME.cyan}0d)`
      : "rgba(255,255,255,0.045)",
  };
  return (
    <div style={wrap}>
      <div style={bubble}>{body}</div>
      <div style={{ fontSize: 10, color: HOME_THEME.muted, opacity: 0.45 }}>
        {who} · {when}
      </div>
    </div>
  );
}

/**
 * The conversation + composer.
 *
 * `isAuthor` decides which side reads as "You". `isOwner` only affects the
 * placeholder and the "CB Edge"/"You" label on staff replies — the server is
 * what actually enforces who may reply or close a ticket.
 */
export function FeedbackThread({
  ticket,
  messages,
  isOwner,
  isAuthor,
  sending,
  onSend,
  onSetStatus,
  header,
  height = 360,
}: {
  ticket: FeedbackTicket;
  messages: FeedbackMessage[];
  isOwner: boolean;
  /** Did the VIEWER open this ticket? From the server, never inferred. */
  isAuthor: boolean;
  sending: boolean;
  onSend: (text: string) => void | Promise<void>;
  /** Owner-only. Omit to hide the status controls entirely. */
  onSetStatus?: (status: FeedbackStatus) => void | Promise<void>;
  /** Slot above the conversation (back button, subject line, owner meta). */
  header?: ReactNode;
  height?: number;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  // Jump to the newest message whenever the thread grows or is swapped out.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [ticket.id, messages.length]);

  const send = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    void onSend(text);
  };

  const closed = ticket.status === "resolved";

  // Who a message belongs to, from the viewer's seat. Authoring the ticket wins
  // over being staff: on your own ticket your customer-side words are "You",
  // even when you are also the person who answers tickets.
  const isMine = (author: "user" | "owner") =>
    isAuthor ? author === "user" : author === "owner";
  const whoSaid = (author: "user" | "owner") => {
    if (author === "user") return isAuthor ? "You" : (ticket.email || "Customer");
    return isOwner && !isAuthor ? "You" : "CB Edge";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
      {header}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          height,
          overflowY: "auto",
          padding: "4px 2px",
        }}
      >
        {/* The opening message is the ticket row itself, not a thread row —
            but it is always a CUSTOMER message, so it takes the same seat. */}
        <Bubble
          mine={isMine("user")}
          who={whoSaid("user")}
          body={ticket.message}
          when={fmtStamp(ticket.created_at)}
        />
        {messages.map((m) => (
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

      {closed && !isOwner && (
        <div style={{ fontSize: 11, color: HOME_THEME.muted, opacity: 0.6 }}>
          This ticket is marked complete. Replying reopens it.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line — the convention every
            // chat box in the app follows.
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder={isOwner ? "Reply to this customer…" : "Add to this ticket…"}
          rows={3}
          maxLength={5000}
          style={{ ...homeInputStyle, width: "100%", resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          {onSetStatus ? (
            <DockButton
              onClick={() => onSetStatus(closed ? "open" : "resolved")}
              title={closed ? "Put this ticket back in the open queue" : "Mark this ticket complete"}
              style={{
                height: 34,
                padding: "0 16px",
                fontSize: 11,
                color: closed ? HOME_THEME.orange : LIGHT_BLUE,
                border: `1px solid ${closed ? HOME_THEME.orange : LIGHT_BLUE}59`,
                background: `${closed ? HOME_THEME.orange : LIGHT_BLUE}14`,
              }}
            >
              {closed ? "Reopen" : "Mark complete"}
            </DockButton>
          ) : (
            <span style={{ fontSize: 10, color: HOME_THEME.muted, opacity: 0.4 }}>
              Enter to send · Shift+Enter for a new line
            </span>
          )}
          <DockButton
            onClick={send}
            style={{
              height: 34,
              padding: "0 20px",
              fontSize: 11,
              color: HOME_THEME.cyan,
              border: `1px solid ${HOME_THEME.cyan}59`,
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

export default FeedbackThread;
