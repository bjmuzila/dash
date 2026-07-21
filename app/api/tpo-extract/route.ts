import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/tpo-extract — reads TPO / Market-Profile levels off a pasted chart
 * screenshot with Claude vision and returns them as structured rows.
 *
 * Body: { image: string (data URL, png/jpeg/webp), year?: number, symbol?: string }
 * Returns: { rows: TpoRow[] }  (left-to-right, one per profile the model reads)
 *
 * Mirrors the Anthropic call in /api/social-media/generate (same key, version,
 * model, and defensive JSON extraction). Env: ANTHROPIC_API_KEY.
 */

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

interface TpoRow {
  date: string | null;   // as read from the x-axis under the profile (MM/DD or YYYY-MM-DD)
  high: number | null;   // H
  low: number | null;    // L
  poc: number | null;    // P (orange point-of-control)
  vah: number | null;    // value-area high, if drawn
  val: number | null;    // value-area low, if drawn
  mid: number | null;    // M (profile mid)
  note: string | null;   // anything ambiguous the reader should verify
}

const SYSTEM_PROMPT = `You extract price levels from a futures TPO / Market Profile chart screenshot. Each vertical letter/volume profile is one trading session, laid out left-to-right, with its date on the x-axis below it.

Each profile is labeled with some of these markers next to horizontal price levels:
- H = session high
- L = session low
- P = POC / point of control (usually orange, with a horizontal ray)
- M = profile mid
- VAH / VAL = value-area high / low, when drawn
Prices are futures quotes with .00/.25/.50/.75 tick precision.

RULES
- Read EVERY distinct profile in the image, in left-to-right order — one output row each.
- For each, report only the values you can actually read. If a marker is not present or is unreadable, use null — never guess a digit.
- date: read the x-axis tick nearest that profile. Return it exactly as shown (e.g. "07/09"). If you truly cannot tell, use null.
- Do not invent VAH/VAL if the chart doesn't draw them.
- If two labels overlap and you are unsure which profile a value belongs to, put your best read and add a short note.

OUTPUT
Return ONLY a JSON object, no markdown, no code fences, exactly:
{ "rows": [ { "date": string|null, "high": number|null, "low": number|null, "poc": number|null, "vah": number|null, "val": number|null, "mid": number|null, "note": string|null } ] }`;

function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  const mediaType = m[1] === "image/jpg" ? "image/jpeg" : m[1];
  return { mediaType, data: m[3] };
}

// Pull the first balanced {...} object out of the model text and JSON.parse it.
function extractJson(text: string): { rows: TpoRow[] } | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
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
          const obj = JSON.parse(text.slice(start, i + 1)) as { rows?: unknown };
          if (!Array.isArray(obj.rows)) return null;
          const num = (v: unknown): number | null =>
            typeof v === "number" && Number.isFinite(v) ? v : null;
          const str = (v: unknown): string | null =>
            typeof v === "string" && v.trim() ? v.trim() : null;
          const rows: TpoRow[] = obj.rows.map((r) => {
            const o = (r ?? {}) as Record<string, unknown>;
            return {
              date: str(o.date),
              high: num(o.high),
              low: num(o.low),
              poc: num(o.poc),
              vah: num(o.vah),
              val: num(o.val),
              mid: num(o.mid),
              note: str(o.note),
            };
          });
          return { rows };
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
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });
  }

  let body: { image?: string; year?: number; symbol?: string };
  try {
    body = (await req.json()) as { image?: string; year?: number; symbol?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const img = typeof body.image === "string" ? parseDataUrl(body.image) : null;
  if (!img) {
    return NextResponse.json({ error: "body.image must be a base64 data URL (png/jpeg/webp)" }, { status: 400 });
  }

  const hint =
    `Extract the TPO levels from this chart.` +
    (body.symbol ? ` Instrument: ${body.symbol}.` : "") +
    (body.year ? ` If a date shows only MM/DD, assume year ${body.year}.` : "");

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
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } },
              { type: "text", text: hint },
            ],
          },
        ],
      }),
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      { error: `anthropic request failed: ${String((err as Error)?.message || err)}` },
      { status: 502 },
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
    { rows: parsed.rows },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } },
  );
}
