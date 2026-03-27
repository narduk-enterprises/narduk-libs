import { expect, test } from '@playwright/test'

export { expect, test }

export async function warmUpSite(
  browser: import('@playwright/test').Browser,
  baseUrl: string,
  route = '/'
) {
  const page = await browser.newPage()

  try {
    const response = await page.goto(new URL(route, baseUrl).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })

    if (!response?.ok()) {
      throw new Error(`Warm-up navigation to ${route} failed with status ${response?.status()}`)
    }

    await page.locator('main').waitFor({ state: 'visible', timeout: 20_000 })
    await page.waitForTimeout(250)
  } finally {
    await page.close().catch(() => {})
  }
}

export async function waitForBaseUrlReady(baseUrl: string, timeoutMs = 60_000) {
  const probeUrl = new URL('/', baseUrl).toString()
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const headResponse = await fetch(probeUrl, { method: 'HEAD' })
      if (headResponse.ok) {
        return
      }

      const getResponse = await fetch(probeUrl)
      if (getResponse.ok) {
        return
      }
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }

  throw new Error(`Server at ${probeUrl} did not become ready within ${timeoutMs}ms`)
}

export async function waitForSiteHydration(page: import('@playwright/test').Page) {
  await expect(page.locator('main')).toBeVisible()
}
