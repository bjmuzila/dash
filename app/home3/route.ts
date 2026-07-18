import { readFile } from "fs/promises";
import path from "path";

// Serve the standalone Vite "home 3.0" SPA at the clean /home3 URL.
//
// A next.config rewrite to a public/ file (/home3 -> /home3/index.html) does
// NOT reliably serve in Next — the public static handler isn't a rewrite
// destination, so /home3 404s even though the file is deployed. Instead we read
// the built index.html and return it here. The SPA's own assets
// (/home3/assets/*.js, *.css and the images) are still served as normal static
// files from public/home3 — this handler only owns the bare /home3 entry.
//
// Access is already gated to the owner by middleware.ts (OWNER_PATTERNS).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const html = await readFile(
      path.join(process.cwd(), "public", "home3", "index.html"),
      "utf8",
    );
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response("home3 build not found", { status: 404 });
  }
}
