import { useEffect, useState } from 'react'
import type { InventoryItem } from '../../../shared/types'
import { openInFinder, removeItem } from '../lib/api'
import { useApp } from '../lib/store'
import { useToaster } from './Toaster'
import { ToolIcon } from './ToolIcon'

export function DetailsDialog({
  item,
  onClose
}: {
  item: InventoryItem
  onClose: () => void
}): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const toast = useToaster()
  const [busy, setBusy] = useState(false)
  const [skillBody, setSkillBody] = useState<string | null>(null)

  useEffect(() => {
    const skill = item.presences.find((p) => p.source.kind === 'skill')
    if (skill && skill.source.kind === 'skill') {
      void window.api
        .readFileText(skill.source.path + '/SKILL.md')
        .then((text) => setSkillBody(stripFrontmatter(text).slice(0, 4000)))
        .catch(() => setSkillBody(null))
    }
  }, [item])

  async function handleRemove(toolId: any, scope: any, projectPath?: string) {
    if (!confirm(`Remove "${item.name}" from ${toolId}?`)) return
    setBusy(true)
    try {
      const r = await removeItem(item.id, toolId, scope, projectPath)
      toast.show(r.message, r.ok ? 'ok' : 'error')
      if (r.ok) {
        void refresh()
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="surface flex max-h-[80vh] w-full max-w-2xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/5 px-5 py-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-500">{item.kind}</div>
            <div className="mt-0.5 text-sm font-semibold">{item.name}</div>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-100">
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {item.description && (
            <p className="mb-4 text-sm text-ink-300">{item.description}</p>
          )}

          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Present in
          </div>
          <div className="mt-2 space-y-1.5">
            {item.presences.map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border border-white/10 px-3 py-2"
              >
                <ToolIcon toolId={p.toolId} className="h-4 w-4" />
                <div className="flex-1 text-sm">
                  <div className="font-medium text-ink-100">{p.toolId}</div>
                  <div className="text-[11px] text-ink-500">
                    {p.scope}
                    {p.projectPath ? ` · ${p.projectPath}` : ''}
                    {p.source.kind === 'skill' && ` · ${p.source.path}`}
                    {p.source.kind === 'agent' && ` · ${p.source.path}`}
                    {p.source.kind === 'plugin' && p.source.installPath && ` · ${p.source.installPath}`}
                  </div>
                </div>
                {(p.source.kind === 'skill' ||
                  p.source.kind === 'agent' ||
                  (p.source.kind === 'plugin' && p.source.installPath)) && (
                  <button
                    title="Reveal in Finder"
                    onClick={() =>
                      openInFinder(
                        p.source.kind === 'plugin' ? p.source.installPath! : (p.source as any).path
                      )
                    }
                    className="btn btn-ghost text-xs"
                  >
                    ↗
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() => handleRemove(p.toolId, p.scope, p.projectPath)}
                  className="btn btn-ghost text-xs text-red-300 hover:text-red-200"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          {item.kind === 'mcp' && (
            <div className="mt-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                Canonical config
              </div>
              <pre className="mt-2 overflow-x-auto rounded-md border border-white/10 bg-ink-950 p-3 text-[11px] text-ink-200">
                {JSON.stringify(
                  item.presences.find((p) => p.source.kind === 'mcp')?.source.kind === 'mcp'
                    ? (item.presences.find((p) => p.source.kind === 'mcp')!.source as any).canonical
                    : null,
                  null,
                  2
                )}
              </pre>
            </div>
          )}

          {item.kind === 'skill' && skillBody && (
            <div className="mt-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                SKILL.md
              </div>
              <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-white/10 bg-ink-950 p-3 text-[11px] text-ink-200">
                {skillBody}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function stripFrontmatter(s: string): string {
  return s.replace(/^---\n[\s\S]*?\n---\n?/, '')
}
