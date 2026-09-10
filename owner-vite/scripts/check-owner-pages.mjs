#!/usr/bin/env node
/**
 * Owner-surface guard — stops "built on the wrong owner site".
 *
 * THE PROBLEM THIS EXISTS FOR
 *   There are TWO live owner surfaces answering /owner/*:
 *
 *     owner.cbedge.net   →  owner-vite SPA           ← THIS IS THE OWNER SITE
 *                           owner-vite/src/pages/*.tsx
 *                           routed by owner-vite/src/lib/nav.ts (key)
 *                                   + owner-vite/src/pages/registry.ts (lazy)
 *
 *     cbedge.net/owner/* →  Next server pages
 *                           app/owner/<slug>/page.tsx
 *                           gated by app/owner/layout.tsx + middleware.ts:123
 *
 *   Both are real, both are gated, and they use near-identical route names, so
 *   a page written for the wrong one looks completely correct in the file and
 *   never appears where you're looking. It has happened more than once — most
 *   recently 2026-09-10, when /owner/db-map was written as
 *   app/owner/db-map/page.tsx and would have served at cbedge.net/owner/db-map
 *   while owner.cbedge.net 404'd.
 *
 *   app/owner/ has exactly ONE legitimate page — budget, a legacy duplicate of
 *   owner-vite's Budget.tsx. That is the entire allowlist. Anything else added
 *   there is the mistake, by definition.
 *
 * WHAT IT CHECKS
 *   1) app/owner/<slug>/page.tsx exists for a slug not in NEXT_OWNER_ALLOWED
 *      → you built on the wrong surface.
 *   2) A nav entry's `key` has no entry in registry.ts
 *      → the route resolves to NotFound.
 *   3) A registry key isn't referenced by any nav entry
 *      → an unreachable lazy chunk shipped in the bundle.
 *   4) A registry import points at a file that doesn't exist
 *      → the build breaks, or worse, silently code-splits a stub.
 *
 * USAGE
 *   node owner-vite/scripts/check-owner-pages.mjs
 *   node owner-vite/scripts/check-owner-pages.mjs --dry     # report, exit 0
 *   node owner-vite/scripts/check-owner-pages.mjs --where /owner/db-map
 *
 *   The --where resolver is the one to reach for BEFORE writing a page: it
 *   prints the file that actually serves a URL on each surface.
 *
 * WIRE IT UP
 *   owner-vite/package.json  "prebuild": "node scripts/check-owner-pages.mjs"
 *     → checks 2-4 (nav/registry integrity) on every `docker compose build owners`.
 *   root package.json        "prebuild": "node owner-vite/scripts/check-owner-pages.mjs"
 *     → adds check 1, because only the root build can see app/owner/.
 *   Mirrors app-vite/scripts/check-routes.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// TWO CONTEXTS, and this script runs in both:
//
//   • repo root — `npm run build` at the top level, push.ps1 -LocalBuild, or a
//     bare run. The whole tree is present, including app/owner/.
//   • owner-vite ONLY — `docker compose build owners` uses
//     `context: ./owner-vite`, so the image contains owner-vite's contents and
//     nothing above it. app/owner/ does not exist there.
//
// So owner-vite's own files resolve relative to THIS FILE (scripts/ is inside
// owner-vite/), never via a guessed repo root — resolving two levels up landed
// above /app in the Docker build and failed the whole deploy on 2026-09-10.
// The Next tree is then OPTIONAL: absent means "not in this build context",
// which is a skip, not a failure.
const OV_ROOT = process.env.CHECK_OWNER_VITE
  ? path.resolve(process.env.CHECK_OWNER_VITE)
  : path.resolve(HERE, '..');
const OV = path.join(OV_ROOT, 'src');
const ROOT = process.env.CHECK_ROOT ? path.resolve(process.env.CHECK_ROOT) : path.resolve(OV_ROOT, '..');

const DRY = process.argv.includes('--dry');
const whereIdx = process.argv.indexOf('--where');
const WHERE = whereIdx >= 0 ? process.argv[whereIdx + 1] : null;

/**
 * The ONLY slugs allowed to exist as app/owner/<slug>/page.tsx.
 *
 * budget — predates the owner-vite port and is still served at
 *   cbedge.net/owner/budget. owner-vite/src/pages/Budget.tsx is the one that
 *   serves owner.cbedge.net. Do not "fix" a budget bug in only one of them.
 *
 * Adding a slug here is a decision to run a page on BOTH owner surfaces, with
 * two copies to keep in sync forever. Don't, unless you mean it.
 */
