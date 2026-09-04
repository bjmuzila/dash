import { serveSpaShell } from "@/lib/serveSpaShell";

// /v3/legacy — the SPA shell for v3's v2-link page (cbedge-v3/src/pages/Legacy.tsx).
// Step 4 of the four in cbedge-v3/AGENTS.md: without this file the page works
// when you click to it in-app but 404s on a hard refresh or a shared link — and
// this one is going to be BOOKMARKED, since it is the page people open to reach
// a v2 tool. Deliberately not a catch-all: a catch-all under /v3 would swallow
// /v3/assets/*.js and hand back HTML.
export const dynamic = "force-dynamic";
export const GET = () => serveSpaShell("v3");
