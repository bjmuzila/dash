'use strict';
/**
 * server-v2/strategy-generator.js
 *
 * Once-a-day (08:20 ET, Mon–Fri) full trade strategy for the Analytics
 * strategy-builder card. Gathers the live inputs that back the Analytics cards
 * (net greeks, EM levels, ES gap, economic calendar, confidence score, peak
 * greeks, pre-market read), hands the consolidated block to the Anthropic
 * Messages API, and writes the structured plan to daily_strategy via
 * POST /api/strategy.
 *
 * Output contract — Claude returns a single JSON object:
 *   {
 *     "bias": "long" | "short" | "neutral",
 *     "headline": "<one-line read>",
 *     "summary": "<2-3 sentence narrative>",
 *     "levels": [ { "label": "...", "price": "...", "note": "long above / short below ..." } ],
 *     "idea": { "direction": "long"|"short", "entry": "...", "stop": "...", "target": "...", "rationale": "..." },
 *     "triggers": [ "<confirmation 1>", "<confirmation 2>", "<confirmation 3>" ],
 *     "risk": "<one-line risk/invalidation note>"
 *   }
 *
 * Env: ANTHROPIC_API_KEY (required), INTERNAL_API_TOKEN (server-to-server auth).
 *
 * Start from server-with-proxy.js after server.listen():
 *   require('./strategy-generator').startStrategyGenerator(PORT);
 */

const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM = `You are the head strategist for CB Edge, an SPX gamma-exposure (GEX) and options-flow desk. You are given a consolidated morning snapshot of dealer positioning, expected-move levels, the ES overnight gap, key reference levels, the day's economic calendar, and the model confidence score. Build ONE concrete daily trade strategy for SPX/ES from it.

VOICE & DISCIPLINE
- Trader-to-trader. The reader knows gamma, dealer hedging, call/put walls, expected move, initial balance. Do not explain basics.
- Level-driven and conditional. Frame everything as structure ("long above X toward Y, short below Z"), never as a guaranteed call.
- Cite the actual numbers you are given. Do not invent levels that aren't in the snapshot.
- Structure, not prediction. Never financial advice or certain price targets.

OUTPUT — return ONLY a single JSON object, no markdown, no code fences, with EXACTLY this shape:
{
  "bias": "long" | "short" | "neutral",
  "headline": "one tight sentence summarizing the day's lean",
  "summary": "2-3 sentence narrative tying the positioning + levels + catalysts together",
  "levels": [ { "label": "short name", "price": "the level", "note": "what it means / how to trade around it" } ],
  "idea": { "direction": "long" | "short", "entry": "level or condition", "stop": "level", "target": "level", "rationale": "one sentence" },
  "triggers": [ "confirmation 1", "confirmation 2", "confirmation 3" ],
  "risk": "one-line invalidation / what kills this plan"
}
Provide 3-5 levels and exactly 3 triggers. Keep every string tight.`;

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

const num = (v, d = 2) =>
  v == null || !Number.isFinite(Number(v)) ? 'n/a'
    : Number(v).toLocaleString('en-US', { maximumFractionDigits: d });

