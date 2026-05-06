import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { hostname } from 'os'
import { readFile, writeFile } from 'fs/promises'
import { scanAll } from './scanner'
import { syncItem } from './sync'
import { removeItemFromTool } from './remove'
import * as passport from './adapters/passport'
import * as registry from './registry'
import { searchRemote, clearSearchCache } from './registrySearch'
import { planExport, buildBundle } from './exportBundle'
import { applyImport, planImport } from './importBundle'
import {
  encryptBundle,
  bundleToBytes,
  PASSPORT_FILE_EXT
} from './passportFile'
import type {
  SyncRequest,
  LibraryMcpInput,
  LibrarySkillInput,
  ItemKind,
  RegistryEntry,
  ExportRunRequest,
  ImportPlanRequest,
  ImportApplyRequest
} from '../shared/types'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1120,
    minHeight: 680,
    title: 'MCP Passport',
    backgroundColor: '#0e0e0d',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    },
    show: false
  })

  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']!)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // IPC handlers
  ipcMain.handle('passport:scan', async () => scanAll())

  ipcMain.handle('passport:sync', async (_evt, req: SyncRequest) => syncItem(req))

  ipcMain.handle('passport:open-finder', async (_evt, p: string) => {
    shell.showItemInFolder(p)
  })

  ipcMain.handle('passport:open-external', async (_evt, url: string) => {
    await shell.openExternal(url)
  })

  ipcMain.handle('passport:read-file', async (_evt, p: string) => {
    return readFile(p, 'utf8')
  })

  ipcMain.handle(
    'passport:remove',
    async (
      _evt,
      { itemId, toolId, scope, projectPath }: { itemId: string; toolId: any; scope: any; projectPath?: string }
    ) => removeItemFromTool(itemId, toolId, scope, projectPath)
  )

  ipcMain.handle('passport:library:add-mcp', async (_evt, input: LibraryMcpInput) => {
    try {
      await passport.addMcp(input)
      return { ok: true, message: `Added "${input.name}" to library.` }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  })

  ipcMain.handle('passport:library:add-skill', async (_evt, input: LibrarySkillInput) => {
    try {
      const dir = await passport.addSkill(input)
      return { ok: true, message: `Saved skill "${input.name}" at ${dir}.` }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  })

  ipcMain.handle(
    'passport:library:remove',
    async (_evt, { kind, name }: { kind: ItemKind; name: string }) => {
      try {
        if (kind === 'mcp') await passport.removeMcp(name)
        else if (kind === 'skill') await passport.removeSkill(name)
        else return { ok: false, message: `Cannot remove ${kind} from library.` }
        return { ok: true, message: `Removed "${name}" from library.` }
      } catch (e) {
        return { ok: false, message: (e as Error).message }
      }
    }
  )

  ipcMain.handle('passport:registry:list', async () => registry.listCatalog())
  ipcMain.handle(
    'passport:registry:search',
    async (
      _evt,
      {
        query,
        kind,
        bypassCache
      }: { query: string; kind: ItemKind; bypassCache?: boolean }
    ) => searchRemote(query ?? '', kind, { bypassCache })
  )
  ipcMain.handle('passport:registry:add', async (_evt, entry: RegistryEntry) =>
    registry.addEntryToLibrary(entry)
  )
  ipcMain.handle('passport:registry:clear-cache', async () => {
    try {
      await clearSearchCache()
      return { ok: true, message: 'Cleared registry cache.' }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  })

  ipcMain.handle('passport:export:plan', async () => planExport(app.getVersion()))

  ipcMain.handle('passport:export:run', async (evt, req: ExportRunRequest) => {
    try {
      if (!req.passphrase) return { ok: false, message: 'Passphrase required.' }
      if (!req.selectedIds?.length) return { ok: false, message: 'No items selected.' }
      const { bundle, itemCount } = await buildBundle(
        req.selectedIds,
        req.includeSecrets,
        app.getVersion()
      )
      if (itemCount === 0) {
        return { ok: false, message: 'Nothing to export after applying filters.' }
      }

      let destination = req.destinationPath
      if (!destination) {
        const win = BrowserWindow.fromWebContents(evt.sender) ?? undefined
        const defaultName = `mcp-passport-${hostname()}-${dateStamp()}${PASSPORT_FILE_EXT}`
        const result = await dialog.showSaveDialog(win as BrowserWindow, {
          title: 'Export MCP Passport',
          defaultPath: defaultName,
          filters: [{ name: 'MCP Passport export', extensions: ['mcppassport'] }]
        })
        if (result.canceled || !result.filePath) {
          return { ok: false, message: 'Export canceled.' }
        }
        destination = result.filePath
      }

      const bytes = encryptBundle(bundleToBytes(bundle), req.passphrase)
      await writeFile(destination, bytes)
      return {
        ok: true,
        message: `Exported ${itemCount} item${itemCount === 1 ? '' : 's'} (${formatBytes(bytes.length)}).`,
        destinationPath: destination,
        itemCount,
        fileBytes: bytes.length
      }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  })

  ipcMain.handle('passport:import:pick-file', async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender) ?? undefined
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: 'Open MCP Passport bundle',
      properties: ['openFile'],
      filters: [{ name: 'MCP Passport export', extensions: ['mcppassport'] }]
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('passport:import:plan', async (_evt, req: ImportPlanRequest) => planImport(req))

  ipcMain.handle('passport:import:apply', async (_evt, req: ImportApplyRequest) => applyImport(req))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function dateStamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
