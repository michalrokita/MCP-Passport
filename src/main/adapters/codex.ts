import { promises as fs } from 'fs'
import { join } from 'path'
import { parse, stringify } from 'smol-toml'
import { paths, projectCodexConfig } from '../paths'
import {
  asRecord,
  copyDirRecursive,
  listDirNames,
  parseFrontmatter,
  pathExists,
  readTextSafe,
  stableId,
  writeTextAtomic
} from '../util'
import type {
  CanonicalMcp,
  InventoryItem,
  ToolPresence,
  McpTransport,
  McpLocator,
  ToolId
} from '../../shared/types'

interface CodexConfig {
  model?: string
  mcp_servers?: Record<string, RawMcp>
  plugins?: Record<string, { enabled?: boolean }>
  marketplaces?: Record<
    string,
    { source_type?: string; source?: string; last_updated?: string; last_revision?: string }
  >
  projects?: Record<string, { trust_level?: string }>
  features?: Record<string, unknown>
  [key: string]: unknown
}

interface RawMcp {
  enabled?: boolean
  required?: boolean
  command?: string
  args?: string[]
  env?: Record<string, string>
  env_vars?: Array<string | { name: string; source: string }>
  cwd?: string
  url?: string
  bearer_token_env_var?: string
  http_headers?: Record<string, string>
  env_http_headers?: Record<string, string>
  startup_timeout_sec?: number
  tool_timeout_sec?: number
}

export async function readConfig(): Promise<CodexConfig | null> {
  const txt = await readTextSafe(paths.codexConfig)
  if (!txt) return null
  try {
    return parse(txt) as CodexConfig
  } catch {
    return null
  }
}

export async function writeConfig(cfg: CodexConfig): Promise<void> {
  await fs.mkdir(paths.codexHome, { recursive: true })
  // Preserve top-level scalar order roughly: keep existing top-of-file scalars first.
  const text = stringify(cfg as Record<string, unknown>)
  await writeTextAtomic(paths.codexConfig, text)
}

// --- Per-project config (<project>/.codex/config.toml) -----------------------

export async function readProjectConfig(projectPath: string): Promise<CodexConfig | null> {
  const txt = await readTextSafe(projectCodexConfig(projectPath))
  if (!txt) return null
  try {
    return parse(txt) as CodexConfig
  } catch {
    return null
  }
}

export async function writeProjectConfig(projectPath: string, cfg: CodexConfig): Promise<void> {
  const file = projectCodexConfig(projectPath)
  await fs.mkdir(join(projectPath, '.codex'), { recursive: true })
  await writeTextAtomic(file, stringify(cfg as Record<string, unknown>))
}

// --- Server-name rules -------------------------------------------------------
// Codex requires MCP server names to match this pattern; anything else (spaces,
// dots, slashes…) makes the server fail to start with "Invalid MCP server name".
const CODEX_NAME_RE = /^[a-zA-Z0-9_-]+$/

export function isValidCodexServerName(name: string): boolean {
  return CODEX_NAME_RE.test(name)
}

/** Coerce any string into a valid Codex server name (case preserved). */
export function sanitizeCodexServerName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
  return cleaned || 'mcp_server'
}

/** Append -2, -3… until the candidate doesn't collide with a taken name. */
function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/**
 * Compute the rename plan for every invalid server name in a config, keeping
 * the result collision-free against the names that stay valid and against
 * each other.
 */
export function planNameFixes(
  servers: Record<string, unknown> | undefined
): { from: string; to: string }[] {
  if (!servers) return []
  const names = Object.keys(servers)
  const taken = new Set(names.filter(isValidCodexServerName))
  const plan: { from: string; to: string }[] = []
  for (const name of names) {
    if (isValidCodexServerName(name)) continue
    const to = uniqueName(sanitizeCodexServerName(name), taken)
    taken.add(to)
    plan.push({ from: name, to })
  }
  return plan
}

