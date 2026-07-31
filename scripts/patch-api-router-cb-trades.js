'use strict';
/**
 * scripts/patch-api-router-cb-trades.js
 *
 * Adds the /api/cb-trades route (and the cb-contract-track require it needs) to
 * server-v2/api-router.js, IN PLACE, without rewriting the rest of the file.
 *
 *   node scripts/patch-api-router-cb-trades.js
 *   node scripts/patch-api-router-cb-trades.js --check     (report only, no write)
 *
 * WHY A PATCH SCRIPT AND NOT A NEW FILE
 *   Two things went wrong shipping this route by hand, and both are the reason
 *   this exists:
 *
 *   1. CRLF. api-router.js is checked in with Windows line endings. The edits
 *      that produced the route were made with tooling that rewrote the file as
 *      LF, so a ~50-line change surfaced in git as all ~7,000 lines changed.
 *      A whole-file diff like that is indistinguishable from a clobber, and it
 *      is the most likely reason the change was discarded rather than committed.
 *      This script detects the file's dominant ending and writes the inserted
 *      block to match, leaving every other byte untouched.
 *
 *   2. Concurrent edits. api-router.js grew ~1.6KB from other work while this
 *      route was being written. Re-sending a whole copy of the file would have
 *      silently reverted that. Two anchored insertions cannot.
 *
 * Idempotent: run it twice and the second run reports "already present" and
 * writes nothing. Safe to re-run after a pull that reverts it again.
 *
 * Verify afterwards:
 *   node --check server-v2/api-router.js
 *   git diff --stat server-v2/api-router.js     → should be ~+75 lines, 1 file
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'server-v2', 'api-router.js');
const CHECK_ONLY = process.argv.includes('--check');

const REQUIRE_BLOCK = [
  '// CB contract trade tracker — probes the CB-strike 0DTE contract on TastyTrade',
  '// at 9:45/10:30/12:00, walks toward the money to the first strike over $1.00,',
  '// then auto-sells inside the 5-10 pt band of the CB. Plain server-v2 module',
  '// (no esbuild step); it owns its own tables via libDb.getPool(). Loaded',
  '// defensively: without it the /api/cb-trades route below is simply never',
  '// registered and nothing else in this file changes behaviour.',
  'let cbTrack = null;',
  "try { cbTrack = require('./cb-contract-track'); }",
  "catch (e) { console.warn('[api-router] cb-contract-track not loaded — contract tracking off:', e.message); }",
];

// Anchored immediately before /api/bzila-alerts, which sits inside the same
// `if (libDb) { … }` block — libDb has to be in scope for the route's reads.
const ROUTE_BLOCK = fs.readFileSync(path.join(__dirname, 'cb-trades-route.snippet'), 'utf8');

function detectEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length;
  return crlf > lf / 2 ? '\r\n' : '\n';
}

function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`✗ not found: ${FILE}`);
    process.exit(1);
  }
  const original = fs.readFileSync(FILE, 'utf8');
  const eol = detectEol(original);
  console.log(`api-router.js — ${original.length} bytes, ${eol === '\r\n' ? 'CRLF' : 'LF'} line endings`);

  const hasRequire = /require\('\.\/cb-contract-track'\)/.test(original);
  const hasRoute = /register\('\/api\/cb-trades'/.test(original);
  console.log(`  require present: ${hasRequire}`);
  console.log(`  route present:   ${hasRoute}`);

  if (hasRequire && hasRoute) {
    console.log('✓ already patched — nothing to do');
    return;
  }

  let out = original;

  if (!hasRequire) {
    // The _lib-confidence-route loader is a stable, unique landmark that sits
    // with the other defensive requires at the top of the file.
    const anchor = "catch (e) { console.warn('[api-router] _lib-confidence-route.cjs not loaded:', e.message); }";
    const at = out.indexOf(anchor);
    if (at === -1) {
      console.error('✗ could not find the require anchor (_lib-confidence-route loader). File shape changed — patch by hand.');
      process.exit(2);
    }
    const insertAt = at + anchor.length;
    out = out.slice(0, insertAt) + eol + REQUIRE_BLOCK.join(eol) + out.slice(insertAt);
    console.log('  + inserted the cb-contract-track require');
  }

  if (!hasRoute) {
    const anchor = "  // /api/bzila-alerts — owner-authored toolbar broadcasts.";
    const at = out.indexOf(anchor);
    if (at === -1) {
      console.error('✗ could not find the route anchor (/api/bzila-alerts comment). File shape changed — patch by hand.');
      process.exit(2);
    }
    const block = ROUTE_BLOCK.replace(/\r?\n/g, eol).replace(/\s+$/, '');
    out = out.slice(0, at) + block + eol + eol + out.slice(at);
    console.log('  + inserted the /api/cb-trades route');
  }

  if (CHECK_ONLY) {
    console.log('… --check given, not writing');
    return;
  }
  fs.writeFileSync(FILE, out, 'utf8');
  const added = out.split(eol).length - original.split(eol).length;
  console.log(`✓ written — ${out.length} bytes (+${out.length - original.length}), +${added} lines`);
  console.log('  now run:  node --check server-v2/api-router.js');
}

main();
