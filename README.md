# MCP Passport

One place to see, sync, and manage your MCP servers, skills, plugins, and agents
across **Claude Code**, **Claude Desktop**, **Codex CLI**, and **Codex Desktop**.

Save anything to your local library. Copy any item to any tool with one click.
Browse a live, searchable catalog of MCPs from
[modelcontextprotocol.io](https://registry.modelcontextprotocol.io),
[smithery.ai](https://smithery.ai), [glama.ai](https://glama.ai), and skills
from [`anthropics/skills`](https://github.com/anthropics/skills) +
[`openai/skills`](https://github.com/openai/skills).

---

## Download

**[Latest release for macOS (Apple Silicon) →](https://github.com/michalrokita/MCP-Passport/releases/latest/download/MCP-Passport-mac-arm64.dmg)**

Open the `.dmg`, drag MCP Passport into Applications, launch.

### About Gatekeeper

Until the project is enrolled in the [Apple Developer Program](https://developer.apple.com/programs/),
the download is **ad-hoc signed** rather than signed with a paid Developer ID.
That means macOS Gatekeeper will warn on first launch ("MCP Passport is damaged
and can't be opened"). The fix is one Terminal command:

```sh
xattr -cr "/Applications/MCP Passport.app"
```

That removes the `com.apple.quarantine` attribute Safari/Chrome stamps onto
downloaded files. After that the app launches normally — including auto-updates.

Once Apple Developer signing is set up (see [Signed releases](#signed-releases)
below), this step disappears.

### Older Macs (Intel)

There's no published Intel build right now — the project's user base is
Apple Silicon. If you need one, clone the repo and run `npm run dist:dir`; the
Intel `.app` lands in `release/mac/`.

---

## Develop

```sh
npm install
npm run dev          # opens the dev window with HMR
```

```sh
npm run typecheck    # TS for both main and renderer
npm run dist         # builds .dmg + .zip into ./release/
```

`npm run dist` produces an ad-hoc signed build by default. To produce a real
signed/notarized build locally, set the [signing env vars](#signed-releases) and
run the same command.

---

## Release

Releases are tag-driven. To cut `v0.1.0`:

```sh
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml))
runs on `macos-latest`, builds, signs (if certs are configured), notarizes (if
Apple credentials are configured), and uploads the `.dmg` and `.zip` to a
GitHub Release.

The website always-latest download link uses the
[`releases/latest/download/...`](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)
URL pattern, so it stays valid across releases without any redirect logic.

### Signed releases

Signing is fully wired — it just needs five GitHub Secrets to activate. Add
them under **Settings → Secrets and variables → Actions**:

| Secret | Source |
|---|---|
| `CSC_LINK` | base64-encoded `Developer ID Application` `.p12` certificate |
| `CSC_KEY_PASSWORD` | passphrase for the `.p12` |
| `APPLE_ID` | Apple ID email used in the Developer Program |
| `APPLE_APP_SPECIFIC_PASSWORD` | generated at [appleid.apple.com](https://appleid.apple.com/account/manage) |
| `APPLE_TEAM_ID` | 10-character Team ID from [developer.apple.com](https://developer.apple.com/account#MembershipDetailsCard) |

Encode the `.p12`:

```sh
base64 -i certificate.p12 | pbcopy   # paste into the CSC_LINK secret
```

Once the secrets exist, the next tag push produces a release that opens with no
warnings on any Mac. The `xattr` step above goes away.

Until then, [electron-builder](https://www.electron.build/) does ad-hoc signing
(`codesign -s -`) so the binary is structurally valid; only Gatekeeper's
quarantine check remains in the way.

---

## How it works

- **Adapters** in [`src/main/adapters/`](src/main/adapters/) read each tool's on-disk
  config:
  - Claude Code: `~/.claude.json` mcpServers, `~/.claude/skills/`,
    `~/.claude/agents/`, `~/.claude/plugins/installed_plugins.json`,
    plus per-project `.mcp.json` and `<project>/.claude/settings.json`
  - Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`
    *and* the live `remoteMcpServersConfig` array snapshotted in each Cowork
    session JSON, so cloud-managed MCPs (Linear, Sentry, BetterStack, …) appear
    too
  - Codex CLI / Desktop: `~/.codex/config.toml` `[mcp_servers.*]`,
    `[plugins."name@market"]`, `~/.codex/skills/.system/`, `~/.agents/skills/`
- **Sync** ([`src/main/sync.ts`](src/main/sync.ts)) translates between each
  tool's native format using a single canonical MCP shape.
- **Library** ([`src/main/adapters/passport.ts`](src/main/adapters/passport.ts))
  is the user's own collection at
  `~/Library/Application Support/mcp-passport/library/`.
- **Browse store** ([`src/main/registrySearch.ts`](src/main/registrySearch.ts))
  hits four registries in parallel with disk-cached stale-while-revalidate.

Built with Electron, Vite, React, TypeScript, Tailwind.

---

## License

MIT.
