import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/supabase/server";
import { getUserById, clearUserDiscord } from "@/lib/db";
import { discordAvatarUrl, removePaidRole } from "@/lib/discord";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET -> { connected, username, avatarUrl } for the UserMenu's Discord row.
export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ connected: false });

  const user = await getUserById(session.userId);
  if (!user?.discord_id) return NextResponse.json({ connected: false });

  return NextResponse.json({
    connected: true,
    username: user.discord_username,
    avatarUrl: discordAvatarUrl(user.discord_id, user.discord_avatar),
  });
}

// POST -> unlink (removes the paid role too, since the whole point of the
// role is gating channel access to people we can still identify on Discord).
export async function POST() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const user = await getUserById(session.userId);
  if (user?.discord_id) {
    await removePaidRole(user.discord_id).catch((err) => console.error("[discord/status] role removal:", err));
  }
  await clearUserDiscord(session.userId);
  return NextResponse.json({ ok: true });
}
