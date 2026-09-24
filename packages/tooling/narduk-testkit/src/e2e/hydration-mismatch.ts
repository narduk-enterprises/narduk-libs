/**
 * Hydration-mismatch reporting for the shared E2E `page` fixture (#801).
 *
 * Vue's production build logs only `Hydration completed but contains mismatches.`
 * The 1.7.0 fixture stored `msg.text()` and threw that sentence. A
 * `page.on('console')` handler that `await`s `arg.evaluate` loses the handle
 * as soon as the test navigates again — the back-to-back `goto` pattern that
 * exposed narduk-farm#368 and narduk-farm#369.
 *
 * The function passed to `page.addInitScript` is serialised into the page, so
 * it closes over nothing from this module. Node-like arguments are turned
 * into `page` / `url` / `node` / `parent` strings in the same turn as
 * `console.warn`, then appended so Playwright's `msg.text()` already carries
 * them.
 */

export const HYDRATION_MISMATCH_HTML_LIMIT = 500

/**
 * Spread into `vite.define` for the E2E or CI preview build only — never the
 * production deploy. With this on, Vue keeps the first mismatch's server node
 * and client expectation on `console.warn`.
 *
 * ```ts
 * vite: {
 *   define: {
 *     ...(process.env.NARDUK_E2E === '1'
 *       ? VUE_E2E_HYDRATION_MISMATCH_DETAILS_DEFINE
 *       : {}),
 *   },
 * }
 * ```
 */
export const VUE_E2E_HYDRATION_MISMATCH_DETAILS_DEFINE = {
  __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true',
} as const

export const HYDRATION_PATTERNS = [
  /hydration/i,
  /mismatch/i,
  /hydration node mismatch/i,
  /data-server-rendered/i,
]

export function isHydrationConsoleText(text: string): boolean {
  return HYDRATION_PATTERNS.some((pattern) => pattern.test(text))
}

export function formatHydrationMismatchFailure(lines: string[]): Error {
  return new Error(`Hydration errors detected in console:\n${lines.join('\n')}`)
}

export interface HydrationMismatchInitOptions {
  htmlLimit?: number
}

type NodeLike = {
  nodeName?: string
  nodeType: number
  nodeValue?: string | null
  outerHTML?: string
  parentElement?: NodeLike | null
}

export interface HydrationMismatchConsolePage {
  addInitScript(
    script: (arg: { htmlLimit: number }) => void,
    arg: { htmlLimit: number },
  ): Promise<unknown> | unknown
  // Method syntax so Playwright's overloaded `page.on` stays assignable.
  on(event: 'console', listener: (msg: { text: () => string }) => void): unknown
}

/**
 * Self-contained console.warn wrap. Playwright stringifies this function into
 * every future document; do not close over module bindings.
 */
export function installHydrationMismatchConsoleHook(
  options: HydrationMismatchInitOptions = {},
): void {
  const htmlLimit =
    typeof options === 'object' && options && typeof options.htmlLimit === 'number'
      ? options.htmlLimit
      : 500

  const originalWarn = console.warn.bind(console)

  const isHydrationText = (value: unknown): value is string =>
    typeof value === 'string' && /hydration|mismatch|data-server-rendered/i.test(value)

  const isNodeLike = (value: unknown): value is NodeLike =>
    typeof value === 'object' &&
    value !== null &&
    'nodeType' in value &&
    typeof (value as { nodeType: unknown }).nodeType === 'number'

  const htmlOf = (node: NodeLike): string => {
    if (typeof node.outerHTML === 'string') return node.outerHTML
    if (typeof node.nodeValue === 'string' && node.nodeValue.length > 0) {
      return node.nodeValue
    }
    return node.nodeName ?? '[node]'
  }

  const truncate = (html: string): string =>
    html.length <= htmlLimit ? html : `${html.slice(0, htmlLimit)}…`

  console.warn = (...args: unknown[]) => {
    if (!args.some(isHydrationText)) {
      originalWarn(...args)
      return
    }

    const pathname =
      typeof location === 'object' && location && typeof location.pathname === 'string'
        ? location.pathname
        : ''
    const href =
      typeof location === 'object' && location && typeof location.href === 'string'
        ? location.href
        : ''

    const details: string[] = []
    if (pathname) details.push(`page: ${pathname}`)
    if (href) details.push(`url: ${href}`)
    if (details.length === 0) details.push('page: (unknown)')

    for (const node of args.filter(isNodeLike)) {
      details.push(`node: ${truncate(htmlOf(node))}`)
      if (node.parentElement) {
        details.push(`parent: ${truncate(htmlOf(node.parentElement))}`)
      }
    }

    originalWarn(...args, details.join('\n'))
  }
}

export async function attachHydrationMismatchReporter(
  page: HydrationMismatchConsolePage,
  consoleLogs: string[],
): Promise<void> {
  await page.addInitScript(installHydrationMismatchConsoleHook, {
    htmlLimit: HYDRATION_MISMATCH_HTML_LIMIT,
  })
  page.on('console', (msg) => {
    consoleLogs.push(msg.text())
  })
}
