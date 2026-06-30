import { NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

// Owner-only: wipe all subscriber-chat messages.
//
// Client deletes are blocked by RLS (no delete policy on chat_messages by
// design), so this runs server-side with the Supabase SERVICE ROLE key, which
// bypasses RLS. That key must NEVER reach the browser — it lives only in
// server env (SUPABASE_SERVICE_ROLE_KEY) and is used only inside this handler.
export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

export async function POST() {
  const userId = await getServerUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (OWNER_USER_ID && userId !== OWNER_USER_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json(
      { error: "Supabase service role not configured (SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Delete every row. `neq id, 0` is a match-all that satisfies the client's
  // required filter (id is a positive identity, so none equal 0).
  const { error, count } = await admin
    .from("chat_messages")
    .delete({ count: "exact" })
    .neq("id", 0);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deleted: count ?? null, ts: Date.now() });
}
