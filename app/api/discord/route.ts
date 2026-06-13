// Unused — SnapButton uses /api/discord-share directly.
// This file kept as a placeholder to avoid 404 if referenced elsewhere.
export async function POST() {
  return Response.json({ note: "Use /api/discord-share instead" }, { status: 301 });
}
