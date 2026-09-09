import { serveSpaShell } from "@/lib/serveSpaShell";

// /v3/feedback — the SPA shell for v3's support page (cbedge-v3/src/pages/Feedback.tsx).
// Step 4 of the four in cbedge-v3/AGENTS.md: without this file the page works
// when you click to it from the account menu but 404s on a hard refresh or a
// shared link — and this one WILL be linked, because ?tab=mine&ticket=<id> is
// how a customer is sent back to a ticket that has a reply waiting.
// Deliberately not a catch-all: a catch-all under /v3 would swallow
// /v3/assets/*.js and hand back HTML.
export const dynamic = "force-dynamic";
export const GET = () => serveSpaShell("v3");
