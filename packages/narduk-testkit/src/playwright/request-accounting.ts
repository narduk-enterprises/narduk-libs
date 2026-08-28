import { expect } from '@playwright/test'

import type { Page } from '@playwright/test'

export interface ResourceRequestOptions {
  /**
   * Only count requests to this origin. Defaults to the page's own origin, which is almost always
   * what a boot-cost budget means: the app's own API, not a CDN font.
   */
  origin?: string
  /**
   * Only count requests whose path starts with this. `/api/` for an API budget, `/` for
   * everything. Also defines the scope of {@link RequestAccountingOptions.exhaustive}.
   */
  scope?: string
  /**
   * Return `pathname + search` rather than the absolute URL. Default true — a budget written
   * against a port number is a budget that breaks when the port changes.
   */
  relative?: boolean
  /**
   * Wait for `networkidle` before reading. Default true: a count taken while the page is still
   * asking for things is not a count, it is a race. Turn it off for a page that holds a socket or
   * a poll open, and do your own waiting.
   */
  waitForIdle?: boolean
}

export interface RequestAccountingOptions extends ResourceRequestOptions {
  /**
   * Fail if a request inside `scope` matches no budget entry. Default true whenever `scope` is
   * given, false otherwise.
   *
   * This is the half of the assertion that catches a NEW endpoint. A budget that only checks the
   * endpoints it already knows about will happily pass the day a page starts fetching a fifth
   * thing on boot.
   */
  exhaustive?: boolean
}

/**
 * How many times each path prefix may be requested. Keys are matched as prefixes of the request
 * path, so `/api/overview` covers `/api/overview?boatClass=x`.
 */
export type RequestBudget = Record<string, number>

interface CountedRequest {
  matched: string | null
  path: string
}

/**
 * Every request the document actually made, read from the browser's own Resource Timing entries.
 *
 * Read from the PAGE rather than from Playwright's request events, and that is a deliberate
 * difference rather than an accident of how it was first written. Playwright's events see every
 * request the browser attempted, including ones it then cancelled and ones a route handler
 * fulfilled without a network round trip. Resource Timing sees what the DOCUMENT ended up loading.
 * For a cold-boot budget — "did we fetch the overview once or twice" — the document's own view is
 * the honest one, and it is the same view a real user agent's performance panel shows.
 *
 * THIS DOES NOT WORK UNDER `page.clock`. Playwright's clock replaces `window.performance` with a
 * plain object stub whose `getEntriesByType` returns nothing at all, so every count here comes
 * back zero and every budget passes vacuously. Freeze time with
 * `playwright/deterministic-capture`'s `freezePageClock` instead, which leaves the performance
 * timeline alone; the incompatibility is documented at both ends because it fails silently.
 */
export async function readResourceRequests(
  page: Page,
  options: ResourceRequestOptions = {},
): Promise<string[]> {
  if (options.waitForIdle !== false) await page.waitForLoadState('networkidle')
  return page.evaluate(
    ({ origin, relative, scope }: { origin: string | null; relative: boolean; scope: string }) => {
      const base = origin ?? location.origin
      return performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => name.startsWith(base))
        .map((name) => (relative ? name.slice(base.length) : name))
        .filter((name) => (relative ? name : new URL(name).pathname).startsWith(scope))
    },
    {
      origin: options.origin ?? null,
      relative: options.relative !== false,
      scope: options.scope ?? '/',
    },
  )
}

function tally(paths: string[], budget: RequestBudget): CountedRequest[] {
  const prefixes = Object.keys(budget).sort((a, b) => b.length - a.length)
  return paths.map((path) => ({
    matched: prefixes.find((prefix) => path.startsWith(prefix)) ?? null,
    path,
  }))
}

/**
 * Assert the exact number of times each endpoint was requested during whatever the page just did.
 *
 * Exact, not "at most". A page that fetches its main payload TWICE on a cold load is a defect with
 * a real cost — the pattern this generalises from was catching a duplicated pair of ~90 KB JSON
 * responses on every first visit, caused by a request going out before the store had reconciled to
 * its default and again afterwards — and "at most 2" would have called that a pass. It is also a
 * defect nothing else notices: the page renders correctly, the specs pass, and the only symptom is
 * a number in a waterfall nobody opens.
 *
 * Write the budget as the shape you want, and the failure tells you the shape you have:
 *
 * ```ts
 * await expectRequestCounts(page, { '/api/overview': 1, '/api/map-context': 1 }, { scope: '/api/' })
 * ```
 *
 * With `scope` set, a request under it that matches no budget entry is also a failure — so a page
 * that starts fetching a new endpoint on boot has to say so in the budget rather than slipping in.
 */
export async function expectRequestCounts(
  page: Page,
  budget: RequestBudget,
  options: RequestAccountingOptions = {},
): Promise<void> {
  const paths = await readResourceRequests(page, options)
  const counted = tally(paths, budget)

  const actual: RequestBudget = {}
  for (const prefix of Object.keys(budget)) actual[prefix] = 0
  for (const entry of counted) if (entry.matched) actual[entry.matched] += 1

  expect(
    actual,
    'the page did not make the requests its cold-boot budget allows for. Requested: ' +
      `${paths.length ? paths.join(', ') : '(nothing)'}`,
  ).toEqual(budget)

  const exhaustive = options.exhaustive ?? options.scope !== undefined
  if (!exhaustive) return
  const unbudgeted = counted.filter((entry) => entry.matched === null).map((entry) => entry.path)
  expect(
    unbudgeted,
    `these requests are inside ${options.scope ?? '/'} but are in no budget entry. Add them to ` +
      'the budget if they belong on this path, or stop making them',
  ).toEqual([])
}
