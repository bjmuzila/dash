"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The CB Edge watermark that sits on every chart and every table in the
// seasonality almanac.
//
// WHY IT IS CENTERED, NOT IN A CORNER. This page exists to be screenshotted and
// posted. A corner mark is cropped off in two seconds; a centered one has to be
// cloned out. It is the only reason the watermark exists, so it wins over the
// tidier-looking option.
//
// WHY IT IS SAFE TO PUT OVER DATA. `/cb-edge-logo.png` is a chrome wordmark on a
// genuinely transparent background (alpha 0 at the corners — checked, not
// assumed), so at these opacities it reads as a ghost behind the marks rather
// than a white plate over them. `pointerEvents: none` keeps it out of every
// hover target underneath, and aria-hidden keeps it out of the accessibility
// tree — it is branding, not content.
//
// The asset is a plain <img> from /public, the same way PublicNav loads it. That
// matters on the signed-out page: the middleware matcher explicitly excludes
// ".png", so it is never auth-gated. Do not swap it for a fetched or generated
// source without re-checking that.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tuned per surface.
 *
 * `heatmap` is the odd one and the reason this has three modes rather than a
 * single opacity: heatmap cells are OPAQUE fills, so a mark sitting behind the
 * table is simply not there. That variant renders ON TOP instead, which needs a
 * higher opacity to read at all and a low enough one to stay out of the way of
 * the numbers — hence its own row. `pointerEvents: none` is what keeps an
 * on-top mark from eating the cell tooltips underneath it.
 */
export type WatermarkSize = "chart" | "table" | "heatmap";

const SPEC: Record<WatermarkSize, { width: string; opacity: number; max: number; over: boolean }> = {
  chart: { width: "26%", opacity: 0.09, max: 240, over: false },
  table: { width: "20%", opacity: 0.06, max: 190, over: false },
  heatmap: { width: "22%", opacity: 0.16, max: 200, over: true },
};

export default function Watermark({ size = "chart" }: { size?: WatermarkSize }) {
  const s = SPEC[size];
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: s.over ? 4 : 2,
        overflow: "hidden",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/cb-edge-logo.png"
        alt=""
        style={{
          width: s.width,
          maxWidth: s.max,
          minWidth: 96,
          height: "auto",
          opacity: s.opacity,
          userSelect: "none",
        }}
      />
    </div>
  );
}

/** Every watermarked container needs this — the mark is absolutely positioned. */
export const watermarkHost = { position: "relative" as const };
