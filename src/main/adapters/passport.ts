// MCP Passport's own library — a local store of MCPs and skills the user
// curates inside Passport. Items in the library can be synced/copied out to
// any other tool, and Passport always shows up as a tool in the sidebar.

import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  copyDirRecursive,
  parseFrontmatter,
  pathExists,
  readJsonSafe,
  readTextSafe,
  stableId,
  writeJsonAtomic,
  writeTextAtomic
} from '../util'
import type {
  CanonicalMcp,
  InventoryItem,
  LibraryMcpInput,
  LibrarySkillInput,
  ToolPresence
} from '../../shared/types'

interface LibraryFile {
  version: number
  mcps: Record<
    string,
    {
      description?: string
      canonical: CanonicalMcp
      addedAt: string
      lastUpdated: string
    }
  >
}

function userDataDir(): string {
  // Lazily resolve Electron's userData; in non-Electron contexts (e.g. our scan-test
  // CLI smoke test) fall back to ~/Library/Application Support/mcp-passport on macOS.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron')
    if (electron?.app?.getPath) return electron.app.getPath('userData')
  } catch {
    // ignore — running outside Electron
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'mcp-passport')
  }
  return join(homedir(), '.config', 'mcp-passport')
}

function libraryDir(): string {
  return join(userDataDir(), 'library')
}
function libraryJsonPath(): string {
  return join(libraryDir(), 'library.json')
}
function librarySkillsDir(): string {
  return join(libraryDir(), 'skills')
}

async function readLibrary(): Promise<LibraryFile> {
  const data = await readJsonSafe<LibraryFile>(libraryJsonPath())
  if (!data) return { version: 1, mcps: {} }
  if (!data.mcps) data.mcps = {}
  return data
}

async function writeLibrary(data: LibraryFile): Promise<void> {
  await writeJsonAtomic(libraryJsonPath(), data)
}

export async function detect(): Promise<ToolPresence> {
  const dir = libraryDir()
  const exists = await pathExists(libraryJsonPath())
  return {
    id: 'passport',
    name: 'MCP Passport',
    family: 'claude', // arbitrary — we don't really fit either family
    surface: 'desktop',
    installed: true, // always available
    configPaths: [
      { label: 'Library', path: libraryJsonPath(), exists },
      { label: 'Library skills', path: librarySkillsDir(), exists: await pathExists(librarySkillsDir()) }
    ],
    authStatus: 'authenticated'
  }
}

export async function readMcps(): Promise<InventoryItem[]> {
  const lib = await readLibrary()
  const items: InventoryItem[] = []
  for (const [name, entry] of Object.entries(lib.mcps)) {
    items.push({
      id: stableId(['mcp', name]),
      kind: 'mcp',
      name,
      description: entry.description ?? mcpDescription(entry.canonical),
      presences: [
        {
          toolId: 'passport',
          scope: 'global',
          source: {
            kind: 'mcp',
            canonical: entry.canonical,
            raw: { __library: true, ...entry },
            locator: { kind: 'passport-library' }
          }
        }
      ]
    })
  }
  return items
}

function mcpDescription(c: CanonicalMcp): string {
  if (c.transport === 'stdio') return `${c.command ?? '?'} ${(c.args ?? []).join(' ')}`.trim()
  return c.url ?? ''
}

export async function readSkills(): Promise<InventoryItem[]> {
  const dir = librarySkillsDir()
  if (!(await pathExists(dir))) return []
  const items: InventoryItem[] = []
  let entries: string[] = []
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
  for (const name of entries) {
    const skillMd = join(dir, name, 'SKILL.md')
    if (!(await pathExists(skillMd))) continue
    const content = (await readTextSafe(skillMd)) ?? ''
    const { frontmatter } = parseFrontmatter(content)
    items.push({
      id: stableId(['skill', name]),
      kind: 'skill',
      name,
      description:
        typeof frontmatter['description'] === 'string'
          ? (frontmatter['description'] as string).slice(0, 280)
          : undefined,
      presences: [
        {
          toolId: 'passport',
          scope: 'global',
          source: {
            kind: 'skill',
            path: join(dir, name),
            frontmatter
          }
        }
      ]
    })
  }
  return items
}

export async function readAll(): Promise<InventoryItem[]> {
  const [mcps, skills] = await Promise.all([readMcps(), readSkills()])
  return [...mcps, ...skills]
}

export async function addMcp(input: LibraryMcpInput): Promise<void> {
  if (!input.name?.trim()) throw new Error('Name is required')
  const lib = await readLibrary()
  const now = new Date().toISOString()
  const existing = lib.mcps[input.name]
  lib.mcps[input.name] = {
    description: input.description,
    canonical: input.canonical,
    addedAt: existing?.addedAt ?? now,
    lastUpdated: now
  }
  await writeLibrary(lib)
}

export async function removeMcp(name: string): Promise<void> {
  const lib = await readLibrary()
  delete lib.mcps[name]
  await writeLibrary(lib)
}

export async function addSkill(input: LibrarySkillInput): Promise<string> {
  const safeName = input.name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()
  if (!safeName) throw new Error('Skill name is required')
  const dir = join(librarySkillsDir(), safeName)
  await fs.mkdir(dir, { recursive: true })
  const skillMd =
    input.rawSkillMd ?? buildSkillMd(safeName, input)
  await writeTextAtomic(join(dir, 'SKILL.md'), skillMd)
  return dir
}

// Single-quoted YAML scalars only need `'` → `''` escaping — much safer than
// double-quoted scalars where backslashes, quotes, and unicode escapes all
// interact. Used only when we have to synthesize frontmatter from form fields;
// fetched skills are written verbatim via input.rawSkillMd.
function yamlSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

function buildSkillMd(safeName: string, input: LibrarySkillInput): string {
  const fmLines = [
    '---',
    `name: ${safeName}`,
    `description: ${yamlSingleQuote(input.description ?? '')}`,
    input.whenToUse ? `when_to_use: ${yamlSingleQuote(input.whenToUse)}` : null,
    input.allowedTools ? `allowed-tools: ${input.allowedTools}` : null,
    '---',
    ''
  ]
    .filter((x): x is string => x !== null)
    .join('\n')
  return fmLines + (input.body ?? '')
}

// Copy an existing skill directory (with all of its files — SKILL.md, scripts,
// resources, …) into the library, preserving the original frontmatter.
// Used by the bulk import-from-tools flow.
export async function addSkillFromPath(name: string, srcDir: string): Promise<string> {
  const safeName = name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()
  if (!safeName) throw new Error('Skill name is required')
  const dest = join(librarySkillsDir(), safeName)
  await copyDirRecursive(srcDir, dest)
  return dest
}

export async function removeSkill(name: string): Promise<void> {
  const dir = join(librarySkillsDir(), name)
  await fs.rm(dir, { recursive: true, force: true })
}

export async function copySkillTo(srcDir: string, name: string, dest: string): Promise<void> {
  await copyDirRecursive(srcDir, dest)
  void name
}
