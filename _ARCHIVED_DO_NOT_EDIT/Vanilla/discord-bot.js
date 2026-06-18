/**
 * discord-bot.js — Discord slash command bot for SPX GEX Dashboard
 *
 * Slash commands:
 *   /screenshot <page>  — take a screenshot of a dashboard page and post it
 *   /gex                — post current GEX levels as text
 *
 * Run:  node discord-bot.js
 * Register commands first: node register-commands.js
 *
 * Required env vars (add to .env):
 *   DISCORD_BOT_TOKEN      — bot token from Discord Developer Portal
 *   DISCORD_APP_ID         — application ID from Discord Developer Portal
 *   DISCORD_GUILD_ID       — (optional) guild ID for instant registration during dev
 *   DASHBOARD_PORT         — port the dashboard server runs on (default: 3001)
 */

'use strict';

require('dotenv').config();

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ── Config ─────────────────────────────────────────────────────────────────
const BOT_TOKEN   = process.env.DISCORD_BOT_TOKEN;
const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT || '3001', 10);
const BASE_URL    = `http://localhost:${DASHBOARD_PORT}`;

if (!BOT_TOKEN) {
  console.error('[discord-bot] ERROR: DISCORD_BOT_TOKEN not set in .env');
  process.exit(1);
}

// ── Page map: command choice value → relative URL path ────────────────────
const PAGES = {
  'overview':      '/overview.html',
  'gex-dashboard': '/spx-gex-dashboard.html',
  'gex-live':      '/spx-gex-live.html',
  'estimated-moves': '/estimated_moves.html',
  'market-indicators': '/dxfeed_market_indicators_dashboard.html',
  'insights':      '/pages/insights/insights.html',
  'options-chain': '/pages/insights/options-chain/options-chain.html',
  'exposure':      '/pages/insights/exposure/exposure.html',
  'index':         '/index.html',
};

// ── Screenshot helper ──────────────────────────────────────────────────────
async function takeScreenshot(pageKey, waitMs = 4000) {
  const urlPath = PAGES[pageKey];
  if (!urlPath) throw new Error(`Unknown page: ${pageKey}`);

  const url = BASE_URL + urlPath;
  console.log(`[screenshot] Launching puppeteer for ${url}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Suppress console noise from the dashboard
    page.on('console', () => {});

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Extra wait for charts/websocket data to render
    await new Promise(r => setTimeout(r, waitMs));

    const screenshotPath = path.join(__dirname, `_discord_snapshot_${pageKey}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    return screenshotPath;
  } finally {
    await browser.close();
  }
}

// ── GEX text summary from local API ───────────────────────────────────────
function fetchGexCsv() {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}/proxy/api/gex-levels`, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseCsvToEmbed(csv) {
  const lines = csv.trim().split('\n').filter(l => l.trim());
  if (lines.length <= 1) return null; // header only — no levels saved yet

  const rows = lines.slice(1).map(line => {
    const [symbol, price, label] = line.split(',');
    return { symbol, price, label };
  });

  return rows;
}

// ── Discord client ─────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`[discord-bot] Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ── /screenshot ──────────────────────────────────────────────────────────
  if (commandName === 'screenshot') {
    const pageKey = interaction.options.getString('page', true);

    await interaction.deferReply();

    try {
      const screenshotPath = await takeScreenshot(pageKey);
      const attachment = new AttachmentBuilder(screenshotPath, { name: `${pageKey}.png` });

      await interaction.editReply({
        content: `📊 **${pageKey}** — ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT`,
        files: [attachment],
      });

      // Clean up temp file
      fs.unlink(screenshotPath, () => {});
    } catch (err) {
      console.error('[screenshot] Error:', err.message);
      await interaction.editReply(`❌ Screenshot failed: ${err.message}`);
    }
  }

  // ── /gex ────────────────────────────────────────────────────────────────
  if (commandName === 'gex') {
    await interaction.deferReply();

    try {
      const csv = await fetchGexCsv();
      const rows = parseCsvToEmbed(csv);

      if (!rows || rows.length === 0) {
        await interaction.editReply('⚠️ No GEX levels saved yet. Set levels from the dashboard first.');
        return;
      }

      const lines = rows.map(r => `**${r.label}**: ${r.price}`);
      const content = [
        `📐 **GEX Levels** — ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT`,
        '',
        ...lines,
      ].join('\n');

      await interaction.editReply(content);
    } catch (err) {
      console.error('[gex] Error:', err.message);
      await interaction.editReply(`❌ Failed to fetch GEX levels: ${err.message}`);
    }
  }

  // ── /snapshot (screenshot of gex-dashboard + gex text) ──────────────────
  if (commandName === 'snapshot') {
    await interaction.deferReply();

    try {
      // Fetch both in parallel
      const [screenshotPath, csv] = await Promise.all([
        takeScreenshot('gex-dashboard', 5000),
        fetchGexCsv().catch(() => ''),
      ]);

      const rows = csv ? parseCsvToEmbed(csv) : null;
      const gexText = rows && rows.length > 0
        ? '\n' + rows.map(r => `**${r.label}**: ${r.price}`).join('\n')
        : '';

      const attachment = new AttachmentBuilder(screenshotPath, { name: 'gex-snapshot.png' });

      await interaction.editReply({
        content: `📊 **GEX Snapshot** — ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT${gexText}`,
        files: [attachment],
      });

      fs.unlink(screenshotPath, () => {});
    } catch (err) {
      console.error('[snapshot] Error:', err.message);
      await interaction.editReply(`❌ Snapshot failed: ${err.message}`);
    }
  }
});

client.login(BOT_TOKEN);
