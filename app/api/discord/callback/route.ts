import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/supabase/server";
import { setUserDiscord } from "@/lib/db";
import { exchangeCodeForToken, fetchDiscordUser, joinGuild, addPaidRole } from "@/lib/discord";

// GET /api/discord/callback -> Discord redirects here with ?code&state after
// the user approves. Exchanges the code, adds them to our guild + assigns the
// paid role (both via the bot token), then persists discord_id/username/
// avatar on their account row and sends them back to /home.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function publicOrigin(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const cookieState = req.cookies.get("discord_oauth_state")?.value;

  const fail = (reason: string) => {
    console.error("[discord/callback]", reason);
    return NextResponse.redirect(new URL("/home?discord=error", req.url));
  };

  if (!code) return fail("no code");
  if (!returnedState || !cookieState || returnedState !== cookieState) return fail("state mismatch");
  if (!session.isPaid) return NextResponse.redirect(new URL("/home", req.url));

  try {
    const origin = publicOrigin(req);
    const redirectUri = `${origin}/api/discord/callback`;
    const token = await exchangeCodeForToken(code, redirectUri);
    const profile = await fetchDiscordUser(token.access_token);

    await joinGuild(profile.id, token.access_token);
    await addPaidRole(profile.id);
    await setUserDiscord(session.userId, {
      discord_id: profile.id,
      discord_username: profile.username,
      discord_avatar: profile.avatar,
    });
  } catch (err) {
    return fail(String(err));
  }

  const res = NextResponse.redirect(new URL("/home?discord=connected", req.url));
  res.cookies.set("discord_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}
