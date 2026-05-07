// Keeps the version pill in index.html in sync with package.json's version.
//
// Wired into the `version` lifecycle script in package.json, so it runs
// automatically as part of `npm version <patch|minor|major>` — between the
// version bump and the commit/tag, so the updated index.html lands inside
// the same commit that npm creates.
//
// The pill is rendered "v<major>.<minor> — public" — we deliberately drop
// the patch number on the landing page (marketing-friendly format).
// If the pill text changes (e.g. you switch back to "private beta"),
// update the regex and TARGET_SUFFIX below.

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const TARGET_SUFFIX = ' — public'
const PILL_REGEX = /v\d+\.\d+ — public/

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(here)
const landingPath = join(repoRoot, 'index.html')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

const [major, minor] = pkg.version.split('.')
const wantedPill = `v${major}.${minor}${TARGET_SUFFIX}`

const html = readFileSync(landingPath, 'utf8')

if (!PILL_REGEX.test(html)) {
  console.error(
    `[sync-landing-version] Couldn't find a "vX.Y${TARGET_SUFFIX}" pill in index.html — refusing to write.\n` +
      `If the pill text changed, update PILL_REGEX / TARGET_SUFFIX in scripts/sync-landing-version.mjs.`
  )
  process.exit(1)
}

if (html.includes(wantedPill) && html.match(PILL_REGEX)?.[0] === wantedPill) {
  console.log(`[sync-landing-version] Pill already at ${wantedPill}, no change.`)
  process.exit(0)
}

writeFileSync(landingPath, html.replace(PILL_REGEX, wantedPill), 'utf8')
console.log(`[sync-landing-version] Updated landing pill → ${wantedPill}`)
