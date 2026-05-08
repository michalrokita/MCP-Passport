import { useUpdate } from '../lib/store'
import { openExternal } from '../lib/api'
import { Markdown } from './Markdown'

/**
 * Top-of-window banner shown when a newer release is available on GitHub.
 * Phase 1 (no-signing): Download → opens the release page in the browser, user
 * re-runs the .dmg manually. Once the app is signed we'll swap this for an
 * in-app `electron-updater` flow with the same UI shell.
 *
 * Visibility rules:
 *   - hidden when no update is available
 *   - hidden when user clicked X this session (`dismissed`)
 *   - hidden when user clicked "Skip this version" (`suppressed`) — comes back
 *     when a newer version is published
 *
 * The banner can also expand to show the release notes inline (`notesExpanded`,
 * session-only). Notes come from the GitHub release `body`, which `updater.ts`
 * already fetches into `available.releaseNotes`.
 */
export function UpdateBanner(): JSX.Element | null {
  const {
    available,
    suppressed,
    dismissed,
    notesExpanded,
    dismiss,
    skipCurrent,
    toggleNotes
  } = useUpdate()

  if (!available || suppressed || dismissed) return null

  const hasNotes = !!available.releaseNotes?.trim()

  return (
    <div className="shrink-0 border-b border-accent/30 bg-accent/10 text-sm text-ink-50">
      {/* pl-24 leaves room for the macOS traffic-light overlay (matches TopBar). */}
      <div className="flex items-center gap-3 py-2 pl-24 pr-4">
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/30 text-[13px]"
        >
          ↑
        </span>
        <div className="min-w-0 flex-1">
          <span className="font-semibold">Update available</span>{' '}
          <span className="text-ink-300">
            v{available.currentVersion} → v{available.latestVersion}
          </span>
        </div>
        {hasNotes && (
          <button
            className="btn btn-ghost shrink-0 text-xs"
            onClick={toggleNotes}
            aria-expanded={notesExpanded}
            title={notesExpanded ? 'Hide release notes' : 'Show release notes'}
          >
            What's new {notesExpanded ? '▴' : '▾'}
          </button>
        )}
        <button
          className="btn btn-primary shrink-0 text-xs"
          onClick={() => void openExternal(available.releaseUrl)}
        >
          Download
        </button>
        <button
          className="btn btn-ghost shrink-0 text-xs"
          onClick={() => void skipCurrent()}
          title={`Hide until a version newer than v${available.latestVersion} is published`}
        >
          Skip this version
        </button>
        <button
          className="btn btn-ghost shrink-0 px-1.5 text-xs"
          onClick={dismiss}
          aria-label="Dismiss for this session"
          title="Dismiss for this session"
        >
          ✕
        </button>
      </div>

      {hasNotes && notesExpanded && (
        <div className="border-t border-accent/20 bg-ink-950/40 px-12 py-4">
          <div className="max-h-[40vh] overflow-y-auto pr-2">
            <Markdown source={available.releaseNotes} />
          </div>
        </div>
      )}
    </div>
  )
}
