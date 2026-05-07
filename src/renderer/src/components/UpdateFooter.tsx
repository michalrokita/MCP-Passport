import { useUpdate } from '../lib/store'

/**
 * Sidebar footer block: shows current version, update status, and exposes the
 * auto-check toggle + manual "Check now". Lives below the "Last scan…" line.
 */
export function UpdateFooter(): JSX.Element | null {
  const {
    available,
    suppressed,
    prefs,
    currentVersion,
    checking,
    checkNow,
    setAutoCheck,
    unskip
  } = useUpdate()

  if (!currentVersion || !prefs) return null

  return (
    <div className="space-y-1.5 border-t border-white/5 px-4 pb-3 pt-3 text-[11px] text-ink-500">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-400">v{currentVersion}</span>
        {available ? (
          <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent">
            v{available.latestVersion} available
          </span>
        ) : (
          <span className="text-ink-600">Up to date</span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-ink-400 hover:text-ink-200">
          <input
            type="checkbox"
            className="h-3 w-3 cursor-pointer accent-accent"
            checked={prefs.autoCheck}
            onChange={(e) => void setAutoCheck(e.target.checked)}
          />
          Auto-check
        </label>
        <button
          className="text-ink-400 hover:text-ink-100 disabled:opacity-50"
          disabled={checking}
          onClick={() => void checkNow({ force: true })}
        >
          {checking ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {available && suppressed && (
        <button
          className="text-left text-[10px] text-ink-500 hover:text-ink-300"
          onClick={() => void unskip()}
          title={`Show the banner for v${available.latestVersion} again`}
        >
          You skipped v{available.latestVersion}. Show again?
        </button>
      )}
    </div>
  )
}
