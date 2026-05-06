import { useMemo, useState } from 'react'
import type {
  InventoryItem,
  ItemPresence,
  ProjectInfo,
  Scope,
  SyncOutcome,
  SyncTarget,
  ToolId,
  ToolPresence
} from '../../../shared/types'
import { ToolIcon } from './ToolIcon'
import { sync } from '../lib/api'
import { useApp } from '../lib/store'
import { useToaster } from './Toaster'

const TOOL_ORDER: ToolId[] = [
  'passport',
  'claude-code',
  'claude-desktop',
  'codex-cli',
  'codex-desktop'
]

export function SyncDialog({
  item,
  fromPresence,
  tools,
  projects,
  onClose
}: {
  item: InventoryItem
  fromPresence: ItemPresence
  tools: ToolPresence[]
  projects: ProjectInfo[]
  onClose: () => void
}): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const toast = useToaster()
  const [from, setFrom] = useState<ItemPresence>(fromPresence)
  const [targets, setTargets] = useState<SyncTarget[]>([])
  const [working, setWorking] = useState(false)
  const [outcomes, setOutcomes] = useState<SyncOutcome[] | null>(null)

  const toolMap = useMemo(() => Object.fromEntries(tools.map((t) => [t.id, t])), [tools])

  const supported = supportsForKind(item.kind)

  function toggleTarget(t: SyncTarget) {
    setTargets((prev) => {
      const idx = prev.findIndex(
        (p) => p.toolId === t.toolId && p.scope === t.scope && p.projectPath === t.projectPath
      )
      if (idx >= 0) return prev.filter((_, i) => i !== idx)
      return [...prev, t]
    })
  }

  async function applySync() {
    if (!targets.length) return
    setWorking(true)
    try {
      const res = await sync({
        source: {
          itemId: item.id,
          fromToolId: from.toolId,
          fromScope: from.scope,
          fromProjectPath: from.projectPath
        },
        targets,
        includeEnv: true
      })
      setOutcomes(res)
      const okCount = res.filter((r) => r.ok).length
      const fail = res.length - okCount
      toast.show(
        fail === 0
          ? `Synced "${item.name}" to ${okCount} target${okCount === 1 ? '' : 's'}.`
          : `Synced ${okCount}/${res.length} targets — ${fail} failed.`,
        fail === 0 ? 'ok' : 'warn'
      )
      void refresh()
    } catch (e) {
      toast.show(`Sync failed: ${(e as Error).message}`, 'error')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="surface w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-500">Sync {item.kind}</div>
            <div className="mt-0.5 text-sm font-semibold">{item.name}</div>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-100">
            ✕
          </button>
        </header>

        <div className="px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">From</div>
          <div className="mt-2 space-y-1.5">
            {item.presences.map((p, i) => (
              <button
                key={i}
                onClick={() => setFrom(p)}
                className={
                  'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm ' +
                  (presenceMatches(p, from)
                    ? 'border-accent/50 bg-accent/10 text-ink-50'
                    : 'border-white/10 bg-white/0 text-ink-300 hover:bg-white/5')
                }
              >
                <ToolIcon toolId={p.toolId} className="h-4 w-4" />
                <span className="flex-1">
                  {toolMap[p.toolId]?.name} —{' '}
                  <span className="text-ink-500">
                    {p.scope}
                    {p.projectPath ? ` · ${shortPath(p.projectPath)}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-5 text-xs font-semibold uppercase tracking-wider text-ink-500">
            To
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {TOOL_ORDER.map((tid) => {
              const tool = toolMap[tid]
              if (!tool) return null
              const allowGlobal = supported.global.includes(tid)
              const allowProject = supported.project.includes(tid)
              return (
                <div key={tid} className="rounded-md border border-white/10 p-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ToolIcon toolId={tid} className="h-4 w-4" />
                    {tool.name}
                    {!tool.installed && (
                      <span className="ml-1 rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-500">
                        not installed
                      </span>
                    )}
                  </div>

                  {allowGlobal && (
                    <TargetCheckbox
                      label="Global"
                      checked={targets.some(
                        (t) => t.toolId === tid && t.scope === 'global'
                      )}
                      disabled={!tool.installed || presenceMatches({ toolId: tid, scope: 'global', source: undefined as any }, from)}
                      onToggle={() => toggleTarget({ toolId: tid, scope: 'global' })}
                    />
                  )}
                  {allowProject &&
                    projects.map((p) => (
                      <TargetCheckbox
                        key={p.path}
                        label={`Project · ${shortPath(p.path)}`}
                        checked={targets.some(
                          (t) =>
                            t.toolId === tid && t.scope === 'project' && t.projectPath === p.path
                        )}
                        disabled={!tool.installed}
                        onToggle={() =>
                          toggleTarget({ toolId: tid, scope: 'project', projectPath: p.path })
                        }
                      />
                    ))}
                  {!allowGlobal && !allowProject && (
                    <div className="mt-1 text-[11px] text-ink-500">
                      Not supported for this kind.
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {outcomes && (
            <div className="mt-4 space-y-1 rounded-md border border-white/10 bg-ink-950/40 p-3 text-xs">
              {outcomes.map((o, i) => (
                <div
                  key={i}
                  className={'flex items-start gap-2 ' + (o.ok ? 'text-emerald-300' : 'text-red-300')}
                >
                  <span>{o.ok ? '✓' : '✗'}</span>
                  <span>
                    <span className="font-medium">
                      {o.target.toolId} ({o.target.scope}
                      {o.target.projectPath ? ` · ${shortPath(o.target.projectPath)}` : ''})
                    </span>{' '}
                    — {o.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-white/5 px-5 py-3">
          <button onClick={onClose} className="btn btn-ghost text-xs">
            Close
          </button>
          <button
            disabled={!targets.length || working}
            onClick={applySync}
            className="btn btn-primary text-xs disabled:opacity-50"
          >
            {working ? 'Syncing…' : `Sync to ${targets.length || 0} target${targets.length === 1 ? '' : 's'}`}
          </button>
        </footer>
      </div>
    </div>
  )
}

function TargetCheckbox({
  label,
  checked,
  onToggle,
  disabled
}: {
  label: string
  checked: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <label
      className={
        'mt-1.5 flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs ' +
        (disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-white/5')
      }
    >
      <input
        type="checkbox"
        disabled={disabled}
        checked={checked}
        onChange={onToggle}
        className="h-3 w-3 accent-accent"
      />
      <span className="truncate text-ink-200">{label}</span>
    </label>
  )
}

function presenceMatches(a: ItemPresence, b: ItemPresence): boolean {
  return a.toolId === b.toolId && a.scope === b.scope && a.projectPath === b.projectPath
}

function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~').split('/').slice(-2).join('/')
}

function supportsForKind(kind: InventoryItem['kind']): { global: ToolId[]; project: ToolId[] } {
  if (kind === 'mcp') {
    return {
      global: ['passport', 'claude-code', 'claude-desktop', 'codex-cli', 'codex-desktop'],
      project: ['claude-code']
    }
  }
  if (kind === 'skill') {
    return {
      global: ['passport', 'claude-code', 'codex-cli', 'codex-desktop'],
      project: ['claude-code']
    }
  }
  if (kind === 'plugin') {
    return {
      global: ['codex-cli', 'codex-desktop'],
      project: []
    }
  }
  if (kind === 'agent') {
    return { global: ['claude-code'], project: ['claude-code'] }
  }
  return { global: [], project: [] }
}
