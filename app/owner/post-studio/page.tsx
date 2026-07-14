"use client";

/**
 * /owner/post-studio — X Post Studio.
 *
 * Owner-gated by middleware (OWNER_PATTERNS matches /owner/*). The tool itself
 * is a self-contained document rendered via iframe srcDoc so its global CSS
 * (body flex, 100vh, id-based selectors) can't leak into the dashboard.
 *
 * Layout: LayoutShell already sits <main> in a flex column BELOW GlobalToolbar,
 * so this fills that box (flex:1 + minHeight:0). Do NOT use position:fixed /
 * inset:0 here — that escapes the shell and slides the tool under the toolbar,
 * hiding the template selector.
 */

import { STUDIO_HTML } from "./studioHtml";

export default function PostStudioPage() {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", background: "#05080e" }}>
      <iframe
        title="X Post Studio"
        srcDoc={STUDIO_HTML}
        sandbox="allow-scripts allow-modals allow-downloads allow-popups allow-same-origin"
        style={{ flex: 1, width: "100%", border: 0, display: "block" }}
      />
    </div>
  );
}
