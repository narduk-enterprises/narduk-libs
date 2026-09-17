import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ERROR_STATUS_CODE,
  resolveErrorDetail,
  resolveErrorPresentation,
  resolveErrorStatusCode,
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
