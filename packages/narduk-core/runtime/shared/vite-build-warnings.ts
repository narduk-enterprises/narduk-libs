interface ViteWarningLocation {
  column?: number
  file?: string
  line?: number
}

export type ViteRollupWarning =
  | string
  | {
      code?: string
      exporter?: string
      id?: string
      ids?: string[]
      loc?: ViteWarningLocation
      message?: string
      names?: string[]
      plugin?: string
    }
type ViteLogType = 'error' | 'info' | 'warn'

const vueUseInvalidAnnotationLocations = [
  { column: 0, line: 3362 },
  { column: 22, line: 5780 },
] as const

export interface CoreViteBuildLogger {
  clearScreen: (type: ViteLogType) => void
  error: (message: string, options?: { error?: Error | null }) => void
  hasErrorLogged: (error: Error) => boolean
  hasWarned: boolean
  info: (message: string) => void
  warn: (message: string) => void
  warnOnce: (message: string) => void
}

export interface MutableViteBuildConfig {
  build?: {
    chunkSizeWarningLimit?: number
    reportCompressedSize?: boolean
    rollupOptions?: MutableRollupWarningConfig
  }
  customLogger?: CoreViteBuildLogger
  logLevel?: 'error' | 'info' | 'silent' | 'warn'
}

export interface MutableRollupWarningConfig {
  onwarn?: (warning: unknown, warn: (warning: unknown) => void) => unknown
}

export function isKnownViteSourcemapWarning(warning: ViteRollupWarning): boolean {
  if (typeof warning === 'string') return false
  if (warning.message?.includes("didn't generate a sourcemap") !== true) return false

  return (
    warning.plugin === '@tailwindcss/vite:generate:build' ||
    warning.plugin === 'nuxt:module-preload-polyfill'
  )
}

export function isKnownIconifyUnusedImportWarning(warning: ViteRollupWarning): boolean {
  const message = typeof warning === 'string' ? warning : (warning.message ?? '')
  return (
    message.includes('"addIcon" is imported from external module') &&
    (message.includes('@iconify/vue') || message.includes('@iconify+vue')) &&
    message.includes('iconify.mjs') &&
    message.includes('but never used')
  )
}

export function isKnownPlaywrightVirtualProxyWarning(warning: ViteRollupWarning): boolean {
  const message = typeof warning === 'string' ? warning : (warning.message ?? '')
  return (
    message.includes('"mocked-exports/proxy" is imported by') &&
    message.includes('virtual:playwright-core') &&
    message.includes('could not be resolved')
  )
}

export function isKnownGeneratedCircularDependencyWarning(warning: ViteRollupWarning): boolean {
  const message = typeof warning === 'string' ? warning : (warning.message ?? '')
  if (!message.includes('Circular dependency:')) return false

  return (
    message.includes('node_modules/.pnpm/') ||
    message.includes('node_modules/') ||
    message.includes('virtual:#imports') ||
    message.includes('virtual:#nitro-internal-virtual')
  )
}

function isVueUseCoreDistPath(value: string | undefined): boolean {
  if (!value) return false

  const normalized = `/${value.replaceAll('\\', '/')}`
  return normalized.includes('/node_modules/@vueuse/core/dist/index.js')
}

