/**
 * CB Edge v3, inside Voltick's chrome.
 *
 * The v3 board is its own app in its own container (voltick-v3), served by
 * nginx at /v3/. This page frames it so the two Voltick bars — the top bar and
 * the contents rail — stay put while you move around inside it. Two sets of
 * bars around one board is not a layout, it is two products arguing, so the
 * frame asks v3 for the page WITHOUT its own rail and toolbar: `?embed=1`,
 * which its Shell reads and sticks for the frame's lifetime.
 *
 * Why an iframe and not a route. v3 is React 19, router 7, Vite 7 and Tailwind
 * 4; this app is React 18, router 6, Vite 5 and no Tailwind. Mounting its cards
 * here means upgrading this SPA across four majors before a single card
 * renders, and then maintaining one build for two design systems. A frame costs
 * a nested scroll container and buys complete independence: v3 keeps its own
 * deploy, its own bundle and its own crashes.
 *
 * Same origin, so nothing here is sandboxed away and the session cookie rides
 * along exactly as it does for a direct visit. The gate is unchanged: nginx
 * checks /_vkauth before it serves a byte of the frame's content, the same as
 * for every other path on this host.
 */
import { useEffect, useRef, useState } from "react";
import { INK, LINE, MONO, PAPER, PAPER_QUIET, R_MD, W_MED } from "../theme";

/** The framed app's entry. The trailing slash matters: nginx redirects /v3. */
const SRC = "/v3/?embed=1";

export default function V3Board() {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [slow, setSlow] = useState(false);

  // v3 is a big bundle and the frame is silent while it arrives: a blank panel
  // for four seconds reads as broken. This says "still loading" rather than
  // pretending to be a progress bar it cannot measure across an origin it does
  // not control the timing of.
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 2500);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      style={{
        // Full height minus this app's own top bar, so the board gets the
        // screen and the page itself never scrolls — the frame scrolls.
        height: "calc(100vh - 56px)",
        minHeight: 520,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 12px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: W_MED, color: PAPER }}>CB Edge v3</span>
        <span style={{ fontSize: 12.5, color: PAPER_QUIET }}>
          The board and every card, in the Voltick palette. Running live.
        </span>
        {/* A frame has no address bar, so the way out has to be drawn. */}
        <a
          href={SRC}
          target="_blank"
          rel="noreferrer"
          style={{
            marginLeft: "auto",
            fontFamily: MONO,
            fontSize: 11,
            color: PAPER_QUIET,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          open on its own ↗
        </a>
      </div>

      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          borderRadius: R_MD,
          overflow: "hidden",
          border: `1px solid ${LINE}`,
          background: INK,
        }}
      >
        {slow && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: PAPER_QUIET,
              pointerEvents: "none",
            }}
          >
            Loading v3
          </span>
        )}
        <iframe
          ref={frame}
          src={SRC}
          title="CB Edge v3"
          onLoad={() => setSlow(false)}
          style={{
            position: "relative",
            display: "block",
            width: "100%",
            height: "100%",
            border: 0,
            background: INK,
          }}
        />
      </div>
    </div>
  );
}
