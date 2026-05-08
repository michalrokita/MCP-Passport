import * as claudeDesktop from './adapters/claudeDesktop'
import * as claudeCode from './adapters/claudeCode'
import * as codex from './adapters/codex'
import * as cursor from './adapters/cursor'
import * as passport from './adapters/passport'
import { listAuthedUrlHashes } from './adapters/mcpAuth'
import { probeRemoteAuthRequired } from './adapters/mcpAuthProbe'
import { mcpUrlHash } from './mcpUrlHash'
import type {
  InventoryItem,
  ScanResult,
  ProjectInfo,
  ToolPresence
} from '../shared/types'

export async function scanAll(): Promise<ScanResult> {
  const [
    passportPres,
    claudeDesktopPres,
    claudeCodePres,
    codexCliPres,
    codexDesktopPres,
    cursorPres
  ] = await Promise.all([
    passport.detect(),
    claudeDesktop.detect(),
    claudeCode.detect(),
    codex.detectCodexCli(),
    codex.detectCodexDesktop(),
    cursor.detect()
  ])

  // Project list is a de-duplicated union of Claude Code's known projects and
  // Cursor's recent workspaces. Either tool can have project-scoped MCPs.
  const [ccProjects, cursorProjects] = await Promise.all([
    claudeCode.getProjects(),
    cursor.getProjects()
  ])
  const projects = mergeProjects(ccProjects, cursorProjects)
  const projectInfo: ProjectInfo[] = projects

  // Read items from each tool.
  const [
    pAll,
    cdAll,
    ccMcpsUser,
    ccMcpsProject,
    ccSkillsUser,
    ccSkillsProject,
    ccAgentsUser,
    ccAgentsProject,
    ccPlugins,
    cxMcps,
    cxPlugins,
    cxSkills,
    curMcpsUser,
    curMcpsProject,
    curSkillsUser,
    curSkillsProject
  ] = await Promise.all([
    passport.readAll(),
    claudeDesktop.readAll(),
    claudeCode.readMcpsUser(),
    claudeCode.readMcpsProjects(projects),
    claudeCode.readSkillsUser(),
    claudeCode.readSkillsProjects(projects),
    claudeCode.readAgentsUser(),
    claudeCode.readAgentsProjects(projects),
    claudeCode.readPlugins(projects),
    codex.readMcps('codex-cli'),
    codex.readPlugins('codex-cli'),
    codex.readSkills('codex-cli'),
    cursor.readMcpsUser(),
    cursor.readMcpsProjects(projects),
    cursor.readSkillsUser(),
    cursor.readSkillsProjects(projects)
  ])

  // Codex CLI and Codex Desktop share config — duplicate codex-cli items as codex-desktop presences too
  // (only when Codex Desktop is installed) so the UI shows them under both tools.
  const codexDesktopMirror = (items: InventoryItem[]): InventoryItem[] => {
    if (!codexDesktopPres.installed) return []
    return items.map((it) => ({
      ...it,
      presences: it.presences.map((p) => ({ ...p, toolId: 'codex-desktop' as const }))
    }))
  }
  const cxMcpsDesktop = codexDesktopMirror(cxMcps)
  const cxPluginsDesktop = codexDesktopMirror(cxPlugins)
  const cxSkillsDesktop = codexDesktopMirror(cxSkills)

  const all = [
    ...pAll,
    ...cdAll,
    ...ccMcpsUser,
    ...ccMcpsProject,
    ...ccSkillsUser,
    ...ccSkillsProject,
    ...ccAgentsUser,
    ...ccAgentsProject,
    ...ccPlugins,
    ...cxMcps,
    ...cxPlugins,
    ...cxSkills,
    ...cxMcpsDesktop,
    ...cxPluginsDesktop,
    ...cxSkillsDesktop,
    ...curMcpsUser,
    ...curMcpsProject,
    ...curSkillsUser,
    ...curSkillsProject
  ]

  const merged = mergeByKindAndName(all)
  merged.sort((a, b) => {
    const ko = orderForKind(a.kind) - orderForKind(b.kind)
    if (ko !== 0) return ko
    return a.name.localeCompare(b.name)
  })

  // Stamp md5 hashes onto every MCP presence with a URL so the renderer can
  // match against authedServerHashes without needing Node crypto.
  for (const item of merged) {
    if (item.kind !== 'mcp') continue
    for (const p of item.presences) {
      if (p.source.kind !== 'mcp') continue
      const url = p.source.canonical.url
      if (url) p.source.urlHash = mcpUrlHash(url)
    }
  }

  const tools: ToolPresence[] = [
    passportPres,
    claudeCodePres,
    claudeDesktopPres,
    codexCliPres,
    codexDesktopPres,
    cursorPres
  ]

  const authedServerHashes = await listAuthedUrlHashes()
  const noAuthRequiredHashes = await probeRemoteUrls(merged, new Set(authedServerHashes))

  return {
    scannedAt: new Date().toISOString(),
    tools,
    items: merged,
    projects: projectInfo,
    authedServerHashes,
    noAuthRequiredHashes
  }
}

// Probe each unique remote MCP URL (not already authed) to find ones that
// don't require OAuth at all. Cache lives in mcpAuthProbe; repeat scans are
// near-free.
async function probeRemoteUrls(
  items: InventoryItem[],
  authedSet: Set<string>
): Promise<string[]> {
  const byUrl = new Map<string, { hash: string; transport: 'http' | 'sse' }>()
  for (const item of items) {
    if (item.kind !== 'mcp') continue
    for (const p of item.presences) {
      if (p.source.kind !== 'mcp') continue
      const url = p.source.canonical.url
      const transport = p.source.canonical.transport
      const hash = p.source.urlHash
      if (!url || !hash) continue
      if (transport !== 'http' && transport !== 'sse') continue
      if (authedSet.has(hash)) continue
      // Skip MCPs that already carry a static Authorization header — they
      // don't show the Sign in button anyway, no need to probe.
      const headers = p.source.canonical.headers ?? {}
      if (Object.keys(headers).some((k) => k.toLowerCase() === 'authorization')) continue
      if (!byUrl.has(url)) byUrl.set(url, { hash, transport })
    }
  }

  const results = await Promise.all(
    [...byUrl.entries()].map(async ([url, { hash, transport }]) => {
      const verdict = await probeRemoteAuthRequired(url, transport)
      return verdict === 'no-auth' ? hash : null
    })
  )
  return results.filter((h): h is string => h !== null)
}

function orderForKind(kind: string): number {
  switch (kind) {
    case 'mcp':
      return 0
    case 'skill':
      return 1
    case 'plugin':
      return 2
    case 'agent':
      return 3
    default:
      return 9
  }
}

function mergeProjects(
  a: { path: string; label: string }[],
  b: { path: string; label: string }[]
): { path: string; label: string }[] {
  const seen = new Set<string>()
  const out: { path: string; label: string }[] = []
  for (const p of [...a, ...b]) {
    if (seen.has(p.path)) continue
    seen.add(p.path)
    out.push(p)
  }
  return out.sort((x, y) => x.label.localeCompare(y.label))
}

function mergeByKindAndName(items: InventoryItem[]): InventoryItem[] {
  const byId = new Map<string, InventoryItem>()
  for (const item of items) {
    const cur = byId.get(item.id)
    if (!cur) {
      byId.set(item.id, { ...item, presences: [...item.presences] })
    } else {
      cur.presences.push(...item.presences)
      // Pick the longest description.
      if (
        item.description &&
        (!cur.description || item.description.length > cur.description.length)
      ) {
        cur.description = item.description
      }
    }
  }
  return [...byId.values()]
}
