// Cursor (VS Code fork) adapter.
//
// Layout:
//   - Global MCP config: ~/.cursor/mcp.json     ({ mcpServers: { name: { command, args, env } | { url, headers } } })
//   - Project MCP config: <project>/.cursor/mcp.json (same shape)
//   - Global skills:      ~/.cursor/skills-cursor/<name>/SKILL.md
//   - Project skills:     <project>/.cursor/skills-cursor/<name>/SKILL.md
//   - Project list comes from VS Code workspaceStorage (each storage dir contains
//     workspace.json with `{"folder": "file:///path"}`), not the encoded
//     ~/.cursor/projects/ paths which are not bijective.
//
// Cursor accepts native http/sse transports via {url, headers} (no `type` field
// needed) and stdio via {command, args, env}.

import { promises as fs } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import {
  paths,
  projectCursorMcpJson,
  projectCursorSkillsDir
} from '../paths'
import {
  asRecord,
  listDirNames,
  pathExists,
  parseFrontmatter,
  readJsonSafe,
  readTextSafe,
  stableId,
  writeJsonAtomic,
  copyDirRecursive
} from '../util'
import type {
  CanonicalMcp,
  InventoryItem,
  McpTransport,
  ToolPresence
} from '../../shared/types'

interface CursorMcpConfig {
  mcpServers?: Record<string, unknown>
}

type RawMcp = {
  command?: string
  args?: string[]
  env?: Record<string, string>
  type?: McpTransport
  url?: string
  headers?: Record<string, string>
}

export function rawToCanonical(raw: RawMcp): CanonicalMcp {
  // Cursor distinguishes remote vs stdio by presence of `url`. The optional
  // `type` field is informational; we trust it when set, otherwise infer.
  const transport: McpTransport = raw.type ?? (raw.url ? 'http' : 'stdio')
  return {
    transport,
    command: raw.command,
    args: raw.args,
    env: raw.env,
    url: raw.url,
    headers: raw.headers
  }
}

export function canonicalToRaw(c: CanonicalMcp): RawMcp {
  if (c.transport === 'stdio') {
    return {
      command: c.command,
      args: c.args,
      env: c.env
    }
  }
  // Remote: omit `type` since Cursor distinguishes by `url`. We keep it for sse
  // because some Cursor versions require the explicit hint.
  const out: RawMcp = { url: c.url, headers: c.headers }
  if (c.transport === 'sse') out.type = 'sse'
  return out
}

export async function detect(): Promise<ToolPresence> {
  const installed = await pathExists(paths.cursorApp)
  const userConfigExists = await pathExists(paths.cursorUserMcpJson)
  const skillsDirExists = await pathExists(paths.cursorUserSkillsDir)
  return {
    id: 'cursor',
    name: 'Cursor',
    family: 'claude', // Cursor isn't really Anthropic-or-OpenAI; the family is a UI grouping
    surface: 'desktop',
    installed,
    installNotes: installed ? undefined : 'Install from cursor.com',
    configPaths: [
      { label: 'User MCPs', path: paths.cursorUserMcpJson, exists: userConfigExists },
      { label: 'Skills dir', path: paths.cursorUserSkillsDir, exists: skillsDirExists }
    ],
    authStatus: 'unknown'
  }
}

