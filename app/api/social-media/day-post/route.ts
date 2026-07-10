import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/social-media/day-post — slot-aware X post generator for the Day Posts
 * tab. One route covers the whole posting day: premarket analysis, midday
 * update, EOD summary, custom, plus an optional trade idea (ticker / strike /
 * C-P / expiration) folded into the tweet. Same Anthropic Messages call,
 * defensive-JSON parsing, and CB Edge voice as /api/social-media/generate.
 *
 * Env: ANTHROPIC_API_KEY.
 */

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are the social-media voice of CB Edge (cbedge.net), an SPX gamma-exposure (GEX) and options-flow desk. You write single X posts at different points of the trading day that turn the live dealer-positioning read into tight, useful market commentary while promoting CB Edge.

VOICE
- Sharp and trader-to-trader. The audience already knows gamma, dealer hedging, call/put walls and expected move. Do not explain basics.
- No hype. No "🚀 to the moon", no clickbait, no emoji spam. At most one tasteful emoji, usually zero.
- Concrete and level-driven. Quote the actual numbers provided (spot, flip, walls, EM, net GEX). Frame them as structure, not predictions.
- Confident but never promissory. Describe what positioning implies, not what WILL happen.
- The attached image (if noted) is from the live CB Edge dashboard — it is fine to reference it ("chart below", "flow tape below") and to note this data streams live on cbedge.net.

POST TYPES
- premarket: the morning read — structure into the open, key levels, regime, what to watch.
- midday: how the session is actually trading vs the morning levels — holds, breaks, pins.
- eod: wrap the session — what the levels did, how the regime played out, tee up tomorrow.
- custom: follow the user's notes for angle and content.

TRADE IDEA (when provided)
- Fold the contract (e.g. $TSLA 420C 7/17) into the post as a LEVELS-BASED watch — "on the radar", "watching", conditional on the structure. NEVER say buy/sell/enter, no targets-as-promises, no PT guarantees.
- When a contract price is given, include it in the post (e.g. "$TSLA 420C 7/17 @ $3.10").

HARD RULES
- Output ONE tweet only, at or under 280 characters INCLUDING cashtags, hashtags, and link. Be ruthless about length.
- Lead with the primary cashtag ($SPX, or the trade-idea ticker when one is given).
- Include 1-3 relevant hashtags (#SPX #0DTE #gamma #options #trading) where natural — do not stuff.
- End the tweet with the link: https://www.cbedge.net/
- Do NOT include any disclaimer. No "not financial advice", no "educational only", no "idea, not advice".
- Use the provided bias as the directional lean, kept conditional on the levels.

OUTPUT FORMAT
Return ONLY a single JSON object, no markdown, no code fences, no commentary:
{
  "xPost": string
}`;

type Slot = "premarket" | "midday" | "eod" | "custom";

interface TradeIdea {
  ticker?: string | null;
  strike?: string | null;
  right?: string | null; // "C" | "P"
  expiration?: string | null;
  price?: number | string | null;
  note?: string | null;
}

interface DayPostPayload {
  slot?: Slot;
  notes?: string | null;
  visual?: string | null; // "gex" | "flow" | "chain" | "greeks" | null
  tradeIdea?: TradeIdea | null;
  spxSpot?: number | null;
  spxPrevClose?: number | null;
  gammaFlip?: number | null;
  callWall?: number | null;
  putWall?: number | null;
  expectedMove?: number | null;
  emUpper?: number | null;
  emLower?: number | null;
  netGex?: number | null;
  gammaRegime?: string | null;
  bias?: string | null;
}

const SLOT_LABEL: Record<Slot, string> = {
  premarket: "PREMARKET ANALYSIS",
  midday: "MIDDAY UPDATE",
  eod: "END-OF-DAY SUMMARY",
  custom: "CUSTOM POST",
};

const VISUAL_LABEL: Record<string, string> = {
  gex: "live NET GEX profile chart",
  flow: "live options-flow tape",
  chain: "live options chain",
  greeks: "multi-expiry greeks dashboard",
};

function num(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function formatUserMessage(d: DayPostPayload): string {
  const slot: Slot = d.slot && d.slot in SLOT_LABEL ? d.slot : "premarket";
  const lines: string[] = [
    `Post type: ${SLOT_LABEL[slot]}`,
    d.visual && VISUAL_LABEL[d.visual]
      ? `Attached image: a ${VISUAL_LABEL[d.visual]} screenshot from the CB Edge dashboard.`
      : `Attached image: none.`,
    ``,
    `SPX spot: ${num(d.spxSpot)}`,
    `SPX prior-day close: ${num(d.spxPrevClose)}`,
    `Gamma flip: ${num(d.gammaFlip)}`,
    `Call wall: ${num(d.callWall)}`,
    `Put wall: ${num(d.putWall)}`,
    `Expected move: ±${num(d.expectedMove)}`,
    `EM range (off prior close): ${num(d.emLower)} to ${num(d.emUpper)}`,
    `Net GEX: ${d.netGex == null ? "n/a" : `${d.netGex >= 0 ? "+" : ""}${num(d.netGex, 2)}B`}`,
    `Gamma regime: ${d.gammaRegime || "n/a"}`,
    `Bias: ${d.bias || "neutral"}`,
  ];
  const t = d.tradeIdea;
  if (t && (t.ticker || t.strike)) {
    const right = (t.right || "C").toUpperCase() === "P" ? "P" : "C";
    lines.push(
      ``,
      `TRADE IDEA to fold in: $${(t.ticker || "SPX").toUpperCase()} ${t.strike || "?"}${right}${t.expiration ? ` exp ${t.expiration}` : ""}${t.price ? ` @ $${t.price}` : ""}${t.note ? ` — ${t.note}` : ""}`,
    );
  }
  if (d.notes) lines.push(``, `User notes / angle: ${d.notes}`);
  lines.push(``, `Write the single ${SLOT_LABEL[slot].toLowerCase()} tweet from this. Return the JSON object only.`);
  return lines.join("\n");
}

// Pull the first balanced JSON object out of arbitrary model text.
function extractJson(raw: string): { xPost: string } | null {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
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
      depth--;
      if (depth === 0) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
          const xPost = typeof obj.xPost === "string" ? obj.xPost : "";
          return xPost ? { xPost } : null;
        } catch { return null; }
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

  let input: DayPostPayload;
  try {
    input = (await req.json()) as DayPostPayload;
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
    });
  } catch (err) {
    return NextResponse.json(
      { error: `anthropic request failed: ${String((err as Error)?.message || err)}` },
      { status: 502 }
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
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
    return NextResponse.json({ error: "model returned unparseable output", raw: text.slice(0, 800) }, { status: 502 });
  }

  return NextResponse.json(
    { data: parsed },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
