'use strict';
/**
 * server-v2/premarket-summary-generator.js
 *
 * Daily pre-open 5-bullet read of the global overnight tape for the Analytics
 * page's Premarket card. Fetches Yahoo quotes for the same markets the
 * /premarket page shows, computes the SPX gap-to-open + fair value, asks the
 * Anthropic Messages API (claude-sonnet-4-6) for exactly 5 bullets, and writes
 * them to premarket_summary via POST /api/premarket-summary.
 *
 * Mirrors overview-generator.js. Env: ANTHROPIC_API_KEY, INTERNAL_API_TOKEN.
 *
 * Wire from server-with-proxy.js after server.listen():
 *   require('./premarket-summary-generator').startPremarketSummaryGenerator(PORT);
 */

const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const MARKETS = [
  { sym: '^GSPC', label: 'S&P 500 cash (prior close)' },
  { sym: 'ES=F', label: 'S&P 500 fut' },
  { sym: 'NQ=F', label: 'Nasdaq 100 fut' },
  { sym: 'RTY=F', label: 'Russell 2000 fut' },
  { sym: 'YM=F', label: 'Dow fut' },
  { sym: '^VIX', label: 'VIX' },
  { sym: '^GDAXI', label: 'German DAX' },
  { sym: '^STOXX50E', label: 'Euro Stoxx 50' },
  { sym: '^FTSE', label: 'FTSE 100' },
  { sym: '^N225', label: 'Nikkei 225' },
  { sym: '^HSI', label: 'Hang Seng' },
  { sym: 'CL=F', label: 'Crude oil' },
  { sym: 'GC=F', label: 'Gold' },
  { sym: 'NG=F', label: 'Natural gas' },
  { sym: 'ZN=F', label: '10Y note fut' },
  { sym: 'ZB=F', label: '30Y bond fut' },
  { sym: 'DX-Y.NYB', label: 'US Dollar Idx' },
  { sym: 'BTC-USD', label: 'Bitcoin' },
];

const SYSTEM = `You are the pre-market desk analyst for CB Edge, an SPX gamma/options-flow desk. Given a snapshot of overnight global markets plus the computed SPX gap-to-open and fair value, write a tight pre-market read.

RULES
- Output EXACTLY 5 bullet points. No preamble, no heading, no closing line.
- Each bullet starts with a short lead-in phrase + colon, then one sentence. Match this style/length:
  * "Bearish Market Open: Overnight sentiment is deeply bearish, with the S&P 500 expected to gap down 1.85% (139.50 points) to open near its calculated fair value of 7,354.02."
  * "Tech and Asia Plunging: The Nasdaq 100 is taking a massive 4.19% hit, mirroring sell-offs in Asia where the Hang Seng (-5.24%) and Nikkei 225 (-4.14%) are bleeding."
  * "Volatility Spiking: Fear is entering the market as VIX jumps 6.54%, while Treasury yields climb."
  * "Isolated Pockets of Green: Despite the carnage, the Dow (+0.17%) and FTSE 100 (+1.40%) show rare relative strength."
- Across the 5 bullets cover: (1) overall open lean using SPX gap %/points/fair value, (2) tech + Asia, (3) commodities, (4) volatility + rates/dollar, (5) pockets of strength/divergence. Cite the actual numbers given.
- Structure, not prediction. Never financial advice or certain price targets.
- Return ONLY a JSON object: { "bullets": string[] } with exactly 5 strings. No markdown, no code fences.`;

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

async function fetchYahoo(sym) {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d&includePrePost=true&_=${Date.now()}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
        Referer: 'https://finance.yahoo.com/',
      },
      cache: 'no-store',
    });
    if (!res.ok) return { price: null, pct: null };
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return { price: null, pct: null };
    const price = meta.regularMarketPrice ?? null;
    const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const pct = price != null && prev ? ((price - prev) / prev) * 100 : null;
    return { price, pct };
  } catch {
    return { price: null, pct: null };
  }
}

