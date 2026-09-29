// @vitest-environment happy-dom

/**
 * Strict mode against real exception shapes, end to end through the real
 * libraries: an ofetch `FetchError` (whose message quotes the request path), and
 * an app error quoting a record name. Each goes through narduk-core's
 * `buildExceptionReport`, this package's reporter properties and posthog-js's own
 * `captureException`, so the event under test is the one PostHog would send.
 * Nothing here is mocked; a fake event built from the same guess as the scrub
 * would prove nothing (the gap this file closes).
 */

import { buildExceptionReport } from '@narduk-enterprises/narduk-core/shared/exception-report'
import { createFetch } from 'ofetch'
import { PostHog } from 'posthog-js'
import { describe, expect, it } from 'vitest'

import {
  composeBeforeSend,
  createStrictPrivacyBeforeSend,
  STRICT_EXCEPTION_MESSAGE,
} from '../app/utils/analyticsPrivacy'
import { buildPostHogExceptionProperties } from '../app/utils/exceptionReporting'

import type { CaptureResult } from 'posthog-js'

const RECORD_ID = 'rec_9f3k2x'
const RECORD_NAME = 'harvest-ledger-private'

const ROUTES: Array<[RegExp, string]> = [[/^\/skills\/[^/]+$/u, '/skills/:name']]
const resolveRoute = (path: string) => {
  const hit = ROUTES.find(([pattern]) => pattern.test(path))
  return { matched: hit ? [{ path: hit[1] }] : [] }
}

async function realFetchError(): Promise<unknown> {
  const failing = createFetch({
    fetch: async () => new Response('missing', { status: 404, statusText: 'Not Found' }),
    Headers,
    AbortController,
  })
  try {
    await failing(`/api/records/${RECORD_ID}`)
  } catch (error) {
    return error
  }
  throw new Error('the failing fetch resolved')
}

/** Captures `error` with a real posthog-js client; returns the event before and after the hooks. */
function captureWithPostHog(error: unknown, route: string) {
  let raw: CaptureResult | null = null
  let sent: CaptureResult | null = null
  const strict = createStrictPrivacyBeforeSend({ origin: window.location.origin, resolveRoute })
  const hook = composeBeforeSend(
    (result) => {
      if (result?.event === '$exception') raw = structuredClone(result)
      return result
    },
    strict,
    (result) => {
      if (result?.event === '$exception') sent = result
      return null // never leave the test
    },
  )

  // `init` with a name returns a new, loaded instance; the receiver stays unloaded.
  const posthog = new PostHog().init(
    'phc_test_strict_exceptions',
    {
      api_host: 'https://posthog.invalid',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_external_dependency_loading: true,
      disable_session_recording: true,
      advanced_disable_flags: true,
      persistence: 'memory',
      // happy-dom's user agent reads as a bot to posthog-js.
      opt_out_useragent_filter: true,
      before_send: hook,
    },
    `strict-${Math.random()}`,
  )
  if (!posthog) throw new Error('posthog-js returned no instance')

  const report = buildExceptionReport(error, { source: 'client', route })
  posthog.captureException(report.error, buildPostHogExceptionProperties(report))
  return { raw: raw as CaptureResult | null, sent: sent as CaptureResult | null }
}

describe('strict mode on real exception messages', () => {
  it('sends no part of an ofetch error message (request path and record id)', async () => {
    const error = await realFetchError()
    // The real shape, so this test fails if ofetch ever stops quoting the path.
    expect((error as Error).message).toBe(`[GET] "/api/records/${RECORD_ID}": 404 Not Found`)

    const { raw, sent } = captureWithPostHog(error, '/records/:id')
    // Before the scrub the id is on the event: the scrub is what removes it.
    expect(JSON.stringify(raw)).toContain(RECORD_ID)
    // narduk-core's own redaction keeps the path (it strips queries and emails).
    expect(raw?.properties?.redacted_message).toContain(RECORD_ID)

    expect(sent).not.toBeNull()
    const wire = JSON.stringify(sent)
    expect(wire).not.toContain(RECORD_ID)
    expect(wire).not.toContain('/api/records')
    expect(sent?.properties?.$exception_list?.[0]).toMatchObject({
      type: 'FetchError',
      value: STRICT_EXCEPTION_MESSAGE,
    })
    expect(sent?.properties).not.toHaveProperty('redacted_message')
    expect(sent?.properties).not.toHaveProperty('$exception_message')
    expect(sent?.properties?.route).toBe('/records/:id')
  })

  it('sends no quoted record name from an app error', () => {
    const error = new Error(`No skill named "${RECORD_NAME}"`)
    const { raw, sent } = captureWithPostHog(error, '/skills/:name')
    expect(JSON.stringify(raw)).toContain(RECORD_NAME)

    const wire = JSON.stringify(sent)
    expect(wire).not.toContain(RECORD_NAME)
    expect(sent?.properties?.$exception_list?.[0]).toMatchObject({
      type: 'Error',
      value: STRICT_EXCEPTION_MESSAGE,
    })
  })
})
