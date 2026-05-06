import { promises as fs } from 'fs'
import { join } from 'path'
import {
  paths,
  projectClaudeMcpJson,
  projectClaudeSkillsDir,
  projectClaudeSettings,
  projectClaudeAgentsDir
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
  ToolPresence,
  McpTransport
} from '../../shared/types'
import { canonicalToRaw, rawToCanonical } from './claudeDesktop'

interface ClaudeCodeUserConfig {
  mcpServers?: Record<string, unknown>
  projects?: Record<string, ClaudeCodeProjectEntry>
}

interface ClaudeCodeProjectEntry {
  enabledMcpjsonServers?: string[]
  disabledMcpjsonServers?: string[]
  hasTrustDialogAccepted?: boolean
}

interface InstalledPluginsFile {
  version?: number
  plugins: Record<
    string,
    Array<{
      scope: 'project' | 'user' | 'global'
      projectPath?: string
      installPath?: string
      version?: string
      installedAt?: string
      lastUpdated?: string
      gitCommitSha?: string
    }>
  >
}

interface ProjectMcpJson {
  mcpServers?: Record<string, unknown>
}

interface ProjectSettings {
  enabledPlugins?: Record<string, boolean>
}

export async function detect(): Promise<ToolPresence> {
  const userConfigExists = await pathExists(paths.claudeCodeUserConfig)
  const dirExists = await pathExists(paths.claudeCodeDir)
  return {
    id: 'claude-code',
    name: 'Claude Code',
    family: 'claude',
    surface: 'cli',
    installed: userConfigExists || dirExists,
    installNotes: userConfigExists ? undefined : 'Install with: npm i -g @anthropic-ai/claude-code',
    configPaths: [
      { label: 'User config', path: paths.claudeCodeUserConfig, exists: userConfigExists },
      { label: 'Skills dir', path: paths.claudeCodeUserSkillsDir, exists: await pathExists(paths.claudeCodeUserSkillsDir) },
      { label: 'Plugins index', path: paths.claudeCodePluginsInstalled, exists: await pathExists(paths.claudeCodePluginsInstalled) },
      { label: 'Marketplaces', path: paths.claudeCodePluginsKnownMarketplaces, exists: await pathExists(paths.claudeCodePluginsKnownMarketplaces) },
      { label: 'Agents dir', path: paths.claudeCodeUserAgentsDir, exists: await pathExists(paths.claudeCodeUserAgentsDir) }
    ],
    authStatus: 'unknown'
  }
}

