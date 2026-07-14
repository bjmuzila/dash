'use strict';
/**
 * server-v2/discord-relay.js
 *
 * Relays the home SignalsFeed's *text* source (public/signals.txt — hand-authored
 * lines + the AUTO ECON ALERTS block written by econ-alert-recorder.js) into a
 * dedicated Discord channel.
 *
 * NOTE on the other half of the feed: the home feed merges TWO sources —
 * this file, and the live GEX/CB engine (/proxy/signals → trade_signals).
 * The engine already has its own Discord path (sendDiscord() in signals-engine.js,
 * env SIGNALS_DISCORD_WEBHOOK). Point SIGNALS_DISCORD_WEBHOOK at the SAME channel
 * webhook as HOME_SIGNALS_DISCORD_WEBHOOK and the Discord channel mirrors the
 * home feed exactly. This relay deliberately does NOT poll /proxy/signals, so
 * engine signals can never be double-posted.
 *
 * Dedupe: every posted line is hashed and the hash set is persisted to
 * data/discord-relay-seen.json, so a container restart / redeploy never
 * re-floods the channel with lines it already sent.
 *
 * Cold start: if no state file exists, the current contents of signals.txt are
 * marked as seen WITHOUT posting. Only lines that appear after this process
 * first runs get relayed.
 *
 * Env:
 *   HOME_SIGNALS_DISCORD_WEBHOOK  webhook URL for the signals channel (required; off if unset)
 *   SIGNALS_SITE_URL             base URL for {links} (default https://cbedge.net)
 *   HOME_SIGNALS_RELAY_DISABLED  set to "1" to hard-disable
 *
 * Start from server-with-proxy.js after server.listen():
 *   require('./discord-relay').startDiscordRelay();
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const POLL_MS = 15 * 1000;        // match the SignalsFeed poll cadence
const MAX_SEEN = 500;             // cap the persisted hash set
const MAX_BURST = 5;              // never post more than this per poll (flood guard)

const SIGNALS_PATH = path.join(__dirname, '..', 'public', 'signals.txt');
const STATE_PATH = path.join(__dirname, '..', 'data', 'discord-relay-seen.json');

const WEBHOOK = (process.env.HOME_SIGNALS_DISCORD_WEBHOOK || '').trim();
const SITE_URL = (process.env.SIGNALS_SITE_URL || 'https://cbedge.net').replace(/\/+$/, '');

// [page] tag → embed color, mirroring the feed's chip colors.
const TAG_COLORS = {
  CB: 0x00e0ff,
  Econ: 0xffb020,
  Traders: 0x7c5cff,
  EM: 0x00d68f,
  Flow: 0x00d68f,
  Analytics: 0x00e0ff,
  Greeks: 0xff5c7c,
  Scanner: 0x8aa8c4,
  Balance: 0x8aa8c4,
};
const DEFAULT_COLOR = 0x8aa8c4;

// ── state ───────────────────────────────────────────────────────────────────
let seen = new Set();
let primed = false; // true once we know the baseline (either loaded or cold-started)

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    if (Array.isArray(raw.seen)) {
      seen = new Set(raw.seen);
      primed = true;
      console.log(`[discord-relay] resumed — ${seen.size} lines already relayed`);
      return;
    }
  } catch { /* no state yet → cold start below */ }
  primed = false;
}

function saveState() {
  const arr = [...seen].slice(-MAX_SEEN);
  seen = new Set(arr);
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({ seen: arr }), 'utf-8');
  } catch (e) {
    console.log(`[discord-relay] state write failed: ${e.message}`);
  }
}

const hash = (line) => crypto.createHash('sha1').update(line).digest('hex').slice(0, 16);