// Project list: walk workspaceStorage/*/workspace.json and decode the
// `file://` URIs. This is more reliable than the encoded ~/.cursor/projects/
// directory names (which collapse `/` and `-` ambiguously).
export async function getProjects(): Promise<{ path: string; label: string }[]> {
  const root = paths.cursorWorkspaceStorage
  if (!(await pathExists(root))) return []
  const out: { path: string; label: string }[] = []
  const seen = new Set<string>()
  let entries: import('fs').Dirent[] = []
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const wsJson = join(root, e.name, 'workspace.json')
    const data = await readJsonSafe<{ folder?: string; configuration?: string }>(wsJson)
    const uri = data?.folder ?? data?.configuration
    if (typeof uri !== 'string' || !uri.startsWith('file://')) continue
    let p: string
    try {
      p = fileURLToPath(uri)
    } catch {
      continue
    }
    if (!p || seen.has(p)) continue
    seen.add(p)
    out.push({ path: p, label: p.split('/').slice(-2).join('/') })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

export async function readMcpsUser(): Promise<InventoryItem[]> {
  const cfg = await readJsonSafe<CursorMcpConfig>(paths.cursorUserMcpJson)
  const servers = asRecord(cfg?.mcpServers)
  return mcpsFromServers(servers, { kind: 'cursor-user' }, 'global')
}

export async function readMcpsProjects(
  projects: { path: string }[]
): Promise<InventoryItem[]> {
  const out: InventoryItem[] = []
  for (const proj of projects) {
    const file = projectCursorMcpJson(proj.path)
    const data = await readJsonSafe<CursorMcpConfig>(file)
    if (!data?.mcpServers) continue
    const items = mcpsFromServers(
      asRecord(data.mcpServers),
      { kind: 'cursor-project', projectPath: proj.path },
      'project',
      proj.path
    )
    out.push(...items)
  }
  return out
}

function mcpsFromServers(
  servers: Record<string, unknown>,
  locator: { kind: 'cursor-user' } | { kind: 'cursor-project'; projectPath: string },
  scope: 'global' | 'project',
  projectPath?: string
): InventoryItem[] {
  const out: InventoryItem[] = []
  for (const [name, raw] of Object.entries(servers)) {
    const canonical = rawToCanonical(raw as RawMcp)
    out.push({
      id: stableId(['mcp', name]),
      kind: 'mcp',
      name,
      description: canonical.command
        ? `${canonical.command} ${canonical.args?.join(' ') ?? ''}`.trim()
        : canonical.url,
      presences: [
        {
          toolId: 'cursor',
          scope,
          projectPath,
          source: {
            kind: 'mcp',
            canonical,
            raw: raw as Record<string, unknown>,
            locator
          }
        }
      ]
    })
  }
  return out
}

export async function readSkillsUser(): Promise<InventoryItem[]> {
  return readSkillsAt(paths.cursorUserSkillsDir, 'global')
}

export async function readSkillsProjects(
  projects: { path: string }[]
): Promise<InventoryItem[]> {
  const out: InventoryItem[] = []
  for (const p of projects) {
    const dir = projectCursorSkillsDir(p.path)
    out.push(...(await readSkillsAt(dir, 'project', p.path)))
  }
  return out
}

async function readSkillsAt(
  dir: string,
  scope: 'global' | 'project',
  projectPath?: string
): Promise<InventoryItem[]> {
  const names = await listDirNames(dir)
  const out: InventoryItem[] = []
  for (const name of names) {
    const skillMd = join(dir, name, 'SKILL.md')
    if (!(await pathExists(skillMd))) continue
    const content = (await readTextSafe(skillMd)) ?? ''
    const { frontmatter } = parseFrontmatter(content)
    out.push({
      id: stableId(['skill', name]),
      kind: 'skill',
      name,
      description:
        typeof frontmatter['description'] === 'string'
          ? (frontmatter['description'] as string).slice(0, 280)
          : undefined,
      presences: [
        {
          toolId: 'cursor',
          scope,
          projectPath,
          source: {
            kind: 'skill',
            path: join(dir, name),
            frontmatter
          }
        }
      ]
    })
  }
  return out
}

export async function upsertMcpUser(name: string, canonical: CanonicalMcp): Promise<void> {
  const cfg = (await readJsonSafe<CursorMcpConfig>(paths.cursorUserMcpJson)) ?? {}
  const servers = asRecord(cfg.mcpServers)
  servers[name] = canonicalToRaw(canonical) as unknown as Record<string, unknown>
  cfg.mcpServers = servers
  await writeJsonAtomic(paths.cursorUserMcpJson, cfg)
}

export async function upsertMcpProject(
  projectPath: string,
  name: string,
  canonical: CanonicalMcp
): Promise<void> {
  const file = projectCursorMcpJson(projectPath)
  const data = (await readJsonSafe<CursorMcpConfig>(file)) ?? {}
  const servers = asRecord(data.mcpServers)
  servers[name] = canonicalToRaw(canonical) as unknown as Record<string, unknown>
  data.mcpServers = servers
  await writeJsonAtomic(file, data)
}

export async function removeMcpUser(name: string): Promise<void> {
  const cfg = await readJsonSafe<CursorMcpConfig>(paths.cursorUserMcpJson)
  if (!cfg?.mcpServers) return
  const servers = asRecord(cfg.mcpServers)
  delete servers[name]
  cfg.mcpServers = servers
  await writeJsonAtomic(paths.cursorUserMcpJson, cfg)
}

export async function removeMcpProject(projectPath: string, name: string): Promise<void> {
  const file = projectCursorMcpJson(projectPath)
  const data = await readJsonSafe<CursorMcpConfig>(file)
  if (!data?.mcpServers) return
  const servers = asRecord(data.mcpServers)
  delete servers[name]
  data.mcpServers = servers
  await writeJsonAtomic(file, data)
}

export async function copySkillToUser(srcDir: string, name: string): Promise<string> {
  const dest = join(paths.cursorUserSkillsDir, name)
  await copyDirRecursive(srcDir, dest)
  return dest
}

export async function copySkillToProject(
  projectPath: string,
  srcDir: string,
  name: string
): Promise<string> {
  const dest = join(projectCursorSkillsDir(projectPath), name)
  await copyDirRecursive(srcDir, dest)
  return dest
}
