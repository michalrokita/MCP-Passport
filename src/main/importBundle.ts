// Decrypt a .mcppassport file, classify each item against the local state,
// and (later, in iter 5) apply the user's decisions.
//
// Status classification per item:
//   new       — nothing at the destination
//   identical — same content already present
//   conflict  — different content already present
//   protected — mcp-auth host already on disk; per policy we never overwrite

import { promises as fs } from 'fs'
import { homedir } from 'os'
import { dirname, join, relative } from 'path'
import {
  paths,
  projectClaudeSkillsDir,
  projectCursorSkillsDir
} from './paths'
import { scanAll } from './scanner'
import { bytesToBundle, decryptBundle } from './passportFile'
import { pathExists } from './util'
import { listAuthCaches } from './adapters/mcpAuth'
import { mcpUrlHash } from './mcpUrlHash'
import * as claudeDesktop from './adapters/claudeDesktop'
import * as claudeCode from './adapters/claudeCode'
import * as codex from './adapters/codex'
import * as cursor from './adapters/cursor'
import * as passport from './adapters/passport'
import type {
  CanonicalMcp,
  ConflictAction,
  ExportBundle,
  ExportItem,
  ImportApplyOutcome,
  ImportApplyRequest,
  ImportApplyResult,
  ImportItemStatus,
  ImportPlan,
  ImportPlanItem,
  ImportPlanRequest,
  ScanResult,
  Scope,
  ToolId
} from '../shared/types'

export async function planImport(req: ImportPlanRequest): Promise<ImportPlan> {
  const bundle = await loadBundle(req.filePath, req.passphrase)
  const scan = await scanAll()
  const items: ImportPlanItem[] = []
  for (const item of bundle.items) {
    items.push(await classify(item, scan))
  }
  return {
    filePath: req.filePath,
    exportedAt: bundle.exportedAt,
    originOS: bundle.originOS,
    originHost: bundle.originHost,
    appVersion: bundle.appVersion,
    includesSecrets: bundle.includesSecrets,
    crossPlatform: bundle.originOS !== process.platform,
    items
  }
}

// Exported so the apply step can re-use the decrypted bundle.
export async function loadBundle(filePath: string, passphrase: string): Promise<ExportBundle> {
  const buf = await fs.readFile(filePath)
  const { plaintext } = decryptBundle(buf, passphrase)
  const bundle = bytesToBundle<ExportBundle>(plaintext)
  if (bundle.schemaVersion !== 1 && bundle.schemaVersion !== 2) {
    throw new Error(`Unsupported bundle schemaVersion ${bundle.schemaVersion}`)
  }
  return bundle
}

// === Apply ===

export async function applyImport(req: ImportApplyRequest): Promise<ImportApplyResult> {
  const bundle = await loadBundle(req.filePath, req.passphrase)
  const decisions = req.decisions ?? {}
  const scan = await scanAll()
  const outcomes: ImportApplyOutcome[] = []

  for (const item of bundle.items) {
    // mcp-auth has its own protected-host policy that overrides the user's choice.
    if (item.kind === 'mcp-auth') {
      outcomes.push(await applyMcpAuth(item, decisions[item.id] ?? 'skip'))
      continue
    }

    const requested: ConflictAction = decisions[item.id] ?? 'skip'
    if (requested === 'skip') {
      outcomes.push({
        id: item.id,
        name: nameOf(item),
        kind: item.kind,
        ok: true,
        message: 'Skipped.',
        action: 'skip'
      })
      continue
    }

    let finalName = nameOf(item)
    if (requested === 'keep-both') {
      finalName = await uniqueNameFor(item, scan)
    }

    try {
      const message = await applyOne(item, finalName)
      outcomes.push({
        id: item.id,
        name: finalName,
        kind: item.kind,
        ok: true,
        message,
        action: requested
      })
    } catch (e) {
      outcomes.push({
        id: item.id,
        name: finalName,
        kind: item.kind,
        ok: false,
        message: (e as Error).message,
        action: requested
      })
    }
  }

  const okCount = outcomes.filter((o) => o.ok).length
  const skipCount = outcomes.filter(
    (o) => o.action === 'skip' || o.action === 'protected'
  ).length
  const writtenCount = okCount - skipCount
  return {
    ok: outcomes.every((o) => o.ok),
    message: `Imported ${writtenCount}, skipped ${skipCount}, failed ${outcomes.length - okCount}.`,
    outcomes
  }
}

