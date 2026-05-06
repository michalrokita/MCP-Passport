import { promises as fs } from 'fs'
import { join } from 'path'
import { parse, stringify } from 'smol-toml'
import { paths } from '../paths'
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
    authStatus: (await pathExists(paths.codexAuth)) ? 'authenticated' : 'not_signed_in'
  }
}

export async function detectCodexDesktop(): Promise<ToolPresence> {
  const installed = await pathExists(paths.codexDesktopApp)
  const sharedConfig = await pathExists(paths.codexConfig)
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
    warnings: installed && sharedConfig
      ? ['Codex Desktop and Codex CLI share configuration via ~/.codex/.']
      : undefined
  }
}

// MCP, plugin, skill readers (all returning items tagged for Codex CLI primarily;
// caller will fan-out to also tag for codex-desktop since they share config).
export async function readMcps(toolId: ToolId): Promise<InventoryItem[]> {
  const cfg = await readConfig()
  if (!cfg?.mcp_servers) return []
  const out: InventoryItem[] = []
  for (const [name, raw] of Object.entries(cfg.mcp_servers)) {
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
          scope: 'global',
          enabled: canonical.enabled,
          source: {
            kind: 'mcp',
            canonical,
            raw,
            locator: { kind: 'codex' }
          }
        }
      ]
    })
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
  servers[name] = canonicalToRaw(canonical)
  cfg.mcp_servers = servers
  await writeConfig(cfg)
}

export async function removeMcp(name: string): Promise<void> {
  const cfg = await readConfig()
  if (!cfg?.mcp_servers) return
  delete (cfg.mcp_servers as Record<string, unknown>)[name]
  await writeConfig(cfg)
}

export async function copySkillToUser(srcDir: string, name: string): Promise<string> {
  const dest = join(paths.codexUserSkillsDir, name)
  await copyDirRecursive(srcDir, dest)
  return dest
}
