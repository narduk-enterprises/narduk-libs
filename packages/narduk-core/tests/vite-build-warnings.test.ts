import { describe, expect, it, vi } from 'vitest'

import {
  applyCoreRollupBuildWarningPolicy,
  applyCoreViteBuildWarningPolicy,
  createCoreViteBuildLogger,
  isKnownGeneratedCircularDependencyWarning,
  isKnownPlaywrightVirtualProxyWarning,
} from '../runtime/shared/vite-build-warnings'

describe('vite build warning policy', () => {
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
