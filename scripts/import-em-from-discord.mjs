/**
 * scripts/import-em-from-discord.mjs
 *
 * One-time historical backfill of weekly Estimated-Move boards posted as image
 * screenshots in a dedicated Discord channel. Reads the channel history with the
 * existing bot token, downloads every image attachment, OCRs each board into
 * { week_start, week_label, ticker, up, down }, and writes a PREVIEW file:
 *
 *     data/em-discord-preview.json
 *
 * Nothing is written to the database here. Review the preview (and per-image raw
 * OCR text) in the EM Tracker tab's importer, fix any misreads, then commit —
 * which saves the bands and triggers historical OHLC evaluation.
 *
 * Run:
 *   DISCORD_EM_CHANNEL_ID=123456789012345678 node scripts/import-em-from-discord.mjs
 *
 * Env (.env.local):
 *   DISCORD_BOT_TOKEN       — same bot token used by discord-bot.js
 *   DISCORD_EM_CHANNEL_ID   — the dedicated EM-boards channel
 * The bot must be in the server and have View Channel + Read Message History.
 *
 * Deps: discord.js (already installed), tesseract.js (auto-installed if missing).
 */

import 'dotenv/config';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// load .env.local too (discord-bot.js convention)
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') }); } catch {}

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
// Dedicated EM-boards channel. Override with DISCORD_EM_CHANNEL_ID if needed.
const CHANNEL_ID = process.env.DISCORD_EM_CHANNEL_ID || '1223614669827084460';
if (!BOT_TOKEN) { console.error('Missing DISCORD_BOT_TOKEN'); process.exit(1); }

// Optional cap on how many of the MOST RECENT board images to process — for a
// quick test batch. `--limit 5` or `LIMIT=5`. 0/absent = all history.
function parseLimit() {
  const arg = process.argv.find((a) => a === '--limit' || a.startsWith('--limit='));
  if (arg) {
    const v = arg.includes('=') ? arg.split('=')[1] : process.argv[process.argv.indexOf(arg) + 1];
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  const env = Number(process.env.LIMIT);
  return Number.isFinite(env) && env > 0 ? Math.floor(env) : 0;
}
const LIMIT = parseLimit();

const TICKERS = new Set([
  'ESM','NQM','ESU','NQU','SPY','QQQ','SPX','AAPL','AMD','AMZN','GOOGL','META',
  'MSFT','NVDA','TSLA','COIN','HOOD','IWM','NDX','NFLX','SMH','PLTR',
]);

// ── week math ───────────────────────────────────────────────────────────────
// The board title is the FRIDAY of the week the EM applies to ("FOR 5/1").
// We store week_start = that week's Monday. Year is inferred from the message
// timestamp (boards are posted around the week they cover).
function fridayLabelToWeek(label, postedAtMs) {
  const m = label.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : null;
  if (!year) {
    const posted = new Date(postedAtMs);
    year = posted.getUTCFullYear();
    // handle Jan boards posted in late Dec or vice-versa
    const guess = new Date(Date.UTC(year, month - 1, day));
    const diffDays = (guess.getTime() - postedAtMs) / 86400000;
    if (diffDays > 180) year -= 1;
    else if (diffDays < -180) year += 1;
  }
  const friday = new Date(Date.UTC(year, month - 1, day, 12));
  // Monday of that week
  const dow = friday.getUTCDay(); // Fri = 5
  const monday = new Date(friday);
  monday.setUTCDate(friday.getUTCDate() - ((dow + 6) % 7));
  return {
    week_label: `${month}/${day}`,
    week_start: monday.toISOString().slice(0, 10),
    friday: friday.toISOString().slice(0, 10),
  };
}

// Fallback when the title date can't be OCR'd: use the Friday of the week the
// board was posted in. (Boards are posted around their own week.)
function weekLabelFromPosted(postedAtMs) {
  const d = new Date(postedAtMs);
  const dow = d.getUTCDay();           // 0=Sun..6=Sat
  const friday = new Date(d);
  friday.setUTCDate(d.getUTCDate() + ((5 - dow + 7) % 7)); // forward to Friday
  return `${friday.getUTCMonth() + 1}/${friday.getUTCDate()}`;
}

// ── OCR ─────────────────────────────────────────────────────────────────────
let _tess = null;
async function ocr(buffer) {
  if (!_tess) {
    let Tesseract;
    try { Tesseract = require('tesseract.js'); }
    catch {
      console.error('tesseract.js not installed. Run: npm i tesseract.js');
      process.exit(1);
    }
    _tess = await Tesseract.createWorker('eng');
    await _tess.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./ ' });
  }
  const { data } = await _tess.recognize(buffer);
  return data.text || '';
}

// Parse OCR text of one board: title date + ticker/up/down rows.
function parseBoard(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let titleLabel = null;
  // The date often wraps to the line AFTER "...MOVE FOR". Search the whole text
  // with newlines allowed between "FOR" and the date.
  const tm = text.match(/ESTIMATED MOVE FOR\s*[\r\n]*\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);
  if (tm) {
    titleLabel = tm[1];
  } else {
    // Fallback: first standalone m/d line near the top (before the TICKER header).
    for (const l of lines.slice(0, 6)) {
      const m = l.match(/^(\d{1,2}\/\d{1,2})$/);
      if (m) { titleLabel = m[1]; break; }
    }
  }
  const rows = [];
  const seen = new Set();
  for (const l of lines) {
    if (/TICKER|CLOSE|BZILATRADES|ESTIMATED/i.test(l)) continue;
    // First alpha token = (possibly OCR-mangled) ticker.
    const am = l.match(/^([A-Z0-9]{1,6})\b/i);
    if (!am) continue;
    const ticker = resolveTicker(am[1]);
    if (!ticker || seen.has(ticker)) continue;

    // All numeric tokens on the line. Board layouts vary (TICKER CLOSE UP DOWN,
    // or TICKER CLOSE EXP EM UP DOWN), but UP and DOWN are ALWAYS the last two
    // price numbers. Drop the EXP date token (e.g. "5/29") before collecting.
    const nums = (l.replace(/\b\d{1,2}\/\d{1,2}\b/g, ' ').match(/[\d.,]+/g) || [])
      .map(cleanNum)
      .filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length < 2) continue;
    const a = nums[nums.length - 2];
    const b = nums[nums.length - 1];
    const up = Math.max(a, b), down = Math.min(a, b);
    // sanity: up/down should be within ~40% of each other (same instrument)
    if (down <= 0 || up / down > 1.8) continue;
    rows.push({ ticker, up, down });
    seen.add(ticker);
  }
  return { titleLabel, rows };
}

