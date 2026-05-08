// Detects whether a remote MCP server actually requires OAuth, so the UI can
// hide the "Sign in" button for public servers (e.g. docs.livekit.io/mcp).
//
// Per the MCP authorization spec a server signals "auth required" by responding
// with HTTP 401 to an unauthenticated request; anything 2xx/3xx means the
// server processed the request without auth. We probe with a JSON-RPC
// `initialize` POST for Streamable HTTP and a HEAD for legacy SSE, abort the
// connection as soon as we have status, and cache the verdict in-memory for
// the rest of the process lifetime so repeat scans don't re-probe.

const PROBE_TIMEOUT_MS = 3000

export type ProbeResult = 'requires-auth' | 'no-auth' | 'unknown'

const cache = new Map<string, ProbeResult>()

export async function probeRemoteAuthRequired(
  url: string,
  transport: 'http' | 'sse'
): Promise<ProbeResult> {
  const cached = cache.get(url)
  if (cached === 'requires-auth' || cached === 'no-auth') return cached

  const result = await runProbe(url, transport)
  if (result !== 'unknown') cache.set(url, result)
  return result
}

export function clearProbeCache(): void {
  cache.clear()
}

async function runProbe(url: string, transport: 'http' | 'sse'): Promise<ProbeResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res =
      transport === 'http'
        ? await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream'
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'initialize',
              id: 1,
              params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'mcp-passport-probe', version: '0.0.0' }
              }
            }),
            signal: controller.signal
          })
        : await fetch(url, { method: 'HEAD', signal: controller.signal })

    // Got headers — abort to close any SSE stream the server might be opening.
    controller.abort()

    if (res.status === 401) return 'requires-auth'
    if (res.status >= 200 && res.status < 400) return 'no-auth'
    // 4xx other than 401 (e.g. 405 Method Not Allowed, 400 Bad Request) means
    // the server processed our request — auth wasn't the gate. Treat as no-auth.
    if (res.status >= 400 && res.status < 500) return 'no-auth'
    return 'unknown'
  } catch {
    return 'unknown'
  } finally {
    clearTimeout(timeoutId)
  }
}
