import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyCoreRollupBuildWarningPolicy,
  applyCoreViteBuildWarningPolicy,
  createCoreViteBuildLogger,
  isKnownGeneratedCircularDependencyWarning,
  isKnownPlaywrightVirtualProxyWarning,
  isKnownRekaFocusScopeVueUseUnusedImportWarning,
  isKnownVueUseAnnotationPositionWarning,
  type ViteRollupWarning,
} from '../runtime/shared/vite-build-warnings'

const vueUseCorePath =
  '/repo/node_modules/.pnpm/@vueuse+core@14.3.0_vue@3.5.39/node_modules/@vueuse/core/dist/index.js'

function annotationPositionMessage(path: string, line: number, column: number): string {
  return `${path} (${line}:${column}): A comment\n\n"/* #__PURE__ */"\n\nin "${path}" contains an annotation that Rollup cannot interpret due to the position of the comment. The comment will be removed to avoid issues.`
}

const generatedFocusScopePath =
  '/repo/node_modules/.cache/nuxt/.nuxt/dist/server/_nuxt/FocusScope-CXuIqawc.js'
const vueUseUnusedImportMessage = `"useEventListener" is imported from external module "file://${vueUseCorePath}" but never used in "node_modules/.cache/nuxt/.nuxt/dist/server/_nuxt/FocusScope-CXuIqawc.js".`

type StructuredViteRollupWarning = Exclude<ViteRollupWarning, string>

