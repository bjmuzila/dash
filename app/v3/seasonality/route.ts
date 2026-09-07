import { serveSpaShell } from "@/lib/serveSpaShell";

// /v3/seasonality — the SPA shell for the v3 route of the same name.
// Step 4 of the four in cbedge-v3/AGENTS.md: without this file the almanac
// works when you click it in the rail but 404s on a hard refresh or a shared
// link. The page's sections address themselves in the hash
// (/v3/seasonality#opex), and a hash link IS a hard refresh for anyone opening
// it cold — so this one earns its keep the first time a section gets sent to
// somebody.
//
// Not to be confused with /explore/seasonality, which is the PUBLIC page and
// stays exactly where it is. This route is the in-app door, drawn for
// subscribers.
//
// Deliberately not a catch-all — a catch-all under /v3 would swallow
// /v3/assets/*.js and hand back HTML.
export const dynamic = "force-dynamic";
export const GET = () => serveSpaShell("v3");
