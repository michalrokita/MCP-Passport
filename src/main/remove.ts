import { promises as fs } from 'fs'
import * as claudeDesktop from './adapters/claudeDesktop'
import * as claudeCode from './adapters/claudeCode'
import * as codex from './adapters/codex'
import * as cursor from './adapters/cursor'
import * as passport from './adapters/passport'
import { scanAll } from './scanner'
import type { Scope, ToolId } from '../shared/types'

export async function removeItemFromTool(
  itemId: string,
  toolId: ToolId,
  scope: Scope,
  projectPath?: string
): Promise<{ ok: boolean; message: string }> {
  const scan = await scanAll()
  const item = scan.items.find((it) => it.id === itemId)
  if (!item) return { ok: false, message: 'Item not found in current scan.' }

  const presence = item.presences.find(
    (p) =>
      p.toolId === toolId &&
      p.scope === scope &&
      (projectPath ? p.projectPath === projectPath : true)
  )
  if (!presence) return { ok: false, message: 'Presence not found.' }

  try {
    if (item.kind === 'mcp' && presence.source.kind === 'mcp') {
      const loc = presence.source.locator
      if (loc.kind === 'claude-desktop') await claudeDesktop.removeMcp(item.name)
      else if (loc.kind === 'claude-code-user') await claudeCode.removeMcpUser(item.name)
      else if (loc.kind === 'claude-code-project')
        await claudeCode.removeMcpProject(loc.projectPath, item.name)
      else if (loc.kind === 'codex') await codex.removeMcp(item.name)
      else if (loc.kind === 'cursor-user') await cursor.removeMcpUser(item.name)
      else if (loc.kind === 'cursor-project')
        await cursor.removeMcpProject(loc.projectPath, item.name)
      else if (loc.kind === 'passport-library') await passport.removeMcp(item.name)
      return { ok: true, message: `Removed MCP "${item.name}" from ${toolId}.` }
    }
    if ((item.kind === 'skill' || item.kind === 'agent') && presence.source.kind !== 'plugin' && presence.source.kind !== 'mcp') {
      const path = presence.source.path
      await fs.rm(path, { recursive: true, force: true })
      return { ok: true, message: `Removed ${item.kind} "${item.name}" at ${path}.` }
    }
    if (item.kind === 'plugin') {
      return {
        ok: false,
        message:
          'Removing plugins is not supported via Passport in this MVP. Use the host tool to uninstall.'
      }
    }
    return { ok: false, message: 'Unsupported remove operation.' }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