// Worktrees that Claude Code creates under <base>/.claude/worktrees/<name> get a
// distinct entry in ~/.claude.json's projects map, but they're not "real" projects —
// just ephemeral copies of a base repo. Same for git's own <base>/.git/worktrees/.
const WORKTREE_PATTERNS = [/\/\.claude\/worktrees\//, /\/\.git\/worktrees\//]

function isWorktreePath(p: string): boolean {
  return WORKTREE_PATTERNS.some((rx) => rx.test(p))
}

export async function getProjects(): Promise<{ path: string; label: string }[]> {
  const cfg = await readJsonSafe<ClaudeCodeUserConfig>(paths.claudeCodeUserConfig)
  if (!cfg?.projects) return []
  // Dedupe: drop worktree paths, keep their base project (which has its own entry).
  const seen = new Set<string>()
  const list: { path: string; label: string }[] = []
  for (const p of Object.keys(cfg.projects)) {
    if (!p) continue
    if (isWorktreePath(p)) continue
    if (seen.has(p)) continue
    seen.add(p)
    list.push({ path: p, label: p.split('/').slice(-2).join('/') })
  }
  return list.sort((a, b) => a.label.localeCompare(b.label))
}

export async function readMcpsUser(): Promise<InventoryItem[]> {
  const cfg = await readJsonSafe<ClaudeCodeUserConfig>(paths.claudeCodeUserConfig)
  const servers = asRecord(cfg?.mcpServers)
  const out: InventoryItem[] = []
  for (const [name, raw] of Object.entries(servers)) {
    const canonical = rawToCanonical(raw as any)
    out.push({
      id: stableId(['mcp', name]),
      kind: 'mcp',
      name,
      description: canonical.command
        ? `${canonical.command} ${canonical.args?.join(' ') ?? ''}`.trim()
        : canonical.url,
      presences: [
        {
          toolId: 'claude-code',
          scope: 'global',
          source: {
            kind: 'mcp',
            canonical,
            raw,
            locator: { kind: 'claude-code-user' }
          }
        }
      ]
    })
  }
  return out
}

export async function readMcpsProjects(
  projects: { path: string }[]
): Promise<InventoryItem[]> {
  const out: InventoryItem[] = []
  for (const proj of projects) {
    const mcpJsonPath = projectClaudeMcpJson(proj.path)
    const data = await readJsonSafe<ProjectMcpJson>(mcpJsonPath)
    if (!data?.mcpServers) continue
    for (const [name, raw] of Object.entries(data.mcpServers)) {
      const canonical = rawToCanonical(raw as any)
      out.push({
        id: stableId(['mcp', name]),
        kind: 'mcp',
        name,
        description: canonical.command
          ? `${canonical.command} ${canonical.args?.join(' ') ?? ''}`.trim()
          : canonical.url,
        presences: [
          {
            toolId: 'claude-code',
            scope: 'project',
            projectPath: proj.path,
            source: {
              kind: 'mcp',
              canonical,
              raw,
              locator: { kind: 'claude-code-project', projectPath: proj.path }
            }
          }
        ]
      })
    }
  }
  return out
}

export async function readSkillsUser(): Promise<InventoryItem[]> {
  return readSkillsAt(paths.claudeCodeUserSkillsDir, 'global')
}

export async function readSkillsProjects(projects: { path: string }[]): Promise<InventoryItem[]> {
  const out: InventoryItem[] = []
  for (const p of projects) {
    const dir = projectClaudeSkillsDir(p.path)
    const items = await readSkillsAt(dir, 'project', p.path)
    out.push(...items)
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
      description: typeof frontmatter['description'] === 'string'
        ? (frontmatter['description'] as string).slice(0, 280)
        : undefined,
      presences: [
        {
          toolId: 'claude-code',
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

export async function readAgentsUser(): Promise<InventoryItem[]> {
  return readAgentsAt(paths.claudeCodeUserAgentsDir, 'global')
}

export async function readAgentsProjects(projects: { path: string }[]): Promise<InventoryItem[]> {
  const out: InventoryItem[] = []
  for (const p of projects) {
    const dir = projectClaudeAgentsDir(p.path)
    out.push(...(await readAgentsAt(dir, 'project', p.path)))
  }
  return out
}

async function readAgentsAt(
  dir: string,
  scope: 'global' | 'project',
  projectPath?: string
): Promise<InventoryItem[]> {
  const out: InventoryItem[] = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.md')) continue
      const full = join(dir, e.name)
      const content = (await readTextSafe(full)) ?? ''
      const { frontmatter } = parseFrontmatter(content)
      const baseName = e.name.replace(/\.md$/, '')
      const display =
        typeof frontmatter['name'] === 'string' ? (frontmatter['name'] as string) : baseName
      out.push({
        id: stableId(['agent', display]),
        kind: 'agent',
        name: display,
        description:
          typeof frontmatter['description'] === 'string'
            ? (frontmatter['description'] as string).slice(0, 280)
            : undefined,
        presences: [
          {
            toolId: 'claude-code',
            scope,
            projectPath,
            source: {
              kind: 'agent',
              path: full,
              frontmatter
            }
          }
        ]
      })
    }
  } catch {
    // ignore
  }
  return out
}

export async function readPlugins(projects: { path: string }[]): Promise<InventoryItem[]> {
  const installed = await readJsonSafe<InstalledPluginsFile>(paths.claudeCodePluginsInstalled)
  if (!installed?.plugins) return []
  const out: InventoryItem[] = []

  // Build per-project enabled maps once.
  const projectEnabled = new Map<string, Record<string, boolean>>()
  for (const proj of projects) {
    const settings = await readJsonSafe<ProjectSettings>(projectClaudeSettings(proj.path))
    if (settings?.enabledPlugins) projectEnabled.set(proj.path, settings.enabledPlugins)
  }

  for (const [pluginKey, entries] of Object.entries(installed.plugins)) {
    const [pluginName, marketplace] = pluginKey.split('@')
    for (const entry of entries) {
      const enabled =
        entry.scope === 'project' && entry.projectPath
          ? Boolean(projectEnabled.get(entry.projectPath)?.[pluginKey])
          : true
      out.push({
        id: stableId(['plugin', pluginKey]),
        kind: 'plugin',
        name: pluginName,
        description: marketplace ? `from ${marketplace}` : undefined,
        presences: [
          {
            toolId: 'claude-code',
            scope: entry.scope === 'project' ? 'project' : 'global',
            projectPath: entry.projectPath,
            enabled,
            source: {
              kind: 'plugin',
              marketplace,
              installPath: entry.installPath,
              version: entry.version,
              enabled
            }
          }
        ]
      })
    }
  }
  return out
}

export async function upsertMcpUser(name: string, canonical: CanonicalMcp): Promise<void> {
  const cfg = (await readJsonSafe<ClaudeCodeUserConfig>(paths.claudeCodeUserConfig)) ?? {}
  const servers = asRecord(cfg.mcpServers)
  servers[name] = canonicalToRaw(canonical) as unknown as Record<string, unknown>
  cfg.mcpServers = servers
  await writeJsonAtomic(paths.claudeCodeUserConfig, cfg)
}

export async function upsertMcpProject(
  projectPath: string,
  name: string,
  canonical: CanonicalMcp
): Promise<void> {
  const file = projectClaudeMcpJson(projectPath)
  const data = (await readJsonSafe<ProjectMcpJson>(file)) ?? {}
  const servers = (data.mcpServers as Record<string, unknown>) ?? {}
  servers[name] = canonicalToRaw(canonical) as unknown as Record<string, unknown>
  data.mcpServers = servers
  await writeJsonAtomic(file, data)
  // Auto-trust this project entry in user config so the MCP loads without a prompt
  const userCfg = (await readJsonSafe<ClaudeCodeUserConfig>(paths.claudeCodeUserConfig)) ?? {}
  userCfg.projects = userCfg.projects ?? {}
  const proj = (userCfg.projects[projectPath] ?? {}) as ClaudeCodeProjectEntry
  const enabled = new Set(proj.enabledMcpjsonServers ?? [])
  enabled.add(name)
  proj.enabledMcpjsonServers = [...enabled]
  userCfg.projects[projectPath] = proj
  await writeJsonAtomic(paths.claudeCodeUserConfig, userCfg)
}

export async function removeMcpUser(name: string): Promise<void> {
  const cfg = await readJsonSafe<ClaudeCodeUserConfig>(paths.claudeCodeUserConfig)
  if (!cfg?.mcpServers) return
  const servers = asRecord(cfg.mcpServers)
  delete servers[name]
  cfg.mcpServers = servers
  await writeJsonAtomic(paths.claudeCodeUserConfig, cfg)
}

export async function removeMcpProject(projectPath: string, name: string): Promise<void> {
  const file = projectClaudeMcpJson(projectPath)
  const data = await readJsonSafe<ProjectMcpJson>(file)
  if (!data?.mcpServers) return
  delete (data.mcpServers as Record<string, unknown>)[name]
  await writeJsonAtomic(file, data)
}

export async function copySkillToUser(srcDir: string, name: string): Promise<string> {
  const dest = join(paths.claudeCodeUserSkillsDir, name)
  await copyDirRecursive(srcDir, dest)
  return dest
}

export async function copySkillToProject(
  projectPath: string,
  srcDir: string,
  name: string
): Promise<string> {
  const dest = join(projectClaudeSkillsDir(projectPath), name)
  await copyDirRecursive(srcDir, dest)
  return dest
}

export async function copyAgentToUser(srcPath: string, name: string): Promise<string> {
  const dest = join(paths.claudeCodeUserAgentsDir, `${name}.md`)
  await fs.mkdir(paths.claudeCodeUserAgentsDir, { recursive: true })
  await fs.copyFile(srcPath, dest)
  return dest
}

export async function copyAgentToProject(
  projectPath: string,
  srcPath: string,
  name: string
): Promise<string> {
  const dir = projectClaudeAgentsDir(projectPath)
  const dest = join(dir, `${name}.md`)
  await fs.mkdir(dir, { recursive: true })
  await fs.copyFile(srcPath, dest)
  return dest
}

export async function setPluginEnabled(
  projectPath: string,
  pluginKey: string,
  enabled: boolean
): Promise<void> {
  const settingsPath = projectClaudeSettings(projectPath)
  const settings = (await readJsonSafe<ProjectSettings>(settingsPath)) ?? {}
  const enabledMap = settings.enabledPlugins ?? {}
  enabledMap[pluginKey] = enabled
  settings.enabledPlugins = enabledMap
  await writeJsonAtomic(settingsPath, settings)
}

export async function ensureMarketplace(
  marketplaceName: string,
  source: { source: 'github'; repo: string }
): Promise<void> {
  const file = paths.claudeCodePluginsKnownMarketplaces
  const data =
    (await readJsonSafe<Record<string, unknown>>(file)) ?? ({} as Record<string, unknown>)
  if (!(data as Record<string, unknown>)[marketplaceName]) {
    ;(data as Record<string, unknown>)[marketplaceName] = {
      source,
      installLocation: paths.claudeCodeUserConfig.replace(/\.claude\.json$/, '.claude/plugins/marketplaces/' + marketplaceName),
      lastUpdated: new Date().toISOString()
    }
    await writeJsonAtomic(file, data)
  }
}
