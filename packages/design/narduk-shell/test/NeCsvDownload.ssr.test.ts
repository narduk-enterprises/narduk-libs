/*
 * Server-render proof for NeCsvDownload (narduk-libs#528).
 *
 * Pattern: packages/design/narduk-charts/src/ssr.test.ts. The button only
 * builds the file on click, in the browser (`document` / `URL.createObjectURL`).
 * That path must not run at setup time: a Cloudflare Workers first paint has
 * neither global. This file therefore runs in vitest's `node` environment
 * (this package's default) and renders through `@vue/server-renderer`.
 *
 * The real `UButton` is rendered. Resolving without throwing is not enough —
 * the first paint must already show the control a reader clicks after
 * hydration.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'

import NeCsvDownload from '../src/runtime/components/NeCsvDownload.vue'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(props: Record<string, unknown> = {}): Promise<string> {
  return renderToString(
    createSSRApp(NeCsvDownload, {
      columns: [
        { key: 'time', label: 'Time' },
        { key: 'wind', label: 'Wind', unit: 'kt' },
      ],
      filename: 'history',
      rows: [
        { time: '1:50 PM', wind: 14 },
        { time: '12:50 PM', wind: null },
      ],
      ...props,
    }),
  )
}

describe('NeCsvDownload server-rendered without a DOM', () => {
  it('carries the inert CSV button into the first paint', async () => {
    const html = await render()

    expect(html).toContain('data-ne-csv-download')
    expect(html).toContain('CSV')
    expect(html).toContain('aria-label="Download 2 rows as CSV"')
    expect(html).toContain('<button')
    expect(html).not.toContain('blob:')
  })

  it('singularises the accessible name for one row', async () => {
    const html = await render({ rows: [{ time: '1:50 PM', wind: 14 }] })

    expect(html).toContain('aria-label="Download 1 row as CSV"')
  })

  it('honours a custom label in the server output', async () => {
    const html = await render({ label: 'Export' })

    expect(html).toContain('Export')
    expect(html).toContain('data-ne-csv-download')
  })

  it('does not touch a DOM global merely by rendering twice', async () => {
    await expect(render()).resolves.toContain('data-ne-csv-download')
    await expect(render({ label: 'Download CSV' })).resolves.toContain('Download CSV')
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })
})
