interface BrowserCollectionPolicy {
  botTraffic?: unknown
  doNotTrack?: string | null
  respectDnt?: boolean
  userAgent: string
}

/** Resolve before scheduling SDK loading, attribution or event collection. */
export function allowsAnalyticsCollection(policy: BrowserCollectionPolicy): boolean {
  if (policy.respectDnt && ['1', 'yes'].includes(policy.doNotTrack ?? '')) return false
  return (
    policy.botTraffic !== 'exclude' ||
    !/HeadlessChrome|Lighthouse|bot|crawl|spider/i.test(policy.userAgent)
  )
}
