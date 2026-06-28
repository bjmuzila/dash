"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { HOME_THEME, homeInputStyle } from "./homeTheme";
import { useChat } from "@/hooks/useChat";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * ChatPanel — the subscriber chat UI, sized to live inside a narrow dock
 * (e.g. the bottom of NotesDock) rather than a full page. Self-contained:
 * pulls the current user + the useChat hook (Supabase Realtime).
 */
export default function ChatPanel() {
  const { user } = useUser();
  const displayName = useMemo(
    () =>
      user?.firstName ||
      user?.username ||
      user?.primaryEmailAddress?.emailAddress?.split("@")[0] ||
      "trader",
    [user],
  );

  const { messages, loading, error, send } = useChat(displayName);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    await send(body);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginBottom: 10 }}>
        <span style={{ fontSize: 16, lineHeight: 1 }} aria-hidden>💬</span>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.text }}>
          Chat
        </span>
        <span style={{ fontSize: 10, color: loading ? HOME_THEME.muted : HOME_THEME.green }}>
          {loading ? "…" : "live"}
        </span>
      </div>

      {/* messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 120,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          paddingRight: 4,
        }}
      >
        {!loading && messages.length === 0 && (
          <div style={{ color: HOME_THEME.green, fontSize: 12, margin: "auto", textAlign: "center", opacity: 0.8 }}>
            No messages yet.
          </div>
        )}
        {messages.map((m) => {
          const mine = m.user_id === user?.id;
          return (
            <div
              key={m.id}
              title={m.body}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                flexShrink: 0,
                fontSize: 12,
                lineHeight: 1.7,
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              <span style={{ flexShrink: 0, fontWeight: 700, color: mine ? HOME_THEME.green : HOME_THEME.cyan }}>
                {mine ? "You" : m.display_name || "trader"}:
              </span>
              <span style={{ flex: 1, minWidth: 0, color: HOME_THEME.text, overflow: "hidden", textOverflow: "ellipsis" }}>
                {m.body}
              </span>
              <span style={{ flexShrink: 0, fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{fmtTime(m.created_at)}</span>
            </div>
          );
        })}
      </div>

      {error && <div style={{ color: HOME_THEME.red, fontSize: 11, marginTop: 6 }}>{error}</div>}

      {/* composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        style={{ display: "flex", gap: 6, marginTop: 10, flexShrink: 0 }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message…"
          maxLength={2000}
          style={{ ...homeInputStyle, flex: 1, fontSize: 12 }}
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: `1px solid rgba(33,158,188,0.5)`,
            background: draft.trim() ? "rgba(33,158,188,0.22)" : "rgba(255,255,255,0.04)",
            color: HOME_THEME.text,
            fontWeight: 700,
            fontSize: 12,
            cursor: draft.trim() ? "pointer" : "default",
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
