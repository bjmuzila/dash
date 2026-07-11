import { NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { listDiscordConnections } from "@/lib/db";
import { discordAvatarUrl } from "@/lib/discord";

// Owner-only: every account that has linked Discord (email, Discord username,
// avatar, connected date). Feeds the admin "Discord Connections" card and the
// Sales table's Discord column (joined there by email).
// SECURITY: fails CLOSED — unset/mismatched OWNER_USER_ID → 403.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

export async function GET() {
  try {
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!OWNER_USER_ID || userId !== OWNER_USER_ID) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const rows = await listDiscordConnections();
    return NextResponse.json({
      ok: true,
      rows: rows.map((r) => ({
        email: r.email,
        discord_username: r.discord_username,
        avatar_url: discordAvatarUrl(r.discord_id, r.discord_avatar),
        connected_at: r.discord_connected_at,
        is_owner: r.is_owner,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}
