import { serveSpaShell } from "@/lib/serveSpaShell";

// /v3/level-log — the SPA shell for the v3 route of the same name.
// Step 4 of the four in cbedge-v3/AGENTS.md: without this file the page works
// when you click to it in-app but 404s on a hard refresh or a shared link.
// The ticker and the date live in this page's query string
// (/v3/level-log?ticker=SPX&date=2026-09-02), so a shared link IS a hard
// refresh and this route is what answers it.
// Deliberately not a catch-all — a catch-all under /v3 would swallow
// /v3/assets/*.js and hand back HTML.
export const dynamic = "force-dynamic";
export const GET = () => serveSpaShell("v3");
