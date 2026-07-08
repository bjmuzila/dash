import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServerSession } from "@/lib/supabase/server";

/**
 * Subscriber chat, server-mediated.
 *
 * Earlier version had the browser talk to Supabase Realtime/PostgREST
 * directly, authenticated via a hand-minted "bring your own auth" JWT
 * (see app/api/auth/chat-token, now unused). That broke permanently once
 * this Supabase project migrated to JWT Signing Keys -- the shared-secret
 * key material for that system is never exposed via the dashboard, so there
 * was no way to keep self-signing valid tokens.
 *
 * This route sidesteps Supabase auth entirely: our own session cookie
 * (getServerSession) gates access, and the SERVICE ROLE key (server-only,
 * bypasses RLS) does the actual read/write. The browser never talks to
 * Supabase directly for chat. hooks/useChat.ts polls this route instead of
 * subscribing to Realtime.
 */
export const dynamic = "force-dynamic";

// TEMP: chat disabled site-wide. Flip back by removing this block.
const CHAT_ENABLED = false;

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const PAGE = 50;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET() {
  if (!CHAT_ENABLED) return NextResponse.json({ error: "Chat is temporarily disabled", messages: [] }, { status: 503 });

  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = admin();
  if (!db) return NextResponse.json({ error: "Chat not configured (SUPABASE_SERVICE_ROLE_KEY missing)" }, { status: 500 });

  const { data, error } = await db
    .from("chat_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(PAGE);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: (data ?? []).slice().reverse() });
}

export async function POST(req: Request) {
  if (!CHAT_ENABLED) return NextResponse.json({ error: "Chat is temporarily disabled" }, { status: 503 });

  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: string;
  let displayName: string;
  try {
    const json = await req.json();
    body = String(json?.body ?? "").trim();
    displayName = String(json?.displayName ?? "").trim().slice(0, 80);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body || body.length > 2000) {
    return NextResponse.json({ error: "Message must be 1-2000 characters" }, { status: 400 });
  }

  const db = admin();
  if (!db) return NextResponse.json({ error: "Chat not configured (SUPABASE_SERVICE_ROLE_KEY missing)" }, { status: 500 });

  const { data, error } = await db
    .from("chat_messages")
    .insert({ user_id: session.userId, display_name: displayName || session.email, body })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: data });
}
