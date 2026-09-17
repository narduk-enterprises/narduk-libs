import { describe, expect, it, vi } from 'vitest'

import {
  buildPostHogExceptionProperties,
  reportExceptionToPostHog,
} from '../app/utils/exceptionReporting'

import type { PostHogExceptionClient } from '../app/utils/exceptionReporting'
import type { NardukExceptionReport } from '@narduk-enterprises/narduk-core/shared/exception-report'

function report(overrides: Partial<NardukExceptionReport> = {}): NardukExceptionReport {
  return {
    error: new Error('render failed'),
    buildVersion: 'abc123def456',
    fatal: false,
    message: 'render failed',
    name: 'Error',
    requestId: 'req-1234',
    route: '/stations/:id',
    source: 'client',
    statusCode: 500,
    ...overrides,
  }
}

function client(optedOut = false): PostHogExceptionClient & {
  captureException: ReturnType<typeof vi.fn>
} {
  return {
    captureException: vi.fn(),
    has_opted_out_capturing: () => optedOut,
  } as unknown as PostHogExceptionClient & { captureException: ReturnType<typeof vi.fn> }
}

describe('PostHog $exception properties', () => {
  it('carries the route pattern, build version, request id and status code', () => {
    expect(buildPostHogExceptionProperties(report())).toEqual({
      build_version: 'abc123def456',
      fatal: false,
      redacted_message: 'render failed',
      request_id: 'req-1234',
      route: '/stations/:id',
      source: 'client',
      status_code: 500,
    })
  })

  it('omits the optional keys rather than sending empty ones', () => {
    const properties = buildPostHogExceptionProperties(
      report({ buildVersion: undefined, requestId: undefined }),
    )

    expect(properties).not.toHaveProperty('build_version')
    expect(properties).not.toHaveProperty('request_id')
  })

  it('sends no raw path, so record ids and query strings stay out of PostHog', () => {
    const properties = buildPostHogExceptionProperties(report())

    expect(JSON.stringify(properties)).not.toContain('?')
    expect(properties.route).toBe('/stations/:id')
  })
})

describe('PostHog exception reporter', () => {
  it('captures through PostHog’s own exception API', () => {
    const posthog = client()
    const payload = report()

    expect(reportExceptionToPostHog(posthog, payload)).toBe(true)
    expect(posthog.captureException).toHaveBeenCalledWith(
      payload.error,
      buildPostHogExceptionProperties(payload),
    )
  })

  it('reports nothing when analytics never initialized', () => {
    // preview safe mode, no key, localhost, or `analyticsLoadStrategy: 'off'` —
    // `posthog.client` provides undefined in every one of those cases.
    expect(reportExceptionToPostHog(undefined, report())).toBe(false)
  })

  it('respects an opt-out', () => {
    const posthog = client(true)

    expect(reportExceptionToPostHog(posthog, report())).toBe(false)
    expect(posthog.captureException).not.toHaveBeenCalled()
  })
})

describe('PostHog exception plugin', () => {
  it('subscribes to narduk-core’s seam and reads the client at report time', async () => {
    const { emitNardukException } =
      await import('@narduk-enterprises/narduk-core/shared/exception-report')
    const plugin = (await import('../app/plugins/posthog-exceptions.client')).default as {
      dependsOn: string[]
      name: string
      setup: (app: unknown) => void
    }

    // A two-method stand-in for the Nuxt hook bus; the seam is declared
    // structurally for exactly this reason.
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    const nuxtApp = {
      $posthog: undefined as unknown,
      hook(name: string, handler: (...args: unknown[]) => void) {
        handlers.set(name, [...(handlers.get(name) ?? []), handler])
      },
      callHook(name: string, ...args: unknown[]) {
        for (const handler of handlers.get(name) ?? []) handler(...args)
      },
    }

    plugin.setup(nuxtApp)

    // Under the idle and interaction load strategies `posthog.client` provides
    // the client after this plugin has already run, so a client read at setup
    // time would permanently report nothing.
    const posthog = client()
    nuxtApp.$posthog = posthog
    emitNardukException(nuxtApp as never, report())

    expect(posthog.captureException).toHaveBeenCalledTimes(1)
    expect(plugin.dependsOn).toContain('posthog')
    expect(plugin.name).toBe('posthog-exceptions')
  })

  it('reports nothing while the client is still undefined', async () => {
    const { emitNardukException } =
      await import('@narduk-enterprises/narduk-core/shared/exception-report')
    const plugin = (await import('../app/plugins/posthog-exceptions.client')).default as {
      setup: (app: unknown) => void
    }
    const handlers: Array<(...args: unknown[]) => void> = []
    const nuxtApp = {
      $posthog: undefined,
      hook: (_name: string, handler: (...args: unknown[]) => void) => handlers.push(handler),
      callHook: (_name: string, ...args: unknown[]) => {
        for (const handler of handlers) handler(...args)
      },
    }

    plugin.setup(nuxtApp)

    expect(() => emitNardukException(nuxtApp as never, report())).not.toThrow()
  })

  it('is registered by the module', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../src/module.ts', import.meta.url), 'utf-8')

    expect(source).toContain(
      "addPlugin(resolver.resolve('../app/plugins/posthog-exceptions.client'))",
    )
  })
})