function vueUseUnusedImportWarning(
  overrides: Partial<StructuredViteRollupWarning> = {},
): StructuredViteRollupWarning {
  return {
    code: 'UNUSED_EXTERNAL_IMPORT',
    exporter: `file://${vueUseCorePath}`,
    ids: [generatedFocusScopePath],
    message: vueUseUnusedImportMessage,
    names: ['useEventListener'],
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('vite build warning policy', () => {
  it('recognizes only the generated Reka FocusScope VueUse unused import warning', () => {
    expect(isKnownRekaFocusScopeVueUseUnusedImportWarning(vueUseUnusedImportWarning())).toBe(true)
    expect(isKnownRekaFocusScopeVueUseUnusedImportWarning(vueUseUnusedImportMessage)).toBe(true)
    expect(
      isKnownRekaFocusScopeVueUseUnusedImportWarning(
        vueUseUnusedImportMessage.replace('node_modules/.cache/nuxt/.nuxt', '.nuxt'),
      ),
    ).toBe(true)

    expect(
      isKnownRekaFocusScopeVueUseUnusedImportWarning(
        vueUseUnusedImportWarning({ ids: ['/repo/apps/web/server/FocusScope-local.js'] }),
      ),
    ).toBe(false)
    expect(
      isKnownRekaFocusScopeVueUseUnusedImportWarning(
        vueUseUnusedImportWarning({
          ids: ['/repo/.nuxt/dist/server/_nuxt/AppModal-CXuIqawc.js'],
        }),
      ),
    ).toBe(false)
    expect(
      isKnownRekaFocusScopeVueUseUnusedImportWarning(
        vueUseUnusedImportWarning({ names: ['useMutationObserver'] }),
      ),
    ).toBe(false)
    expect(
      isKnownRekaFocusScopeVueUseUnusedImportWarning(
        vueUseUnusedImportWarning({ exporter: '/repo/apps/web/composables/useExample.ts' }),
      ),
    ).toBe(false)
  })

  it('filters the generated Reka FocusScope warning without hiding adjacent app warnings', () => {
    const logger = createCoreViteBuildLogger()
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    logger.warn(vueUseUnusedImportMessage)

    expect(logger.hasWarned).toBe(false)
    expect(consoleWarn).not.toHaveBeenCalled()

    const appMessage = vueUseUnusedImportMessage.replace(
      'node_modules/.cache/nuxt/.nuxt/dist/server/_nuxt/FocusScope-CXuIqawc.js',
      'apps/web/server/FocusScope-local.js',
    )
    logger.warn(appMessage)

    expect(logger.hasWarned).toBe(true)
    expect(consoleWarn).toHaveBeenCalledWith(appMessage)
  })

  it('filters the generated Reka FocusScope warning through Rollup onwarn', () => {
    const warn = vi.fn()
    const config = {}

    applyCoreRollupBuildWarningPolicy(config)
    const onwarn = (
      config as {
        onwarn: (warning: unknown, warn: (warning: unknown) => void) => void
      }
    ).onwarn

    const knownWarning = vueUseUnusedImportWarning()
    onwarn(knownWarning, warn)
    expect(warn).not.toHaveBeenCalled()

    const appWarning = vueUseUnusedImportWarning({
      ids: ['/repo/apps/web/server/FocusScope-local.js'],
    })
    onwarn(appWarning, warn)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(appWarning)
  })

  it('recognizes Playwright virtual proxy warnings as transient build noise', () => {
    expect(
      isKnownPlaywrightVirtualProxyWarning(
        '"mocked-exports/proxy" is imported by "\u0000virtual:playwright-core", but could not be resolved - treating it as an external dependency.',
      ),
    ).toBe(true)
    expect(isKnownPlaywrightVirtualProxyWarning('"other" could not be resolved')).toBe(false)
  })

  it('filters Playwright virtual proxy warnings through the shared logger', () => {
    const logger = createCoreViteBuildLogger()

    logger.warn(
      '"mocked-exports/proxy" is imported by "\u0000virtual:playwright-core", but could not be resolved - treating it as an external dependency.',
    )

    expect(logger.hasWarned).toBe(false)
  })

  it('only treats generated package circular dependencies as known build noise', () => {
    expect(
      isKnownGeneratedCircularDependencyWarning(
        'Circular dependency: ../../node_modules/.pnpm/nitropack@2.13.3/node_modules/nitropack/dist/runtime/index.mjs -> \u0000virtual:#nitro-internal-virtual/plugins -> ../../node_modules/.pnpm/@nuxtjs+sitemap@8.0.12/node_modules/@nuxtjs/sitemap/dist/runtime/server/utils.js',
      ),
    ).toBe(true)

    expect(
      isKnownGeneratedCircularDependencyWarning(
        'Circular dependency: server/utils/a.ts -> server/utils/b.ts -> server/utils/a.ts',
      ),
    ).toBe(false)
  })

  it('recognizes only the two known VueUse annotation-position warnings', () => {
    expect(
      isKnownVueUseAnnotationPositionWarning({
        code: 'INVALID_ANNOTATION',
        id: vueUseCorePath,
        loc: { column: 0, file: vueUseCorePath, line: 3362 },
        message: annotationPositionMessage(vueUseCorePath, 3362, 0),
      }),
    ).toBe(true)
    expect(
      isKnownVueUseAnnotationPositionWarning({
        code: 'ANNOTATION_POSITION',
        id: vueUseCorePath,
        loc: { column: 22, file: vueUseCorePath, line: 5780 },
        message: annotationPositionMessage(vueUseCorePath, 5780, 22),
      }),
    ).toBe(true)
    expect(
      isKnownVueUseAnnotationPositionWarning({
        code: 'INVALID_ANNOTATION',
        id: vueUseCorePath,
        loc: { column: 0, file: vueUseCorePath, line: 4000 },
        message: annotationPositionMessage(vueUseCorePath, 4000, 0),
      }),
    ).toBe(false)
  })

  it('keeps equivalent annotation-position warnings from app source visible', () => {
    const appPath = '/repo/apps/web/composables/useExample.ts'
    const appWarning = {
      code: 'INVALID_ANNOTATION',
      id: appPath,
      loc: { column: 0, file: appPath, line: 3362 },
      message: annotationPositionMessage(appPath, 3362, 0),
    }
    const warn = vi.fn()
    const config = {}

    expect(isKnownVueUseAnnotationPositionWarning(appWarning)).toBe(false)

    applyCoreRollupBuildWarningPolicy(config)
    const onwarn = (
      config as {
        onwarn: (warning: unknown, warn: (warning: unknown) => void) => void
      }
    ).onwarn

    onwarn(appWarning, warn)

    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(appWarning)
  })

  it('filters formatted VueUse warnings without hiding formatted app warnings', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logger = createCoreViteBuildLogger()
    const appPath = '/repo/apps/web/composables/useExample.ts'

    logger.warn(annotationPositionMessage(vueUseCorePath, 3362, 0))

    expect(logger.hasWarned).toBe(false)
    expect(consoleWarn).not.toHaveBeenCalled()

    const appMessage = annotationPositionMessage(appPath, 3362, 0)
    logger.warn(appMessage)

    expect(logger.hasWarned).toBe(true)
    expect(consoleWarn).toHaveBeenCalledWith(appMessage)
  })

  it('filters the known VueUse warnings through Rollup onwarn', () => {
    const warn = vi.fn()
    const config = {}

    applyCoreRollupBuildWarningPolicy(config)
    const onwarn = (
      config as {
        onwarn: (warning: unknown, warn: (warning: unknown) => void) => void
      }
    ).onwarn

    onwarn(
      {
        code: 'INVALID_ANNOTATION',
        id: vueUseCorePath,
        loc: { column: 22, file: vueUseCorePath, line: 5780 },
        message: annotationPositionMessage(vueUseCorePath, 5780, 22),
      },
      warn,
    )

    expect(warn).not.toHaveBeenCalled()
  })

  it('filters Playwright virtual proxy warnings through Rollup onwarn', () => {
    const warn = vi.fn()
    const config = {}

    applyCoreRollupBuildWarningPolicy(config)
    const onwarn = (
      config as {
        onwarn: (warning: unknown, warn: (warning: unknown) => void) => void
      }
    ).onwarn

    onwarn(
      {
        message:
          '"mocked-exports/proxy" is imported by "\u0000virtual:playwright-core", but could not be resolved - treating it as an external dependency.',
      },
      warn,
    )

    expect(warn).not.toHaveBeenCalled()
  })

  it('applies Rollup warning filtering through the Vite policy', () => {
    const warn = vi.fn()
    const config = {}

    applyCoreViteBuildWarningPolicy(config)
    const onwarn = (
      config as {
        build: {
          rollupOptions: { onwarn: (warning: unknown, warn: (warning: unknown) => void) => void }
        }
      }
    ).build.rollupOptions.onwarn

    onwarn(
      {
        message:
          '"mocked-exports/proxy" is imported by "\u0000virtual:playwright-core", but could not be resolved - treating it as an external dependency.',
      },
      warn,
    )

    expect(warn).not.toHaveBeenCalled()
  })
})
