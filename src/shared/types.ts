// Shared types between main and renderer.

export type ToolId =
  | 'passport'
  | 'claude-desktop'
  | 'claude-code'
  | 'codex-cli'
  | 'codex-desktop'

export type ItemKind = 'mcp' | 'skill' | 'plugin' | 'agent'

export type Scope = 'global' | 'project'

export interface ToolPresence {
  id: ToolId
  name: string
  family: 'claude' | 'codex'
  surface: 'cli' | 'desktop'
  installed: boolean
  installNotes?: string
  configPaths: { label: string; path: string; exists: boolean }[]
  authStatus: 'unknown' | 'authenticated' | 'not_signed_in'
  warnings?: string[]
}

// Canonical MCP server — the lingua franca for cross-tool sync.
export type McpTransport = 'stdio' | 'http' | 'sse'

export interface CanonicalMcp {
  transport: McpTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  // Codex-only fields preserved on round-trip.
  bearer_token_env_var?: string
  env_http_headers?: Record<string, string>
  env_vars?: string[]
  enabled?: boolean
}

export interface ProjectInfo {
  path: string
  label: string
}

export interface InventoryItem {
  id: string // stable id derived from kind+name
  kind: ItemKind
  name: string
  description?: string
  // What tool+scope each presence is in
  presences: ItemPresence[]
}

export interface ItemPresence {
  toolId: ToolId
  scope: Scope
  projectPath?: string
  enabled?: boolean
  source: ItemSource
}

export type ItemSource =
  | {
      kind: 'mcp'
      canonical: CanonicalMcp
      raw: unknown
      locator: McpLocator
      /**
       * md5 hash of `canonical.url` (matches mcp-remote's getServerUrlHash).
       * Set during scan when the MCP has a URL; absent for stdio MCPs.
       * Renderer matches against ScanResult.authedServerHashes.
       */
      urlHash?: string
    }
  | { kind: 'skill'; path: string; frontmatter: Record<string, unknown> }
  | {
      kind: 'plugin'
      marketplace?: string
      installPath?: string
      version?: string
      enabled: boolean
    }
  | { kind: 'agent'; path: string; frontmatter: Record<string, unknown> }

// Where an MCP definition lives so we can update/delete it.
export type McpLocator =
  | { kind: 'claude-desktop' } // single config file
  | { kind: 'claude-code-user' } // ~/.claude.json mcpServers
  | { kind: 'claude-code-project'; projectPath: string } // .mcp.json in repo
  | { kind: 'codex' } // ~/.codex/config.toml [mcp_servers.X]
  | { kind: 'passport-library' } // local library inside MCP Passport

export interface ScanResult {
  scannedAt: string
  tools: ToolPresence[]
  items: InventoryItem[]
  projects: ProjectInfo[]
  // md5 hashes of MCP URLs for which mcp-remote has cached OAuth tokens
  // (i.e. a `{hash}_tokens.json` exists in `~/.mcp-auth/mcp-remote-VERSION/`).
  // The renderer computes the same hash for each MCP's URL and matches.
  authedServerHashes: string[]
}

export interface SyncSource {
  itemId: string
  fromToolId: ToolId
  fromScope: Scope
  fromProjectPath?: string
}

export interface SyncTarget {
  toolId: ToolId
  scope: Scope
  projectPath?: string
}

export interface SyncRequest {
  source: SyncSource
  targets: SyncTarget[]
  // Whether to also copy env vars (true by default).
  includeEnv?: boolean
}

export interface SyncOutcome {
  target: SyncTarget
  ok: boolean
  message: string
  diffSummary?: string
}

export interface ApiError {
  message: string
  detail?: string
}

declare global {
  interface Window {
    api: PassportApi
  }
}

export interface LibraryMcpInput {
  name: string
  description?: string
  canonical: CanonicalMcp
}

export interface LibrarySkillInput {
  name: string
  description?: string
  body: string // SKILL.md body (the main markdown content, frontmatter we'll generate)
  whenToUse?: string
  allowedTools?: string
}

export type RegistryCategory =
  | 'productivity'
  | 'dev-tools'
  | 'database'
  | 'search-web'
  | 'browser'
  | 'cloud'
  | 'monitoring'
  | 'files'
  | 'ai-vector'
  | 'communication'
  | 'memory'
  | 'finance'
  | 'design'
  | 'other'

export interface RegistryEntry {
  id: string
  kind: 'mcp' | 'skill'
  name: string
  description: string
  publisher?: string
  homepage?: string
  // human-readable source (e.g. "modelcontextprotocol.io", "anthropics/skills", "curated")
  source?: string
  // Auto-classified category for filter chips.
  category?: RegistryCategory
  // For MCP entries
  canonical?: CanonicalMcp
  envVars?: { name: string; description?: string; required?: boolean }[]
  // For skill entries
  body?: string
  tags?: string[]
}

