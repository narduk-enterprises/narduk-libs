export interface StubRateLimitPolicy {
  key: string
  limit: number
  windowSeconds: number
}

const policies = new Map<string, StubRateLimitPolicy>()

/** One stable policy object per key, so a route test can tell `authLogin` apart. */
export const RATE_LIMIT_POLICIES = new Proxy({} as Record<string, StubRateLimitPolicy>, {
  get: (_target, key) => {
    const name = String(key)
    let policy = policies.get(name)
    if (!policy) {
      policy = { key: name, limit: 60, windowSeconds: 60 }
      policies.set(name, policy)
    }
    return policy
  },
})

/** Routes that enforce a policy themselves (not via a mutation helper) record it here. */
export const rateLimitStub = {
  calls: [] as StubRateLimitPolicy[],
  reject: undefined as Error | undefined,
  reset() {
    this.calls.length = 0
    this.reject = undefined
  },
}

export async function enforceRateLimitPolicy(_event: unknown, policy: StubRateLimitPolicy) {
  rateLimitStub.calls.push(policy)
  if (rateLimitStub.reject) throw rateLimitStub.reject
}
