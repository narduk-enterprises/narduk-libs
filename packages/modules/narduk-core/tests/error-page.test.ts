import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ERROR_STATUS_CODE,
  resolveErrorDetail,
  resolveErrorPresentation,
  resolveErrorStatusCode,
  runBeforeClear,
} from '../runtime/app/error-page'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const errorPage = readFileSync(join(packageRoot, 'runtime/app/error.vue'), 'utf-8')

describe('error page copy', () => {
  it('names the outcome for each status an app actually returns', () => {
    expect(resolveErrorPresentation(404).title).toBe('Page not found')
    expect(resolveErrorPresentation(403).title).toBe('Access denied')
    expect(resolveErrorPresentation(401).title).toBe('Not authenticated')
    expect(resolveErrorPresentation(429).title).toBe('Too many requests')
    expect(resolveErrorPresentation(503).title).toBe('Temporarily unavailable')
  })

  it('falls back for an unrecognized or missing status', () => {
    expect(resolveErrorPresentation(500).title).toBe('Something went wrong')
    expect(resolveErrorPresentation(418).title).toBe('Something went wrong')
    expect(resolveErrorPresentation(undefined).title).toBe('Something went wrong')
    expect(resolveErrorStatusCode(undefined)).toBe(DEFAULT_ERROR_STATUS_CODE)
    expect(resolveErrorStatusCode(Number.NaN)).toBe(DEFAULT_ERROR_STATUS_CODE)
    expect(resolveErrorStatusCode(404)).toBe(404)
  })

  it('shows the raw error message only outside production', () => {
    expect(resolveErrorDetail('D1_ERROR: no such table: users', false)).toBe('')
    expect(resolveErrorDetail('D1_ERROR: no such table: users', true)).toBe(
      'D1_ERROR: no such table: users',
    )
    expect(resolveErrorDetail(undefined, true)).toBe('')
  })
})

describe('error page contract', () => {
  it('keeps itself out of the index', () => {
    expect(errorPage).toContain("{ name: 'robots', content: 'noindex, nofollow' }")
  })

  it('shows the request id support asks for, from the shared composable', () => {
    expect(errorPage).toContain("import { useRequestId } from './composables/useRequestId'")
    expect(errorPage).toContain('data-testid="error-page-request-id"')
    // Rendered only when one exists: a client-only render has no request id and
    // an empty label would be worse than none.
    expect(errorPage).toContain('v-if="requestId"')
  })

  it('gates the diagnostic detail on previewSafeMode', () => {
    expect(errorPage).toContain(
      'resolveErrorDetail(props.error.message, runtimeConfig.public.previewSafeMode === true)',
    )
  })

  it('exposes the test ids the estate E2E suites select on', () => {
    for (const testId of [
      'error-page',
      'error-page-status',
      'error-page-title',
      'error-page-description',
      'error-page-home',
      'error-page-retry',
      'error-page-request-id',
      'error-page-detail',
    ]) {
      expect(errorPage).toContain(`data-testid="${testId}"`)
    }
  })

  it('keeps both recovery actions', () => {
    expect(errorPage).toContain('clearError({ redirect: ')
    expect(errorPage).toContain('reloadNuxtApp()')
  })
})

describe('error page seams (narduk-libs#976)', () => {
  it('takes an app copy per status, then its default, then the estate copy', () => {
    const copy = {
      404: { title: 'No screen lives at that address.' },
      default: { description: 'The farm hit a snag.' },
    }
    expect(resolveErrorPresentation(404, copy)).toEqual({
      title: 'No screen lives at that address.',
      description: 'The farm hit a snag.',
    })
    expect(resolveErrorPresentation(500, copy)).toEqual({
      title: 'Something went wrong',
      description: 'The farm hit a snag.',
    })
    expect(resolveErrorPresentation(403, { 403: { title: '  ' } }).title).toBe('Access denied')
    expect(resolveErrorPresentation(404, undefined)).toEqual(resolveErrorPresentation(404))
  })

  it('never routes the error message through the copy seam', () => {
    expect(errorPage).toContain('resolveErrorPresentation(props.error.statusCode, props.copy)')
    expect(errorPage).not.toMatch(/props\.error\.(message|statusMessage)[^,]*props\.copy/u)
  })

  it('runs onBeforeClear before recovery and swallows its failures', async () => {
    const calls: string[] = []
    await runBeforeClear((_error, action) => calls.push(action), { statusCode: 500 }, 'home')
    expect(calls).toEqual(['home'])
    await expect(
      runBeforeClear(() => Promise.reject(new Error('log sink down')), {}, 'retry'),
    ).resolves.toBeUndefined()
    await expect(
      runBeforeClear(
        () => {
          throw new Error('sync throw')
        },
        {},
        'retry',
      ),
    ).resolves.toBeUndefined()
    await expect(runBeforeClear(undefined, {}, 'home')).resolves.toBeUndefined()
  })

  it('awaits the hook before both recovery actions', () => {
    const home = errorPage.slice(errorPage.indexOf('async function handleError'))
    expect(home.indexOf("runBeforeClear(props.onBeforeClear, props.error, 'home')")).toBeLessThan(
      home.indexOf('clearError({ redirect: props.homeTo })'),
    )
    const retry = errorPage.slice(errorPage.indexOf('async function refreshPage'))
    expect(retry.indexOf("runBeforeClear(props.onBeforeClear, props.error, 'retry')")).toBeLessThan(
      retry.indexOf('reloadNuxtApp()'),
    )
  })

  it('themes through ui classes, keeping text-primary only as the default', () => {
    expect(errorPage).toContain("ui.status ?? 'text-primary'")
    expect(errorPage).toContain("ui.title ?? 'text-primary'")
    expect(errorPage).toContain(':class="ui.home"')
  })

  it('renders links and an actions slot, and wraps in an optional layout', () => {
    expect(errorPage).toContain('data-testid="error-page-link"')
    expect(errorPage).toContain('<slot name="actions"')
    expect(errorPage).toContain('<component :is="wrapper" v-bind="wrapperProps">')
    expect(errorPage).toContain('props.layout ? NuxtLayout : PassThrough')
    expect(errorPage).toMatch(/layout: false,/u)
  })
})
