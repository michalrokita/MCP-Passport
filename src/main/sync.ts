import { homedir } from 'os'
import { join } from 'path'
import * as claudeDesktop from './adapters/claudeDesktop'
import * as claudeCode from './adapters/claudeCode'
import * as codex from './adapters/codex'
import * as cursor from './adapters/cursor'
import * as passport from './adapters/passport'
import { scanAll } from './scanner'

function passportLibraryDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron')
    if (electron?.app?.getPath) return join(electron.app.getPath('userData'), 'library')
  } catch {
    // ignore
  }
  return join(homedir(), 'Library', 'Application Support', 'mcp-passport', 'library')
}
import type {
  InventoryItem,
  SyncOutcome,
  SyncRequest,
  SyncTarget,
  ToolId,
  CanonicalMcp,
  ItemSource
} from '../shared/types'

export async function syncItem(req: SyncRequest): Promise<SyncOutcome[]> {
  const scan = await scanAll()
  const item = scan.items.find((it) => it.id === req.source.itemId)
  if (!item) {
    return req.targets.map((t) => ({
      target: t,
      ok: false,
      message: `Source item ${req.source.itemId} not found in current scan.`
    }))
  }

  const sourcePresence = item.presences.find(
    (p) =>
      p.toolId === req.source.fromToolId &&
      p.scope === req.source.fromScope &&
      (req.source.fromProjectPath ? p.projectPath === req.source.fromProjectPath : true)
  )
  if (!sourcePresence) {
    return req.targets.map((t) => ({
      target: t,
      ok: false,
      message: `Source presence not found for ${req.source.fromToolId}/${req.source.fromScope}.`
    }))
  }

  const outcomes: SyncOutcome[] = []
  for (const target of req.targets) {
    try {
      const msg = await applySync(item, sourcePresence.source, target)
      outcomes.push({ target, ok: true, message: msg })
    } catch (e) {
      outcomes.push({
        target,
        ok: false,
        message: `Failed: ${(e as Error).message}`
      })
    }
  }
  return outcomes
}

async function applySync(
  item: InventoryItem,
  source: ItemSource,
  target: SyncTarget
): Promise<string> {
  if (item.kind === 'mcp' && source.kind === 'mcp') {
    return syncMcp(item.name, source.canonical, target)
  }
  if (item.kind === 'skill' && source.kind === 'skill') {
    return syncSkill(item.name, source.path, target)
  }
  if (item.kind === 'agent' && source.kind === 'agent') {
    return syncAgent(item.name, source.path, target)
  }
  if (item.kind === 'plugin' && source.kind === 'plugin') {
    return syncPlugin(item.name, source, target)
  }
  throw new Error(`Cannot sync ${item.kind} into ${target.toolId}`)
}

async function syncMcp(name: string, canonical: CanonicalMcp, target: SyncTarget): Promise<string> {
  const t = target.toolId
  if (t === 'passport') {
    await passport.addMcp({ name, canonical })
    return `Saved MCP "${name}" to your Passport library.`
  }
  if (t === 'claude-desktop') {
    if (target.scope !== 'global') throw new Error('Claude Desktop only supports global MCPs.')
    await claudeDesktop.upsertMcp(name, canonical)
    return `Wrote MCP "${name}" to Claude Desktop config.`
  }
  if (t === 'claude-code') {
    if (target.scope === 'global') {
      await claudeCode.upsertMcpUser(name, canonical)
      return `Wrote MCP "${name}" to Claude Code user config.`
    }
    if (!target.projectPath) throw new Error('Project path required for project-scope MCP.')
    await claudeCode.upsertMcpProject(target.projectPath, name, canonical)
    return `Wrote MCP "${name}" to ${target.projectPath}/.mcp.json and auto-trusted it.`
  }
  if (t === 'codex-cli' || t === 'codex-desktop') {
    if (target.scope !== 'global') throw new Error('Codex MCPs are global only.')
    await codex.upsertMcp(name, canonical)
    return `Wrote MCP "${name}" to ~/.codex/config.toml (shared across Codex CLI + Desktop).`
  }
  if (t === 'cursor') {
    if (target.scope === 'global') {
      await cursor.upsertMcpUser(name, canonical)
      return `Wrote MCP "${name}" to ~/.cursor/mcp.json.`
    }
    if (!target.projectPath) throw new Error('Project path required for project-scope MCP.')
    await cursor.upsertMcpProject(target.projectPath, name, canonical)
    return `Wrote MCP "${name}" to ${target.projectPath}/.cursor/mcp.json.`
  }
  throw new Error(`Unknown target tool ${t}`)
}

