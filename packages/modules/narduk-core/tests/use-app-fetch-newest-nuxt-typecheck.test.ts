import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const runtimeApp = join(__dirname, '..', 'runtime', 'app')

/** A cold install of Nuxt plus a full typecheck runs far past vitest's 5s default. */
const TIMEOUT_MS = 300_000

/**
 * `useAppFetch.ts` cannot be imported from this package's own typecheck, which
 * runs against the Nuxt this workspace pins. Nuxt 4.6 changed the
 * `useRequestFetch()` option types (`method`, `baseURL`) and broke the helper
 * in every consumer that took the bump (narduk-libs#1696). This installs the
 * newest published Nuxt minor into a scratch app outside the workspace, copies
 * the shipped helper in and runs `nuxt typecheck` there.
 */
describe('useAppFetch against the newest Nuxt', () => {
  it(
    'passes `nuxt typecheck` on the latest Nuxt release',
    () => {
      const app = mkdtempSync(join(tmpdir(), 'use-app-fetch-newest-nuxt-'))
      try {
        mkdirSync(join(app, 'app', 'composables'), { recursive: true })
        mkdirSync(join(app, 'app', 'utils'), { recursive: true })
        copyFileSync(
          join(runtimeApp, 'composables', 'useAppFetch.ts'),
          join(app, 'app', 'composables', 'useAppFetch.ts'),
        )
        copyFileSync(
          join(runtimeApp, 'utils', 'mutationMethods.ts'),
          join(app, 'app', 'utils', 'mutationMethods.ts'),
        )
        writeFileSync(join(app, 'app', 'app.vue'), '<template><div /></template>\n')
        writeFileSync(
          join(app, 'nuxt.config.ts'),
          "export default defineNuxtConfig({ compatibilityDate: '2026-01-01' })\n",
        )
        writeFileSync(
          join(app, 'tsconfig.json'),
          JSON.stringify({
            files: [],
            references: ['app', 'server', 'shared', 'node'].map((name) => ({
              path: `./.nuxt/tsconfig.${name}.json`,
            })),
          }),
        )
        writeFileSync(
          join(app, 'package.json'),
          JSON.stringify({
            name: 'use-app-fetch-newest-nuxt',
            private: true,
            type: 'module',
            dependencies: {
              nuxt: 'latest',
              typescript: '~6.0.3',
              vue: 'latest',
              'vue-router': 'latest',
              'vue-tsc': 'latest',
            },
          }),
        )

        const run = (args: string[]) =>
          execFileSync('pnpm', args, {
            cwd: app,
            encoding: 'utf-8',
            stdio: 'pipe',
            timeout: 120_000,
            env: { ...process.env, CI: 'true' },
          })
        run(['install', '--ignore-workspace', '--ignore-scripts'])
        run(['exec', 'nuxt', 'prepare'])

        let output = ''
        try {
          output = run(['exec', 'nuxt', 'typecheck'])
        } catch (error) {
          const failure = error as { stderr?: string; stdout?: string }
          output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`
        }
        expect(output).not.toMatch(/error TS\d+/u)
      } finally {
        rmSync(app, { recursive: true, force: true })
      }
    },
    TIMEOUT_MS,
  )
})
