export function toUserFacingError(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback

  const candidate = error as {
    data?: { message?: string; statusMessage?: string }
    message?: string
    statusMessage?: string
  }

  const messages = [
    candidate.data?.statusMessage,
    candidate.data?.message,
    candidate.statusMessage,
    candidate.message,
  ]

  for (const message of messages) {
    if (typeof message === 'string' && message.trim()) {
      return message
    }
  }

  return fallback
}
