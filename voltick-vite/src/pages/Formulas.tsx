/**
 * /formulas · the CB Edge formula reference.
 *
 * A static page. The content is one markdown file imported with Vite's `?raw`,
 * so the document stays a document: regenerate it from source, drop it back in
 * src/assets/, and the page is up to date with no TSX to retype. Nothing here
 * asks the backend for anything.
 *
 * The file is imported as a Vite asset rather than dropped in public/ for the
 * same reason DataFlow.tsx imports its diagram: public/ sits at the document
 * root and skips nginx's `auth_request`, and an ungated copy of the engine's
 * every constant is the wrong thing to leave at a predictable URL. Imported, it
 * is inlined into this route's hashed chunk under /assets/, behind the gate.
 *
 * The renderer below is deliberately small and local. It reads exactly the
 * subset of markdown this document uses (headings, fences, tables, lists, rules
 * and two inline marks) and nothing else, which is a few dozen lines against a
 * dependency, a bundle and a stylesheet of colours that are not ours.
 *
 * Copy note: the reference names `entry`, `stop` and `target` in a few places.
 * Those are identifiers in the code it documents, and they appear here only
 * inside code blocks, quoting the source. The prose stays mechanics.
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Card, PageShell } from "../components/PageCard";
import {
  ACCENT_TEXT,
  ELEV,
  INK,
  LINE,
  MONO,
  PAPER,
  PAPER_DISPLAY,
  PAPER_QUIET,
  R_LG,
  R_MD,
  R_SM,
  SANS,
  W_BOLD,
  W_MED,
  rgba,
} from "../theme";
import source from "../assets/2026-09-20-cbedge-formulas.md?raw";

/* ── Block model ──────────────────────────────────────────────────────────── */

type Block =
  | { kind: "h"; level: 1 | 2 | 3 | 4; text: string; id: string }
  | { kind: "p"; text: string }
  | { kind: "code"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "hr" };

