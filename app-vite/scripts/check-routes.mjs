#!/usr/bin/env node
/**
 * Vite route guard — stops the "new page silently becomes Next-only" drift.
 *
 * Runs as app-vite's `prebuild`, so `npm run build` (local AND the Docker
 * deploy) fails LOUDLY when:
 *   1) app-vite/src/App.tsx imports a page file that doesn't exist (a deleted
 *      page like /greeks — this is what broke the last deploy), or
 *   2) a customer toolbar nav item (GlobalToolbar NAV_ITEMS) points at an
 *      in-app route that has no matching <Route> in App.tsx — i.e. it would
 *      redirect to /traders-dashboard.
 *
 * The repo is a Next.js app with a Vite SPA sub-build (app-vite/) serving the
 * customer dashboard at /app/*. A new dashboard page needs BOTH a client
 * `app/<x>/page.tsx` AND a route here. This guard enforces the second half.
 *
 * Intentional exception (a toolbar item that is deliberately a Next page):
 * add its href to NEXT_ONLY below.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const DRY = process.argv.includes('--dry');
const ROOT = process.env.CHECK_ROOT
  ? resolve(process.env.CHECK_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'); // app-vite/scripts -> repo root

// Toolbar hrefs that are intentionally NOT Vite routes (Next content/external).
const NEXT_ONLY = new Set([]);

const appTsxPath = join(ROOT, 'app-vite', 'src', 'App.tsx');
const toolbarPath = join(ROOT, 'components', 'shared', 'GlobalToolbar.tsx');
const errors = [];

const appSrc = readFileSync(appTsxPath, 'utf8');
const appDir = dirname(appTsxPath);

// ---- (1) every imported page module must resolve to a real file ----
const specs = new Set();
for (const m of appSrc.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.add(m[1]);           // lazy()
for (const m of appSrc.matchAll(/^\s*import\s+[\w{}*\s,]+\s+from\s+['"]([^'"]+)['"]/gm)) specs.add(m[1]); // static
const resolveSpec = (spec) => {
  let base;
  if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = join(appDir, spec);
  else return 'skip'; // node module / css
  for (const ext of ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js']) {
    if (existsSync(base + ext)) return base + ext;
  }
  return existsSync(base) ? base : null;
};
const pageSpecs = [...specs].filter((s) => s.startsWith('@/app') || s.startsWith('./routes'));
for (const s of pageSpecs) {
  const r = resolveSpec(s);
  if (DRY) { console.log('  import ' + s + ' -> ' + (r === 'skip' ? '(skip)' : r ? 'OK' : 'MISSING')); continue; }
  if (r === null) errors.push('App.tsx imports "' + s + '" but that file does not exist (deleted page?). Remove its import + <Route>, or restore the file.');
}

// ---- (2) toolbar nav items must have a matching route ----
const routePaths = new Set([...appSrc.matchAll(/<Route\s+path=["']([^"']+)["']/g)].map((x) => x[1]));
const toolbarSrc = readFileSync(toolbarPath, 'utf8');
const navBlock = (toolbarSrc.match(/NAV_ITEMS[^=]*=\s*\[([\s\S]*?)\n\];/) || [])[1] || '';
const navItems = [];
for (const m of navBlock.matchAll(/\{[^}]*\bhref:\s*["']([^"']+)["'][^}]*\}/g)) navItems.push({ href: m[1], block: m[0] });
if (DRY) console.log('  parsed ' + navItems.length + ' toolbar nav items; ' + routePaths.size + ' routes');
for (const { href, block } of navItems) {
  if (!href.startsWith('/')) continue;
  if (/comingSoon:\s*true/.test(block)) continue;
  if (/extHref:/.test(block)) continue;
  if (/ownerOnly:\s*true/.test(block)) continue;
  if (NEXT_ONLY.has(href)) continue;
  if (DRY) { console.log('  nav ' + href + ' -> ' + (routePaths.has(href) ? 'has route' : 'NO ROUTE')); continue; }
  if (!routePaths.has(href)) errors.push('Toolbar nav item "' + href + '" has no <Route path="' + href + '"> in app-vite/src/App.tsx — it will redirect to /traders-dashboard. Add the route (client-component page) or remove the item.');
}

if (DRY) process.exit(0);
if (errors.length) {
  console.error('');
  console.error('X Vite route check failed — a page would be Next-only or broken:');
  for (const e of errors) console.error('  - ' + e);
  console.error('');
  console.error('(app-vite/scripts/check-routes.mjs — add an href to NEXT_ONLY there for an intentional Next-only page.)');
  console.error('');
  process.exit(1);
}
console.log('OK Vite route check passed — every toolbar item has a route and every App.tsx page import resolves.');
