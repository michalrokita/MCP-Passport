// Write env-var / header secrets into one or more tool configs for a given MCP.
//
// We don't run a sync — the MCP must already exist in each target. We look up
// the canonical for that target, merge the new values in, and write it back
// using the tool's existing upsert path.

import * as claudeDesktop from './adapters/claudeDesktop'
import * as claudeCode from './adapters/claudeCode'
import * as codex from './adapters/codex'
import * as cursor from './adapters/cursor'
import * as passport from './adapters/passport'
import { scanAll } from './scanner'
import type {
  CanonicalMcp,
  ItemPresence,
  McpFillSecretsOutcome,
  McpFillSecretsRequest,
  McpFillSecretsResult,
  McpFillSecretsTarget
} from '../shared/types'

export async function fillSecrets(req: McpFillSecretsRequest): Promise<McpFillSecretsResult> {
  if (!req.name) {
    return {
      ok: false,
      message: 'MCP name required.',
      outcomes: []
    }
  }
  if (!req.env && !req.headers) {
    return {
      ok: false,
      message: 'No env or headers provided.',
      outcomes: []
    }
  }

  const scan = await scanAll()
  const item = scan.items.find((it) => it.kind === 'mcp' && it.name === req.name)
  if (!item) {
    return {
      ok: false,
      message: `MCP "${req.name}" not found.`,
      outcomes: []
    }
  }

  // If no targets given, write to every tool/scope where the MCP currently lives
  // (excluding the Passport library — that's covered by libraryAddMcp).
  let targets = req.targets
  if (!targets || targets.length === 0) {
    targets = item.presences
      .filter((p) => p.toolId !== 'passport')
      .map((p) => ({ toolId: p.toolId, scope: p.scope, projectPath: p.projectPath }))
  }
  if (targets.length === 0) {
    return {
      ok: false,
      message: 'No matching tool presences for this MCP.',
      outcomes: []
    }
  }

  const outcomes: McpFillSecretsOutcome[] = []
  for (const t of targets) {
    const presence = findPresence(item.presences, t)
    if (!presence || presence.source.kind !== 'mcp') {
      outcomes.push({
        target: t,
        ok: false,
        message: 'Presence not found.'
      })
      continue
    }
    const merged = mergeSecrets(presence.source.canonical, req.env, req.headers)
    try {
      await writeBackTo(t, req.name, merged)
      outcomes.push({
        target: t,
        ok: true,
        message: `Updated secrets in ${describeTarget(t)}.`
      })
    } catch (e) {
      outcomes.push({
        target: t,
        ok: false,
        message: (e as Error).message
      })
    }
  }

  const okCount = outcomes.filter((o) => o.ok).length
  return {
    ok: outcomes.every((o) => o.ok),
    message: `Updated ${okCount} of ${outcomes.length} location${outcomes.length === 1 ? '' : 's'}.`,
    outcomes
  }
}

function findPresence(presences: ItemPresence[], t: McpFillSecretsTarget): ItemPresence | null {
  return (
    presences.find(
      (p) => p.toolId === t.toolId && p.scope === t.scope && p.projectPath === t.projectPath
    ) ?? null
  )
}

function mergeSecrets(
  canonical: CanonicalMcp,
  env?: Record<string, string>,
  headers?: Record<string, string>
): CanonicalMcp {
  const out: CanonicalMcp = { ...canonical }
  if (env) out.env = { ...(canonical.env ?? {}), ...env }
  if (headers) out.headers = { ...(canonical.headers ?? {}), ...headers }
  return out
}

async function writeBackTo(
  target: McpFillSecretsTarget,
  name: string,
  canonical: CanonicalMcp
): Promise<void> {
  if (target.toolId === 'passport') {
    await passport.addMcp({ name, canonical })
    return
  }
  if (target.toolId === 'claude-desktop') {
    if (target.scope !== 'global') throw new Error('Claude Desktop is global-only.')
    await claudeDesktop.upsertMcp(name, canonical)
    return
  }
  if (target.toolId === 'claude-code') {
    if (target.scope === 'global') {
      await claudeCode.upsertMcpUser(name, canonical)
      return
    }
    if (!target.projectPath) throw new Error('Project path required.')
    await claudeCode.upsertMcpProject(target.projectPath, name, canonical)
    return
  }
  if (target.toolId === 'codex-cli' || target.toolId === 'codex-desktop') {
    if (target.scope === 'global') {
      await codex.upsertMcp(name, canonical)
      return
    }
    if (!target.projectPath) throw new Error('Project path required.')
    await codex.upsertMcpProject(target.projectPath, name, canonical)
    return
  }
  if (target.toolId === 'cursor') {
    if (target.scope === 'global') {
      await cursor.upsertMcpUser(name, canonical)
      return
    }
    if (!target.projectPath) throw new Error('Project path required.')
    await cursor.upsertMcpProject(target.projectPath, name, canonical)
    return
  }
  throw new Error(`Unknown target tool ${target.toolId}`)
}

function describeTarget(t: McpFillSecretsTarget): string {
  if (t.scope === 'project' && t.projectPath) return `${t.toolId} (${t.projectPath})`
  return `${t.toolId} (${t.scope})`
}