// Parse a possibly-European-formatted number. The boards use "." as a thousands
// separator AND as the decimal point ("7.685.75" = 7685.75, "105.787" = 105.787).
// Rule: if there are 2+ dots, all but the LAST are thousands separators.
function cleanNum(s) {
  let t = String(s).replace(/,/g, '');
  const dots = (t.match(/\./g) || []).length;
  if (dots >= 2) {
    const i = t.lastIndexOf('.');
    t = t.slice(0, i).replace(/\./g, '') + '.' + t.slice(i + 1);
  }
  return Number(t);
}

// Map an OCR'd ticker token to a known ticker, tolerating dropped leading chars
// and futures aliases. ES/ESM/ESU -> ESM(ESU display); first-letter crops too.
function resolveTicker(raw) {
  let t = String(raw).toUpperCase().replace(/[^A-Z]/g, '');
  if (!t) return null;
  const ALIAS = {
    ES: 'ESM', ESM: 'ESM', ESU: 'ESM',
    N: 'NQM', NQ: 'NQM', NQM: 'NQM', NQU: 'NQM',
    SX: 'SPX', SPX: 'SPX', SPY: 'SPY',
    APL: 'AAPL', AAPL: 'AAPL', A: null,
    SET: 'MSFT', MSET: 'MSFT', MSFT: 'MSFT',
    SLA: 'TSLA', TSLA: 'TSLA',
    DX: 'NDX', NDX: 'NDX', NELX: 'NFLX', NFLX: 'NFLX',
    LTR: 'PLTR', PLTR: 'PLTR', IM: 'IWM', IWM: 'IWM',
    G006L: 'GOOGL', GOOGL: 'GOOGL', GOOG: 'GOOGL',
  };
  if (t in ALIAS) return ALIAS[t];
  if (TICKERS.has(t)) return t;
  // suffix match for a single dropped leading letter (e.g. "MD"->AMD, "MZN"->AMZN)
  for (const known of TICKERS) {
    if (known.endsWith(t) && known.length - t.length === 1) return known;
  }
  return null;
}

// ── Discord ─────────────────────────────────────────────────────────────────
function imageUrlsFromMessage(msg) {
  const urls = [];
  for (const att of msg.attachments.values()) {
    const isImg = (att.contentType || '').startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(att.name || att.url);
    if (isImg) urls.push(att.url);
  }
  // Discord can deliver images as embeds (e.g. webhook/bot posts) rather than
  // attachments. Pick up embed image/thumbnail URLs too.
  for (const emb of msg.embeds || []) {
    const u = emb.image?.url || emb.thumbnail?.url;
    if (u) urls.push(u);
  }
  return urls;
}

// Collect image messages from one text channel/thread, newest-first, honoring
// the global LIMIT. Returns {scanned, found}.
async function scanChannel(channel, images) {
  let before, scanned = 0;
  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    scanned += batch.size;
    for (const msg of batch.values()) {
      for (const url of imageUrlsFromMessage(msg)) {
        images.push({ url, postedAt: msg.createdTimestamp, msgId: msg.id });
        if (LIMIT && images.length >= LIMIT) return { scanned, done: true };
      }
    }
    before = batch.last().id;
    process.stdout.write(`\rScanned ${scanned} msgs, found ${images.length} images…`);
  }
  return { scanned, done: false };
}

