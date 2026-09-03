import { serveSpaShell } from "@/lib/serveSpaShell";

// /v3/m/<tab> — the SPA shell for every screen in v3's PHONE BUILD.
//
// Step 4 of the four in cbedge-v3/AGENTS.md, done once for the whole set. The
// tabs are registered in cbedge-v3/src/mobile/mobileNav.ts and routed in
// src/App.tsx; without a handler here each one works when you tap to it in-app
// and 404s on a hard refresh or a shared link — which on a phone is most of how
// anyone arrives, because the link comes out of a message.
//
// ONE DYNAMIC SEGMENT, NOT A CATCH-ALL. `[tab]` matches exactly /v3/m/<one
// segment>, so it cannot reach /v3/assets/*.js. A catch-all under /v3 would,
// and would hand back HTML for a JavaScript module — the failure every other
// /v3/* handler is written as its own file to avoid. Here the segment is
// bounded, so one file covers every tab and adding a tab needs no new route.
//
// An unknown tab (/v3/m/nope) still serves the shell and the SPA renders its
// NotFound. That is deliberate: App.tsx's rule is that an unregistered route
// fails visibly in the app rather than being redirected somewhere that half
// works, and a 404 from this handler would replace that with a blank page.
export const dynamic = "force-dynamic";
export const GET = () => serveSpaShell("v3");
