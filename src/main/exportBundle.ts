// Gather items from the local environment into an ExportPlan (descriptor list)
// or a fully-materialized ExportBundle ready to be encrypted.
//
// The descriptor pass is cheap — it stats files but doesn't read them. The
// bundle pass reads file contents and base64-encodes them.

import { promises as fs } from 'fs'
import { basename, join, relative } from 'path'
import { hostname, platform } from 'os'
import { listAuthCaches } from './adapters/mcpAuth'
import { mcpUrlHash } from './mcpUrlHash'
import { scanAll } from './scanner'
import type {
  CanonicalMcp,
  ExportBundle,
  ExportItem,
  ExportItemDescriptor,
  ExportItemId,
  ExportPlan,
  InventoryItem,
  ItemPresence,
  ScanResult
} from '../shared/types'

export async function planExport(appVersion: string): Promise<ExportPlan> {
  const scan = await scanAll()
  const items = await listAvailableItems(scan)
  return {
    generatedAt: new Date().toISOString(),
    originOS: platform(),
    originHost: hostname(),
    appVersion,
    items
  }
}

export async function buildBundle(
  selectedIds: ExportItemId[],
  includeSecrets: boolean,
  appVersion: string
): Promise<{ bundle: ExportBundle; itemCount: number }> {
  const set = new Set(selectedIds)
  const scan = await scanAll()
  const descriptors = await listAvailableItems(scan)
  const items: ExportItem[] = []
  for (const d of descriptors) {
    if (!set.has(d.id)) continue
    // Per policy: mcp-auth never rides without secrets enabled.
    if (d.kind === 'mcp-auth' && !includeSecrets) continue
    const item = await materializeItem(d, scan, includeSecrets)
    if (item) items.push(item)
  }
  const bundle: ExportBundle = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    originOS: platform(),
    originHost: hostname(),
    appVersion,
    includesSecrets: includeSecrets,
    items
  }
  return { bundle, itemCount: items.length }
}

// === Descriptor enumeration ===

async function listAvailableItems(scan: ScanResult): Promise<ExportItemDescriptor[]> {
  const out: ExportItemDescriptor[] = []
  for (const item of scan.items) {
    for (const presence of item.presences) {
      const desc = await describePresence(item, presence)
      if (desc) out.push(desc)
    }
  }
  // Map every known MCP URL to its hash so we can label cache entries by URL.
  const hashToUrl = new Map<string, string>()
  for (const item of scan.items) {
    if (item.kind !== 'mcp') continue
    for (const p of item.presences) {
      if (p.source.kind === 'mcp' && p.source.urlHash && p.source.canonical.url) {
        hashToUrl.set(p.source.urlHash, p.source.canonical.url)
      }
    }
  }

  for (const c of await listAuthCaches()) {
    if (!c.hasTokens) continue
    const url = hashToUrl.get(c.urlHash)
    // Cache entries with no matching MCP locally are still exportable, but we
    // can't label them with a friendly URL. Skip them — without the URL the
    // importer can't recompute the hash on the destination machine.
    if (!url) continue
    let bytes = 0
    for (const f of c.files) {
      const st = await fs.stat(f).catch(() => null)
      if (st) bytes += st.size
    }
    out.push({
      id: authId(url),
      kind: 'mcp-auth',
      name: hostnameOf(url),
      subtitle: `${c.files.length} file${c.files.length === 1 ? '' : 's'} · ${c.version}`,
      hasSecrets: true,
      defaultIncluded: true,
      approxBytes: bytes,
      url
    })
  }
  return out
}