async function main() {
  const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
  // Attachments + embeds are returned by the REST history fetch WITHOUT the
  // privileged MessageContent intent, so we don't request it by default (asking
  // for a disabled privileged intent makes Discord reject the whole connection
  // with "Used disallowed intents"). If you HAVE enabled MessageContent in the
  // Developer Portal and want it, set WITH_MESSAGE_CONTENT=1.
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
  if (process.env.WITH_MESSAGE_CONTENT === '1') intents.push(GatewayIntentBits.MessageContent);
  const client = new Client({ intents });
  await client.login(BOT_TOKEN);

  let channel;
  try {
    channel = await client.channels.fetch(CHANNEL_ID);
  } catch (e) {
    console.error(`\nCould not fetch channel ${CHANNEL_ID}: ${e.message}`);
    console.error('→ Check the ID, that the bot is in that server, and has View Channel.');
    process.exit(1);
  }
  if (!channel) { console.error(`\nChannel ${CHANNEL_ID} not found / not visible to the bot.`); process.exit(1); }
  console.log(`Channel: #${channel.name ?? CHANNEL_ID}  type=${channel.type}`);

  const images = [];

  // Forum channel → boards live in threads; scan each thread.
  if (channel.type === ChannelType.GuildForum) {
    const active = await channel.threads.fetchActive();
    const archived = await channel.threads.fetchArchived({ limit: 100 }).catch(() => ({ threads: new Map() }));
    const threads = [...active.threads.values(), ...archived.threads.values()];
    console.log(`Forum channel — scanning ${threads.length} threads…`);
    for (const t of threads) {
      await scanChannel(t, images);
      if (LIMIT && images.length >= LIMIT) break;
    }
  } else if (typeof channel.messages?.fetch === 'function') {
    const { scanned } = await scanChannel(channel, images);
    if (scanned === 0) {
      console.log('\n0 messages returned. Likely missing "Read Message History" permission in this channel, or the MessageContent intent is off in the Developer Portal.');
    }
  } else {
    console.error('Channel is not text-based and not a forum — nothing to scan.');
    process.exit(1);
  }

  console.log(`\n${LIMIT ? `Test batch: ` : ''}Processing ${images.length} image(s) with OCR…`);

  const DEBUG = process.argv.includes('--debug');
  const weeks = [];
  const debugLog = [];
  let ok = 0, fail = 0;
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    let text = '', titleLabel = null, rows = [], reason = '';
    try {
      const res = await fetch(img.url);
      const buf = Buffer.from(await res.arrayBuffer());
      text = await ocr(buf);
      ({ titleLabel, rows } = parseBoard(text));

      // Derive the week: prefer the OCR'd title date; fall back to the message's
      // posted date if the title didn't read but the rows look like a board.
      let wk = titleLabel ? fridayLabelToWeek(titleLabel, img.postedAt) : null;
      let weekInferred = false;
      if (!wk && rows.length >= 8) {
        wk = fridayLabelToWeek(weekLabelFromPosted(img.postedAt), img.postedAt);
        if (wk) { weekInferred = true; reason = 'title-unreadable→posted-date (VERIFY week)'; }
      }

      if (rows.length < 3) reason = `only ${rows.length} rows parsed (likely not a board image)`;
      else if (!wk) reason = `no week (title="${titleLabel || ''}")`;

      if (wk && rows.length >= 3) {
        weeks.push({ ...wk, week_inferred: weekInferred, source_url: img.url, msg_id: img.msgId, ocr_ticker_count: rows.length, rows, raw_ocr: text });
        ok++;
      } else {
        fail++;
      }
    } catch (e) {
      fail++;
      reason = 'ocr-error: ' + e.message;
    }
    if (DEBUG) console.log(`\n  [${i + 1}] ${reason ? 'SKIP — ' + reason : `OK ${rows.length} rows (${titleLabel})`}  ${img.url.slice(0, 90)}`);
    debugLog.push({ i, url: img.url, postedAt: new Date(img.postedAt).toISOString(), titleLabel, rowCount: rows.length, reason, raw_ocr: text });
    process.stdout.write(`\rOCR ${i + 1}/${images.length}  (ok ${ok}, skipped ${fail})`);
  }
  console.log('');

  // Always write a debug dump so skips are diagnosable.
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'em-discord-debug.json'),
    JSON.stringify({ generatedAt: Date.now(), images: debugLog }, null, 2));

  // de-dupe by week_start (keep the one with the most tickers)
  const byWeek = new Map();
  for (const w of weeks) {
    const prev = byWeek.get(w.week_start);
    if (!prev || w.rows.length > prev.rows.length) byWeek.set(w.week_start, w);
  }
  const out = Array.from(byWeek.values()).sort((a, b) => a.week_start.localeCompare(b.week_start));

  const file = path.join(__dirname, '..', 'data', 'em-discord-preview.json');
  fs.writeFileSync(file, JSON.stringify({ generatedAt: Date.now(), channel: CHANNEL_ID, weeks: out }, null, 2));
  console.log(`Wrote ${out.length} weeks to data/em-discord-preview.json`);
  console.log('Review + commit in the EM Tracker tab → "Review Discord Import".');

  if (_tess) await _tess.terminate();
  await client.destroy();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
