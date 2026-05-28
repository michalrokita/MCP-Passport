import { useState } from 'react'
import { useApp } from '../lib/store'
import { codexHealNames } from '../lib/api'
import { useToaster } from './Toaster'

/**
 * Surfaces Codex MCP server names that Codex rejects at startup (anything not
 * matching a-z, 0-9, _ or -) and offers a one-click rename. Self-gating: renders
 * nothing unless the selected tool is Codex (or "All agents") and has issues.
 */
export function CodexNameBanner(): JSX.Element | null {
  const { scan, toolFilter, refresh } = useApp()
  const toast = useToaster()
  const [working, setWorking] = useState(false)

  if (!scan) return null
  const relevant =
    toolFilter === 'all' || toolFilter === 'codex-cli' || toolFilter === 'codex-desktop'
  if (!relevant) return null

  const codexTool = scan.tools.find(
    (t) => (t.id === 'codex-cli' || t.id === 'codex-desktop') && t.mcpNameIssues?.length
  )
  const issues = codexTool?.mcpNameIssues
  if (!issues?.length) return null

  async function fix() {
    setWorking(true)
    try {
      const res = await codexHealNames()
      toast.show(res.message, res.ok ? 'ok' : 'error')
      if (res.ok) await refresh()
    } catch (e) {
      toast.show(`Fix failed: ${(e as Error).message}`, 'error')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-amber-200">
            {issues.length} Codex MCP name{issues.length === 1 ? '' : 's'} will fail at startup
          </div>
          <div className="mt-1 text-amber-100/80">
            Codex requires names to match a-z, 0-9, _ or -. These get renamed in
            ~/.codex/config.toml (headers edited in place — comments preserved):
          </div>
          <ul className="mt-1.5 space-y-0.5 text-amber-100/90">
            {issues.map((i) => (
              <li key={i.from} className="font-mono">
                "{i.from}" → {i.to}
              </li>
            ))}
          </ul>
        </div>
        <button
          onClick={fix}
          disabled={working}
          className="btn btn-primary shrink-0 text-xs disabled:opacity-50"
        >
          {working ? 'Fixing…' : 'Fix names'}
        </button>
      </div>
    </div>
  )
}
