// ─────────────────────────────────────────────────────────────────────────────
// CB SCRIPT — the language: tokens and a tree. No eval, ever.
//
// CB Edge's own indicator language for Vela, run by pages/vela/script/engine.ts.
// It is PARSED and INTERPRETED here, never handed to eval() / new Function():
// production's Content-Security-Policy has no 'unsafe-eval'
// (server-v2/server-with-proxy.js applySecurityHeaders), deliberately, so a
// JavaScript-as-script engine would not even run on cbedge.net. A language of
// our own also means a script can only do what the built-ins allow — read the
// chart's bars, compute, draw — and nothing else in the page.
//
// ── Pine Script, pasted as is ────────────────────────────────────────────────
// The grammar is TradingView's Pine (v4 / v5 / v6 indicator scripts), so a
// script copied off TradingView parses unchanged:
//   · indentation blocks — `f(x) =>` + an indented body, `if` / `else if` /
//     `else`, `for i = a to b [by s]`, `while`, `switch` (with or without a
//     subject); a line indented deeper than the one before that does not open
//     a block is that line's continuation (Pine's wrap rule)
//   · `x = e` declares, `x := e` / `+=` `-=` `*=` `/=` `%=` reassign, `var` /
//     `varip` keep a value across bars, type words (`float x = 0`, `series
//     int`) are read and ignored, `[a, b] = f()` unpacks a tuple
//   · `#rrggbb` / `#rrggbbaa` colour literals, "…" and '…' strings
//   · `cond ? a : b`, `and or not`, `== != < <= > >=`, `+ - * / %`, history
//     `x[1]`, calls with positional and name=value arguments
// The CB Script spelling that came first (`input("Fast", 9)`, `plot(x,
// color=gold)`, `marker(…)`) is the same grammar; what every name means is
// runtime.ts. `^` (power) is a CB extra.
// ─────────────────────────────────────────────────────────────────────────────

export type Node =
  | { k: 'num'; v: number; float: boolean; line: number }
  | { k: 'str'; v: string; line: number }
  | { k: 'color'; v: string; line: number }
  | { k: 'bool'; v: boolean; line: number }
  | { k: 'na'; line: number }
  | { k: 'id'; name: string; line: number }
  | { k: 'unary'; op: '-' | '+' | 'not'; x: Node; line: number }
  | { k: 'bin'; op: string; a: Node; b: Node; line: number }
  | { k: 'tern'; c: Node; a: Node; b: Node; line: number }
  | { k: 'call'; name: string; args: Node[]; named: Record<string, Node>; line: number }
  | { k: 'index'; x: Node; at: Node; line: number }
  | { k: 'list'; items: Node[]; line: number }
  | { k: 'if'; branches: { c: Node | null; body: Stmt[] }[]; line: number }
  | { k: 'switch'; subject: Node | null; cases: { m: Node | null; body: Stmt[] }[]; line: number }
  | { k: 'for'; v: string; from: Node; to: Node; by: Node | null; body: Stmt[]; line: number }
  | { k: 'while'; c: Node; body: Stmt[]; line: number }

export interface FuncDef {
  k: 'func'
  name: string
  params: string[]
  defaults: (Node | null)[]
  body: Stmt[]
  line: number
}

export type Stmt =
  | { k: 'decl'; name: string; x: Node; isVar: boolean; line: number }
  | { k: 'reassign'; name: string; op: string; x: Node; line: number }
  | { k: 'tuple'; names: string[]; x: Node; line: number }
  | { k: 'expr'; x: Node; line: number }
  | { k: 'break'; line: number }
  | { k: 'continue'; line: number }
  | FuncDef

export interface Program {
  stmts: Stmt[]
  /** `//@version=N` when the script declares one (it is Pine then), else null. */
  version: number | null
}

/** A script error that knows where it is. */
export class ScriptError extends Error {
  readonly line: number
  constructor(message: string, line: number) {
    super(line > 0 ? `Line ${line}: ${message}` : message)
    this.line = line
    this.name = 'ScriptError'
  }
}

