// Detection-only adapter for ~/.mcp-auth (mcp-remote OAuth cache).
// We don't sync these — the OAuth flow regenerates them on first connect — but we
// surface them in the UI so the user can see which remote MCPs are already authenticated
// and clear stale tokens.

import { promises as fs } from 'fs'
import { join } from 'path'
import { paths } from '../paths'
import { pathExists } from '../util'

export interface AuthCacheEntry {
  host: string
  files: string[]
  hasTokens: boolean
}

export async function listAuthCaches(): Promise<AuthCacheEntry[]> {
  if (!(await pathExists(paths.mcpAuthDir))) return []
  const out: AuthCacheEntry[] = []
  let entries
  try {
    entries = await fs.readdir(paths.mcpAuthDir, { withFileTypes: true })
  } catch {
    return []
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const full = join(paths.mcpAuthDir, e.name)
    let files: string[] = []
    try {
      files = (await fs.readdir(full)).filter((f) => f.endsWith('.json'))
    } catch {
      continue
    }
    out.push({
      host: e.name.replace(/_/g, ':'),
      files: files.map((f) => join(full, f)),
      hasTokens: files.some((f) => /token|access|refresh/i.test(f))
    })
  }
  return out
}

export async function clearAuthCache(host: string): Promise<void> {
  const dir = join(paths.mcpAuthDir, host.replace(/:/g, '_'))
  await fs.rm(dir, { recursive: true, force: true })
}
