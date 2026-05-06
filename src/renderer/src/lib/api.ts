import type {
  ExportRunRequest,
  ImportApplyRequest,
  ImportPlanRequest,
  ScanResult,
  Scope,
  SyncRequest,
  ToolId
} from '../../../shared/types'

export const api = window.api

export async function scan(): Promise<ScanResult> {
  return api.scan()
}

export async function sync(req: SyncRequest) {
  return api.sync(req)
}

export async function openInFinder(path: string) {
  return api.openInFinder(path)
}

export async function openExternal(url: string) {
  return api.openExternal(url)
}

export async function removeItem(
  itemId: string,
  toolId: ToolId,
  scope: Scope,
  projectPath?: string
) {
  return api.removeItem(itemId, toolId, scope, projectPath)
}

export async function exportPlan() {
  return api.exportPlan()
}

export async function exportRun(req: ExportRunRequest) {
  return api.exportRun(req)
}

export async function importPickFile() {
  return api.importPickFile()
}

export async function importPlan(req: ImportPlanRequest) {
  return api.importPlan(req)
}

export async function importApply(req: ImportApplyRequest) {
  return api.importApply(req)
}