async function describePresence(
  item: InventoryItem,
  presence: ItemPresence
): Promise<ExportItemDescriptor | null> {
  // Plugins and agents are out of scope for v1.
  if (item.kind === 'plugin' || item.kind === 'agent') return null

  if (presence.toolId === 'passport') {
    if (item.kind === 'mcp' && presence.source.kind === 'mcp') {
      return {
        id: libMcpId(item.name),
        kind: 'library-mcp',
        name: item.name,
        subtitle: 'Passport library',
        hasSecrets: hasSecrets(presence.source.canonical),
        defaultIncluded: true
      }
    }
    if (item.kind === 'skill' && presence.source.kind === 'skill') {
      const bytes = await dirBytes(presence.source.path).catch(() => 0)
      return {
        id: libSkillId(item.name),
        kind: 'library-skill',
        name: item.name,
        subtitle: 'Passport library',
        hasSecrets: false,
        defaultIncluded: true,
        approxBytes: bytes
      }
    }
    return null
  }

  if (item.kind === 'mcp' && presence.source.kind === 'mcp') {
    return {
      id: toolMcpId(presence, item.name),
      kind: 'tool-mcp',
      name: item.name,
      subtitle: scopeLabel(presence),
      hasSecrets: hasSecrets(presence.source.canonical),
      defaultIncluded: true,
      toolId: presence.toolId,
      scope: presence.scope,
      projectPath: presence.projectPath
    }
  }
  if (item.kind === 'skill' && presence.source.kind === 'skill') {
    const bytes = await dirBytes(presence.source.path).catch(() => 0)
    return {
      id: toolSkillId(presence, item.name),
      kind: 'tool-skill',
      name: item.name,
      subtitle: scopeLabel(presence),
      hasSecrets: false,
      defaultIncluded: true,
      approxBytes: bytes,
      toolId: presence.toolId,
      scope: presence.scope,
      projectPath: presence.projectPath
    }
  }
  return null
}

// === Materialization ===

async function materializeItem(
  desc: ExportItemDescriptor,
  scan: ScanResult,
  includeSecrets: boolean
): Promise<ExportItem | null> {
  switch (desc.kind) {
    case 'library-mcp': {
      const found = findLibraryMcp(scan, desc.name)
      if (!found) return null
      return {
        id: desc.id,
        kind: 'library-mcp',
        name: desc.name,
        description: found.description,
        canonical: maybeStripSecrets(found.canonical, includeSecrets)
      }
    }
    case 'library-skill': {
      const path = findLibrarySkillPath(scan, desc.name)
      if (!path) return null
      const files = await readDirAsBase64(path)
      return { id: desc.id, kind: 'library-skill', name: desc.name, files }
    }
    case 'tool-mcp': {
      const canonical = findToolMcp(scan, desc)
      if (!canonical || !desc.toolId || !desc.scope) return null
      return {
        id: desc.id,
        kind: 'tool-mcp',
        toolId: desc.toolId,
        scope: desc.scope,
        projectPath: desc.projectPath,
        name: desc.name,
        canonical: maybeStripSecrets(canonical, includeSecrets)
      }
    }
    case 'tool-skill': {
      const path = findToolSkillPath(scan, desc)
      if (!path || !desc.toolId || !desc.scope) return null
      const files = await readDirAsBase64(path)
      return {
        id: desc.id,
        kind: 'tool-skill',
        toolId: desc.toolId,
        scope: desc.scope,
        projectPath: desc.projectPath,
        name: desc.name,
        files
      }
    }
    case 'mcp-auth': {
      const url = desc.url
      if (!url) return null
      const caches = await listAuthCaches()
      const target = caches.find((c) => c.urlHash === mcpUrlHash(url))
      if (!target || !target.hasTokens) return null
      const files: Record<string, string> = {}
      for (const f of target.files) {
        const fname = basename(f)
        // Strip the {hash}_ prefix so the importer can re-prefix locally.
        const prefix = `${target.urlHash}_`
        const tail = fname.startsWith(prefix) ? fname.slice(prefix.length) : fname
        // Skip the verifier and lock — they're transient, only tokens + client_info matter.
        if (tail === 'code_verifier.txt' || tail === 'lock.json') continue
        if (tail.endsWith('_debug.log') || tail === 'debug.log') continue
        const buf = await fs.readFile(f).catch(() => null)
        if (buf) files[tail] = buf.toString('base64')
      }
      if (Object.keys(files).length === 0) return null
      return {
        id: desc.id,
        kind: 'mcp-auth',
        url,
        fromVersion: target.version,
        files
      }
    }
  }
  return null
}

// === Helpers ===

