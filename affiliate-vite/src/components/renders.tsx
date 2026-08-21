import { useState } from "react";
import { THEME, TYPE, rgba } from "../lib/theme";

/**
 * The shareable graphic for a creative.
 *
 * WHAT CHANGED AND WHY. These used to be hand-drawn inline SVGs — a fake GEX
 * ladder, fake candles — which looked like the product without being it. An
 * affiliate posting a mock-up of a chart is worse than posting nothing: the
 * first person who opens CB Edge sees something that doesn't match, and the
 * post has quietly misrepresented the thing it was selling. So they are now
 * REAL SCREENSHOTS, dropped into affiliate-vite/public/creatives/.
 *
 * UNTIL A FILE IS THERE, THE SLOT SHOWS ITS OWN FILENAME. That is deliberate:
 * an empty creative that says nothing is a bug report waiting to happen, while
 * one that names the file it wants is a to-do list. The Post and Download
 * buttons disable themselves for a slot with no image, so nobody can share an
 * empty card.
 *
 * THE CODE STAMP IS COMPOSITED, NOT BAKED IN. The screenshot on disk is generic
 * — one file serves every affiliate. The badge carrying their code is drawn
 * over it in CSS for the preview, and painted onto a canvas for the download.
 * That is what keeps a screenshotted, re-shared post pointing at whoever posted
 * it, without generating and storing a file per affiliate.
 *
 * The canvas never taints: the image is same-origin (this app's own nginx
 * serves /creatives/), so toBlob always succeeds.
 */

/** X renders a 16:9 card inline without cropping. Author everything to this. */
export const CREATIVE_W = 1200;
export const CREATIVE_H = 675;

export function CreativeImage({
  src, code, id, onLoaded,
}: {
  src: string; code: string; id: string;
  onLoaded?: (ok: boolean) => void;
}) {
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");

  return (
    <div style={{ position: "relative", background: "#05060A", aspectRatio: `${CREATIVE_W} / ${CREATIVE_H}` }}>
      {/* Kept mounted even while missing — onError is the only signal that a
          file isn't there, and unmounting on failure throws it away. */}
      <img
        id={id}
        src={src}
        alt=""
        crossOrigin="anonymous"
        onLoad={() => { setState("ok"); onLoaded?.(true); }}
        onError={() => { setState("missing"); onLoaded?.(false); }}
        style={{
          display: state === "ok" ? "block" : "none",
          width: "100%", height: "100%", objectFit: "cover",
        }}
      />

      {state === "ok" && (
        <div style={{
          position: "absolute", right: 18, bottom: 18,
          padding: "6px 12px", borderRadius: 7,
          background: "rgba(5,6,10,0.78)", border: `1px solid ${rgba(THEME.cyan, 0.4)}`,
          color: THEME.cyan, fontFamily: "var(--font-mono)", fontSize: 13,
          fontWeight: 700, letterSpacing: "0.12em",
        }}>CODE {code}</div>
      )}

      {state !== "ok" && (
        <div style={{
          position: "absolute", inset: 10,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 10, padding: 20, textAlign: "center",
          border: `1px dashed ${rgba(THEME.cyan, 0.28)}`, borderRadius: 12,
        }}>
          <div style={{
            fontSize: TYPE.micro, letterSpacing: "0.16em", textTransform: "uppercase",
            color: THEME.dim2, fontWeight: 700,
          }}>{state === "loading" ? "Loading" : "Image not added yet"}</div>
          {state === "missing" && (
            <>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: THEME.cyan }}>{src}</div>
              <div style={{ fontSize: 11.5, color: THEME.dim, maxWidth: "42ch", lineHeight: 1.55 }}>
                Drop a {CREATIVE_W}×{CREATIVE_H} screenshot at that path under{" "}
                <span style={{ fontFamily: "var(--font-mono)" }}>affiliate-vite/public/</span>, then rebuild.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Composite the screenshot + the affiliate's code badge and hand the result to
 * the browser as a download.
 *
 * Dependency-free on purpose: the image is already in the DOM and decoded, so
 * this is drawImage + fillText + toBlob. Shipping html2canvas to burn one line
 * of text onto a picture is ~200KB of JavaScript on a page most visitors never
 * open.
 *
 * Drawn at the image's NATURAL size, not the displayed one — the card on screen
 * is ~400px wide, and X re-encodes anything that small into mush.
 */
export function downloadCreative(imgId: string, code: string, filename: string): void {
  const img = document.getElementById(imgId) as HTMLImageElement | null;
  if (!img || !img.naturalWidth) return;

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.drawImage(img, 0, 0, w, h);

  // Badge sized off the image HEIGHT so it lands identically on a 1200px export
  // and a 2400px one.
  const label = `CODE ${code}`;
  const pad = Math.round(h * 0.022);
  const fontPx = Math.max(14, Math.round(h * 0.028));
  ctx.font = `700 ${fontPx}px ui-monospace, Menlo, Consolas, monospace`;
  const boxW = ctx.measureText(label).width + pad * 2.2;
  const boxH = fontPx + pad * 1.4;
  const x = w - boxW - Math.round(w * 0.02);
  const y = h - boxH - Math.round(h * 0.035);

  ctx.fillStyle = "rgba(5,6,10,0.78)";
  ctx.strokeStyle = "rgba(33,158,188,0.55)";
  ctx.lineWidth = Math.max(1, Math.round(h * 0.002));
  ctx.beginPath();
  // roundRect is Baseline-available in every browser this app supports; the
  // guard is for the odd embedded webview that predates it.
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, boxW, boxH, Math.round(boxH * 0.22));
  else ctx.rect(x, y, boxW, boxH);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#219EBC";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + pad * 1.1, y + boxH / 2 + 1);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    // Revoke on the next tick — revoking synchronously races the click in
    // Safari and silently produces a zero-byte file.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
