'use strict';
/**
 * server-v2/overview-generator.js
 *
 * Once-a-day (07:00 ET, Mon–Fri) overnight-market overview for the Traders
 * Dashboard. Calls the Anthropic Messages API with the built-in `web_search`
 * tool so Claude actually researches what moved markets overnight, then writes
 * the result to td_overview via POST /api/traders-dashboard/overview.
 *
 * Output contract — Claude returns a single JSON object:
 *   { "summary": "<2-3 sentence narrative>",
 *     "drivers": [ { "when": "...", "title": "...", "body": "..." }, ... ] }  // 3-4 items
 *
 * Env: ANTHROPIC_API_KEY (required), INTERNAL_API_TOKEN (server-to-server auth).
 *
 * Start from server-with-proxy.js after server.listen():
 *   require('./overview-generator').startOverviewGenerator(PORT);
 */

const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function internalHeaders(extra = {}) {
  return Object.assign({}, extra,
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {});
}

function nowParts() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

function etDateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((p) => p.type !== 'literal')
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const SYSTEM = [
  'You are a markets desk analyst writing the pre-open overnight briefing for an',
  'experienced equity-index trader. Use web search to find what actually happened',
  'in global markets overnight and in early US pre-market today, and what is driving',
  'prices. Focus on: overnight equity-index futures (ES/NQ/YM), major overseas moves',
  '(Europe/Asia), rates, the dollar, oil/gold, and the key catalysts (earnings, econ',
  'data, geopolitics, Fed). Be concrete and current — cite real figures and events',
  'from your searches, not generic boilerplate.',
  '',
  'Return ONLY a single JSON object, no prose around it, with this exact shape:',
  '{"summary":"2-3 sentence narrative of overnight sentiment and what is moving prices",',
  '"drivers":[{"when":"Ongoing|Before Open|After Close|This Week","title":"short headline","body":"one sentence why it matters"}]}',
  'Provide 3-4 drivers, ordered by importance.',
].join(' ');

function extractJson(text) {
  if (!text) return null;
  // Strip code fences and grab the outermost {...}.
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

async function fetchTopMovers() {
  try {
    const HEADERS = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Origin': 'https://finance.yahoo.com',
      'Referer': 'https://finance.yahoo.com/',
    };
    const FIELDS = 'symbol,shortName,regularMarketPrice,regularMarketChange,regularMarketChangePercent,preMarketPrice,preMarketChangePercent,regularMarketVolume';
    const trendRes = await fetch(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=trending&count=10&fields=${FIELDS}`, { headers: HEADERS });
    if (!trendRes.ok) return [];
    const td = await trendRes.json().catch(() => ({}));
    const allQuotes = td?.finance?.result?.[0]?.quotes ?? td?.finance?.result?.[0]?.results ?? [];
    return allQuotes.slice(0, 10).map((q) => ({
        symbol: String(q.symbol ?? ''),
        name: String(q.shortName ?? q.longName ?? q.symbol ?? ''),
        price: typeof q.regularMarketPrice === 'number' ? q.regularMarketPrice : null,
        pct: typeof q.regularMarketChangePercent === 'number' ? q.regularMarketChangePercent : null,
        preMarketPrice: typeof q.preMarketPrice === 'number' ? q.preMarketPrice : null,
        preMarketPct: typeof q.preMarketChangePercent === 'number' ? q.preMarketChangePercent : null,
      }));
  } catch (e) {
    console.warn('[overview] movers fetch failed:', e.message);
    return [];
  }
}

async function generate(base) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.warn('[overview] ANTHROPIC_API_KEY not set — skipping'); return; }
  const today = etDateStr();

  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{
          role: 'user',
          content: `Research and write today's overnight market overview for ${today} (US Eastern). Search the web for the latest overnight and pre-market action, then return the JSON object.`,
        }],
      }),
      cache: 'no-store',
    });
  } catch (e) {
    console.warn('[overview] anthropic request failed:', e.message); return;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.warn(`[overview] anthropic ${res.status}: ${detail.slice(0, 300)}`); return;
  }

  const json = await res.json();
  // Concatenate all text blocks (web_search interleaves tool_use / tool_result).
  const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = extractJson(text);
  if (!parsed || !parsed.summary) {
    console.warn('[overview] could not parse model JSON — not writing. Raw head:', text.slice(0, 200));
    return;
  }

  const drivers = Array.isArray(parsed.drivers) ? parsed.drivers.slice(0, 4) : [];
  const movers = await fetchTopMovers();
  try {
    const post = await fetch(`${base}/api/traders-dashboard/overview`, {
      method: 'POST',
      headers: internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ date: today, summary: String(parsed.summary), drivers, movers }),
    });
    if (!post.ok) { console.warn('[overview] save failed:', post.status); return; }
    console.log(`[overview] ${today} written — ${drivers.length} drivers`);
  } catch (e) {
    console.warn('[overview] save error:', e.message);
  }
}

/**
 * Begin the loop. Checks every 10 minutes; fires once when the ET clock first
 * reaches 07:00–07:09 on a weekday and today hasn't been generated yet.
 */
function startOverviewGenerator(port) {
  const base = `http://localhost:${port}`;
  let lastRunDate = null;
  const CHECK_MS = 10 * 60 * 1000;

  async function check() {
    const { hour, minute, weekday } = nowParts();
    if (weekday === 'Sat' || weekday === 'Sun') return;
    const today = etDateStr();
    if (lastRunDate === today) return;
    // Fire in the 07:00–07:09 window. If the box was asleep at 7, a later boot
    // still catches up: generate any time at/after 7am that today is unwritten.
    if (hour < 7) return;

    // Don't overwrite an existing row (e.g. after a restart) unless it's a new day.
    try {
      const r = await fetch(`${base}/api/traders-dashboard/overview?date=${today}`,
        { cache: 'no-store', headers: internalHeaders() });
      if (r.ok) {
        const j = await r.json();
        if (j.overview && j.overview.date === today) { lastRunDate = today; return; }
      }
    } catch { /* fall through and generate */ }

    lastRunDate = today;
    await generate(base);
  }

  console.log('[overview] enabled — generates the overnight briefing daily at ~07:00 ET (weekdays)');
  setTimeout(() => { void check(); }, 30_000); // startup catch-up probe
  setInterval(() => { void check(); }, CHECK_MS);
}

module.exports = { startOverviewGenerator, generate };
