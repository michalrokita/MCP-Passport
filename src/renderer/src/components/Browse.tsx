import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  RegistryCatalog,
  RegistryCategory,
  RegistryEntry
} from '../../../shared/types'
import { useApp } from '../lib/store'
import { useToaster } from './Toaster'

type SortKey = 'name' | 'source' | 'has-install' | 'category'

interface Filters {
  // Sources to include (empty array = all)
  sources: Set<string>
  // Categories to include (empty = all)
  categories: Set<RegistryCategory>
  transport: 'all' | 'stdio' | 'remote'
  installableOnly: boolean
  hideSaved: boolean
  sort: SortKey
  // Client-side filter applied to currently-loaded results (no network).
  localQuery: string
}

const DEFAULT_FILTERS: Filters = {
  sources: new Set(),
  categories: new Set(),
  transport: 'all',
  installableOnly: false,
  hideSaved: false,
  sort: 'name',
  localQuery: ''
}

const CATEGORY_LABELS: Record<RegistryCategory, string> = {
  productivity: 'Productivity',
  communication: 'Communication',
  'dev-tools': 'Dev Tools',
  database: 'Database',
  monitoring: 'Monitoring',
  browser: 'Browser',
  'search-web': 'Search & Web',
  cloud: 'Cloud',
  files: 'Files',
  'ai-vector': 'AI & Vector',
  memory: 'Memory',
  finance: 'Finance',
  design: 'Design',
  other: 'Other'
}

const CATEGORY_ORDER: RegistryCategory[] = [
  'productivity',
  'communication',
  'dev-tools',
  'database',
  'monitoring',
  'browser',
  'search-web',
  'cloud',
  'files',
  'ai-vector',
  'memory',
  'finance',
  'design',
  'other'
]

