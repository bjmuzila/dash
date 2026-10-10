import { NextResponse } from "next/server";

// TODO: pull live flow from SQLite premiumFlow table or in-memory ring buffer
export async function GET() {
  return NextResponse.json({
    timestamp: Date.now(),
    entries: [],
    summary: {
      totalCallPremium: 0,
      totalPutPremium: 0,
      ratio: 1,
      dominantSide: "neutral",
    },
  });
}
