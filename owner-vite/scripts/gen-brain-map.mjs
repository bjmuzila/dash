#!/usr/bin/env node
/**
 * gen-brain-map.mjs — snapshot every live source file + its import links for
 * the owner Hub "Brain" tabs:
 *
 *   owner-vite/src/lib/brainMap.json    CB Edge  (cbedge-v3, server-v2, owner-vite)
 *   owner-vite/src/lib/voltickMap.json  Voltick  (web/src, server, root engine
 *                                        modules, theta-proxy, theta-stream)
 *   ..\Voltick\admin-site/brain-data.js same Voltick map as `window.VOLTICK_BRAIN`
 *                                        for the Brain page on the Voltick admin
 *                                        site (a plain <script> so it works from disk)
 *
 * Why a snapshot: `docker compose build owners` uses context ./owner-vite, so
 * the build can't see the other trees (and Voltick is a separate repo). Re-run
 * this and commit the two JSON files:
 *
 *   node owner-vite/scripts/gen-brain-map.mjs            (both)
 *   node owner-vite/scripts/gen-brain-map.mjs --only=voltick
 *
 * Paths: CB Edge = two levels up from this file. Voltick = the `Voltick` folder
 * next to the repo (C:\Users\Brandon\Desktop\Voltick), or VOLTICK_ROOT. A tree
 * that isn't there is skipped and its JSON left as it was.
 *
 * Dead CB Edge trees (Vanilla/, server/, testui/, home3-vite/, root *.html,
 * v2 app/ components/ app-vite/) and all tests are never scanned.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CB_ROOT = process.env.BRAIN_ROOT ? path.resolve(process.env.BRAIN_ROOT) : path.resolve(HERE, '..', '..');
const VT_ROOT = process.env.VOLTICK_ROOT ? path.resolve(process.env.VOLTICK_ROOT) : path.resolve(CB_ROOT, '..', 'Voltick');
const LIB = path.resolve(HERE, '..', 'src', 'lib');

const BRAINS = [
  {
    name: 'CB Edge',
    root: CB_ROOT,
    out: 'brainMap.json',
    apps: [
      { id: 'v3', label: 'cbedge-v3', dir: 'cbedge-v3/src', alias: 'cbedge-v3/src' },
      { id: 'server', label: 'server-v2', dir: 'server-v2' },
      { id: 'owner', label: 'owner-vite', dir: 'owner-vite/src', alias: 'owner-vite/src' },
    ],
    skipDir: ['MVC', 'demos', 'charts'],
    bridges: { api: 'server-v2/api-router.js', ws: 'server-v2/websocket-server.js', from: ['v3', 'owner'] },
  },
  {
    name: 'Voltick',
    root: VT_ROOT,
    out: 'voltickMap.json',
    alsoJs: { file: 'admin-site/brain-data.js', global: 'VOLTICK_BRAIN' },
    apps: [
      { id: 'web', label: 'web', dir: 'web/src' },
      { id: 'server', label: 'server', dir: 'server' },
      { id: 'engine', label: 'root modules', dir: '', shallow: true },
      { id: 'theta', label: 'theta-proxy', dir: 'theta-proxy', shallow: true },
      { id: 'stream', label: 'theta-stream', dir: 'theta-stream', shallow: true },
    ],
    skipDir: ['test', 'tests', 'chains', 'flow', 'liveagent-days', 'logos', 'fixtures'],
    skipFile: /^test_|\.selftest\.|\.test\./,
    bridges: { api: 'server/server.js', ws: 'server/server.js', from: ['web'] },
  },
];

const EXT = /\.(tsx?|jsx?|mjs|cjs|css|py)$/;
const ALWAYS_SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'assets', '__pycache__']);

function walk(dir, skip, shallow, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!shallow && !ALWAYS_SKIP.has(e.name) && !skip.has(e.name)) walk(p, skip, false, out); }
    else if (EXT.test(e.name) && !/\.(bak|log)$|\.d\.ts$|^\./.test(e.name)) out.push(p);
  }
  return out;
}

const TRY = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
const IMPORT_RE = /(?:import\s[^'"`]*?from\s*|import\s*\(\s*|import\s+|require\s*\(\s*|export\s[^'"`]*?from\s*)['"]([^'"\n]+)['"]/g;

function build(b) {
  if (!fs.existsSync(b.root)) { console.log(`${b.name}: ${b.root} not found — skipped`); return; }
  const skip = new Set(b.skipDir || []);
  const rel = (p) => path.relative(b.root, p).split(path.sep).join('/');
  const files = new Map();
  b.apps.forEach((a, ai) => {
    for (const abs of walk(path.join(b.root, a.dir), skip, a.shallow)) {
      const r = rel(abs);
      if (b.skipFile && b.skipFile.test(path.basename(r))) continue;
      if (!files.has(r)) files.set(r, { ai, app: a, abs });
    }
  });
  const resolveSpec = (fromRel, spec, app) => {
    let base;
    if (spec.startsWith('.')) base = path.posix.join(path.posix.dirname(fromRel), spec);
    else if (spec.startsWith('@/') && app.alias) base = path.posix.join(app.alias, spec.slice(2));
    else return null;
    base = base.replace(/\?.*$/, '');
    for (const t of TRY) if (files.has(base + t)) return base + t;
    const noExt = base.replace(/\.(js|jsx|mjs)$/, '');
    for (const t of ['.ts', '.tsx']) if (files.has(noExt + t)) return noExt + t;
    return null;
  };

  const ids = [...files.keys()].sort();
  const idx = new Map(ids.map((id, i) => [id, i]));
  const nodes = [];
  const links = [];
  const seen = new Set();
  const br = b.bridges;
  for (const r of ids) {
    const { ai, app, abs } = files.get(r);
    let src = '';
    try { src = fs.readFileSync(abs, 'utf8'); } catch {}
    nodes.push([r, ai, src ? src.split('\n').length : 0]);
    if (r.endsWith('.py')) continue;
    for (const m of src.matchAll(IMPORT_RE)) {
      const t = resolveSpec(r, m[1], app);
      if (!t || t === r) continue;
      const k = r + '>' + t;
      if (seen.has(k)) continue;
      seen.add(k);
      links.push([idx.get(r), idx.get(t), 0]);
    }
    // client → server bridges (kind 1): calls the API / opens the socket
    if (br && br.from.includes(app.id)) {
      if (files.has(br.api) && /['"`]\/api\//.test(src)) links.push([idx.get(r), idx.get(br.api), 1]);
      else if (files.has(br.ws) && /new\s+WebSocket\s*\(/.test(src)) links.push([idx.get(r), idx.get(br.ws), 1]);
    }
  }
  // Compact rows:  nodes [path, appIndex, lines]   links [from, to, kind]
  const out = {
    name: b.name,
    generated: new Date().toISOString().slice(0, 10),
    apps: b.apps.map(({ id, label, dir }) => ({ id, label, dir })),
    nodes,
    links,
  };
  fs.mkdirSync(LIB, { recursive: true });
  fs.writeFileSync(path.join(LIB, b.out), JSON.stringify(out));
  console.log(`${b.name}: ${nodes.length} files, ${links.length} links -> src/lib/${b.out}`);
  if (b.alsoJs && fs.existsSync(path.join(b.root, path.dirname(b.alsoJs.file)))) {
    const js = `/* Generated by gen-brain-map.mjs (CB Edge repo) — do not edit. ${out.generated} */\nwindow.${b.alsoJs.global} = ${JSON.stringify(out)};\n`;
    fs.writeFileSync(path.join(b.root, b.alsoJs.file), js);
    console.log(`${b.name}: also -> ${b.alsoJs.file}`);
  }
}

// --only=voltick / --only=cbedge limits the run (the Voltick git hooks use
// --only=voltick so a sync there never touches this repo's files).
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
for (const b of BRAINS) if (!only || b.name.toLowerCase().replace(/\s+/g, '') === only) build(b);
