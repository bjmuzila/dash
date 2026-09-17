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
// So this script fails the build on four things, anywhere under `src/`:
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
//      is a very expensive five minutes to find. Every `var(--…)` must be
//      DECLARED SOMEWHERE under src/ (or in index.html).
//
//      App-wide, not per file, and that is not laziness. The premarket page
//      declares a v2-compatible alias layer on `.pmk` — `--panel`, `--dim`,
//      `--line2`, built out of v3 tokens — and every component rendered inside
//      that page reads those names from its OWN file. Cross-file by design, and
//      correct. Scoping the rule per file would flag every one of them, and a
//      check that cries wolf on working code gets switched off.
//
//   4. TYPE SIZES OFF THE SCALE — `text-[10px]`, `font-size:11.5px`,
//      `fontSize: 12`. Same disease as the colours, and the one that actually
//      gets felt: v2's pages each picked their own sizes and no two agreed, so
//      "make the font the same throughout" became a permanent chore. The scale
//      in tokens.css is the answer — `text-3xs` 9, `text-2xs` 10, `text-xs` 11,
//      `text-sm` 13, `text-base` 15, `text-lg` 18, `text-xl` 24, `text-2xl` 32
//      — and this rule is what stops a page quietly adding a ninth size. Canvas
//      and SVG cannot use a class, so they read the number off the same scale
//      rather than typing one.
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
// ── Why there is a --fix ─────────────────────────────────────────────────────
//
// Rule 4 was blocking a commit a week, and always on the same thing: a size
// that is ALREADY ON THE SCALE, typed as a literal. `text-[10px]` is not a
// design decision, it is `text-2xs` spelled the way Tailwind teaches you to
// spell it — and the rewrite is mechanical, which means a human doing it by
// hand is a human being taxed for nothing.
//
// So --fix does exactly the substitutions that are provably safe and leaves
// everything else alone:
//
//   text-[10px]        →  text-2xs                 (Tailwind arbitrary value)
//   font-size:10px     →  font-size:var(--text-2xs) (CSS, incl. template CSS)
//
// A size that is NOT on the scale is untouched and still fails. That is the
// point: 11.5px is a real decision and belongs to a person, not to a script.
//
// `fontSize: 10` in JS is deliberately NOT auto-fixed. That regex matches two
// different things — a React style object, where `var(--text-2xs)` is correct,
// and a chart library's config, where it must stay a NUMBER (`ctx.font` and
// lightweight-charts do not resolve custom properties). No script can tell
// them apart from the outside, and a fix that silently blanks a chart's labels
// is worse than the lint it removed. Those still report, and the message names
// both answers.
//
//   node scripts/check-theme.mjs            check (this is what `npm run build` does)
//   node scripts/check-theme.mjs --fix      rewrite the mechanical ones, then check
//   node scripts/check-theme.mjs --update   re-record the baseline after cleaning up
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const INDEX_HTML = join(ROOT, 'index.html')
const BASELINE = join(ROOT, 'theme-baseline.json')

const UPDATE = process.argv.includes('--update')
const FIX = process.argv.includes('--fix')

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

// Rule 4. An arbitrary Tailwind size, a CSS declaration, or a JS/canvas number.
// The JS form is deliberately narrow — `fontSize:` with a bare number — so it
// catches style objects and ctx.font builders without touching anything that
// interpolates a scale constant.
const TYPE_ARBITRARY = /\btext-\[[0-9.]+(?:px|rem|em)\]/g
const TYPE_CSS = /font-size\s*:\s*[0-9.]+(?:px|rem|em)/g
const TYPE_JS = /\bfontSize\s*:\s*[0-9.]+/g

/**
 * THE SCALE, as data rather than as prose in an error string. `--fix` rewrites
 * against this and the help text below is generated from it, so the two cannot
 * drift — which they did the first time this rule shipped: the message named
 * `text-3xs` and `text-2xs` for months before tokens.css declared either, and
 * every author who followed the advice got a class that emitted nothing.
 */
const SCALE = [
  [9, '3xs'],
  [10, '2xs'],
  [11, 'xs'],
  [13, 'sm'],
  [15, 'base'],
  [18, 'lg'],
  [24, 'xl'],
  [32, '2xl'],
]
const STEP = new Map(SCALE.map(([px, name]) => [px, name]))
const SCALE_HELP = SCALE.map(([px, name]) => `text-${name} ${px}`).join(' / ')

// The two forms --fix is allowed to touch. Both carry a capture group for the
// number; both are px-only, because a rem/em value depends on a root size this
// script has no business assuming.
const FIX_TW = /\btext-\[([0-9.]+)px\]/g
const FIX_CSS = /(font-size\s*:\s*)([0-9.]+)px/g

