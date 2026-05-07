import { contextBridge, ipcRenderer } from 'electron'
import type {
  PassportApi,
  ScanResult,
  SyncRequest,
  SyncOutcome,
  ToolId,
  Scope,
  LibraryMcpInput,
  LibrarySkillInput,
  ItemKind,
  RegistryCatalog,
  ExportPlan,
  ExportRunRequest,
  ExportRunResult,
  ImportPlan,
  ImportPlanRequest,
  ImportApplyRequest,
  ImportApplyResult,
  McpAuthRunRequest,
  McpAuthRunResult,
  McpAuthClearRequest,
  McpFillSecretsRequest,
  McpFillSecretsResult
} from '../shared/types'

const api: PassportApi = {
  scan: () => ipcRenderer.invoke('passport:scan') as Promise<ScanResult>,
  sync: (req: SyncRequest) =>
    ipcRenderer.invoke('passport:sync', req) as Promise<SyncOutcome[]>,
  openInFinder: (path: string) => ipcRenderer.invoke('passport:open-finder', path) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke('passport:open-external', url) as Promise<void>,
  readFileText: (path: string) => ipcRenderer.invoke('passport:read-file', path) as Promise<string>,
  removeItem: (itemId: string, toolId: ToolId, scope: Scope, projectPath?: string) =>
    ipcRenderer.invoke('passport:remove', { itemId, toolId, scope, projectPath }) as Promise<{
      ok: boolean
      message: string
    }>,
  libraryAddMcp: (input: LibraryMcpInput) =>
    ipcRenderer.invoke('passport:library:add-mcp', input) as Promise<{
      ok: boolean
      message: string
    }>,
  libraryAddSkill: (input: LibrarySkillInput) =>
    ipcRenderer.invoke('passport:library:add-skill', input) as Promise<{
      ok: boolean
      message: string
    }>,
  libraryAddSkillFromPath: (name: string, srcDir: string) =>
    ipcRenderer.invoke('passport:library:add-skill-from-path', { name, srcDir }) as Promise<{
      ok: boolean
      message: string
    }>,
  libraryRemove: (kind: ItemKind, name: string) =>
    ipcRenderer.invoke('passport:library:remove', { kind, name }) as Promise<{
      ok: boolean
      message: string
    }>,
  registryList: () => ipcRenderer.invoke('passport:registry:list') as Promise<RegistryCatalog>,
  registrySearch: (query: string, kind: ItemKind, options) =>
    ipcRenderer.invoke('passport:registry:search', {
      query,
      kind,
      bypassCache: options?.bypassCache
    }) as Promise<RegistryCatalog>,
  registryAddToLibrary: (entry) =>
    ipcRenderer.invoke('passport:registry:add', entry) as Promise<{
      ok: boolean
      message: string
    }>,
  registryClearCache: () =>
    ipcRenderer.invoke('passport:registry:clear-cache') as Promise<{
      ok: boolean
      message: string
    }>,
  exportPlan: () => ipcRenderer.invoke('passport:export:plan') as Promise<ExportPlan>,
  exportRun: (req: ExportRunRequest) =>
    ipcRenderer.invoke('passport:export:run', req) as Promise<ExportRunResult>,
  importPickFile: () =>
    ipcRenderer.invoke('passport:import:pick-file') as Promise<string | null>,
  importPlan: (req: ImportPlanRequest) =>
    ipcRenderer.invoke('passport:import:plan', req) as Promise<ImportPlan>,
  importApply: (req: ImportApplyRequest) =>
    ipcRenderer.invoke('passport:import:apply', req) as Promise<ImportApplyResult>,
  mcpAuthRun: (req: McpAuthRunRequest) =>
    ipcRenderer.invoke('passport:mcp-auth:run', req) as Promise<McpAuthRunResult>,
  mcpAuthCancel: (url: string) =>
    ipcRenderer.invoke('passport:mcp-auth:cancel', url) as Promise<{ ok: boolean; message: string }>,
  mcpAuthClear: (req: McpAuthClearRequest) =>
    ipcRenderer.invoke('passport:mcp-auth:clear', req) as Promise<{ ok: boolean; message: string }>,
  mcpFillSecrets: (req: McpFillSecretsRequest) =>
    ipcRenderer.invoke('passport:mcp:fill-secrets', req) as Promise<McpFillSecretsResult>
}

contextBridge.exposeInMainWorld('api', api)
