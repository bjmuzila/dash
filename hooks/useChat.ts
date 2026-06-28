"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { getSupabase } from "@/lib/supabase";

export type ChatMessage = {
  id: number;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string;
};

const PAGE = 50;

/**
 * Single global subscriber-chat room.
 * - Loads the latest PAGE messages on mount.
 * - Subscribes to realtime INSERTs and appends them live.
 * - send() inserts a row; RLS enforces user_id === jwt.sub.
 */
export function useChat(displayName: string) {
  const { getToken, userId } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<number>>(new Set());

  const append = useCallback((m: ChatMessage) => {
    if (seen.current.has(m.id)) return;
    seen.current.add(m.id);
    setMessages((prev) => [...prev, m]);
  }, []);

  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabase(getToken);
    let active = true;
    // Unique per mount so two tabs/components on the shared singleton client
    // each get their own channel instead of colliding on one name.
    const channelName = `chat_messages_${Math.random().toString(36).slice(2)}`;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      // Set the socket auth token BEFORE subscribing — the `accessToken`
      // client option only covers REST, and subscribing before the token is
      // set makes RLS silently drop the broadcast.
      const token = await getToken();
      if (!active) return;
      if (token) supabase.realtime.setAuth(token);

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
        .subscribe();
    })();

    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId, getToken, append]);

  const send = useCallback(
    async (raw: string) => {
      const body = raw.trim();
      if (!body || !userId) return;
      const supabase = getSupabase(getToken);
      const { error } = await supabase
        .from("chat_messages")
        .insert({ user_id: userId, display_name: displayName, body });
      if (error) setError(error.message);
    },
    [userId, getToken, displayName],
  );

  return { messages, loading, error, send };
}
