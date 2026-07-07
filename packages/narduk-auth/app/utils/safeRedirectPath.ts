export function sanitizeLocalRedirectPath(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback

  const path = value.trim()
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /%5c/iu.test(path)) {
    return fallback
  }

  try {
    const url = new URL(path, 'https://app.local')
    if (url.origin !== 'https://app.local' || !url.pathname.startsWith('/')) {
      return fallback
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
