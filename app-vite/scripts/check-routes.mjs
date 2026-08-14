#!/usr/bin/env node
/**
 * Vite route guard — stops the "new page silently becomes Next-only" drift.
 *
 * Runs as app-vite's `prebuild`, so `npm run build` (local AND the Docker
 * deploy) fails LOUDLY when:
 *   1) app-vite/src/App.tsx imports a page file that doesn't exist (a deleted
 *      page like /greeks — this is what broke a deploy), or
 *   2) a customer toolbar nav item (GlobalToolbar NAV_ITEMS) points at an
 *      in-app route that has no matching <Route> in App.tsx — i.e. it would
 *      redirect to /traders-dashboard, or
 *   3) ANY module reachable from App.tsx imports a local file that isn't there, or
 *   4) a <Route> in App.tsx has no Next shell handler at app/app/<path>/route.ts
 *      — the route works via in-app nav but a hard refresh / pasted link 404s.
 *
 * WHY 3 EXISTS. Check 1 only looks at App.tsx's OWN imports, one level deep.
 * Deleting app/test/DexCharmTab.tsx sailed past this guard and then failed the
 * Docker build two minutes later, because the dangling import lived in
 * components/pages/TestLab.tsx — four hops down the graph. Rollup catches
 * these, but only after npm install and a full Next build have already run on
 * the VPS. Check 3 is the same check, statically, in a fraction of a second.
 *
 * Run `node app-vite/scripts/check-routes.mjs --dry` to see the walk without
 * failing anything.
 *
 * One deliberate difference from Rollup: `import type { X } from './gone'` is
 * checked here even though esbuild erases it and the bundle would build. The
 * file still doesn't exist, tsc still fails on it, and `next build` runs with
 * type validation skipped — so it would otherwise ship silently.
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

// ---- (4) every SPA route needs a Next shell handler ----
//
// The SPA is client-routed, but the FIRST request for /app/<x> is a normal
// document request that Next answers. Each route therefore needs its own tiny
// app/app/<x>/route.ts calling serveSpaShell('app'). Miss it and the route
// works perfectly via in-app navigation while a hard refresh, a pasted link or
// a bookmark falls through to the Next 404 — which is exactly how /app/replay
// and /app/strike-history shipped broken.
const SHELL_EXEMPT = new Set([
  '*',  // catch-all -> /traders-dashboard
  '/m', // bare phone path is a <Navigate> to /m/gex
]);
for (const p of routePaths) {
  if (SHELL_EXEMPT.has(p)) continue;
  if (!p.startsWith('/')) continue;
  const handler = join(ROOT, 'app', 'app', ...p.slice(1).split('/'), 'route.ts');
  if (DRY) { console.log('  shell ' + p + ' -> ' + (existsSync(handler) ? 'has route.ts' : 'NO route.ts')); continue; }
  if (!existsSync(handler)) {
    errors.push('SPA route "' + p + '" has no Next shell handler at app/app' + p + '/route.ts'
      + ' — in-app nav works but a hard refresh on /app' + p + ' 404s. Create that file with:'
      + ' import { serveSpaShell } from "@/lib/serveSpaShell"; export const dynamic = "force-dynamic";'
      + ' export const GET = () => serveSpaShell("app");');
  }
}

// ---- (3) the WHOLE graph reachable from App.tsx must resolve ----
//
// Deliberately NOT a parser. A regex over import/export-from specifiers answers
// "does this path exist", which is the entire question. The cost of a FALSE
// POSITIVE here is a build that fails for no reason, so two things guard
// against it: comments are stripped first (a commented-out `import('./Old')`
// used to be the obvious trap), and only specs that are unambiguously local —
// '@/…' or './…' — are ever reported. Bare specifiers are node_modules or the
// three next/* shims aliased in vite.config.ts, and are skipped untouched.
const SOURCE_EXT = /\.(tsx?|jsx?|mjs)$/;

/**
 * Blank out comments so a commented-out import can't be mistaken for a real
 * one. Replaces them with spaces rather than deleting, so nothing on either
 * side of a comment can be glued into a new token. Quote-aware, because
 * `const s = "// not a comment"` and a URL's `https://…` both otherwise eat the
 * rest of the line.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

function specsIn(raw) {
  const src = stripComments(raw);
  const out = new Set();
  //  import x from 'y' · import 'y' · import type {a} from 'y'
  for (const m of src.matchAll(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) out.add(m[1]);
  //  export {a} from 'y' · export * from 'y'
  for (const m of src.matchAll(/^\s*export\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/gm)) out.add(m[1]);
  //  await import('y') · lazy(() => import('y')).  Template literals are NOT
  //  matched — a computed path isn't statically checkable and guessing is worse
  //  than skipping.
  for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.add(m[1]);
  return out;
}

/** Resolve a local spec the way Vite would. Returns a path, or null. */
function resolveLocal(spec, fromDir) {
  const base = spec.startsWith('@/') ? join(ROOT, spec.slice(2)) : join(fromDir, spec);
  // An explicit extension ('./x.css', './x.json') resolves as written.
  if (/\.[a-z0-9]+$/i.test(base) && existsSync(base)) return base;
  for (const ext of ['.tsx', '.ts', '.jsx', '.js', '.mjs',
                     '/index.tsx', '/index.ts', '/index.jsx', '/index.js']) {
    if (existsSync(base + ext)) return base + ext;
  }
  return existsSync(base) ? base : null;
}

const seen = new Set();
const queue = [appTsxPath];
const dangling = [];
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { continue; }
  const dir = dirname(file);
  for (const spec of specsIn(raw)) {
    if (!spec.startsWith('@/') && !spec.startsWith('.')) continue;
    const hit = resolveLocal(spec, dir);
    if (!hit) { dangling.push({ from: file.slice(ROOT.length + 1), spec }); continue; }
    // Follow source only. A resolved .css / .json / image is a leaf.
    if (SOURCE_EXT.test(hit)) queue.push(hit);
  }
}

if (DRY) {
  console.log('  walked ' + seen.size + ' modules from App.tsx; ' + dangling.length + ' dangling import(s)');
  for (const d of dangling) console.log('    MISSING ' + d.spec + '  (from ' + d.from + ')');
}
for (const d of dangling) {
  errors.push(d.from + ' imports "' + d.spec + '" but that file does not exist. '
    + 'Remove the import and whatever used it, or restore the file.');
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
console.log('OK Vite route check passed — every toolbar item has a route, and all '
  + seen.size + ' modules reachable from App.tsx resolve every local import.');
