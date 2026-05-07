import { homedir } from 'os'
import { join } from 'path'

export const HOME = homedir()

export const paths = {
  // Claude Code (CLI)
  claudeCodeUserConfig: join(HOME, '.claude.json'),
  claudeCodeDir: join(HOME, '.claude'),
  claudeCodeUserSettings: join(HOME, '.claude', 'settings.json'),
  claudeCodeUserSkillsDir: join(HOME, '.claude', 'skills'),
  claudeCodeUserAgentsDir: join(HOME, '.claude', 'agents'),
  claudeCodeUserCommandsDir: join(HOME, '.claude', 'commands'),
  claudeCodePluginsInstalled: join(HOME, '.claude', 'plugins', 'installed_plugins.json'),
  claudeCodePluginsKnownMarketplaces: join(HOME, '.claude', 'plugins', 'known_marketplaces.json'),
  claudeCodePluginsCacheDir: join(HOME, '.claude', 'plugins', 'data'),

  // Claude Desktop
  claudeDesktopDir: join(HOME, 'Library', 'Application Support', 'Claude'),
  claudeDesktopConfig: join(
    HOME,
    'Library',
    'Application Support',
    'Claude',
    'claude_desktop_config.json'
  ),
  claudeDesktopAppConfig: join(HOME, 'Library', 'Application Support', 'Claude', 'config.json'),
  claudeDesktopExtensionsDir: join(HOME, 'Library', 'Application Support', 'Claude', 'Extensions'),
  claudeDesktopExtensionInstallations: join(
    HOME,
    'Library',
    'Application Support',
    'Claude',
    'extensions-installations.json'
  ),
  claudeDesktopExtensionsBlocklist: join(
    HOME,
    'Library',
    'Application Support',
    'Claude',
    'extensions-blocklist.json'
  ),
  claudeDesktopLocalAgentSessions: join(
    HOME,
    'Library',
    'Application Support',
    'Claude',
    'local-agent-mode-sessions'
  ),
  claudeDesktopApp: '/Applications/Claude.app',

  // Cursor (VS Code fork)
  cursorDir: join(HOME, '.cursor'),
  cursorUserMcpJson: join(HOME, '.cursor', 'mcp.json'),
  cursorUserSkillsDir: join(HOME, '.cursor', 'skills-cursor'),
  cursorWorkspaceStorage: join(
    HOME,
    'Library',
    'Application Support',
    'Cursor',
    'User',
    'workspaceStorage'
  ),
  cursorApp: '/Applications/Cursor.app',

  // Codex CLI / Desktop (shared)
  codexHome: join(HOME, '.codex'),
  codexConfig: join(HOME, '.codex', 'config.toml'),
  codexAuth: join(HOME, '.codex', 'auth.json'),
  codexSystemSkillsDir: join(HOME, '.codex', 'skills', '.system'),
  codexUserSkillsDir: join(HOME, '.agents', 'skills'),
  codexAgentsMd: join(HOME, '.codex', 'AGENTS.md'),

  // Codex Desktop electron storage
  codexDesktopDir: join(HOME, 'Library', 'Application Support', 'Codex'),
  codexDesktopApp: '/Applications/Codex.app',

  // Per-MCP OAuth (mcp-remote default)
  mcpAuthDir: join(HOME, '.mcp-auth')
}

export function projectClaudeDir(projectPath: string): string {
  return join(projectPath, '.claude')
}

export function projectClaudeMcpJson(projectPath: string): string {
  return join(projectPath, '.mcp.json')
}

export function projectClaudeSettings(projectPath: string): string {
  return join(projectPath, '.claude', 'settings.json')
}

export function projectClaudeSkillsDir(projectPath: string): string {
  return join(projectPath, '.claude', 'skills')
}

export function projectClaudeAgentsDir(projectPath: string): string {
  return join(projectPath, '.claude', 'agents')
}

export function projectCodexAgentsDir(projectPath: string): string {
  return join(projectPath, '.agents', 'skills')
}

export function projectCodexAgentsMd(projectPath: string): string {
  return join(projectPath, 'AGENTS.md')
}

export function projectCursorDir(projectPath: string): string {
  return join(projectPath, '.cursor')
}

export function projectCursorMcpJson(projectPath: string): string {
  return join(projectPath, '.cursor', 'mcp.json')
}

export function projectCursorSkillsDir(projectPath: string): string {
  return join(projectPath, '.cursor', 'skills-cursor')
}