function hasSecrets(c: CanonicalMcp): boolean {
  if (c.env && Object.values(c.env).some((v) => typeof v === 'string' && v.length > 0)) return true
  if (c.headers && Object.values(c.headers).some((v) => typeof v === 'string' && v.length > 0))
    return true
  return false
}

function maybeStripSecrets(c: CanonicalMcp, include: boolean): CanonicalMcp {
  if (include) return c
  const out: CanonicalMcp = { ...c }
  if (c.env)
    out.env = Object.fromEntries(Object.entries(c.env).map(([k]) => [k, '']))
  if (c.headers)
    out.headers = Object.fromEntries(Object.entries(c.headers).map(([k]) => [k, '']))
  return out
}

function scopeLabel(p: ItemPresence): string {
  if (p.scope === 'project' && p.projectPath) return `${p.toolId} · project: ${p.projectPath}`
  return `${p.toolId} · ${p.scope}`
}

const safe = (s: string): string => encodeURIComponent(s)
export const libMcpId = (name: string): string => `library-mcp:${safe(name)}`
export const libSkillId = (name: string): string => `library-skill:${safe(name)}`
export const toolMcpId = (p: ItemPresence, name: string): string =>
  `tool-mcp:${p.toolId}:${p.scope}:${p.projectPath ? safe(p.projectPath) : ''}:${safe(name)}`
export const toolSkillId = (p: ItemPresence, name: string): string =>
  `tool-skill:${p.toolId}:${p.scope}:${p.projectPath ? safe(p.projectPath) : ''}:${safe(name)}`
export const authId = (url: string): string => `mcp-auth:${safe(url)}`

function hostnameOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    let entries
    try {
      entries = await fs.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = join(cur, e.name)
      if (e.isDirectory()) stack.push(full)
      else {
        const s = await fs.stat(full).catch(() => null)
        if (s) total += s.size
      }
    }
  }
  return total
}

async function readDirAsBase64(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    let entries
    try {
      entries = await fs.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = join(cur, e.name)
      const rel = relative(dir, full).split(/[\\/]/).join('/')
      if (e.isDirectory()) {
        stack.push(full)
      } else if (e.isFile()) {
        const buf = await fs.readFile(full)
        out[rel] = buf.toString('base64')
      } else if (e.isSymbolicLink()) {
        try {
          const buf = await fs.readFile(full)
          out[rel] = buf.toString('base64')
        } catch {
          // dangling symlink; skip
        }
      }
    }
  }
  return out
}

// === Scan lookups (descriptor → underlying data) ===

function findLibraryMcp(
  scan: ScanResult,
  name: string
): { canonical: CanonicalMcp; description?: string } | null {
  for (const item of scan.items) {
    if (item.kind !== 'mcp' || item.name !== name) continue
    for (const p of item.presences) {
      if (p.toolId === 'passport' && p.source.kind === 'mcp') {
        return { canonical: p.source.canonical, description: item.description }
      }
    }
  }
  return null
}

function findLibrarySkillPath(scan: ScanResult, name: string): string | null {
  for (const item of scan.items) {
    if (item.kind !== 'skill' || item.name !== name) continue
    for (const p of item.presences) {
      if (p.toolId === 'passport' && p.source.kind === 'skill') return p.source.path
    }
  }
  return null
}

function findToolMcp(scan: ScanResult, d: ExportItemDescriptor): CanonicalMcp | null {
  for (const item of scan.items) {
    if (item.kind !== 'mcp' || item.name !== d.name) continue
    for (const p of item.presences) {
      if (
        p.toolId === d.toolId &&
        p.scope === d.scope &&
        p.projectPath === d.projectPath &&
        p.source.kind === 'mcp'
      ) {
        return p.source.canonical
      }
    }
  }
  return null
}

function findToolSkillPath(scan: ScanResult, d: ExportItemDescriptor): string | null {
  for (const item of scan.items) {
    if (item.kind !== 'skill' || item.name !== d.name) continue
    for (const p of item.presences) {
      if (
        p.toolId === d.toolId &&
        p.scope === d.scope &&
        p.projectPath === d.projectPath &&
        p.source.kind === 'skill'
      ) {
        return p.source.path
      }
    }
  }
  return null
}