export function rawToCanonical(raw: RawMcp): CanonicalMcp {
  const transport: McpTransport = raw.command ? 'stdio' : raw.url ? 'http' : 'stdio'
  const headers: Record<string, string> = { ...(raw.http_headers ?? {}) }
  if (raw.bearer_token_env_var) {
    headers['Authorization'] = `Bearer \${${raw.bearer_token_env_var}}`
  }
  return {
    transport,
    command: raw.command,
    args: raw.args,
    env: raw.env,
    env_vars: raw.env_vars?.map((v) => (typeof v === 'string' ? v : v.name)),
    url: raw.url,
    headers: Object.keys(headers).length ? headers : undefined,
    bearer_token_env_var: raw.bearer_token_env_var,
    env_http_headers: raw.env_http_headers,
    enabled: raw.enabled !== false
  }
}

export function canonicalToRaw(c: CanonicalMcp): RawMcp {
  if (c.transport === 'stdio') {
    return {
      enabled: c.enabled ?? true,
      command: c.command,
      args: c.args,
      env: c.env,
      env_vars: c.env_vars
    }
  }
  // HTTP / SSE
  const out: RawMcp = {
    enabled: c.enabled ?? true,
    url: c.url
  }
  if (c.bearer_token_env_var) out.bearer_token_env_var = c.bearer_token_env_var
  if (c.env_http_headers) out.env_http_headers = c.env_http_headers
  // Lift any plain headers (other than Authorization-bearer) into http_headers
  if (c.headers) {
    const lifted: Record<string, string> = {}
    for (const [k, v] of Object.entries(c.headers)) {
      if (k.toLowerCase() === 'authorization' && v.startsWith('Bearer ${') && v.endsWith('}')) {
        if (!out.bearer_token_env_var) {
          out.bearer_token_env_var = v.slice('Bearer ${'.length, -1)
        }
        continue
      }
      lifted[k] = v
    }
    if (Object.keys(lifted).length) out.http_headers = lifted
  }
  return out
}

export async function detectCodexCli(): Promise<ToolPresence> {
  const configExists = await pathExists(paths.codexConfig)
  const homeExists = await pathExists(paths.codexHome)
  const nameIssues = await detectNameIssues()
  return {
    id: 'codex-cli',
    name: 'Codex CLI',
    family: 'codex',
    surface: 'cli',
    installed: homeExists,
    installNotes: homeExists ? undefined : 'Install with: npm i -g @openai/codex',
    configPaths: [
      { label: 'Config', path: paths.codexConfig, exists: configExists },
      { label: 'Auth', path: paths.codexAuth, exists: await pathExists(paths.codexAuth) },
      { label: 'System skills', path: paths.codexSystemSkillsDir, exists: await pathExists(paths.codexSystemSkillsDir) },
      { label: 'User skills', path: paths.codexUserSkillsDir, exists: await pathExists(paths.codexUserSkillsDir) }
    ],
    authStatus: (await pathExists(paths.codexAuth)) ? 'authenticated' : 'not_signed_in',
    warnings: warningsForNameIssues(nameIssues),
    mcpNameIssues: nameIssues.length ? nameIssues : undefined
  }
}

/** Invalid global MCP server names (in ~/.codex/config.toml) and their fixes. */
async function detectNameIssues(): Promise<{ from: string; to: string }[]> {
  const cfg = await readConfig()
  return planNameFixes(cfg?.mcp_servers)
}

function warningsForNameIssues(issues: { from: string; to: string }[]): string[] | undefined {
  if (!issues.length) return undefined
  const names = issues.map((i) => `"${i.from}"`).join(', ')
  return [
    `${issues.length} MCP server name${issues.length === 1 ? '' : 's'} invalid for Codex ` +
      `(must match a-z, 0-9, _ or -): ${names}. These fail at startup until renamed.`
  ]
}

