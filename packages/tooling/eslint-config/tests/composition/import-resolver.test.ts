/**
 * The shared imports block pins eslint-plugin-import-x's own Node resolver
 * (narduk-libs#562). Without one, import-x falls back to its legacy `node`
 * probe, which crashes `import-x/no-cycle` on a `vitest.config.ts` with "node
 * with invalid interface loaded as resolver". narduk-core and narduk-auth lint
 * their own `vitest.config.ts` with the rule on, which is the behavioural proof.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ESLint } from 'eslint'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped resolver output
type FlatConfig = Record<string, any>

let composeSharedConfigs: (...presetNames: Array<string | string[]>) => FlatConfig[]

beforeAll(async () => {
  ;({ composeSharedConfigs } = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as { composeSharedConfigs: typeof composeSharedConfigs })
})

describe('import-x resolver (narduk-libs#562)', () => {
  it('sets a modern resolver wherever import-x/no-cycle runs', async () => {
    const eslint = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: true,
      baseConfig: composeSharedConfigs() as never,
    })
    const config = (await eslint.calculateConfigForFile('apps/web/vitest.config.ts')) as FlatConfig

    expect(config.rules?.['import-x/no-cycle']?.[0]).toBe(1)
    const resolvers = config.settings?.['import-x/resolver-next']
    expect(Array.isArray(resolvers)).toBe(true)
    expect(resolvers).toHaveLength(1)
    expect(resolvers[0]).toMatchObject({ interfaceVersion: 3 })
    expect(typeof resolvers[0].resolve).toBe('function')
  })

  // narduk-libs#789: walking dependencies' sources for no-cycle and the
  // export-map rules held ~3.4 GB of narduk-core's lint heap.
  it('keeps the export-map rules out of node_modules wherever they run', async () => {
    const eslint = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: true,
      baseConfig: composeSharedConfigs() as never,
    })
    for (const file of ['server/utils/a.ts', 'app/components/A.vue', 'vitest.config.mts']) {
      const config = (await eslint.calculateConfigForFile(file)) as FlatConfig
      expect(config.rules?.['import-x/no-cycle']?.[0], file).toBe(1)
      expect(config.settings?.['import-x/ignore'], file).toEqual(['node_modules'])
    }
  })
})

// narduk-libs#973: the pinned resolver resolved `./b.ts` but not `./b` or
// `./b.js` from a `.ts` file, which is how every TypeScript source spells a
// local import, so no-cycle, named, default and export never followed one.
describe('import-x resolves TypeScript-spelled local imports (narduk-libs#973)', () => {
  const configUrl = new URL('../../eslint-app-config.mjs', import.meta.url).href
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'narduk-import-x-'))
    mkdirSync(join(dir, 'src'))
    // import-x/default reads esModuleInterop from the nearest tsconfig; pin it
    // off so a missing default export is a finding, not a synthetic default.
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { esModuleInterop: false, module: 'NodeNext' } }),
    )
    const write = (name: string, text: string) => writeFileSync(join(dir, 'src', name), text)
    write('a.ts', "import { b } from './b'\n\nexport const a = (): number => b() + 1\n")
    write('b.ts', "import { a } from './a.js'\n\nexport const b = (): number => a() - 1\n")
    write('c.ts', 'export const present = 1\n')
    write('d.ts', "import { nothere, present } from './c'\n\nexport const d = [nothere, present]\n")
    write('e.ts', "import value from './c.js'\n\nexport const e = value\n")
  })

  afterAll(() => {
    rmSync(dir, { force: true, recursive: true })
  })

  /**
   * Lints in a child process with a plain environment: under Vitest
   * (`NODE_ENV=test`, `VITEST`) typescript-estree and import-x's export map
   * stop reporting a missing default export, which a real `eslint` run does.
   */
  function lint(file: string): Array<{ message: string; ruleId: string | null }> {
    const script = `
      const { ESLint } = await import(${JSON.stringify(import.meta.resolve('eslint'))})
      const { composeSharedConfigs } = await import(${JSON.stringify(configUrl)})
      const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: true, baseConfig: composeSharedConfigs() })
      const [result] = await eslint.lintFiles([process.argv[1]])
      process.stdout.write(JSON.stringify(result.messages))
    `
    const env = { ...process.env }
    delete env.NODE_ENV
    delete env.VITEST
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script, join(dir, 'src', file)],
      { cwd: dir, encoding: 'utf8', env },
    )
    return JSON.parse(out) as Array<{ message: string; ruleId: string | null }>
  }

  it('reports a cycle through an extensionless and a .js-spelled import', () => {
    for (const file of ['a.ts', 'b.ts']) {
      const cycle = lint(file).filter((m) => m.ruleId === 'import-x/no-cycle')
      expect(cycle, file).toHaveLength(1)
    }
  })

  it('checks named and default imports against a local module', () => {
    const named = lint('d.ts').filter((m) => m.ruleId === 'import-x/named')
    expect(named.map((m) => m.message)).toEqual([expect.stringContaining('nothere')])
    const defaults = lint('e.ts').filter((m) => m.ruleId === 'import-x/default')
    expect(defaults).toHaveLength(1)
  })

  it('ships the newly live rules at warn, to ratchet through lint budgets', async () => {
    const eslint = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: true,
      baseConfig: composeSharedConfigs() as never,
    })
    const config = (await eslint.calculateConfigForFile('server/utils/a.ts')) as FlatConfig
    for (const rule of ['no-cycle', 'named', 'default', 'export']) {
      expect(config.rules?.[`import-x/${rule}`]?.[0], rule).toBe(1)
    }
  })
})
