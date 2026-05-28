// Plaintext-secret detection for MCP configs. Pure functions, no IO.
//
// Detection is deliberately conservative — we'd rather miss a borderline value
// than nag about a public URL or a log level. Anything already written as an
// env-var reference (${VAR}) is treated as already handled.

import type { CanonicalMcp, SecretLocation, ToolId } from '../shared/types'

export interface DetectedSecret {
  location: SecretLocation
  /** The exact secret substring (may sit inside a larger value, e.g. a DSN). */
  secret: string
  /** The full field value the secret was found in. */
  fullValue: string
  reason: string
}

// High-confidence vendor token shapes. Order matters: more specific first.
const TOKEN_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /dop_v1_[A-Fa-f0-9]{32,}/, reason: 'DigitalOcean token' },
  { re: /sk-ant-[A-Za-z0-9_-]{20,}/, reason: 'Anthropic API key' },
  { re: /sk-[A-Za-z0-9_-]{20,}/, reason: 'OpenAI API key' },
  { re: /gh[pousr]_[A-Za-z0-9]{30,}/, reason: 'GitHub token' },
  { re: /glpat-[A-Za-z0-9_-]{20,}/, reason: 'GitLab token' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, reason: 'Slack token' },
  { re: /AKIA[0-9A-Z]{16}/, reason: 'AWS access key id' },
  { re: /AIza[0-9A-Za-z_-]{35}/, reason: 'Google API key' },
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/, reason: 'JWT' }
]

// scheme://user:PASSWORD@host — capture the password.
const URI_CRED_RE = /\/\/[^\s:/@]+:([^\s:/@]+)@/

const SECRET_KEY_RE =
  /(token|secret|api[_-]?key|access[_-]?key|password|passwd|pwd|credential|private[_-]?key|auth|dsn|connection[_-]?string|conn[_-]?str)/i

function isReference(v: string): boolean {
  return /\$\{[^}]+\}/.test(v) || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(v)
}

function looksHighEntropy(v: string): boolean {
  if (v.length < 24 || /\s/.test(v)) return false
  // Single-case hex is almost always a hash/checksum/fingerprint, not a credential.
  if (/^[a-f0-9]+$/.test(v) || /^[A-F0-9]+$/.test(v)) return false
  const distinct = new Set(v).size
  const mixedCase = /[a-z]/.test(v) && /[A-Z]/.test(v)
  const hasSymbol = /[^A-Za-z0-9]/.test(v)
  // Require a digit plus either mixed case or a symbol — real tokens have one;
  // vendor tokens with a fixed shape are already caught by TOKEN_PATTERNS.
  return distinct >= 12 && /[0-9]/.test(v) && (mixedCase || hasSymbol)
}

/** Find a secret inside a single string value. `keyIsSecrety` lifts the bar for
 *  whole-value flagging when the surrounding key/name already implies a secret. */
function scanValue(value: string, keyIsSecrety: boolean): { secret: string; reason: string } | null {
  if (!value || isReference(value)) return null
  for (const { re, reason } of TOKEN_PATTERNS) {
    const m = re.exec(value)
    if (m) return { secret: m[0], reason }
  }
  const uri = URI_CRED_RE.exec(value)
  if (uri && uri[1] && uri[1].length >= 4) {
    return { secret: uri[1], reason: 'embedded credential in connection string' }
  }
  if (keyIsSecrety && !looksLikePlaceholder(value)) {
    return { secret: value, reason: 'secret-named field' }
  }
  if (looksHighEntropy(value)) return { secret: value, reason: 'high-entropy value' }
  return null
}

// Common non-secret values people put in secret-named fields.
function looksLikePlaceholder(v: string): boolean {
  return (
    v.length < 6 ||
    /^(true|false|info|debug|warn|error|none|null|localhost|development|production)$/i.test(v) ||
    /^https?:\/\//i.test(v) && !URI_CRED_RE.test(v)
  )
}

export function findSecretsInCanonical(c: CanonicalMcp): DetectedSecret[] {
  const out: DetectedSecret[] = []

  for (const [key, value] of Object.entries(c.env ?? {})) {
    if (typeof value !== 'string') continue
    const hit = scanValue(value, SECRET_KEY_RE.test(key))
    if (hit) out.push({ location: { kind: 'env', key }, secret: hit.secret, fullValue: value, reason: hit.reason })
  }

  for (const [key, value] of Object.entries(c.headers ?? {})) {
    if (typeof value !== 'string') continue
    const hit = scanValue(value, SECRET_KEY_RE.test(key) || /^authorization$/i.test(key))
    if (hit) out.push({ location: { kind: 'header', key }, secret: hit.secret, fullValue: value, reason: hit.reason })
  }

  c.args?.forEach((arg, index) => {
    if (typeof arg !== 'string') return
    const hit = scanValue(arg, false)
    if (hit) out.push({ location: { kind: 'arg', index }, secret: hit.secret, fullValue: arg, reason: hit.reason })
  })

  if (c.url) {
    const hit = scanValue(c.url, false)
    if (hit) out.push({ location: { kind: 'url' }, secret: hit.secret, fullValue: c.url, reason: hit.reason })
  }

  return out
}

/** Mask a secret for display: keep a short head + tail, hide the middle. */
export function maskSecret(s: string): string {
  if (s.length <= 8) return '•'.repeat(s.length)
  return `${s.slice(0, 6)}…${s.slice(-4)}`
}

/** Can we safely rewrite this tool's config to reference an env var? */
export function isExtractable(toolId: ToolId, loc: SecretLocation): boolean {
  // Claude Code expands ${VAR} in command/args/env/url/headers (documented).
  if (toolId === 'claude-code') return true
  // Codex has no ${VAR} expansion: only env (via env_vars) and headers (via
  // bearer_token_env_var / env_http_headers) can reference an ambient var.
  if (toolId === 'codex-cli' || toolId === 'codex-desktop') {
    return loc.kind === 'env' || loc.kind === 'header'
  }
  // Claude Desktop and Cursor don't reliably expand references — guide only.
  return false
}

/** Propose an env-var name for the extracted value. */
export function proposeVarName(serverName: string, loc: SecretLocation): string {
  // env: the var name must equal the key (Codex forwards by name; Claude expands ${key}).
  if (loc.kind === 'env') return loc.key
  const slug =
    serverName.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'MCP'
  if (loc.kind === 'header') return `${slug}_TOKEN`
  if (loc.kind === 'url') return `${slug}_URL`
  return `${slug}_SECRET`
}
