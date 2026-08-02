#!/usr/bin/env node
/**
 * Build the Vite SPA and install it at public/app.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `npm run build` at the repo root is `next build`. It does NOT touch
 * public/app, so an edit to a shared component (components/dashboard/**, which
 * BOTH shells compile) changes the Next routes immediately and changes
 * /app/<route> not at all. The SPA only got rebuilt inside the Dockerfile:
 *
 *     RUN npm run build
 *     RUN cd app-vite && npm install ... && npm run build
 *     RUN rm -rf public/app && cp -r app-vite/dist public/app
 *
 * which means the local build and the deploy build were never the same thing.
 * That gap cost a full debugging session: a fix verified working on the Next
 * route looked completely absent on /app/es-candles, because public/app was a
 * bundle from before the change. The bundle was stale, not the code.
 *
 * This script is those last two Docker lines, in Node so it runs on Windows
 * too. Point the Dockerfile at it as well and there is exactly ONE
 * implementation to keep correct.
 *
 * Usage:
 *   npm run build:spa
 *   node scripts/build-spa.mjs --skip-install   # deps already present
 *
 * Wire it in with:
 *   npm pkg set scripts.build:spa="node scripts/build-spa.mjs"
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = process.cwd();
const SRC = path.join(REPO, "app-vite");
const DIST = path.join(SRC, "dist");
const DEST = path.join(REPO, "public", "app");
const SKIP_INSTALL = process.argv.includes("--skip-install");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (args, cwd) => execFileSync(npm, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

if (!fs.existsSync(path.join(SRC, "package.json"))) {
  console.error("build-spa: app-vite/package.json not found. Run from the repo root.");
  process.exit(1);
}

if (!SKIP_INSTALL && !fs.existsSync(path.join(SRC, "node_modules"))) {
  console.log("build-spa: installing app-vite deps…");
  run(["install", "--no-audit", "--no-fund"], SRC);
}

console.log("build-spa: vite build…");
run(["run", "build"], SRC);

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  // Guard the destructive step. Replacing public/app with a half-written or
  // empty dist would leave every /app/* route serving a shell with no entry
  // script — a blank page that looks like an auth or routing bug.
  console.error(`build-spa: ${DIST} has no index.html — refusing to replace public/app.`);
  process.exit(1);
}

console.log(`build-spa: replacing ${path.relative(REPO, DEST)}…`);
fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.cpSync(DIST, DEST, { recursive: true });

const assets = path.join(DEST, "assets");
const n = fs.existsSync(assets) ? fs.readdirSync(assets).length : 0;
console.log(`build-spa: done — index.html + ${n} asset(s) at public/app.`);
console.log("build-spa: reminder — public/app is a build artifact; commit it only if your deploy expects it.");
