import { NextResponse } from "next/server";
import {
  clearQuoteCache,
  getQuoteRows,
  isQuoteSheetConfigured,
  type QuoteRow,
} from "@/lib/calendarQuotes";

export const dynamic = "force-dynamic";

// Quote of the day shown above the econ calendar.
//
// Primary source is a Google Sheet with a date column and a quote column —
// see lib/calendarQuotes.ts for the shape and env vars. The list below is only
// a fallback for when the sheet isn't configured or can't be reached.
const FALLBACK_QUOTES: string[] = [
  "The market can stay irrational longer than you can stay solvent. — John Maynard Keynes",
  "Risk comes from not knowing what you're doing. — Warren Buffett",
  "In investing, what is comfortable is rarely profitable. — Robert Arnott",
  "The four most dangerous words in investing are: this time it's different. — John Templeton",
  "Be fearful when others are greedy and greedy when others are fearful. — Warren Buffett",
  "The trend is your friend until the end when it bends. — Ed Seykota",
  "Markets are never wrong, opinions often are. — Jesse Livermore",
  "It's not whether you're right or wrong, but how much you make when right and lose when wrong. — Stanley Druckenmiller",
  "The goal of a successful trader is to make the best trades. Money is secondary. — Alexander Elder",
  "Amateurs think about how much money they can make. Professionals think about how much they could lose. — Jack Schwager",
  "Do not anticipate and move without market confirmation — being a little late is your insurance. — Richard Wyckoff",
  "Plan the trade and trade the plan. — Trading maxim",
  "Cut your losses short and let your winners run. — David Ricardo",
  "The stock market is a device for transferring money from the impatient to the patient. — Warren Buffett",
  "Patience is the key. Wait for the trade to come to you. — Linda Raschke",
  "Every battle is won before it is fought. — Sun Tzu",
  "Losses are part of the game. The market doesn't owe you anything. — Trading maxim",
  "Know what you own, and know why you own it. — Peter Lynch",
  "The elements of good trading are: cutting losses, cutting losses, and cutting losses. — Ed Seykota",
  "Bulls make money, bears make money, pigs get slaughtered. — Wall Street adage",
  "Time in the market beats timing the market. — Investing adage",
  "The market is a pendulum that forever swings between unsustainable optimism and unjustified pessimism. — Benjamin Graham",
  "Don't fight the tape. — Wall Street adage",
  "Discipline is the bridge between goals and accomplishment. — Jim Rohn",
  "An investment in knowledge pays the best interest. — Benjamin Franklin",
];

// How far back a dated row may be and still be shown when today has no row of
// its own (covers weekends and holidays).
const MAX_STALE_DAYS = 3;

function etDateKey(): string {
  // YYYY-MM-DD in America/New_York
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function dayNumber(dateKey: string): number {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86_400_000);
}

/** Stable per-day index into a list. */
function pickForDay<T>(list: T[], dateKey: string): T {
  const n = dayNumber(dateKey);
  return list[((n % list.length) + list.length) % list.length];
}

type Resolved = { quote: string; source: string; matchedDate: string | null };

function resolveQuote(rows: QuoteRow[], today: string): Resolved {
  // 1. Exact date match — the intended path.
  const exact = rows.find((r) => r.date === today);
  if (exact) return { quote: exact.quote, source: "sheet:date", matchedDate: exact.date };

  const todayNum = dayNumber(today);

  // 2. Most recent dated row in the past, within MAX_STALE_DAYS. Keeps a
  //    weekday-only sheet from going blank over a weekend or holiday.
  const past = rows
    .filter((r) => r.date && dayNumber(r.date) <= todayNum)
    .sort((a, b) => dayNumber(b.date!) - dayNumber(a.date!));
  if (past.length && todayNum - dayNumber(past[0].date!) <= MAX_STALE_DAYS) {
    return { quote: past[0].quote, source: "sheet:recent", matchedDate: past[0].date };
  }

  // 3. Undated rows in the sheet act as an evergreen pool.
  const undated = rows.filter((r) => !r.date);
  if (undated.length) {
    return { quote: pickForDay(undated, today).quote, source: "sheet:undated", matchedDate: null };
  }

  // 4. Any sheet row at all, rotated by day.
  if (rows.length) {
    return { quote: pickForDay(rows, today).quote, source: "sheet:rotate", matchedDate: null };
  }

  // 5. Built-in list.
  return { quote: pickForDay(FALLBACK_QUOTES, today), source: "fallback", matchedDate: null };
}

async function handle(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";
  const force = url.searchParams.get("refresh") === "1";
  if (force) clearQuoteCache();

  const today = etDateKey();
  const rows = await getQuoteRows({ force });
  const { quote, source, matchedDate } = resolveQuote(rows, today);

  if (debug) {
    return NextResponse.json({
      quote,
      source,
      today,
      matchedDate,
      configured: isQuoteSheetConfigured(),
      rowCount: rows.length,
      datedRows: rows.filter((r) => r.date).length,
      firstDate: rows.find((r) => r.date)?.date ?? null,
      lastDate: [...rows].reverse().find((r) => r.date)?.date ?? null,
      sample: rows.slice(0, 3),
    });
  }

  return NextResponse.json({ quote });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