// ── Tokens ───────────────────────────────────────────────────────────────────

type Tok =
  | { t: 'num'; v: number; float: boolean; line: number }
  | { t: 'str'; v: string; line: number }
  | { t: 'color'; v: string; line: number }
  | { t: 'id'; v: string; line: number }
  | { t: 'op'; v: string; line: number }
  | { t: 'eol'; line: number }

/** One logical line: its indent and its tokens (a wrapped line is joined). */
interface LLine {
  indent: number
  toks: Tok[]
  line: number
}

// Longest first: `=>` before `=`, `:=` before `:`.
const OPS = ['=>', '==', '!=', '<=', '>=', ':=', '+=', '-=', '*=', '/=', '%=', '+', '-', '*', '/', '%', '^', '<', '>', '=', '?', ':', ',', '(', ')', '[', ']', ';']

const ESC: Record<string, string> = { n: '\n', t: '\t', r: '' }

function lexLine(text: string, from: number, line: number): Tok[] {
  const out: Tok[] = []
  let i = from
  const n = text.length
  while (i < n) {
    const c = text[i]!
    if (c === ' ' || c === '\t' || c === '\r') {
      i++
      continue
    }
    if (c === '/' && text[i + 1] === '/') break
    if ((c >= '0' && c <= '9') || (c === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      let j = i
      while (j < n && /[0-9]/.test(text[j]!)) j++
      let float = false
      if (text[j] === '.') {
        float = true
        j++
        while (j < n && /[0-9]/.test(text[j]!)) j++
      }
      if (text[j] === 'e' || text[j] === 'E') {
        float = true
        j++
        if (text[j] === '+' || text[j] === '-') j++
        while (j < n && /[0-9]/.test(text[j]!)) j++
      }
      const v = Number(text.slice(i, j))
      if (!Number.isFinite(v)) throw new ScriptError(`bad number "${text.slice(i, j)}"`, line)
      out.push({ t: 'num', v, float, line })
      i = j
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let s = ''
      while (j < n && text[j] !== c) {
        if (text[j] === '\\' && j + 1 < n) {
          const e = text[j + 1]!
          s += ESC[e] ?? e
          j += 2
          continue
        }
        s += text[j]
        j++
      }
      if (j >= n) throw new ScriptError('a string is missing its closing quote', line)
      out.push({ t: 'str', v: s, line })
      i = j + 1
      continue
    }
    if (c === '#') {
      const m = /^#([0-9a-fA-F]{8}|[0-9a-fA-F]{6})(?![0-9a-zA-Z_])/.exec(text.slice(i))
      if (!m) throw new ScriptError('a colour is written #rrggbb or #rrggbbaa', line)
      out.push({ t: 'color', v: m[0].toLowerCase(), line })
      i += m[0].length
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z0-9_.]/.test(text[j]!)) j++
      out.push({ t: 'id', v: text.slice(i, j), line })
      i = j
      continue
    }
    const op = OPS.find((o) => text.startsWith(o, i))
    if (!op) throw new ScriptError(`unexpected "${c}"`, line)
    out.push({ t: 'op', v: op, line })
    i += op.length
  }
  return out
}

const BLOCK_WORDS = new Set(['if', 'switch', 'for', 'while'])
const OPEN_ENDS = new Set(['+', '-', '*', '/', '%', '^', '<', '>', '<=', '>=', '==', '!=', '?', ':', ',', '=', ':=', '+=', '-=', '*=', '/=', '%=', '('])

/** Does this line end mid-expression (so the next line must continue it)? */
function endsOpen(l: LLine): boolean {
  const t = l.toks[l.toks.length - 1]
  if (!t) return false
  if (t.t === 'op') return OPEN_ENDS.has(t.v)
  return t.t === 'id' && (t.v === 'and' || t.v === 'or' || t.v === 'not')
}

