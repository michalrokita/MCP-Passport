import { promises as fs } from 'fs'
import { join } from 'path'
import { paths } from '../paths'
import {
  pathExists,
  readJsonSafe,
  writeJsonAtomic,
  asRecord,
  stableId,
  listDirNames
} from '../util'
import type {
  CanonicalMcp,
  InventoryItem,
  ToolPresence,
  McpTransport
} from '../../shared/types'

interface ClaudeDesktopConfig {
  mcpServers?: Record<string, RawMcp>
  preferences?: Record<string, unknown>
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
  const transport: McpTransport = raw.type ?? (raw.command ? 'stdio' : raw.url ? 'http' : 'stdio')
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
  return {
    type: c.transport,
    url: c.url,
    headers: c.headers
  }
}

export async function detect(): Promise<ToolPresence> {
  const installed = await pathExists(paths.claudeDesktopApp)
  const configExists = await pathExists(paths.claudeDesktopConfig)
  const sessionsExists = await pathExists(paths.claudeDesktopLocalAgentSessions)
  const warnings: string[] = []
  return {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    family: 'claude',
    surface: 'desktop',
    installed,
    installNotes: installed ? undefined : 'Install from claude.ai/download',
    configPaths: [
      { label: 'MCP config (stdio)', path: paths.claudeDesktopConfig, exists: configExists },
      {
        label: 'Remote MCPs (sessions)',
        path: paths.claudeDesktopLocalAgentSessions,
        exists: sessionsExists
      },
      {
        label: 'App preferences',
        path: paths.claudeDesktopAppConfig,
        exists: await pathExists(paths.claudeDesktopAppConfig)
      },
      {
        label: 'Extensions (DXT/MCPB)',
        path: paths.claudeDesktopExtensionsDir,
        exists: await pathExists(paths.claudeDesktopExtensionsDir)
      }
    ],
    authStatus: 'unknown',
    warnings
  }
}

// MCP servers in claude_desktop_config.json (stdio or http types) — locally edited
async function readLocalMcps(): Promise<InventoryItem[]> {
  const cfg = (await readJsonSafe<ClaudeDesktopConfig>(paths.claudeDesktopConfig)) ?? {}
  const servers = asRecord(cfg.mcpServers)
  const items: InventoryItem[] = []
  for (const [name, raw] of Object.entries(servers)) {
    const rawObj = raw as RawMcp
    const canonical = rawToCanonical(rawObj)
    items.push({
      id: stableId(['mcp', name]),
      kind: 'mcp',
      name,
      description: canonical.command
        ? `${canonical.command} ${canonical.args?.join(' ') ?? ''}`.trim()
        : canonical.url,
      presences: [
        {
          toolId: 'claude-desktop',
          scope: 'global',
          source: {
            kind: 'mcp',
            canonical,
            raw: rawObj,
            locator: { kind: 'claude-desktop' }
          }
        }
      ]
    })
  }
  return items
}

// NEW: Read cloud-managed remote MCPs from the most recent session JSON.
// Claude Desktop ("Cowork" mode) writes the live remoteMcpServersConfig (with name, url, tools)
// to each session's local_<id>.json file. We pick the most recent session.
interface RemoteMcpEntry {
  uuid: string
  name: string
  url: string
  tools?: { name: string; description?: string }[]
}

async function readRemoteMcpsFromSessions(): Promise<InventoryItem[]> {
  const root = paths.claudeDesktopLocalAgentSessions
  if (!(await pathExists(root))) return []
  const items: InventoryItem[] = []
  // Scan many recent sessions because the newest sessions sometimes omit url/tools.
  const sessionFiles = await findRecentSessionJsons(root, 30)
  // Merge: pick the entry per uuid that has the most fields populated (prefers entries with `url`).
  const merged = new Map<string, RemoteMcpEntry>()
  for (const file of sessionFiles) {
    const data = await readJsonSafe<{ remoteMcpServersConfig?: RemoteMcpEntry[] }>(file)
    const list = data?.remoteMcpServersConfig
    if (!Array.isArray(list)) continue
    for (const e of list) {
      if (!e?.uuid || !e?.name) continue
      const cur = merged.get(e.uuid)
      const score = (e.url ? 2 : 0) + (e.tools?.length ? 1 : 0)
      const curScore = cur ? (cur.url ? 2 : 0) + (cur.tools?.length ? 1 : 0) : -1
      if (score > curScore) merged.set(e.uuid, e)
    }
  }
  for (const e of merged.values()) {
    const canonical: CanonicalMcp = {
      transport: 'http',
      url: e.url,
      enabled: true
    }
    const toolCount = e.tools?.length ?? 0
    const descParts = [
      e.url,
      toolCount ? `${toolCount} tools` : undefined,
      'cloud-managed (Anthropic Connector)'
    ].filter(Boolean)
    items.push({
      id: stableId(['mcp', e.name]),
      kind: 'mcp',
      name: e.name,
      description: descParts.join(' · '),
      presences: [
        {
          toolId: 'claude-desktop',
          scope: 'global',
          source: {
            kind: 'mcp',
            canonical,
            raw: { __remote: true, uuid: e.uuid, url: e.url, tools: toolCount },
            locator: { kind: 'claude-desktop' }
          }
        }
      ]
    })
  }
  return items
}

