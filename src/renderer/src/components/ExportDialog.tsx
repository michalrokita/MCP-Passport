import { useEffect, useMemo, useState } from 'react'
import { exportPlan, exportRun } from '../lib/api'
import type { ExportItemDescriptor, ExportPlan } from '../../../shared/types'
import { useToaster } from './Toaster'

type Group = {
  key: string
  label: string
  items: ExportItemDescriptor[]
}

export function ExportDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const toast = useToaster()
  const [plan, setPlan] = useState<ExportPlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [passphrase, setPassphrase] = useState('')
  const [passphrase2, setPassphrase2] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [includeSecrets, setIncludeSecrets] = useState(true)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const p = await exportPlan()
        if (cancelled) return
        setPlan(p)
        setSelected(new Set(p.items.filter((it) => it.defaultIncluded).map((it) => it.id)))
      } catch (e) {
        if (!cancelled) setPlanError((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const groups = useMemo<Group[]>(() => groupItems(plan?.items ?? []), [plan])

  const passphraseTooShort = passphrase.length > 0 && passphrase.length < 12
  const passphraseMismatch = passphrase2.length > 0 && passphrase !== passphrase2
  const canExport =
    !!plan &&
    selected.size > 0 &&
    passphrase.length >= 8 &&
    passphrase === passphrase2 &&
    !working

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleGroup(g: Group, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const it of g.items) {
        if (checked) next.add(it.id)
        else next.delete(it.id)
      }
      return next
    })
  }

  function selectAll(checked: boolean) {
    if (!plan) return
    if (!checked) {
      setSelected(new Set())
      return
    }
    setSelected(new Set(plan.items.map((it) => it.id)))
  }

  async function run() {
    if (!canExport || !plan) return
    setWorking(true)
    try {
      const res = await exportRun({
        passphrase,
        selectedIds: [...selected],
        includeSecrets
      })
      if (res.ok) {
        toast.show(res.message, 'ok')
        onClose()
      } else {
        toast.show(res.message, 'warn')
      }
    } catch (e) {
      toast.show(`Export failed: ${(e as Error).message}`, 'error')
    } finally {
      setWorking(false)
    }
  }

  const totalSelected = selected.size
  const secretsSelected = useMemo(() => {
    if (!plan) return 0
    return plan.items.filter((it) => selected.has(it.id) && it.hasSecrets).length
  }, [plan, selected])

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="surface flex max-h-[85vh] w-full max-w-3xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-500">
              Encrypted export
            </div>
            <div className="mt-0.5 text-sm font-semibold">Export MCP Passport bundle</div>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-100">
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {planError && (
            <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-200">
              Failed to read local state: {planError}
            </div>
          )}

          {!plan && !planError && (
            <div className="text-xs text-ink-500">Scanning…</div>
          )}

          {plan && (
            <>
              <PassphraseSection
                passphrase={passphrase}
                passphrase2={passphrase2}
                showPass={showPass}
                tooShort={passphraseTooShort}
                mismatch={passphraseMismatch}
                onPass={setPassphrase}
                onPass2={setPassphrase2}
                onShow={setShowPass}
              />

              <div className="mt-4 flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                <input
                  id="include-secrets"
                  type="checkbox"
                  checked={includeSecrets}
                  onChange={(e) => setIncludeSecrets(e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent"
                />
                <label htmlFor="include-secrets" className="flex-1 text-xs text-ink-200">
                  <span className="font-medium">Include secrets</span>
                  <span className="ml-2 text-ink-500">
                    Env vars, headers, and OAuth tokens (mcp-auth). Off → only var names are
                    exported.
                  </span>
                </label>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Items ({plan.items.length})
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

              <div className="mt-2 space-y-3">
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
                          onChange={(e) => toggleGroup(g, e.target.checked)}
                          className="h-3.5 w-3.5 accent-accent"
                        />
                        <span className="font-semibold uppercase tracking-wider">{g.label}</span>
                        <span className="ml-auto text-ink-500">
                          {groupSelected}/{g.items.length}
                        </span>
                      </label>
                      <div className="divide-y divide-white/5">
                        {g.items.map((it) => (
                          <ItemRow
                            key={it.id}
                            item={it}
                            checked={selected.has(it.id)}
                            onToggle={() => toggleOne(it.id)}
                            includeSecrets={includeSecrets}
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

        <footer className="flex items-center justify-between border-t border-white/5 px-5 py-3 text-xs">
          <div className="text-ink-500">
            {plan
              ? `${totalSelected} of ${plan.items.length} item${plan.items.length === 1 ? '' : 's'} selected${secretsSelected ? ` · ${secretsSelected} carry secrets` : ''}`
              : ''}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn btn-ghost text-xs">
              Cancel
            </button>
            <button
              disabled={!canExport}
              onClick={run}
              className="btn btn-primary text-xs disabled:opacity-50"
            >
              {working ? 'Encrypting…' : `Export ${totalSelected} item${totalSelected === 1 ? '' : 's'}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function PassphraseSection({
  passphrase,
  passphrase2,
  showPass,
  tooShort,
  mismatch,
  onPass,
  onPass2,
  onShow
}: {
  passphrase: string
  passphrase2: string
  showPass: boolean
  tooShort: boolean
  mismatch: boolean
  onPass: (v: string) => void
  onPass2: (v: string) => void
  onShow: (v: boolean) => void
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
        Passphrase
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input
          type={showPass ? 'text' : 'password'}
          value={passphrase}
          onChange={(e) => onPass(e.target.value)}
          placeholder="Passphrase"
          autoFocus
          className="rounded-md border border-white/10 bg-ink-900 px-3 py-1.5 text-xs text-ink-100 placeholder:text-ink-500 focus:border-accent focus:outline-none"
        />
        <input
          type={showPass ? 'text' : 'password'}
          value={passphrase2}
          onChange={(e) => onPass2(e.target.value)}
          placeholder="Confirm"
          className="rounded-md border border-white/10 bg-ink-900 px-3 py-1.5 text-xs text-ink-100 placeholder:text-ink-500 focus:border-accent focus:outline-none"
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <label className="flex cursor-pointer items-center gap-1.5 text-ink-400">
          <input
            type="checkbox"
            checked={showPass}
            onChange={(e) => onShow(e.target.checked)}
            className="h-3 w-3 accent-accent"
          />
          Show
        </label>
        <div className="text-ink-500">
          {mismatch ? (
            <span className="text-amber-300">Passphrases don't match</span>
          ) : tooShort ? (
            <span className="text-amber-300">Use at least 12 characters for real protection</span>
          ) : passphrase && !mismatch ? (
            <span className="text-emerald-300">Looks good</span>
          ) : (
            <span>The bundle can only be opened with this passphrase. There's no recovery.</span>
          )}
        </div>
      </div>
    </div>
  )
}

function ItemRow({
  item,
  checked,
  onToggle,
  includeSecrets
}: {
  item: ExportItemDescriptor
  checked: boolean
  onToggle: () => void
  includeSecrets: boolean
}) {
  const dimmed = item.kind === 'mcp-auth' && !includeSecrets
  return (
    <label
      className={
        'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs ' +
        (dimmed ? 'cursor-not-allowed opacity-40' : 'hover:bg-white/[0.03]')
      }
    >
      <input
        type="checkbox"
        disabled={dimmed}
        checked={checked && !dimmed}
        onChange={onToggle}
        className="h-3 w-3 accent-accent"
      />
      <span className="flex-1 truncate text-ink-100">{item.name}</span>
      {item.subtitle && <span className="truncate text-ink-500">{item.subtitle}</span>}
      {item.hasSecrets && (
        <span className="rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-300">
          secrets
        </span>
      )}
      {item.approxBytes !== undefined && item.approxBytes > 0 && (
        <span className="text-ink-500">{formatBytes(item.approxBytes)}</span>
      )}
    </label>
  )
}

function groupItems(items: ExportItemDescriptor[]): Group[] {
  const lib: ExportItemDescriptor[] = []
  const auth: ExportItemDescriptor[] = []
  const byTool: Record<string, ExportItemDescriptor[]> = {}
  for (const it of items) {
    if (it.kind === 'library-mcp' || it.kind === 'library-skill') {
      lib.push(it)
    } else if (it.kind === 'mcp-auth') {
      auth.push(it)
    } else {
      const key = it.scope === 'project' && it.projectPath
        ? `${it.toolId}:project:${it.projectPath}`
        : `${it.toolId}:${it.scope ?? 'global'}`
      ;(byTool[key] ??= []).push(it)
    }
  }
  const out: Group[] = []
  if (lib.length) out.push({ key: 'lib', label: 'Passport library', items: lib })
  for (const [key, list] of Object.entries(byTool)) {
    out.push({ key, label: prettyToolKey(key, list[0]), items: list })
  }
  if (auth.length) out.push({ key: 'auth', label: 'mcp-auth (OAuth tokens)', items: auth })
  return out
}

function prettyToolKey(_key: string, sample: ExportItemDescriptor): string {
  const tool = sample.toolId ?? '?'
  if (sample.scope === 'project' && sample.projectPath) {
    return `${tool} · project: ${shortPath(sample.projectPath)}`
  }
  return `${tool} · ${sample.scope ?? 'global'}`
}

function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~').split('/').slice(-2).join('/')
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
