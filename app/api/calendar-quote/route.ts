import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Daily rotating market/trading quote shown above the econ calendar.
// Deterministic per ET date: stable within a day, varies day to day.
const QUOTES: string[] = [
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

function etDateKey(): string {
  // YYYY-MM-DD in America/New_York
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function pickQuote(): string {
  const key = etDateKey();
  // Stable day-number hash → index
  const dayNum = Math.floor(Date.parse(key + "T00:00:00Z") / 86_400_000);
  return QUOTES[((dayNum % QUOTES.length) + QUOTES.length) % QUOTES.length];
}

export async function GET() {
  return NextResponse.json({ quote: pickQuote() });
}

export async function POST() {
  return NextResponse.json({ quote: pickQuote() });
}
