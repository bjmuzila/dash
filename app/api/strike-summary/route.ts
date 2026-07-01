import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM = `You are CB Edge, an SPX GEX desk. Write exactly 1-2 sentences about this strike level. Format: "[strike] is a [CB/support/resistance/flip] level. [What price should do here based on net GEX — reach/pivot/pin/amplify]." Be blunt and specific. Use the actual numbers. No disclaimers, no fluff. Example tone: "7540 CB level here. Market should reach or pivot if net GEX stays positive."`;


export async function POST(req: NextRequest) {
  try {
    const { strike, spotPrice, oiVolGex, volGex, otmSide, otmPrice } = await req.json();

    const user = `Strike: ${strike} | SPX Spot: ${spotPrice}
OI+Vol GEX: ${oiVolGex} | Vol GEX: ${volGex}
OTM ${otmSide} contract: ${otmPrice ?? "N/A"}`;

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 120,
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
      }),
    });

    if (!res.ok) return NextResponse.json({ summary: null }, { status: 200 });
    const data = await res.json();
    const summary = data?.content?.[0]?.text?.trim() ?? null;
    return NextResponse.json({ summary });
  } catch {
    return NextResponse.json({ summary: null }, { status: 200 });
  }
}
