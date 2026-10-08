// Voltick Journal branding, applied to the pinned upstream checkout at build time
// (deploy/journal/Dockerfile runs `node /branding/apply.mjs /repo/apps/web`).
//
// Why a build-time patch and not a fork: the journal stays LuxAlgo's code at a
// pinned commit; this file is the whole difference, and it is small enough to read.
//
// Every edit is an EXACT string with an expected count. If upstream changes a line
// this relies on, the build FAILS here and says which one — it never ships a
// half-branded journal. Fix the string below to match, rebuild.
//
// What changes:
//   · the mark (sidebar top-left, phone header, nav drawer, login) → Voltick wordmark
//   · "Trade Journal" → "Journal" beside the mark, so it reads "Voltick Journal"
//   · tab title, PDF export footer → "Voltick Journal"; a Voltick favicon
//   · sidebar footer credits the project it is built on (MIT + LuxAlgo's trademark
//     policy: describing it factually is allowed; claiming it as ours is not)
// What does NOT change: the Vela attribution on trade charts (its NOTICE requires it).

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = process.argv[2];
if (!web) throw new Error("usage: node apply.mjs <path to apps/web>");
const here = dirname(fileURLToPath(import.meta.url));

function edit(rel, pairs) {
  const p = join(web, rel);
  let s = readFileSync(p, "utf8");
  for (const [from, to, count] of pairs) {
    const n = s.split(from).length - 1;
    if (n !== count) {
      throw new Error(`branding: ${rel}: expected ${count} × ${JSON.stringify(from)}, found ${n}`);
    }
    s = s.split(from).join(to);
  }
  writeFileSync(p, s);
  console.log(`branding: ${rel} ok`);
}

// the mark
copyFileSync(join(here, "voltick-mark.tsx"), join(web, "src/components/luxalgo-mark.tsx"));
console.log("branding: src/components/luxalgo-mark.tsx replaced");

// favicon (Next.js serves src/app/icon.svg as the tab icon)
copyFileSync(join(here, "icon.svg"), join(web, "src/app/icon.svg"));
console.log("branding: src/app/icon.svg added");

edit("src/components/shell.tsx", [
  ["Trade Journal", "Journal", 3],
  [
    `        Open source ·{" "}
        <a
          href="https://github.com/LuxAlgo/trade-journal"
          className="underline underline-offset-2 hover:text-foreground"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>`,
    `        Built on{" "}
        <a
          href="https://github.com/LuxAlgo/trade-journal"
          className="underline underline-offset-2 hover:text-foreground"
          target="_blank"
          rel="noreferrer"
        >
          LuxAlgo's open-source Trade Journal
        </a>`,
    1,
  ],
]);

edit("src/app/login/page.tsx", [["Trade Journal", "Journal", 1]]);

edit("src/app/layout.tsx", [
  [`title: "Trade Journal",`, `title: "Voltick Journal",`, 1],
  [
    `"The open-source trade journal — broker sync, deep analytics, daily journaling, and AI-native reflection. Self-hosted, free forever."`,
    `"Voltick Journal — your trades, P&L calendar, analytics and daily journal."`,
    1,
  ],
]);

edit("src/lib/export-review.ts", [
  [`pdf.setCreator("Trade Journal");`, `pdf.setCreator("Voltick Journal");`, 1],
  ["`Trade Journal  |  ${i + 1}", "`Voltick Journal  |  ${i + 1}", 1],
]);

// wordmark colours: paper + Volt Blue (Accent Text on dark, Volt Blue on light)
const css = join(web, "src/app/globals.css");
writeFileSync(
  css,
  readFileSync(css, "utf8") +
    `
/* Voltick Journal wordmark (deploy/journal/branding) */
.voltick-mark { font-size: 15px; letter-spacing: -0.01em; }
.voltick-mark-a { color: var(--foreground); }
.voltick-mark-b { color: #2f6bff; }
.dark .voltick-mark-b { color: #6aa0ff; }
`,
);
console.log("branding: src/app/globals.css ok");