async function applyOne(
  item: Exclude<ExportItem, { kind: 'mcp-auth' }>,
  finalName: string
): Promise<string> {
  switch (item.kind) {
    case 'library-mcp': {
      await passport.addMcp({
        name: finalName,
        description: item.description,
        canonical: item.canonical
      })
      return `Added MCP "${finalName}" to your Passport library.`
    }
    case 'library-skill': {
      const dest = join(passportLibraryDir(), 'skills', finalName)
      // Wipe a stale dir if we're overwriting, so removed files don't linger.
      await fs.rm(dest, { recursive: true, force: true })
      const n = await writeFilesFromBase64(dest, item.files)
      return `Wrote skill "${finalName}" (${n} file${n === 1 ? '' : 's'}).`
    }
    case 'tool-mcp': {
      return writeToolMcp(item.toolId, item.scope, item.projectPath, finalName, item.canonical)
    }
    case 'tool-skill': {
      const dest = await toolSkillDestination(item.toolId, item.scope, item.projectPath, finalName)
      await fs.rm(dest, { recursive: true, force: true })
      const n = await writeFilesFromBase64(dest, item.files)
      return `Wrote skill "${finalName}" to ${dest} (${n} file${n === 1 ? '' : 's'}).`
    }
  }
}

async function writeToolMcp(
  toolId: ToolId,
  scope: Scope,
  projectPath: string | undefined,
  name: string,
  canonical: CanonicalMcp
): Promise<string> {
  if (toolId === 'claude-desktop') {
    if (scope !== 'global') throw new Error('Claude Desktop only supports global MCPs.')
    await claudeDesktop.upsertMcp(name, canonical)
    return `Wrote MCP "${name}" to Claude Desktop.`
  }
  if (toolId === 'claude-code') {
    if (scope === 'global') {
      await claudeCode.upsertMcpUser(name, canonical)
      return `Wrote MCP "${name}" to Claude Code (user).`
    }
    if (!projectPath) throw new Error('Project path missing for project-scoped MCP.')
    if (!(await pathExists(projectPath))) {
      throw new Error(`Project path does not exist on this machine: ${projectPath}`)
    }
    await claudeCode.upsertMcpProject(projectPath, name, canonical)
    return `Wrote MCP "${name}" to ${projectPath}/.mcp.json.`
  }
  if (toolId === 'codex-cli' || toolId === 'codex-desktop') {
    if (scope === 'global') {
      await codex.upsertMcp(name, canonical)
      return `Wrote MCP "${name}" to ~/.codex/config.toml.`
    }
    if (!projectPath) throw new Error('Project path missing for project-scoped MCP.')
    if (!(await pathExists(projectPath))) {
      throw new Error(`Project path does not exist on this machine: ${projectPath}`)
    }
    await codex.upsertMcpProject(projectPath, name, canonical)
    return `Wrote MCP "${name}" to ${projectPath}/.codex/config.toml.`
  }
  if (toolId === 'cursor') {
    if (scope === 'global') {
      await cursor.upsertMcpUser(name, canonical)
      return `Wrote MCP "${name}" to ~/.cursor/mcp.json.`
    }
    if (!projectPath) throw new Error('Project path missing for project-scoped MCP.')
    if (!(await pathExists(projectPath))) {
      throw new Error(`Project path does not exist on this machine: ${projectPath}`)
    }
    await cursor.upsertMcpProject(projectPath, name, canonical)
    return `Wrote MCP "${name}" to ${projectPath}/.cursor/mcp.json.`
  }
  if (toolId === 'passport') {
    await passport.addMcp({ name, canonical })
    return `Added MCP "${name}" to your Passport library.`
  }
  throw new Error(`Unknown target tool ${toolId}`)
}

