import { redirect } from "next/navigation";

// Strike Query removed (2026-07-03) — the feature now lives on the Market
// Scanner page. Kept as a redirect only because the build sandbox couldn't
// delete the file — safe to delete this whole folder.
export default function StrikeQueryRemoved() {
  redirect("/owner/market-scanner");
}
