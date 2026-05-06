import type { PassportApi } from '../shared/types'

declare global {
  interface Window {
    api: PassportApi
  }
}

export {}
