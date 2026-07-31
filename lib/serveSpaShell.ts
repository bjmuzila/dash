import { readFile } from "fs/promises";
import path from "path";

/**
 * Escape a JSON payload for safe embedding inside an inline <script>.
 * `<` is the only character that can terminate the script element early
 * ("</script>" inside a string literal), so neutralising it is sufficient;
 * U+2028/2029 are legal in JSON but illegal in JS string literals pre-ES2019.
 */
function toScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// Serve a built Vite SPA's index.html for a client-routed sub-path. Assets
// (/<app>/assets/*.js|css) are served statically from public/<app> and bypass
// this handler (and the auth matcher's extension exclusion). Each SPA *route*
// gets its own tiny route.ts that calls this — a per-page handler instead of a
// catch-all, so /<app>/assets/* is never swallowed and returned as HTML.
//
// `seed` (optional) is inlined as window.__SPA_SEED__ just before </head>, so
// the route's first render has its data in the SAME response as the document.
// Without it the SPA had to: download the shell → download the entry chunk →
// download the route chunk → THEN start fetching its seed, a fully serialised
// 4th hop. Callers pass data they already have server-side; the client keeps a
// fetch fallback for when the key is absent.
export async function serveSpaShell(
  app: string,
  seed?: Record<string, unknown> | null,
): Promise<Response> {
  try {
    let html = await readFile(
      path.join(process.cwd(), "public", app, "index.html"),
      "utf8",
    );

    if (seed && Object.keys(seed).length > 0) {
      const tag = `<script>window.__SPA_SEED__=${toScriptJson(seed)}</script>`;
      // Must land before the module script that boots the app.
      html = html.includes("</head>")
        ? html.replace("</head>", `${tag}</head>`)
        : tag + html;
    }

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
