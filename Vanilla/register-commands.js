/**
 * register-commands.js — Run once to register Discord slash commands
 *
 * Usage:
 *   node register-commands.js
 *
 * Set in .env:
 *   DISCORD_BOT_TOKEN   — bot token
 *   DISCORD_APP_ID      — application (client) ID
 *   DISCORD_GUILD_ID    — (optional) guild ID for instant guild registration
 *                         Omit to register globally (takes up to 1 hour to propagate)
 */

'use strict';

require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const APP_ID    = process.env.DISCORD_APP_ID;
const GUILD_ID  = process.env.DISCORD_GUILD_ID;

if (!BOT_TOKEN || !APP_ID) {
  console.error('ERROR: Set DISCORD_BOT_TOKEN and DISCORD_APP_ID in .env');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('screenshot')
    .setDescription('Take a screenshot of a dashboard page and post it')
    .addStringOption(opt =>
      opt.setName('page')
        .setDescription('Which page to screenshot')
        .setRequired(true)
        .addChoices(
          { name: 'Overview',            value: 'overview' },
          { name: 'GEX Dashboard',       value: 'gex-dashboard' },
          { name: 'GEX Live',            value: 'gex-live' },
          { name: 'Estimated Moves',     value: 'estimated-moves' },
          { name: 'Market Indicators',   value: 'market-indicators' },
          { name: 'Insights',            value: 'insights' },
          { name: 'Options Chain',       value: 'options-chain' },
          { name: 'Exposure',            value: 'exposure' },
          { name: 'Index',               value: 'index' },
        )
    ),

  new SlashCommandBuilder()
    .setName('gex')
    .setDescription('Show current GEX levels (Call Wall, Put Wall, Zero Gamma)'),

  new SlashCommandBuilder()
    .setName('snapshot')
    .setDescription('GEX Dashboard screenshot + current GEX level text in one post'),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

(async () => {
  try {
    if (GUILD_ID) {
      console.log(`Registering ${commands.length} commands to guild ${GUILD_ID}...`);
      await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: commands });
      console.log('✅ Guild commands registered (instant).');
    } else {
      console.log(`Registering ${commands.length} commands globally...`);
      await rest.put(Routes.applicationCommands(APP_ID), { body: commands });
      console.log('✅ Global commands registered (propagates in up to 1 hour).');
    }
  } catch (err) {
    console.error('ERROR:', err.message);
  }
})();
