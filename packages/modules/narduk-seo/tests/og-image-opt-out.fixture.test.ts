import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const fixtureRoot = join(packageRoot, 'tests', 'fixtures', 'og-image-opt-out')

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, NUXT_TELEMETRY_DISABLED: '1' }
  delete env.NUXT_OG_IMAGE_SECRET
  delete env.WORKERS_CI
  delete env.WORKERS_CI_BRANCH
  delete env.NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY
  return env
}

function runNuxt(args: string[]): { output: string; status: number } {
  const nuxtBin = join(packageRoot, 'node_modules', '.bin', 'nuxt')
  try {
    const output = execFileSync(nuxtBin, args, {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { output, status: 0 }
  } catch (error) {
    const failed = error as { status?: number; stderr?: string; stdout?: string }
    return {
      output: `${failed.stdout ?? ''}\n${failed.stderr ?? ''}`,
      status: failed.status ?? 1,
    }
  }
}

describe('ogImage.enabled opt-out', () => {
  afterAll(() => {
    rmSync(fixtureRoot, { force: true, recursive: true })
  })

  it('typechecks and builds without nuxt-og-image installed and without a secret', () => {
    rmSync(fixtureRoot, { force: true, recursive: true })
    const seoModule = join(packageRoot, 'src', 'module.ts')
    const authStub = join(fixtureRoot, 'stubs', 'auth.ts')
    mkdirSync(join(fixtureRoot, 'app'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'stubs'), { recursive: true })
    writeFileSync(
      join(fixtureRoot, 'package.json'),
      JSON.stringify({ name: 'og-image-opt-out-fixture', private: true, type: 'module' }),
    )
    writeFileSync(
      join(fixtureRoot, 'nuxt.config.ts'),
      `export default defineNuxtConfig({
  compatibilityDate: '2026-09-26',
  buildDir: '.nuxt',
  alias: { '#layer/server/utils/auth': ${JSON.stringify(authStub)} },
  modules: [${JSON.stringify(seoModule)}],
  ogImage: { enabled: false },
  nitro: { preset: 'node-server' },
  ssr: true,
})
`,
    )
    writeFileSync(
      join(fixtureRoot, 'stubs', 'auth.ts'),
      'export async function requireAdmin(_event: unknown): Promise<void> {}\n',
    )
    writeFileSync(
      join(fixtureRoot, 'use-toast.d.ts'),
      'declare function useToast(): { add: (input: Record<string, unknown>) => void }\n',
    )
    writeFileSync(join(fixtureRoot, 'app', 'app.vue'), '<template><p>opt out</p></template>\n')
    writeFileSync(
      join(fixtureRoot, 'tsconfig.json'),
      JSON.stringify({
        files: [],
        references: [
          { path: './.nuxt/tsconfig.app.json' },
          { path: './.nuxt/tsconfig.server.json' },
          { path: './.nuxt/tsconfig.shared.json' },
          { path: './.nuxt/tsconfig.node.json' },
        ],
      }),
    )

    const typecheck = runNuxt(['typecheck'])
    expect(typecheck.output).not.toMatch(/'ogImage' does not exist/)
    expect(typecheck.status, typecheck.output).toBe(0)

    const build = runNuxt(['build'])
    expect(build.output).not.toContain('MISSING_OG_IMAGE_SECRET')
    expect(build.status, build.output).toBe(0)
  }, 360_000)
})