const NEXT_OWNER_ALLOWED = new Set(['budget']);

const errors = [];
const notes = [];
const read = (p) => fs.readFileSync(p, 'utf8');

// ── 1. wrong-surface pages (root context only) ──────────────────────────────────────────────────
const nextOwnerDir = path.join(ROOT, 'app', 'owner');
const nextOwnerSlugs = [];
// `app/` absent = the owner-vite-only Docker context. Skip, don't fail: this
// check belongs to whoever can see the Next tree (the root build), and failing
// here would block every owner deploy for a check it cannot perform.
// Marker files that only exist at the repo root. NOT `app/` — the owners image
// uses WORKDIR /app, so ROOT/app would exist there by pure coincidence and the
// skip would never trigger.
const nextTreePresent = fs.existsSync(path.join(ROOT, 'middleware.ts'))
  || fs.existsSync(path.join(ROOT, 'app-vite'));
if (!nextTreePresent) {
  notes.push('app/ not in this build context — wrong-surface check skipped (runs in the root build)');
}
if (nextTreePresent && fs.existsSync(nextOwnerDir)) {
  const walk = (dir, prefix = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const slug = prefix ? `${prefix}/${e.name}` : e.name;
      if (fs.existsSync(path.join(dir, e.name, 'page.tsx'))) nextOwnerSlugs.push(slug);
      walk(path.join(dir, e.name), slug);
    }
  };
  walk(nextOwnerDir);
}
for (const slug of nextOwnerSlugs) {
  if (NEXT_OWNER_ALLOWED.has(slug)) { notes.push(`app/owner/${slug}/page.tsx (allowlisted duplicate)`); continue; }
  errors.push(
    `WRONG OWNER SURFACE: app/owner/${slug}/page.tsx\n`
    + `      owner.cbedge.net is the owner-vite SPA — this file serves cbedge.net/owner/${slug} instead,\n`
    + `      and will NOT appear on the owner site. Move it to:\n`
    + `        owner-vite/src/pages/<Name>.tsx\n`
    + `        + owner-vite/src/pages/registry.ts   (key -> lazy import)\n`
    + `        + owner-vite/src/lib/nav.ts          (label/href/glyph/key)\n`
    + `      then delete app/owner/${slug}/.`,
  );
}

// ── owner-vite nav + registry ───────────────────────────────────────────────
const navPath = path.join(OV, 'lib', 'nav.ts');
const regPath = path.join(OV, 'pages', 'registry.ts');
if (!fs.existsSync(navPath) || !fs.existsSync(regPath)) {
  console.error('[check-owner] cannot find owner-vite nav.ts / registry.ts — fix this script, do not delete it.');
  process.exit(1);
}
const navSrc = read(navPath);
const regSrc = read(regPath);

// Match ONE brace-delimited object at a time. A regex spanning `label ... href
// ... key` across the whole file happily pairs a GROUP's label with the first
// link's href, which made every reported label wrong.
const navEntries = [...navSrc.matchAll(/\{[^{}]*\}/g)]
  .map((m) => m[0])
  .filter((o) => /href:/.test(o) && /key:/.test(o))
  .map((o) => ({
    label: (o.match(/label:\s*"([^"]+)"/) || [, '?'])[1],
    href: (o.match(/href:\s*"([^"]+)"/) || [, ''])[1],
    key: (o.match(/key:\s*"([A-Za-z0-9_]+)"/) || [, ''])[1],
  }))
  .filter((e) => e.href && e.key);
