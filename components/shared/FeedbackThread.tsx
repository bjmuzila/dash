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
 *
 * SCREENSHOTS. Either side can attach images — paste, drop, or the 📎 button —
 * and they hang off a message rather than the ticket, so they appear inside the
 * bubble they were sent with. The pieces are exported (ShotTray for composing,
 * ShotGallery for reading) because the "new ticket" form on /feedback needs the
 * same picker without the rest of a thread around it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  ReactNode,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
} from "react";
import { HOME_THEME, homeInputStyle, LIGHT_BLUE } from "./homeTheme";
import { DockButton, type SegOption } from "./DockToolbar";
import {
  MAX_SHOTS,
  SHOT_ACCEPT,
  imageFilesFrom,
  prepareShots,
  shotKb,
  shotUrl,
  type FeedbackShot,
  type PendingShot,
} from "./feedbackShots";

export type { FeedbackShot, PendingShot } from "./feedbackShots";
export { MAX_SHOTS, shotUrl } from "./feedbackShots";

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
  /** Attachments across the whole ticket — drives the 📎 hint on a list row. */
  shot_count?: number | string;
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

/* ------------------------------------------------------------ screenshots */

/**
 * Full-size view of one attachment.
 *
 * A bug report screenshot is unreadable at thumbnail size — the whole point is
 * the tiny number in the corner — so a click has to open it big. Rendered as a
 * plain fixed overlay rather than a portal: every surface that mounts a thread
 * already sits inside the page's own stacking context and nothing here needs to
 * escape an overflow.
 */
function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 4000,
        background: "rgba(0,0,0,0.86)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        cursor: "zoom-out",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          borderRadius: 8,
          border: `1px solid ${HOME_THEME.border}`,
          cursor: "default",
        }}
      />
      <div style={{ position: "absolute", top: 14, right: 18, fontSize: 12, color: HOME_THEME.muted }}>
        Esc to close
      </div>
    </div>
  );
}

const thumbStyle: CSSProperties = {
  width: 128,
  height: 84,
  objectFit: "cover",
  borderRadius: 8,
  border: `1px solid ${HOME_THEME.border}`,
  background: "rgba(255,255,255,0.04)",
  cursor: "zoom-in",
  display: "block",
};

/** Attachments on one message, as a row of thumbnails. */
export function ShotGallery({ shots, align = "flex-start" }: { shots: FeedbackShot[]; align?: "flex-start" | "flex-end" }) {
  const [open, setOpen] = useState<FeedbackShot | null>(null);
  if (!shots.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: align, maxWidth: "min(88%, 520px)" }}>
      {shots.map((s) => (
        <button
          key={s.id}
          onClick={() => setOpen(s)}
          title={`${s.name || "screenshot"} · ${shotKb(s.byte_len)}`}
          style={{ padding: 0, border: "none", background: "none", lineHeight: 0, cursor: "zoom-in" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shotUrl(s)} alt={s.name || "screenshot"} style={thumbStyle} />
        </button>
      ))}
      {open && <Lightbox src={shotUrl(open)} alt={open.name || "screenshot"} onClose={() => setOpen(null)} />}
    </div>
  );
}

/**
 * The composer's attachment row: a 📎 button, whatever is queued, and the
 * paste/drop plumbing.
 *
 * State lives in the PARENT (the pending list and its setter are props) because
 * whoever owns the send button is what has to clear the queue once the message
 * is away — and on /feedback that is the new-ticket form, not a thread.
 */
export function ShotTray({
  pending,
  setPending,
  disabled,
  onError,
  compact,
}: {
  pending: PendingShot[];
  setPending: (next: PendingShot[]) => void;
  disabled?: boolean;
  onError?: (msg: string | null) => void;
  /** Smaller thumbnails, for the reply composer. */
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const add = useCallback(async (files: File[]) => {
    if (!files.length || disabled) return;
    setBusy(true);
    onError?.(null);
    try {
      const next = await prepareShots(files, pending.length);
      if (next.length) setPending([...pending, ...next]);
      if (files.length > next.length) onError?.(`Only ${MAX_SHOTS} images per message — the rest were skipped.`);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Could not attach that image.");
    } finally {
      setBusy(false);
    }
  }, [disabled, onError, pending, setPending]);

  const size = compact ? 64 : 84;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <input
        ref={inputRef}
        type="file"
        accept={SHOT_ACCEPT}
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = ""; // so picking the same file twice still fires
          void add(files);
        }}
      />
      <DockButton
        onClick={() => inputRef.current?.click()}
        title="Attach a screenshot — you can also paste or drag one in"
        style={{
          height: 30,
          padding: "0 12px",
          fontSize: 11,
          opacity: disabled || busy || pending.length >= MAX_SHOTS ? 0.5 : 1,
          cursor: disabled || busy || pending.length >= MAX_SHOTS ? "default" : "pointer",
        }}
      >
        {busy ? "Adding…" : "📎 Screenshot"}
      </DockButton>

      {pending.map((p) => (
        <span key={p.key} style={{ position: "relative", lineHeight: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.dataUrl}
            alt={p.name}
            title={`${p.name} · ${shotKb(p.bytes)}`}
            style={{ ...thumbStyle, width: size * 1.5, height: size, cursor: "default" }}
          />
          <button
            onClick={() => setPending(pending.filter((x) => x.key !== p.key))}
            title="Remove"
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              width: 20,
              height: 20,
              borderRadius: 999,
              border: `1px solid ${HOME_THEME.border}`,
              background: HOME_THEME.bg,
              color: HOME_THEME.text,
              fontSize: 11,
              lineHeight: "18px",
              cursor: "pointer",
              padding: 0,
            }}
          >
            ×
          </button>
        </span>
      ))}

      {pending.length === 0 && (
        <span style={{ fontSize: 10, color: HOME_THEME.muted, opacity: 0.4 }}>
          or paste / drag an image in
        </span>
      )}
    </div>
  );
}

