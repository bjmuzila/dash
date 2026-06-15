import * as path from 'path';

export const CONFIG = {
  PORT: parseInt(process.env.PORT || '3002', 10),
  TOKEN_FILE: path.join(process.cwd(), 'tastytrade_token.json'),
  SCHWAB_TOKEN_FILE: path.join(process.cwd(), '.schwab_tokens.json'),
  BACKUP_DIR: path.join(process.cwd(), 'data'),
  DB_FILE: path.join(process.cwd(), 'data', 'trading.db'),
  BUY_SELL_BACKUP_FILE: path.join(process.cwd(), 'data', 'buy-sell-scores.json'),
  DAILY_CLOSES_FILE: path.join(process.cwd(), 'data', 'daily-closes.json'),
  REFRESH_ENV: process.env.REFRESH_TOKEN || '',
  CLIENT_SECRET: process.env.CLIENT_SECRET || '',
  SCHWAB_CLIENT_ID: process.env.SCHWAB_CLIENT_ID || 'REDACTED',
  SCHWAB_CLIENT_SECRET: process.env.SCHWAB_CLIENT_SECRET || 'REDACTED',
  SCHWAB_BASE: 'api.schwabapi.com',
  DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1466249857122570454/REDACTED',
  GOOGLE_TOKEN_FILE: path.join(process.cwd(), 'google_token.json'),
  GOOGLE_CREDENTIALS_FILE: path.join(process.cwd(), 'google_credentials.json'),
  GOOGLE_SCOPES: 'https://www.googleapis.com/auth/spreadsheets',
  CHAIN_CACHE_TTL_MS: 3600000,
  CHAIN_CACHE_TTL_DEFAULT_MS: 600000,
};

export let accessToken: string | null = null;
export let refreshToken: string | null = null;
export let tokenExpiry = 0;
export let schwabAccessToken: string | null = null;
export let schwabRefreshToken: string | null = null;
export let schwabTokenExpiry = 0;

export function setTokens(access: string | null, refresh: string | null, expiry: number) {
  accessToken = access;
  refreshToken = refresh;
  tokenExpiry = expiry;
}

export function setSchwabTokens(access: string | null, refresh: string | null, expiry: number) {
  schwabAccessToken = access;
  schwabRefreshToken = refresh;
  schwabTokenExpiry = expiry;
}
