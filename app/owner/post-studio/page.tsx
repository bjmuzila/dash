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
 *
 * html2canvas: prod CSP is script-src 'self' (server-v2/server-with-proxy.js),
 * so the studio can NOT pull it from cdnjs — that's a blocked-script error and
 * a dead Download button. Instead we import it from node_modules here and hang
 * it on the iframe's window on load; the studio calls the bare global.
 */

import { useCallback, useRef } from "react";
import html2canvas from "html2canvas";

import { STUDIO_HTML } from "./studioHtml";

export default function PostStudioPage() {
  const frame = useRef<HTMLIFrameElement>(null);

  const inject = useCallback(() => {
    const win = frame.current?.contentWindow as (Window & { html2canvas?: unknown }) | null;
    if (win) win.html2canvas = html2canvas;
  }, []);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", background: "#05080e" }}>
      <iframe
        ref={frame}
        onLoad={inject}
        title="X Post Studio"
        srcDoc={STUDIO_HTML}
        sandbox="allow-scripts allow-modals allow-downloads allow-popups allow-same-origin"
        style={{ flex: 1, width: "100%", border: 0, display: "block" }}
      />
    </div>
  );
}