// ── parsing ─────────────────────────────────────────────────────────────────
// Line format (see public/signals.txt):  <time>  [<page>]  <text>  {<link>}
// Comments (#) and blanks are ignored, same as the feed's own parser.
function readSignalLines() {
  let content;
  try { content = fs.readFileSync(SIGNALS_PATH, 'utf-8'); } catch { return []; }
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function parseLine(raw) {
  let rest = raw;

  // {link} — trailing, optional
  let link = null;
  const linkMatch = rest.match(/\{([^}]+)\}\s*$/);
  if (linkMatch) {
    link = linkMatch[1].trim();
    rest = rest.slice(0, linkMatch.index).trim();
  }

  // <time> — leading, optional trailing "|" or "-"
  let time = null;
  const timeMatch = rest.match(
    /^((?:\d{4}-\d{2}-\d{2}\s+)?\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?)\s*[|-]?\s*/i,
  );
  if (timeMatch) {
    time = timeMatch[1].trim();
    rest = rest.slice(timeMatch[0].length);
  }

  // [page] tag — optional
  let tag = null;
  const tagMatch = rest.match(/^\[([^\]]+)\]\s*/);
  if (tagMatch) {
    tag = tagMatch[1].trim();
    rest = rest.slice(tagMatch[0].length);
  }

  return { time, tag, text: rest.trim() || raw, link };
}

function toEmbed(raw) {
  const { time, tag, text, link } = parseLine(raw);
  const url = link
    ? (/^https?:\/\//i.test(link) ? link : `${SITE_URL}${link.startsWith('/') ? '' : '/'}${link}`)
    : null;

  const embed = {
    color: (tag && TAG_COLORS[tag]) || DEFAULT_COLOR,
    description: url ? `**${text}**\n[open ${link}](${url})` : `**${text}**`,
    footer: { text: [tag, time].filter(Boolean).join(' • ') || 'CB Edge' },
  };
  return embed;
}

async function post(embeds) {
  const res = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'CB Edge Signals', embeds }),
    signal: AbortSignal.timeout(15000),
  });
  // 429 = rate limited. Don't mark the lines seen; the next poll retries them.
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}

async function pollOnce() {
  const lines = readSignalLines();
  if (!lines.length) return;

  // Cold start: adopt whatever is already in the file as the baseline and post
  // nothing, so a fresh deploy doesn't dump the whole AUTO block into Discord.
  if (!primed) {
    lines.forEach((l) => seen.add(hash(l)));
    primed = true;
    saveState();
    console.log(`[discord-relay] cold start — ${lines.length} existing lines marked seen, not posted`);
    return;
  }

  const fresh = lines.filter((l) => !seen.has(hash(l)));
  if (!fresh.length) return;

  // Oldest-first so Discord reads top-down chronologically (the home feed is
  // newest-leftmost; a chat channel is the opposite).
  const batch = fresh.slice(-MAX_BURST);
  if (fresh.length > MAX_BURST) {
    // Anything beyond the burst cap is stale (file was hand-edited in bulk, or
    // we were down a while) — mark it seen so it never trickles out later.
    fresh.slice(0, fresh.length - MAX_BURST).forEach((l) => seen.add(hash(l)));
  }

  try {
    await post(batch.map(toEmbed));
    batch.forEach((l) => seen.add(hash(l)));
    saveState();
    batch.forEach((l) => console.log(`[discord-relay] → ${l}`));
  } catch (e) {
    // Best-effort: leave the lines unseen so the next poll retries them.
    console.log(`[discord-relay] post failed (${e.message}) — will retry`);
    saveState(); // still persist any lines we dropped above
  }
}

function startDiscordRelay() {
  if (process.env.HOME_SIGNALS_RELAY_DISABLED === '1') {
    console.log('[discord-relay] disabled via HOME_SIGNALS_RELAY_DISABLED=1');
    return () => {};
  }
  if (!WEBHOOK) {
    console.log('[discord-relay] off — HOME_SIGNALS_DISCORD_WEBHOOK not set');
    return () => {};
  }

  loadState();
  console.log(`[discord-relay] enabled — mirroring public/signals.txt to Discord every ${POLL_MS / 1000}s`);

  let stopped = false;
  let timer = null;
  function arm() {
    if (stopped) return;
    timer = setTimeout(() => { void pollOnce().finally(arm); }, POLL_MS);
  }
  // Let the server settle (and let econ-alert-recorder do its first pass) first.
  setTimeout(() => { void pollOnce().finally(arm); }, 12_000);

  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

module.exports = { startDiscordRelay };