function fmtLine(label, q) {
  if (q.price == null) return `${label}: n/a`;
  const p = q.price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const pct = q.pct == null ? '' : ` (${q.pct >= 0 ? '+' : ''}${q.pct.toFixed(2)}%)`;
  return `${label}: ${p}${pct}`;
}

function extractBullets(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    if (Array.isArray(obj.bullets)) {
      const b = obj.bullets.filter((x) => typeof x === 'string');
      return b.length ? b.slice(0, 5) : null;
    }
  } catch { /* noop */ }
  return null;
}

async function generate(base) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.warn('[premarket-summary] ANTHROPIC_API_KEY not set — skipping'); return; }
  const today = etDateStr();

  const quotes = await Promise.all(MARKETS.map((m) => fetchYahoo(m.sym).then((q) => ({ ...m, q }))));
  const block = quotes.map(({ label, q }) => fmtLine(label, q)).join('\n');

  const spxClose = quotes.find((x) => x.sym === '^GSPC')?.q.price ?? null;
  const esPct = quotes.find((x) => x.sym === 'ES=F')?.q.pct ?? null;
  let gapLine = 'SPX gap-to-open: n/a';
  if (spxClose != null && esPct != null) {
    const gapPts = spxClose * (esPct / 100);
    const fv = spxClose + gapPts;
    gapLine =
      `SPX prior close: ${spxClose.toLocaleString('en-US', { maximumFractionDigits: 2 })}; ` +
      `projected gap (from ES ${esPct >= 0 ? '+' : ''}${esPct.toFixed(2)}%): ${gapPts >= 0 ? '+' : ''}${gapPts.toFixed(2)} pts; ` +
      `implied fair-value open: ${fv.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }

  const userMessage = `Global pre-market tape for ${today} (overnight / pre-US-open):\n\n${gapLine}\n\n${block}\n\nWrite the 5-bullet pre-market read. Return the JSON object only.`;

  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMessage }],
      }),
      cache: 'no-store',
    });
  } catch (e) {
    console.warn('[premarket-summary] anthropic request failed:', e.message); return;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.warn(`[premarket-summary] anthropic ${res.status}: ${detail.slice(0, 300)}`); return;
  }

  const json = await res.json();
  const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const bullets = extractBullets(text);
  if (!bullets) { console.warn('[premarket-summary] could not parse model JSON. Head:', text.slice(0, 200)); return; }

  try {
    const post = await fetch(`${base}/api/premarket-summary`, {
      method: 'POST',
      headers: internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ date: today, bullets }),
    });
    if (!post.ok) { console.warn('[premarket-summary] save failed:', post.status); return; }
    console.log(`[premarket-summary] ${today} written — ${bullets.length} bullets`);
  } catch (e) {
    console.warn('[premarket-summary] save error:', e.message);
  }
}

/**
 * Generates once per weekday in the 08:00–08:09 ET window (after Europe is open
 * and US pre-market is active, before the cash open). Catches up on a later boot.
 */
function startPremarketSummaryGenerator(port) {
  const base = `http://localhost:${port}`;
  let lastRunDate = null;
  const CHECK_MS = 10 * 60 * 1000;

  async function check() {
    const { hour, weekday } = nowParts();
    if (weekday === 'Sat' || weekday === 'Sun') return;
    const today = etDateStr();
    if (lastRunDate === today) return;
    if (hour < 8) return; // fire from 8am ET onward

    try {
      const r = await fetch(`${base}/api/premarket-summary?date=${today}`, { cache: 'no-store', headers: internalHeaders() });
      if (r.ok) {
        const j = await r.json();
        if (j.summary && j.summary.date === today) { lastRunDate = today; return; }
      }
    } catch { /* fall through */ }

    lastRunDate = today;
    await generate(base);
  }

  console.log('[premarket-summary] enabled — generates the pre-open 5-bullet read daily at ~08:00 ET (weekdays)');
  setTimeout(() => { void check(); }, 35_000);
  setInterval(() => { void check(); }, CHECK_MS);
}

module.exports = { startPremarketSummaryGenerator, generate };
