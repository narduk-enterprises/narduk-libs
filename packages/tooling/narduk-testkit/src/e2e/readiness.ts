import { test as base } from '@playwright/test'

import { waitForBaseUrlReady, warmUpApp } from './fixtures.js'

import type { Browser } from '@playwright/test'

/*
 * The body of the `setup` project that `createNardukPlaywrightPreset` declares
 * and that `pr`/`web` depend on (#1000). `webServer.url` cannot say an app is
 * ready: Playwright accepts any 2xx–403 without reading the body, and
 * `nuxt dev` answers an API route before a page's SSR/Vite graph is compiled.
 * One setup test gates every spec, so no spec file can forget the guard.
 */

export const READINESS_TEST_TITLE = 'app is ready for e2e navigation'

export const DEFAULT_READINESS_HEALTH_PATH = '/api/health'
export const DEFAULT_READINESS_TIMEOUT_MS = 150_000

export interface ReadinessSetupOptions {
  /** Health route read after the base URL answers. `false` skips it. Default `/api/health`. */
  healthPath?: string | false
  /** Accept `status: 'degraded'` as well as `'ok'`. Default `true`. */
  acceptDegraded?: boolean
  /** Extra app assertions on the parsed health body; throw to fail. */
  expectHealth?: (body: unknown) => void | Promise<void>
  /** Routes loaded once each, outside any test clock. Default `['/']`. */
  warmPaths?: readonly string[]
  /** Budget for the whole setup test. Default 150 000 ms. */
  timeoutMs?: number
}

export interface ReadinessContext {
  baseURL: string
  browser: Pick<Browser, 'newPage'>
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** Injectable for tests; defaults to `waitForBaseUrlReady`. */
  waitForBaseUrl?: (baseUrl: string, timeoutMs: number) => Promise<void>
  /** Injectable for tests; defaults to `warmUpApp`. */
  warmUp?: (browser: Pick<Browser, 'newPage'>, baseUrl: string, path: string) => Promise<void>
}

const HEALTH_RETRY_MS = 1_000

/**
 * The status a health body reports. narduk-core's `/api/health` wraps it in
 * the `{ success, data }` envelope; a bare `{ status }` body is read too.
 */
export function readHealthStatus(body: unknown): unknown {
  if (!body || typeof body !== 'object') return undefined
  const record = body as { data?: unknown; status?: unknown }
  if (record.data && typeof record.data === 'object' && 'status' in record.data) {
    return (record.data as { status?: unknown }).status
  }
  return record.status
}

/** Throws unless the health body reports an accepted status. */
export function assertHealthStatus(body: unknown, acceptDegraded = true): void {
  const status = readHealthStatus(body)
  const accepted = acceptDegraded ? ['ok', 'degraded'] : ['ok']
  if (typeof status !== 'string' || !accepted.includes(status)) {
    throw new Error(
      `health status ${JSON.stringify(status)} is not ${accepted.map((s) => `'${s}'`).join(' or ')}`,
    )
  }
}

async function checkHealthOnce(
  url: string,
  fetchImpl: typeof fetch,
  options: ReadinessSetupOptions,
  timeoutMs: number,
): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    const text = await response.text()
    if (response.status !== 200) {
      throw new Error(`GET ${url} answered ${response.status}`)
    }
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error(`GET ${url} did not answer JSON`)
    }
    assertHealthStatus(body, options.acceptDegraded !== false)
    await options.expectHealth?.(body)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Poll the health route until it passes or the deadline is reached. A dev
 * server can answer 503 while it compiles, so one failed read is not final;
 * the last failure is what the error reports.
 */
async function waitForHealth(
  url: string,
  fetchImpl: typeof fetch,
  options: ReadinessSetupOptions,
  deadline: number,
): Promise<void> {
  let lastError: unknown
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    try {
      await checkHealthOnce(url, fetchImpl, options, Math.min(10_000, remaining))
      return
    } catch (error) {
      lastError = error
    }
    const sleep = Math.min(HEALTH_RETRY_MS, deadline - Date.now())
    if (sleep <= 0) break
    await new Promise((resolve) => setTimeout(resolve, sleep))
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError ?? 'timed out')
  throw new Error(`App health at ${url} did not pass before the readiness deadline: ${reason}`)
}

/**
 * Base URL answers → health route passes → each warm path loads once. Exported
 * for apps that keep their own setup test and want the same sequence.
 */
export async function runReadinessChecks(
  context: ReadinessContext,
  options: ReadinessSetupOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  const fetchImpl = context.fetch ?? fetch
  const waitForBaseUrl = context.waitForBaseUrl ?? waitForBaseUrlReady
  const warmUp = context.warmUp ?? warmUpApp

  await waitForBaseUrl(context.baseURL, timeoutMs)

  const healthPath = options.healthPath ?? DEFAULT_READINESS_HEALTH_PATH
  if (healthPath !== false) {
    const url = new URL(healthPath, context.baseURL).toString()
    await waitForHealth(url, fetchImpl, options, deadline)
  }

  for (const path of options.warmPaths ?? ['/']) {
    await warmUp(context.browser, context.baseURL, path)
  }
}

type ReadinessTestFn = (
  title: string,
  body: (fixtures: { baseURL: string | undefined; browser: Browser }) => Promise<void>,
) => void

export interface ReadinessRegistrar {
  (title: string, body: Parameters<ReadinessTestFn>[1]): void
  setTimeout(timeout: number): void
}

/**
 * Register the one readiness test. Call it from an app's
 * `tests/e2e/global.setup.ts`; `createNardukPlaywrightPreset` already makes
 * `pr` and `web` depend on that file's `setup` project.
 *
 * ```ts
 * import { registerReadinessSetup } from '@narduk-enterprises/narduk-testkit/e2e/readiness'
 * registerReadinessSetup({ warmPaths: ['/', '/map'] })
 * ```
 */
export function registerReadinessSetup(
  options: ReadinessSetupOptions = {},
  registrar: ReadinessRegistrar = base as unknown as ReadinessRegistrar,
): void {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS
  registrar(READINESS_TEST_TITLE, async ({ baseURL, browser }) => {
    // The warm loads have their own per-page timeouts; give the test room for
    // them past the readiness budget instead of racing it.
    registrar.setTimeout(timeoutMs + 90_000 * (options.warmPaths?.length ?? 1))
    if (!baseURL) {
      throw new Error('registerReadinessSetup needs `use.baseURL` in the Playwright config')
    }
    await runReadinessChecks({ baseURL, browser }, options)
  })
}
