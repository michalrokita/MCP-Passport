import { useState } from 'react'
import { useApp } from '../lib/store'
import { useToaster } from './Toaster'
import type { CanonicalMcp, InventoryItem, ItemPresence } from '../../../shared/types'

export interface MissingSecret {
  /** Key (env var name or header name). */
  key: string
  /** Whether this is an env var (false → header). */
  isEnv: boolean
  /** Optional description (from registry envVars metadata, when available). */
  description?: string
}

/**
 * Walk every MCP presence and produce a deduplicated list of secrets that are
 * declared but blank — i.e. keys present in `env`/`headers` with empty string
 * values, plus Codex `bearer_token_env_var` / `env_vars` entries that don't
 * have a value in the inherited environment.
 */
export function findMissingSecrets(item: InventoryItem): MissingSecret[] {
  const seen = new Map<string, MissingSecret>()
  for (const p of item.presences) {
    if (p.source.kind !== 'mcp') continue
    const c = p.source.canonical
    if (c.env) {
      for (const [k, v] of Object.entries(c.env)) {
        if (typeof v !== 'string' || v.length === 0) {
          if (!seen.has(`env:${k}`)) seen.set(`env:${k}`, { key: k, isEnv: true })
        }
      }
    }
    if (c.headers) {
      for (const [k, v] of Object.entries(c.headers)) {
        if (typeof v !== 'string' || v.length === 0) {
          if (!seen.has(`hdr:${k}`)) seen.set(`hdr:${k}`, { key: k, isEnv: false })
        }
      }
    }
    if (c.bearer_token_env_var) {
      const k = c.bearer_token_env_var
      if (!seen.has(`env:${k}`)) seen.set(`env:${k}`, { key: k, isEnv: true })
    }
    if (c.env_vars) {
      for (const k of c.env_vars) {
        if (typeof k === 'string' && !c.env?.[k]) {
          if (!seen.has(`env:${k}`)) seen.set(`env:${k}`, { key: k, isEnv: true })
        }
      }
    }
  }
  return [...seen.values()]
}

export function FillSecretsDialog({
  item,
  missing,
  onClose
}: {
  item: InventoryItem
  missing: MissingSecret[]
  onClose: () => void
}): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const showToast = useToaster((s) => s.show)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const targets = item.presences
    .filter((p) => p.toolId !== 'passport' && p.source.kind === 'mcp')
    .map((p: ItemPresence) => ({
      toolId: p.toolId,
      scope: p.scope,
      projectPath: p.projectPath
    }))

  async function save(): Promise<void> {
    const env: Record<string, string> = {}
    const headers: Record<string, string> = {}
    for (const m of missing) {
      const v = values[m.key]
      if (typeof v !== 'string' || v.length === 0) continue
      if (m.isEnv) env[m.key] = v
      else headers[m.key] = v
    }
    if (Object.keys(env).length === 0 && Object.keys(headers).length === 0) {
      showToast('No values to save.', 'warn')
      return
    }
    setBusy(true)
    try {
      const result = await window.api.mcpFillSecrets({
        name: item.name,
        env: Object.keys(env).length ? env : undefined,
        headers: Object.keys(headers).length ? headers : undefined,
        targets
      })
      showToast(result.message, result.ok ? 'ok' : 'error')
      if (result.ok) {
        await refresh()
        onClose()
      }
    } catch (e) {
      showToast(`Failed: ${(e as Error).message}`, 'error')
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
        className="surface flex max-h-[85vh] w-full max-w-lg flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/5 px-5 py-3">
          <div>
            <div className="text-sm font-semibold">Fill secrets for {item.name}</div>
            <div className="mt-0.5 text-[11px] text-ink-500">
              Values are written to {targets.length} location
              {targets.length === 1 ? '' : 's'} where this MCP is configured.
            </div>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-100">
            ✕
          </button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {missing.map((m) => (
            <label key={m.key} className="block">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                {m.key}
                <span className="ml-2 text-[10px] font-normal lowercase text-ink-500">
                  {m.isEnv ? 'env var' : 'header'}
                </span>
              </div>
              {m.description && <div className="mt-0.5 text-[11px] text-ink-500">{m.description}</div>}
              <input
                type="password"
                value={values[m.key] ?? ''}
                onChange={(e) => setValues((cur) => ({ ...cur, [m.key]: e.target.value }))}
                placeholder={m.isEnv ? `Value for ${m.key}` : `Header value`}
                className="input mt-1.5"
                autoComplete="new-password"
              />
            </label>
          ))}
        </div>
        <footer className="flex justify-end gap-2 border-t border-white/5 px-5 py-3">
          <button onClick={onClose} className="btn btn-ghost text-xs">
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={save}
            className="btn btn-primary text-xs disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save secrets'}
          </button>
        </footer>
      </div>
    </div>
  )
}

// Re-export for callers that want to inspect this without importing the dialog.
export type { CanonicalMcp }