// Fetch a same-server internal JSON endpoint, swallowing errors to null so a
// single dead feed never aborts the whole strategy run.
async function getJson(base, path) {
  try {
    const r = await fetch(`${base}${path}`, { cache: 'no-store', headers: internalHeaders() });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Build the labeled snapshot block the model reasons over. Each source is
// best-effort; missing feeds render as "n/a" rather than failing the run.
async function buildSnapshot(base, today) {
  const [greeks, emSpx, gap, cal, conf] = await Promise.all([
    getJson(base, `/api/snapshots/greeks?date=${today}&limit=1`),
    getJson(base, `/api/levels?ticker=SPX`),
    getJson(base, `/api/es-gap?date=${today}`),
    getJson(base, `/api/calendar`),
    getJson(base, `/api/confidence?date=${today}`),
  ]);

  const g = greeks?.rows?.[greeks.rows.length - 1] ?? greeks?.rows?.[0] ?? null;
  const em = emSpx || {};
  const ga = gap?.gap || {};
  const events = Array.isArray(cal?.events) ? cal.events : Array.isArray(cal) ? cal : [];
  const todays = events
    .filter((e) => e.date === today && String(e.country || '').toUpperCase() === 'USD')
    .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
    .slice(0, 8)
    .map((e) => `  - ${e.time_formatted || e.time || '—'} ${e.title}${e.impact ? ` [${e.impact}]` : ''}`)
    .join('\n') || '  - none scheduled';

  const score = conf?.score?.hit != null ? Math.round(conf.score.hit) : null;

  return [
    `CB Edge — SPX morning strategy snapshot for ${today} (US Eastern).`,
    ``,
    `NET GREEKS (latest snapshot):`,
    `  Net GEX: ${g ? `${g.gex >= 0 ? '+' : ''}${num(g.gex)}B` : 'n/a'}`,
    `  Net DEX: ${g ? `${g.dex >= 0 ? '+' : ''}${num(g.dex)}B` : 'n/a'}`,
    `  Net CHEX: ${g ? `${num(g.chex)}M` : 'n/a'}  Net VEX: ${g ? `${num(g.vex)}M` : 'n/a'}`,
    ``,
    `EXPECTED MOVE (SPX weekly):`,
    `  EM Up: ${num(em.up)}  EM Down: ${num(em.down)}  Weekly close basis: ${num(em.close)}`,
    ``,
    `ES OVERNIGHT GAP:`,
    `  Prior RTH close: ${num(ga.prior_close)}  09:30 open: ${num(ga.open_0930)}`,
    `  Gap: ${ga.gap_pts != null ? `${ga.gap_pts >= 0 ? '+' : ''}${num(ga.gap_pts)} pts (${ga.gap_dir || '—'})` : 'n/a'}`,
    `  Filled: ${ga.pct_filled != null ? `${num(ga.pct_filled)}%` : 'n/a'}`,
    ``,
    `CONFIDENCE SCORE (model): ${score != null ? `${score}/100 hit` : 'n/a'}  Current CB level: ${num(conf?.level)}  SPX: ${num(conf?.price ?? conf?.spx)}`,
    ``,
    `ECONOMIC CALENDAR (today, USD):`,
    todays,
    ``,
    `Build the daily SPX/ES strategy from this snapshot. Return the JSON object only.`,
  ].join('\n');
}

function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

async function generate(base) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.warn('[strategy] ANTHROPIC_API_KEY not set — skipping'); return; }
  const today = etDateStr();

  const userMessage = await buildSnapshot(base, today);

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
        max_tokens: 1800,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMessage }],
      }),
      cache: 'no-store',
    });
  } catch (e) {
    console.warn('[strategy] anthropic request failed:', e.message); return;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.warn(`[strategy] anthropic ${res.status}: ${detail.slice(0, 300)}`); return;
  }

  const json = await res.json();
  const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const plan = extractJson(text);
  if (!plan || !plan.summary) {
    console.warn('[strategy] could not parse model JSON — not writing. Head:', text.slice(0, 200));
    return;
  }

  try {
    const post = await fetch(`${base}/api/strategy`, {
      method: 'POST',
      headers: internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ date: today, plan }),
    });
    if (!post.ok) { console.warn('[strategy] save failed:', post.status); return; }
    console.log(`[strategy] ${today} written — bias=${plan.bias || '?'}`);
  } catch (e) {
    console.warn('[strategy] save error:', e.message);
  }
}

/**
 * Begin the loop. Checks every few minutes; fires once per clock hour on
 * weekdays (the row is keyed by date, so each hourly run overwrites the day's
 * plan with a fresh read). Gated to RTH-relevant hours (07:00–16:59 ET) so we
 * don't burn the API overnight; widen the window below if you want 24h.
 */
function startStrategyGenerator(port) {
  const base = `http://localhost:${port}`;
  let lastRunHour = null; // `${date}:${hour}` of the last generation
  const CHECK_MS = 3 * 60 * 1000;
  const START_HOUR = 7;  // first hourly run (ET)
  const END_HOUR = 16;   // last hourly run (ET), inclusive

  async function check() {
    const { hour, weekday } = nowParts();
    if (weekday === 'Sat' || weekday === 'Sun') return;
    if (hour < START_HOUR || hour > END_HOUR) return;
    const today = etDateStr();
    const slot = `${today}:${hour}`;
    if (lastRunHour === slot) return; // already ran this hour

    lastRunHour = slot;
    await generate(base);
  }

  console.log('[strategy] enabled — regenerates the daily strategy hourly on the hour (weekdays, ~07:00–16:00 ET)');
  setTimeout(() => { void check(); }, 45_000); // startup catch-up probe
  setInterval(() => { void check(); }, CHECK_MS);
}

module.exports = { startStrategyGenerator, generate };
