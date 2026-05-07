import { useUpdate } from '../lib/store'
import { openExternal } from '../lib/api'

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
 */
export function UpdateBanner(): JSX.Element | null {
  const { available, suppressed, dismissed, dismiss, skipCurrent } = useUpdate()

  if (!available || suppressed || dismissed) return null

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-accent/30 bg-accent/10 px-4 py-2 text-sm text-ink-50">
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
  )
}
