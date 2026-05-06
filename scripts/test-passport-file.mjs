// Smoke test for src/main/passportFile.ts — round-trip + tamper detection.
// Run with: node --experimental-strip-types scripts/test-passport-file.mjs
//
// Verifies:
//   1. Round-trip of a sample ExportBundle with skill files (base64).
//   2. Wrong passphrase fails with a clear error.
//   3. Tampered ciphertext byte → decryption fails.
//   4. Tampered KDF param in the header → decryption fails (AAD binding works).
//   5. Bad magic / truncated file → decryption fails.

import assert from 'node:assert/strict'
import { encryptBundle, decryptBundle, bundleToBytes, bytesToBundle } from '../src/main/passportFile.ts'

const PASS = 'correct horse battery staple'
const WRONG = 'Tr0ub4dor&3'

const sample = {
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  originOS: process.platform,
  originHost: 'test-host',
  appVersion: '0.1.0',
  includesSecrets: true,
  items: [
    {
      id: 'lib-mcp:slack',
      kind: 'library-mcp',
      name: 'slack',
      canonical: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-slack'],
        env: { SLACK_BOT_TOKEN: 'xoxb-test-secret' }
      }
    },
    {
      id: 'lib-skill:my-skill',
      kind: 'library-skill',
      name: 'my-skill',
      files: {
        'SKILL.md': Buffer.from('---\nname: my-skill\n---\nHello.\n').toString('base64'),
        'reference.md': Buffer.from('Some reference').toString('base64')
      }
    }
  ]
}

function header(label) {
  console.log(`\n— ${label}`)
}

let pass = 0
let fail = 0
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ok  ${label}${detail ? ' — ' + detail : ''}`)
    pass++
  } else {
    console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`)
    fail++
  }
}

// 1. Round-trip
header('round-trip')
const t0 = performance.now()
const cipherBytes = encryptBundle(bundleToBytes(sample), PASS)
const tEnc = performance.now() - t0
check('encrypt produced non-empty buffer', cipherBytes.length > 100, `${cipherBytes.length} bytes`)
check('encrypt reasonably fast', tEnc < 2000, `${tEnc.toFixed(0)} ms`)

const t1 = performance.now()
const { plaintext, meta } = decryptBundle(cipherBytes, PASS)
const tDec = performance.now() - t1
check('decrypt with correct passphrase succeeds', !!plaintext)
check('schemaVersion exposed', meta.schemaVersion === 1)
check('scrypt N exposed', meta.scrypt.N === 1 << 17)
check('decrypt reasonably fast', tDec < 2000, `${tDec.toFixed(0)} ms`)

const round = bytesToBundle(plaintext)
check('round-trip preserves item count', round.items.length === sample.items.length)
check('round-trip preserves env secret', round.items[0].canonical.env.SLACK_BOT_TOKEN === 'xoxb-test-secret')
check('round-trip preserves base64 file', round.items[1].files['SKILL.md'] === sample.items[1].files['SKILL.md'])

// 2. Wrong passphrase
header('wrong passphrase')
let threw = false
try { decryptBundle(cipherBytes, WRONG) } catch (e) { threw = true; check('error mentions passphrase', /passphrase|corrupted/i.test(e.message), e.message) }
check('wrong passphrase throws', threw)

// 3. Tampered ciphertext
header('tampered ciphertext')
const tampered = Buffer.from(cipherBytes)
tampered[100] ^= 0xff // flip a byte mid-ciphertext
threw = false
try { decryptBundle(tampered, PASS) } catch { threw = true }
check('flipped ciphertext byte rejected', threw)

// 4. Tampered KDF param (header AAD binding)
header('tampered header (KDF param)')
const tampered2 = Buffer.from(cipherBytes)
tampered2.writeUInt32LE(1024, 16) // change scrypt N from 2^17 to 1024
threw = false
let errMsg = ''
try { decryptBundle(tampered2, PASS) } catch (e) { threw = true; errMsg = e.message }
check('header tampering rejected', threw, errMsg)

// 5. Bad magic
header('bad magic')
const wrong = Buffer.from(cipherBytes)
wrong[0] = 0
threw = false
try { decryptBundle(wrong, PASS) } catch (e) { threw = true; check('error mentions magic / not an export', /magic|export/i.test(e.message), e.message) }
check('bad magic rejected', threw)

// 6. Truncated
header('truncated')
const trunc = cipherBytes.subarray(0, 50)
threw = false
try { decryptBundle(trunc, PASS) } catch (e) { threw = true; check('error mentions size', /small/i.test(e.message), e.message) }
check('truncated rejected', threw)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
