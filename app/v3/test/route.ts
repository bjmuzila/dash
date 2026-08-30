// /v3/test — RETIRED 2026-08-30.
//
// The Test Lab page was removed from cbedge-v3 (no lazy() import, no <Route>,
// no rail slot). This handler used to serve the v3 SPA shell; serving it now
// would hand back the shell only for React Router to render NotFound, so it
// answers 404 directly instead.
//
// This whole folder is safe to delete — `git rm -r app/v3/test` — it only
// still exists because the tooling that made the change cannot delete files.
export const dynamic = "force-dynamic";
export const GET = () => new Response("Not found", { status: 404 });
