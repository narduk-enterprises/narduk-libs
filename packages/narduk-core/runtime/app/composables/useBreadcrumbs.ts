/**
 * useBreadcrumbs — Route-aware breadcrumb generation.
 *
 * Derives breadcrumb items from the current route path segments.
 * Compatible with Nuxt UI's UBreadcrumb component.
 * Includes JSON-LD structured data for SEO.
 *
 * @example
 * ```vue
 * <script setup>
 * const { items } = useBreadcrumbs()
 * </script>
 * <template>
 *   <UBreadcrumb :items="items" />
 * </template>
 * ```
 */

// eslint-disable-next-line nuxt-redundant-auto-import/no-redundant-auto-import -- Required for isolated package execution where Nuxt auto-imports are unavailable.
import { type MaybeRef, unref } from 'vue'

export interface BreadcrumbItem {
  icon?: string
  label: string
  to?: string
}

type BreadcrumbLabelResolver = (segment: string) => string | undefined

export interface UseBreadcrumbsOptions {
  /** Home icon (default: 'i-lucide-house') */
  homeIcon?: MaybeRef<string | undefined>
  /** Custom label resolver for route segments. If not provided, segments are title-cased. */
  resolveLabel?: MaybeRef<BreadcrumbLabelResolver | undefined>
}

function readMaybeRefValue<T>(value: MaybeRef<T> | undefined): T | undefined {
  return unref(value)
}

export function useBreadcrumbs(options: UseBreadcrumbsOptions = {}) {
  const route = useRoute()
  const runtimeConfig = useRuntimeConfig()
  const configuredSiteUrl =
    typeof runtimeConfig.public.siteUrl === 'string' ? runtimeConfig.public.siteUrl.trim() : ''
  const configuredAppUrl =
    typeof runtimeConfig.public.appUrl === 'string' ? runtimeConfig.public.appUrl.trim() : ''
  const siteUrl = (configuredSiteUrl ? configuredSiteUrl : configuredAppUrl).replace(/\/$/, '')

  const items = computed<BreadcrumbItem[]>(() => {
    const homeIcon = readMaybeRefValue(options.homeIcon) ?? 'i-lucide-house'
    const resolveLabel = readMaybeRefValue(options.resolveLabel)
    const segments = route.path.replace(/\/$/, '').split('/').filter(Boolean)
    if (segments.length === 0) return []

    const result: BreadcrumbItem[] = [{ label: 'Home', to: '/', icon: homeIcon }]
    let path = ''

    for (const segment of segments) {
      path += `/${segment}`
      const customLabel = resolveLabel?.(segment)
      const label =
        customLabel ?? segment.replaceAll('-', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())
      result.push({ label, to: `${path}/` })
    }

    // Last item is current page — no link
    if (result.length > 1) {
      const last = result.at(-1)
      if (last) delete last.to
    }

    return result
  })

  // JSON-LD structured data
  const jsonLdItems = computed(() =>
    items.value.map((item, index) => ({
      '@type': 'ListItem' as const,
      position: index + 1,
      name: item.label,
      item: item.to ? `${siteUrl}${item.to}` : undefined,
    })),
  )

  return { items, jsonLdItems }
}