/** Wires paste + drop on a container to a ShotTray's `add`. Shared by both composers. */
export function useShotDrop(
  pending: PendingShot[],
  setPending: (n: PendingShot[]) => void,
  onError?: (m: string | null) => void,
) {
  const [over, setOver] = useState(false);

  const take = useCallback(async (files: File[]) => {
    if (!files.length) return;
    try {
      const next = await prepareShots(files, pending.length);
      if (next.length) setPending([...pending, ...next]);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Could not attach that image.");
    }
  }, [onError, pending, setPending]);

  return {
    over,
    handlers: {
      onPaste: (e: ReactClipboardEvent) => {
        const files = imageFilesFrom(e.clipboardData);
        if (!files.length) return;
        e.preventDefault(); // otherwise the filename lands in the textarea
        void take(files);
      },
      onDragOver: (e: ReactDragEvent) => { e.preventDefault(); setOver(true); },
      onDragLeave: () => setOver(false),
      onDrop: (e: ReactDragEvent) => {
        const files = imageFilesFrom(e.dataTransfer);
        setOver(false);
        if (!files.length) return;
        e.preventDefault();
        void take(files);
      },
    },
  };
}

/* ----------------------------------------------------------------- thread */

function Bubble({
  mine,
  who,
  body,
  when,
  shots,
}: {
  mine: boolean;
  who: string;
  body: string;
  when: string;
  shots: FeedbackShot[];
}) {
  const wrap: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: mine ? "flex-end" : "flex-start",
    gap: 6,
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
      {/* A screenshot-only message has no bubble at all — an empty one reads as
          a bug, and the image is the message. */}
      {body ? <div style={bubble}>{body}</div> : null}
      <ShotGallery shots={shots} align={mine ? "flex-end" : "flex-start"} />
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
  shots = [],
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
  /** Every attachment on the ticket; grouped onto its message by message_id. */
  shots?: FeedbackShot[];
  isOwner: boolean;
  /** Did the VIEWER open this ticket? From the server, never inferred. */
  isAuthor: boolean;
  sending: boolean;
  /** `shots` is a list of data URLs, already downscaled by ShotTray. */
  onSend: (text: string, shots: string[]) => void | Promise<void>;
  /** Owner-only. Omit to hide the status controls entirely. */
  onSetStatus?: (status: FeedbackStatus) => void | Promise<void>;
  /** Slot above the conversation (back button, subject line, owner meta). */
  header?: ReactNode;
  height?: number;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingShot[]>([]);
  const [shotError, setShotError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const { over, handlers } = useShotDrop(pending, setPending, setShotError);

  // Jump to the newest message whenever the thread grows or is swapped out.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [ticket.id, messages.length, shots.length]);

  // A different ticket is a different draft — never carry an attachment over.
  useEffect(() => { setPending([]); setShotError(null); }, [ticket.id]);

  const send = () => {
    const text = draft.trim();
    if ((!text && pending.length === 0) || sending) return;
    const files = pending.map((p) => p.dataUrl);
    setDraft("");
    setPending([]);
    setShotError(null);
    void onSend(text, files);
  };

  const closed = ticket.status === "resolved";
  const canSend = Boolean(draft.trim()) || pending.length > 0;

  // Who a message belongs to, from the viewer's seat. Authoring the ticket wins
  // over being staff: on your own ticket your customer-side words are "You",
  // even when you are also the person who answers tickets.
  const isMine = (author: "user" | "owner") =>
    isAuthor ? author === "user" : author === "owner";
  const whoSaid = (author: "user" | "owner") => {
    if (author === "user") return isAuthor ? "You" : (ticket.email || "Customer");
    return isOwner && !isAuthor ? "You" : "CB Edge";
  };

  // message_id NULL belongs to the opening message (a ticket row, not a message).
  const shotsFor = (messageId: number | null) =>
    shots.filter((s) => (messageId == null ? s.message_id == null : s.message_id === messageId));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }} {...handlers}>
      {header}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          height,
          overflowY: "auto",
          padding: "4px 2px",
          borderRadius: 10,
          outline: over ? `1px dashed ${HOME_THEME.cyan}` : "none",
        }}
      >
        {/* The opening message is the ticket row itself, not a thread row —
            but it is always a CUSTOMER message, so it takes the same seat. */}
        <Bubble
          mine={isMine("user")}
          who={whoSaid("user")}
          body={ticket.message}
          when={fmtStamp(ticket.created_at)}
          shots={shotsFor(null)}
        />
        {messages.map((m) => (
          <Bubble
            key={m.id}
            mine={isMine(m.author)}
            who={whoSaid(m.author)}
            body={m.body}
            when={fmtStamp(m.created_at)}
            shots={shotsFor(m.id)}
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

        <ShotTray pending={pending} setPending={setPending} disabled={sending} onError={setShotError} compact />
        {shotError && (
          <div style={{ fontSize: 11, color: HOME_THEME.red, fontWeight: 600 }}>{shotError}</div>
        )}

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
              opacity: sending || !canSend ? 0.55 : 1,
              cursor: sending || !canSend ? "default" : "pointer",
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
