import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

function run(
  command: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): string {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...extraEnv,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--max-old-space-size=4096`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string }
    throw new Error(
      failure.message + '\n' + (failure.stdout ?? '') + '\n' + (failure.stderr ?? ''),
      {
        cause: error,
      },
    )
  }
}

/** Build the actual package shape outside its working dist/ directory. */
function buildFixture(stage: string): void {
  mkdirSync(stage)
  for (const name of [
    'package.json',
    'README.md',
    'tsconfig.json',
    'vite.config.ts',
    'vite.entries.config.ts',
  ]) {
    copyFileSync(join(packageRoot, name), join(stage, name))
  }
  cpSync(join(packageRoot, 'src'), join(stage, 'src'), { recursive: true })
  symlinkSync(join(packageRoot, 'node_modules'), join(stage, 'node_modules'), 'dir')
}

describe('published types entry', () => {
  let outDir: string | undefined

  afterEach(() => {
    if (outDir) rmSync(outDir, { force: true, recursive: true })
    outDir = undefined
  })

  // Builds an isolated package fixture, never the working dist/: a build
  // in place drops the subpath bundles check:package needs.
  it('emits a dist/index.d.ts that exports the public surface', () => {
    outDir = mkdtempSync(join(tmpdir(), 'narduk-charts-types-'))
    const stage = join(outDir, 'package')
    buildFixture(stage)
    run('pnpm', ['exec', 'vite', 'build'], stage)
    const dist = join(stage, 'dist')

    const emitted = readdirSync(dist)
    expect(emitted).toContain('index.d.ts')
    const declaration = readFileSync(join(dist, 'index.d.ts'), 'utf8')
    expect(declaration.trim()).not.toBe('export {}')
    expect(declaration).toContain('NardukLineChart')
    expect(declaration).toContain('ChartSeries')

    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: { '.': { import: { types: string }; require: { types: string } } }
      scripts: Record<string, string>
    }
    expect(packageJson.exports['.'].import.types).toBe('./dist/index.d.ts')
    expect(packageJson.exports['.'].require.types).toBe('./dist/index.d.cts')
    // The require entry is a copy of the import entry made by build:only.
    expect(packageJson.scripts['build:only']).toContain('cp dist/index.d.ts dist/index.d.cts')
  }, 180_000)

  it('proves packed studies and line-chart props in strict external TypeScript and Vue consumers', () => {
    outDir = mkdtempSync(join(tmpdir(), 'narduk-charts-packed-types-'))
    const stage = join(outDir, 'package')
    const dist = join(stage, 'dist')
    buildFixture(stage)
    run('pnpm', ['exec', 'vite', 'build'], stage)
    for (const entry of ['line', 'bar', 'pie', 'candle', 'studies', 'spark']) {
      run('pnpm', ['exec', 'vite', 'build', '--config', 'vite.entries.config.ts'], stage, {
        NC_ENTRY: entry,
      })
    }
    copyFileSync(join(dist, 'index.d.ts'), join(dist, 'index.d.cts'))
    const tarball = join(outDir, 'charts.tgz')
    run('pnpm', ['pack', '--out', tarball], stage)

    const consumer = join(outDir, 'consumer')
    mkdirSync(consumer)
    const vue = JSON.parse(readFileSync(require.resolve('vue/package.json'), 'utf8')) as {
      version: string
    }
    writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
        dependencies: { '@narduk-enterprises/narduk-charts': 'file:' + tarball, vue: vue.version },
      }),
    )
    run('pnpm', ['install', '--offline', '--ignore-scripts'], consumer)

    const proof = (entry: string) => `
import { sma, ema, vwap, bollinger, rsi, macd, type ChartSeries } from '${entry}'
type IsAny<T> = 0 extends (1 & T) ? true : false
const typed: [IsAny<typeof sma>, IsAny<typeof ema>, IsAny<typeof vwap>, IsAny<typeof bollinger>, IsAny<typeof rsi>, IsAny<typeof macd>] = [false, false, false, false, false, false]
const series: ChartSeries = { name: 'typed', data: sma([1, 2], 2) }
const values: Array<number | null> = ema([1, 2], 2)
const weighted: Array<number | null> = vwap([{ t: 1, o: 1, h: 2, l: 1, c: 2, v: 3 }])
const bands: Array<{ mid: number | null; upper: number | null; lower: number | null }> = bollinger([1, 2], 2)
const relative: Array<number | null> = rsi([1, 2], 2)
const histogram: Array<number | null> = macd([1, 2]).hist
// @ts-expect-error studies reject invalid input; an any export would leave this directive unused
sma('invalid', 2)
// @ts-expect-error studies reject invalid input
ema('invalid', 2)
// @ts-expect-error studies reject invalid input
vwap('invalid')
// @ts-expect-error studies reject invalid input
bollinger('invalid', 2)
// @ts-expect-error studies reject invalid input
rsi('invalid', 2)
// @ts-expect-error studies reject invalid input
macd('invalid')
void [typed, series, values, weighted, bands, relative, histogram]
`
    const root = '@narduk-enterprises/narduk-charts'
    writeFileSync(join(consumer, 'proof.ts'), proof(root))
    writeFileSync(join(consumer, 'proof.mts'), proof(root))
    writeFileSync(join(consumer, 'proof.cts'), proof(root))
    writeFileSync(join(consumer, 'studies.ts'), proof(root + '/studies'))
    writeFileSync(join(consumer, 'studies.mts'), proof(root + '/studies'))
    writeFileSync(
      join(consumer, 'consumer.vue'),
      `<script setup lang="ts">
import { NardukLineChart } from '@narduk-enterprises/narduk-charts/line'
import type { ChartSeries } from '@narduk-enterprises/narduk-charts'
const series: ChartSeries[] = [{ name: 'price', data: [1, 2] }]
</script>
<template><NardukLineChart :labels="['a', 'b']" :series="series" /></template>
`,
    )
    for (const [name, module, moduleResolution, files] of [
      ['bundler', 'ESNext', 'Bundler', ['proof.ts', 'studies.ts', 'consumer.vue']],
      ['node-esm', 'NodeNext', 'NodeNext', ['proof.mts', 'studies.mts']],
      ['node-cjs', 'NodeNext', 'NodeNext', ['proof.cts']],
    ] as const) {
      const config = join(consumer, 'tsconfig-' + name + '.json')
      writeFileSync(
        config,
        JSON.stringify({
          compilerOptions: {
            strict: true,
            skipLibCheck: false,
            noEmit: true,
            target: 'ES2022',
            module,
            moduleResolution,
          },
          files,
        }),
      )
      const compiler =
        name === 'bundler'
          ? require.resolve('vue-tsc/bin/vue-tsc.js')
          : require.resolve('typescript/bin/tsc')
      expect(run(process.execPath, [compiler, '--project', config], consumer)).toBe('')
    }
  }, 180_000)
})
