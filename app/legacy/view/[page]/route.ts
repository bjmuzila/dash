import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

/**
 * Serves the original vanilla-site pages from pages/old/ (one directory up
 * from bzila-dashboard) so every legacy page stays reachable in the new app.
 */
const LEGACY_FILES: Record<string, string> = {
  "dashboards": "dashboards.html",
  "dxfeed-indicators": "dxfeed-indicators.html",
  "dxfeed-market-indicators": "dxfeed_market_indicators_dashboard.html",
  "estimated-moves1": "estimated-moves1.html",
  "insights-legacy": "insights (1).html",
  "index-legacy": "index (1).html",
  "breadcrumb": "breadcrumb.html",
  "database-new": "database_new.html",
  "database-works": "database- works!!!!!!!!!!!!!!!!!!!!!!!!!!.html",
  "personal-section": "personal-section.html",
  "logs-section": "logs-page-section.html",
  "pages-bzila": "pages_bzila.html",
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ page: string }> }
) {
  const { page } = await ctx.params;
  const file = LEGACY_FILES[page];
  if (!file) {
    return NextResponse.json({ error: "Unknown legacy page" }, { status: 404 });
  }
  try {
    const filePath = path.join(process.cwd(), "..", "pages", "old", file);
    const html = await fs.readFile(filePath, "utf-8");
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read legacy page: ${String(e)}` },
      { status: 500 }
    );
  }
}
