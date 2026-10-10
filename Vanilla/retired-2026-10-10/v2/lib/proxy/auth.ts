import * as fs from 'fs';
import { CONFIG, accessToken, refreshToken, tokenExpiry, setTokens } from './config';

export async function ensureToken(): Promise<boolean> {
  if (accessToken && Date.now() < tokenExpiry) {
    return true;
  }

  // Try to load from file
  if (fs.existsSync(CONFIG.TOKEN_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG.TOKEN_FILE, 'utf-8'));
      if (data.accessToken && data.expiry && Date.now() < data.expiry) {
        setTokens(data.accessToken, data.refreshToken, data.expiry);
        return true;
      }
    } catch (e) {
      console.error('[AUTH] Failed to load token from file:', e);
    }
  }

  // Try to refresh
  return await refreshAccessToken();
}

export async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken && !CONFIG.REFRESH_ENV) {
    console.warn('[AUTH] No refresh token available');
    return false;
  }

  const token = refreshToken || CONFIG.REFRESH_ENV;
  try {
    const res = await fetch('https://api.tastyworks.com/sessions/validate', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) {
      console.error('[AUTH] Token refresh failed:', res.status);
      return false;
    }

    const data = await res.json();
    const newAccessToken = data.data?.session?.token;
    if (!newAccessToken) {
      console.error('[AUTH] No token in response');
      return false;
    }

    const expiry = Date.now() + (data.data?.session?.remember_me_days || 1) * 24 * 60 * 60 * 1000;
    setTokens(newAccessToken, token, expiry);

    // Save to file
    try {
      fs.writeFileSync(CONFIG.TOKEN_FILE, JSON.stringify({ accessToken: newAccessToken, refreshToken: token, expiry }, null, 2));
    } catch (e) {
      console.warn('[AUTH] Failed to save token:', e);
    }

    return true;
  } catch (e) {
    console.error('[AUTH] Token refresh error:', e);
    return false;
  }
}

export async function ttFetch(path: string, options: RequestInit = {}) {
  const token = accessToken;
  if (!token) throw new Error('No access token');

  const url = new URL(path, 'https://api.tastyworks.com');
  const res = await fetch(url.toString(), {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 401) {
    // Token expired, try to refresh
    const refreshed = await refreshAccessToken();
    if (!refreshed) throw new Error('Token refresh failed');

    // Retry with new token
    return ttFetch(path, options);
  }

  return res;
}
