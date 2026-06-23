import { redirect } from "next/navigation";

// Footprint was merged into ES Candles. Keep the route as a permanent redirect
// so any old links/bookmarks land on the live page.
export default function FootprintPage() {
  redirect("/es-candles");
}
