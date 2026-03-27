import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '..')
const routerPath = resolve(repoRoot, 'site/router.ts')
const homeViewPath = resolve(repoRoot, 'site/views/HomeView.vue')
const examplePath = resolve(repoRoot, 'site/views/examples/AaplExample.vue')
const siteRoot = resolve(repoRoot, 'site')
const stonxStreamPath = resolve(repoRoot, 'site/utils/stonxStream.ts')

function read(path: string) {
  return readFileSync(path, 'utf8')
}

function readAllTextFiles(dir: string): string {
  const chunks: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      chunks.push(readAllTextFiles(full))
      continue
    }
    if (!/\.(vue|ts|css|html|md)$/.test(entry)) continue
    chunks.push(read(full))
  }
  return chunks.join('\n')
}

describe('AAPL marketing demo acceptance scaffold', () => {
  it('registers a dedicated AAPL example route', () => {
    const routerSource = read(routerPath)
    expect(routerSource).toContain("path: '/examples/aapl'")
    expect(routerSource).toContain("name: 'example-aapl'")
    expect(routerSource).toContain("AaplExample.vue")
  })

  it('links the AAPL demo from the marketing home page', () => {
    const homeSource = read(homeViewPath)
    expect(homeSource).toContain('/examples/aapl')
    expect(homeSource).toMatch(/AAPL/i)
  })

  it('includes a dedicated AAPL example view', () => {
    expect(existsSync(examplePath)).toBe(true)
    const exampleSource = read(examplePath)
    expect(exampleSource).toMatch(/AAPL/)
    expect(exampleSource).toMatch(/Apple Inc\./i)
    expect(exampleSource).toContain('NardukCandleChart')
    expect(exampleSource).toContain('NardukChartStack')
    expect(exampleSource).toContain('NardukLineChart')
  })

  it('wires the marketing site to the Stonx AAPL stream contract', () => {
    expect(existsSync(stonxStreamPath)).toBe(true)
    const stonxUtil = read(stonxStreamPath)
    expect(stonxUtil).toMatch(/stonxSubscribeJson/)
    expect(stonxUtil).toMatch(/channels/)
    expect(stonxUtil).not.toMatch(/symbols\s*:\s*\[/)
    expect(stonxUtil).toMatch(/stonxPingJson/)
    expect(stonxUtil).toMatch(/parseStonxStreamMessage/)

    const siteSources = readAllTextFiles(siteRoot)
    expect(siteSources).toMatch(/wss:\/\/stonx\.app\/ws\/stream/)
    expect(siteSources).toMatch(/price:AAPL/)
    expect(siteSources).toMatch(/price_update/)
    expect(siteSources).toMatch(/subscribe/)
    expect(siteSources).toMatch(/unsubscribe/)
    expect(siteSources).toMatch(/STONX_STREAM_PING_INTERVAL_MS/)
    expect(read(examplePath)).toMatch(/stonxSubscribeJson|stonxStream/)
  })
})