export interface RegistryCatalog {
  fetchedAt: string
  entries: RegistryEntry[]
  source: 'bundled' | 'url' | 'cache'
  url?: string
  // Optional cache metadata for the renderer to surface "cached N min ago".
  cache?: {
    fromCache: boolean
    ageMs: number
    fresh: boolean
  }
  // Per-source status pills, populated when the search runs against multiple registries.
  sources?: { name: string; status: 'ok' | 'fail' | 'skipped'; count: number }[]
}

export interface RegistrySearchOptions {
  bypassCache?: boolean
}

export interface PassportApi {
  scan: () => Promise<ScanResult>
  sync: (req: SyncRequest) => Promise<SyncOutcome[]>
  openInFinder: (path: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  readFileText: (path: string) => Promise<string>
  removeItem: (
    itemId: string,
    toolId: ToolId,
    scope: Scope,
    projectPath?: string
  ) => Promise<{ ok: boolean; message: string }>

  // Library management
  libraryAddMcp: (input: LibraryMcpInput) => Promise<{ ok: boolean; message: string }>
  libraryAddSkill: (input: LibrarySkillInput) => Promise<{ ok: boolean; message: string }>
  libraryRemove: (kind: ItemKind, name: string) => Promise<{ ok: boolean; message: string }>

  // Registry / store
  registryList: () => Promise<RegistryCatalog>
  registrySearch: (
    query: string,
    kind: ItemKind,
    options?: RegistrySearchOptions
  ) => Promise<RegistryCatalog>
  registryAddToLibrary: (entry: RegistryEntry) => Promise<{ ok: boolean; message: string }>
  registryClearCache: () => Promise<{ ok: boolean; message: string }>

  // Encrypted export / import
  exportPlan: () => Promise<ExportPlan>
  exportRun: (req: ExportRunRequest) => Promise<ExportRunResult>
  importPickFile: () => Promise<string | null>
  importPlan: (req: ImportPlanRequest) => Promise<ImportPlan>
  importApply: (req: ImportApplyRequest) => Promise<ImportApplyResult>

  // Auth flows for remote MCPs (mcp-remote-client wrapper)
  mcpAuthRun: (req: McpAuthRunRequest) => Promise<McpAuthRunResult>
  mcpAuthCancel: (url: string) => Promise<{ ok: boolean; message: string }>
  mcpAuthClear: (req: McpAuthClearRequest) => Promise<{ ok: boolean; message: string }>

  // Fill in env-var / header secrets for an MCP and propagate to all tools that have it.
  mcpFillSecrets: (req: McpFillSecretsRequest) => Promise<McpFillSecretsResult>
}

// === Auth flow ===

export interface McpAuthRunRequest {
  /** Full URL of the remote MCP (e.g. https://mcp.notion.com/sse). */
  url: string
  /** Optional headers passed through as `--header K:V` to mcp-remote-client. */
  headers?: Record<string, string>
}

export interface McpAuthRunResult {
  ok: boolean
  message: string
  /** Process exit code, or null if the spawn itself failed. */
  exitCode: number | null
  /** Wall-clock duration in ms. */
  durationMs?: number
  /** Last ~2 KB of stderr for the user-visible "View log" disclosure. */
  stderrTail?: string
}

export interface McpAuthClearRequest {
  url: string
  headers?: Record<string, string>
}

// === Fill secrets ===

export interface McpFillSecretsTarget {
  toolId: ToolId
  scope: Scope
  projectPath?: string
}

export interface McpFillSecretsRequest {
  /** MCP name (used to locate the entry in each tool's config). */
  name: string
  /** New env values: { ENV_KEY: "secret-value" }. Existing keys are overwritten. */
  env?: Record<string, string>
  /** New header values: { "Authorization": "Bearer …" }. */
  headers?: Record<string, string>
  /** Where to write. If omitted, writes to every tool/scope that already has this MCP. */
  targets?: McpFillSecretsTarget[]
}

export interface McpFillSecretsOutcome {
  target: McpFillSecretsTarget
  ok: boolean
  message: string
}

export interface McpFillSecretsResult {
  ok: boolean
  message: string
  outcomes: McpFillSecretsOutcome[]
}

// === Encrypted export / import ===

export type ExportItemKind =
  | 'library-mcp'
  | 'library-skill'
  | 'tool-mcp'
  | 'tool-skill'
  | 'mcp-auth'

// Stable id for an item in the bundle. Used for conflict resolution and
// to map user decisions back to items.
export type ExportItemId = string

// Lightweight metadata for a single exportable item (shown in the export UI).
export interface ExportItemDescriptor {
  id: ExportItemId
  kind: ExportItemKind
  name: string
  // Human-readable subtitle (e.g. "claude-desktop · global", "host: …", file count).
  subtitle?: string
  // Whether this item carries secrets (env, headers, OAuth tokens).
  hasSecrets: boolean
  // True if the item should be checked by default in the export UI.
  defaultIncluded: boolean
  // Approximate serialized size in bytes (best-effort, for UI hints).
  approxBytes?: number
  // Where the item lives. Tool-scoped items carry tool/scope/project; auth items carry the MCP URL.
  toolId?: ToolId
  scope?: Scope
  projectPath?: string
  /** For mcp-auth items: the full MCP URL the cached tokens belong to. */
  url?: string
}

export interface ExportPlan {
  generatedAt: string
  originOS: string
  originHost: string
  appVersion: string
  items: ExportItemDescriptor[]
}

export interface ExportRunRequest {
  passphrase: string
  // Item ids the user chose to export. Items not in this list are dropped.
  selectedIds: ExportItemId[]
  // If false, secret-bearing fields (env, headers) are stripped from MCPs and
  // mcp-auth items are excluded regardless of their selection state.
  includeSecrets: boolean
  // Where to write the file. If unset, the main process opens a Save dialog.
  destinationPath?: string
}

export interface ExportRunResult {
  ok: boolean
  message: string
  destinationPath?: string
  itemCount?: number
  fileBytes?: number
}

// === Bundle format (the JSON that's encrypted) ===

export interface ExportBundle {
  // 1: original (broken) host-keyed mcp-auth layout — read-only on import.
  // 2: url-keyed mcp-auth layout matching mcp-remote's real cache structure.
  schemaVersion: 1 | 2
  exportedAt: string
  originOS: string
  originHost: string
  appVersion: string
  // Whether secrets were included at export time. Imports use this to flag
  // items that need user-provided values (env vars stripped to names only).
  includesSecrets: boolean
  items: ExportItem[]
}

export type ExportItem =
  | ExportItemLibraryMcp
  | ExportItemLibrarySkill
  | ExportItemToolMcp
  | ExportItemToolSkill
  | ExportItemMcpAuth

export interface ExportItemLibraryMcp {
  id: ExportItemId
  kind: 'library-mcp'
  name: string
  description?: string
  canonical: CanonicalMcp
}

export interface ExportItemLibrarySkill {
  id: ExportItemId
  kind: 'library-skill'
  name: string
  // Map of relative-path → base64-encoded file contents.
  files: Record<string, string>
}

export interface ExportItemToolMcp {
  id: ExportItemId
  kind: 'tool-mcp'
  toolId: ToolId
  scope: Scope
  projectPath?: string
  name: string
  canonical: CanonicalMcp
}

export interface ExportItemToolSkill {
  id: ExportItemId
  kind: 'tool-skill'
  toolId: ToolId
  scope: Scope
  projectPath?: string
  name: string
  files: Record<string, string>
}

export interface ExportItemMcpAuth {
  id: ExportItemId
  kind: 'mcp-auth'
  // Schema v2: full server URL the OAuth tokens belong to. The hash is
  // recomputed on import using the local mcp-remote layout.
  url: string
  // mcp-remote version subdir the cache came from (e.g. "mcp-remote-0.1.38").
  // Informational; the importer always writes into the version it finds locally.
  fromVersion?: string
  // Map of file basename (e.g. "tokens.json", "client_info.json") → base64
  // contents. Filenames in the original cache are prefixed with the url-hash;
  // we strip that prefix here so the importer can re-prefix with its own hash.
  files: Record<string, string>
}

// === Import side ===

export type ConflictAction = 'skip' | 'overwrite' | 'keep-both'

export type ImportItemStatus =
  | 'new' // nothing at the destination
  | 'identical' // same content already present
  | 'conflict' // different content already present
  | 'protected' // mcp-auth host already present — never overwrite per policy

export interface ImportPlanItem {
  id: ExportItemId
  kind: ExportItemKind
  name: string
  subtitle?: string
  status: ImportItemStatus
  diffSummary?: string
  // Default action for this item — UI starts here.
  defaultAction: ConflictAction
  // For mcp-auth items, true means the host is already present locally and
  // the import will leave it untouched no matter what the user picks.
  protected?: boolean
}

export interface ImportPlanRequest {
  filePath: string
  passphrase: string
}

export interface ImportPlan {
  filePath: string
  exportedAt: string
  originOS: string
  originHost: string
  appVersion: string
  includesSecrets: boolean
  // True if the platform recorded in the bundle differs from the local OS.
  crossPlatform: boolean
  items: ImportPlanItem[]
}

export interface ImportApplyRequest {
  filePath: string
  passphrase: string
  // itemId → action. Missing ids default to 'skip'.
  decisions: Record<ExportItemId, ConflictAction>
}

export interface ImportApplyOutcome {
  id: ExportItemId
  name: string
  kind: ExportItemKind
  ok: boolean
  message: string
  action: ConflictAction | 'protected'
}

export interface ImportApplyResult {
  ok: boolean
  message: string
  outcomes: ImportApplyOutcome[]
}
