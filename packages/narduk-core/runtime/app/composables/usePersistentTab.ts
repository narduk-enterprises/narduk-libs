/* eslint-disable narduk/file-size-budget -- Persistent tab composable owns route-sync + storage-sync + initial-resolution as a single unit to prevent state divergence across tabs. */
import {
  buildPersistentTabStorageKey,
  normalizePersistentTabValue,
  type PersistentTabStorage,
  type PersistentTabValue,
} from '../utils/persistentTab'

import type { MaybeRefOrGetter } from 'vue'

export interface UsePersistentTabOptions {
  defaultValue?: MaybeRefOrGetter<PersistentTabValue | undefined>
  persistKey?: MaybeRefOrGetter<string | undefined>
  queryKey?: MaybeRefOrGetter<string | false | undefined>
  storage?: MaybeRefOrGetter<PersistentTabStorage | undefined>
  values?: MaybeRefOrGetter<readonly PersistentTabValue[] | undefined>
}

function readOptionValue<T>(value: MaybeRefOrGetter<T> | undefined): T | undefined {
  if (typeof value === 'function') {
    return (value as () => T)()
  }

  return unref(value)
}

function getPersistentTabStorage(mode: PersistentTabStorage | undefined): Storage | null {
  if (!import.meta.client || mode === false) {
    return null
  }

  return mode === 'session' ? window.sessionStorage : window.localStorage
}

function readPersistentTabStorage(
  key: string | null,
  mode: PersistentTabStorage | undefined,
  values: readonly PersistentTabValue[],
) {
  if (!key) {
    return
  }

  const storage = getPersistentTabStorage(mode)
  if (!storage) {
    return
  }

  try {
    return normalizePersistentTabValue({
      candidate: storage.getItem(key),
      values,
    })
  } catch {
    return
  }
}

export function usePersistentTab(options: UsePersistentTabOptions) {
  const route = useRoute()
  const router = useRouter()

  const tabValues = computed(() => readOptionValue(options.values) ?? [])
  const storageMode = computed(() => readOptionValue(options.storage) ?? 'local')
  const resolveQueryKey = (): string | false => {
    const value = readOptionValue(options.queryKey)
    if (!value) {
      return false
    }

    const normalized = value.trim()
    return normalized.length > 0 ? normalized : false
  }
  const queryKey = computed(resolveQueryKey)
  const resolveRouteQueryValue = () => {
    const key = resolveQueryKey()
    return key ? route.query[key] : undefined
  }
  const queryValue = computed(resolveRouteQueryValue)
  const resolveFallbackValue = (): PersistentTabValue => {
    const values = readOptionValue(options.values) ?? []
    const firstTabValue = values[0]

    return (
      normalizePersistentTabValue({
        candidate: readOptionValue(options.defaultValue),
        values,
        fallbackValue: firstTabValue,
      }) ?? '0'
    )
  }
  const fallbackValue = computed(resolveFallbackValue)
  const storageKey = computed(() => {
    const key = readOptionValue(options.persistKey)?.trim()
    if (!key || storageMode.value === false) {
      return null
    }

    return buildPersistentTabStorageKey(route.path, key)
  })
  const resolveInitialValue = (): PersistentTabValue => {
    const fallback = resolveFallbackValue()
    return (
      normalizePersistentTabValue({
        candidate: resolveRouteQueryValue(),
        values: readOptionValue(options.values) ?? [],
        fallbackValue: fallback,
      }) ?? fallback
    )
  }

  const currentValue = ref<PersistentTabValue>(resolveInitialValue())

  watch(
    [tabValues, fallbackValue],
    ([values, fallback]) => {
      const nextValue =
        normalizePersistentTabValue({
          candidate: currentValue.value,
          values,
          fallbackValue: fallback,
        }) ?? fallback

      if (nextValue !== currentValue.value) {
        currentValue.value = nextValue
      }
    },
    { immediate: true },
  )

  watch(
    queryValue,
    (value) => {
      const nextValue = normalizePersistentTabValue({
        candidate: value,
        values: tabValues.value,
      })

      if (nextValue !== undefined && nextValue !== currentValue.value) {
        currentValue.value = nextValue
      }
    },
    { immediate: true },
  )

  // Storage is restored only after mount so SSR and hydration stay aligned.
  onMounted(() => {
    if (queryValue.value !== undefined) {
      return
    }

    const storedValue = readPersistentTabStorage(
      storageKey.value,
      storageMode.value,
      tabValues.value,
    )
    if (storedValue !== undefined && storedValue !== currentValue.value) {
      currentValue.value = storedValue
    }
  })

  watch(
    currentValue,
    (value) => {
      if (!import.meta.client) {
        return
      }

      const key = storageKey.value
      const storage = getPersistentTabStorage(storageMode.value)
      if (!key || !storage) {
        return
      }

      try {
        storage.setItem(key, String(value))
      } catch {
        // Ignore storage failures from private mode or quota limits.
      }
    },
    { flush: 'post' },
  )

  watch(
    currentValue,
    (value) => {
      if (!import.meta.client) {
        return
      }

      const key = queryKey.value
      if (!key) {
        return
      }

      const currentQueryValue = Array.isArray(route.query[key])
        ? route.query[key][0]
        : route.query[key]
      const nextQueryValue = String(value)
      if (currentQueryValue === nextQueryValue) {
        return
      }

      void router.replace({
        query: {
          ...route.query,
          [key]: nextQueryValue,
        },
      })
    },
    { flush: 'post' },
  )

  return {
    currentValue,
    fallbackValue,
    storageKey,
  }
}