/** `## 7. Initial Balance` becomes `s-7-initial-balance`. */
function slug(text: string) {
  return (
    "s-" +
    text
      .toLowerCase()
      .replace(/`/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

/**
 * Split a table row on unescaped pipes. The document escapes a literal pipe as
 * `\|` inside a cell (the log-odds terms in section 7 do this), so a plain
 * split would tear those cells in half.
 */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && line[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "|") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  // A row is written with a leading and a trailing pipe, so both ends are empty.
  if (out.length && out[0].trim() === "") out.shift();
  if (out.length && out[out.length - 1].trim() === "") out.pop();
  return out.map((c) => c.trim());
}

const isTableRow = (l: string) => l.trimStart().startsWith("|");
const isDivider = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l);

function parse(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code. Everything inside is verbatim, including any character that
    // would otherwise be markdown.
    if (line.trimStart().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      i++; // the closing fence
      blocks.push({ kind: "code", text: body.join("\n").replace(/\s+$/, "") });
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const text = h[2].trim();
      blocks.push({
        kind: "h",
        level: h[1].length as 1 | 2 | 3 | 4,
        text,
        id: slug(text),
      });
      i++;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    // Table: a header row, a divider, then rows until the pipes stop.
    if (isTableRow(line) && isDivider(lines[i + 1] || "")) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(cells(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    // Lists. A wrapped continuation line is folded into the item above it.
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      const items: string[] = [];
      while (i < lines.length) {
        const m = ordered
          ? /^\s*\d+\.\s+(.*)$/.exec(lines[i])
          : /^\s*[-*]\s+(.*)$/.exec(lines[i]);
        if (m) {
          items.push(m[1].trim());
          i++;
        } else if (/^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1] += " " + lines[i].trim();
          i++;
        } else {
          break;
        }
      }
      blocks.push({ kind: ordered ? "ol" : "ul", items });
      continue;
    }

    // Paragraph: run to the next blank line or the next block opener.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trimStart().startsWith("```") &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !/^\s*---+\s*$/.test(lines[i]) &&
      !isTableRow(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
  }

  return blocks;
}

/* ── Inline marks ─────────────────────────────────────────────────────────── */

const codeInline: CSSProperties = {
  fontFamily: MONO,
  fontSize: "0.92em",
  padding: "1px 5px",
  borderRadius: R_SM,
  background: rgba(ACCENT_TEXT, 0.1),
  border: `1px solid ${rgba(ACCENT_TEXT, 0.16)}`,
  color: ACCENT_TEXT,
  whiteSpace: "nowrap",
};

/** Backtick code spans. The document never puts a `**` inside one. */
function code(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let k = 0;
  for (const chunk of text.split(/(`[^`]*`)/g)) {
    if (!chunk) continue;
    if (chunk.length > 1 && chunk.startsWith("`") && chunk.endsWith("`")) {
      out.push(
        <code key={`${keyBase}-c${k++}`} style={codeInline}>
          {chunk.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(<span key={`${keyBase}-t${k++}`}>{chunk}</span>);
    }
  }
  return out;
}

/**
 * `**bold**` and backtick code.
 *
 * Bold is tokenised FIRST, because the document nests that way round: a bold
 * run often wraps a code span (`**default \`0.045\` everywhere**`). Splitting on
 * backticks first strands the two `**` halves in different chunks, where
 * neither matches and both render as literal asterisks. The reverse nesting
 * never occurs, so bold-first is safe as well as correct.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let k = 0;
  for (const chunk of text.split(/(\*\*.+?\*\*)/g)) {
    if (!chunk) continue;
    if (chunk.length > 4 && chunk.startsWith("**") && chunk.endsWith("**")) {
      out.push(
        <strong key={`${keyBase}-b${k++}`} style={{ fontWeight: W_BOLD, color: PAPER }}>
          {code(chunk.slice(2, -2), `${keyBase}-b${k}`)}
        </strong>,
      );
    } else {
      out.push(...code(chunk, `${keyBase}-p${k++}`));
    }
  }
  return out;
}

/* ── Render ───────────────────────────────────────────────────────────────── */

const H_SIZE: Record<number, number> = { 1: 24, 2: 20, 3: 15, 4: 13 };

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, n) => {
        const key = `b${n}`;

        if (b.kind === "h") {
          // The document's own `# title` is already the page h1, so it is dropped.
          if (b.level === 1) return null;
          const Tag = (b.level === 2 ? "h2" : b.level === 3 ? "h3" : "h4") as "h2";
          return (
            <Tag
              key={key}
              id={b.id}
              style={{
                margin: b.level === 2 ? "38px 0 14px" : "26px 0 10px",
                scrollMarginTop: 84,
                fontFamily: b.level === 2 ? SANS : MONO,
                fontSize: H_SIZE[b.level],
                lineHeight: 1.3,
                fontWeight: b.level === 2 ? W_BOLD : W_MED,
                letterSpacing: b.level === 2 ? "-0.01em" : "0.04em",
                textTransform: b.level >= 3 ? "uppercase" : "none",
                // 16px+ bold headlines take PAPER_DISPLAY, the smaller ones do
                // not: the optical correction is what large bold glyphs need,
                // and applying it to an 11px label just makes the label dim.
                color: b.level === 2 ? PAPER_DISPLAY : PAPER,
              }}
            >
              {inline(b.text, key)}
            </Tag>
          );
        }

        if (b.kind === "p") {
          return (
            <p key={key} style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.62, color: PAPER }}>
              {inline(b.text, key)}
            </p>
          );
        }

        if (b.kind === "code") {
          return (
            <pre
              key={key}
              style={{
                margin: "0 0 16px",
                padding: "14px 16px",
                background: INK,
                border: `1px solid ${LINE}`,
                borderRadius: R_MD,
                overflowX: "auto",
                fontFamily: MONO,
                fontSize: 12,
                lineHeight: 1.62,
                color: PAPER,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <code>{b.text}</code>
            </pre>
          );
        }

        if (b.kind === "ul" || b.kind === "ol") {
          const Tag = (b.kind === "ol" ? "ol" : "ul") as "ul";
          return (
            <Tag
              key={key}
              style={{
                margin: "0 0 14px",
                paddingLeft: 22,
                fontSize: 14,
                lineHeight: 1.62,
                color: PAPER,
              }}
            >
              {b.items.map((it, j) => (
                <li key={`${key}-${j}`} style={{ margin: "0 0 6px" }}>
                  {inline(it, `${key}-${j}`)}
                </li>
              ))}
            </Tag>
          );
        }

        if (b.kind === "table") {
          return (
            <div key={key} style={{ margin: "0 0 18px", overflowX: "auto" }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  fontSize: 13,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <thead>
                  <tr>
                    {b.head.map((h, j) => (
                      <th
                        key={`${key}-h${j}`}
                        style={{
                          textAlign: "left",
                          padding: "8px 12px",
                          borderBottom: `1px solid ${LINE}`,
                          background: rgba(ACCENT_TEXT, 0.05),
                          fontFamily: MONO,
                          fontSize: 10,
                          fontWeight: W_MED,
                          letterSpacing: "0.09em",
                          textTransform: "uppercase",
                          color: PAPER_QUIET,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {inline(h, `${key}-h${j}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={`${key}-r${j}`}>
                      {r.map((c, m) => (
                        <td
                          key={`${key}-r${j}c${m}`}
                          style={{
                            padding: "8px 12px",
                            borderBottom: `1px solid ${rgba(PAPER_QUIET, 0.1)}`,
                            verticalAlign: "top",
                            lineHeight: 1.55,
                            color: PAPER,
                          }}
                        >
                          {inline(c, `${key}-r${j}c${m}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <div
            key={key}
            style={{ height: 1, background: LINE, margin: "26px 0", borderRadius: R_LG }}
          />
        );
      })}
    </>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function Formulas() {
  const blocks = useMemo(() => parse(source), []);
  const sections = useMemo(
    () =>
      blocks.filter(
        (b): b is Extract<Block, { kind: "h" }> => b.kind === "h" && b.level === 2,
      ),
    [blocks],
  );

  return (
    <PageShell
      title="Formula reference"
      lede={
        <>
          Every quantitative formula, constant and threshold the CB Edge engine computes, transcribed
          from the source that runs. Black-Scholes and the greeks, the exposure grids, dealer
          inventory, the profile and initial balance work, the ICT detectors, the scoring and grading
          tables, and the display math underneath them.
        </>
      }
    >
      <Card
        title={`Contents · ${sections.length} sections`}
        subtitle="Section numbers match the headings in the document."
        style={{ marginBottom: 26 }}
      >
        <nav
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(232px, 1fr))",
            gap: "6px 18px",
          }}
        >
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: ACCENT_TEXT,
                textDecoration: "none",
                padding: "2px 0",
              }}
            >
              {s.text}
            </a>
          ))}
        </nav>
      </Card>

      <div style={{ background: ELEV, border: `1px solid ${LINE}`, borderRadius: R_LG, padding: "6px 24px 26px" }}>
        <Blocks blocks={blocks} />
      </div>
    </PageShell>
  );
}
