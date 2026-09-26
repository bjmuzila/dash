/**
 * "Show changes" for the Mockups page. One switch on the page turns every
 * <Mark> on: a coloured outline and a small tag around each thing that is new,
 * merged, moved or removed between the OLD menu and the NEW one.
 *
 *   new     green   something the new menu adds or merges into one place
 *   moved   amber   the same control, living somewhere else now
 *   gone    red     removed from this surface (on the OLD menu only)
 *
 * With the switch off a Mark renders its children and nothing else, so the
 * mockups look exactly like the site.
 */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { BAD, GOOD, MONO, VOLT, rgba } from "../theme";

export const ChangesCtx = createContext(false);

export type MarkTone = "new" | "moved" | "gone";
export const MARK_COLOR: Record<MarkTone, string> = { new: GOOD, moved: VOLT, gone: BAD };
export const MARK_INK = "#0a0d10";

export function Mark({ children, tone = "new", tag, block = false }: { children: ReactNode; tone?: MarkTone; tag?: string; block?: boolean }) {
  const on = useContext(ChangesCtx);
  if (!on) return <>{children}</>;
  const c = MARK_COLOR[tone];
  return (
    <span
      style={{
        position: "relative",
        display: block ? "block" : "inline-flex",
        alignItems: "center",
        outline: `2px ${tone === "gone" ? "dashed" : "solid"} ${c}`,
        outlineOffset: 3,
        borderRadius: 10,
        boxShadow: `0 0 0 6px ${rgba(c, 0.14)}`,
        background: tone === "gone" ? rgba(c, 0.06) : undefined,
      }}
    >
      {children}
      {tag && (
        <span
          style={{
            position: "absolute",
            top: -11,
            left: 4,
            zIndex: 5,
            fontFamily: MONO,
            fontSize: 8.5,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: MARK_INK,
            background: c,
            borderRadius: 4,
            padding: "1px 5px",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {tag}
        </span>
      )}
    </span>
  );
}
