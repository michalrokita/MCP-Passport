// Search-aware registry: queries remote MCP and skill catalogs and normalizes to RegistryEntry.
// Sources (verified 2026-05-06):
//  - Official MCP Registry — https://registry.modelcontextprotocol.io/v0/servers
//  - Smithery —              https://registry.smithery.ai/servers
//  - Glama —                 https://glama.ai/api/mcp/v1/servers
//  - anthropics/skills —     GitHub trees + raw.githubusercontent.com SKILL.md
//  - openai/skills —         same pattern

import type {
  CanonicalMcp,
  ItemKind,
  RegistryCatalog,
  RegistryEntry
} from '../shared/types'
import { listCatalog as bundledCatalog } from './registry'

const UA = 'MCP-Passport/0.2 (+https://github.com/anthropics/claude-code)'
const FETCH_TIMEOUT_MS = 8000

interface CacheEntry {
  fetchedAt: number
  data: RegistryEntry[]
}

// Module-scoped cache. Cleared on app restart.
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60_000

async function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        ...(init?.headers ?? {})
      }
    })
  } finally {
    clearTimeout(timer)
  }
}

async function safeJson<T = unknown>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await timedFetch(url, init)
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

// ---------- MCP source: Official registry ----------
interface OfficialServer {
  server: {
    name?: string
    title?: string
    description?: string
    version?: string
    remotes?: { type?: string; url?: string }[]
    packages?: {
      registry?: string
      identifier?: string
      version?: string
      runtime_arguments?: Array<{ value?: string }>
    }[]
    websiteUrl?: string
  }
  _meta?: Record<string, { isLatest?: boolean }>
}

async function searchOfficial(query: string): Promise<RegistryEntry[]> {
  const u = new URL('https://registry.modelcontextprotocol.io/v0/servers')
  if (query) u.searchParams.set('search', query)
  u.searchParams.set('limit', '40')
  const data = await safeJson<{ servers?: OfficialServer[] }>(u.toString())
  if (!data?.servers) return []
  const out: RegistryEntry[] = []
  for (const item of data.servers) {
    const meta = Object.values(item._meta ?? {})[0]
    if (meta && meta.isLatest === false) continue // de-dup
    const s = item.server ?? {}
    const display = s.title || s.name || 'unknown'
    const canonical = canonicalFromOfficial(s)
    out.push({
      id: `official:${s.name ?? display}`,
      kind: 'mcp',
      name: friendlyName(display),
      publisher: 'Official Registry',
      description: (s.description ?? '').slice(0, 400),
      homepage: s.websiteUrl,
      source: 'modelcontextprotocol.io',
      canonical: canonical ?? undefined
    })
  }
  return out
}

function canonicalFromOfficial(s: OfficialServer['server']): CanonicalMcp | null {
  const remote = s.remotes?.find((r) => r.url)
  if (remote?.url) {
    return {
      transport: remote.type === 'sse' ? 'sse' : 'http',
      url: remote.url
    }
  }
  const pkg = s.packages?.[0]
  if (pkg?.identifier) {
    if (pkg.registry === 'npm') {
      return {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', pkg.identifier, ...(pkg.runtime_arguments?.map((a) => a.value ?? '') ?? [])]
      }
    }
    if (pkg.registry === 'pypi' || pkg.registry === 'pypi-uvx') {
      return {
        transport: 'stdio',
        command: 'uvx',
        args: [pkg.identifier]
      }
    }
  }
  return null
}

// ---------- MCP source: Smithery ----------
interface SmitheryItem {
  qualifiedName?: string
  displayName?: string
  description?: string
  homepage?: string
  iconUrl?: string
  remote?: boolean
  verified?: boolean
  useCount?: number
}

async function searchSmithery(query: string): Promise<RegistryEntry[]> {
  const u = new URL('https://registry.smithery.ai/servers')
  if (query) u.searchParams.set('q', query)
  u.searchParams.set('pageSize', '30')
  const data = await safeJson<{ servers?: SmitheryItem[] }>(u.toString())
  if (!data?.servers) return []
  return data.servers.map((s) => ({
    id: `smithery:${s.qualifiedName ?? s.displayName ?? Math.random()}`,
    kind: 'mcp' as const,
    name: friendlyName(s.displayName ?? s.qualifiedName ?? 'unknown'),
    publisher: s.verified ? 'Smithery (verified)' : 'Smithery',
    description: (s.description ?? '').slice(0, 400),
    homepage: s.homepage,
    source: 'smithery.ai',
    // Smithery doesn't expose canonical install in the list response; user clicks
    // "Open homepage" to grab full setup. We still let them save it (URL) if remote.
    canonical: s.remote && s.qualifiedName
      ? {
          transport: 'http',
          url: `https://server.smithery.ai/${s.qualifiedName}/mcp`
        }
      : undefined
  }))
}

// ---------- MCP source: Glama ----------
interface GlamaServer {
  id?: string
  name?: string
  slug?: string
  namespace?: string
  description?: string
  url?: string
  repository?: { url?: string }
  attributes?: string[]
  environmentVariablesJsonSchema?: { properties?: Record<string, unknown> }
}

async function searchGlama(query: string): Promise<RegistryEntry[]> {
  const u = new URL('https://glama.ai/api/mcp/v1/servers')
  if (query) u.searchParams.set('query', query)
  u.searchParams.set('first', '30')
  const data = await safeJson<{ servers?: GlamaServer[] }>(u.toString())
  if (!data?.servers) return []
  return data.servers.map((s) => ({
    id: `glama:${s.id ?? s.slug ?? Math.random()}`,
    kind: 'mcp' as const,
    name: friendlyName(s.name ?? s.slug ?? 'unknown'),
    publisher: 'Glama',
    description: (s.description ?? '').slice(0, 400),
    homepage: s.url,
    source: 'glama.ai',
    // Glama's list response lacks canonical install. Direct-link only.
    canonical: undefined,
    envVars: s.environmentVariablesJsonSchema?.properties
      ? Object.keys(s.environmentVariablesJsonSchema.properties).map((name) => ({ name }))
      : undefined
  }))
}

