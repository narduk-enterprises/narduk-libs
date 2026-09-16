import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

// The hosted runner downloads Chromium for this job. Bind a reusable receipt
// to the installed consumer packages, actual launched binary and native OS
// packages; a different hosted image or browser download misses the proof.
export async function assertHostedPlaywrightToolchain({
  cwd,
  expectedVersion,
  nativePackages = () => execFileSync('dpkg-query', ['-W', '-f=${binary:Package}=${Version}\n']),
  osReleasePath = '/etc/os-release',
}) {
  const manifest = readJson(join(cwd, 'package.json'))
  const declared =
    manifest.devDependencies?.['@playwright/test'] ?? manifest.dependencies?.['@playwright/test']
  if (declared !== expectedVersion) {
    throw new Error(`Generated consumer must pin @playwright/test exactly to ${expectedVersion}`)
  }

  const localRequire = createRequire(join(cwd, 'package.json'))
  const testPath = localRequire.resolve('@playwright/test/package.json')
  const playwrightPath = createRequire(testPath).resolve('playwright/package.json')
  const corePath = createRequire(playwrightPath).resolve('playwright-core/package.json')
  const versions = [testPath, playwrightPath, corePath].map((path) => readJson(path).version)
  if (versions.some((version) => version !== expectedVersion)) {
    throw new Error(`Installed Playwright package versions differ from ${expectedVersion}`)
  }

  const browserManifestPath = join(dirname(corePath), 'browsers.json')
  const browserManifest = readJson(browserManifestPath)
  const chromium = browserManifest.browsers?.find((browser) => browser.name === 'chromium')
  if (!chromium?.revision) throw new Error('Installed Playwright browser manifest lacks Chromium')
  const browserType = localRequire('@playwright/test').chromium
  if (!browserType?.executablePath || !browserType?.launch)
    throw new Error('Installed @playwright/test does not expose Chromium')
  const executable = realpathSync(browserType.executablePath())
  if (!executable.includes(`chromium-${chromium.revision}/`))
    throw new Error('Downloaded Chromium executable does not match the installed manifest')

  // Pin the canary to the same binary whose bytes enter the proof fingerprint.
  const browser = await browserType.launch({ headless: true, executablePath: executable })
  try {
    const page = await browser.newPage()
    await page.setContent('<title>hosted-playwright-canary</title>')
    if ((await page.title()) !== 'hosted-playwright-canary')
      throw new Error('Downloaded Chromium failed its launch canary')
  } finally {
    await browser.close()
  }
  return {
    kind: 'hosted-download',
    manifest: digest(browserManifestPath),
    packages: [testPath, playwrightPath, corePath].map(digest),
    executable: digest(executable),
    os: digest(osReleasePath),
    systemPackages: createHash('sha256').update(nativePackages()).digest('hex'),
  }
}
