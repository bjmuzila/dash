/**
 * /owner/post-studio — X Post Studio. Port of app/owner/post-studio/page.tsx.
 * Self-contained document rendered via iframe srcDoc so its global CSS can't
 * leak. html2canvas is imported here and hung on the iframe window so the
 * studio's Download button works.
 */
import { useCallback, useRef } from "react";
import html2canvas from "html2canvas";
import { STUDIO_HTML } from "./studioHtml";

export default function PostStudio() {
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
