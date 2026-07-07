"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";

export type ChatMessage = {
  id: number;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string;
};

const POLL_MS = 3000;

/**
 * Single global subscriber-chat room, server-mediated (see
 * app/api/chat/messages/route.ts). No direct browser<->Supabase connection
 * and no Supabase-issued JWT of any kind -- our own session cookie gates the
 * route, and the service-role key does the actual DB work server-side.
 * "Live" is short-interval polling rather than a Realtime socket; fine for a
 * single low-traffic chat room, and immune to Supabase's JWT Signing Keys
 * migration breaking self-signed tokens.
 */
export function useChat(displayName: string) {
  const { userId } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const known = useRef<Set<number>>(new Set());

  const merge = useCallback((incoming: ChatMessage[]) => {
    const fresh = incoming.filter((m) => !known.current.has(m.id));
    if (fresh.length === 0) return;
    fresh.forEach((m) => known.current.add(m.id));
    setMessages((prev) => [...prev, ...fresh].sort((a, b) => a.id - b.id));
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/messages", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Failed to load (${res.status})`);
        return;
      }
      merge((json.messages ?? []) as ChatMessage[]);
      setError(null);
    } catch {
      setError("Network error loading chat");
    } finally {
      setLoading(false);
    }
  }, [merge]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    load();
    const interval = setInterval(() => {
      if (active) load();
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [userId, load]);

  const send = useCallback(
    async (raw: string) => {
      const body = raw.trim();
      if (!body || !userId) return;
      try {
        const res = await fetch("/api/chat/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body, displayName }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json?.error || `Failed to send (${res.status})`);
          return;
        }
        if (json?.message) merge([json.message as ChatMessage]);
        setError(null);
      } catch {
        setError("Network error sending message");
      }
    },
    [userId, displayName, merge],
  );

  return { messages, loading, error, send };
}
