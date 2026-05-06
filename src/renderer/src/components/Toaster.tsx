import { create } from 'zustand'

type Tone = 'ok' | 'warn' | 'error' | 'info'

interface ToastState {
  toasts: Array<{ id: number; message: string; tone: Tone; createdAt: number }>
  show: (message: string, tone?: Tone) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToaster = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, tone = 'info') => {
    const id = nextId++
    set({ toasts: [...get().toasts, { id, message, tone, createdAt: Date.now() }] })
    setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) })
    }, 5000)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

const toneStyles: Record<Tone, string> = {
  ok: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  warn: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  error: 'border-red-400/30 bg-red-400/10 text-red-200',
  info: 'border-white/10 bg-white/5 text-ink-100'
}

export function Toaster(): JSX.Element {
  const { toasts, dismiss } = useToaster()
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={
            'pointer-events-auto max-w-sm cursor-pointer rounded-md border px-3 py-2 text-xs shadow-xl backdrop-blur ' +
            toneStyles[t.tone]
          }
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
