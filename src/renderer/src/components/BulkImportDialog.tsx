import { useMemo, useState } from 'react'
import { useApp } from '../lib/store'
import { useToaster } from './Toaster'
import { ToolIcon } from './ToolIcon'
import type { InventoryItem, ToolId } from '../../../shared/types'

type ImportableItem = {
  /** stable id matching InventoryItem.id */
  id: string
  kind: 'mcp' | 'skill'
  name: string
  description?: string
  /** Tools where this item is currently present. */
  fromTools: ToolId[]
  /** For MCP — canonical source. */
  canonical?: import('../../../shared/types').CanonicalMcp
  /** For skill — directory to copy from. */
  srcDir?: string
}

export function BulkImportDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const scan = useApp((s) => s.scan)
  const refresh = useApp((s) => s.refresh)
  const toast = useToaster()
  const [working, setWorking] = useState(false)

  const importable = useMemo<ImportableItem[]>(
    () => collectImportable(scan?.items ?? []),
    [scan]
  )

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(importable.map((i) => i.id))
  )
  const [filter, setFilter] = useState<'all' | 'mcp' | 'skill'>('all')

  const visible = useMemo(
    () => (filter === 'all' ? importable : importable.filter((i) => i.kind === filter)),
    [importable, filter]
  )

  const groups = useMemo(() => {
    const mcps = visible.filter((i) => i.kind === 'mcp')
    const skills = visible.filter((i) => i.kind === 'skill')
    const out: { key: 'mcp' | 'skill'; label: string; items: ImportableItem[] }[] = []
    if (mcps.length) out.push({ key: 'mcp', label: `MCPs (${mcps.length})`, items: mcps })
    if (skills.length) out.push({ key: 'skill', label: `Skills (${skills.length})`, items: skills })
    return out
  }, [visible])

  function toggleOne(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll(checked: boolean): void {
    if (!checked) {
      setSelected(new Set())
      return
    }
    setSelected(new Set(visible.map((i) => i.id)))
  }

  function toggleGroup(items: ImportableItem[], checked: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const it of items) {
        if (checked) next.add(it.id)
        else next.delete(it.id)
      }
      return next
    })
  }

  async function run(): Promise<void> {
    if (!selected.size || working) return
    setWorking(true)
    let ok = 0
    let failed = 0
    const errors: string[] = []
    try {
      for (const item of importable) {
        if (!selected.has(item.id)) continue
        try {
          if (item.kind === 'mcp' && item.canonical) {
            const r = await window.api.libraryAddMcp({
              name: item.name,
              description: item.description,
              canonical: item.canonical
            })
            if (r.ok) ok++
            else {
              failed++
              errors.push(`${item.name}: ${r.message}`)
            }
          } else if (item.kind === 'skill' && item.srcDir) {
            const r = await window.api.libraryAddSkillFromPath(item.name, item.srcDir)
            if (r.ok) ok++
            else {
              failed++
              errors.push(`${item.name}: ${r.message}`)
            }
          } else {
            failed++
            errors.push(`${item.name}: missing source`)
          }
        } catch (e) {
          failed++
          errors.push(`${item.name}: ${(e as Error).message}`)
        }
      }
      if (ok) toast.show(`Saved ${ok} item${ok === 1 ? '' : 's'} to your library.`, 'ok')
      if (failed) {
        const head = errors.slice(0, 3).join('; ')
        toast.show(
          `${failed} failed${failed > 3 ? ` (showing first 3)` : ''}: ${head}`,
          'error'
        )
      }
      await refresh()
      onClose()
    } finally {
      setWorking(false)
    }
  }

  const visibleSelectedCount = visible.filter((i) => selected.has(i.id)).length

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="surface flex max-h-[85vh] w-full max-w-3xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/5 px-5 py-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-500">Bulk save</div>
            <div className="mt-0.5 text-sm font-semibold">Save items from your tools to library</div>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-100">
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {importable.length === 0 ? (
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-6 text-center text-xs text-ink-400">
              <div className="font-medium text-ink-200">Nothing new to save</div>
              <div className="mt-1">
                Every MCP and skill we found across your tools is already in the library.
              </div>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 p-0.5 text-[11px]">
                  <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>
                    All ({importable.length})
                  </FilterPill>
                  <FilterPill active={filter === 'mcp'} onClick={() => setFilter('mcp')}>
                    MCPs ({importable.filter((i) => i.kind === 'mcp').length})
                  </FilterPill>
                  <FilterPill active={filter === 'skill'} onClick={() => setFilter('skill')}>
                    Skills ({importable.filter((i) => i.kind === 'skill').length})
                  </FilterPill>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    className="text-ink-400 hover:text-ink-100"
                    onClick={() => selectAll(true)}
                  >
                    Select all
                  </button>
                  <button
                    className="text-ink-400 hover:text-ink-100"
                    onClick={() => selectAll(false)}
                  >
                    Select none
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {groups.map((g) => {
                  const groupSelected = g.items.filter((it) => selected.has(it.id)).length
                  const allSelected = groupSelected === g.items.length && g.items.length > 0
                  const partiallySelected = groupSelected > 0 && !allSelected
                  return (
                    <div key={g.key} className="rounded-md border border-white/10">
                      <label
                        className={
                          'flex cursor-pointer items-center gap-2 border-b border-white/5 px-3 py-2 text-xs ' +
                          (groupSelected ? 'text-ink-100' : 'text-ink-300')
                        }
                      >
                        <input
                          type="checkbox"
                          ref={(el) => {
                            if (el) el.indeterminate = partiallySelected
                          }}
                          checked={allSelected}
                          onChange={(e) => toggleGroup(g.items, e.target.checked)}
                          className="h-3.5 w-3.5 accent-accent"
                        />
                        <span className="font-semibold uppercase tracking-wider">{g.label}</span>
                        <span className="ml-auto text-ink-500">
                          {groupSelected}/{g.items.length}
                        </span>
                      </label>
                      <div className="divide-y divide-white/5">
                        {g.items.map((it) => (
                          <Row
                            key={it.id}
                            item={it}
                            checked={selected.has(it.id)}
                            onToggle={() => toggleOne(it.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-white/5 px-5 py-3 text-xs">
          <div className="text-ink-500">
            {importable.length === 0
              ? ''
              : `${visibleSelectedCount} of ${visible.length} selected`}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn btn-ghost text-xs">
              {importable.length === 0 ? 'Close' : 'Cancel'}
            </button>
            {importable.length > 0 && (
              <button
                disabled={working || selected.size === 0}
                onClick={run}
                className="btn btn-primary text-xs disabled:opacity-50"
              >
                {working
                  ? 'Saving…'
                  : `Save ${selected.size} item${selected.size === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}

function Row({
  item,
  checked,
  onToggle
}: {
  item: ImportableItem
  checked: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs hover:bg-white/[0.03]">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-3.5 w-3.5 shrink-0 accent-accent"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-ink-100">{item.name}</div>
        {item.description && (
          <div className="line-clamp-1 text-ink-500">{item.description}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {item.fromTools.map((t) => (
          <ToolIcon key={t} toolId={t} className="h-4 w-4 opacity-70" />
        ))}
      </div>
    </label>
  )
}

function FilterPill({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
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

// Pick out items that are present somewhere outside the library and not yet
// in the library. Skip kinds we can't store yet (plugin, agent), and skip
// cloud-managed Anthropic Connectors — saving those as a static URL strips
// them of the auth they need to be useful.
function collectImportable(items: InventoryItem[]): ImportableItem[] {
  const out: ImportableItem[] = []
  for (const it of items) {
    if (it.kind !== 'mcp' && it.kind !== 'skill') continue
    const inLibrary = it.presences.some((p) => p.toolId === 'passport')
    if (inLibrary) continue
    const externalPresences = it.presences.filter((p) => p.toolId !== 'passport')
    if (externalPresences.length === 0) continue
    const isRemoteConnector = externalPresences.some(
      (p) =>
        p.source.kind === 'mcp' &&
        (p.source.raw as { __remote?: boolean } | undefined)?.__remote === true
    )
    if (isRemoteConnector) continue
    const fromTools = Array.from(new Set(externalPresences.map((p) => p.toolId)))
    if (it.kind === 'mcp') {
      const mcpPresence = externalPresences.find((p) => p.source.kind === 'mcp')
      if (!mcpPresence || mcpPresence.source.kind !== 'mcp') continue
      out.push({
        id: it.id,
        kind: 'mcp',
        name: it.name,
        description: it.description,
        fromTools,
        canonical: mcpPresence.source.canonical
      })
    } else {
      const skillPresence = externalPresences.find((p) => p.source.kind === 'skill')
      if (!skillPresence || skillPresence.source.kind !== 'skill') continue
      out.push({
        id: it.id,
        kind: 'skill',
        name: it.name,
        description: it.description,
        fromTools,
        srcDir: skillPresence.source.path
      })
    }
  }
  // MCPs first, then alphabetical within each kind.
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'mcp' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return out
}
