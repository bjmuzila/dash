import { serveSpaShell } from "@/lib/serveSpaShell";

// /v3/em — the SPA shell for the v3 route of the same name.
// Step 4 of the four in cbedge-v3/AGENTS.md: without this file the page works
// when you click to it in-app but 404s on a hard refresh or a shared link.
// That matters more here than on most pages — /v3/em?ticker=SPX is meant to be
// pasted to someone, and a shared link IS a hard refresh.
// Deliberately not a catch-all — a catch-all under /v3 would swallow
// /v3/assets/*.js and hand back HTML.
export const dynamic = "force-dynamic";
export const GET = () => serveSpaShell("v3");
