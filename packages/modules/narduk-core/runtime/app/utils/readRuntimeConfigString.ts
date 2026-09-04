export function readRuntimeConfigString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value || fallback
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}