const VAR_USE = /var\(\s*(--[a-zA-Z0-9_-]+)/g
// A declaration, in either of the two forms this codebase writes them.
// The optional quote on the first is for `{ '--dim': x }` in a style object.
const VAR_DECL = /(--[a-zA-Z0-9_-]+)['"`]?\s*:/g
// The second is a COMPUTED KEY: `style={{ ["--gw-edge" as string]: edge }}`.
// TypeScript needs the cast because CSSProperties has no index signature, and
// the cast puts ` as string]` between the name and its colon — which the
// pattern above cannot see past. Missing this reported three variables that a
// panel declares on itself as undefined, which is the most misleading answer
// this check could give.
const VAR_DECL_KEY = /\[\s*['"`](--[a-zA-Z0-9_-]+)['"`]/g

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
  // Every branch REPLACES WITH SPACES rather than deleting, so the result is
  // the same length as the input and a match at index N is at index N in the
  // original too. --fix depends on that; the scan does not care either way.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n\r]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n\r]/g, ' '))
    .replace(/(^|[^:])(\/\/[^\n\r]*)/g, (_m, pre, cmt) => pre + ' '.repeat(cmt.length))
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

function collectDeclared(files) {
  const declared = new Set()
  for (const f of [INDEX_HTML, ...files]) {
    if (!existsSync(f)) continue
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(VAR_DECL)) declared.add(m[1])
    for (const m of src.matchAll(VAR_DECL_KEY)) declared.add(m[1])
  }
  return declared
}

// ── Scanning ─────────────────────────────────────────────────────────────────

function scan() {
  const files = walk(SRC).sort()
  const declaredGlobal = collectDeclared(files)
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

    // tokens.css owns the scale, so it is the one file allowed to state a size.
    if (!LITERAL_EXEMPT.has(rel)) {
      for (const re of [TYPE_ARBITRARY, TYPE_CSS, TYPE_JS]) {
        for (const m of text.matchAll(re)) {
          hits.push({ line: lineOf(text, m.index), rule: 'type-scale', found: m[0].trim() })
        }
      }
    }

    for (const m of text.matchAll(VAR_USE)) {
      const name = m[1]
      // `var(--color-level-${level})` — a name built by interpolation. The
      // static half is not a variable and there is nothing to check.
      if (text[m.index + m[0].length] === '$') continue
      if (declaredGlobal.has(name)) continue
      hits.push({ line: lineOf(text, m.index), rule: 'unknown-var', found: `var(${name})` })
    }

    if (hits.length) byFile.set(rel, hits)
  }
  return byFile
}

// ── Fixing ───────────────────────────────────────────────────────────────────

/**
 * Rewrite the mechanical type-scale violations in place.
 *
 * Two properties this has to keep, and both have bitten this repo before:
 *
 *  - LINE ENDINGS SURVIVE. Every source file here is written on Windows. The
 *    scan normalises CRLF before matching; the fixer must NOT, or it rewrites
 *    all 900 lines of a file to change one of them and the diff becomes
 *    unreadable. So it works on the raw bytes and its regexes never span a
 *    line.
 *
 *  - COMMENTS ARE OFF LIMITS. A doc comment explaining why `text-[10px]` is
 *    banned must not itself be "fixed" into prose that no longer says what it
 *    means. Positions come from the comment-blanked copy, which is the same
 *    length as the raw text, and the edit is applied to the raw text at that
 *    same index.
 *
 * Edits are applied BACK TO FRONT so an earlier splice cannot shift the index
 * of a later one.
 */
function applyFixes(files) {
  const changed = []

  for (const abs of files) {
    const rel = relative(ROOT, abs).replace(/\\/g, '/')
    if (LITERAL_EXEMPT.has(rel)) continue // tokens.css declares the scale

    const raw = readFileSync(abs, 'utf8')
    const masked = stripComments(raw)
    const edits = []

    for (const m of masked.matchAll(FIX_TW)) {
      const name = STEP.get(Number(m[1]))
      if (name) edits.push({ at: m.index, len: m[0].length, text: `text-${name}`, was: m[0] })
    }
    for (const m of masked.matchAll(FIX_CSS)) {
      const name = STEP.get(Number(m[2]))
      if (name) edits.push({ at: m.index, len: m[0].length, text: `${m[1]}var(--text-${name})`, was: m[0].trim() })
    }
    if (!edits.length) continue

    let out = raw
    for (const e of edits.sort((a, b) => b.at - a.at)) {
      out = out.slice(0, e.at) + e.text + out.slice(e.at + e.len)
    }
    writeFileSync(abs, out)
    changed.push({ rel, edits })
  }

  return changed
}

function reportFixes(changed) {
  const total = changed.reduce((n, c) => n + c.edits.length, 0)
  if (!total) {
    console.log('\ncheck-theme --fix — nothing mechanical to rewrite.\n')
    return
  }
  console.log(`\ncheck-theme --fix — rewrote ${total} size(s) across ${changed.length} file(s):\n`)
  for (const { rel, edits } of changed) {
    const tally = new Map()
    for (const e of edits) {
      const key = `${e.was} → ${e.text.trim()}`
      tally.set(key, (tally.get(key) || 0) + 1)
    }
    console.log(`  ${rel}`)
    for (const [key, n] of tally) console.log(`      ${n}×  ${key}`)
  }
  console.log('\n  Re-checking with those applied…')
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
  'type-scale':
    `type size off the scale — use a scale utility (${SCALE_HELP}). A size that IS ` +
    'on the scale is rewritten for you by `npm run theme:fix`; if it survived that, ' +
    'it is off the scale and it is a real decision. In a React style object use ' +
    "var(--text-…); on a canvas or in a chart config it must stay a NUMBER, so take " +
    'it off the scale above rather than typing a new one',
  'unknown-var':
    'no such CSS variable — nothing under src/ or in index.html declares it, so this renders as nothing at all, silently. Check the spelling against src/design/tokens.css',
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

if (FIX) {
  // Fix first, then fall through into the ordinary check — so the run ends by
  // telling you what is LEFT, which is the part that needs a person.
  reportFixes(applyFixes(walk(SRC).sort()))
}

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
