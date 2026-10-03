/**
 * One formatter, built on first use and shared by every caller (both build
 * plugins and the admin timestamp cells), so a page never pays for more than
 * one `Intl.DateTimeFormat` here and a plugin that never formats pays for none
 * (narduk-libs#1380). Options match `formatDeterministicDateTime`, which the
 * tests pin it against.
 */
let buildTimeFormatter: Intl.DateTimeFormat | undefined

function getBuildTimeFormatter(): Intl.DateTimeFormat {
  buildTimeFormatter ??= new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
  return buildTimeFormatter
}

export function formatBuildTimeLocal(
  buildTime: string | null | undefined,
  fallback: null,
): string | null
export function formatBuildTimeLocal(
  buildTime: string | null | undefined,
  fallback?: string,
): string
export function formatBuildTimeLocal(
  buildTime: string | null | undefined,
  fallback: string | null = '',
): string | null {
  if (!buildTime) return fallback

  const date = new Date(buildTime)
  if (Number.isNaN(date.getTime())) return buildTime

  return getBuildTimeFormatter().format(date).replace(' at ', ', ')
}
