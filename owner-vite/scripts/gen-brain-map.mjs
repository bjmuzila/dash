#!/usr/bin/env node
/**
 * gen-brain-map.mjs — snapshot every live CB Edge source file + its import
 * links into owner-vite/src/lib/brainMap.json for the Hub "Brain" view.
 *
 * Why a snapshot: `docker compose build owners` uses context ./owner-vite, so
 * the build cannot see cbedge-v3/ or server-v2/. Re-run this from the repo root
 * (or anywhere — paths resolve from this file) and commit the JSON:
 *
 *   node owner-vite/scripts/gen-brain-map.mjs
 *
 * Scope = the three live surfaces. Dead trees (Vanilla/, server/, testui/,
 * home3-vite/, root *.html, v2 app/ components/ app-vite/) are never scanned.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.BRAIN_ROOT ? path.resolve(process.env.BRAIN_ROOT) : path.resolve(HERE, '..', '..');
const OUT = path.resolve(HERE, '..', 'src', 'lib', 'brainMap.json');

const APPS = [
  { id: 'v3', label: 'cbedge-v3', dir: 'cbedge-v3/src', alias: 'cbedge-v3/src' },
  { id: 'server', label: 'server-v2', dir: 'server-v2', alias: null },
  { id: 'owner', label: 'owner-vite', dir: 'owner-vite/src', alias: 'owner-vite/src' },
];
const EXT = /\.(tsx?|jsx?|mjs|cjs|css)$/;
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', '.git', 'MVC', 'demos', 'charts', 'assets']);
const SKIP_FILE = /\.(bak|log|d\.ts)$|^\./;

function walk(dir, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(p, out); }
    else if (EXT.test(e.name) && !SKIP_FILE.test(e.name)) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const files = new Map(); // rel path -> {app, abs}
for (const a of APPS) {
  for (const abs of walk(path.join(ROOT, a.dir))) files.set(rel(abs), { app: a, abs });
}

const TRY = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '/index.ts', '/index.tsx', '/index.js'];
function resolveSpec(fromRel, spec, app) {
  let base;
  if (spec.startsWith('.')) base = path.posix.join(path.posix.dirname(fromRel), spec);
  else if (spec.startsWith('@/') && app.alias) base = path.posix.join(app.alias, spec.slice(2));
  else return null;
  base = base.replace(/\?.*$/, '');
  for (const t of TRY) if (files.has(base + t)) return base + t;
  // TS convention: import './x.js' that is really x.ts
  const noExt = base.replace(/\.(js|jsx|mjs)$/, '');
  for (const t of ['.ts', '.tsx']) if (files.has(noExt + t)) return noExt + t;
  return null;
}

const IMPORT_RE = /(?:import\s[^'"`]*?from\s*|import\s*\(\s*|import\s+|require\s*\(\s*|export\s[^'"`]*?from\s*)['"]([^'"\n]+)['"]/g;

const nodes = [];
const links = [];
const seen = new Set();
const API_TARGET = 'server-v2/api-router.js';
const WS_TARGET = 'server-v2/websocket-server.js';

for (const [r, { app, abs }] of files) {
  let src = '';
  try { src = fs.readFileSync(abs, 'utf8'); } catch {}
  const lines = src ? src.split('\n').length : 0;
  nodes.push({ id: r, app: app.id, lines });
  for (const m of src.matchAll(IMPORT_RE)) {
    const t = resolveSpec(r, m[1], app);
    if (!t || t === r) continue;
    const k = r + '>' + t;
    if (seen.has(k)) continue;
    seen.add(k);
    links.push([r, t, 0]);
  }
  // Cross-app bridges: client files that call the API / open the socket.
  if (app.id !== 'server' && files.has(API_TARGET) && /['"`]\/api\//.test(src)) {
    links.push([r, API_TARGET, 1]);
  }
  if (app.id !== 'server' && files.has(WS_TARGET) && /new\s+WebSocket\s*\(/.test(src)) {
    links.push([r, WS_TARGET, 1]);
  }
}

// Compact form — the Hub ships this JSON, so index-based rows keep it small:
//   nodes: [path, appIndex, lineCount]    links: [fromIndex, toIndex, kind]
//   kind 0 = import/require, 1 = client→server bridge (/api/ or WebSocket)
nodes.sort((a, b) => a.id.localeCompare(b.id));
const idx = new Map(nodes.map((n, i) => [n.id, i]));
const appIdx = new Map(APPS.map((a, i) => [a.id, i]));
const out = {
  generated: new Date().toISOString().slice(0, 10),
  apps: APPS.map(({ id, label, dir }) => ({ id, label, dir })),
  nodes: nodes.map((n) => [n.id, appIdx.get(n.app), n.lines]),
  links: links.map(([s, t, k]) => [idx.get(s), idx.get(t), k]),
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`brainMap: ${nodes.length} files, ${links.length} links -> ${OUT}`);
