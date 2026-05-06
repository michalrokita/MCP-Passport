// Spawn `npx -y mcp-remote-client@latest <url>` to run the OAuth flow for a
// remote MCP. The standalone client connects, opens the user's default browser
// for sign-in, lists tools, and exits. Tokens land in
// ~/.mcp-auth/mcp-remote-VERSION/{md5(url)}_tokens.json — the same place the
// stdio proxy looks at runtime.
//
// We only handle (a) running the flow, (b) cancelling it, (c) reading the
// outcome from the exit code + tail of stderr.

import { spawn, ChildProcess } from 'child_process'
import { mcpUrlHash } from '../mcpUrlHash'
import { clearAuthForHash } from './mcpAuth'
import type { McpAuthRunRequest, McpAuthRunResult } from '../../shared/types'

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes for the user to complete the OAuth dance

export interface RunOptions {
  /** Abort signal — when fired, kills the subprocess. */
  signal?: AbortSignal
  /** Override the default 5-minute timeout. */
  timeoutMs?: number
}

const STDERR_TAIL_BYTES = 2048

export async function runAuthFlow(
  req: McpAuthRunRequest,
  opts: RunOptions = {}
): Promise<McpAuthRunResult> {
  if (!req.url) {
    return {
      ok: false,
      message: 'No URL provided.',
      exitCode: null
    }
  }

  // Quick environment preflight: if `npx` isn't on PATH, give a useful error
  // rather than an opaque ENOENT.
  const npxOk = await hasNpx()
  if (!npxOk) {
    return {
      ok: false,
      message:
        '`npx` not found on PATH. Install Node.js (which ships npx) so Passport can run mcp-remote-client.',
      exitCode: null
    }
  }

  const args = ['-y', 'mcp-remote-client@latest', req.url]
  if (req.headers) {
    for (const [k, v] of Object.entries(req.headers)) {
      args.push('--header', `${k}:${v}`)
    }
  }

  const start = Date.now()
  const stderrChunks: Buffer[] = []
  let stderrSize = 0
  let timedOut = false

  return new Promise<McpAuthRunResult>((resolve) => {
    let child: ChildProcess
    try {
      child = spawn('npx', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        // Inherit env so HTTP_PROXY etc. flow through to mcp-remote-client.
        env: process.env
      })
    } catch (e) {
      resolve({
        ok: false,
        message: `Failed to spawn npx: ${(e as Error).message}`,
        exitCode: null,
        durationMs: Date.now() - start
      })
      return
    }

    const onAbort = (): void => {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
    }
    if (opts.signal) {
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }

    const timeout = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    // Discard stdout — mcp-remote-client prints tool listings we don't care about.
    child.stdout?.on('data', () => {})

    child.stderr?.on('data', (chunk: Buffer) => {
      // Keep at most the last STDERR_TAIL_BYTES bytes — older logs are dropped.
      stderrChunks.push(chunk)
      stderrSize += chunk.length
      while (stderrSize > STDERR_TAIL_BYTES * 2 && stderrChunks.length > 1) {
        const dropped = stderrChunks.shift()!
        stderrSize -= dropped.length
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      resolve({
        ok: false,
        message: `Subprocess error: ${err.message}`,
        exitCode: null,
        durationMs: Date.now() - start,
        stderrTail: tailOf(stderrChunks)
      })
    })

    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort)
      const durationMs = Date.now() - start
      const stderrTail = tailOf(stderrChunks)

      if (timedOut) {
        resolve({
          ok: false,
          message: `Auth flow timed out after ${(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s.`,
          exitCode: code,
          durationMs,
          stderrTail
        })
        return
      }
      if (signal === 'SIGTERM' || signal === 'SIGINT') {
        resolve({
          ok: false,
          message: 'Auth flow cancelled.',
          exitCode: null,
          durationMs,
          stderrTail
        })
        return
      }
      if (code === 0) {
        resolve({
          ok: true,
          message: 'Authenticated.',
          exitCode: 0,
          durationMs,
          stderrTail
        })
        return
      }
      resolve({
        ok: false,
        message: `mcp-remote-client exited with code ${code ?? '?'}.`,
        exitCode: code,
        durationMs,
        stderrTail
      })
    })
  })
}

export async function clearAuthFor(
  url: string,
  headers?: Record<string, string>
): Promise<{ deleted: number; hash: string }> {
  const hash = mcpUrlHash(url, undefined, headers)
  const deleted = await clearAuthForHash(hash)
  return { deleted, hash }
}

function tailOf(chunks: Buffer[]): string {
  if (chunks.length === 0) return ''
  const buf = Buffer.concat(chunks)
  const slice = buf.slice(Math.max(0, buf.length - STDERR_TAIL_BYTES))
  return slice.toString('utf8')
}

async function hasNpx(): Promise<boolean> {
  return new Promise((resolve) => {
    const check = spawn('npx', ['--version'], { stdio: 'ignore' })
    check.on('error', () => resolve(false))
    check.on('close', (code) => resolve(code === 0))
  })
}
