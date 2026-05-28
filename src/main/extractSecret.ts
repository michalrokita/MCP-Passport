// Pull one detected plaintext secret out of a tool's MCP config into an env-var
// reference. Only Claude Code (${VAR}) and Codex (env_vars / bearer_token_env_var
// / env_http_headers) are rewritable; everything else is guidance-only and never
// reaches here (the renderer disables Extract for non-fixable findings).

import * as claudeCode from './adapters/claudeCode'
import * as codex from './adapters/codex'
import { scanAll } from './scanner'
import { isExtractable } from './secrets'
import type {
  CanonicalMcp,
  ExtractSecretRequest,
  ExtractSecretResult,
  SecretLocation
} from '../shared/types'

export async function extractSecret(req: ExtractSecretRequest): Promise<ExtractSecretResult> {
  try {
    const scan = await scanAll()
    const item = scan.items.find((it) => it.id === req.itemId)
    const presence = item?.presences.find(
      (p) =>
        p.toolId === req.toolId &&
        p.scope === req.scope &&
        (p.projectPath ?? '') === (req.projectPath ?? '')
    )
    if (!item || !presence || presence.source.kind !== 'mcp') {
      return { ok: false, message: 'That MCP is no longer in the scan — rescan and try again.' }
    }
    if (!isExtractable(req.toolId, req.location)) {
      return { ok: false, message: `${req.toolId} can't reference env vars at this location.` }
    }

    const canonical = clone(presence.source.canonical)
    const secret = secretAt(canonical, req.location)
    if (!secret) {
      return { ok: false, message: 'Could not re-read the secret value — it may have changed.' }
    }

    const varName = req.varName.trim() || 'MCP_SECRET'
    let value: string

    if (req.toolId === 'claude-code') {
      value = rewriteWithReference(canonical, req.location, varName, secret)
      await persistClaudeCode(req, item.name, canonical)
    } else {
      // codex-cli / codex-desktop (shared config)
      value = rewriteForCodex(canonical, req.location, varName, secret)
      await persistCodex(req, item.name, canonical)
    }

    return {
      ok: true,
      message: `Extracted into ${varName}. Set it, then restart ${req.toolId}.`,
      value,
      varName,
      setCommands: buildSetCommands(req.toolId, varName, value)
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

function clone(c: CanonicalMcp): CanonicalMcp {
  return JSON.parse(JSON.stringify(c))
}

/** Read the raw secret substring at a location from the live canonical. */
function secretAt(c: CanonicalMcp, loc: SecretLocation): string | null {
  if (loc.kind === 'env') return c.env?.[loc.key] ?? null
  if (loc.kind === 'header') {
    const v = c.headers?.[loc.key]
    if (!v) return null
    // For bearer headers, the secret is the token, not the "Bearer " prefix.
    const m = /^Bearer\s+(.+)$/i.exec(v)
    return m ? m[1] : v
  }
  if (loc.kind === 'arg') {
    const arg = c.args?.[loc.index]
    if (typeof arg !== 'string') return null
    return embeddedCredential(arg) ?? arg
  }
  if (loc.kind === 'url') {
    if (!c.url) return null
    return embeddedCredential(c.url) ?? c.url
  }
  return null
}

// scheme://user:PASSWORD@host → PASSWORD, else null.
function embeddedCredential(v: string): string | null {
  const m = /\/\/[^\s:/@]+:([^\s:/@]+)@/.exec(v)
  return m ? m[1] : null
}

/** Claude Code: replace the secret with ${VAR} in place. Returns the value. */
function rewriteWithReference(
  c: CanonicalMcp,
  loc: SecretLocation,
  varName: string,
  secret: string
): string {
  const ref = `\${${varName}}`
  if (loc.kind === 'env') {
    const value = c.env?.[loc.key] ?? ''
    c.env = { ...(c.env ?? {}), [loc.key]: ref }
    return value
  }
  if (loc.kind === 'header') {
    const cur = c.headers?.[loc.key] ?? ''
    c.headers = { ...(c.headers ?? {}), [loc.key]: cur.replace(secret, ref) }
    return secret
  }
  if (loc.kind === 'arg' && c.args) {
    c.args = c.args.map((a, i) => (i === loc.index && typeof a === 'string' ? a.replace(secret, ref) : a))
    return secret
  }
  if (loc.kind === 'url' && c.url) {
    c.url = c.url.replace(secret, ref)
    return secret
  }
  return secret
}

/** Codex: env → env_vars passthrough; header → bearer_token_env_var / env_http_headers. */
function rewriteForCodex(
  c: CanonicalMcp,
  loc: SecretLocation,
  varName: string,
  secret: string
): string {
  if (loc.kind === 'env') {
    const value = c.env?.[loc.key] ?? ''
    if (c.env) delete c.env[loc.key]
    const vars = new Set(c.env_vars ?? [])
    vars.add(loc.key) // env_vars forwards by name, so the var name is the key
    c.env_vars = [...vars]
    return value
  }
  if (loc.kind === 'header') {
    const cur = c.headers?.[loc.key] ?? ''
    if (c.headers) delete c.headers[loc.key]
    if (/^authorization$/i.test(loc.key)) {
      c.bearer_token_env_var = varName
    } else {
      c.env_http_headers = { ...(c.env_http_headers ?? {}), [loc.key]: varName }
    }
    const m = /^Bearer\s+(.+)$/i.exec(cur)
    return m ? m[1] : cur
  }
  // arg/url are not extractable for Codex; guarded by isExtractable upstream.
  return secret
}

async function persistClaudeCode(
  req: ExtractSecretRequest,
  name: string,
  canonical: CanonicalMcp
): Promise<void> {
  if (req.scope === 'global') {
    await claudeCode.upsertMcpUser(name, canonical)
  } else {
    if (!req.projectPath) throw new Error('Project path required.')
    await claudeCode.upsertMcpProject(req.projectPath, name, canonical)
  }
}

async function persistCodex(
  req: ExtractSecretRequest,
  name: string,
  canonical: CanonicalMcp
): Promise<void> {
  if (req.scope === 'global') {
    await codex.upsertMcp(name, canonical)
  } else {
    if (!req.projectPath) throw new Error('Project path required.')
    await codex.upsertMcpProject(req.projectPath, name, canonical)
  }
}

function buildSetCommands(
  toolId: ExtractSecretRequest['toolId'],
  varName: string,
  value: string
): { shell: string; launchctl?: string } {
  const shell = `export ${varName}=${shellSingleQuote(value)}`
  // GUI apps (Codex Desktop, and the shared Codex config) don't inherit your
  // shell env; launchctl setenv makes the var visible to launched apps.
  const needsLaunchctl = toolId === 'codex-cli' || toolId === 'codex-desktop'
  return needsLaunchctl
    ? { shell, launchctl: `launchctl setenv ${varName} ${shellSingleQuote(value)}` }
    : { shell }
}

function shellSingleQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`
}
