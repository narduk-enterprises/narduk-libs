import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))

// The real-chromium engine spike (spec §13.2). Needs a Playwright browser:
// locally beforeAll installs chromium on demand; on the CI pool the immutable
// toolchain resolves via PLAYWRIGHT_BROWSERS_PATH and nothing is downloaded.
export default defineConfig({
  root: packageRoot,
  test: {
    environment: 'node',
    include: ['tests/web-e2e.test.ts'],
  },
})
