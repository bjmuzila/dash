import { serveSpaShell } from "@/lib/serveSpaShell";

// /v3/whales — the SPA shell for the $1M+ print archive.
//
// Without this file the page works when you click it in the rail and 404s on a
// hard refresh or a shared link — and this one gets shared: the whole point of
// an archive is sending somebody a range.
//
// Deliberately not a catch-all — a catch-all under /v3 would swallow
// /v3/assets/*.js and hand back HTML.
export const dynamic = "force-dynamic";
export const GET = () => serveSpaShell("v3");
