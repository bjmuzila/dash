"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { HOME_THEME, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { useChat } from "@/hooks/useChat";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatPage() {
  const { user, displayName } = useAuth();

  const { messages, loading, error, send } = useChat(displayName);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pin to bottom as new messages arrive.
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
    <PageShell maxWidth={720}>
      <Card accent="cyan" title="Subscriber Chat" subtitle={loading ? "Connecting…" : "Live"}>
        <div
          ref={scrollRef}
          style={{
            height: 460,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            paddingRight: 6,
          }}
        >
          {!loading && messages.length === 0 && (
            <div style={{ color: HOME_THEME.green, fontSize: 13, margin: "auto" }}>
              No messages yet — say something.
            </div>
          )}
          {messages.map((m) => {
            const mine = m.user_id === user?.id;
            return (
              <div
                key={m.id}
                style={{
                  alignSelf: mine ? "flex-end" : "flex-start",
                  maxWidth: "80%",
                  background: mine ? "rgba(33,158,188,0.18)" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${mine ? "rgba(33,158,188,0.35)" : HOME_THEME.border}`,
                  borderRadius: 10,
                  padding: "8px 12px",
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: HOME_THEME.cyan }}>
                    {mine ? "You" : m.display_name || "trader"}
                  </span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{fmtTime(m.created_at)}</span>
                </div>
                <div style={{ fontSize: 14, color: HOME_THEME.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {m.body}
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <div style={{ color: HOME_THEME.red, fontSize: 12, marginTop: 10 }}>{error}</div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          style={{ display: "flex", gap: 8, marginTop: 16 }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message the room…"
            maxLength={2000}
            style={{ ...homeInputStyle, flex: 1 }}
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            style={{
              padding: "8px 18px",
              borderRadius: 6,
              border: `1px solid rgba(33,158,188,0.5)`,
              background: draft.trim() ? "rgba(33,158,188,0.22)" : "rgba(255,255,255,0.04)",
              color: HOME_THEME.text,
              fontWeight: 700,
              fontSize: 13,
              cursor: draft.trim() ? "pointer" : "default",
            }}
          >
            Send
          </button>
        </form>
      </Card>
    </PageShell>
  );
}