const registry = new Map(
  [...regSrc.matchAll(/^\s*([A-Za-z0-9_]+):\s*lazy\(\(\)\s*=>\s*import\("\.\/([^"]+)"\)\)/gm)]
    .map((m) => [m[1], m[2]]),
);

if (navEntries.length === 0) errors.push('parsed 0 nav entries from owner-vite/src/lib/nav.ts — the shape changed; update this script.');
if (registry.size === 0) errors.push('parsed 0 registry keys from owner-vite/src/pages/registry.ts — the shape changed; update this script.');

// ── 2. nav key with no registry entry → NotFound ────────────────────────────
for (const e of navEntries) {
  if (!registry.has(e.key)) {
    errors.push(
      `NAV ENTRY WITH NO PAGE: "${e.label}" (${e.href}) uses key "${e.key}"\n`
      + `      registry.ts has no "${e.key}" — this route renders NotFound.\n`
      + `      Add:  ${e.key}: lazy(() => import("./${e.key}")),`,
    );
  }
}

// ── 3. registry key nothing links to → dead chunk ───────────────────────────
const navKeys = new Set(navEntries.map((e) => e.key));
for (const key of registry.keys()) {
  if (!navKeys.has(key)) {
    errors.push(
      `UNREACHABLE PAGE: registry key "${key}" is in no nav entry.\n`
      + `      Its chunk ships but nothing links to it. Add a nav entry, or drop\n`
      + `      the lazy() so the file leaves the build (see the Tree comment in registry.ts).`,
    );
  }
}

// ── 4. registry import target missing ───────────────────────────────────────
for (const [key, target] of registry) {
  const base = path.join(OV, 'pages', target);
  const found = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts']
    .some((ext) => fs.existsSync(base + ext));
  if (!found) errors.push(`MISSING PAGE FILE: registry "${key}" imports "./${target}" — owner-vite/src/pages/${target}.tsx does not exist.`);
}

// ── --where resolver ────────────────────────────────────────────────────────
if (WHERE) {
  const url = WHERE.replace(/^https?:\/\/[^/]+/, '').split('?')[0] || '/';
  console.log(`\nWhich file serves "${url}"?\n`);
  const hit = navEntries.find((e) => e.href.split('?')[0] === url);
  if (hit) {
    const target = registry.get(hit.key);
    console.log(`  owner.cbedge.net${url}`);
    console.log(`    → owner-vite/src/pages/${target ?? '???'}.tsx   [nav "${hit.label}", key ${hit.key}]`
      + (target ? '' : '   ⚠ NO REGISTRY ENTRY — renders NotFound'));
  } else {
    console.log(`  owner.cbedge.net${url}`);
    console.log('    → nothing. No nav entry with that href; the SPA renders its 404.');
  }
  const slug = url.replace(/^\/owner\//, '');
  const nextFile = path.join('app', 'owner', slug, 'page.tsx');
  console.log(`\n  cbedge.net${url}`);
  console.log(fs.existsSync(path.join(ROOT, nextFile))
    ? `    → ${nextFile}${NEXT_OWNER_ALLOWED.has(slug) ? '   (allowlisted duplicate)' : '   ⚠ WRONG SURFACE for the owner site'}`
    : `    → nothing (no ${nextFile})`);
  console.log('\nThe owner site is owner-vite. Build there.\n');
  process.exit(0);
}

// ── report ──────────────────────────────────────────────────────────────────
if (errors.length === 0) {
  console.log(`[check-owner] OK — ${navEntries.length} nav entries, ${registry.size} registered pages, `
    + `${nextOwnerSlugs.length} Next owner page(s)${notes.length ? ` (${notes.join(', ')})` : ''}`);
  process.exit(0);
}

console.error('\nX Owner-surface check failed:\n');
for (const e of errors) console.error('  - ' + e + '\n');
console.error('  owner.cbedge.net  →  owner-vite/src/pages/  (nav.ts + registry.ts)');
console.error('  cbedge.net/owner  →  app/owner/<slug>/page.tsx  (allowlist: '
  + [...NEXT_OWNER_ALLOWED].join(', ') + ')\n');
console.error('  Resolve a URL:  node owner-vite/scripts/check-owner-pages.mjs --where /owner/<slug>\n');
process.exit(DRY ? 0 : 1);
