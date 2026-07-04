import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Haiku 4.5 is vision-capable and already used elsewhere in the app.
const MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

const SYSTEM = `You extract bank or credit-card transactions from a screenshot image.
Return ONLY a JSON array, no prose, no code fences. Each element:
{"date":"YYYY-MM-DD","description":string,"amount":number,"direction":"in"|"out"}
Rules:
- amount is ALWAYS a positive number: no sign, no currency symbol, no thousands separators.
- direction is "out" for purchases, payments, debits, withdrawals, fees; "in" for deposits, credits, payroll, refunds, transfers received.
- If a row shows no year, assume ${new Date().getFullYear()}.
- Keep description short and human (merchant or payee); strip long reference/auth numbers.
- Skip running-balance columns, section headers, and totals. If you can read no transactions, return [].`;

type ParsedRow = { date: string; description: string; amount: number; direction: "in" | "out" };

function extractRows(text: string): ParsedRow[] {
  if (!text) return [];
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r) => ({
        date: String(r?.date ?? "").slice(0, 10),
        description: String(r?.description ?? "").slice(0, 80),
        amount: Math.abs(Number(r?.amount ?? 0)),
        direction: (r?.direction === "in" ? "in" : "out") as "in" | "out",
      }))
      .filter((r) => r.date && r.description && Number.isFinite(r.amount) && r.amount > 0);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    // Owner-only, fails closed (mirrors /api/budget).
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!OWNER_USER_ID || userId !== OWNER_USER_ID) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "Screenshot import isn't configured (missing ANTHROPIC_API_KEY)." }, { status: 500 });
    }

    const { imageBase64, mediaType } = await req.json();
    if (!imageBase64) return NextResponse.json({ error: "No image provided." }, { status: 400 });

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: String(mediaType || "image/png"), data: String(imageBase64) } },
              { type: "text", text: "Extract every transaction you can read from this screenshot. Return only the JSON array." },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json({ error: "Vision request failed", detail }, { status: 502 });
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text ?? "";
    return NextResponse.json({ rows: extractRows(text) });
  } catch (err) {
    return NextResponse.json({ error: "Parse failed", detail: String(err) }, { status: 500 });
  }
}
