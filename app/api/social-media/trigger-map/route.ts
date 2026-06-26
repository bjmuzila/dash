import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/social-media/trigger-map — turns the SPX GEX read into a Bull / Base /
 * Bear "trigger map" for the Explainer card. Calls the Anthropic Messages API
 * (claude-sonnet-4-6) and asks for strict JSON: three cases, each with a name,
 * odds %, and a short level-driven description. Output is parsed defensively
 * (code fences stripped, first balanced JSON object extracted).
 *
 * Env: ANTHROPIC_API_KEY.
 */

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are the desk analyst for CB Edge, an SPX gamma-exposure (GEX) and options-flow desk. From a pre-market dealer-positioning read you produce a "trigger map": three scenarios for the session — a bull case, a base case, and a bear case — that a trader can react to off the levels.

VOICE & RULES
- Sharp, trader-to-trader. The reader knows gamma, dealer hedging, call/put walls, gamma flip and expected move. Do not explain basics.
- Concrete and level-driven. Each case must reference the actual numbers given (spot, flip, walls, EM range) and describe a TRIGGER condition (e.g. "accepts above the flip on volume", "loses the put wall on two 5-min closes") plus what dealer positioning implies if it happens.
- Conditional, never promissory. No certainties, no explicit buy/sell advice, no price targets stated as facts.
- The three odds percentages must be whole numbers that sum to exactly 100, and should reflect the regime and where spot sits relative to the flip/walls.
- Keep each description to 1-2 sentences, under ~200 characters.

OUTPUT FORMAT
Return ONLY a single JSON object — no markdown, no code fences, no commentary — with exactly these keys:
{
  "bull": { "odds": number, "desc": string },
  "base": { "odds": number, "desc": string },
  "bear": { "odds": number, "desc": string }
}

Output a SINGLE object with bull/base/bear as keys. Do NOT wrap them in an array and do NOT separate them with "},{". There is exactly one top-level object and one closing brace.`;

interface TriggerInput {
  spxSpot?: number | null;
  gammaFlip?: number | null;
  callWall?: number | null;
  putWall?: number | null;
  controlNode?: number | null;
  expectedMove?: number | null;
  emUpper?: number | null;
  emLower?: number | null;
  netGex?: number | null;
  gammaRegime?: string | null;
  bias?: string | null;
  date?: string | null;
}

interface TriggerCase { odds: number; desc: string }
interface TriggerMap { bull: TriggerCase; base: TriggerCase; bear: TriggerCase }

function num(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function formatUserMessage(d: TriggerInput): string {
  return [
    `CB Edge — SPX pre-market GEX read${d.date ? ` for ${d.date}` : ""}.`,
    ``,
    `SPX spot: ${num(d.spxSpot)}`,
    `Gamma flip: ${num(d.gammaFlip)}`,
    `Call wall (resistance): ${num(d.callWall)}`,
    `Put wall (support): ${num(d.putWall)}`,
    `Control node (peak gamma magnet): ${num(d.controlNode)}`,
    `Expected move: ±${num(d.expectedMove)}`,
    `Expected-move range: ${num(d.emLower)} (lower) to ${num(d.emUpper)} (upper)`,
    `Net GEX: ${d.netGex == null ? "n/a" : `${d.netGex >= 0 ? "+" : ""}${num(d.netGex, 2)}B`}`,
    `Gamma regime: ${d.gammaRegime || "n/a"}`,
    `Bias: ${d.bias || "neutral"}`,
    ``,
    `Produce the bull / base / bear trigger map from this read. Return the JSON object only.`,
  ].join("\n");
}

function clampCase(o: unknown): TriggerCase | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const odds = Number(r.odds);
  const desc = typeof r.desc === "string" ? r.desc : "";
  if (!desc) return null;
  return { odds: Number.isFinite(odds) ? Math.round(odds) : 0, desc };
}

// Extract the balanced object that begins at `from` (which must point at a "{").
function balancedObjectAt(text: string, from: number): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(from, i + 1);
  }
  return null;
}

// Fallback for when the model emits the three cases as separate/array-wrapped
// objects (e.g. {"bull":{...}},{"base":{...}},{"bear":{...}}]) instead of one
// object. Find each "key": {...} and parse its object independently.
function recoverByKey(text: string): TriggerMap | null {
  const out: Partial<Record<"bull" | "base" | "bear", TriggerCase>> = {};
  for (const key of ["bull", "base", "bear"] as const) {
    const k = text.indexOf(`"${key}"`);
    if (k === -1) return null;
    const brace = text.indexOf("{", k);
    if (brace === -1) return null;
    const objStr = balancedObjectAt(text, brace);
    if (!objStr) return null;
    try {
      const c = clampCase(JSON.parse(objStr));
      if (!c) return null;
      out[key] = c;
    } catch {
      return null;
    }
  }
  const { bull, base, bear } = out;
  if (!bull || !base || !bear) return null;
  const sum = bull.odds + base.odds + bear.odds;
  if (sum > 0 && sum !== 100) {
    bull.odds = Math.round((bull.odds / sum) * 100);
    base.odds = Math.round((base.odds / sum) * 100);
    bear.odds = 100 - bull.odds - base.odds;
  }
  return { bull, base, bear };
}

// First balanced JSON object out of arbitrary model text (handles ```json fences
// and surrounding prose). Falls back to per-key recovery on malformed shapes.
function extractJson(raw: string): TriggerMap | null {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      if (--depth === 0) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
          const bull = clampCase(obj.bull);
          const base = clampCase(obj.base);
          const bear = clampCase(obj.bear);
          if (!bull || !base || !bear) return recoverByKey(text);
          // Normalize odds to sum to 100 if the model drifted.
          const sum = bull.odds + base.odds + bear.odds;
          if (sum > 0 && sum !== 100) {
            bull.odds = Math.round((bull.odds / sum) * 100);
            base.odds = Math.round((base.odds / sum) * 100);
            bear.odds = 100 - bull.odds - base.odds;
          }
          return { bull, base, bear };
        } catch {
          return recoverByKey(text);
        }
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });
  }

  let input: TriggerInput;
  try {
    input = (await req.json()) as TriggerInput;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: formatUserMessage(input) }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) {
    console.error("[trigger-map] anthropic request failed", String((err as Error)?.message || err));
    return NextResponse.json(
      { error: `anthropic request failed: ${String((err as Error)?.message || err)}` },
      { status: 502 }
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[trigger-map] anthropic error", res.status, detail.slice(0, 500));
    return NextResponse.json({ error: `anthropic ${res.status}`, detail: detail.slice(0, 500) }, { status: 502 });
  }

  const payload = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  const text = (payload.content ?? [])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();

  const parsed = extractJson(text);
  if (!parsed) {
    console.error("[trigger-map] unparseable model output", text.slice(0, 800));
    return NextResponse.json({ error: "model returned unparseable output", raw: text.slice(0, 800) }, { status: 502 });
  }

  return NextResponse.json(
    { data: parsed },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
