import { readFile } from "fs/promises";
import path from "path";

// Serve a built Vite SPA's index.html for a client-routed sub-path. Assets
// (/<app>/assets/*.js|css) are served statically from public/<app> and bypass
// this handler (and the auth matcher's extension exclusion). Each SPA *route*
// gets its own tiny route.ts that calls this — a per-page handler instead of a
// catch-all, so /<app>/assets/* is never swallowed and returned as HTML.
export async function serveSpaShell(app: string): Promise<Response> {
  try {
    const html = await readFile(
      path.join(process.cwd(), "public", app, "index.html"),
      "utf8",
    );
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response(`${app} build not found`, { status: 404 });
  }
}
