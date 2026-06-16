/**
 * register-commands.js — Run ONCE to register Discord slash commands
 *
 * Usage: node register-commands.js
 *
 * Set in .env.local:
 *   DISCORD_BOT_TOKEN   — bot token
 *   DISCORD_APP_ID      — application (client) ID
 *   DISCORD_GUILD_ID    — guild ID for instant registration (recommended for dev)
 *                         Omit for global registration (up to 1 hr propagation)
 */

'use strict';

require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const APP_ID    = process.env.DISCORD_APP_ID;
const GUILD_ID  = process.env.DISCORD_GUILD_ID;

if (!BOT_TOKEN || !APP_ID) {
  console.error('ERROR: Set DISCORD_BOT_TOKEN and DISCORD_APP_ID in .env.local');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('screenshot')
    .setDescription('Screenshot a dashboard page and post it to Discord')
    .addStringOption(opt =>
      opt.setName('page')
        .setDescription('Which page to capture')
        .setRequired(true)
        .addChoices(
          { name: 'GEX Chart',      value: 'gex-chart' },
          { name: 'Heatmap',        value: 'heatmap' },
          { name: 'Snapshot Flow',  value: 'snapshot-flow' },
          { name: 'SPX Flow',       value: 'spx-flow' },
          { name: 'MVC',            value: 'mvc' },
          { name: 'Exposure Stack', value: 'exposure-stack' },
          { name: 'Multi Greek',    value: 'multi-greek' },
        )
    ),

  new SlashCommandBuilder()
    .setName('gex')
    .setDescription('Show current GEX levels (Call Wall, Put Wall, Zero Gamma)'),

  new SlashCommandBuilder()
    .setName('snapshot')
    .setDescription('GEX Chart screenshot + GEX level text combined'),

].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

(async () => {
  try {
    console.log(`Registering ${commands.length} commands globally...`);
    await rest.put(Routes.applicationCommands(APP_ID), { body: commands });
    console.log('✅ Global commands registered (propagates in ~1 hour).');
  } catch (err) {
    console.error('ERROR:', err.message);
  }
})();
