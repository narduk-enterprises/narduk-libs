/**
 * The auto-import bridge for narduk package app runtime files.
 *
 * narduk-core is installed as a module, not a layer, so Nuxt's own auto-import
 * transform skips its `runtime/app` files in node_modules. The bridge in
 * `module.ts` injects the imports those files rely on instead, but only for the
 * names listed here: a name missing from these lists compiles and then throws
 * `ReferenceError` in the consuming app. `useSsrNow` (LayerAppFooter), `toRef`
 * (AppBreadcrumbs) and `readonly` (useFormHandler) were missing in 2.13.0, as
 * were five seo and analytics admin composables;
 * `tests/runtime-import-bridge.test.ts` scans every bridged app file so the
 * lists cannot drift again.
 */

/** Vue APIs, injected from `vue`. */
export const APP_RUNTIME_VUE_IMPORTS: readonly string[] = [
  'computed',
  'nextTick',
  'onBeforeUnmount',
  'onMounted',
  'onUnmounted',
  'reactive',
  'readonly',
  'ref',
  'shallowRef',
  'toRef',
  'toRefs',
  'toValue',
  'unref',
  'watch',
  'watchEffect',
]

/**
 * Nuxt composables, and the composables and utils core, narduk-seo,
 * narduk-analytics and narduk-auth register as auto-imports, injected from
 * `#imports`. Those three packages are modules too, so their `app/` files rely
 * on this bridge exactly as core's do.
 */
export const APP_RUNTIME_NUXT_IMPORTS: readonly string[] = [
  'clearError',
  'createError',
  'defineNuxtPlugin',
  'defineNuxtRouteMiddleware',
  'defineOgImage',
  'definePageMeta',
  'formatBuildTimeLocal',
  'navigateTo',
  'normalizeOgPreviewSections',
  'reloadNuxtApp',
  'useAdminGaOverview',
  'useAdminGscPerformance',
  'useAdminOgImagePreviews',
  'useAdminPosthogDashboard',
  'useAppConfig',
  'useAppFetch',
  'useAsyncData',
  'useAuth',
  'useAuthRuntimePublic',
  'useColorModeToggle',
  'useCookie',
  'useCsrfFetch',
  'useFetch',
  'useHead',
  'useItemListSchema',
  'useManagedSupabaseClient',
  'useNardukNetworkDirectory',
  'useNotifications',
  'useNuxtApp',
  'useOgImageData',
  'useOgImagePreviewResolver',
  'useRequestURL',
  'useRoute',
  'useRouter',
  'useRuntimeConfig',
  'useSeo',
  'useSeoMeta',
  'useSiteConfig',
  'useSsrNow',
  'useState',
  'useToast',
  'useUserSession',
  'useWebPageSchema',
  'useWebSiteSchema',
]

function identifierReferencePattern(name: string): string {
  return `(?<![\\w$])${name}(?![\\w$])`
}

function hasIdentifier(code: string, name: string): boolean {
  return new RegExp(identifierReferencePattern(name)).test(code)
}

function hasImportOrDeclaration(code: string, name: string): boolean {
  const identifier = identifierReferencePattern(name)

  return (
    new RegExp(
      `import\\s+(?:type\\s+)?(?:\\{[^}]*${identifier}[^}]*\\}|\\*\\s+as\\s+${identifier}|${identifier})`,
      'm',
    ).test(code) ||
    new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?function\\s+${name}(?![\\w$])`).test(code) ||
    new RegExp(
      `\\b(?:export\\s+)?(?:const|let|var|class|interface|type)\\s+${name}(?![\\w$])`,
    ).test(code)
  )
}

export function selectMissingRuntimeImports(code: string, names: readonly string[]): string[] {
  return names.filter((name) => hasIdentifier(code, name) && !hasImportOrDeclaration(code, name))
}