/** Does this line open an indented block below it? */
function opensBlock(l: LLine): boolean {
  const last = l.toks[l.toks.length - 1]
  if (last && last.t === 'op' && last.v === '=>') return true
  const first = l.toks[0]
  if (first && first.t === 'id' && first.v === 'else') return true
  return l.toks.some((t) => t.t === 'id' && BLOCK_WORDS.has(t.v))
}

function lex(src: string): LLine[] {
  const raw: LLine[] = []
  let depth = 0 // ( and [ nesting — a line break inside is not a line end
  let cur: LLine | null = null
  const phys = src.split('\n')
  for (let ln = 0; ln < phys.length; ln++) {
    const text = phys[ln]!
    let j = 0
    let indent = 0
    while (j < text.length && (text[j] === ' ' || text[j] === '\t')) {
      indent += text[j] === '\t' ? 4 : 1
      j++
    }
    const toks = lexLine(text, j, ln + 1)
    if (!toks.length) continue
    if (depth > 0 && cur) cur.toks.push(...toks)
    else raw.push((cur = { indent, toks, line: ln + 1 }))
    for (const t of toks) {
      if (t.t !== 'op') continue
      if (t.v === '(' || t.v === '[') depth++
      else if (t.v === ')' || t.v === ']') depth = Math.max(0, depth - 1)
    }
  }
  // `a; b` / `plot(a), plot(b)` — two statements on one line, same indent
  const split: LLine[] = []
  for (const l of raw) {
    let d = 0
    let part: Tok[] = []
    for (const t of l.toks) {
      if (t.t === 'op' && (t.v === '(' || t.v === '[')) d++
      if (t.t === 'op' && (t.v === ')' || t.v === ']')) d--
      if (t.t === 'op' && (t.v === ';' || t.v === ',') && d === 0) {
        if (part.length) split.push({ indent: l.indent, toks: part, line: part[0]!.line })
        part = []
        continue
      }
      part.push(t)
    }
    if (part.length) split.push({ indent: l.indent, toks: part, line: part[0]!.line })
  }
  // Pine's wrap rule: deeper than the line above, and the line above opens no block
  const out: LLine[] = []
  for (const l of split) {
    const prev = out[out.length - 1]
    if (prev && l.indent > prev.indent && (endsOpen(prev) || !opensBlock(prev))) prev.toks.push(...l.toks)
    else out.push({ ...l, toks: l.toks.slice() })
  }
  return out
}

// ── Parser ───────────────────────────────────────────────────────────────────

const TYPE_WORDS = new Set(['int', 'float', 'bool', 'color', 'string', 'line', 'label', 'box', 'table', 'linefill', 'polyline', 'series', 'simple', 'const', 'chart.point'])
const ASSIGN_OPS = new Set(['=', ':=', '+=', '-=', '*=', '/=', '%='])
const RESERVED = new Set(['if', 'else', 'for', 'while', 'switch', 'var', 'varip', 'and', 'or', 'not', 'true', 'false', 'na', 'break', 'continue', 'import', 'export'])

