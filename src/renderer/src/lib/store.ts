import { create } from 'zustand'
import type {
  ScanResult,
  ItemKind,
  ToolId,
  Scope,
  UpdateInfo,
  UpdatePrefs
} from '../../../shared/types'
import { scan, api } from './api'

type ViewMode = 'inventory' | 'browse'

interface AppState {
  scan: ScanResult | null
  loading: boolean
  error: string | null
  activeKind: ItemKind
  scopeFilter: 'all' | 'global' | 'project'
  toolFilter: 'all' | ToolId
  projectFilter: 'all' | string
  query: string
  view: ViewMode

  refresh: () => Promise<void>
  setActiveKind: (k: ItemKind) => void
  setScopeFilter: (s: 'all' | 'global' | 'project') => void
  setToolFilter: (t: 'all' | ToolId) => void
  setProjectFilter: (p: 'all' | string) => void
  setQuery: (q: string) => void
  setView: (v: ViewMode) => void
}

export const useApp = create<AppState>((set) => ({
  scan: null,
  loading: false,
  error: null,
  activeKind: 'mcp',
  scopeFilter: 'all',
  toolFilter: 'all',
  projectFilter: 'all',
  query: '',
  view: 'inventory',
  refresh: async () => {
    set({ loading: true, error: null })
    try {
      const result = await scan()
      set({ scan: result, loading: false })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },
  setActiveKind: (activeKind) => set({ activeKind }),
  setScopeFilter: (scopeFilter) => set({ scopeFilter }),
  setToolFilter: (toolFilter) => set({ toolFilter }),
  setProjectFilter: (projectFilter) => set({ projectFilter }),
  setQuery: (query) => set({ query }),
  setView: (view) => set({ view })
}))

interface UpdateState {
  /** Latest known update offer from the main process, or null when current. */
  available: UpdateInfo | null
  /** True if the user explicitly skipped this exact `available.latestVersion`. */
  suppressed: boolean
  /** Hidden for this session via the banner X — does NOT persist. */
  dismissed: boolean
  prefs: UpdatePrefs | null
  currentVersion: string | null
  /** True while `Check now` is in flight. */
  checking: boolean

  initialize: () => Promise<() => void>
  checkNow: (opts?: { force?: boolean }) => Promise<void>
  setAutoCheck: (autoCheck: boolean) => Promise<void>
  skipCurrent: () => Promise<void>
  unskip: () => Promise<void>
  dismiss: () => void
}

export const useUpdate = create<UpdateState>((set, get) => ({
  available: null,
  suppressed: false,
  dismissed: false,
  prefs: null,
  currentVersion: null,
  checking: false,

  initialize: async () => {
    const [version, prefs, cached] = await Promise.all([
      api.updateGetCurrentVersion(),
      api.updateGetPrefs(),
      api.updateGetCached()
    ])
    set({
      currentVersion: version,
      prefs,
      available: cached,
      suppressed: !!cached && prefs.skippedVersion === cached.latestVersion
    })
    return api.onUpdateStatus((evt) => {
      if (!evt.hasUpdate) {
        set({ available: null, suppressed: false })
        return
      }
      const prev = get().available
      // Reset session-dismiss when a *new* version arrives.
      const dismissed = prev?.latestVersion === evt.info.latestVersion ? get().dismissed : false
      set({ available: evt.info, suppressed: evt.suppressed, dismissed })
    })
  },

  checkNow: async (opts) => {
    if (get().checking) return
    set({ checking: true })
    try {
      await api.updateCheckNow(opts)
    } finally {
      set({ checking: false })
    }
  },

  setAutoCheck: async (autoCheck) => {
    const prefs = await api.updateSetPrefs({ autoCheck })
    set({ prefs })
  },

  skipCurrent: async () => {
    const target = get().available
    if (!target) return
    const prefs = await api.updateSetPrefs({ skippedVersion: target.latestVersion })
    set({ prefs, suppressed: true })
  },

  unskip: async () => {
    const prefs = await api.updateSetPrefs({ skippedVersion: null })
    set({ prefs, suppressed: false, dismissed: false })
  },

  dismiss: () => set({ dismissed: true })
}))
