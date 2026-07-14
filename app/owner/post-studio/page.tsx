"use client";

/**
 * /owner/post-studio — X Post Studio.
 *
 * Owner-gated by middleware (OWNER_PATTERNS matches /owner/*). The tool itself
 * is a self-contained document rendered via iframe srcDoc so its global CSS
 * (body flex, 100vh, id-based selectors) can't leak into the dashboard.
 */

import { STUDIO_HTML } from "./studioHtml";

export default function PostStudioPage() {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#05080e" }}>
      <iframe
        title="X Post Studio"
        srcDoc={STUDIO_HTML}
        sandbox="allow-scripts allow-modals allow-downloads allow-popups allow-same-origin"
        style={{ width: "100%", height: "100%", border: 0, display: "block" }}
      />
    </div>
  );
}
