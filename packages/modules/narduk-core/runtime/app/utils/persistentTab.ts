export type PersistentTabValue = number | string
export type PersistentTabStorage = 'local' | 'session' | false

export interface NormalizePersistentTabValueOptions {
  candidate: unknown
  fallbackValue?: PersistentTabValue
  values?: readonly PersistentTabValue[]
}

const PERSISTENT_TAB_STORAGE_PREFIX = 'narduk:tabs'

export function buildPersistentTabStorageKey(routePath: string, persistKey: string) {
  return `${PERSISTENT_TAB_STORAGE_PREFIX}:${routePath}:${persistKey}`
}

export function normalizePersistentTabValue({
  candidate,
  fallbackValue,
  values = [],
}: NormalizePersistentTabValueOptions): PersistentTabValue | undefined {
  const rawCandidate = Array.isArray(candidate) ? candidate[0] : candidate

  if (rawCandidate === undefined || rawCandidate === null || rawCandidate === '') {
    return fallbackValue
  }

  if (typeof rawCandidate !== 'number' && typeof rawCandidate !== 'string') {
    return fallbackValue
  }

  if (values.length === 0) {
    return rawCandidate
  }

  return values.find((value) => String(value) === String(rawCandidate)) ?? fallbackValue
}
