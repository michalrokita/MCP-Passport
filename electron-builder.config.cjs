// electron-builder config.
//
// Local: `npm run dist` produces ./release/MCP-Passport-mac-arm64.dmg (and x64) signed
// ad-hoc. CI: GitHub Actions tags trigger `electron-builder --publish always`, which
// uploads to a GitHub Release. If signing secrets are configured (CSC_LINK,
// CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID),
// electron-builder signs with the Developer ID and notarizes via Apple. Without
// those secrets, the build still completes but is ad-hoc signed only — Gatekeeper
// will warn on download.

const { execSync } = require('child_process')
const path = require('path')

// Toggle real signing when env vars provided. CSC_LINK is the base64-encoded .p12.
const HAS_SIGNING_CERT = !!process.env.CSC_LINK
const HAS_NOTARIZE_CREDS =
  !!process.env.APPLE_ID &&
  !!process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  !!process.env.APPLE_TEAM_ID

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.mcppassport.app',
  productName: 'MCP Passport',
  copyright: 'MCP Passport contributors',

  directories: {
    output: 'release',
    buildResources: 'build'
  },

  files: ['out/**/*', 'package.json', '!**/*.map'],

  asar: true,

  // Stable filename so the website's download link doesn't break across versions.
  // ${arch} expands to "arm64" or "x64". We commit only the arm64 .dmg to git;
  // everything else is gitignored.
  artifactName: 'MCP-Passport-mac-${arch}.${ext}',

  // GitHub Releases as the distribution channel — `--publish always` in CI uploads
  // here. The website always-latest URL is built off this.
  publish: {
    provider: 'github',
    owner: 'michalrokita',
    repo: 'MCP-Passport'
  },

  mac: {
    category: 'public.app-category.developer-tools',
    icon: 'build/icon.icns',
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ],
    // When CSC_LINK is set in CI, let electron-builder sign with the Developer ID +
    // hardened runtime + notarize. Locally (no cert) we fall through to the
    // afterPack ad-hoc signer.
    identity: HAS_SIGNING_CERT ? undefined : null,
    hardenedRuntime: HAS_SIGNING_CERT,
    gatekeeperAssess: false,
    entitlements: HAS_SIGNING_CERT ? 'build/entitlements.mac.plist' : undefined,
    entitlementsInherit: HAS_SIGNING_CERT ? 'build/entitlements.mac.plist' : undefined,
    notarize: HAS_NOTARIZE_CREDS
      ? { teamId: process.env.APPLE_TEAM_ID }
      : false
  },

  // Local fallback: ad-hoc sign every binary inside the .app so Apple Silicon
  // doesn't kill it on launch. Skipped when a real signing cert is present in CI.
  afterPack: async (context) => {
    if (context.electronPlatformName !== 'darwin') return
    if (HAS_SIGNING_CERT) return // electron-builder will sign properly
    const appName = `${context.packager.appInfo.productFilename}.app`
    const appPath = path.join(context.appOutDir, appName)
    execSync(`codesign --deep --force --sign - "${appPath}"`, { stdio: 'inherit' })
    console.log(`Ad-hoc signed: ${appPath}`)
  },

  dmg: {
    title: 'MCP Passport ${version}',
    icon: 'build/icon.icns',
    contents: [
      { x: 130, y: 220, type: 'file' },
      { x: 410, y: 220, type: 'link', path: '/Applications' }
    ],
    window: { width: 540, height: 380 }
  }
}