async function toolSkillDestination(
  toolId: ToolId,
  scope: Scope,
  projectPath: string | undefined,
  name: string
): Promise<string> {
  if (toolId === 'claude-code') {
    if (scope === 'global') return join(paths.claudeCodeUserSkillsDir, name)
    if (!projectPath) throw new Error('Project path missing for project-scoped skill.')
    if (!(await pathExists(projectPath))) {
      throw new Error(`Project path does not exist on this machine: ${projectPath}`)
    }
    return join(projectClaudeSkillsDir(projectPath), name)
  }
  if (toolId === 'codex-cli' || toolId === 'codex-desktop') {
    if (scope !== 'global') throw new Error('Codex skills are global only.')
    return join(paths.codexUserSkillsDir, name)
  }
  if (toolId === 'cursor') {
    if (scope === 'global') return join(paths.cursorUserSkillsDir, name)
    if (!projectPath) throw new Error('Project path missing for project-scoped skill.')
    if (!(await pathExists(projectPath))) {
      throw new Error(`Project path does not exist on this machine: ${projectPath}`)
    }
    return join(projectCursorSkillsDir(projectPath), name)
  }
  if (toolId === 'passport') {
    return join(passportLibraryDir(), 'skills', name)
  }
  throw new Error(`Tool ${toolId} does not support file-based skills.`)
}

async function applyMcpAuth(
  item: Extract<ExportItem, { kind: 'mcp-auth' }>,
  requested: ConflictAction
): Promise<ImportApplyOutcome> {
  // v1 bundles stored mcp-auth keyed by host with the wrong file layout.
  // We can't restore them safely — surface a skip with an explanation.
  // @ts-expect-error legacy v1 shape
  if (typeof item.host === 'string' && !item.url) {
    return {
      id: item.id,
      // @ts-expect-error legacy v1 shape
      name: item.host,
      kind: 'mcp-auth',
      ok: true,
      message: 'Legacy v1 mcp-auth item — skipped. Re-export from a newer Passport.',
      action: 'skip'
    }
  }

  const url = item.url
  const label = hostnameOf(url)
  const hash = mcpUrlHash(url)
  const targetVersion = await pickMcpRemoteVersion()
  if (!targetVersion) {
    return {
      id: item.id,
      name: label,
      kind: 'mcp-auth',
      ok: false,
      message:
        'No mcp-remote cache directory found locally. Run a remote MCP once to initialize ~/.mcp-auth/.',
      action: requested
    }
  }
  const versionDir = join(paths.mcpAuthDir, targetVersion)
  // "Protected": tokens already present for this URL — never overwrite per policy.
  const existing = await fs.readdir(versionDir).catch(() => [] as string[])
  if (existing.some((f) => f === `${hash}_tokens.json`)) {
    return {
      id: item.id,
      name: label,
      kind: 'mcp-auth',
      ok: true,
      message: 'URL already authenticated locally — left untouched.',
      action: 'protected'
    }
  }
  if (requested === 'skip') {
    return {
      id: item.id,
      name: label,
      kind: 'mcp-auth',
      ok: true,
      message: 'Skipped.',
      action: 'skip'
    }
  }
  try {
    let n = 0
    await fs.mkdir(versionDir, { recursive: true })
    for (const [tail, b64] of Object.entries(item.files)) {
      const target = join(versionDir, `${hash}_${tail}`)
      await fs.writeFile(target, Buffer.from(b64, 'base64'), { mode: 0o600 })
      n++
    }
    return {
      id: item.id,
      name: label,
      kind: 'mcp-auth',
      ok: true,
      message: `Restored OAuth tokens for ${label} (${n} file${n === 1 ? '' : 's'}).`,
      action: 'overwrite'
    }
  } catch (e) {
    return {
      id: item.id,
      name: label,
      kind: 'mcp-auth',
      ok: false,
      message: (e as Error).message,
      action: requested
    }
  }
}

