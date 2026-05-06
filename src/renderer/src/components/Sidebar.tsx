import { useApp } from '../lib/store'
import type { ItemKind, ToolId } from '../../../shared/types'
import { ToolIcon } from './ToolIcon'
import { openInFinder } from '../lib/api'

const KINDS: { id: ItemKind; label: string; icon: string }[] = [
  { id: 'mcp', label: 'MCP servers', icon: '⛓' },
  { id: 'skill', label: 'Skills', icon: '✦' },
  { id: 'plugin', label: 'Plugins', icon: '◇' },
  { id: 'agent', label: 'Agents', icon: '◌' }
]

export function Sidebar(): JSX.Element {
  const { scan, activeKind, setActiveKind, toolFilter, setToolFilter } = useApp()

  return (
    <aside className="titlebar-drag flex w-64 shrink-0 flex-col border-r border-white/5 bg-ink-900/40">
      <div className="px-5 pb-4 pt-12">
        <div className="flex items-center gap-2.5">
          <ToolIcon toolId="passport" className="h-7 w-7" decorate={false} />
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight">MCP Passport</div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500">
              Your library · {scan?.tools.filter((t) => t.id !== 'passport').length ?? 0} agents
            </div>
          </div>
        </div>
      </div>

      <nav className="titlebar-no-drag mt-2 px-3">
        <SectionLabel>Browse</SectionLabel>
        <ul className="mt-1 space-y-0.5">
          {KINDS.map((k) => {
            const count = scan?.items.filter((it) => it.kind === k.id).length ?? 0
            return (
              <li key={k.id}>
                <button
                  className={
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ' +
                    (activeKind === k.id
                      ? 'bg-white/10 text-ink-50'
                      : 'text-ink-300 hover:bg-white/5 hover:text-ink-100')
                  }
                  onClick={() => setActiveKind(k.id)}
                >
                  <span className="w-4 text-center text-xs text-ink-400">{k.icon}</span>
                  <span className="flex-1 text-left">{k.label}</span>
                  <span className="text-[11px] tabular-nums text-ink-500">{count}</span>
                </button>
              </li>
            )
          })}
        </ul>

        <SectionLabel className="mt-5">My library</SectionLabel>
        <ul className="mt-1 space-y-0.5">
          {(() => {
            const passportTool = scan?.tools.find((t) => t.id === 'passport')
            if (!passportTool) return null
            const count =
              scan!.items.reduce(
                (n, it) => n + (it.presences.some((p) => p.toolId === 'passport') ? 1 : 0),
                0
              ) ?? 0
            return (
              <li key={passportTool.id}>
                <ToolButton
                  active={toolFilter === passportTool.id}
                  onClick={() => setToolFilter(passportTool.id as ToolId)}
                  label={passportTool.name}
                  surface={undefined}
                  icon={<ToolIcon toolId={passportTool.id} className="h-5 w-5" />}
                  installed={true}
                  countLabel={count > 0 ? `${count} saved` : 'Empty — start here'}
                  onConfigClick={() => {
                    const cfg = passportTool.configPaths.find((c) => c.exists)
                    if (cfg) void openInFinder(cfg.path)
                  }}
                />
              </li>
            )
          })()}
        </ul>

        <SectionLabel className="mt-5">Coding agents</SectionLabel>
        <ul className="mt-1 space-y-0.5">
          <li>
            <ToolButton
              active={toolFilter === 'all'}
              onClick={() => setToolFilter('all')}
              label="All agents"
              icon={<span className="text-[12px] text-ink-400">⌘</span>}
              tone="muted"
            />
          </li>
          {scan?.tools
            .filter((t) => t.id !== 'passport')
            .map((t) => {
              const count =
                scan.items.reduce(
                  (n, it) => n + (it.presences.some((p) => p.toolId === t.id) ? 1 : 0),
                  0
                ) ?? 0
              return (
                <li key={t.id}>
                  <ToolButton
                    active={toolFilter === t.id}
                    onClick={() => setToolFilter(t.id as ToolId)}
                    label={t.name}
                    surface={t.surface}
                    icon={<ToolIcon toolId={t.id} className="h-5 w-5" />}
                    installed={t.installed}
                    countLabel={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : undefined}
                    onConfigClick={() => {
                      const cfg = t.configPaths.find((c) => c.exists)
                      if (cfg) void openInFinder(cfg.path)
                    }}
                  />
                </li>
              )
            })}
        </ul>
      </nav>

      <div className="mt-auto px-4 py-4 text-[11px] text-ink-500">
        {scan && <>Last scan {new Date(scan.scannedAt).toLocaleTimeString()}</>}
      </div>
    </aside>
  )
}

function SectionLabel({
  children,
  className = ''
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={
        'px-2.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500 ' + className
      }
    >
      {children}
    </div>
  )
}

function ToolButton({
  active,
  onClick,
  onConfigClick,
  label,
  surface,
  icon,
  installed = true,
  countLabel,
  tone
}: {
  active: boolean
  onClick: () => void
  onConfigClick?: () => void
  label: string
  surface?: 'cli' | 'desktop'
  icon: React.ReactNode
  installed?: boolean
  countLabel?: string
  tone?: 'muted'
}) {
  return (
    <div
      className={
        'group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ' +
        (active ? 'bg-white/10 text-ink-50' : 'text-ink-300 hover:bg-white/5 hover:text-ink-100')
      }
    >
      <button onClick={onClick} className="flex flex-1 items-center gap-2 text-left">
        {icon}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm leading-tight">{label}</span>
          {countLabel && (
            <span className="text-[10px] leading-tight text-ink-500">{countLabel}</span>
          )}
          {!countLabel && surface && (
            <span className="text-[10px] uppercase leading-tight tracking-wider text-ink-500">
              {surface}
            </span>
          )}
        </span>
        {!installed && tone !== 'muted' && (
          <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-500">
            not installed
          </span>
        )}
      </button>
      {onConfigClick && installed && (
        <button
          title="Reveal config in Finder"
          onClick={onConfigClick}
          className="opacity-0 transition-opacity hover:text-ink-100 group-hover:opacity-100"
        >
          <span className="text-[11px]">↗</span>
        </button>
      )}
    </div>
  )
}