export function parse(src: string): Program {
  const vm = /\/\/\s*@version\s*=\s*(\d+)/.exec(src)
  const version = vm ? Number(vm[1]) : null
  const lines = lex(src)
  let li = 0 // next logical line to read
  let toks: Tok[] = []
  let p = 0
  let curLine = 0
  let stmtIndent = 0 // indent of the statement being parsed — blocks nest under it
  const EOL = (): Tok => ({ t: 'eol', line: curLine })

  const load = (k: number) => {
    const L = lines[k]!
    toks = L.toks
    p = 0
    curLine = L.line
  }
  const peek = (o = 0): Tok => toks[p + o] ?? EOL()
  const next = (): Tok => toks[p++] ?? EOL()
  const isOp = (v: string, o = 0) => {
    const t = peek(o)
    return t.t === 'op' && t.v === v
  }
  const isWord = (v: string, o = 0) => {
    const t = peek(o)
    return t.t === 'id' && t.v === v
  }
  const expectOp = (v: string) => {
    const t = next()
    if (t.t !== 'op' || t.v !== v) throw new ScriptError(`expected "${v}"`, t.line)
  }
  const expectEol = () => {
    const t = peek()
    if (t.t !== 'eol') throw new ScriptError(`unexpected "${String(t.v)}" — the line should end here`, t.line)
  }
  const expectId = (): string => {
    const t = next()
    if (t.t !== 'id') throw new ScriptError('expected a name', t.line)
    return t.v
  }
  /** Index of the bracket closing the one at `at`. */
  const closer = (at: number): number => {
    let d = 0
    for (let k = at; k < toks.length; k++) {
      const t = toks[k]!
      if (t.t !== 'op') continue
      if (t.v === '(' || t.v === '[') d++
      if (t.v === ')' || t.v === ']') {
        d--
        if (d === 0) return k
      }
    }
    return -1
  }
  const firstWord = (k: number) => {
    const t = lines[k]?.toks[0]
    return t && t.t === 'id' ? t.v : null
  }

  /** The indented block under the current statement. */
  const block = (parent: number): Stmt[] => {
    const L = lines[li]
    if (!L || L.indent <= parent) throw new ScriptError('expected an indented block on the next line', curLine)
    const ind = L.indent
    const out: Stmt[] = []
    while (li < lines.length && lines[li]!.indent >= ind) {
      if (lines[li]!.indent > ind) throw new ScriptError('this line is indented deeper than the block it is in', lines[li]!.line)
      out.push(statement())
    }
    toks = []
    p = 0
    return out
  }

  const statement = (): Stmt => {
    load(li++)
    const saved = stmtIndent
    stmtIndent = lines[li - 1]!.indent
    const s = stmtBody()
    expectEol()
    stmtIndent = saved
    return s
  }

  const funcDef = (): FuncDef => {
    const line = curLine
    const name = expectId()
    expectOp('(')
    const params: string[] = []
    const defaults: (Node | null)[] = []
    while (!isOp(')')) {
      while (peek().t === 'id' && TYPE_WORDS.has((peek() as { v: string }).v) && peek(1).t === 'id') next()
      params.push(expectId())
      if (isOp('=')) {
        next()
        defaults.push(expr())
      } else defaults.push(null)
      if (isOp(',')) next()
      else if (!isOp(')')) throw new ScriptError('expected "," or ")" in the parameter list', curLine)
    }
    expectOp(')')
    expectOp('=>')
    let body: Stmt[]
    if (peek().t === 'eol') body = block(stmtIndent)
    else body = [stmtBody()]
    return { k: 'func', name, params, defaults, body, line }
  }

  function stmtBody(): Stmt {
    const t0 = peek()
    const line = t0.line
    if (t0.t === 'id') {
      if (t0.v === 'import' || t0.v === 'export' || ((t0.v === 'method' || t0.v === 'type' || t0.v === 'enum') && peek(1).t === 'id'))
        throw new ScriptError(`"${t0.v}" (libraries, methods and user types) isn't supported`, line)
      if (t0.v === 'break' || t0.v === 'continue') {
        next()
        return { k: t0.v, line }
      }
      if (!RESERVED.has(t0.v) && isOp('(', 1)) {
        const c = closer(p + 1)
        const after = toks[c + 1]
        if (c > 0 && after && after.t === 'op' && after.v === '=>') return funcDef()
      }
    }
    if (t0.t === 'op' && t0.v === '[') {
      const c = closer(p)
      const after = toks[c + 1]
      if (c > 0 && after && after.t === 'op' && (after.v === '=' || after.v === ':=')) {
        next()
        const names: string[] = []
        while (!isOp(']')) {
          names.push(expectId())
          if (isOp(',')) next()
        }
        next()
        next()
        return { k: 'tuple', names, x: expr(), line }
      }
    }
    let isVar = false
    if (isWord('var') || isWord('varip')) {
      next()
      isVar = true
    }
    // type words in front of a declaration: `float x = …`, `series int n = …`
    while (peek().t === 'id' && TYPE_WORDS.has((peek() as { v: string }).v)) {
      if (isOp('[', 1)) throw new ScriptError('arrays aren\'t supported', line)
      if (peek(1).t === 'id') next()
      else break
    }
    const a = peek()
    const b = peek(1)
    if (a.t === 'id' && b.t === 'op' && ASSIGN_OPS.has(b.v) && !RESERVED.has(a.v)) {
      p += 2
      const x = expr()
      if (b.v === '=') return { k: 'decl', name: a.v, x, isVar, line }
      if (isVar) throw new ScriptError('`var` declares with =, not :=', line)
      return { k: 'reassign', name: a.v, op: b.v, x, line }
    }
    if (isVar) throw new ScriptError('`var` must be followed by a declaration, `var x = …`', line)
    return { k: 'expr', x: expr(), line }
  }

  // ── block expressions ──
  const ifExpr = (): Node => {
    const line = curLine
    const indent = stmtIndent
    next() // if
    const branches: { c: Node | null; body: Stmt[] }[] = []
    const c = expr()
    expectEol()
    branches.push({ c, body: block(indent) })
    while (li < lines.length && lines[li]!.indent === indent && firstWord(li) === 'else') {
      load(li++)
      next() // else
      if (isWord('if')) {
        next()
        const c2 = expr()
        expectEol()
        branches.push({ c: c2, body: block(indent) })
      } else {
        expectEol()
        branches.push({ c: null, body: block(indent) })
        break
      }
    }
    toks = []
    p = 0
    return { k: 'if', branches, line }
  }

  const switchExpr = (): Node => {
    const line = curLine
    const indent = stmtIndent
    next() // switch
    const subject = peek().t === 'eol' ? null : expr()
    expectEol()
    const L = lines[li]
    if (!L || L.indent <= indent) throw new ScriptError('a switch needs its cases on indented lines below it', line)
    const ci = L.indent
    const cases: { m: Node | null; body: Stmt[] }[] = []
    while (li < lines.length && lines[li]!.indent === ci) {
      load(li++)
      const saved = stmtIndent
      stmtIndent = ci
      let m: Node | null = null
      if (isOp('=>')) next()
      else {
        m = expr()
        expectOp('=>')
      }
      const body = peek().t === 'eol' ? block(ci) : [stmtBody()]
      expectEol()
      stmtIndent = saved
      cases.push({ m, body })
    }
    if (li < lines.length && lines[li]!.indent > ci) throw new ScriptError('this line is indented deeper than the switch case above it', lines[li]!.line)
    toks = []
    p = 0
    return { k: 'switch', subject, cases, line }
  }

  const forExpr = (): Node => {
    const line = curLine
    const indent = stmtIndent
    next() // for
    if (isOp('[') || isWord('in', 1)) throw new ScriptError('for…in loops (over arrays) aren\'t supported', line)
    const v = expectId()
    expectOp('=')
    const from = expr()
    if (!isWord('to')) throw new ScriptError('expected "to" in the for loop', curLine)
    next()
    const to = expr()
    let by: Node | null = null
    if (isWord('by')) {
      next()
      by = expr()
    }
    expectEol()
    const body = block(indent)
    return { k: 'for', v, from, to, by, body, line }
  }

  const whileExpr = (): Node => {
    const line = curLine
    const indent = stmtIndent
    next() // while
    const c = expr()
    expectEol()
    const body = block(indent)
    return { k: 'while', c, body, line }
  }

  // ── expressions (Pine precedence) ──
  const primary = (): Node => {
    const t = peek()
    if (t.t === 'id') {
      if (t.v === 'if') return ifExpr()
      if (t.v === 'switch') return switchExpr()
      if (t.v === 'for') return forExpr()
      if (t.v === 'while') return whileExpr()
    }
    next()
    if (t.t === 'num') return { k: 'num', v: t.v, float: t.float, line: t.line }
    if (t.t === 'str') return { k: 'str', v: t.v, line: t.line }
    if (t.t === 'color') return { k: 'color', v: t.v, line: t.line }
    if (t.t === 'op' && t.v === '(') {
      const x = expr()
      expectOp(')')
      return x
    }
    if (t.t === 'op' && t.v === '[') {
      const items: Node[] = []
      if (!isOp(']')) {
        items.push(expr())
        while (isOp(',')) {
          next()
          items.push(expr())
        }
      }
      expectOp(']')
      return { k: 'list', items, line: t.line }
    }
    if (t.t === 'id') {
      if (!isOp('(')) {
        if (t.v === 'true' || t.v === 'false') return { k: 'bool', v: t.v === 'true', line: t.line }
        if (t.v === 'na') return { k: 'na', line: t.line }
      }
      if (isOp('<') && /^(array|matrix|map)\./.test(t.v)) throw new ScriptError(`${t.v.split('.')[0]}s aren't supported`, t.line)
      if (isOp('(')) {
        next()
        const args: Node[] = []
        const named: Record<string, Node> = {}
        if (!isOp(')')) {
          for (;;) {
            const a = peek()
            const b = peek(1)
            if (a.t === 'id' && b.t === 'op' && b.v === '=') {
              p += 2
              named[a.v] = expr()
            } else {
              if (Object.keys(named).length) throw new ScriptError('positional arguments must come before name=value ones', a.line)
              args.push(expr())
            }
            if (isOp(',')) {
              next()
              continue
            }
            break
          }
        }
        expectOp(')')
        return { k: 'call', name: t.v, args, named, line: t.line }
      }
      if (RESERVED.has(t.v) && t.v !== 'na') throw new ScriptError(`"${t.v}" can't be used here`, t.line)
      return { k: 'id', name: t.v, line: t.line }
    }
    if (t.t === 'eol') throw new ScriptError('the line ends too early', t.line)
    throw new ScriptError(`unexpected "${t.v}"`, t.line)
  }

  const postfix = (): Node => {
    let x = primary()
    while (isOp('[')) {
      const t = next()
      const at = expr()
      expectOp(']')
      x = { k: 'index', x, at, line: t.line }
    }
    return x
  }

  const power = (): Node => {
    const a = postfix()
    if (isOp('^')) {
      const t = next()
      return { k: 'bin', op: '^', a, b: unary(), line: t.line } // right-associative
    }
    return a
  }

  function unary(): Node {
    if (isOp('-') || isOp('+')) {
      const t = next() as { v: '-' | '+'; line: number }
      return { k: 'unary', op: t.v, x: unary(), line: t.line }
    }
    if (isWord('not')) {
      const t = next()
      return { k: 'unary', op: 'not', x: unary(), line: t.line }
    }
    return power()
  }

  const binary = (ops: string[], sub: () => Node) => (): Node => {
    let a = sub()
    while (peek().t === 'op' && ops.includes((peek() as { v: string }).v)) {
      const t = next() as { v: string; line: number }
      a = { k: 'bin', op: t.v, a, b: sub(), line: t.line }
    }
    return a
  }
  const mul = binary(['*', '/', '%'], unary)
  const add = binary(['+', '-'], mul)
  const cmp = binary(['<', '<=', '>', '>='], add)
  const eq = binary(['==', '!='], cmp)
  const and = (): Node => {
    let a = eq()
    while (isWord('and')) {
      const t = next()
      a = { k: 'bin', op: 'and', a, b: eq(), line: t.line }
    }
    return a
  }
  const or = (): Node => {
    let a = and()
    while (isWord('or')) {
      const t = next()
      a = { k: 'bin', op: 'or', a, b: and(), line: t.line }
    }
    return a
  }
  function expr(): Node {
    const c = or()
    if (isOp('?')) {
      const t = next()
      const a = expr()
      expectOp(':')
      const b = expr()
      return { k: 'tern', c, a, b, line: t.line }
    }
    return c
  }

  const stmts: Stmt[] = []
  while (li < lines.length) {
    if (lines[li]!.indent !== lines[0]!.indent && lines[li]!.indent > 0) {
      // a stray indented line at the top level
      throw new ScriptError('this line is indented but nothing above it opens a block', lines[li]!.line)
    }
    stmts.push(statement())
  }
  return { stmts, version }
}
