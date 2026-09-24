import { renderToString } from '@vue/server-renderer'
import { createSSRApp, h } from 'vue'
import { vi } from 'vitest'

import type { Component } from 'vue'

/**
 * Server-render a component, then hydrate that exact markup and report every
 * warning Vue raised while doing it.
 *
 * A hydration mismatch is only ever visible as a development warning — Vue
 * recovers by discarding the server subtree and re-rendering on the client —
 * so the warning *is* the assertion. Vue 3.5 `warn()` writes `[Vue warn]`
 * to `console.warn`; a tree mismatch also calls `logMismatchError()` once
 * per process on `console.error`.
 */
export function captureConsoleStreams() {
  const warnings: string[] = []
  const capture = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }
  const spies = [
    vi.spyOn(console, 'warn').mockImplementation(capture),
    vi.spyOn(console, 'error').mockImplementation(capture),
  ]
  return {
    restore: () => {
      for (const spy of spies) spy.mockRestore()
    },
    warnings,
  }
}

function hydrateMarkup(html: string, render: () => unknown) {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)

  const captured = captureConsoleStreams()
  try {
    createSSRApp(render).mount(root, true)
  } finally {
    captured.restore()
    root.remove()
  }
  return { html, warnings: captured.warnings }
}

export async function hydrationWarnings(component: Component, props: Record<string, unknown> = {}) {
  const html = await renderToString(createSSRApp(() => h(component, props)))
  return hydrateMarkup(html, () => h(component, props))
}

/**
 * Control: server text `server`, client text `client`. Vue 3.5.39 emits
 * `[Vue warn]: Hydration text content mismatch` on `console.warn` and one
 * `Hydration completed but contains mismatches.` on `console.error`.
 */
export async function knownTextMismatchWarnings() {
  const html = await renderToString(createSSRApp(() => h('div', 'server')))
  return hydrateMarkup(html, () => h('div', 'client')).warnings
}

export function hydrationMismatchLines(warnings: string[]) {
  return warnings.filter(line => /hydrat/iu.test(line))
}

/**
 * Vue 3.5 `hydrateElement` force-patches `dynamicProps` with namespace
 * `undefined`, so SVG geometry (`x`/`y`/`width`/…) is assigned as a DOM
 * property. Those properties are getter-only `SVGAnimatedLength` objects
 * (the SVG spec; happy-dom matches it), and Vue's catch logs
 * `Failed setting prop … which has only a getter`. That is not a hydration
 * mismatch and not `withDirectives`.
 */
export function unexpectedDevelopmentWarnings(warnings: string[]) {
  return warnings.filter(line => !isSvgGeometrySetterWarning(line))
}

function isSvgGeometrySetterWarning(line: string) {
  return line.includes('Failed setting prop') && line.includes('which has only a getter')
}
