import { useEffect } from 'react'
import { useUpdate } from '../lib/store'
import { openExternal } from '../lib/api'
import { Markdown } from './Markdown'

/**
 * Modal shown once after the user upgrades to a new version. Pulls release
 * notes from the GitHub release for the running tag and renders them with
 * our small Markdown component. Dismissing (button, ESC, or backdrop click)
 * persists `lastSeenVersion = current` so the dialog doesn't fire again until
 * the next upgrade.
 */
export function WhatsNewDialog(): JSX.Element | null {
  const { whatsNew, dismissWhatsNew } = useUpdate()

  useEffect(() => {
    if (!whatsNew) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') void dismissWhatsNew()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [whatsNew, dismissWhatsNew])

  if (!whatsNew) return null

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => void dismissWhatsNew()}
    >
      <div
        className="surface flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-accent">
              {whatsNew.fromVersion
                ? `Updated · v${whatsNew.fromVersion} → v${whatsNew.version}`
                : 'Welcome'}
            </div>
            <h2 className="mt-0.5 text-lg font-semibold text-ink-50">
              What's new in v{whatsNew.version}
            </h2>
          </div>
          <button
            className="btn btn-ghost shrink-0 px-1.5 text-sm"
            onClick={() => void dismissWhatsNew()}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <Markdown source={whatsNew.notes} />
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-white/5 px-5 py-3">
          {whatsNew.releaseUrl ? (
            <button
              className="text-xs text-ink-400 hover:text-ink-100"
              onClick={() => void openExternal(whatsNew.releaseUrl)}
            >
              View on GitHub ↗
            </button>
          ) : (
            <span />
          )}
          <button className="btn btn-primary text-xs" onClick={() => void dismissWhatsNew()}>
            Got it
          </button>
        </footer>
      </div>
    </div>
  )
}
