import { trimRuntimeString } from './runtime-env'

export function normalizeSupabaseBaseUrl(value: string): string {
  const raw = trimRuntimeString(value)
  if (!raw) return ''

  const normalizePath = (path: string) =>
    path
      .replace(/\/auth\/v1\/callback\/?$/, '')
      .replace(/\/auth\/v1\/?$/, '')
      .replace(/\/+$/, '')

  try {
    const url = new URL(raw)
    const normalizedPath = normalizePath(url.pathname)
    url.pathname = normalizedPath || '/'
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return normalizePath(raw)
  }
}
