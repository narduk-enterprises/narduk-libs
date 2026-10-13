import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
const probePath = join(packageRoot, 'src/__consumer-module-probe.generated.ts')

function typecheck(): string {
  try {
    return execFileSync(process.execPath, [compiler, '-p', 'tsconfig.consumer-module.json'], {
      cwd: packageRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string }
    if (!failure.stdout && !failure.stderr) throw error
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`
  }
}

function checkProbe(transform: (source: string) => string): string {
  const source = readFileSync(join(packageRoot, 'src/module.ts'), 'utf8')
  const probe = transform(source)
  expect(probe).not.toBe(source)
  writeFileSync(probePath, probe)
  try {
    return typecheck()
  } finally {
    rmSync(probePath, { force: true })
  }
}

// Published source is compiled by consumers without this package's generated
// Nuxt/Nitro ambient references. The package's own typecheck alone missed this.
describe('published module in an unaugmented consumer type program', () => {
  it('compiles both analytics type hooks without Nitro ambient augmentation', () => {
    expect(typecheck()).toBe('')
  }, 30_000)

  it('still rejects the original missing-Nitro-hook consumer failure', () => {
    const diagnostics = checkProbe((source) =>
      source.replace(
        "hook('nitro:prepare:types', registerAnalyticsTypes)",
        "nuxt.hook('nitro:prepare:types', registerAnalyticsTypes)",
      ),
    )
    expect(diagnostics).toContain('TS2345')
    expect(diagnostics).toContain('nitro:prepare:types')
  }, 30_000)

  it('rejects an event typo rather than admitting arbitrary hook strings', () => {
    const diagnostics = checkProbe((source) =>
      source.replace(
        "hook('nitro:prepare:types', registerAnalyticsTypes)",
        "hook('nitro:prepare:type', registerAnalyticsTypes)",
      ),
    )
    expect(diagnostics).toContain('TS2769')
    expect(diagnostics).toContain('nitro:prepare:type')
  }, 30_000)
})
