const policy = { limit: 60, windowSeconds: 60 }

export const RATE_LIMIT_POLICIES = new Proxy({} as Record<string, typeof policy>, {
  get: () => policy,
})