async function pickMcpRemoteVersion(): Promise<string | null> {
  // Prefer an existing mcp-remote-* subdir on the local box. If none exists
  // yet (mcp-remote never ran), we can't safely guess the version directory
  // name, so we bail and let the user trigger a real auth first.
  if (!(await pathExists(paths.mcpAuthDir))) return null
  const entries = await fs.readdir(paths.mcpAuthDir).catch(() => [] as string[])
  const versions = entries.filter((e) => e.startsWith('mcp-remote-'))
  if (versions.length === 0) return null
  // Sort descending so we pick the newest version directory if there are several.
  versions.sort().reverse()
  return versions[0]
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// === Helpers ===

function nameOf(item: ExportItem): string {
  if (item.kind === 'mcp-auth') {
    if (item.url) return hostnameOf(item.url)
    // @ts-expect-error legacy v1 shape
    return item.host ?? '(unknown)'
  }
  return item.name
}

async function uniqueNameFor(
  item: Exclude<ExportItem, { kind: 'mcp-auth' }>,
  scan: ScanResult
): Promise<string> {
  const base = `${item.name}-imported`
  let candidate = base
  let n = 2
  while (await collisionExists(item, candidate, scan)) {
    candidate = `${base}-${n}`
    n++
    if (n > 99) break
  }
  return candidate
}

async function collisionExists(
  item: Exclude<ExportItem, { kind: 'mcp-auth' }>,
  candidate: string,
  scan: ScanResult
): Promise<boolean> {
  if (item.kind === 'library-mcp') {
    return findLibraryMcpInScan(scan, candidate) !== null
  }
  if (item.kind === 'library-skill') {
    return pathExists(join(passportLibraryDir(), 'skills', candidate))
  }
  if (item.kind === 'tool-mcp') {
    return scan.items.some(
      (it) =>
        it.kind === 'mcp' &&
        it.name === candidate &&
        it.presences.some(
          (p) =>
            p.toolId === item.toolId &&
            p.scope === item.scope &&
            p.projectPath === item.projectPath
        )
    )
  }
  if (item.kind === 'tool-skill') {
    return pathExists(
      await toolSkillDestination(item.toolId, item.scope, item.projectPath, candidate)
    )
  }
  return false
}

async function writeFilesFromBase64(
  destDir: string,
  files: Record<string, string>
): Promise<number> {
  let count = 0
  for (const [rel, b64] of Object.entries(files)) {
    // Defense against path traversal in malicious bundles.
    const safe = rel
      .split('/')
      .filter((p) => p && p !== '..' && p !== '.')
      .join('/')
    if (!safe) continue
    const target = join(destDir, safe)
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.writeFile(target, Buffer.from(b64, 'base64'))
    count++
  }
  return count
}

function passportLibraryDir(): string {
  // Mirror of sync.ts — use Electron's userData when available, fall back to the
  // per-platform default for non-Electron contexts (smoke tests).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron')
    if (electron?.app?.getPath) return join(electron.app.getPath('userData'), 'library')
  } catch {
    // not in Electron
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'mcp-passport', 'library')
  }
  return join(homedir(), '.config', 'mcp-passport', 'library')
}

// === Classification ===

async function classify(item: ExportItem, scan: ScanResult): Promise<ImportPlanItem> {
  const make = (
    status: ImportItemStatus,
    diffSummary?: string,
    isProtected?: boolean
  ): ImportPlanItem => ({
    id: item.id,
    kind: item.kind,
    name: itemName(item),
    subtitle: itemSubtitle(item),
    status,
    diffSummary,
    defaultAction: defaultActionFor(status),
    protected: isProtected
  })

  switch (item.kind) {
    case 'library-mcp': {
      const existing = findLibraryMcpInScan(scan, item.name)
      if (!existing) return make('new')
      if (canonicalsEqual(existing, item.canonical)) return make('identical')
      return make('conflict', describeMcpDiff(existing, item.canonical))
    }
    case 'library-skill': {
      const existingPath = findLibrarySkillPathInScan(scan, item.name)
      if (!existingPath) return make('new')
      return (await skillFilesEqual(existingPath, item.files))
        ? make('identical')
        : make('conflict', `${Object.keys(item.files).length} file(s) in bundle`)
    }
    case 'tool-mcp': {
      const existing = findToolMcpInScan(scan, item)
      if (!existing) return make('new')
      if (canonicalsEqual(existing, item.canonical)) return make('identical')
      return make('conflict', describeMcpDiff(existing, item.canonical))
    }
    case 'tool-skill': {
      const existingPath = findToolSkillPathInScan(scan, item)
      if (!existingPath) return make('new')
      return (await skillFilesEqual(existingPath, item.files))
        ? make('identical')
        : make('conflict', `${Object.keys(item.files).length} file(s) in bundle`)
    }
    case 'mcp-auth': {
      // v1 items: legacy host-keyed; classify as protected (we'll skip on apply).
      // @ts-expect-error legacy v1 shape
      if (typeof item.host === 'string' && !item.url) {
        return make('protected', 'legacy v1 mcp-auth — will be skipped', true)
      }
      const url = item.url
      const hash = mcpUrlHash(url)
      const caches = await listAuthCaches()
      const existing = caches.find((c) => c.urlHash === hash && c.hasTokens)
      if (existing) {
        return make('protected', 'URL already authenticated locally — leaving untouched', true)
      }
      return make('new')
    }
  }
}

