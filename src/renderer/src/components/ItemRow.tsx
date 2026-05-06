import type {
  InventoryItem,
  ItemPresence,
  ToolPresence
} from '../../../shared/types'
import { ToolIcon } from './ToolIcon'
import { useApp } from '../lib/store'

const TOOL_ORDER: Array<ToolPresence['id']> = [
  'claude-code',
  'claude-desktop',
  'codex-cli',
  'codex-desktop'
]

function BookmarkIcon({ className = '' }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M6 3.5A1.5 1.5 0 0 1 7.5 2h9A1.5 1.5 0 0 1 18 3.5V21l-6-3.2L6 21V3.5Z" />
    </svg>
  )
}

export function ItemRow({
  item,
  tools,
  onSyncFromPresence,
  onShowDetails
}: {
  item: InventoryItem
  tools: ToolPresence[]
  onSyncFromPresence: (p: ItemPresence) => void
  onShowDetails: () => void
}): JSX.Element {
  const toolMap = Object.fromEntries(tools.map((t) => [t.id, t]))
  const presenceByTool = new Map<string, ItemPresence[]>()
  for (const p of item.presences) {
    const arr = presenceByTool.get(p.toolId) ?? []
    arr.push(p)
    presenceByTool.set(p.toolId, arr)
  }

  // Pick a default "from" presence — prefer global, then first project.
  const defaultFrom =
    item.presences.find((p) => p.scope === 'global') ?? item.presences[0]

  // Detect whether this is a cloud-managed MCP (has __remote on raw)
  const isRemoteConnector = item.presences.some(
    (p) =>
      p.source.kind === 'mcp' &&
      // @ts-expect-error our raw shape isn't typed
      p.source.raw?.__remote === true
  )

  // Library presence — shown as a dedicated "Saved" badge, not a tool pill.
  const inLibrary = item.presences.some((p) => p.toolId === 'passport')

  // Auth state for remote MCPs
  const authedHosts = useApp((s) => s.scan?.authedHosts ?? [])
  const authed = item.presences.some((p) => {
    if (p.source.kind !== 'mcp' || !p.source.canonical.url) return false
    const host = (() => {
      try {
        return new URL(p.source.canonical.url).host
      } catch {
        return ''
      }
    })()
    return authedHosts.some((h) => h.includes(host))
  })

  return (
    <div className="surface flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button
            className="truncate text-left text-sm font-semibold text-ink-50 hover:text-accent-soft"
            onClick={onShowDetails}
          >
            {item.name}
          </button>
          <KindBadge kind={item.kind} />
          {inLibrary && (
            <span
              title="Saved in your MCP Passport library"
              className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-soft"
            >
              <BookmarkIcon className="h-2.5 w-2.5" />
              Saved
            </span>
          )}
          {isRemoteConnector && (
            <span
              title="Cloud-managed Anthropic Connector — added via claude.ai's Connect Apps UI"
              className="rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-cyan-200"
            >
              Connector
            </span>
          )}
          {authed && (
            <span
              title="OAuth token cached in ~/.mcp-auth/"
              className="rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-200"
            >
              Authed
            </span>
          )}
        </div>
        {item.description && (
          <div className="mt-0.5 line-clamp-2 text-xs text-ink-400">{item.description}</div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {TOOL_ORDER.map((tid) => {
          const tool = toolMap[tid]
          if (!tool) return null
          const presences = presenceByTool.get(tid) ?? []
          const present = presences.length > 0
          return (
            <PresencePill
              key={tid}
              tool={tool}
              presences={presences}
              present={present}
              installed={tool.installed}
            />
          )
        })}
      </div>

      <button
        title={`Copy ${item.name} to other tools — Claude Desktop, Codex, or a Claude Code project`}
        onClick={() => defaultFrom && onSyncFromPresence(defaultFrom)}
        className="btn btn-outline ml-1 shrink-0 text-xs"
      >
        Copy to…
      </button>
    </div>
  )
}

function KindBadge({ kind }: { kind: string }) {
  const label =
    kind === 'mcp'
      ? 'MCP'
      : kind === 'skill'
      ? 'Skill'
      : kind === 'plugin'
      ? 'Plugin'
      : 'Agent'
  return (
    <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-400">
      {label}
    </span>
  )
}

function GlobeIcon({ className = '' }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
function FolderIcon({ className = '' }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function PresencePill({
  tool,
  presences,
  present,
  installed
}: {
  tool: ToolPresence
  presences: ItemPresence[]
  present: boolean
  installed: boolean
}) {
  const projectCount = presences.filter((p) => p.scope === 'project').length
  const hasGlobal = presences.some((p) => p.scope === 'global')
  const projectPaths = presences
    .filter((p) => p.scope === 'project' && p.projectPath)
    .map((p) => p.projectPath!.split('/').slice(-2).join('/'))

  const tooltipLines: string[] = [`${tool.name}${tool.surface ? ` (${tool.surface})` : ''}`]
  if (!installed) tooltipLines.push('Not installed')
  else if (!present) tooltipLines.push('Not present here')
  else {
    if (hasGlobal) tooltipLines.push('• Global')
    for (const p of projectPaths) tooltipLines.push(`• Project: ${p}`)
  }

  return (
    <div
      title={tooltipLines.join('\n')}
      className={
        'flex h-7 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium transition-colors ' +
        (present
          ? 'border-accent/40 bg-accent/15 text-accent-soft'
          : !installed
          ? 'border-white/5 bg-white/0 text-ink-600 opacity-50'
          : 'border-dashed border-white/10 bg-white/0 text-ink-500')
      }
    >
      <ToolIcon toolId={tool.id} className="h-5 w-5" />
      {hasGlobal && (
        <span className="flex items-center gap-0.5" aria-label="Global presence">
          <GlobeIcon className="h-3 w-3" />
        </span>
      )}
      {projectCount > 0 && (
        <span className="flex items-center gap-0.5" aria-label={`${projectCount} projects`}>
          <FolderIcon className="h-3 w-3" />
          <span className="tabular-nums">{projectCount}</span>
        </span>
      )}
    </div>
  )
}
