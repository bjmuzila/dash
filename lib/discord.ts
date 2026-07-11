// Discord OAuth + bot API helpers for the "Join Discord" account-menu flow.
//
// Flow: paid user clicks Join Discord -> /api/discord/connect redirects to
// Discord's OAuth authorize page (scope: identify + guilds.join) -> user
// approves -> Discord redirects to /api/discord/callback with a code -> we
// exchange it for a short-lived access_token, look up their Discord profile,
// then use the BOT token to (a) add them to our guild via the guilds.join
// grant and (b) assign the paid role. We only ever persist discord_id/
// username/avatar -- the OAuth access_token is used once at connect time and
// discarded; the bot token (long-lived, server-side only) is what does all
// role add/remove work afterward (see syncDiscordRoleForUser below).

const DISCORD_API = "https://discord.com/api/v10";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[discord] missing env var ${name}`);
  return v;
}

export function discordConfigured(): boolean {
  return !!(
    process.env.DISCORD_CLIENT_ID &&
    process.env.DISCORD_CLIENT_SECRET &&
    process.env.DISCORD_BOT_TOKEN &&
    process.env.DISCORD_GUILD_ID &&
    process.env.DISCORD_PAID_ROLE_ID
  );
}

export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("DISCORD_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify guilds.join",
    state,
    prompt: "consent",
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<TokenResponse> {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("DISCORD_CLIENT_ID"),
      client_secret: requireEnv("DISCORD_CLIENT_SECRET"),
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`[discord] token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export interface DiscordProfile {
  id: string;
  username: string;
  avatar: string | null;
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordProfile> {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`[discord] fetch user failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return { id: j.id, username: j.username, avatar: j.avatar ?? null };
}

/** Adds the user to our guild using their fresh OAuth access_token (requires
 *  the guilds.join scope). No-op (204) if they're already a member. Must be
 *  called with the BOT token as the Authorization header, per Discord's API. */
export async function joinGuild(discordUserId: string, accessToken: string): Promise<void> {
  const guildId = requireEnv("DISCORD_GUILD_ID");
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${discordUserId}`, {
    method: "PUT",
    headers: {
      authorization: `Bot ${requireEnv("DISCORD_BOT_TOKEN")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ access_token: accessToken }),
  });
  // 201 = added, 204 = already a member. Anything else is a real failure.
  if (res.status !== 201 && res.status !== 204) {
    throw new Error(`[discord] joinGuild failed: ${res.status} ${await res.text()}`);
  }
}

async function setRole(discordUserId: string, method: "PUT" | "DELETE"): Promise<void> {
  const guildId = requireEnv("DISCORD_GUILD_ID");
  const roleId = requireEnv("DISCORD_PAID_ROLE_ID");
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
    method,
    headers: { authorization: `Bot ${requireEnv("DISCORD_BOT_TOKEN")}` },
  });
  // 204 = success either way. 404 on DELETE (role already off / member left
  // the guild) is fine to swallow -- end state matches intent.
  if (res.status !== 204 && !(method === "DELETE" && res.status === 404)) {
    throw new Error(`[discord] setRole(${method}) failed: ${res.status} ${await res.text()}`);
  }
}

export const addPaidRole = (discordUserId: string) => setRole(discordUserId, "PUT");
export const removePaidRole = (discordUserId: string) => setRole(discordUserId, "DELETE");

export function discordAvatarUrl(discordId: string, avatar: string | null): string | null {
  if (!avatar) return null;
  const ext = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.${ext}?size=64`;
}

/** Called from the Stripe webhook whenever a user's paid status may have
 *  changed. Best-effort: logs and swallows errors so a Discord API hiccup
 *  never fails (and triggers a retry storm on) the Stripe webhook itself. */
export async function syncDiscordRoleForUser(discordId: string | null, isPaid: boolean): Promise<void> {
  if (!discordId || !discordConfigured()) return;
  try {
    if (isPaid) await addPaidRole(discordId);
    else await removePaidRole(discordId);
  } catch (err) {
    console.error("[discord] role sync failed:", err);
  }
}
