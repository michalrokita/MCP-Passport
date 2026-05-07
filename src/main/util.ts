import { promises as fs } from 'fs'
import { dirname } from 'path'

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function readJsonSafe<T = unknown>(path: string): Promise<T | null> {
  try {
    const txt = await fs.readFile(path, 'utf8')
    return JSON.parse(txt) as T
  } catch {
    return null
  }
}

export async function readTextSafe(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch {
    return null
  }
}

export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await fs.rename(tmp, path)
}

export async function writeTextAtomic(path: string, content: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, path)
}

export async function listDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name)
      .filter((n) => !n.startsWith('.') && n !== 'node_modules')
  } catch {
    return []
  }
}

export async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return []
  }
}

export async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const s = `${src}/${entry.name}`
    const d = `${dest}/${entry.name}`
    if (entry.isDirectory()) {
      await copyDirRecursive(s, d)
    } else if (entry.isSymbolicLink()) {
      // Resolve and copy contents (avoid breaking links across tools)
      const real = await fs.readlink(s)
      const resolved = real.startsWith('/') ? real : `${src}/${real}`
      const stat = await fs.stat(resolved).catch(() => null)
      if (stat?.isDirectory()) await copyDirRecursive(resolved, d)
      else if (stat?.isFile()) await fs.copyFile(resolved, d)
    } else {
      await fs.copyFile(s, d)
    }
  }
}

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  // Allow optional carriage-returns so files saved with CRLF line endings still
  // parse cleanly (otherwise the closing `---` match fails and the whole
  // frontmatter falls into `body`).
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content)
  if (!m) return { frontmatter: {}, body: content }
  const fm: Record<string, unknown> = {}
  // Tiny YAML-ish parser supporting key: value, "quoted" values, and folded /
  // literal block scalars (`>`, `>-`, `|`, `|-`, `|+`). Block scalars are
  // common in Cursor and Anthropic skills' SKILL.md descriptions.
  const lines = m[1].replace(/\r/g, '').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (kv) {
      const key = kv[1]
      const inline = kv[2].trim()
      const blockMatch = /^([>|])([+-]?)$/.exec(inline)
      if (blockMatch) {
        // Block scalar — collect indented continuation lines until we hit a
        // line that's empty or de-indented to column 0.
        const fold = blockMatch[1] === '>' // `>` folds newlines into spaces, `|` keeps them
        const collected: string[] = []
        let j = i + 1
        while (j < lines.length) {
          const cont = lines[j]
          if (!cont.trim()) {
            // Blank line inside block — preserve as paragraph break for `|`,
            // but for `>` it becomes a single newline. Stop if the NEXT
            // non-blank line is unindented (means block ended).
            let k = j + 1
            while (k < lines.length && !lines[k].trim()) k++
            if (k >= lines.length || /^[A-Za-z0-9_-]+\s*:/.test(lines[k])) break
            collected.push('')
            j++
            continue
          }
          if (!/^\s/.test(cont)) break
          collected.push(cont.replace(/^\s+/, ''))
          j++
        }
        const joined = fold
          ? collected.join(' ').replace(/ +/g, ' ').trim()
          : collected.join('\n').trim()
        fm[key] = joined
        i = j
        continue
      }
      let value: unknown = inline
      if (typeof value === 'string') {
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        if (value === 'true') value = true
        else if (value === 'false') value = false
      }
      fm[key] = value
    }
    i++
  }
  return { frontmatter: fm, body: m[2] }
}

export function stableId(parts: string[]): string {
  return parts
    .map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    .filter(Boolean)
    .join(':')
}

export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