async function syncSkill(name: string, srcDir: string, target: SyncTarget): Promise<string> {
  const t = target.toolId
  if (t === 'passport') {
    const dest = join(passportLibraryDir(), 'skills', name)
    await passport.copySkillTo(srcDir, name, dest)
    return `Copied skill "${name}" into your Passport library.`
  }
  if (t === 'claude-code') {
    if (target.scope === 'global') {
      const dest = await claudeCode.copySkillToUser(srcDir, name)
      return `Copied skill "${name}" to ${dest}.`
    }
    if (!target.projectPath) throw new Error('Project path required.')
    const dest = await claudeCode.copySkillToProject(target.projectPath, srcDir, name)
    return `Copied skill "${name}" to ${dest}.`
  }
  if (t === 'codex-cli' || t === 'codex-desktop') {
    if (target.scope !== 'global')
      throw new Error('Codex user skills are stored at ~/.agents/skills/ (global).')
    const dest = await codex.copySkillToUser(srcDir, name)
    return `Copied skill "${name}" to ${dest}.`
  }
  if (t === 'cursor') {
    if (target.scope === 'global') {
      const dest = await cursor.copySkillToUser(srcDir, name)
      return `Copied skill "${name}" to ${dest}.`
    }
    if (!target.projectPath) throw new Error('Project path required.')
    const dest = await cursor.copySkillToProject(target.projectPath, srcDir, name)
    return `Copied skill "${name}" to ${dest}.`
  }
  if (t === 'claude-desktop') {
    throw new Error(
      'Claude Desktop does not load file-based skills directly. Use Claude Code project-scope skill instead.'
    )
  }
  throw new Error(`Unknown target tool ${t}`)
}

async function syncAgent(name: string, srcPath: string, target: SyncTarget): Promise<string> {
  if (target.toolId !== 'claude-code') {
    throw new Error('Agents only sync between Claude Code locations.')
  }
  if (target.scope === 'global') {
    const dest = await claudeCode.copyAgentToUser(srcPath, name)
    return `Copied agent "${name}" to ${dest}.`
  }
  if (!target.projectPath) throw new Error('Project path required for project-scope agent.')
  const dest = await claudeCode.copyAgentToProject(target.projectPath, srcPath, name)
  return `Copied agent "${name}" to ${dest}.`
}

async function syncPlugin(
  name: string,
  source: Extract<ItemSource, { kind: 'plugin' }>,
  target: SyncTarget
): Promise<string> {
  if (target.toolId === 'codex-cli' || target.toolId === 'codex-desktop') {
    if (!source.marketplace)
      throw new Error('Plugin lacks marketplace metadata; cannot enable in Codex.')
    const cfg = (await codex.readConfig()) ?? {}
    const plugins: Record<string, { enabled?: boolean }> = (cfg as any).plugins ?? {}
    plugins[`${name}@${source.marketplace}`] = { enabled: true }
    ;(cfg as any).plugins = plugins
    await codex.writeConfig(cfg as any)
    return `Enabled plugin ${name}@${source.marketplace} in ~/.codex/config.toml.`
  }
  if (target.toolId === 'claude-code') {
    if (!source.marketplace)
      throw new Error('Plugin lacks marketplace metadata; cannot install in Claude Code.')
    const pluginKey = `${name}@${source.marketplace}`
    if (target.scope === 'project' && target.projectPath) {
      // Mark the plugin enabled at the project's settings.json.
      // (Actual install is performed by Claude Code on next launch when it sees the entry.)
      await claudeCode.setPluginEnabled(target.projectPath, pluginKey, true)
      return `Marked ${pluginKey} as enabled in ${target.projectPath}/.claude/settings.json. Run "claude" in that project to fetch the plugin from its marketplace.`
    }
    return (
      `Cross-tool plugin install for global Claude Code is not safe to do silently. ` +
      `Open Claude Code and run: /plugin install ${pluginKey}`
    )
  }
  throw new Error('Plugin sync not supported for this target.')
}