export function Browse(): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const scan = useApp((s) => s.scan)
  const query = useApp((s) => s.query)
  const activeKind = useApp((s) => s.activeKind)
  const [catalog, setCatalog] = useState<RegistryCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const toast = useToaster()
  const reqRef = useRef(0)

  const supported = activeKind === 'mcp' || activeKind === 'skill'

  // Reset filters when changing kind so source chips don't carry stale names.
  useEffect(() => {
    setFilters(DEFAULT_FILTERS)
  }, [activeKind])

  const runSearch = async (bypassCache: boolean): Promise<void> => {
    if (!supported) {
      setCatalog({ fetchedAt: new Date().toISOString(), entries: [], source: 'bundled' })
      setLoading(false)
      return
    }
    const id = ++reqRef.current
    if (bypassCache) setRefreshing(true)
    else setLoading(!catalog) // only show full skeleton when nothing is on screen yet
    try {
      const result = await window.api.registrySearch(query, activeKind, { bypassCache })
      if (reqRef.current !== id) return // stale
      setCatalog(result)
    } finally {
      if (reqRef.current === id) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  // Debounced search on query/kind change.
  useEffect(() => {
    const handle = setTimeout(() => {
      void runSearch(false)
    }, query ? 300 : 0)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function clearCache(): Promise<void> {
    const r = await window.api.registryClearCache()
    toast.show(r.message, r.ok ? 'ok' : 'error')
    if (r.ok) void runSearch(true)
  }

  // All sources we know about for this kind, derived from current catalog or defaults.
  const knownSources = useMemo<string[]>(() => {
    const fromResults = new Set<string>()
    for (const e of catalog?.entries ?? []) if (e.source) fromResults.add(e.source)
    if (fromResults.size > 0) return Array.from(fromResults).sort()
    return activeKind === 'mcp'
      ? ['modelcontextprotocol.io', 'smithery.ai', 'glama.ai', 'curated']
      : ['anthropics/skills', 'openai/skills', 'curated']
  }, [catalog, activeKind])

  // Per-category counts (computed against pre-filter set so chips show useful sizes).
  const categoryCounts = useMemo<Record<RegistryCategory, number>>(() => {
    const counts: Record<string, number> = {}
    for (const e of catalog?.entries ?? []) {
      const c = e.category ?? 'other'
      counts[c] = (counts[c] ?? 0) + 1
    }
    return counts as Record<RegistryCategory, number>
  }, [catalog])

  // Apply client-side filters + sort.
  const visibleEntries = useMemo<RegistryEntry[]>(() => {
    let list = catalog?.entries ?? []
    if (filters.sources.size > 0) {
      list = list.filter((e) => e.source && filters.sources.has(e.source))
    }
    if (filters.categories.size > 0) {
      list = list.filter((e) => filters.categories.has((e.category ?? 'other') as RegistryCategory))
    }
    if (filters.transport !== 'all') {
      list = list.filter((e) => {
        if (!e.canonical) return false
        if (filters.transport === 'stdio') return e.canonical.transport === 'stdio'
        return e.canonical.transport === 'http' || e.canonical.transport === 'sse'
      })
    }
    if (filters.installableOnly) {
      list = list.filter((e) => e.canonical || e.kind === 'skill')
    }
    if (filters.hideSaved) {
      list = list.filter((e) => !inLibrary.has(`${e.kind}:${e.name.toLowerCase()}`))
    }
    const lq = filters.localQuery.trim().toLowerCase()
    if (lq) {
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(lq) ||
          (e.description ?? '').toLowerCase().includes(lq) ||
          (e.publisher ?? '').toLowerCase().includes(lq) ||
          (e.canonical?.url ?? '').toLowerCase().includes(lq)
      )
    }
    list = [...list]
    if (filters.sort === 'name') {
      list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    } else if (filters.sort === 'source') {
      list.sort((a, b) => {
        const sa = (a.source ?? '').localeCompare(b.source ?? '')
        if (sa !== 0) return sa
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      })
    } else if (filters.sort === 'has-install') {
      list.sort((a, b) => {
        const ia = a.canonical ? 0 : 1
        const ib = b.canonical ? 0 : 1
        if (ia !== ib) return ia - ib
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      })
    } else if (filters.sort === 'category') {
      list.sort((a, b) => {
        const ca = CATEGORY_LABELS[a.category ?? 'other']
        const cb = CATEGORY_LABELS[b.category ?? 'other']
        const cs = ca.localeCompare(cb)
        if (cs !== 0) return cs
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      })
    }
    return list
  }, [catalog, filters, inLibrary])

  return (
    <div>
      <SourceStatusBar
        kind={activeKind}
        catalog={catalog}
        loading={loading || refreshing}
        onRefresh={() => void runSearch(true)}
        onClearCache={clearCache}
      />

      <FilterBar
        filters={filters}
        onChange={setFilters}
        sources={knownSources}
        categoryCounts={categoryCounts}
        totalEntries={catalog?.entries.length ?? 0}
        visibleEntries={visibleEntries.length}
      />

      {loading && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      )}

      {!loading && visibleEntries.length === 0 && (
        <div className="mx-auto max-w-md py-8 text-center text-sm text-ink-400">
          No matches with the current filters. Try clearing them or refining your search.
        </div>
      )}

      {!loading && visibleEntries.length > 0 && (
        <div className="space-y-2">
          {visibleEntries.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              busy={busy === e.id}
              alreadySaved={inLibrary.has(`${e.kind}:${e.name.toLowerCase()}`)}
              onAdd={() => add(e)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SourceStatusBar({
  kind,
  catalog,
  loading,
  onRefresh,
  onClearCache
}: {
  kind: 'mcp' | 'skill' | 'plugin' | 'agent'
  catalog: RegistryCatalog | null
  loading: boolean
  onRefresh: () => void
  onClearCache: () => void
}): JSX.Element {
  const sources = catalog?.sources ?? []
  const cache = catalog?.cache
  const knownNames =
    kind === 'mcp'
      ? ['modelcontextprotocol.io', 'smithery.ai', 'glama.ai', 'curated']
      : ['anthropics/skills', 'openai/skills', 'curated']

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-ink-400">Sources:</span>
      {knownNames.map((name) => {
        const found = sources.find((s) => s.name === name)
        const status: 'loading' | 'ok' | 'fail' | 'idle' = loading
          ? 'loading'
          : found
          ? found.status === 'ok'
            ? 'ok'
            : 'fail'
          : 'idle'
        return (
          <span
            key={name}
            title={
              status === 'ok'
                ? `${name}: ${found?.count ?? 0} results`
                : status === 'fail'
                ? `${name}: failed`
                : status === 'loading'
                ? `${name}: loading…`
                : `${name}: cached or unknown`
            }
            className={
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ' +
              (status === 'loading'
                ? 'border-white/10 bg-white/5 text-ink-400'
                : status === 'ok'
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                : status === 'fail'
                ? 'border-red-400/30 bg-red-400/10 text-red-200'
                : 'border-white/10 bg-white/0 text-ink-500')
            }
          >
            {status === 'loading' && (
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            )}
            {status === 'ok' && <span className="text-[10px]">●</span>}
            {status === 'fail' && <span className="text-[10px]">!</span>}
            {status === 'idle' && <span className="text-[10px]">·</span>}
            <span>{name}</span>
            {status === 'ok' && found && (
              <span className="text-[10px] tabular-nums opacity-80">{found.count}</span>
            )}
          </span>
        )
      })}

      <span className="ml-auto flex items-center gap-2 text-ink-500">
        {cache?.fromCache && (
          <span title={`Cached ${formatAge(cache.ageMs)} ago`}>
            {cache.fresh
              ? `Cached ${formatAge(cache.ageMs)} ago`
              : `Stale (${formatAge(cache.ageMs)} old) — refreshing…`}
          </span>
        )}
        {!cache?.fromCache && catalog && !loading && <span>Live</span>}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="btn btn-ghost text-xs disabled:opacity-50"
          title="Re-fetch from registries (bypass cache)"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          onClick={onClearCache}
          className="btn btn-ghost text-[11px] text-ink-500 hover:text-ink-200"
          title="Clear all cached search results from disk"
        >
          Clear cache
        </button>
      </span>
    </div>
  )
}

function FilterBar({
  filters,
  onChange,
  sources,
  categoryCounts,
  totalEntries,
  visibleEntries
}: {
  filters: Filters
  onChange: (f: Filters) => void
  sources: string[]
  categoryCounts: Record<RegistryCategory, number>
  totalEntries: number
  visibleEntries: number
}): JSX.Element {
  function toggleSource(name: string): void {
    const next = new Set(filters.sources)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    onChange({ ...filters, sources: next })
  }

  function toggleCategory(c: RegistryCategory): void {
    const next = new Set(filters.categories)
    if (next.has(c)) next.delete(c)
    else next.add(c)
    onChange({ ...filters, categories: next })
  }

  const allSourcesSelected = filters.sources.size === 0
  const allCategoriesSelected = filters.categories.size === 0

  // Only show categories that actually appear in the current result set.
  const presentCategories = CATEGORY_ORDER.filter((c) => (categoryCounts[c] ?? 0) > 0)

  return (
    <div className="mb-3 space-y-1.5 rounded-md border border-white/5 bg-ink-900/40 p-2 text-xs">
      {/* Row 1: client-side filter search + sort */}
      <div className="flex items-center gap-2">
        <input
          value={filters.localQuery}
          onChange={(e) => onChange({ ...filters, localQuery: e.target.value })}
          placeholder="Filter visible results…"
          className="w-64 rounded-md border border-white/10 bg-ink-900 px-3 py-1 text-xs text-ink-100 placeholder:text-ink-500 focus:border-accent focus:outline-none"
        />
        {filters.localQuery && (
          <button
            onClick={() => onChange({ ...filters, localQuery: '' })}
            className="text-[11px] text-ink-500 hover:text-ink-200"
          >
            Clear
          </button>
        )}
        <span className="text-[11px] text-ink-500">
          Filters in-memory · global Search… box hits registries
        </span>
        <span className="ml-auto flex items-center gap-2 text-ink-500">
          <span>
            {visibleEntries === totalEntries
              ? `${totalEntries} result${totalEntries === 1 ? '' : 's'}`
              : `${visibleEntries} of ${totalEntries}`}
          </span>
          <select
            value={filters.sort}
            onChange={(e) => onChange({ ...filters, sort: e.target.value as SortKey })}
            className="rounded border border-white/10 bg-ink-900 px-2 py-0.5 text-[11px] text-ink-200"
            title="Sort"
          >
            <option value="name">Sort: name</option>
            <option value="source">Sort: source</option>
            <option value="category">Sort: category</option>
            <option value="has-install">Sort: installable first</option>
          </select>
        </span>
      </div>

      {/* Row 2: categories */}
      {presentCategories.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[10px] uppercase tracking-wider text-ink-500">
            Category
          </span>
          <Chip
            active={allCategoriesSelected}
            onClick={() => onChange({ ...filters, categories: new Set() })}
          >
            All
          </Chip>
          {presentCategories.map((c) => (
            <Chip
              key={c}
              active={filters.categories.has(c)}
              onClick={() => toggleCategory(c)}
            >
              {CATEGORY_LABELS[c]}
              <span className="ml-1 text-[10px] tabular-nums opacity-70">
                {categoryCounts[c]}
              </span>
            </Chip>
          ))}
        </div>
      )}

      {/* Row 3: source + transport + flags */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[10px] uppercase tracking-wider text-ink-500">Source</span>
        <Chip
          active={allSourcesSelected}
          onClick={() => onChange({ ...filters, sources: new Set() })}
        >
          All
        </Chip>
        {sources.map((name) => (
          <Chip
            key={name}
            active={filters.sources.has(name)}
            onClick={() => toggleSource(name)}
          >
            {name}
          </Chip>
        ))}

        <Divider />

        <Chip
          active={filters.transport === 'all'}
          onClick={() => onChange({ ...filters, transport: 'all' })}
        >
          All transports
        </Chip>
        <Chip
          active={filters.transport === 'stdio'}
          onClick={() => onChange({ ...filters, transport: 'stdio' })}
        >
          stdio
        </Chip>
        <Chip
          active={filters.transport === 'remote'}
          onClick={() => onChange({ ...filters, transport: 'remote' })}
        >
          remote
        </Chip>

        <Divider />

        <Chip
          active={filters.installableOnly}
          onClick={() => onChange({ ...filters, installableOnly: !filters.installableOnly })}
        >
          Installable only
        </Chip>
        <Chip
          active={filters.hideSaved}
          onClick={() => onChange({ ...filters, hideSaved: !filters.hideSaved })}
        >
          Hide saved
        </Chip>
      </div>
    </div>
  )
}

function Chip({
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
        'whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ' +
        (active
          ? 'border-accent/40 bg-accent/15 text-accent-soft'
          : 'border-white/10 bg-white/5 text-ink-300 hover:text-ink-100')
      }
    >
      {children}
    </button>
  )
}

function Divider(): JSX.Element {
  return <span className="mx-1 h-4 w-px bg-white/10" />
}

function SkeletonRow(): JSX.Element {
  return (
    <div className="surface flex animate-pulse items-start gap-4 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-3.5 w-32 rounded bg-white/10" />
          <div className="h-3 w-16 rounded bg-white/5" />
          <div className="h-3 w-12 rounded bg-white/5" />
        </div>
        <div className="h-3 w-full max-w-md rounded bg-white/5" />
        <div className="h-3 w-2/3 max-w-sm rounded bg-white/5" />
      </div>
      <div className="h-7 w-16 shrink-0 rounded-md bg-white/5" />
    </div>
  )
}

function EntryRow({
  entry: e,
  busy,
  alreadySaved,
  onAdd
}: {
  entry: RegistryEntry
  busy: boolean
  alreadySaved: boolean
  onAdd: () => void
}): JSX.Element {
  return (
    <div className="surface flex items-start gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-ink-50">{e.name}</div>
          {e.publisher && <span className="text-[11px] text-ink-500">· {e.publisher}</span>}
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
          {e.category && e.category !== 'other' && (
            <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-400">
              {CATEGORY_LABELS[e.category]}
            </span>
          )}
          {alreadySaved && (
            <span className="rounded border border-accent/40 bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent-soft">
              In library
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
        disabled={alreadySaved || busy || (e.kind === 'mcp' && !e.canonical)}
        onClick={onAdd}
        className="btn btn-outline shrink-0 whitespace-nowrap text-xs disabled:opacity-50"
        title={
          alreadySaved
            ? 'Already in your Passport library'
            : e.kind === 'mcp' && !e.canonical
            ? 'Add manually with + Add MCP — homepage has setup steps'
            : 'Save to your Passport library'
        }
      >
        {alreadySaved
          ? 'In library'
          : busy
          ? 'Adding…'
          : e.kind === 'mcp' && !e.canonical
          ? 'Manual'
          : 'Add'}
      </button>
    </div>
  )
}

function SourceBadge({ source }: { source: string }): JSX.Element {
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

function formatAge(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr`
  const day = Math.floor(hr / 24)
  return `${day} day${day === 1 ? '' : 's'}`
}
