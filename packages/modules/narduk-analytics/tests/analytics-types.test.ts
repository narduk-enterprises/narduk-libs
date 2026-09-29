import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

it('checks shared and app-specific event contracts with the actual TypeScript compiler', () => {
  const require = createRequire(import.meta.url)
  const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
  const cwd = fileURLToPath(new URL('..', import.meta.url))
  expect(() =>
    execFileSync(process.execPath, [compiler, '-p', 'tsconfig.analytics-contract.json'], {
      cwd,
      stdio: 'pipe',
    }),
  ).not.toThrow()
}, 30_000)