// ---------- Skills source: GitHub repos ----------
interface GhTreeEntry {
  path: string
  type: 'tree' | 'blob'
}
interface GhTreeResponse {
  tree?: GhTreeEntry[]
  truncated?: boolean
}

async function listSkillsFromGithubRepo(
  owner: string,
  repo: string,
  publisher: string
): Promise<RegistryEntry[]> {
  const u = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`
  const data = await safeJson<GhTreeResponse>(u, {
    headers: { Accept: 'application/vnd.github+json' }
  })
  if (!data?.tree) return []
  const skillFiles = data.tree.filter(
    (t) => t.type === 'blob' && /\/SKILL\.md$/i.test(t.path)
  )
  // Each path is like "skills/<name>/SKILL.md" — derive name from second-to-last segment.
  const out: RegistryEntry[] = skillFiles.map((t) => {
    const segs = t.path.split('/')
    const name = segs[segs.length - 2]
    const raw = `https://raw.githubusercontent.com/${owner}/${repo}/main/${t.path}`
    return {
      id: `gh:${owner}/${repo}:${name}`,
      kind: 'skill' as const,
      name,
      publisher,
      description: '', // filled in lazily on Add (we'd hit raw.githubusercontent.com)
      homepage: `https://github.com/${owner}/${repo}/blob/main/${t.path}`,
      source: `${owner}/${repo}`,
      // We stash the raw URL inside `body` as a sentinel; loaded on demand at "add" time
      body: `__fetch__::${raw}`,
      tags: ['github']
    }
  })
  return out
}

// ---------- Top-level search aggregator ----------
function isOnline(): boolean {
  // Lightweight; if fetch is undefined we're not networked at all (Node <18).
  return typeof fetch === 'function'
}

export async function searchRemote(
  query: string,
  kind: ItemKind
): Promise<RegistryCatalog> {
  if (!isOnline()) {
    return { fetchedAt: new Date().toISOString(), entries: [], source: 'bundled' }
  }
  const cacheKey = `${kind}|${query.toLowerCase().trim()}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      fetchedAt: new Date(cached.fetchedAt).toISOString(),
      entries: cached.data,
      source: 'url'
    }
  }

  let entries: RegistryEntry[] = []
  if (kind === 'mcp') {
    const [official, smithery, glama] = await Promise.all([
      searchOfficial(query),
      searchSmithery(query),
      searchGlama(query)
    ])
    entries = mergeMcps([...official, ...smithery, ...glama])
  } else if (kind === 'skill') {
    const repos: Array<{ owner: string; repo: string; publisher: string }> = [
      { owner: 'anthropics', repo: 'skills', publisher: 'Anthropic' },
      { owner: 'openai', repo: 'skills', publisher: 'OpenAI' }
    ]
    const lists = await Promise.all(
      repos.map((r) => listSkillsFromGithubRepo(r.owner, r.repo, r.publisher))
    )
    let all = lists.flat()
    if (query) {
      const q = query.toLowerCase()
      all = all.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.description ?? '').toLowerCase().includes(q) ||
          (e.publisher ?? '').toLowerCase().includes(q)
      )
    }
    entries = all
  } else {
    entries = []
  }

  // Merge in matching bundled entries. With an empty query we put curated entries
  // at the top as "Featured"; with a real query we only include bundled entries
  // whose name/description matches so they don't drown out the actual search results.
  const bundled = bundledCatalog().entries.filter((e) => e.kind === kind)
  const seenNames = new Set(entries.map((e) => e.name.toLowerCase()))
  const q = query.trim().toLowerCase()
  const matchingBundled = bundled.filter((b) => {
    if (seenNames.has(b.name.toLowerCase())) return false
    if (!q) return true
    return (
      b.name.toLowerCase().includes(q) ||
      (b.description ?? '').toLowerCase().includes(q) ||
      (b.publisher ?? '').toLowerCase().includes(q)
    )
  })
  for (const b of matchingBundled) {
    entries.unshift({ ...b, source: b.source ?? 'curated' })
    seenNames.add(b.name.toLowerCase())
  }

  cache.set(cacheKey, { fetchedAt: Date.now(), data: entries })
  return {
    fetchedAt: new Date().toISOString(),
    entries,
    source: 'url'
  }
}

function mergeMcps(items: RegistryEntry[]): RegistryEntry[] {
  // Prefer the entry with a canonical install over one without; first source wins for ties.
  const byName = new Map<string, RegistryEntry>()
  for (const e of items) {
    const key = e.name.toLowerCase()
    const cur = byName.get(key)
    if (!cur) {
      byName.set(key, e)
      continue
    }
    const score = (x: RegistryEntry): number =>
      (x.canonical ? 2 : 0) + (x.description ? 1 : 0)
    if (score(e) > score(cur)) byName.set(key, e)
  }
  return [...byName.values()].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  )
}

function friendlyName(raw: string): string {
  return raw
    .replace(/^@[^/]+\//, '')
    .replace(/^[a-z0-9-]+\.[a-z0-9-]+\//, '')
    .replace(/^mcp[-_]?/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || raw
}

// Lazy fetch SKILL.md when user clicks "Add" on a github skill.
export async function fetchSkillBody(rawUrl: string): Promise<string> {
  const r = await timedFetch(rawUrl)
  if (!r.ok) throw new Error(`Failed to fetch ${rawUrl} — HTTP ${r.status}`)
  return await r.text()
}
