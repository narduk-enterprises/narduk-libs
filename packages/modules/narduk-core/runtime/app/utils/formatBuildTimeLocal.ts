import { formatDeterministicDateTime } from '../../shared/utils/formatDeterministicDate'

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

  return formatDeterministicDateTime(date).replace(' at ', ', ')
}
