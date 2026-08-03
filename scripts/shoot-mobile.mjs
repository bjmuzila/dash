/**
 * Screenshot every phone page at an iPhone viewport. DEV/QA ONLY.
 *
 * Playwright is intentionally NOT a dependency of this repo — install it ad hoc
 * when you want to run this, so a screenshot tool doesn't add ~100MB to every
 * `npm ci` on the deploy box:
 *
 *   npm i --no-save playwright
 *   node scripts/mock-mobile-preview.mjs 4310 &
 *   node scripts/shoot-mobile.mjs      # writes /tmp/shots/<page>.png
 *
 * Set PREVIEW to point at a different origin (e.g. a real dev server).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.PREVIEW || "http://localhost:4310";
const OUT = "/tmp/shots";
mkdirSync(OUT, { recursive: true });

const PAGES = ["gex", "heatmap", "es", "chain", "em", "econ"];

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const ctx = await browser.newContext({
  // iPhone 14/15/16 logical viewport.
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});

const errors = [];
for (const id of PAGES) {
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push("console: " + m.text());
  });
  await page.goto(`${BASE}/app/m/${id}`, { waitUntil: "networkidle" });
  // Give the REST fallback watchdog (6s silent → poll) time to fire.
  await page.waitForTimeout(11_000);
  await page.screenshot({ path: `${OUT}/${id}.png` });
  if (pageErrors.length) errors.push({ id, pageErrors: [...new Set(pageErrors)].slice(0, 6) });
  await page.close();
}

console.log(JSON.stringify(errors, null, 2));
await browser.close();
