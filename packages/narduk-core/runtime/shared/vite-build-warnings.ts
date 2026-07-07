export type ViteRollupWarning = string | { message?: string; plugin?: string }
type ViteLogType = 'error' | 'info' | 'warn'

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
    rollupOptions?: {
      onwarn?: (warning: unknown, warn: (warning: unknown) => void) => unknown
    }
  }
  customLogger?: CoreViteBuildLogger
  logLevel?: 'error' | 'info' | 'silent' | 'warn'
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
      if (isKnownIconifyUnusedImportWarning(message)) return
      logger.hasWarned = true
      console.warn(message)
    },
    warnOnce(message) {
      if (isKnownIconifyUnusedImportWarning(message)) return
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
  const existingOnWarn = mutableConfig.build.rollupOptions.onwarn

  mutableConfig.build.rollupOptions.onwarn = (warning, warn) => {
    // Upstream: these plugins currently emit sourcemap warnings during
    // production builds even though the output still bundles correctly.
    if (isKnownViteSourcemapWarning(warning as ViteRollupWarning)) return
    if (isKnownIconifyUnusedImportWarning(warning as ViteRollupWarning)) return

    if (typeof existingOnWarn === 'function') {
      return existingOnWarn(warning, warn)
    }

    warn(warning)
  }
}
