import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/social-media/generate — turns the pre-market GEX read into social posts.
 * Calls the Anthropic Messages API (claude-sonnet-4-6) with the CB Edge voice
 * rules as the system prompt and the formatted Daily Input block as the user
 * message, and asks for strict JSON: { xPost, xThread[], discordDrop }. The
 * model output is parsed defensively (code fences stripped, first JSON object
 * extracted) so a stray prose wrapper never 500s the page.
 *
 * Env: ANTHROPIC_API_KEY.
 */

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// CB Edge voice. Sharp, trader-to-trader, no hype, never financial advice, and
// every post closes with a disclaimer line.
const SYSTEM_PROMPT = `You are the social-media voice of CB Edge, an SPX gamma-exposure (GEX) and options-flow desk. You write a single pre-market tweet that turns the morning dealer-positioning read into tight, useful market commentary.

VOICE
- Sharp and trader-to-trader. You are talking to people who already know what gamma, dealer hedging, call/put walls and expected move are. Do not explain the basics.
- No hype. No "🚀 to the moon", no clickbait, no emoji spam. At most one tasteful emoji, and usually zero.
- Concrete and level-driven. Reference the actual numbers you are given (spot, flip, walls, expected move, net GEX). Frame them as structure, not predictions.
- Confident but never promissory. Describe what the positioning implies, not what WILL happen.

HARD RULES
- Output ONE tweet only, at or under 280 characters INCLUDING the ticker, hashtags, and link. Be ruthless about length.
- Lead with the $SPX cashtag.
- Include 1-3 relevant hashtags (e.g. #SPX #0DTE #gamma #options #trading) where they fit naturally — do not stuff.
- End the tweet with the link: https://www.cbedge.net/
- Do NOT include any disclaimer line. No "not financial advice", no "educational only".
- Use the bias provided as the directional lean, but keep it conditional on the levels.

OUTPUT FORMAT
Return ONLY a single JSON object, no markdown, no code fences, no commentary, with exactly this key:
{
  "xPost": string   // one standalone tweet, <=280 chars total, leads with $SPX, includes hashtags and ends with https://www.cbedge.net/
}`;

interface DailyInputPayload {
  spxSpot?: number | null;
  spxPrevClose?: number | null;
  gammaFlip?: number | null;
  callWall?: number | null;
  putWall?: number | null;
  expectedMove?: number | null;
  expectedMoveExpiry?: string | null;
  emUpper?: number | null;
  emLower?: number | null;
  netGex?: number | null;
  esOvernightHigh?: number | null;
  esOvernightLow?: number | null;
  gammaRegime?: string | null;
  bias?: string | null;
  date?: string | null;
}

interface GeneratedPosts {
  xPost: string;
  xThread: string[];
  discordDrop: string;
}

function num(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

// Render the input block the model reasons over. Plain, labeled lines so the
// model can quote the exact numbers.
function formatUserMessage(d: DailyInputPayload): string {
  const lines = [
    `CB Edge — SPX pre-market GEX read${d.date ? ` for ${d.date}` : ""}.`,
    ``,
    `SPX spot: ${num(d.spxSpot)}`,
    `SPX prior-day close: ${num(d.spxPrevClose)}`,
    `Gamma flip: ${num(d.gammaFlip)}`,
    `Call wall: ${num(d.callWall)}`,
    `Put wall: ${num(d.putWall)}`,
    `Expected move (ATM straddle): ±${num(d.expectedMove)}${d.expectedMoveExpiry ? ` (exp ${d.expectedMoveExpiry})` : ""}`,
    `Expected-move range (off the prior close): ${num(d.emLower)} (lower) to ${num(d.emUpper)} (upper) — these are the EM levels; cite them as the expected range, anchored to the ${num(d.spxPrevClose)} prior close.`,
    `Net GEX: ${d.netGex == null ? "n/a" : `${d.netGex >= 0 ? "+" : ""}${num(d.netGex, 2)}B`}`,
    `ES overnight high: ${num(d.esOvernightHigh)}`,
    `ES overnight low: ${num(d.esOvernightLow)}`,
    `Gamma regime: ${d.gammaRegime || "n/a"}`,
    `Bias: ${d.bias || "neutral"}`,
    ``,
    `Write the single pre-market tweet from this read. Return the JSON object only.`,
  ];
  return lines.join("\n");
}

// Pull the first balanced JSON object out of arbitrary model text. Handles
// ```json fences, leading prose, and trailing commentary.
function extractJson(raw: string): GeneratedPosts | null {
  let text = raw.trim();
  // Strip a leading/trailing markdown code fence if present.
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = text.indexOf("{");
  if (start === -1) return null;
  // Walk braces to find the matching close (ignoring braces inside strings).
  let depth = 0;
  let inStr = false;
  let esc = false;
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
        const slice = text.slice(start, i + 1);
        try {
          const obj = JSON.parse(slice) as Record<string, unknown>;
          const xPost = typeof obj.xPost === "string" ? obj.xPost : "";
          const discordDrop = typeof obj.discordDrop === "string" ? obj.discordDrop : "";
          const xThread = Array.isArray(obj.xThread)
            ? obj.xThread.filter((t): t is string => typeof t === "string")
            : [];
          if (!xPost && !discordDrop && !xThread.length) return null;
          return { xPost, xThread, discordDrop };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 503 }
    );
  }

  let input: DailyInputPayload;
  try {
    input = (await req.json()) as DailyInputPayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const userMessage = formatUserMessage(input);

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
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
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
    return NextResponse.json(
      { error: `anthropic ${res.status}`, detail: detail.slice(0, 500) },
      { status: 502 }
    );
  }

  const payload = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = (payload.content ?? [])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();

  const parsed = extractJson(text);
  if (!parsed) {
    return NextResponse.json(
      { error: "model returned unparseable output", raw: text.slice(0, 800) },
      { status: 502 }
    );
  }

  return NextResponse.json(
    { data: parsed },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
