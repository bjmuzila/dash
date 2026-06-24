/**
 * discord-bot.js — Discord slash command bot for BzilaTrades Next.js Dashboard
 *
 * Slash commands:
 *   /screenshot <page>  — screenshot a dashboard page → posts image to Discord
 *   /gex                — current GEX levels as text (from Vanilla proxy on :3001)
 *   /snapshot           — GEX chart screenshot + GEX levels text combined
 *
 * Run:  node discord-bot.js
 * Register commands first: node register-commands.js
 *
 * Required in .env.local:
 *   DISCORD_BOT_TOKEN   — bot token from Discord Developer Portal
 *   DISCORD_APP_ID      — application ID from Discord Developer Portal
 *   DISCORD_GUILD_ID    — (optional) guild ID for instant dev registration
 */

'use strict';

require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const puppeteer = require('puppeteer');
const fs = require('fs');
const http = require('http');

// ── Config ─────────────────────────────────────────────────────────────────
const BOT_TOKEN      = process.env.DISCORD_BOT_TOKEN;
const VANILLA_PORT   = 3001;
const NEXT_BASE      = process.env.DASHBOARD_URL || 'https://dash-1fa2.onrender.com';
const VANILLA_BASE   = process.env.VANILLA_URL   || `http://localhost:${VANILLA_PORT}`;

if (!BOT_TOKEN) {
  console.error('[discord-bot] ERROR: DISCORD_BOT_TOKEN not set in .env.local');
  process.exit(1);
}

// ── Page map: choice value → Next.js route ─────────────────────────────────
// Adjust these paths to match your actual Next.js routes
const PAGES = {
  'gex-chart':      '/home',
  'heatmap':        '/home',
  'snapshot-flow':  '/home',
  'signals':        '/home',
  'mvc':            '/home',
  'exposure-stack': '/insights',
  'multi-greek':    '/mult-greek',
};

// Extra wait per page (ms) after networkidle2
const PAGE_WAIT = {
  'gex-chart':      3000,
  'heatmap':        3000,
  'snapshot-flow':  3000,
  'signals':        3000,
  'mvc':            3000,
  'exposure-stack': 3000,
  'multi-greek':    3000,
  'default':        3000,
};

// ── Screenshot ─────────────────────────────────────────────────────────────
async function takeScreenshot(pageKey) {
  const urlPath = PAGES[pageKey];
  if (!urlPath) throw new Error(`Unknown page: ${pageKey}`);

  const url = NEXT_BASE + urlPath;
  const waitMs = PAGE_WAIT[pageKey] ?? PAGE_WAIT['default'];
  console.log(`[screenshot] ${url} (wait ${waitMs}ms)`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    page.on('console', () => {});

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, waitMs));

    const outPath = `_discord_snap_${pageKey}_${Date.now()}.png`;
    await page.screenshot({ path: outPath, fullPage: false });
    return outPath;
  } finally {
    await browser.close();
  }
}

// ── GEX levels text from Vanilla proxy ────────────────────────────────────
function fetchGexCsv() {
  return new Promise((resolve, reject) => {
    http.get(`${VANILLA_BASE}/proxy/api/gex-levels`, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseGexCsv(csv) {
  const lines = csv.trim().split('\n').filter(l => l.trim());
  if (lines.length <= 1) return null;
  return lines.slice(1).map(line => {
    const [, price, label] = line.split(',');
    return { price, label };
  });
}

// ── Bot ────────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`[discord-bot] Ready: ${client.user.tag}  |  Next.js: ${NEXT_BASE}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // /screenshot
  if (commandName === 'screenshot') {
    const pageKey = interaction.options.getString('page', true);
    try { await interaction.deferReply(); } catch { return; }
    try {
      const file = await takeScreenshot(pageKey);
      const label = pageKey.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
      await interaction.editReply({
        content: `📊 **${label}** — ${ts} CT`,
        files: [new AttachmentBuilder(file, { name: `${pageKey}.png` })],
      });
      fs.unlink(file, () => {});
    } catch (err) {
      console.error('[screenshot]', err.message);
      await interaction.editReply(`❌ Screenshot failed: ${err.message}`);
    }
  }

  // /gex
  if (commandName === 'gex') {
    try { await interaction.deferReply(); } catch { return; }
    try {
      const csv = await fetchGexCsv();
      const rows = parseGexCsv(csv);
      if (!rows) {
        await interaction.editReply('⚠️ No GEX levels saved yet. Set them from the dashboard first.');
        return;
      }
      const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
      const lines = rows.map(r => `**${r.label}**: ${r.price}`);
      await interaction.editReply([`📐 **GEX Levels** — ${ts} CT`, '', ...lines].join('\n'));
    } catch (err) {
      console.error('[gex]', err.message);
      await interaction.editReply(`❌ Failed to fetch GEX: ${err.message}`);
    }
  }

  // /snapshot
  if (commandName === 'snapshot') {
    try { await interaction.deferReply(); } catch { return; }
    try {
      const [file, csv] = await Promise.all([
        takeScreenshot('gex-chart'),
        fetchGexCsv().catch(() => ''),
      ]);
      const rows = csv ? parseGexCsv(csv) : null;
      const gexText = rows ? '\n' + rows.map(r => `**${r.label}**: ${r.price}`).join('\n') : '';
      const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
      await interaction.editReply({
        content: `📊 **GEX Snapshot** — ${ts} CT${gexText}`,
        files: [new AttachmentBuilder(file, { name: 'gex-snapshot.png' })],
      });
      fs.unlink(file, () => {});
    } catch (err) {
      console.error('[snapshot]', err.message);
      await interaction.editReply(`❌ Snapshot failed: ${err.message}`);
    }
  }
});

client.login(BOT_TOKEN);