function defaultActionFor(status: ImportItemStatus): ConflictAction {
  if (status === 'new') return 'overwrite' // import as-is when nothing exists
  return 'skip'
}

function itemName(item: ExportItem): string {
  if (item.kind === 'mcp-auth') {
    // @ts-expect-error legacy v1 shape may still carry .host
    if (!item.url && item.host) return item.host as string
    return hostnameOf(item.url)
  }
  return item.name
}

function itemSubtitle(item: ExportItem): string | undefined {
  switch (item.kind) {
    case 'library-mcp':
    case 'library-skill':
      return 'Passport library'
    case 'tool-mcp':
    case 'tool-skill':
      return item.scope === 'project' && item.projectPath
        ? `${item.toolId} · project: ${item.projectPath}`
        : `${item.toolId} · ${item.scope}`
    case 'mcp-auth':
      return `${Object.keys(item.files).length} file(s)`
  }
}

// === Comparison ===

function canonicalsEqual(a: CanonicalMcp, b: CanonicalMcp): boolean {
  return canonicalize(a) === canonicalize(b)
}

function canonicalize(c: CanonicalMcp): string {
  return JSON.stringify(c, Object.keys(c).sort())
}

function describeMcpDiff(local: CanonicalMcp, incoming: CanonicalMcp): string {
  const diffs: string[] = []
  if (local.transport !== incoming.transport)
    diffs.push(`transport: ${local.transport} → ${incoming.transport}`)
  if (local.command !== incoming.command) diffs.push('command differs')
  if (JSON.stringify(local.args ?? []) !== JSON.stringify(incoming.args ?? []))
    diffs.push('args differ')
  if (JSON.stringify(local.env ?? {}) !== JSON.stringify(incoming.env ?? {}))
    diffs.push('env differs')
  if (local.url !== incoming.url) diffs.push('url differs')
  if (JSON.stringify(local.headers ?? {}) !== JSON.stringify(incoming.headers ?? {}))
    diffs.push('headers differ')
  return diffs.length ? diffs.join(', ') : 'differs (subtle)'
}

async function skillFilesEqual(dir: string, incoming: Record<string, string>): Promise<boolean> {
  const local: Record<string, string> = {}
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
      if (e.isDirectory()) stack.push(full)
      else if (e.isFile()) {
        const buf = await fs.readFile(full)
        local[rel] = buf.toString('base64')
      }
    }
  }
  const lk = Object.keys(local).sort()
  const ik = Object.keys(incoming).sort()
  if (lk.length !== ik.length) return false
  for (let i = 0; i < lk.length; i++) {
    if (lk[i] !== ik[i]) return false
    if (local[lk[i]] !== incoming[lk[i]]) return false
  }
  return true
}

// === Scan lookups ===

function findLibraryMcpInScan(scan: ScanResult, name: string): CanonicalMcp | null {
  for (const item of scan.items) {
    if (item.kind !== 'mcp' || item.name !== name) continue
    for (const p of item.presences) {
      if (p.toolId === 'passport' && p.source.kind === 'mcp') return p.source.canonical
    }
  }
  return null
}

function findLibrarySkillPathInScan(scan: ScanResult, name: string): string | null {
  for (const item of scan.items) {
    if (item.kind !== 'skill' || item.name !== name) continue
    for (const p of item.presences) {
      if (p.toolId === 'passport' && p.source.kind === 'skill') return p.source.path
    }
  }
  return null
}

function findToolMcpInScan(
  scan: ScanResult,
  target: ExportItem & { kind: 'tool-mcp' }
): CanonicalMcp | null {
  for (const item of scan.items) {
    if (item.kind !== 'mcp' || item.name !== target.name) continue
    for (const p of item.presences) {
      if (
        p.toolId === target.toolId &&
        p.scope === target.scope &&
        p.projectPath === target.projectPath &&
        p.source.kind === 'mcp'
      )
        return p.source.canonical
    }
  }
  return null
}

function findToolSkillPathInScan(
  scan: ScanResult,
  target: ExportItem & { kind: 'tool-skill' }
): string | null {
  for (const item of scan.items) {
    if (item.kind !== 'skill' || item.name !== target.name) continue
    for (const p of item.presences) {
      if (
        p.toolId === target.toolId &&
        p.scope === target.scope &&
        p.projectPath === target.projectPath &&
        p.source.kind === 'skill'
      )
        return p.source.path
    }
  }
  return null
}
