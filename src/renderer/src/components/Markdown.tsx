import { Fragment } from 'react'
import { openExternal } from '../lib/api'

/**
 * Tiny, safe Markdown renderer for the subset our GitHub release notes use.
 * Builds React elements (no `dangerouslySetInnerHTML`) so we don't need a
 * sanitizer — anything not matched falls through as plain text.
 *
 * Supports:
 *   - `## h2`, `### h3` headings
 *   - paragraphs (blank line separates)
 *   - `- item` / `* item` unordered lists
 *   - `> quoted` blockquotes
 *   - inline `**bold**`, `` `code` ``, `[text](url)`
 *
 * Anything else (images, tables, fenced code blocks, ordered lists, etc.)
 * renders as plain paragraph text. If our release-notes style outgrows this,
 * swap in `marked` + `DOMPurify`.
 */
export function Markdown({ source }: { source: string }): JSX.Element {
  const blocks = parseBlocks(source.trim())
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink-200">
      {blocks.map((block, i) => renderBlock(block, i))}
    </div>
  )
}

type Block =
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' }

function parseBlocks(src: string): Block[] {
  const lines = src.split('\n')
  const out: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Blank line — skip.
    if (!line.trim()) {
      i++
      continue
    }

    // Horizontal rule.
    if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) {
      out.push({ kind: 'hr' })
      i++
      continue
    }

    // Headings.
    const h2 = /^##\s+(.+?)\s*$/.exec(line)
    if (h2) {
      out.push({ kind: 'h2', text: h2[1] })
      i++
      continue
    }
    const h3 = /^###\s+(.+?)\s*$/.exec(line)
    if (h3) {
      out.push({ kind: 'h3', text: h3[1] })
      i++
      continue
    }

    // Bullet list — collect consecutive `- ` / `* ` lines.
    if (/^[\-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[\-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\-*]\s+/, ''))
        i++
      }
      out.push({ kind: 'ul', items })
      continue
    }

    // Blockquote — collect consecutive `> ` lines.
    if (/^>\s?/.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      out.push({ kind: 'quote', text: quoted.join('\n').trim() })
      continue
    }

    // Paragraph — collect consecutive non-blank, non-special lines.
    const para: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(##\s|###\s|[\-*]\s|>\s?|---+\s*$|\*\*\*+\s*$|___+\s*$)/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    out.push({ kind: 'p', text: para.join(' ') })
  }

  return out
}

function renderBlock(block: Block, key: number): JSX.Element {
  switch (block.kind) {
    case 'h2':
      return (
        <h2 key={key} className="text-base font-semibold text-ink-50">
          {renderInline(block.text)}
        </h2>
      )
    case 'h3':
      return (
        <h3 key={key} className="text-sm font-semibold text-ink-100">
          {renderInline(block.text)}
        </h3>
      )
    case 'p':
      return (
        <p key={key} className="text-ink-200">
          {renderInline(block.text)}
        </p>
      )
    case 'ul':
      return (
        <ul key={key} className="ml-4 list-disc space-y-1 marker:text-ink-500">
          {block.items.map((item, j) => (
            <li key={j} className="text-ink-200">
              {renderInline(item)}
            </li>
          ))}
        </ul>
      )
    case 'quote':
      return (
        <blockquote
          key={key}
          className="rounded-md border-l-2 border-accent/40 bg-white/[0.03] px-3 py-2 text-ink-300"
        >
          {block.text.split('\n').map((l, j) => (
            <p key={j}>{renderInline(l)}</p>
          ))}
        </blockquote>
      )
    case 'hr':
      return <hr key={key} className="my-2 border-white/10" />
  }
}

/** Inline pass: `**bold**`, `` `code` ``, `[text](url)`. Order: link → bold → code. */
function renderInline(text: string): JSX.Element {
  // Tokenize using a single regex that captures the three inline forms.
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g
  const out: Array<JSX.Element | string> = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] && m[2]) {
      const url = m[2]
      out.push(
        <a
          key={key++}
          href={url}
          onClick={(e) => {
            e.preventDefault()
            void openExternal(url)
          }}
          className="text-accent hover:underline"
        >
          {m[1]}
        </a>
      )
    } else if (m[3]) {
      out.push(
        <strong key={key++} className="font-semibold text-ink-50">
          {m[3]}
        </strong>
      )
    } else if (m[4]) {
      out.push(
        <code
          key={key++}
          className="rounded bg-white/10 px-1 py-px font-mono text-[12px] text-ink-100"
        >
          {m[4]}
        </code>
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))

  return <Fragment>{out}</Fragment>
}
