import { redirect } from "next/navigation";

// Insights page removed (2026-06-24). Live IB merged into /home; Exposure Stack
// and Market Quality retired. Kept as a redirect stub so old bookmarks/links
// don't 404. Safe to delete this whole app/insights/ directory.
export default function InsightsPage() {
  redirect("/home");
}
