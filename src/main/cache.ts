// Disk-backed JSON cache. Files live under <userData>/cache/<namespace>/<key>.json.
// Falls back to ~/Library/Application Support/mcp-passport/cache outside Electron.

import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { homedir } from 'os'
import { join, dirname } from 'path'

interface CacheFile<T> {
  writtenAt: number
  ttlMs: number
  data: T
}

export interface CacheReadResult<T> {
  data: T
  writtenAt: number
  ageMs: number
  fresh: boolean
}

function userDataDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron')
    if (electron?.app?.getPath) return electron.app.getPath('userData')
  } catch {
    // ignore — non-Electron context
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'mcp-passport')
  }
  return join(homedir(), '.config', 'mcp-passport')
}

function cacheDir(namespace: string): string {
  return join(userDataDir(), 'cache', namespace)
}

function safeKey(key: string): string {
  // Stable filename: short prefix from the readable key + sha1 hash for collision-safety.
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/-+$/, '')
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 10)
  return `${slug || 'q'}-${hash}.json`
}

export async function read<T = unknown>(
  namespace: string,
  key: string,
  ttlMs: number
): Promise<CacheReadResult<T> | null> {
  const path = join(cacheDir(namespace), safeKey(key))
  try {
    const txt = await fs.readFile(path, 'utf8')
    const parsed = JSON.parse(txt) as CacheFile<T>
    if (!parsed?.data) return null
    const ageMs = Date.now() - parsed.writtenAt
    return {
      data: parsed.data,
      writtenAt: parsed.writtenAt,
      ageMs,
      fresh: ageMs < ttlMs
    }
  } catch {
    return null
  }
}

export async function write<T = unknown>(
  namespace: string,
  key: string,
  ttlMs: number,
  data: T
): Promise<void> {
  const path = join(cacheDir(namespace), safeKey(key))
  await fs.mkdir(dirname(path), { recursive: true })
  const file: CacheFile<T> = { writtenAt: Date.now(), ttlMs, data }
  const tmp = `${path}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(file), 'utf8')
  await fs.rename(tmp, path)
}

export async function clear(namespace?: string): Promise<void> {
  const dir = namespace ? cacheDir(namespace) : join(userDataDir(), 'cache')
  await fs.rm(dir, { recursive: true, force: true })
}

export async function stats(namespace?: string): Promise<{ files: number; bytes: number }> {
  const dir = namespace ? cacheDir(namespace) : join(userDataDir(), 'cache')
  let files = 0
  let bytes = 0
  async function walk(p: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(p, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(p, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.isFile()) {
        files++
        try {
          const st = await fs.stat(full)
          bytes += st.size
        } catch {
          // ignore
        }
      }
    }
  }
  await walk(dir)
  return { files, bytes }
}
