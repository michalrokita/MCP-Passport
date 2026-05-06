import { useApp } from '../lib/store'
import type { ItemKind } from '../../../shared/types'

const KINDS: { id: ItemKind; label: string }[] = [
  { id: 'mcp', label: 'MCP servers' },
  { id: 'skill', label: 'Skills' },
  { id: 'plugin', label: 'Plugins' },
  { id: 'agent', label: 'Agents' }
]

export function KindFilter(): JSX.Element {
  const { scan, activeKind, setActiveKind, toolFilter, view } = useApp()

  const inMarketplace = view === 'browse'

  function countFor(kind: ItemKind): number {
    if (!scan) return 0
    return scan.items.reduce((n, it) => {
      if (it.kind !== kind) return n
      if (toolFilter === 'all') {
        return n + (it.presences.some((p) => p.toolId !== 'passport') ? 1 : 0)
      }
      return n + (it.presences.some((p) => p.toolId === toolFilter) ? 1 : 0)
    }, 0)
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      {KINDS.map((k) => {
        const supported = !inMarketplace || k.id === 'mcp' || k.id === 'skill'
        const active = activeKind === k.id
        const count = countFor(k.id)
        return (
          <button
            key={k.id}
            disabled={!supported}
            onClick={() => setActiveKind(k.id)}
            title={
              supported
                ? undefined
                : 'Plugins and agents come from each tool’s own marketplace'
            }
            className={
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ' +
              (active
                ? 'border-accent/50 bg-accent/15 text-accent-soft'
                : supported
                  ? 'border-white/10 bg-white/5 text-ink-300 hover:border-white/20 hover:text-ink-100'
                  : 'cursor-not-allowed border-white/5 bg-white/[0.02] text-ink-500')
            }
          >
            <span>{k.label}</span>
            {!inMarketplace && (
              <span
                className={
                  'tabular-nums ' + (active ? 'text-accent-soft/80' : 'text-ink-500')
                }
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
