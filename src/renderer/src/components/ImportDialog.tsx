import { useMemo, useState } from 'react'
import { importApply, importPickFile, importPlan } from '../lib/api'
import type {
  ConflictAction,
  ImportApplyOutcome,
  ImportPlan,
  ImportPlanItem
} from '../../../shared/types'
import { useApp } from '../lib/store'
import { useToaster } from './Toaster'

type Stage = 'pick' | 'passphrase' | 'review' | 'applying' | 'done'

export function ImportDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const toast = useToaster()
  const [stage, setStage] = useState<Stage>('pick')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [planError, setPlanError] = useState<string | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [decisions, setDecisions] = useState<Record<string, ConflictAction>>({})
  const [outcomes, setOutcomes] = useState<ImportApplyOutcome[] | null>(null)
  const [busy, setBusy] = useState(false)

  async function pickFile() {
    setBusy(true)
    try {
      const p = await importPickFile()
      if (!p) return
      setFilePath(p)
      setStage('passphrase')
    } finally {
      setBusy(false)
    }
  }

  async function decrypt() {
    if (!filePath || !passphrase) return
    setBusy(true)
    setPlanError(null)
    try {
      const p = await importPlan({ filePath, passphrase })
      setPlan(p)
      const init: Record<string, ConflictAction> = {}
      for (const it of p.items) init[it.id] = it.defaultAction
      setDecisions(init)
      setStage('review')
    } catch (e) {
      setPlanError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!plan || !filePath || !passphrase) return
    setBusy(true)
    setStage('applying')
    try {
      const res = await importApply({ filePath, passphrase, decisions })
      setOutcomes(res.outcomes)
      const okCount = res.outcomes.filter((o) => o.ok).length
      const failCount = res.outcomes.length - okCount
      toast.show(res.message, failCount === 0 ? 'ok' : 'warn')
      setStage('done')
      void refresh()
    } catch (e) {
      toast.show(`Import failed: ${(e as Error).message}`, 'error')
      setStage('review')
    } finally {
      setBusy(false)
    }
  }

  function setAction(id: string, action: ConflictAction) {
    setDecisions((prev) => ({ ...prev, [id]: action }))
  }

  function bulkAction(action: ConflictAction) {
    if (!plan) return
    setDecisions((prev) => {
      const next = { ...prev }
      for (const it of plan.items) {
        if (it.protected) continue
        if (it.status === 'identical') continue // never re-apply identical items
        next[it.id] = action
      }
      return next
    })
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={stage === 'applying' ? undefined : onClose}
    >
      <div
        className="surface flex max-h-[85vh] w-full max-w-3xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-500">
              Encrypted import
            </div>
            <div className="mt-0.5 text-sm font-semibold">Open MCP Passport bundle</div>
          </div>
          <button
            onClick={onClose}
            disabled={stage === 'applying'}
            className="text-ink-400 hover:text-ink-100 disabled:opacity-30"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {stage === 'pick' && (
            <PickStage onPick={pickFile} busy={busy} />
          )}
          {stage === 'passphrase' && (
            <PassphraseStage
              filePath={filePath ?? ''}
              passphrase={passphrase}
              busy={busy}
              error={planError}
              onPass={setPassphrase}
              onBack={() => {
                setStage('pick')
                setPlanError(null)
              }}
              onSubmit={decrypt}
            />
          )}
          {stage === 'review' && plan && (
            <ReviewStage
              plan={plan}
              decisions={decisions}
              onAction={setAction}
              onBulk={bulkAction}
            />
          )}
          {(stage === 'applying' || stage === 'done') && (
            <OutcomesStage outcomes={outcomes} busy={stage === 'applying'} />
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-white/5 px-5 py-3 text-xs">
          {stage === 'review' && plan && (
            <>
              <span className="mr-auto text-ink-500">
                {countByStatus(plan)} · resolutions: {countByAction(plan, decisions)}
              </span>
              <button onClick={onClose} className="btn btn-ghost text-xs">
                Cancel
              </button>
              <button onClick={apply} disabled={busy} className="btn btn-primary text-xs">
                Apply
              </button>
            </>
          )}
          {stage === 'done' && (
            <button onClick={onClose} className="btn btn-primary text-xs">
              Done
            </button>
          )}
          {(stage === 'pick' || stage === 'passphrase') && (
            <button onClick={onClose} className="btn btn-ghost text-xs">
              Cancel
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

function PickStage({ onPick, busy }: { onPick: () => void; busy: boolean }) {
  return (
    <div className="rounded-md border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
      <div className="text-sm text-ink-200">Choose a .mcppassport file to open.</div>
      <div className="mt-1 text-xs text-ink-500">
        You'll be asked for the passphrase used at export time.
      </div>
      <button
        onClick={onPick}
        disabled={busy}
        className="btn btn-primary mt-4 text-xs disabled:opacity-50"
      >
        Choose file
      </button>
    </div>
  )
}

function PassphraseStage({
  filePath,
  passphrase,
  busy,
  error,
  onPass,
  onBack,
  onSubmit
}: {
  filePath: string
  passphrase: string
  busy: boolean
  error: string | null
  onPass: (v: string) => void
  onBack: () => void
  onSubmit: () => void
}) {
  return (
    <div>
      <div className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs text-ink-400">
        <span className="text-ink-500">File: </span>
        <span className="font-mono text-ink-200">{shortPath(filePath)}</span>
      </div>
      <div className="mt-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Passphrase
        </div>
        <input
          type="password"
          value={passphrase}
          onChange={(e) => onPass(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && passphrase) onSubmit()
          }}
          className="mt-2 w-full rounded-md border border-white/10 bg-ink-900 px-3 py-2 text-xs text-ink-100 placeholder:text-ink-500 focus:border-accent focus:outline-none"
        />
        {error && (
          <div className="mt-2 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button onClick={onBack} className="btn btn-ghost text-xs">
          ← Back
        </button>
        <button
          onClick={onSubmit}
          disabled={busy || !passphrase}
          className="btn btn-primary text-xs disabled:opacity-50"
        >
          {busy ? 'Decrypting…' : 'Decrypt'}
        </button>
      </div>
    </div>
  )
}

function ReviewStage({
  plan,
  decisions,
  onAction,
  onBulk
}: {
  plan: ImportPlan
  decisions: Record<string, ConflictAction>
  onAction: (id: string, a: ConflictAction) => void
  onBulk: (a: ConflictAction) => void
}) {
  const grouped = useMemo(() => groupByStatus(plan.items), [plan.items])
  return (
    <div>
      {plan.crossPlatform && (
        <div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
          <div className="font-semibold">Cross-platform import</div>
          <div className="mt-0.5 text-amber-300/80">
            This bundle was exported on <span className="font-mono">{plan.originOS}</span>; you're
            importing on <span className="font-mono">{process_platform()}</span>. Skill scripts and
            absolute paths may need manual fixes after import.
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <BundleField label="Exported" value={new Date(plan.exportedAt).toLocaleString()} />
        <BundleField label="From host" value={plan.originHost} />
        <BundleField label="Bundle version" value={plan.appVersion} />
        <BundleField
          label="Secrets included"
          value={plan.includesSecrets ? 'Yes' : 'No (env names only)'}
        />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Items ({plan.items.length})
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-500">Resolve all conflicts:</span>
          <button onClick={() => onBulk('skip')} className="text-ink-400 hover:text-ink-100">
            Skip
          </button>
          <span className="text-ink-700">·</span>
          <button onClick={() => onBulk('overwrite')} className="text-amber-300 hover:text-amber-200">
            Overwrite
          </button>
          <span className="text-ink-700">·</span>
          <button onClick={() => onBulk('keep-both')} className="text-ink-400 hover:text-ink-100">
            Keep both
          </button>
        </div>
      </div>

      <div className="mt-2 space-y-3">
        {(['conflict', 'new', 'protected', 'identical'] as const).map((s) => {
          const list = grouped[s] ?? []
          if (!list.length) return null
          return (
            <div key={s} className="rounded-md border border-white/10">
              <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                <StatusBadge status={s} />
                <span>{statusLabel(s)}</span>
                <span className="ml-auto text-ink-500">{list.length}</span>
              </div>
              <div className="divide-y divide-white/5">
                {list.map((it) => (
                  <ImportItemRow
                    key={it.id}
                    item={it}
                    action={decisions[it.id] ?? 'skip'}
                    onAction={(a) => onAction(it.id, a)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ImportItemRow({
  item,
  action,
  onAction
}: {
  item: ImportPlanItem
  action: ConflictAction
  onAction: (a: ConflictAction) => void
}) {
  const locked = item.protected || item.status === 'identical'
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 text-xs">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-ink-100">{item.name}</span>
          <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-400">
            {item.kind}
          </span>
        </div>
        {item.subtitle && <div className="truncate text-ink-500">{item.subtitle}</div>}
        {item.diffSummary && (
          <div className="truncate text-amber-300/70">{item.diffSummary}</div>
        )}
      </div>
      <select
        disabled={locked}
        value={action}
        onChange={(e) => onAction(e.target.value as ConflictAction)}
        className="rounded-md border border-white/10 bg-ink-900 px-2 py-1 text-xs text-ink-200 disabled:opacity-40"
      >
        <option value="skip">Skip</option>
        {!item.protected && <option value="overwrite">{item.status === 'new' ? 'Import' : 'Overwrite'}</option>}
        {!item.protected && item.status !== 'identical' && (
          <option value="keep-both">Keep both</option>
        )}
      </select>
    </div>
  )
}

function OutcomesStage({
  outcomes,
  busy
}: {
  outcomes: ImportApplyOutcome[] | null
  busy: boolean
}) {
  if (busy) {
    return <div className="py-12 text-center text-sm text-ink-400">Applying changes…</div>
  }
  if (!outcomes) return null
  const okCount = outcomes.filter((o) => o.ok).length
  const writtenCount = outcomes.filter(
    (o) => o.ok && o.action !== 'skip' && o.action !== 'protected'
  ).length
  const skipCount = outcomes.filter((o) => o.action === 'skip' || o.action === 'protected').length
  const failCount = outcomes.length - okCount

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Imported" value={writtenCount} tone="ok" />
        <Stat label="Skipped" value={skipCount} tone="info" />
        <Stat label="Failed" value={failCount} tone={failCount ? 'error' : 'info'} />
      </div>
      <div className="mt-3 max-h-[40vh] divide-y divide-white/5 overflow-y-auto rounded-md border border-white/10">
        {outcomes.map((o) => (
          <div key={o.id} className="flex items-start gap-2 px-3 py-2 text-xs">
            <span className={o.ok ? 'text-emerald-300' : 'text-red-300'}>
              {o.ok ? '✓' : '✗'}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-ink-100">{o.name}</span>
              <span className="truncate text-ink-500">{o.message}</span>
            </div>
            <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-400">
              {o.action}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: ImportPlanItem['status'] }) {
  const cls = {
    new: 'bg-emerald-400/10 text-emerald-300',
    identical: 'bg-white/5 text-ink-400',
    conflict: 'bg-amber-400/10 text-amber-300',
    protected: 'bg-blue-400/10 text-blue-300'
  }[status]
  return (
    <span className={'rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider ' + cls}>
      {status}
    </span>
  )
}

function statusLabel(s: ImportPlanItem['status']): string {
  switch (s) {
    case 'new':
      return 'New'
    case 'identical':
      return 'Already in sync'
    case 'conflict':
      return 'Conflicts'
    case 'protected':
      return 'Protected (will not overwrite)'
  }
}

function BundleField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-ink-500">{label}</div>
      <div className="truncate text-ink-200">{value}</div>
    </div>
  )
}

function Stat({
  label,
  value,
  tone
}: {
  label: string
  value: number
  tone: 'ok' | 'info' | 'error'
}) {
  const cls = {
    ok: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    info: 'border-white/10 bg-white/5 text-ink-200',
    error: 'border-red-400/30 bg-red-400/10 text-red-200'
  }[tone]
  return (
    <div className={'rounded-md border px-3 py-2 ' + cls}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}

function groupByStatus(
  items: ImportPlanItem[]
): Record<ImportPlanItem['status'], ImportPlanItem[]> {
  const out: Record<ImportPlanItem['status'], ImportPlanItem[]> = {
    new: [],
    identical: [],
    conflict: [],
    protected: []
  }
  for (const it of items) out[it.status].push(it)
  return out
}

function countByStatus(plan: ImportPlan): string {
  const g = groupByStatus(plan.items)
  const parts: string[] = []
  if (g.new.length) parts.push(`${g.new.length} new`)
  if (g.conflict.length) parts.push(`${g.conflict.length} conflict`)
  if (g.identical.length) parts.push(`${g.identical.length} identical`)
  if (g.protected.length) parts.push(`${g.protected.length} protected`)
  return parts.join(' · ') || 'no items'
}

function countByAction(
  plan: ImportPlan,
  decisions: Record<string, ConflictAction>
): string {
  let imp = 0
  let skip = 0
  let keep = 0
  for (const it of plan.items) {
    if (it.protected) {
      skip++
      continue
    }
    const a = decisions[it.id] ?? it.defaultAction
    if (a === 'overwrite') imp++
    else if (a === 'keep-both') keep++
    else skip++
  }
  const parts: string[] = []
  if (imp) parts.push(`${imp} import`)
  if (keep) parts.push(`${keep} keep both`)
  if (skip) parts.push(`${skip} skip`)
  return parts.join(' · ')
}

function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~')
}

function process_platform(): string {
  // navigator.userAgentData isn't reliable in Electron renderer for darwin/win32 distinction;
  // we rely on UA sniff as a coarse hint, and "your machine" as a fallback.
  const ua = navigator.userAgent
  if (/Mac/i.test(ua)) return 'darwin'
  if (/Windows/i.test(ua)) return 'win32'
  if (/Linux/i.test(ua)) return 'linux'
  return 'this machine'
}
