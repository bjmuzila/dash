#!/usr/bin/env node
/**
 * apply-gex-multi-error-msg.mjs — follow-up to apply-gex-cards.mjs.
 *
 * Replaces the opaque `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`
 * on the two multi-expiry net-gamma cards with a message that names the real
 * cause: server-v2 answering without /proxy/gex-by-strike-multi, so the request
 * falls through to Next and comes back as an HTML 404 page.
 *
 * Purely cosmetic — it changes nothing about the data path. Run it any time.
 * Requires apply-gex-cards.mjs to have been run first.
 *
 * Run from the repo root:  node apply-gex-multi-error-msg.mjs
 *   --dry   report what would change, write nothing
 *   --file <path>  target a different file (default app/test/page.tsx)
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const fi = argv.indexOf('--file');
const TARGET = fi !== -1 ? argv[fi + 1] : 'app/test/page.tsx';

// [anchor, replacement, label]
const EDITS = [
  [
    "      const res = await fetch(`/proxy/gex-by-strike-multi?symbol=${encodeURIComponent(symbol)}`, { cache: \"no-store\" });\r\n      const json = await res.json();\r\n",
    "      const res = await fetch(`/proxy/gex-by-strike-multi?symbol=${encodeURIComponent(symbol)}`, { cache: \"no-store\" });\r\n      // Guard the parse. When server-v2 is running without this route (i.e. it\r\n      // hasn't been redeployed yet) the request falls through to Next, which\r\n      // answers with an HTML 404 page \u2014 and res.json() on HTML throws\r\n      // `Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON`, which reads\r\n      // like a data bug instead of a missing endpoint. Say what it actually is.\r\n      const ct = res.headers.get(\"content-type\") || \"\";\r\n      if (!ct.includes(\"application/json\")) {\r\n        throw new Error(\r\n          res.status === 404 || ct.includes(\"text/html\")\r\n            ? \"endpoint /proxy/gex-by-strike-multi not found \u2014 server-v2 needs a restart/redeploy to pick up the route\"\r\n            : `unexpected ${ct || \"empty\"} response (HTTP ${res.status})`\r\n        );\r\n      }\r\n      const json = await res.json();\r\n",
    "useGexByStrikeMulti: explain a missing endpoint instead of an HTML parse error"
  ]
];

if (!existsSync(TARGET)) {
  console.error(`not found: ${TARGET}  (run this from the repo root, or pass --file)`);
  process.exit(2);
}

const original = readFileSync(TARGET, 'utf8');
let src = original;
const applied = [], already = [], missing = [];

for (const [anchor, replacement, label] of EDITS) {
  const hits = src.split(anchor).length - 1;
  if (hits === 1) {
    src = src.replace(anchor, replacement);
    applied.push(label);
  } else if (hits === 0 && src.includes(replacement)) {
    already.push(label);                       // idempotent re-run
  } else {
    missing.push({ label, hits });
  }
}

const w = (s) => process.stdout.write(s + '\n');
w('');
w(`${TARGET}`);
w(`  applied  ${applied.length}`);
w(`  already  ${already.length}`);
w(`  missing  ${missing.length}`);
for (const a of applied) w(`    + ${a}`);
for (const a of already) w(`    = ${a} (already present)`);
for (const m of missing) w(`    ! ${m.label} — anchor found ${m.hits}x, expected 1`);

if (missing.length) {
  w('');
  w('NOTHING WRITTEN. An anchor above did not resolve, which means that exact');
  w('block of the file changed. Fix by hand, or send me `git diff -- ' + TARGET + '`');
  w('and I will rebuild the edit against your current version.');
  process.exit(1);
}

if (!applied.length) {
  w('');
  w('All edits already present — nothing to do.');
  process.exit(0);
}

if (dry) {
  w('');
  w(`--dry: ${applied.length} edit(s) would be applied, nothing written.`);
  process.exit(0);
}

copyFileSync(TARGET, TARGET + '.bak');
writeFileSync(TARGET, src);
w('');
w(`Wrote ${TARGET}  (backup at ${TARGET}.bak)`);
w(`${original.length} -> ${src.length} bytes`);
