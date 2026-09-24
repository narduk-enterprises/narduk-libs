import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  HYDRATION_MISMATCH_HTML_LIMIT,
  VUE_E2E_HYDRATION_MISMATCH_DETAILS_DEFINE,
  attachHydrationMismatchReporter,
  formatHydrationMismatchFailure,
  installHydrationMismatchConsoleHook,
  isHydrationConsoleText,
} from '../src/e2e/hydration-mismatch.js'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const VUE_PROD_HYDRATION_SENTENCE = 'Hydration completed but contains mismatches.'

interface NodeLike {
  nodeName?: string
  nodeType: number
  nodeValue?: string | null
  outerHTML?: string
  parentElement?: NodeLike | null
}

function playwrightText(args: unknown[]): string {
  return args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' ')
}

function stubPage() {
  const initScripts: Array<{
    arg: { htmlLimit: number }
    script: (arg: { htmlLimit: number }) => void
  }> = []
  const consoleListeners: Array<(msg: { text: () => string }) => void> = []

  const page = {
    addInitScript: (script: (arg: { htmlLimit: number }) => void, arg: { htmlLimit: number }) => {
      initScripts.push({ arg, script })
      return Promise.resolve()
    },
    on: (event: string, listener: (msg: { text: () => string }) => void) => {
      if (event === 'console') consoleListeners.push(listener)
    },
  }

  return { consoleListeners, initScripts, page }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * The 1.7.0 fixture only stored `msg.text()`. Vue's production build logs this
 * sentence with no URL and no node, so every consumer CI line was
 * `Hydration errors detected in console` and nothing else (narduk-farm#368,
 * narduk-farm#369, narduk-libs#801). This test fails on that fixture: the
 * hook has to serialise the page and the node inside the page as warn fires.
 */
describe('hydration-mismatch reporter (#801)', () => {
  it('names the page and the mismatched node in the fixture failure', async () => {
    const consoleLogs: string[] = []
    const { consoleListeners, initScripts, page } = stubPage()
    const warnings: unknown[][] = []

    await attachHydrationMismatchReporter(page, consoleLogs)
    expect(initScripts).toHaveLength(1)
    expect(initScripts[0]?.script).toBe(installHydrationMismatchConsoleHook)

    const node: NodeLike = {
      nodeType: 1,
      outerHTML: '<a class="nav-link" href="/map">Map</a>',
      parentElement: {
        nodeType: 1,
        outerHTML: '<nav class="sidebar"><a class="nav-link" href="/map">Map</a></nav>',
      },
    }

    vi.stubGlobal('location', {
      href: 'http://127.0.0.1:4173/sidebar',
      pathname: '/sidebar',
    })
    vi.stubGlobal('console', {
      warn: (...args: unknown[]) => {
        warnings.push(args)
      },
    })

    initScripts[0]!.script(initScripts[0]!.arg)
    console.warn(VUE_PROD_HYDRATION_SENTENCE, node)

    expect(warnings).toHaveLength(1)
    const text = playwrightText(warnings[0]!)
    for (const listener of consoleListeners) {
      listener({ text: () => text })
    }

    const hydrationErrors = consoleLogs.filter(isHydrationConsoleText)
    const error = formatHydrationMismatchFailure(hydrationErrors)

    expect(error.message).toContain('Hydration errors detected in console')
    expect(error.message).toContain(VUE_PROD_HYDRATION_SENTENCE)
    expect(error.message).toContain('page: /sidebar')
    expect(error.message).toContain('url: http://127.0.0.1:4173/sidebar')
    expect(error.message).toContain('node: <a class="nav-link" href="/map">Map</a>')
    expect(error.message).toContain(
      'parent: <nav class="sidebar"><a class="nav-link" href="/map">Map</a></nav>',
    )
  })

  it('keeps the page that was current when the warning fired, not a later goto', () => {
    const warnings: unknown[][] = []
    const node: NodeLike = {
      nodeType: 1,
      outerHTML: '<img alt="" src="/logo.svg">',
    }
    const location = {
      href: 'http://127.0.0.1:4173/sidebar',
      pathname: '/sidebar',
    }

    vi.stubGlobal('location', location)
    vi.stubGlobal('console', {
      warn: (...args: unknown[]) => {
        warnings.push(args)
      },
    })

    installHydrationMismatchConsoleHook()
    console.warn(VUE_PROD_HYDRATION_SENTENCE, node)

    location.href = 'http://127.0.0.1:4173/dashboard'
    location.pathname = '/dashboard'

    const text = playwrightText(warnings[0]!)
    expect(text).toContain('page: /sidebar')
    expect(text).toContain('url: http://127.0.0.1:4173/sidebar')
    expect(text).not.toContain('/dashboard')
    expect(text).toContain('node: <img alt="" src="/logo.svg">')
  })

  it('still names the page when Vue stripped the node arguments', () => {
    const warnings: unknown[][] = []
    vi.stubGlobal('location', {
      href: 'http://127.0.0.1:4173/farms/12',
      pathname: '/farms/12',
    })
    vi.stubGlobal('console', {
      warn: (...args: unknown[]) => {
        warnings.push(args)
      },
    })

    installHydrationMismatchConsoleHook()
    console.warn(VUE_PROD_HYDRATION_SENTENCE)

    const text = playwrightText(warnings[0]!)
    expect(text).toContain('page: /farms/12')
    expect(text).toContain('url: http://127.0.0.1:4173/farms/12')
    expect(text).not.toContain('node:')
  })

  it('leaves unrelated console.warn arguments unchanged', () => {
    const warnings: unknown[][] = []
    vi.stubGlobal('location', { href: 'http://127.0.0.1:4173/', pathname: '/' })
    vi.stubGlobal('console', {
      warn: (...args: unknown[]) => {
        warnings.push(args)
      },
    })

    installHydrationMismatchConsoleHook()
    console.warn('slow network', { retry: 1 })

    expect(warnings).toEqual([['slow network', { retry: 1 }]])
  })

  it('truncates long outerHTML and serialises a text node without outerHTML', () => {
    const warnings: unknown[][] = []
    const long = `<div class="wide">${'x'.repeat(800)}</div>`
    vi.stubGlobal('location', { href: 'http://127.0.0.1:4173/x', pathname: '/x' })
    vi.stubGlobal('console', {
      warn: (...args: unknown[]) => {
        warnings.push(args)
      },
    })

    installHydrationMismatchConsoleHook({ htmlLimit: 40 })
    console.warn('Hydration text mismatch on', {
      nodeName: '#text',
      nodeType: 3,
      nodeValue: 'server-rendered copy',
      parentElement: { nodeType: 1, outerHTML: long },
    })

    const text = playwrightText(warnings[0]!)
    expect(text).toContain('node: server-rendered copy')
    expect(text).toContain('parent: <div class="wide">')
    expect(text).toContain('…')
    expect(text).not.toContain('x'.repeat(80))
  })

  it('the E2E page fixture installs the in-page hook rather than evaluating JSHandles later', () => {
    const fixtures = readFileSync(join(packageRoot, 'src/e2e/fixtures.ts'), 'utf8')
    expect(fixtures).toContain('attachHydrationMismatchReporter')
    expect(fixtures).not.toContain('arg.evaluate')
  })
})

describe('hydration-mismatch helpers', () => {
  it('exports the E2E-only Vite define Vue needs to keep mismatch node arguments', () => {
    expect(VUE_E2E_HYDRATION_MISMATCH_DETAILS_DEFINE).toEqual({
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true',
    })
    expect(HYDRATION_MISMATCH_HTML_LIMIT).toBe(500)
  })

  it('treats the production Vue sentence as a hydration console line', () => {
    expect(isHydrationConsoleText(VUE_PROD_HYDRATION_SENTENCE)).toBe(true)
    expect(isHydrationConsoleText('slow network')).toBe(false)
  })
})
