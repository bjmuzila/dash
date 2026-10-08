// Voltick Journal — the Voltick wordmark, dropped in over upstream's
// src/components/luxalgo-mark.tsx at build time (deploy/journal/branding/apply.mjs).
//
// Same export name and props as the file it replaces, so every place upstream
// draws its mark (sidebar, phone header, nav drawer, login) draws Voltick instead
// with no other edit. "Vol" in paper, "tick" in Volt Blue — the same wordmark as
// Voltick's chart corner (cbedge-v3/src/pages/vela/voltickMark.ts). Volt Blue is
// #2f6bff; on a dark ground "tick" uses Accent Text (#6aa0ff) because Volt Blue
// itself is too dark to read as a word (cbedge-v3/src/design/tokens.css).
//
// Upstream sizes its mark as a fixed square icon (h-[18px] w-5); a wordmark needs
// its natural width, so width/height classes are dropped and the rest (e.g. the
// phone header's `hidden min-[380px]:block`) are kept.
export function LuxAlgoMark({ className }: { className?: string }) {
  const kept = (className ?? "")
    .split(/\s+/)
    .filter((c) => c && !/^(?:[a-z0-9-]+:)?[wh]-/.test(c))
    .join(" ");
  return (
    <span
      role="img"
      aria-label="Voltick"
      className={`voltick-mark inline-flex shrink-0 items-baseline whitespace-nowrap font-extrabold leading-none tracking-tight ${kept}`}
    >
      <span className="voltick-mark-a">Vol</span>
      <span className="voltick-mark-b">tick</span>
    </span>
  );
}
