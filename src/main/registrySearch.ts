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
  RegistryEntry,
  RegistrySearchOptions
} from '../shared/types'
import { listCatalog as bundledCatalog } from './registry'
import * as cache from './cache'
import { classify } from './categorize'

const UA = 'MCP-Passport/0.2 (+https://github.com/anthropics/claude-code)'
const FETCH_TIMEOUT_MS = 8000

// Disk cache TTLs.
const FRESH_TTL_MS = 30 * 60_000 // 30 minutes — UI will show without nagging
const STALE_TTL_MS = 7 * 24 * 60 * 60_000 // 7 days — still served if network is down
const CACHE_NAMESPACE = 'registry'

// In-process cache to avoid hammering disk on rapid filter changes.
const memCache = new Map<string, { writtenAt: number; data: RegistryEntry[] }>()
const MEM_TTL_MS = 60_000

interface SourceStatus {
  name: string
  status: 'ok' | 'fail' | 'skipped'
  count: number
}

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
  if (!data?.servers) throw new Error('official-fetch-failed')
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
  if (!data?.servers) throw new Error('smithery-fetch-failed')
  return data.servers.map((s) => ({
    id: `smithery:${s.qualifiedName ?? s.displayName ?? Math.random()}`,
    kind: 'mcp' as const,
    name: friendlyName(s.displayName ?? s.qualifiedName ?? 'unknown'),
    publisher: s.verified ? 'Smithery (verified)' : 'Smithery',
    description: (s.description ?? '').slice(0, 400),
    homepage: s.homepage,
    source: 'smithery.ai',
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
  if (!data?.servers) throw new Error('glama-fetch-failed')
  return data.servers.map((s) => ({
    id: `glama:${s.id ?? s.slug ?? Math.random()}`,
    kind: 'mcp' as const,
    name: friendlyName(s.name ?? s.slug ?? 'unknown'),
    publisher: 'Glama',
    description: (s.description ?? '').slice(0, 400),
    homepage: s.url,
    source: 'glama.ai',
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
  if (!data?.tree) throw new Error(`gh-${owner}-fetch-failed`)
  const skillFiles = data.tree.filter(
    (t) => t.type === 'blob' && /\/SKILL\.md$/i.test(t.path)
  )
  const out: RegistryEntry[] = skillFiles.map((t) => {
    const segs = t.path.split('/')
    const name = segs[segs.length - 2]
    const raw = `https://raw.githubusercontent.com/${owner}/${repo}/main/${t.path}`
    return {
      id: `gh:${owner}/${repo}:${name}`,
      kind: 'skill' as const,
      name,
      publisher,
      description: '', // lazy-fetched on Add
      homepage: `https://github.com/${owner}/${repo}/blob/main/${t.path}`,
      source: `${owner}/${repo}`,
      body: `__fetch__::${raw}`,
      tags: ['github']
    }
  })
  return out
}

// ---------- Top-level search aggregator ----------
function isOnline(): boolean {
  return typeof fetch === 'function'
}

function cacheKey(kind: ItemKind, query: string): string {
  return `${kind}|${query.toLowerCase().trim() || '__all__'}`
}

async function settle<T>(
  name: string,
  fn: () => Promise<T[]>,
  status: SourceStatus[]
): Promise<T[]> {
  try {
    const r = await fn()
    status.push({ name, status: 'ok', count: r.length })
    return r
  } catch {
    status.push({ name, status: 'fail', count: 0 })
    return []
  }
}

export async function searchRemote(
  query: string,
  kind: ItemKind,
  options: RegistrySearchOptions = {}
): Promise<RegistryCatalog> {
  const key = cacheKey(kind, query)
  const now = Date.now()

  // 1) In-process cache (fastest path on rapid filter changes).
  if (!options.bypassCache) {
    const m = memCache.get(key)
    if (m && now - m.writtenAt < MEM_TTL_MS) {
      return {
        fetchedAt: new Date(m.writtenAt).toISOString(),
        entries: m.data,
        source: 'cache',
        cache: { fromCache: true, ageMs: now - m.writtenAt, fresh: true }
      }
    }
  }

  // 2) Disk cache — return immediately if fresh; if stale, return for now and refresh in background.
  let cached: cache.CacheReadResult<RegistryEntry[]> | null = null
  if (!options.bypassCache) {
    cached = await cache.read<RegistryEntry[]>(CACHE_NAMESPACE, key, FRESH_TTL_MS)
    if (cached?.fresh) {
      memCache.set(key, { writtenAt: cached.writtenAt, data: cached.data })
      return {
        fetchedAt: new Date(cached.writtenAt).toISOString(),
        entries: cached.data,
        source: 'cache',
        cache: { fromCache: true, ageMs: cached.ageMs, fresh: true }
      }
    }
  }

  // 3) Network fetch (the slow path) — but if we have ANY cached data, return that synchronously
  // and refresh in the background (stale-while-revalidate). Only block on network when there's no
  // cache at all, or when bypassCache was set explicitly.
  if (cached && !options.bypassCache) {
    void refreshInBackground(query, kind, key)
    return {
      fetchedAt: new Date(cached.writtenAt).toISOString(),
      entries: cached.data,
      source: 'cache',
      cache: { fromCache: true, ageMs: cached.ageMs, fresh: false }
    }
  }

  if (!isOnline()) {
    return {
      fetchedAt: new Date().toISOString(),
      entries: [],
      source: 'bundled',
      sources: [{ name: 'offline', status: 'skipped', count: 0 }]
    }
  }

  const result = await fetchAll(query, kind)
  await cache.write(CACHE_NAMESPACE, key, FRESH_TTL_MS, result.entries)
  memCache.set(key, { writtenAt: now, data: result.entries })
  return {
    fetchedAt: new Date().toISOString(),
    entries: result.entries,
    source: 'url',
    cache: { fromCache: false, ageMs: 0, fresh: true },
    sources: result.sources
  }
}

async function refreshInBackground(
  query: string,
  kind: ItemKind,
  key: string
): Promise<void> {
  try {
    if (!isOnline()) return
    const result = await fetchAll(query, kind)
    await cache.write(CACHE_NAMESPACE, key, FRESH_TTL_MS, result.entries)
    memCache.set(key, { writtenAt: Date.now(), data: result.entries })
  } catch {
    // ignore — best-effort refresh
  }
}

async function fetchAll(
  query: string,
  kind: ItemKind
): Promise<{ entries: RegistryEntry[]; sources: SourceStatus[] }> {
  const sources: SourceStatus[] = []
  let entries: RegistryEntry[] = []

  if (kind === 'mcp') {
    const [official, smithery, glama] = await Promise.all([
      settle('modelcontextprotocol.io', () => searchOfficial(query), sources),
      settle('smithery.ai', () => searchSmithery(query), sources),
      settle('glama.ai', () => searchGlama(query), sources)
    ])
    entries = mergeMcps([...official, ...smithery, ...glama])
  } else if (kind === 'skill') {
    const repos: Array<{ owner: string; repo: string; publisher: string }> = [
      { owner: 'anthropics', repo: 'skills', publisher: 'Anthropic' },
      { owner: 'openai', repo: 'skills', publisher: 'OpenAI' }
    ]
    const lists = await Promise.all(
      repos.map((r) =>
        settle(`${r.owner}/${r.repo}`, () => listSkillsFromGithubRepo(r.owner, r.repo, r.publisher), sources)
      )
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
  }

  // Merge in matching bundled entries.
  const bundled = bundledCatalog().entries.filter((e) => e.kind === kind)
  const seenNames = new Set(entries.map((e) => e.name.toLowerCase()))
  const q = query.trim().toLowerCase()
  const matching = bundled.filter((b) => {
    if (seenNames.has(b.name.toLowerCase())) return false
    if (!q) return true
    return (
      b.name.toLowerCase().includes(q) ||
      (b.description ?? '').toLowerCase().includes(q) ||
      (b.publisher ?? '').toLowerCase().includes(q)
    )
  })
  for (const b of matching) {
    entries.unshift({ ...b, source: b.source ?? 'curated' })
    seenNames.add(b.name.toLowerCase())
  }
  if (matching.length) sources.push({ name: 'curated', status: 'ok', count: matching.length })

  // Attach a category to every entry — done once at fetch time, then cached on disk.
  for (const e of entries) {
    if (!e.category) e.category = classify(e)
  }

  return { entries, sources }
}

function mergeMcps(items: RegistryEntry[]): RegistryEntry[] {
  const byName = new Map<string, RegistryEntry>()
  for (const e of items) {
    const k = e.name.toLowerCase()
    const cur = byName.get(k)
    if (!cur) {
      byName.set(k, e)
      continue
    }
    const score = (x: RegistryEntry): number =>
      (x.canonical ? 2 : 0) + (x.description ? 1 : 0)
    if (score(e) > score(cur)) byName.set(k, e)
  }
  return [...byName.values()].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  )
}

function friendlyName(raw: string): string {
  return (
    raw
      .replace(/^@[^/]+\//, '')
      .replace(/^[a-z0-9-]+\.[a-z0-9-]+\//, '')
      .replace(/^mcp[-_]?/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || raw
  )
}

export async function fetchSkillBody(rawUrl: string): Promise<string> {
  // Per-URL disk cache — skill bodies rarely change.
  const c = await cache.read<string>('skills', rawUrl, 24 * 60 * 60_000)
  if (c?.fresh) return c.data
  const r = await timedFetch(rawUrl)
  if (!r.ok) {
    if (c) return c.data // network died; serve stale
    throw new Error(`Failed to fetch ${rawUrl} — HTTP ${r.status}`)
  }
  const text = await r.text()
  await cache.write('skills', rawUrl, 24 * 60 * 60_000, text)
  return text
}

export async function clearSearchCache(): Promise<void> {
  memCache.clear()
  await cache.clear(CACHE_NAMESPACE)
  await cache.clear('skills')
}