function isGeneratedServerFocusScopeChunkPath(value: string | undefined): boolean {
  if (!value) return false

  const normalized = value.replaceAll('\\', '/')
  return /(?:^|[/"])\.nuxt\/dist\/server\/_nuxt\/FocusScope-[^/"\s]+\.js(?:[".]|$)/u.test(
    normalized,
  )
}

/**
 * Reka UI 2.9.2 imports VueUse's `useEventListener` for a browser-only branch
 * in its body-scroll lock. The Nuxt server build removes that branch after
 * combining it into the generated FocusScope chunk, then Rollup reports the
 * now-dead external import. Keep this classifier constrained to Rollup's exact
 * code, symbol, exporter and generated server chunk so app-owned warnings stay
 * visible.
 */
export function isKnownRekaFocusScopeVueUseUnusedImportWarning(
  warning: ViteRollupWarning,
): boolean {
  const message = typeof warning === 'string' ? warning : (warning.message ?? '')
  if (!message.includes('"useEventListener" is imported from external module')) return false
  if (!message.includes('but never used in')) return false
  if (!isVueUseCoreDistPath(message)) return false
  if (!isGeneratedServerFocusScopeChunkPath(message)) return false

  if (typeof warning === 'string') return true

  return (
    warning.code === 'UNUSED_EXTERNAL_IMPORT' &&
    isVueUseCoreDistPath(warning.exporter) &&
    warning.names?.length === 1 &&
    warning.names[0] === 'useEventListener' &&
    warning.ids?.length === 1 &&
    isGeneratedServerFocusScopeChunkPath(warning.ids[0])
  )
}

function hasKnownVueUseInvalidAnnotationLocation(warning: ViteRollupWarning): boolean {
  if (typeof warning === 'string') {
    return vueUseInvalidAnnotationLocations.some(({ column, line }) =>
      warning.includes(`(${line}:${column})`),
    )
  }

  const { loc, message = '' } = warning
  return vueUseInvalidAnnotationLocations.some(
    ({ column, line }) =>
      (loc?.line === line && loc.column === column) || message.includes(`(${line}:${column})`),
  )
}

/**
 * VueUse 14.3.0 ships two misplaced PURE annotations. Rollup safely removes
 * them, and the upstream source fix is merged but not yet released:
 * https://github.com/vueuse/vueuse/pull/5388
 */
export function isKnownVueUseAnnotationPositionWarning(warning: ViteRollupWarning): boolean {
  const message = typeof warning === 'string' ? warning : (warning.message ?? '')
  if (!message.includes('#__PURE__')) return false
  if (
    !message.includes(
      'contains an annotation that Rollup cannot interpret due to the position of the comment',
    )
  ) {
    return false
  }

  if (typeof warning !== 'string') {
    if (warning.code !== 'INVALID_ANNOTATION' && warning.code !== 'ANNOTATION_POSITION') {
      return false
    }
    if (
      !isVueUseCoreDistPath(warning.id) &&
      !isVueUseCoreDistPath(warning.loc?.file) &&
      !isVueUseCoreDistPath(message)
    ) {
      return false
    }
  } else if (!isVueUseCoreDistPath(message)) {
    return false
  }

  return hasKnownVueUseInvalidAnnotationLocation(warning)
}

export function createCoreViteBuildLogger(): CoreViteBuildLogger {
  const loggedWarnings = new Set<string>()
  const loggedErrors = new WeakSet<Error>()

  const logger: CoreViteBuildLogger = {
    clearScreen: () => {},
    error(message, options) {
      if (options?.error) loggedErrors.add(options.error)
      console.error(message)
    },
    hasErrorLogged: (error) => loggedErrors.has(error),
    hasWarned: false,
    info: () => {},
    warn(message) {
      if (isKnownVueUseAnnotationPositionWarning(message)) return
      if (isKnownRekaFocusScopeVueUseUnusedImportWarning(message)) return
      if (isKnownIconifyUnusedImportWarning(message)) return
      if (isKnownPlaywrightVirtualProxyWarning(message)) return
      if (isKnownGeneratedCircularDependencyWarning(message)) return
      logger.hasWarned = true
      console.warn(message)
    },
    warnOnce(message) {
      if (isKnownVueUseAnnotationPositionWarning(message)) return
      if (isKnownRekaFocusScopeVueUseUnusedImportWarning(message)) return
      if (isKnownIconifyUnusedImportWarning(message)) return
      if (isKnownPlaywrightVirtualProxyWarning(message)) return
      if (isKnownGeneratedCircularDependencyWarning(message)) return
      if (loggedWarnings.has(message)) return
      loggedWarnings.add(message)
      logger.warn(message)
    },
  }

  return logger
}

export function applyCoreViteBuildWarningPolicy(config: unknown) {
  const mutableConfig = config as MutableViteBuildConfig
  mutableConfig.logLevel ??= 'warn'
  mutableConfig.customLogger ??= createCoreViteBuildLogger()
  mutableConfig.build ??= {}
  mutableConfig.build.chunkSizeWarningLimit ??= 1000
  mutableConfig.build.reportCompressedSize ??= false
  mutableConfig.build.rollupOptions ??= {}

  applyCoreRollupBuildWarningPolicy(mutableConfig.build.rollupOptions)
}

export function applyCoreRollupBuildWarningPolicy(config: unknown) {
  const mutableConfig = config as MutableRollupWarningConfig
  const existingOnWarn = mutableConfig.onwarn

  mutableConfig.onwarn = (warning, warn) => {
    // Upstream dependencies and tooling currently emit these known generated
    // warnings during production builds even though the output bundles correctly.
    if (isKnownVueUseAnnotationPositionWarning(warning as ViteRollupWarning)) return
    if (isKnownRekaFocusScopeVueUseUnusedImportWarning(warning as ViteRollupWarning)) return
    if (isKnownViteSourcemapWarning(warning as ViteRollupWarning)) return
    if (isKnownIconifyUnusedImportWarning(warning as ViteRollupWarning)) return
    if (isKnownPlaywrightVirtualProxyWarning(warning as ViteRollupWarning)) return
    if (isKnownGeneratedCircularDependencyWarning(warning as ViteRollupWarning)) return

    if (typeof existingOnWarn === 'function') {
      return existingOnWarn(warning, warn)
    }

    warn(warning)
  }
}
