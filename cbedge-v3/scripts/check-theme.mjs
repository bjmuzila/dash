#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-theme.mjs — non-negotiable #1, enforced instead of remembered.
//
// v2's two recurring bugs were both invisible at write time and obvious a week
// later: text that came out grey because a page reached for Tailwind's default
// palette instead of the app's, and cards whose background was whatever the
// author guessed that day. v3 fixes both in `src/design/tokens.css` — `fg`,
// `muted` and `faint` all resolve to white, and the surface ladder is six named
// steps. None of that helps if a new page can still write `text-gray-400`.
//
// So this script fails the build on three things, anywhere under `src/`:
//
//   1. COLOUR LITERALS — `#rrggbb`, `rgb()`, `rgba()`, `hsl()`, `hsla()`.
//      tokens.css is the one file allowed to have them. A colour needed as a JS
//      string comes from `src/design/theme.ts` (`T.*`, `alpha()`, `mix()`),
//      which is `var(--color-…)` underneath, so it keeps tracking the token.
//
//   2. TAILWIND'S DEFAULT PALETTE — `text-gray-400`, `bg-zinc-900`,
//      `border-red-500`, … Tailwind v4 still ships it, and it is NOT a literal,
//      so a hex scanner alone would wave it straight through. This is the exact
//      class of mistake that produced v2's grey font. Note the shade number is
//      required, so the app's own token utilities (`text-muted`, `bg-surface`,
//      `text-violet`) are untouched.
//
//   3. UNKNOWN CSS VARIABLES — `var(--color-mutedd)`. A typo here does not throw
//      and does not warn; the element just renders with no colour at all, which
//      is a very expensive five minutes to find. Every `var(--…)` must resolve
//      to something declared in tokens.css, index.html, or the file itself.
//
// ── Why there is a baseline ──────────────────────────────────────────────────
//
// A check that fails on day one gets switched off on day one. `theme-baseline.
// json` records the violations that already exist, per file, and the build fails
// only when a file goes ABOVE its recorded number — so the rule binds every new
// page immediately while the ported ones get cleaned up on their own schedule.
//
// It ratchets, exactly like budgets.json: when a file comes in UNDER its
// baseline the run says so and asks you to re-record, and a file that reaches
// zero is dropped from the baseline entirely and can never regress.
//
// The first run WRITES the baseline and passes, with a loud notice. That is
// deliberate — installing this must not break the build you are already running.
//
//   node scripts/check-theme.mjs            check (this is what `npm run build` does)
//   node scripts/check-theme.mjs --update   re-record the baseline after cleaning up
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const TOKENS = join(SRC, 'design', 'tokens.css')
const INDEX_HTML = join(ROOT, 'index.html')
const BASELINE = join(ROOT, 'theme-baseline.json')

const UPDATE = process.argv.includes('--update')

/** tokens.css is the palette; it is the only file allowed to hold literals. */
const LITERAL_EXEMPT = new Set(['src/design/tokens.css'])

const EXTS = ['.ts', '.tsx', '.css', '.html']

// ── The three rules ──────────────────────────────────────────────────────────

