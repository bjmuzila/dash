'use strict';
/**
 * server-v2/discord-bot-poster.js
 *
 * Posting to Discord as the BOT rather than through a webhook.
 *
 * WHY BOTH EXIST
 *   A webhook is bound to ONE channel, permanently. "Post this in every
 *   channel" therefore means one webhook per channel, each pasted in by hand
 *   and each one more thing to re-paste when a channel is recreated. The bot is
 *   the other shape: ONE credential (DISCORD_BOT_TOKEN), and it can post to any
 *   channel it can see, addressed by channel id. Invite it once with Send
 *   Messages + Attach Files and every current and future channel is reachable
 *   with no per-channel setup.
 *
 * THE TRADE-OFF, so it is not discovered later
 *   A webhook message may override `username` and `avatar_url` per message —
 *   which is how one webhook posts as "CB Edge Signals" in one server and
 *   something else in another. A BOT CANNOT. Its posts always wear the
 *   application's own name and avatar, set once in the Discord Developer
 *   Portal. For "CB Edge Signals everywhere" that is the better outcome, but it
 *   does mean the identity fields on the owner page are inert for bot posts,
 *   and the page says so.
 *
 * REST ONLY — no gateway.
 *   discord.js is in the tree (discord-bot.js, the slash-command bot) and would
 *   drag a websocket connection, an intents declaration and a login lifecycle
 *   into a process that only ever needs to POST a message. Posting is one plain
 *   HTTPS call, so this file makes it directly. Nothing here needs the bot to
 *   be "online".
 *
 * PERMISSIONS
 *   The bot must be in the guild and able to see the channel. A missing
 *   permission comes back as 403 "Missing Access" / "Missing Permissions" and
 *   is surfaced verbatim: that string is the difference between "the bot is
 *   broken" and "the bot was never added to that channel".
 *
 * Env:
 *   DISCORD_BOT_TOKEN   the bot token (Developer Portal → Bot → Token)
 *   DISCORD_GUILD_ID    default guild for listChannels()
 */

const API = 'https://discord.com/api/v10';

function botToken() {
  return (process.env.DISCORD_BOT_TOKEN || '').trim();
}

function botConfigured() {
  return !!botToken();
}

function authHeaders() {
  const token = botToken();
  if (!token) throw new Error('DISCORD_BOT_TOKEN is not set');
  return { Authorization: `Bot ${token}` };
}

/** Discord channel types worth posting into. 0 = text, 5 = announcement. */
const POSTABLE_TYPES = new Set([0, 5]);

/**
 * Every channel the bot can see in a guild, flattened to what a dropdown needs.
 * Categories (type 4) are resolved to a `category` label rather than listed, so
 * the page can group without a second call.
 *
 * Returns [] rather than throwing when the bot is not configured — an empty
 * dropdown with an explanation beats an error banner on a page that also does
 * six other things.
 */
async function listChannels(guildId) {
  const gid = (guildId || process.env.DISCORD_GUILD_ID || '').trim();
  if (!botConfigured()) return { ok: false, error: 'DISCORD_BOT_TOKEN is not set', channels: [] };
  if (!gid) return { ok: false, error: 'DISCORD_GUILD_ID is not set', channels: [] };

  const res = await fetch(`${API}/guilds/${encodeURIComponent(gid)}/channels`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    // 403 here almost always means the bot is not in the guild at all.
    return { ok: false, error: `Discord ${res.status}: ${body}`, channels: [] };
  }

  const all = await res.json();
  const cats = new Map(all.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
  const channels = all
    .filter((c) => POSTABLE_TYPES.has(c.type))
    .map((c) => ({
      id: c.id,
      name: c.name,
      category: c.parent_id ? cats.get(c.parent_id) || '' : '',
      position: c.position ?? 0,
    }))
    .sort((a, b) =>
      (a.category || '').localeCompare(b.category || '') || a.position - b.position || a.name.localeCompare(b.name));

  return { ok: true, guildId: gid, channels };
}

/**
 * Post a message (and optionally one PNG) into a channel as the bot.
 *
 * `username` / `avatarUrl` are accepted and IGNORED on purpose — callers share
 * one shape with the webhook path, and silently dropping them here is better
 * than making every call site branch. See the trade-off note at the top.
 */
async function postToChannel(channelId, { content = '', file = null, filename = 'image.png' } = {}) {
  const id = String(channelId || '').trim();
  if (!/^\d{15,25}$/.test(id)) throw new Error(`"${id.slice(0, 40)}" is not a Discord channel id`);

  const form = new FormData();
  form.append('payload_json', JSON.stringify(content ? { content } : {}));
  if (file) form.append('files[0]', new Blob([file], { type: 'image/png' }), filename);

  const res = await fetch(`${API}/channels/${id}/messages`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`bot post ${res.status}: ${body}`);
  }
}

/** Name for a channel id, for the page's summary line. '' when unknown. */
async function channelName(channelId) {
  try {
    const { channels } = await listChannels();
    return channels.find((c) => c.id === String(channelId))?.name || '';
  } catch {
    return '';
  }
}

module.exports = { botConfigured, listChannels, postToChannel, channelName };
