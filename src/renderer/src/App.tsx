import { useEffect } from 'react'
import { useApp, useUpdate } from './lib/store'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { ItemList } from './components/ItemList'
import { Browse } from './components/Browse'
import { Toaster } from './components/Toaster'
import { KindFilter } from './components/KindFilter'
import { UpdateBanner } from './components/UpdateBanner'
import { WhatsNewDialog } from './components/WhatsNewDialog'

export default function App(): JSX.Element {
  const { refresh, scan, loading, error, view } = useApp()
  const initializeUpdate = useUpdate((s) => s.initialize)

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    let unsubscribe: (() => void) | null = null
    void initializeUpdate().then((unsub) => {
      unsubscribe = unsub
    })
    return () => {
      unsubscribe?.()
    }
  }, [initializeUpdate])

  return (
    <div className="flex h-full w-full flex-col bg-ink-950 text-ink-100">
      <UpdateBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            {loading && !scan && (
              <div className="flex h-full items-center justify-center text-ink-400">
                Scanning your tools…
              </div>
            )}
            {error && (
              <div className="surface mx-auto max-w-2xl p-4 text-sm text-red-300">
                <div className="font-semibold">Scan failed</div>
                <div className="mt-1 text-red-200/80">{error}</div>
              </div>
            )}
            {scan && (
              <>
                <KindFilter />
                {view === 'inventory' && <ItemList />}
                {view === 'browse' && <Browse />}
              </>
            )}
          </main>
        </div>
      </div>
      <Toaster />
      <WhatsNewDialog />
    </div>
  )
}
