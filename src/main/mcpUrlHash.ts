// Mirrors mcp-remote's getServerUrlHash so we can locate cached OAuth state
// for a given MCP URL without spawning the proxy.
//
// Source of truth: https://github.com/geelen/mcp-remote/blob/main/src/lib/utils.ts
//
//   md5(serverUrl + ['|' + authorizeResource]? + ['|' + JSON.stringify(headers, sortedKeys)]?)
//
// We don't currently track the authorizeResource or per-MCP custom headers in
// the canonical, so the single-arg form covers every MCP we know about. The
// extra args are accepted for forward-compat and parity testing.

import crypto from 'crypto'

export function mcpUrlHash(
  serverUrl: string,
  authorizeResource?: string,
  headers?: Record<string, string>
): string {
  const parts: string[] = [serverUrl]
  if (authorizeResource) parts.push(authorizeResource)
  if (headers && Object.keys(headers).length > 0) {
    const sortedKeys = (_key: string, value: unknown): unknown => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const sorted: Record<string, unknown> = {}
        for (const k of Object.keys(value as Record<string, unknown>).sort()) {
          sorted[k] = (value as Record<string, unknown>)[k]
        }
        return sorted
      }
      return value
    }
    parts.push(JSON.stringify(headers, sortedKeys))
  }
  return crypto.createHash('md5').update(parts.join('|')).digest('hex')
}
