import { useState } from 'react'
import type { ExtractSecretResult, McpSecretFinding } from '../../../shared/types'
import { mcpExtractSecret } from '../lib/api'
import { useApp } from '../lib/store'
import { useToaster } from './Toaster'
import { ToolIcon } from './ToolIcon'

export function SecretsDialog({
  findings,
  onClose
}: {
  findings: McpSecretFinding[]
  onClose: () => void
}): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const toast = useToaster()
  const [vars, setVars] = useState<Record<string, string>>({})
  const [results, setResults] = useState<Record<string, ExtractSecretResult>>({})
  const [busy, setBusy] = useState<string | null>(null)

  async function extract(f: McpSecretFinding) {
    setBusy(f.id)
    try {
      const res = await mcpExtractSecret({
        itemId: f.itemId,
        name: f.name,
        toolId: f.toolId,
        scope: f.scope,
        projectPath: f.projectPath,
        location: f.location,
        varName: vars[f.id] ?? f.suggestedVar
      })
      setResults((r) => ({ ...r, [f.id]: res }))
      toast.show(res.message, res.ok ? 'ok' : 'error')
      if (res.ok) void refresh()
    } catch (e) {
      toast.show(`Extract failed: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="surface flex max-h-[85vh] w-full max-w-2xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-500">Plaintext secrets</div>
            <div className="mt-0.5 text-sm font-semibold">
              {findings.length} found in your MCP configs
            </div>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-100">
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {findings.map((f) => (
            <FindingRow
              key={f.id}
              finding={f}
              varName={vars[f.id] ?? f.suggestedVar}
              onVarChange={(v) => setVars((s) => ({ ...s, [f.id]: v }))}
              result={results[f.id]}
              busy={busy === f.id}
              onExtract={() => extract(f)}
            />
          ))}
        </div>

        <footer className="flex items-center justify-end border-t border-white/5 px-5 py-3">
          <button onClick={onClose} className="btn btn-ghost text-xs">
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}

function FindingRow({
  finding: f,
  varName,
  onVarChange,
  result,
  busy,
  onExtract
}: {
  finding: McpSecretFinding
  varName: string
  onVarChange: (v: string) => void
  result?: ExtractSecretResult
  busy: boolean
  onExtract: () => void
}): JSX.Element {
  const envLocked = f.location.kind === 'env' // var name must equal the env key
  const done = result?.ok

  return (
    <div className="rounded-md border border-white/10 bg-ink-950/40 p-3 text-xs">
      <div className="flex items-start gap-2">
        <ToolIcon toolId={f.toolId} className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold text-ink-100">{f.name}</span>
            <span className="text-ink-500">{locationLabel(f)}</span>
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-200">
              {f.reason}
            </span>
          </div>
          <div className="mt-1 font-mono text-ink-400">{f.preview}</div>

          {!done && f.fixable && (
            <div className="mt-2 flex items-center gap-2">
              <label className="text-ink-500">Variable</label>
              <input
                value={varName}
                disabled={envLocked}
                onChange={(e) => onVarChange(e.target.value)}
                className="flex-1 rounded border border-white/10 bg-ink-900/60 px-2 py-1 font-mono text-ink-100 disabled:opacity-60"
              />
              <button
                onClick={onExtract}
                disabled={busy}
                className="btn btn-primary shrink-0 text-xs disabled:opacity-50"
              >
                {busy ? 'Extracting…' : 'Extract'}
              </button>
            </div>
          )}

          {!done && !f.fixable && (
            <div className="mt-2 rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-ink-400">
              Can't auto-reference an env var here for{' '}
              <span className="text-ink-200">{f.toolId}</span>.{' '}
              {f.toolId === 'codex-cli' || f.toolId === 'codex-desktop'
                ? 'Codex has no ${VAR} expansion in args/url — rotate this credential, or use a server that reads it from the environment (then add the name to env_vars).'
                : 'This tool does not expand ${VAR} references — rotate the credential and set it out-of-band.'}
            </div>
          )}

          {done && result?.setCommands && (
            <ExtractedCommands varName={result.varName ?? varName} cmds={result.setCommands} toolId={f.toolId} />
          )}
        </div>
      </div>
    </div>
  )
}

function ExtractedCommands({
  varName,
  cmds,
  toolId
}: {
  varName: string
  cmds: { shell: string; launchctl?: string }
  toolId: string
}): JSX.Element {
  const toast = useToaster()
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => toast.show('Copied to clipboard.', 'ok'),
      () => toast.show('Copy failed — select and copy manually.', 'warn')
    )
  }
  return (
    <div className="mt-2 space-y-2 rounded border border-emerald-400/20 bg-emerald-400/5 p-2">
      <div className="text-emerald-200">
        Removed from config. Now set <span className="font-mono">{varName}</span> so the MCP keeps
        working, then restart {toolId}:
      </div>
      <CmdLine label="Shell (CLI)" cmd={cmds.shell} onCopy={() => copy(cmds.shell)} />
      {cmds.launchctl && (
        <CmdLine
          label="GUI app (macOS)"
          cmd={cmds.launchctl}
          onCopy={() => copy(cmds.launchctl!)}
        />
      )}
    </div>
  )
}

function CmdLine({
  label,
  cmd,
  onCopy
}: {
  label: string
  cmd: string
  onCopy: () => void
}): JSX.Element {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-500">{label}</div>
      <div className="mt-0.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-ink-950/60 px-2 py-1 font-mono text-ink-200">
          {cmd}
        </code>
        <button onClick={onCopy} className="btn btn-outline shrink-0 text-[11px]">
          Copy
        </button>
      </div>
    </div>
  )
}

function locationLabel(f: McpSecretFinding): string {
  const l = f.location
  if (l.kind === 'env') return `env · ${l.key}`
  if (l.kind === 'header') return `header · ${l.key}`
  if (l.kind === 'arg') return `arg #${l.index}`
  return 'url'
}
