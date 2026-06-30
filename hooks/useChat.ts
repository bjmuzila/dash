"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export type ChatMessage = {
  id: number;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string;
};

const PAGE = 50;

/**
 * Single global subscriber-chat room (Supabase Auth + Realtime).
 * - Loads the latest PAGE messages on mount.
 * - Subscribes to realtime INSERT/DELETE and reflects them live.
 * - send() inserts a row; RLS enforces user_id === auth.uid().
 *
 * The browser client manages its own session token (cookie-based), so there's
 * no getToken bridge and no manual realtime.setAuth — the socket authenticates
 * from the active Supabase session automatically.
 */
export function useChat(displayName: string) {
  const { userId } = useAuth();
  const supabase = getSupabaseBrowser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<number>>(new Set());

  const append = useCallback((m: ChatMessage) => {
    if (seen.current.has(m.id)) return;
    seen.current.add(m.id);
    setMessages((prev) => [...prev, m]);
  }, []);

  const remove = useCallback((id: number) => {
    seen.current.delete(id);
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const channelName = `chat_messages_${Math.random().toString(36).slice(2)}`;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(PAGE);
      if (!active) return;
      if (error) {
        setError(error.message);
      } else {
        const ordered = (data ?? []).slice().reverse() as ChatMessage[];
        seen.current = new Set(ordered.map((m) => m.id));
        setMessages(ordered);
      }
      setLoading(false);

      channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "chat_messages" },
          (payload) => append(payload.new as ChatMessage),
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "chat_messages" },
          (payload) => {
            const id = (payload.old as { id?: number })?.id;
            if (typeof id === "number") remove(id);
          },
        )
        .subscribe();
    })();

    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId, supabase, append, remove]);

  const send = useCallback(
    async (raw: string) => {
      const body = raw.trim();
      if (!body || !userId) return;
      const { error } = await supabase
        .from("chat_messages")
        .insert({ user_id: userId, display_name: displayName, body });
      if (error) setError(error.message);
    },
    [userId, supabase, displayName],
  );

  return { messages, loading, error, send };
}
