import { useMemo, useState } from 'react'
import { useApp } from '../lib/store'
import { AddToLibraryDialog } from './AddToLibraryDialog'
import { BulkImportDialog } from './BulkImportDialog'
import { ExportDialog } from './ExportDialog'
import { ImportDialog } from './ImportDialog'

export function TopBar(): JSX.Element {
  const {
    scan,
    refresh,
    loading,
    activeKind,
    scopeFilter,
    setScopeFilter,
    toolFilter,
    projectFilter,
    setProjectFilter,
    query,
    setQuery,
    view
  } = useApp()
  const [addOpen, setAddOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const projects = scan?.projects ?? []

  const showAdd = view === 'inventory' && (activeKind === 'mcp' || activeKind === 'skill')

  // Count items that exist outside the library and aren't yet saved — that's
  // what the "Save to library…" button would import. Mirrors the filter in
  // BulkImportDialog.collectImportable so the badge count matches the modal.
  const importableCount = useMemo(() => {
    if (view !== 'inventory') return 0
    const items = scan?.items ?? []
    let n = 0
    for (const it of items) {
      if (it.kind !== 'mcp' && it.kind !== 'skill') continue
      if (it.presences.some((p) => p.toolId === 'passport')) continue
      const external = it.presences.filter((p) => p.toolId !== 'passport')
      if (external.length === 0) continue
      const isRemoteConnector = external.some(
        (p) =>
          p.source.kind === 'mcp' &&
          (p.source.raw as { __remote?: boolean } | undefined)?.__remote === true
      )
      if (isRemoteConnector) continue
      n++
    }
    return n
  }, [scan, view])

  const title = (() => {
    if (view === 'browse') return 'Marketplace'
    if (toolFilter === 'all') return 'All agents'
    if (toolFilter === 'passport') return 'My Library'
    const tool = scan?.tools.find((t) => t.id === toolFilter)
    return tool?.name ?? 'All agents'
  })()

  return (
    <>
      <header className="titlebar-drag flex h-12 shrink-0 items-center gap-3 border-b border-white/5 bg-ink-900/30 pl-24 pr-4">
        <div className="titlebar-no-drag flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <div className="shrink-0 whitespace-nowrap text-sm font-semibold text-ink-50">
            {title}
          </div>

          {view === 'inventory' && (
            <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-white/10 bg-white/5 p-0.5 text-xs">
              <ScopePill active={scopeFilter === 'all'} onClick={() => setScopeFilter('all')}>
                All
              </ScopePill>
              <ScopePill active={scopeFilter === 'global'} onClick={() => setScopeFilter('global')}>
                Global
              </ScopePill>
              <ScopePill active={scopeFilter === 'project'} onClick={() => setScopeFilter('project')}>
                Project
              </ScopePill>
            </div>
          )}

          {view === 'inventory' && scopeFilter !== 'global' && projects.length > 0 && (
            <select
              className="titlebar-no-drag min-w-0 max-w-[180px] shrink truncate rounded-md border border-white/10 bg-ink-900 px-2 py-1 text-xs text-ink-200"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value as 'all' | string)}
            >
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="titlebar-no-drag flex shrink-0 items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-44 rounded-md border border-white/10 bg-ink-900 px-3 py-1 text-xs text-ink-100 placeholder:text-ink-500 focus:border-accent focus:outline-none"
          />
          {view === 'inventory' && importableCount > 0 && (
            <button
              onClick={() => setBulkOpen(true)}
              title="Save all MCPs and skills already configured in your tools to the Passport library — pick which ones in the next step"
              className="btn btn-outline shrink-0 whitespace-nowrap text-xs"
            >
              Save to library… ({importableCount})
            </button>
          )}
          {showAdd && (
            <button
              onClick={() => setAddOpen(true)}
              title={`Create a new ${activeKind} in your Passport library`}
              className="btn btn-primary shrink-0 whitespace-nowrap text-xs"
            >
              + Add {activeKind === 'mcp' ? 'MCP' : 'skill'}
            </button>
          )}
          <button
            className="btn btn-outline shrink-0 whitespace-nowrap text-xs"
            onClick={() => setExportOpen(true)}
            title="Export an encrypted bundle of your MCPs and skills"
          >
            Export
          </button>
          <button
            className="btn btn-outline shrink-0 whitespace-nowrap text-xs"
            onClick={() => setImportOpen(true)}
            title="Import an encrypted MCP Passport bundle"
          >
            Import
          </button>
          <button
            className="btn btn-outline shrink-0 whitespace-nowrap text-xs"
            onClick={() => void refresh()}
            disabled={loading}
            title="Re-scan all tools for current state"
          >
            {loading ? 'Scanning…' : 'Rescan'}
          </button>
        </div>
      </header>
      {addOpen && (
        <AddToLibraryDialog kind={activeKind} onClose={() => setAddOpen(false)} />
      )}
      {bulkOpen && <BulkImportDialog onClose={() => setBulkOpen(false)} />}
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </>
  )
}

function ScopePill({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={
        'rounded px-2 py-0.5 transition-colors ' +
        (active ? 'bg-ink-100 text-ink-950' : 'text-ink-300 hover:text-ink-100')
      }
    >
      {children}
    </button>
  )
}