async function findRecentSessionJsons(root: string, limit: number): Promise<string[]> {
  const found: { path: string; mtime: number }[] = []
  async function walk(dir: string, depth: number) {
    if (depth > 4) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full, depth + 1)
      } else if (e.isFile() && e.name.startsWith('local_') && e.name.endsWith('.json')) {
        try {
          const st = await fs.stat(full)
          found.push({ path: full, mtime: st.mtimeMs })
        } catch {
          // skip
        }
      }
    }
  }
  await walk(root, 0)
  found.sort((a, b) => b.mtime - a.mtime)
  return found.slice(0, limit).map((f) => f.path)
}

export async function readMcps(): Promise<InventoryItem[]> {
  const [local, remote] = await Promise.all([readLocalMcps(), readRemoteMcpsFromSessions()])
  // Deduplicate by id: prefer remote (has tool count) but merge presences if same name appears in both.
  const byId = new Map<string, InventoryItem>()
  for (const it of [...remote, ...local]) {
    const cur = byId.get(it.id)
    if (!cur) byId.set(it.id, it)
    else cur.presences.push(...it.presences)
  }
  return [...byId.values()]
}

export async function upsertMcp(name: string, canonical: CanonicalMcp): Promise<void> {
  const cfg = (await readJsonSafe<ClaudeDesktopConfig>(paths.claudeDesktopConfig)) ?? {}
  const servers = { ...(cfg.mcpServers ?? {}) }
  servers[name] = canonicalToRaw(canonical)
  cfg.mcpServers = servers
  await writeJsonAtomic(paths.claudeDesktopConfig, cfg)
}

export async function removeMcp(name: string): Promise<void> {
  const cfg = await readJsonSafe<ClaudeDesktopConfig>(paths.claudeDesktopConfig)
  if (!cfg?.mcpServers) return
  delete cfg.mcpServers[name]
  await writeJsonAtomic(paths.claudeDesktopConfig, cfg)
}

// DXT extensions — read installations index if present, plus enumerate Extensions/ subdirs.
interface ExtensionInstallation {
  id?: string
  name?: string
  displayName?: string
  version?: string
  enabled?: boolean
  signed?: boolean
}

export async function readExtensions(): Promise<InventoryItem[]> {
  const items: InventoryItem[] = []
  // 1) installations metadata file
  const installs = await readJsonSafe<{ installations?: ExtensionInstallation[] } | ExtensionInstallation[]>(
    paths.claudeDesktopExtensionInstallations
  )
  const list = Array.isArray(installs)
    ? installs
    : Array.isArray((installs as any)?.installations)
    ? (installs as any).installations
    : []
  for (const ext of list) {
    const display = ext.displayName ?? ext.name ?? ext.id ?? 'extension'
    items.push({
      id: stableId(['plugin', display]),
      kind: 'plugin',
      name: display,
      description: `Claude Desktop extension (DXT/MCPB) — version ${ext.version ?? '?'}`,
      presences: [
        {
          toolId: 'claude-desktop',
          scope: 'global',
          enabled: ext.enabled !== false,
          source: {
            kind: 'plugin',
            marketplace: 'claude-desktop-extensions',
            installPath: paths.claudeDesktopExtensionsDir,
            version: ext.version,
            enabled: ext.enabled !== false
          }
        }
      ]
    })
  }
  // 2) Walk Extensions/ for any directories (older versions used dir-per-extension)
  if (await pathExists(paths.claudeDesktopExtensionsDir)) {
    for (const dir of await listDirNames(paths.claudeDesktopExtensionsDir)) {
      // Avoid double-counting if installations metadata already mentions it
      if (items.some((it) => it.name === dir)) continue
      items.push({
        id: stableId(['plugin', dir]),
        kind: 'plugin',
        name: dir,
        description: 'Claude Desktop extension directory',
        presences: [
          {
            toolId: 'claude-desktop',
            scope: 'global',
            enabled: true,
            source: {
              kind: 'plugin',
              marketplace: 'claude-desktop-extensions',
              installPath: join(paths.claudeDesktopExtensionsDir, dir),
              enabled: true
            }
          }
        ]
      })
    }
  }
  return items
}

// Claude Desktop bundles a built-in skills plugin in local-agent-mode-sessions/skills-plugin/
// that includes anthropic-skills (xlsx, pdf, etc.). We can read the manifest there for a list.
interface SkillsPluginManifestEntry {
  skillId: string
  name: string
  description: string
  enabled?: boolean
}

export async function readBundledSkills(): Promise<InventoryItem[]> {
  // Find skills-plugin/<orgId>/<userId>/manifest.json
  const root = join(paths.claudeDesktopLocalAgentSessions, 'skills-plugin')
  if (!(await pathExists(root))) return []
  const items: InventoryItem[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isFile() && e.name === 'manifest.json') {
        const data = await readJsonSafe<{ skills?: SkillsPluginManifestEntry[] }>(full)
        for (const s of data?.skills ?? []) {
          items.push({
            id: stableId(['skill', s.name || s.skillId]),
            kind: 'skill',
            name: s.name || s.skillId,
            description: s.description?.slice(0, 280),
            presences: [
              {
                toolId: 'claude-desktop',
                scope: 'global',
                enabled: s.enabled !== false,
                source: {
                  kind: 'skill',
                  path: dir,
                  frontmatter: { name: s.name, description: s.description }
                }
              }
            ]
          })
        }
        return
      } else if (e.isDirectory()) {
        await walk(full, depth + 1)
      }
    }
  }
  await walk(root, 0)
  return items
}

export async function readAll(): Promise<InventoryItem[]> {
  const [mcps, exts, skills] = await Promise.all([readMcps(), readExtensions(), readBundledSkills()])
  return [...mcps, ...exts, ...skills]
}