export async function detectCodexDesktop(): Promise<ToolPresence> {
  const installed = await pathExists(paths.codexDesktopApp)
  const sharedConfig = await pathExists(paths.codexConfig)
  const nameIssues = await detectNameIssues()
  const warnings: string[] = []
  if (installed && sharedConfig) {
    warnings.push('Codex Desktop and Codex CLI share configuration via ~/.codex/.')
  }
  warnings.push(...(warningsForNameIssues(nameIssues) ?? []))
  return {
    id: 'codex-desktop',
    name: 'Codex Desktop',
    family: 'codex',
    surface: 'desktop',
    installed,
    installNotes: installed
      ? undefined
      : 'Install Codex Desktop from chatgpt.com/codex/downloads',
    configPaths: [
      { label: 'Shared config (with CLI)', path: paths.codexConfig, exists: sharedConfig },
      { label: 'App data (Electron)', path: paths.codexDesktopDir, exists: await pathExists(paths.codexDesktopDir) },
      { label: 'Auth', path: paths.codexAuth, exists: await pathExists(paths.codexAuth) }
    ],
    authStatus: (await pathExists(paths.codexAuth)) ? 'authenticated' : 'not_signed_in',
    warnings: warnings.length ? warnings : undefined,
    mcpNameIssues: nameIssues.length ? nameIssues : undefined
  }
}

/**
 * Codex's trusted-projects table is the canonical list of projects it knows
 * about; surface them so project-scoped MCPs aren't invisible. Each entry maps
 * to a possible <project>/.codex/config.toml.
 */