// #rgb / #rgba / #rrggbb / #rrggbbaa. The length classes matter: `gex-chart#2`
// (a board instance id) and `#3` in prose must not read as colours.
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g
const FUNC = /\b(?:rgba?|hsla?)\s*\(/g

const TW_PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const TW_PROP =
  'text|bg|border|from|via|to|ring|outline|fill|stroke|shadow|decoration|divide|accent|caret|placeholder'
// The trailing shade number is what separates Tailwind's palette from ours:
// `text-violet` is a v3 token, `text-violet-400` is Tailwind's.
const TW_CLASS = new RegExp(`\\b(?:${TW_PROP})-(?:${TW_PALETTE})-(?:50|[1-9]00|950)\\b`, 'g')

const VAR_USE = /var\(\s*(--[a-zA-Z0-9_-]+)/g
// The optional quote is for a JS style object — `{ '--dim': x }` declares a
// custom property just as much as a stylesheet line does.
const VAR_DECL = /(--[a-zA-Z0-9_-]+)['"`]?\s*:/g

// ── Reading ──────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (EXTS.some((e) => name.endsWith(e))) out.push(p)
  }
  return out
}

/**
 * Comments out, so a doc comment explaining why `rgba(...)` is banned is not
 * itself a violation. `//` is only treated as a comment when it is not preceded
 * by a colon — otherwise every `https://` URL would swallow the rest of its
 * line and hide a real literal sitting after it.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

function collectDeclared() {
  const declared = new Set()
  for (const f of [TOKENS, INDEX_HTML]) {
    if (!existsSync(f)) continue
    for (const m of readFileSync(f, 'utf8').matchAll(VAR_DECL)) declared.add(m[1])
  }
  return declared
}

// ── Scanning ─────────────────────────────────────────────────────────────────

function scan() {
  const declaredGlobal = collectDeclared()
  const files = walk(SRC).sort()
  const byFile = new Map()

  for (const abs of files) {
    const rel = relative(ROOT, abs).replace(/\\/g, '/')
    // CRLF normalised FIRST. Every source file here is written on Windows, and
    // a stray `\r` is a line terminator to a regex — so `//.*$` matched nothing
    // and the comment stripper silently did nothing at all, which showed up as
    // a doc comment explaining the rule being reported as a breach of it.
    const raw = readFileSync(abs, 'utf8').replace(/\r\n?/g, '\n')
    const text = stripComments(raw)
    const hits = []

    if (!LITERAL_EXEMPT.has(rel)) {
      for (const m of text.matchAll(HEX)) {
        hits.push({ line: lineOf(text, m.index), rule: 'literal', found: m[0] })
      }
      for (const m of text.matchAll(FUNC)) {
        hits.push({ line: lineOf(text, m.index), rule: 'literal', found: `${m[0]}…)` })
      }
    }

    for (const m of text.matchAll(TW_CLASS)) {
      hits.push({ line: lineOf(text, m.index), rule: 'tailwind-palette', found: m[0] })
    }

    // A file may declare its own custom property (a grid width, a chart var);
    // that counts as declared for its own uses.
    const declaredHere = new Set([...text.matchAll(VAR_DECL)].map((m) => m[1]))
    for (const m of text.matchAll(VAR_USE)) {
      const name = m[1]
      // `var(--color-level-${level})` — a name built by interpolation. The
      // static half is not a variable and there is nothing to check.
      if (text[m.index + m[0].length] === '$') continue
      if (declaredGlobal.has(name) || declaredHere.has(name)) continue
      hits.push({ line: lineOf(text, m.index), rule: 'unknown-var', found: `var(${name})` })
    }

    if (hits.length) byFile.set(rel, hits)
  }
  return byFile
}

// ── Baseline ─────────────────────────────────────────────────────────────────

function counts(byFile) {
  const out = {}
  for (const [rel, hits] of [...byFile].sort()) out[rel] = hits.length
  return out
}

function writeBaseline(byFile) {
  const body = {
    _README:
      'Violations that already existed when check-theme.mjs was added. The build fails when a file goes ABOVE its number here. Clean a file up and run `npm run theme:update` to pull its number down; a file at zero is removed and can never regress. Never raise a number to make a build pass.',
    files: counts(byFile),
  }
  writeFileSync(BASELINE, `${JSON.stringify(body, null, 2)}\n`)
}

function readBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE, 'utf8'))
    return parsed?.files && typeof parsed.files === 'object' ? parsed.files : {}
  } catch {
    return null
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

const RULE_HELP = {
  literal:
    'colour literal — put the colour in src/design/tokens.css and use the token utility, or T.*/alpha() from src/design/theme.ts for a JS string',
  'tailwind-palette':
    "Tailwind's default palette — this is what made v2's text grey. Use the app's tokens: text-fg / text-muted / text-faint, bg-bg / bg-surface / bg-surface2 / bg-raised, border-line",
  'unknown-var':
    'no such CSS variable — check the spelling against src/design/tokens.css (an unknown var renders as nothing, silently)',
}

function report(byFile, base) {
  const over = []
  const under = []
  const gone = []

  for (const [rel, hits] of byFile) {
    const allowed = base[rel] ?? 0
    if (hits.length > allowed) over.push({ rel, hits, allowed })
    else if (hits.length < allowed) under.push({ rel, now: hits.length, allowed })
  }
  for (const rel of Object.keys(base)) {
    if (!byFile.has(rel)) gone.push(rel)
  }

  console.log('\ncheck-theme — colours, palette classes and CSS variables under src/\n')

  if (over.length) {
    for (const { rel, hits, allowed } of over) {
      const label = allowed > 0 ? ` (baseline allows ${allowed}, found ${hits.length})` : ''
      console.log(`  ✗ ${rel}${label}`)
      // Show the new ones only when the file is over an existing baseline; a
      // file with no baseline shows everything, capped so one bad paste does
      // not bury the summary.
      for (const h of hits.slice(0, 12)) {
        console.log(`      ${rel}:${h.line}  ${h.found}   — ${RULE_HELP[h.rule]}`)
      }
      if (hits.length > 12) console.log(`      … and ${hits.length - 12} more`)
    }
    console.log('')
  }

  if (under.length || gone.length) {
    for (const u of under) console.log(`  ↓ ${u.rel} is down to ${u.now} (baseline ${u.allowed})`)
    for (const g of gone) console.log(`  ✓ ${g} is clean`)
    console.log('\n  Run `npm run theme:update` to lock that in — a baseline with slack in it\n  has stopped enforcing anything.\n')
  }

  if (!over.length && !under.length && !gone.length) {
    const total = [...byFile.values()].reduce((n, h) => n + h.length, 0)
    console.log(total === 0 ? '  ✓ clean\n' : `  ✓ no new violations (${total} grandfathered)\n`)
  }

  return over.length === 0
}

// ── Main ─────────────────────────────────────────────────────────────────────

const byFile = scan()
const base = readBaseline()

if (UPDATE || base === null) {
  writeBaseline(byFile)
  const total = [...byFile.values()].reduce((n, h) => n + h.length, 0)
  if (base === null && !UPDATE) {
    console.log(
      `\ncheck-theme — first run. Recorded ${total} existing violation(s) across ${byFile.size} file(s)\n` +
        `in theme-baseline.json and PASSED, so installing this does not break your build.\n` +
        `From here the build fails if any file goes above its recorded number, and every\n` +
        `file not listed must stay at zero.\n`,
    )
  } else {
    console.log(`\ncheck-theme — baseline updated: ${total} violation(s) across ${byFile.size} file(s).\n`)
  }
  process.exit(0)
}

if (!report(byFile, base)) {
  console.log('  Non-negotiable #1 (cbedge-v3/AGENTS.md). Fix the lines above — do NOT raise the baseline.\n')
  process.exit(1)
}
