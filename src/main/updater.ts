// Phase-1 update notifier.
//
// Polls the GitHub Releases API for the latest published release, compares it
// against the running app's version, and broadcasts an `update:status` IPC
// event to all renderers when something changes. There is intentionally no
// in-app install step yet — that requires Apple Developer signing so Squirrel
// can verify the downloaded bundle (see README "About Gatekeeper"). When
// signing lands, swap the body of `checkNow()` for `electron-updater` and the
// renderer side stays the same.
//
// Also handles the "What's new" flow: tracks `lastSeenVersion` in prefs, lets
// the renderer detect a post-upgrade launch and fetch release notes for any
// specific tag.
//
// User prefs persist to `<userData>/update-prefs.json`:
//   { autoCheck, skippedVersion, lastCheckedAt, lastSeenVersion }

import { app, BrowserWindow, net } from 'electron'
import { join } from 'path'
import { readJsonSafe, writeJsonAtomic } from './util'
import type {
  UpdateInfo,
  UpdatePrefs,
  UpdateCheckResult,
  UpdateStatusEvent,
  UpgradeInfo,
  ReleaseNotesResult
} from '../shared/types'

const REPO_API = 'https://api.github.com/repos/michalrokita/MCP-Passport'
const RELEASES_URL = `${REPO_API}/releases/latest`
const RELEASE_BY_TAG_URL = (tag: string): string =>
  `${REPO_API}/releases/tags/${encodeURIComponent(tag)}`

// Background poll cadence. Six hours is "polite" for a developer tool — users
// who want it sooner can hit "Check now" in the sidebar.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

// Small delay so the first check doesn't compete with startup work.
const FIRST_CHECK_DELAY_MS = 8 * 1000

let cachedAvailable: UpdateInfo | null = null
let timer: NodeJS.Timeout | null = null

function prefsPath(): string {
  return join(app.getPath('userData'), 'update-prefs.json')
}

async function readPrefs(): Promise<UpdatePrefs> {
  const raw = await readJsonSafe<Partial<UpdatePrefs>>(prefsPath())
  return {
    autoCheck: raw?.autoCheck ?? true,
    skippedVersion: raw?.skippedVersion ?? null,
    lastCheckedAt: raw?.lastCheckedAt ?? null,
    lastSeenVersion: raw?.lastSeenVersion ?? null
  }
}

/**
 * Read the raw prefs file *without* defaulting missing fields. Lets us tell
 * "fresh install (file doesn't exist)" apart from "upgraded from a version
 * that didn't have the lastSeenVersion field yet".
 */
async function readRawPrefs(): Promise<Partial<UpdatePrefs> | null> {
  return readJsonSafe<Partial<UpdatePrefs>>(prefsPath())
}

async function writePrefs(patch: Partial<UpdatePrefs>): Promise<UpdatePrefs> {
  const current = await readPrefs()
  const next: UpdatePrefs = { ...current, ...patch }
  await writeJsonAtomic(prefsPath(), next)
  return next
}

export async function getPrefs(): Promise<UpdatePrefs> {
  return readPrefs()
}

export async function setPrefs(patch: Partial<UpdatePrefs>): Promise<UpdatePrefs> {
  const next = await writePrefs(patch)

  // If the user just un-skipped a version (or any version), re-broadcast cached
  // status so the banner reappears without waiting for the next poll.
  if ('skippedVersion' in patch && cachedAvailable) {
    broadcast({
      hasUpdate: true,
      suppressed: next.skippedVersion === cachedAvailable.latestVersion,
      info: cachedAvailable
    })
  }
  return next
}

export function getCachedUpdate(): UpdateInfo | null {
  return cachedAvailable
}

export function getCurrentVersion(): string {
  return app.getVersion()
}

interface GithubRelease {
  tag_name: string
  name?: string
  html_url: string
  published_at: string
  prerelease?: boolean
  draft?: boolean
  body?: string
}

async function fetchLatestRelease(): Promise<GithubRelease | null> {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url: RELEASES_URL, redirect: 'follow' })
    req.setHeader('User-Agent', `MCP-Passport/${app.getVersion()}`)
    req.setHeader('Accept', 'application/vnd.github+json')

    req.on('response', (resp) => {
      const status = resp.statusCode ?? 0
      if (status === 404) {
        // No releases yet — treat as no update available rather than an error.
        resolve(null)
        return
      }
      if (status >= 400) {
        reject(new Error(`GitHub API responded ${status}`))
        return
      }
      const chunks: Buffer[] = []
      resp.on('data', (chunk) => chunks.push(chunk as Buffer))
      resp.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as GithubRelease)
        } catch (e) {
          reject(e)
        }
      })
      resp.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * Lexicographic-aware semver compare. Handles the common shapes we'll see
 * (`0.1.0`, `0.1.0-beta.2`, `1.0.0`). Returns negative if a<b, 0 if equal,
 * positive if a>b. Pre-release suffixes are treated as "less than" the same
 * version without one (e.g. `1.0.0-beta < 1.0.0`).
 */
