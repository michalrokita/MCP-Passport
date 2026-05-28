import { useMemo, useState } from 'react'
import { useApp } from '../lib/store'
import type { InventoryItem, ItemPresence, ToolId } from '../../../shared/types'
import { ItemRow } from './ItemRow'
import { SyncDialog } from './SyncDialog'
import { DetailsDialog } from './DetailsDialog'
import { AddToLibraryDialog } from './AddToLibraryDialog'
import { CodexNameBanner } from './CodexNameBanner'
import { SecretBanner } from './SecretBanner'

export function ItemList(): JSX.Element {
  const { scan, activeKind, scopeFilter, toolFilter, projectFilter, query, setView } = useApp()
  const [syncTarget, setSyncTarget] = useState<{
    item: InventoryItem
    presence: ItemPresence
  } | null>(null)
  const [details, setDetails] = useState<InventoryItem | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const items = useMemo(() => {
    if (!scan) return []
    let list = scan.items.filter((it) => it.kind === activeKind)

    if (toolFilter === 'all') {
      // "All agents" filter excludes library-only items — those have a dedicated section.
      list = list.filter((it) => it.presences.some((p) => p.toolId !== 'passport'))
    } else {
      list = list.filter((it) => it.presences.some((p) => p.toolId === toolFilter))
    }
    if (scopeFilter !== 'all') {
      list = list.filter((it) => it.presences.some((p) => p.scope === scopeFilter))
    }
    if (scopeFilter === 'project' && projectFilter !== 'all') {
      list = list.filter((it) =>
        it.presences.some((p) => p.scope === 'project' && p.projectPath === projectFilter)
      )
    }
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((it) => itemMatchesQuery(it, q))
    }
    return list
  }, [scan, activeKind, scopeFilter, toolFilter, projectFilter, query])

  if (!scan) return <></>

  if (items.length === 0) {
    // Special-case: filtering by Passport library and it's empty → friendly onboarding.
    const isPassportFilter = toolFilter === 'passport'
    const isLibraryEmpty =
      isPassportFilter &&
      !scan.items.some((it) => it.presences.some((p) => p.toolId === 'passport'))

    if (isLibraryEmpty && (activeKind === 'mcp' || activeKind === 'skill')) {
      return (
        <>
          <div className="mx-auto mt-10 max-w-xl text-center">
            <div className="surface px-6 py-10">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep text-white">
                +
              </div>
              <div className="text-base font-semibold">
                Your Passport library is empty
              </div>
              <div className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-ink-400">
                Save {activeKind === 'mcp' ? 'MCP servers' : 'skills'} you reuse here so you can
                copy them to any tool — Claude Code, Claude Desktop, Codex CLI, or Codex Desktop —
                with one click.
              </div>
              <div className="mt-5 flex items-center justify-center gap-2">
                <button onClick={() => setAddOpen(true)} className="btn btn-primary text-xs">
                  + Add your first {activeKind === 'mcp' ? 'MCP' : 'skill'}
                </button>
                <button onClick={() => setView('browse')} className="btn btn-outline text-xs">
                  Browse store
                </button>
              </div>
            </div>
          </div>
          {addOpen && (
            <AddToLibraryDialog kind={activeKind} onClose={() => setAddOpen(false)} />
          )}
        </>
      )
    }
    return (
      <>
        <CodexNameBanner />
        <SecretBanner />
        <div className="mx-auto mt-12 max-w-md text-center">
          <div className="surface mx-auto px-6 py-10">
            <div className="text-2xl">∅</div>
            <div className="mt-2 text-sm font-semibold">No items match your filters.</div>
            <div className="mt-1 text-xs text-ink-400">
              Try changing the kind, scope, or tool filter — or click Rescan above.
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <CodexNameBanner />
      <SecretBanner />
      <div className="space-y-2">
        {items.map((it) => (
          <ItemRow
            key={it.id + it.presences.length}
            item={it}
            tools={scan.tools}
            onSyncFromPresence={(presence) => setSyncTarget({ item: it, presence })}
            onShowDetails={() => setDetails(it)}
          />
        ))}
      </div>

      {syncTarget && (
        <SyncDialog
          item={syncTarget.item}
          fromPresence={syncTarget.presence}
          tools={scan.tools}
          projects={scan.projects}
          onClose={() => setSyncTarget(null)}
        />
      )}

      {details && <DetailsDialog item={details} onClose={() => setDetails(null)} />}

      {addOpen && (
        <AddToLibraryDialog kind={activeKind} onClose={() => setAddOpen(false)} />
      )}
    </>
  )
}

/**
 * Match query against the full canonical config, not just name + description.
 * The display name often differs from the underlying package or URL, so
 * searching "github" / "notion.com" / "DATABASE_URL" should still find the
 * relevant MCP. Skill/agent metadata is similarly searched via frontmatter
 * string values.
 *
 * Everything is compared lowercased; the caller normalises `q` once.
 */
function itemMatchesQuery(item: InventoryItem, q: string): boolean {
  if (item.name.toLowerCase().includes(q)) return true
  if ((item.description ?? '').toLowerCase().includes(q)) return true

  for (const presence of item.presences) {
    const src = presence.source
    if (src.kind === 'mcp') {
      const c = src.canonical
      if (c.command && c.command.toLowerCase().includes(q)) return true
      if (c.url && c.url.toLowerCase().includes(q)) return true
      if (c.args) {
        for (const a of c.args) if (typeof a === 'string' && a.toLowerCase().includes(q)) return true
      }
      if (c.env) {
        for (const k of Object.keys(c.env)) if (k.toLowerCase().includes(q)) return true
      }
      if (c.headers) {
        for (const k of Object.keys(c.headers)) if (k.toLowerCase().includes(q)) return true
      }
    } else if (src.kind === 'skill' || src.kind === 'agent') {
      const fm = src.frontmatter
      for (const value of Object.values(fm)) {
        if (typeof value === 'string' && value.toLowerCase().includes(q)) return true
      }
    }
  }
  return false
}