export async function getProjects(): Promise<{ path: string; label: string }[]> {
  const cfg = await readConfig()
  const projects = cfg?.projects
  if (!projects) return []
  const out: { path: string; label: string }[] = []
  for (const path of Object.keys(projects)) {
    if (!path.startsWith('/')) continue
    out.push({ path, label: path.split('/').slice(-2).join('/') })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

// MCP, plugin, skill readers (all returning items tagged for Codex CLI primarily;
// caller will fan-out to also tag for codex-desktop since they share config).
function mcpsFromServers(
  servers: Record<string, RawMcp>,
  toolId: ToolId,
  scope: 'global' | 'project',
  locator: McpLocator,
  projectPath?: string
): InventoryItem[] {
  const out: InventoryItem[] = []
  for (const [name, raw] of Object.entries(servers)) {
    const canonical = rawToCanonical(raw)
    out.push({
      id: stableId(['mcp', name]),
      kind: 'mcp',
      name,
      description: canonical.command
        ? `${canonical.command} ${canonical.args?.join(' ') ?? ''}`.trim()
        : canonical.url,
      presences: [
        {
          toolId,
          scope,
          projectPath,
          enabled: canonical.enabled,
          source: {
            kind: 'mcp',
            canonical,
            raw,
            locator
          }
        }
      ]
    })
  }
  return out
}

export async function readMcps(toolId: ToolId): Promise<InventoryItem[]> {
  const cfg = await readConfig()
  if (!cfg?.mcp_servers) return []
  return mcpsFromServers(cfg.mcp_servers, toolId, 'global', { kind: 'codex' })
}

export async function readMcpsProjects(
  toolId: ToolId,
  projects: { path: string }[]
): Promise<InventoryItem[]> {
  const out: InventoryItem[] = []
  for (const proj of projects) {
    const cfg = await readProjectConfig(proj.path)
    if (!cfg?.mcp_servers) continue
    out.push(
      ...mcpsFromServers(
        cfg.mcp_servers,
        toolId,
        'project',
        { kind: 'codex-project', projectPath: proj.path },
        proj.path
      )
    )
  }
  return out
}

export async function readPlugins(toolId: ToolId): Promise<InventoryItem[]> {
  const cfg = await readConfig()
  if (!cfg?.plugins) return []
  const out: InventoryItem[] = []
  for (const [key, val] of Object.entries(cfg.plugins)) {
    const enabled = (val as { enabled?: boolean }).enabled !== false
    const [name, marketplace] = key.split('@')
    out.push({
      id: stableId(['plugin', key]),
      kind: 'plugin',
      name,
      description: marketplace ? `from ${marketplace}` : undefined,
      presences: [
        {
          toolId,
          scope: 'global',
          enabled,
          source: {
            kind: 'plugin',
            marketplace,
            enabled
          }
        }
      ]
    })
  }
  return out
}

export async function readSkills(toolId: ToolId): Promise<InventoryItem[]> {
  // Two locations: ~/.codex/skills/.system (built-in) and ~/.agents/skills (user)
  const out: InventoryItem[] = []
  for (const dir of [paths.codexSystemSkillsDir, paths.codexUserSkillsDir]) {
    const names = await listDirNames(dir)
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
            toolId,
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
  }
  return out
}

export async function upsertMcp(name: string, canonical: CanonicalMcp): Promise<void> {
  const cfg = (await readConfig()) ?? ({} as CodexConfig)
  const servers = (cfg.mcp_servers ?? {}) as Record<string, RawMcp>
  // Codex rejects names with spaces/symbols; coerce before writing so the app
  // can never produce a config that fails at startup.
  servers[sanitizeCodexServerName(name)] = canonicalToRaw(canonical)
  cfg.mcp_servers = servers
  await writeConfig(cfg)
}

export async function removeMcp(name: string): Promise<void> {
  const cfg = await readConfig()
  if (!cfg?.mcp_servers) return
  delete (cfg.mcp_servers as Record<string, unknown>)[name]
  await writeConfig(cfg)
}

export async function upsertMcpProject(
  projectPath: string,
  name: string,
  canonical: CanonicalMcp
): Promise<void> {
  const cfg = (await readProjectConfig(projectPath)) ?? ({} as CodexConfig)
  const servers = (cfg.mcp_servers ?? {}) as Record<string, RawMcp>
  servers[sanitizeCodexServerName(name)] = canonicalToRaw(canonical)
  cfg.mcp_servers = servers
  await writeProjectConfig(projectPath, cfg)
}

export async function removeMcpProject(projectPath: string, name: string): Promise<void> {
  const cfg = await readProjectConfig(projectPath)
  if (!cfg?.mcp_servers) return
  delete (cfg.mcp_servers as Record<string, unknown>)[name]
  await writeProjectConfig(projectPath, cfg)
}

/**
 * Rename every invalid MCP server name in ~/.codex/config.toml to a valid,
 * collision-free name. Edits the TOML headers as text rather than re-serialising
 * the whole file, so comments, ordering and unrelated formatting survive — any
 * invalid Codex name is necessarily TOML-quoted (it contains chars outside bare
 * keys), so matching the quoted header form is sufficient.
 */
export async function healInvalidNames(): Promise<{ from: string; to: string }[]> {
  const txt = await readTextSafe(paths.codexConfig)
  if (!txt) return []
  let cfg: CodexConfig
  try {
    cfg = parse(txt) as CodexConfig
  } catch {
    return []
  }
  const plan = planNameFixes(cfg.mcp_servers)
  if (!plan.length) return []

  let next = txt
  for (const { from, to } of plan) {
    const q = escapeRegExp(from)
    // [mcp_servers."<from>"]  and  [mcp_servers."<from>".<sub>]
    next = next
      .replace(new RegExp(`\\[mcp_servers\\."${q}"\\]`, 'g'), `[mcp_servers.${to}]`)
      .replace(new RegExp(`\\[mcp_servers\\."${q}"\\.`, 'g'), `[mcp_servers.${to}.`)
  }
  await writeTextAtomic(paths.codexConfig, next)
  return plan
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function copySkillToUser(srcDir: string, name: string): Promise<string> {
  const dest = join(paths.codexUserSkillsDir, name)
  await copyDirRecursive(srcDir, dest)
  return dest
}
