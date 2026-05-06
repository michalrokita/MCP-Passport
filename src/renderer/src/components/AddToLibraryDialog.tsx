import { useState } from 'react'
import { useApp } from '../lib/store'
import { useToaster } from './Toaster'
import type {
  CanonicalMcp,
  ItemKind,
  LibraryMcpInput,
  LibrarySkillInput,
  McpTransport
} from '../../../shared/types'

export function AddToLibraryDialog({
  kind,
  onClose
}: {
  kind: ItemKind
  onClose: () => void
}): JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const toast = useToaster()
  const [busy, setBusy] = useState(false)

  if (kind === 'mcp') return <McpForm onClose={onClose} onSaved={refresh} toast={toast} />
  if (kind === 'skill') return <SkillForm onClose={onClose} onSaved={refresh} toast={toast} />
  return (
    <Modal onClose={onClose} title={`Add ${kind}`}>
      <div className="px-5 py-6 text-sm text-ink-300">
        Adding {kind}s to the library is not supported yet. MCPs and skills work today.
      </div>
    </Modal>
  )
}

function Modal({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="surface flex max-h-[85vh] w-full max-w-xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/5 px-5 py-3">
          <div className="text-sm font-semibold">{title}</div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-100">
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

function McpForm({
  onClose,
  onSaved,
  toast
}: {
  onClose: () => void
  onSaved: () => void
  toast: { show: (msg: string, tone?: 'ok' | 'warn' | 'error' | 'info') => void; dismiss: (id: number) => void; toasts: { id: number; message: string; tone: 'ok' | 'warn' | 'error' | 'info'; createdAt: number }[] }
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [transport, setTransport] = useState<McpTransport>('stdio')
  const [command, setCommand] = useState('npx')
  const [argsText, setArgsText] = useState('')
  const [envText, setEnvText] = useState('')
  const [url, setUrl] = useState('')
  const [headersText, setHeadersText] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) {
      toast.show('Name is required', 'error')
      return
    }
    setBusy(true)
    try {
      const env: Record<string, string> = {}
      for (const line of envText.split('\n')) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
        if (m) env[m[1]] = m[2]
      }
      const headers: Record<string, string> = {}
      for (const line of headersText.split('\n')) {
        const m = line.match(/^([^:]+)\s*:\s*(.*)$/)
        if (m) headers[m[1].trim()] = m[2].trim()
      }
      const canonical: CanonicalMcp =
        transport === 'stdio'
          ? {
              transport: 'stdio',
              command: command.trim(),
              args: argsText
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
              env: Object.keys(env).length ? env : undefined
            }
          : {
              transport,
              url: url.trim(),
              headers: Object.keys(headers).length ? headers : undefined
            }
      const input: LibraryMcpInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        canonical
      }
      const result = await window.api.libraryAddMcp(input)
      toast.show(result.message, result.ok ? 'ok' : 'error')
      if (result.ok) {
        onSaved()
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Add MCP server to your library" onClose={onClose}>
      <div className="space-y-4 px-5 py-4">
        <Field label="Name" hint="A unique name. Used as the key when copied to other tools.">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. github"
            className="input"
          />
        </Field>

        <Field label="Description" hint="Optional, shown in the inventory.">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this MCP do?"
            className="input"
          />
        </Field>

        <Field label="Transport">
          <div className="flex gap-1">
            {(['stdio', 'http', 'sse'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTransport(t)}
                className={
                  'rounded px-3 py-1 text-xs ' +
                  (transport === t
                    ? 'bg-ink-100 text-ink-950'
                    : 'border border-white/10 text-ink-300 hover:bg-white/5')
                }
              >
                {t}
              </button>
            ))}
          </div>
        </Field>

        {transport === 'stdio' && (
          <>
            <Field label="Command">
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx"
                className="input"
              />
            </Field>
            <Field label="Arguments" hint="One per line.">
              <textarea
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                rows={4}
                className="input font-mono text-xs"
                placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;$HOME"
              />
            </Field>
            <Field label="Environment variables" hint="KEY=value, one per line. Leave empty to be filled in per-tool.">
              <textarea
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                rows={3}
                className="input font-mono text-xs"
                placeholder="GITHUB_TOKEN=&#10;DATABASE_URL="
              />
            </Field>
          </>
        )}

        {transport !== 'stdio' && (
          <>
            <Field label="URL">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.example.com/mcp"
                className="input"
              />
            </Field>
            <Field
              label="Headers"
              hint="Header: value, one per line. Use ${ENV_VAR} for secrets."
            >
              <textarea
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
                rows={3}
                className="input font-mono text-xs"
                placeholder="Authorization: Bearer ${MY_TOKEN}"
              />
            </Field>
          </>
        )}
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
          {busy ? 'Saving…' : 'Save to library'}
        </button>
      </footer>
    </Modal>
  )
}

function SkillForm({
  onClose,
  onSaved,
  toast
}: {
  onClose: () => void
  onSaved: () => void
  toast: { show: (msg: string, tone?: 'ok' | 'warn' | 'error' | 'info') => void; dismiss: (id: number) => void; toasts: { id: number; message: string; tone: 'ok' | 'warn' | 'error' | 'info'; createdAt: number }[] }
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [whenToUse, setWhenToUse] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim() || !body.trim()) {
      toast.show('Name and body are required', 'error')
      return
    }
    setBusy(true)
    try {
      const input: LibrarySkillInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        whenToUse: whenToUse.trim() || undefined,
        body: body
      }
      const result = await window.api.libraryAddSkill(input)
      toast.show(result.message, result.ok ? 'ok' : 'error')
      if (result.ok) {
        onSaved()
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Add skill to your library" onClose={onClose}>
      <div className="space-y-4 px-5 py-4">
        <Field label="Name" hint="Lowercase, hyphens only. Used as the directory name.">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-awesome-skill"
            className="input"
          />
        </Field>
        <Field label="Description" hint="Shown in the inventory and used by Claude to decide when to invoke.">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this skill help with?"
            className="input"
          />
        </Field>
        <Field label="When to use" hint="Optional trigger phrases.">
          <input
            value={whenToUse}
            onChange={(e) => setWhenToUse(e.target.value)}
            placeholder="When the user asks to refactor, simplify, or clean up code."
            className="input"
          />
        </Field>
        <Field label="Skill body (Markdown)">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            className="input font-mono text-xs"
            placeholder="# Title&#10;&#10;Instructions for Claude when this skill activates."
          />
        </Field>
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
          {busy ? 'Saving…' : 'Save to library'}
        </button>
      </footer>
    </Modal>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
        {label}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-500">{hint}</div>}
      <div className="mt-1.5">{children}</div>
    </label>
  )
}
