const API_BASE = window.API_BASE || '';

function toQuery(params = {}) {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    usp.set(key, value);
  }
  return usp.toString();
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: 'no-store',
    ...options
  });
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

const API = {
  async getSpxCore() {
    return requestJson('/proxy/api/spx-core');
  },

  async getSpxPrevClose() {
    return requestJson('/proxy/api/spx-prevclose');
  },

  async getSpxChain(expiration, type = 'both') {
    const query = toQuery({ expiration, type });
    return requestJson(`/proxy/api/spx-chain?${query}`);
  },

  async subscribeAdditional(symbols) {
    return requestJson('/proxy/api/subscribe-additional', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols })
    });
  },

  async getQuotes(symbols) {
    const query = toQuery({ symbols: Array.isArray(symbols) ? symbols.join(',') : symbols });
    return requestJson(`/proxy/api/tt/quotes-batch?${query}`);
  },

  async getGexLevels() {
    return requestJson('/proxy/api/gex-levels');
  }
};

window.API = API;
window.API_BASE = API_BASE;
