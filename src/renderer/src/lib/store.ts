import { create } from 'zustand'
import type { ScanResult, ItemKind, ToolId, Scope } from '../../../shared/types'
import { scan } from './api'

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
