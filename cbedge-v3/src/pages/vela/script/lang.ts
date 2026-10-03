// ─────────────────────────────────────────────────────────────────────────────
// CB SCRIPT — the language: tokens and a tree. No eval, ever.
//
// CB Edge's own indicator language for Vela, run by pages/vela/script/engine.ts.
// It is PARSED and INTERPRETED here, never handed to eval() / new Function():
// production's Content-Security-Policy has no 'unsafe-eval'
// (server-v2/server-with-proxy.js applySecurityHeaders), deliberately, so a
// JavaScript-as-script engine would not even run on cbedge.net. A small language
// of our own also means a script can only do what the built-ins allow — read the
// chart's bars, compute, plot — and nothing else in the page.
//
// ── The shape of a script ───────────────────────────────────────────────────
//   // a comment
//   indicator("EMA cross", overlay=true)
//   fast = input("Fast", 9, min=1)
//   f = ema(close, fast)
//   plot(f, "Fast", color=gold, width=2)
//   marker(crossover(f, ema(close, 21)), position="below", color=green)
//
// One statement per line (or `;`-separated); a line break inside ( ) or [ ] is
// ignored, so a long call can wrap. Statements are `name = expression` (`:=`
// also accepted) or a bare call. Expressions: numbers, "strings", true / false /
// na, names, calls with positional and name=value arguments, [lists], history
// `x[1]`, `cond ? a : b`, `and or not`, `== != < <= > >=`, `+ - * / %`, `^`.
// What every name and function means is runtime.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type Node =
  | { k: 'num'; v: number; line: number }
  | { k: 'str'; v: string; line: number }
  | { k: 'bool'; v: boolean; line: number }
  | { k: 'na'; line: number }
  | { k: 'id'; name: string; line: number }
  | { k: 'unary'; op: '-' | '+' | 'not'; x: Node; line: number }
  | { k: 'bin'; op: string; a: Node; b: Node; line: number }
  | { k: 'tern'; c: Node; a: Node; b: Node; line: number }
  | { k: 'call'; name: string; args: Node[]; named: Record<string, Node>; line: number }
  | { k: 'index'; x: Node; at: Node; line: number }
  | { k: 'list'; items: Node[]; line: number }

export type Stmt =
  | { k: 'assign'; name: string; x: Node; line: number }
  | { k: 'expr'; x: Node; line: number }

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
  | { t: 'num'; v: number; line: number }
  | { t: 'str'; v: string; line: number }
  | { t: 'id'; v: string; line: number }
  | { t: 'op'; v: string; line: number }
  | { t: 'nl'; line: number }
  | { t: 'eof'; line: number }

const OPS = ['==', '!=', '<=', '>=', ':=', '+', '-', '*', '/', '%', '^', '<', '>', '=', '?', ':', ',', '(', ')', '[', ']', ';']

function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  let line = 1
  let depth = 0 // ( and [ nesting — line breaks inside are not statement ends
  const n = src.length
  while (i < n) {
    const c = src[i]!
    if (c === '\n') {
      if (depth === 0) out.push({ t: 'nl', line })
      line++
      i++
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if ((c >= '0' && c <= '9') || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i
      while (j < n && /[0-9.]/.test(src[j]!)) j++
      if (src[j] === 'e' || src[j] === 'E') {
        j++
        if (src[j] === '+' || src[j] === '-') j++
        while (j < n && /[0-9]/.test(src[j]!)) j++
      }
      const v = Number(src.slice(i, j))
      if (!Number.isFinite(v)) throw new ScriptError(`bad number "${src.slice(i, j)}"`, line)
      out.push({ t: 'num', v, line })
      i = j
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let s = ''
      while (j < n && src[j] !== c) {
        if (src[j] === '\n') throw new ScriptError('a string is missing its closing quote', line)
        if (src[j] === '\\' && j + 1 < n) {
          s += src[j + 1]
          j += 2
          continue
        }
        s += src[j]
        j++
      }
      if (j >= n) throw new ScriptError('a string is missing its closing quote', line)
      out.push({ t: 'str', v: s, line })
      i = j + 1
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z0-9_.]/.test(src[j]!)) j++
      out.push({ t: 'id', v: src.slice(i, j), line })
      i = j
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (!op) throw new ScriptError(`unexpected "${c}"`, line)
    if (op === '(' || op === '[') depth++
    if (op === ')' || op === ']') depth = Math.max(0, depth - 1)
    out.push(op === ';' ? { t: 'nl', line } : { t: 'op', v: op, line })
    i += op.length
  }
  out.push({ t: 'nl', line }, { t: 'eof', line })
  return out
}

// ── Parser (precedence climbing) ─────────────────────────────────────────────

export function parse(src: string): Stmt[] {
  const toks = lex(src)
  let p = 0
  const peek = () => toks[p]!
  const next = () => toks[p++]!
  const isOp = (v: string) => {
    const t = peek()
    return t.t === 'op' && t.v === v
  }
  const isWord = (v: string) => {
    const t = peek()
    return t.t === 'id' && t.v === v
  }
  const expectOp = (v: string) => {
    const t = next()
    if (t.t !== 'op' || t.v !== v) throw new ScriptError(`expected "${v}"`, t.line)
  }

  const primary = (): Node => {
    const t = next()
    if (t.t === 'num') return { k: 'num', v: t.v, line: t.line }
    if (t.t === 'str') return { k: 'str', v: t.v, line: t.line }
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
      if (t.v === 'true' || t.v === 'false') return { k: 'bool', v: t.v === 'true', line: t.line }
      if (t.v === 'na') return { k: 'na', line: t.line }
      if (isOp('(')) {
        next()
        const args: Node[] = []
        const named: Record<string, Node> = {}
        if (!isOp(')')) {
          for (;;) {
            const a = peek()
            const b = toks[p + 1]
            if (a.t === 'id' && b && b.t === 'op' && b.v === '=') {
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
      return { k: 'id', name: t.v, line: t.line }
    }
    if (t.t === 'nl' || t.t === 'eof') throw new ScriptError('the line ends too early', t.line)
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

  const unary = (): Node => {
    if (isOp('-') || isOp('+')) {
      const t = next() as { v: '-' | '+'; line: number }
      return { k: 'unary', op: t.v, x: unary(), line: t.line }
    }
    return power()
  }

  const power = (): Node => {
    const a = postfix()
    if (isOp('^')) {
      const t = next()
      return { k: 'bin', op: '^', a, b: unary(), line: t.line } // right-associative
    }
    return a
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
  const not = (): Node => {
    if (isWord('not')) {
      const t = next()
      return { k: 'unary', op: 'not', x: not(), line: t.line }
    }
    return eq()
  }
  const and = (): Node => {
    let a = not()
    while (isWord('and')) {
      const t = next()
      a = { k: 'bin', op: 'and', a, b: not(), line: t.line }
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

  const out: Stmt[] = []
  while (peek().t !== 'eof') {
    if (peek().t === 'nl') {
      next()
      continue
    }
    const t = peek()
    const n1 = toks[p + 1]
    if (t.t === 'id' && n1 && n1.t === 'op' && (n1.v === '=' || n1.v === ':=')) {
      p += 2
      out.push({ k: 'assign', name: t.v, x: expr(), line: t.line })
    } else {
      out.push({ k: 'expr', x: expr(), line: t.line })
    }
    const end = next()
    if (end.t !== 'nl' && end.t !== 'eof') throw new ScriptError('one statement per line — something follows this one', end.line)
  }
  return out
}
