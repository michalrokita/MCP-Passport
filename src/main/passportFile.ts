// .mcppassport file format — encrypt/decrypt a JSON bundle with a user passphrase.
//
// On-disk layout (all integers little-endian):
//   off  size  field
//   0    8     magic "MCPPASS\x01"
//   8    4     schemaVersion (u32)
//   12   4     kdfId         (u32) — 1 = scrypt
//   16   4     scrypt N
//   20   4     scrypt r
//   24   4     scrypt p
//   28   4     scrypt keylen
//   32   32    salt
//   64   12    AES-GCM IV
//   76   …     ciphertext
//   end-16 16  AES-GCM auth tag
//
// The full 76-byte header is bound to the ciphertext as AAD, so an attacker who
// flips e.g. the scrypt N down to 1 gets a tag mismatch on decryption.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { Buffer } from 'buffer'

const MAGIC = Buffer.from('MCPPASS\x01', 'binary')
export const SCHEMA_VERSION = 1
const KDF_SCRYPT = 1

// Tuned for ~250ms on a 2024 MacBook. ~134 MB of memory during derivation,
// well within the maxmem we set explicitly below (default would reject this).
const SCRYPT_N = 1 << 17
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_MAXMEM = 256 * 1024 * 1024

const KEY_LEN = 32
const SALT_LEN = 32
const IV_LEN = 12
const TAG_LEN = 16
const HEADER_LEN = 8 + 4 + 4 + 4 + 4 + 4 + 4 + SALT_LEN + IV_LEN // = 76

export const PASSPORT_FILE_EXT = '.mcppassport'

export interface PassportFileMeta {
  schemaVersion: number
  kdfId: number
  scrypt: { N: number; r: number; p: number; keylen: number }
}

export function encryptBundle(plaintext: Buffer | Uint8Array, passphrase: string): Buffer {
  if (!passphrase) throw new Error('Passphrase required')
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const header = buildHeader(salt, iv, SCRYPT_N, SCRYPT_R, SCRYPT_P, KEY_LEN)
  const key = scryptSync(passphrase, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM
  })
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(header)
  const pt = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext)
  const ct = Buffer.concat([cipher.update(pt), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([header, ct, tag])
}

export function decryptBundle(
  bytes: Buffer | Uint8Array,
  passphrase: string
): { plaintext: Buffer; meta: PassportFileMeta } {
  if (!passphrase) throw new Error('Passphrase required')
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (buf.length < HEADER_LEN + TAG_LEN) {
    throw new Error('File too small to be an MCP Passport export')
  }
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Not an MCP Passport export file (bad magic)')
  }
  const schemaVersion = buf.readUInt32LE(8)
  if (schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schema version ${schemaVersion} (this build supports ${SCHEMA_VERSION})`
    )
  }
  const kdfId = buf.readUInt32LE(12)
  if (kdfId !== KDF_SCRYPT) throw new Error(`Unsupported KDF id ${kdfId}`)
  const N = buf.readUInt32LE(16)
  const r = buf.readUInt32LE(20)
  const p = buf.readUInt32LE(24)
  const keylen = buf.readUInt32LE(28)
  if (keylen !== KEY_LEN) throw new Error(`Unsupported key length ${keylen}`)

  const salt = buf.subarray(32, 32 + SALT_LEN)
  const iv = buf.subarray(32 + SALT_LEN, 32 + SALT_LEN + IV_LEN)
  const header = buf.subarray(0, HEADER_LEN)
  const tag = buf.subarray(buf.length - TAG_LEN)
  const ciphertext = buf.subarray(HEADER_LEN, buf.length - TAG_LEN)

  const key = scryptSync(passphrase, salt, keylen, { N, r, p, maxmem: SCRYPT_MAXMEM })
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(header)
  decipher.setAuthTag(tag)
  let plaintext: Buffer
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new Error('Decryption failed — wrong passphrase or corrupted file')
  }
  return {
    plaintext,
    meta: { schemaVersion, kdfId, scrypt: { N, r, p, keylen } }
  }
}

function buildHeader(
  salt: Buffer,
  iv: Buffer,
  N: number,
  r: number,
  p: number,
  keylen: number
): Buffer {
  const h = Buffer.alloc(HEADER_LEN)
  MAGIC.copy(h, 0)
  h.writeUInt32LE(SCHEMA_VERSION, 8)
  h.writeUInt32LE(KDF_SCRYPT, 12)
  h.writeUInt32LE(N, 16)
  h.writeUInt32LE(r, 20)
  h.writeUInt32LE(p, 24)
  h.writeUInt32LE(keylen, 28)
  salt.copy(h, 32)
  iv.copy(h, 32 + SALT_LEN)
  return h
}

// Bundle <-> bytes helpers. Kept here so the smoke test and the main process
// agree on encoding (UTF-8 JSON).
export function bundleToBytes(bundle: unknown): Buffer {
  return Buffer.from(JSON.stringify(bundle), 'utf8')
}

export function bytesToBundle<T = unknown>(bytes: Buffer): T {
  return JSON.parse(bytes.toString('utf8')) as T
}
