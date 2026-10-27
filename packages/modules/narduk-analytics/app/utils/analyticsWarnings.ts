/**
 * Dev and test only: a provenance gap that would make events unattributable in
 * PostHog. Once per key per page load; production stays silent.
 */
const warned = new Set<string>()

export function warnAnalyticsOnce(enabled: boolean, key: string, message: string): void {
  if (!enabled || warned.has(key)) return
  warned.add(key)
  console.warn(`[narduk-analytics] ${message}`)
}

/** Tests only. */
export function resetAnalyticsWarnings(): void {
  warned.clear()
}