function compareSemver(a: string, b: string): number {
  const [aMain, aPre] = stripV(a).split('-', 2)
  const [bMain, bPre] = stripV(b).split('-', 2)
  const aParts = aMain.split('.').map(Number)
  const bParts = bMain.split('.').map(Number)
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const x = Number.isFinite(aParts[i]) ? aParts[i] : 0
    const y = Number.isFinite(bParts[i]) ? bParts[i] : 0
    if (x !== y) return x - y
  }
  // Same major.minor.patch — pre-release loses to no-pre-release.
  if (!aPre && bPre) return 1
  if (aPre && !bPre) return -1
  if (aPre && bPre) return aPre < bPre ? -1 : aPre > bPre ? 1 : 0
  return 0
}

function stripV(v: string): string {
  return v.startsWith('v') ? v.slice(1) : v
}

function broadcast(evt: UpdateStatusEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:status', evt)
  }
}

export async function checkNow(opts?: { force?: boolean }): Promise<UpdateCheckResult> {
  try {
    const release = await fetchLatestRelease()
    await writePrefs({ lastCheckedAt: new Date().toISOString() })

    if (!release || release.draft) {
      cachedAvailable = null
      broadcast({ hasUpdate: false })
      return { ok: true, hasUpdate: false }
    }

    const current = app.getVersion()
    const latest = stripV(release.tag_name)

    if (compareSemver(latest, current) <= 0) {
      cachedAvailable = null
      broadcast({ hasUpdate: false })
      return { ok: true, hasUpdate: false, currentVersion: current, latestVersion: latest }
    }

    const info: UpdateInfo = {
      currentVersion: current,
      latestVersion: latest,
      releaseUrl: release.html_url,
      releaseName: release.name?.trim() ? release.name : `v${latest}`,
      publishedAt: release.published_at,
      releaseNotes: release.body ?? ''
    }
    cachedAvailable = info

    const prefs = await readPrefs()
    const suppressed = !opts?.force && prefs.skippedVersion === latest
    broadcast({ hasUpdate: true, suppressed, info })
    return { ok: true, hasUpdate: true, suppressed, info }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

/**
 * Detect whether the running app is a new install ("first launch ever") or
 * an upgrade from a prior version that did NOT match the current one.
 *
 * Logic:
 *  - No prefs file at all → fresh install. Skip the dialog (no notes are
 *    relevant; the user just got the app).
 *  - Prefs file exists with lastSeenVersion === current → already showed.
 *  - Prefs file exists, lastSeenVersion missing or != current → upgraded.
 *
 * The renderer is responsible for fetching the notes and calling
 * `markVersionSeen()` once the dialog is dismissed.
 */
export async function detectUpgrade(): Promise<UpgradeInfo> {
  const raw = await readRawPrefs()
  const current = app.getVersion()

  // Fresh install: no prefs file means this is the user's very first launch
  // (or they wiped userData). Either way, no upgrade story to tell.
  if (!raw) {
    return { upgraded: false, fromVersion: null, toVersion: current }
  }

  const last = raw.lastSeenVersion ?? null
  if (last === current) {
    return { upgraded: false, fromVersion: last, toVersion: current }
  }
  return { upgraded: true, fromVersion: last, toVersion: current }
}

/** Mark the running version as "seen" so detectUpgrade() returns false next time. */
export async function markVersionSeen(): Promise<UpdatePrefs> {
  return writePrefs({ lastSeenVersion: app.getVersion() })
}

/**
 * Fetch the GitHub release for an exact tag. Used by the post-install dialog
 * to surface release notes for the version the user just upgraded to.
 *
 * Accepts version with or without leading `v` ("0.3.0" or "v0.3.0").
 */
export async function getReleaseNotesForVersion(
  version: string
): Promise<ReleaseNotesResult> {
  try {
    const tag = version.startsWith('v') ? version : `v${version}`
    const release = await fetchReleaseByTag(tag)
    if (!release) {
      return { ok: false, message: `No release found for ${tag}.` }
    }
    return {
      ok: true,
      notes: release.body ?? '',
      releaseUrl: release.html_url,
      releaseName: release.name?.trim() ? release.name : tag,
      publishedAt: release.published_at
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

async function fetchReleaseByTag(tag: string): Promise<GithubRelease | null> {
  return new Promise((resolve, reject) => {
    const req = net.request({
      method: 'GET',
      url: RELEASE_BY_TAG_URL(tag),
      redirect: 'follow'
    })
    req.setHeader('User-Agent', `MCP-Passport/${app.getVersion()}`)
    req.setHeader('Accept', 'application/vnd.github+json')

    req.on('response', (resp) => {
      const status = resp.statusCode ?? 0
      if (status === 404) {
        resolve(null)
        return
      }
      if (status >= 400) {
        reject(new Error(`GitHub API responded ${status}`))
        return
      }
      const chunks: Buffer[] = []
      resp.on('data', (chunk) => chunks.push(chunk as Buffer))
      resp.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as GithubRelease)
        } catch (e) {
          reject(e)
        }
      })
      resp.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * Start the background poll loop. Reads prefs each tick so toggling autoCheck
 * takes effect without a restart. Safe to call multiple times — replaces any
 * existing timer.
 */
export function startBackgroundChecks(): void {
  const tick = async (): Promise<void> => {
    const prefs = await readPrefs()
    if (!prefs.autoCheck) return
    await checkNow().catch(() => undefined)
  }

  setTimeout(() => void tick(), FIRST_CHECK_DELAY_MS)
  if (timer) clearInterval(timer)
  timer = setInterval(() => void tick(), CHECK_INTERVAL_MS)
}
