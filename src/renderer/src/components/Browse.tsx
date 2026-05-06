import { useEffect, useMemo, useRef, useState } from 'react'
import type { RegistryCatalog, RegistryEntry } from '../../../shared/types'
import { useApp } from '../lib/store'
import { useToaster } from './Toaster'

export function Browse(): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const scan = useApp((s) => s.scan)
  const query = useApp((s) => s.query)
  const activeKind = useApp((s) => s.activeKind)
  const [catalog, setCatalog] = useState<RegistryCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToaster()
  const reqRef = useRef(0)

  const supported = activeKind === 'mcp' || activeKind === 'skill'

  // Debounced live search.
  useEffect(() => {
    if (!supported) {
      setCatalog({ fetchedAt: new Date().toISOString(), entries: [], source: 'bundled' })
      setLoading(false)
      return
    }
    setLoading(true)
    const id = ++reqRef.current
    const handle = setTimeout(async () => {
      try {
        const result = await window.api.registrySearch(query, activeKind)
        if (reqRef.current !== id) return // stale
        setCatalog(result)
      } finally {
        if (reqRef.current === id) setLoading(false)
      }
    }, query ? 300 : 0)
    return () => clearTimeout(handle)
  }, [query, activeKind, supported])

  const inLibrary = useMemo(() => {
    return new Set(
      (scan?.items ?? [])
        .filter((it) => it.presences.some((p) => p.toolId === 'passport'))
        .map((it) => `${it.kind}:${it.name.toLowerCase()}`)
    )
  }, [scan])

  if (!supported) {
    return (
      <div className="mx-auto max-w-md text-center text-sm text-ink-400">
        Browsing the store is currently available for MCPs and skills. Plugins and agents
        come from each tool's own marketplace.
      </div>
    )
  }

  async function add(entry: RegistryEntry): Promise<void> {
    setBusy(entry.id)
    try {
      const r = await window.api.registryAddToLibrary(entry)
      toast.show(r.message, r.ok ? 'ok' : 'error')
      if (r.ok) void refresh()
    } finally {
      setBusy(null)
    }
  }

  const entries = catalog?.entries ?? []

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-ink-400">
        <span>
          Searching{' '}
          {activeKind === 'mcp' ? (
            <>
              <Source name="modelcontextprotocol.io" /> · <Source name="smithery.ai" /> ·{' '}
              <Source name="glama.ai" /> · curated
            </>
          ) : (
            <>
              <Source name="anthropics/skills" /> · <Source name="openai/skills" /> · curated
            </>
          )}
        </span>
        <span className="ml-auto text-ink-500">
          {loading ? 'Searching…' : `${entries.length} result${entries.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {entries.length === 0 && !loading && (
        <div className="mx-auto max-w-md py-8 text-center text-sm text-ink-400">
          No matches. Try different keywords, or use the search box above.
        </div>
      )}

      <div className="space-y-2">
        {entries.map((e) => {
          const already = inLibrary.has(`${e.kind}:${e.name.toLowerCase()}`)
          return (
            <div key={e.id} className="surface flex items-start gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-ink-50">{e.name}</div>
                  {e.publisher && (
                    <span className="text-[11px] text-ink-500">· {e.publisher}</span>
                  )}
                  {e.source && <SourceBadge source={e.source} />}
                  {e.canonical?.transport && e.canonical.transport !== 'stdio' && (
                    <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-cyan-200">
                      {e.canonical.transport}
                    </span>
                  )}
                  {e.canonical?.transport === 'stdio' && (
                    <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-300">
                      stdio
                    </span>
                  )}
                  {!e.canonical && e.kind === 'mcp' && (
                    <span
                      title="No canonical install in the listing — open the homepage for setup."
                      className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-200"
                    >
                      Browse only
                    </span>
                  )}
                </div>
                {e.description && (
                  <div className="mt-1 line-clamp-2 text-xs text-ink-400">{e.description}</div>
                )}
                {e.canonical?.url && (
                  <div className="mt-1 break-all font-mono text-[11px] text-ink-500">
                    {e.canonical.url}
                  </div>
                )}
                {e.canonical?.command && (
                  <div className="mt-1 font-mono text-[11px] text-ink-500">
                    {e.canonical.command} {e.canonical.args?.join(' ')}
                  </div>
                )}
                {e.envVars && e.envVars.length > 0 && (
                  <div className="mt-1 text-[11px] text-amber-300/80">
                    Requires env: {e.envVars.map((v) => v.name).join(', ')}
                  </div>
                )}
                {e.homepage && (
                  <button
                    onClick={() => void window.api.openExternal(e.homepage!)}
                    className="mt-1 text-[11px] text-accent-soft hover:underline"
                  >
                    Open homepage ↗
                  </button>
                )}
              </div>
              <button
                disabled={already || busy === e.id || (e.kind === 'mcp' && !e.canonical)}
                onClick={() => add(e)}
                className="btn btn-outline shrink-0 whitespace-nowrap text-xs disabled:opacity-50"
                title={
                  already
                    ? 'Already in your Passport library'
                    : e.kind === 'mcp' && !e.canonical
                    ? 'Add manually with + Add MCP — homepage has setup steps'
                    : 'Save to your Passport library'
                }
              >
                {already
                  ? 'In library'
                  : busy === e.id
                  ? 'Adding…'
                  : e.kind === 'mcp' && !e.canonical
                  ? 'Manual'
                  : 'Add'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Source({ name }: { name: string }) {
  return <span className="text-ink-300">{name}</span>
}

function SourceBadge({ source }: { source: string }) {
  const tone =
    source === 'modelcontextprotocol.io'
      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
      : source === 'smithery.ai'
      ? 'border-violet-400/30 bg-violet-400/10 text-violet-200'
      : source === 'glama.ai'
      ? 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200'
      : source === 'curated'
      ? 'border-accent/40 bg-accent/15 text-accent-soft'
      : 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200'
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}
    >
      {source}
    </span>
  )
}
