// Detection adapter for ~/.mcp-auth (mcp-remote's OAuth cache).
//
// Real layout (per https://github.com/geelen/mcp-remote/blob/main/src/lib/mcp-auth-config.ts):
//
//   ~/.mcp-auth/
//     mcp-remote-{VERSION}/                       ← versioned subdir; one per installed mcp-remote
//       {server_url_hash}_tokens.json
//       {server_url_hash}_client_info.json
//       {server_url_hash}_code_verifier.txt
//       {server_url_hash}_lock.json
//       {server_url_hash}_debug.log
//
// We surface (a) which URL hashes have a tokens.json so the UI can flip a row
// to "Authed", and (b) the absolute file paths so we can bundle them into a
// .mcppassport export or wipe them on "Sign out".

import { promises as fs, Dirent } from 'fs'
import { join } from 'path'
import { paths } from '../paths'
import { pathExists } from '../util'

async function safeReaddir(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

export interface AuthCacheEntry {
  /** md5 hash of the URL + optional headers, as computed by mcp-remote. */
  urlHash: string
  /** mcp-remote version subdir name, e.g. "mcp-remote-0.1.38". */
  version: string
  /** Absolute paths to every file belonging to this hash, across all version subdirs. */
  files: string[]
  /** True if a {hash}_tokens.json file exists — i.e. the OAuth flow completed. */
  hasTokens: boolean
}

/**
 * Walk every `mcp-remote-*` subdir under ~/.mcp-auth and collect cache entries
 * grouped by serverUrlHash. A single hash may have multiple files (tokens,
 * client_info, code_verifier, lock); they're all returned together.
 *
 * `rootDir` defaults to `paths.mcpAuthDir`; the override is for fixture tests.
 */
export async function listAuthCaches(rootDir: string = paths.mcpAuthDir): Promise<AuthCacheEntry[]> {
  if (!(await pathExists(rootDir))) return []

  const versions = await safeReaddir(rootDir)
  const byHash = new Map<string, AuthCacheEntry>()

  for (const v of versions) {
    if (!v.isDirectory() || !v.name.startsWith('mcp-remote-')) continue
    const versionDir = join(rootDir, v.name)
    const files = await safeReaddir(versionDir)
    for (const f of files) {
      if (!f.isFile()) continue
      // {hash}_{filename}, where hash is the prefix up to the first underscore
      const underscore = f.name.indexOf('_')
      if (underscore < 1) continue
      const hash = f.name.slice(0, underscore)
      const tail = f.name.slice(underscore + 1)
      const fullPath = join(versionDir, f.name)

      const entry = byHash.get(hash) ?? {
        urlHash: hash,
        version: v.name,
        files: [],
        hasTokens: false
      }
      entry.files.push(fullPath)
      if (tail === 'tokens.json') entry.hasTokens = true
      byHash.set(hash, entry)
    }
  }

  return [...byHash.values()]
}

/**
 * Returns just the set of url-hashes that have a tokens.json file. The scan
 * result uses this for the "Authed" pill — we don't need the full file list.
 */
export async function listAuthedUrlHashes(rootDir?: string): Promise<string[]> {
  const caches = await listAuthCaches(rootDir)
  return caches.filter((c) => c.hasTokens).map((c) => c.urlHash)
}

/**
 * Delete every file (tokens, client_info, code_verifier, lock, debug log)
 * associated with the given hash, across every mcp-remote-* version subdir.
 * Used by "Sign out / clear tokens".
 */
export async function clearAuthForHash(urlHash: string): Promise<number> {
  const caches = await listAuthCaches()
  let deleted = 0
  for (const entry of caches) {
    if (entry.urlHash !== urlHash) continue
    for (const f of entry.files) {
      try {
        await fs.unlink(f)
        deleted++
      } catch {
        // ignore — file may already be gone
      }
    }
  }
  return deleted
}
