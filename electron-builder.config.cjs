// electron-builder config — produces a macOS .app + .dmg without code signing.
// Built artifacts land in ./release/.
//
// To install: open the .dmg, drag MCP Passport into /Applications.
// Because the build is unsigned, macOS Gatekeeper will block first launch.
// Either right-click → Open (then Open in the dialog), or run:
//   xattr -cr "/Applications/MCP Passport.app"

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

  mac: {
    category: 'public.app-category.developer-tools',
    icon: 'build/icon.icns',
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ],
    // Skip signing & notarization — works for personal use, Gatekeeper warns once.
    identity: null,
    hardenedRuntime: false,
    gatekeeperAssess: false
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
