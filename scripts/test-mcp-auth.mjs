// Verify mcp-auth detection + url-hash parity with mcp-remote.
//
// Run via:  npx tsx scripts/test-mcp-auth.mjs
//
// What this checks:
//  1. mcpUrlHash() returns md5(url) for the simple no-headers case, matching
//     getServerUrlHash from mcp-remote/src/lib/utils.ts.
//  2. listAuthCaches() walks a fixture mcp-remote-* version subdir, groups
//     files by hash prefix, and reports hasTokens correctly.

import crypto from 'crypto'
import { promises as fs } from 'fs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { mcpUrlHash } from '../src/main/mcpUrlHash.ts'
import { listAuthCaches, listAuthedUrlHashes } from '../src/main/adapters/mcpAuth.ts'

let failures = 0
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok  ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('--- mcpUrlHash parity ---')
{
  const url = 'https://mcp.notion.com/sse'
  const expected = crypto.createHash('md5').update(url).digest('hex')
  check('md5(url) matches Node crypto', mcpUrlHash(url) === expected, `got ${mcpUrlHash(url)}, want ${expected}`)
}
{
  const url = 'https://mcp.example.com/mcp'
  const expected = crypto
    .createHash('md5')
    .update(`${url}|{"X-Custom":"v"}`)
    .digest('hex')
  check(
    'with headers: md5(url + "|" + sortedJSON)',
    mcpUrlHash(url, undefined, { 'X-Custom': 'v' }) === expected,
    `got ${mcpUrlHash(url, undefined, { 'X-Custom': 'v' })}, want ${expected}`
  )
}

console.log('\n--- listAuthCaches against fixture ---')
{
  // Build a fake ~/.mcp-auth in a temp dir, then point the adapter at it via
  // env var override — the adapter reads paths.mcpAuthDir from os.homedir(), so
  // we override HOME for this test.
  const tmpRoot = mkdtempSync(join(tmpdir(), 'mcp-auth-test-'))
  const authDir = join(tmpRoot, '.mcp-auth')
  const versionDir = join(authDir, 'mcp-remote-0.1.38')
  await fs.mkdir(versionDir, { recursive: true })
  // Two URLs: one with tokens, one without.
  const hashA = mcpUrlHash('https://a.example.com/sse')
  const hashB = mcpUrlHash('https://b.example.com/sse')
  await fs.writeFile(join(versionDir, `${hashA}_tokens.json`), '{}')
  await fs.writeFile(join(versionDir, `${hashA}_client_info.json`), '{}')
  await fs.writeFile(join(versionDir, `${hashB}_client_info.json`), '{}')
  // Drop a junk file too — should be ignored.
  await fs.writeFile(join(authDir, 'random.txt'), 'noise')

  const caches = await listAuthCaches(authDir)
  check('found two cache entries', caches.length === 2, `got ${caches.length}`)
  const a = caches.find((c) => c.urlHash === hashA)
  const b = caches.find((c) => c.urlHash === hashB)
  check('hashA hasTokens', !!a && a.hasTokens === true)
  check('hashB hasTokens=false (no tokens.json)', !!b && b.hasTokens === false)
  check('hashA has 2 files', !!a && a.files.length === 2)
  check('version subdir captured', !!a && a.version === 'mcp-remote-0.1.38')

  const authed = await listAuthedUrlHashes(authDir)
  check('listAuthedUrlHashes returns only token-bearing hashes', authed.length === 1 && authed[0] === hashA)

  await fs.rm(tmpRoot, { recursive: true, force: true })
}

console.log()
if (failures === 0) {
  console.log('All checks passed.')
  process.exit(0)
} else {
  console.log(`${failures} check(s) failed.`)
  process.exit(1)
}
