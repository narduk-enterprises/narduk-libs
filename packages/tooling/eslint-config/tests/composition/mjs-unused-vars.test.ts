/**
 * narduk-libs#1727: `@typescript-eslint/no-unused-vars` ran on espree-parsed
 * `.mjs`, where its scope analysis is missing, and reported every top-level
 * binding as "only used as a type". `narduk-lint` fails on any warning, so a
 * fresh app failed lint on its own generated script. Plain JS now gets the
 * core rule; the typescript-eslint one stays on TS and Vue.
 */

import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

interface AppConfigModule {
  composeSharedConfigs: (...args: unknown[]) => unknown[]
}

let eslint: ESLint

beforeAll(async () => {
  const appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule
  eslint = new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: true,
    baseConfig: appConfig.composeSharedConfigs({ packs: [] }) as never,
  })
})

const SOURCE = `import { readFileSync } from 'node:fs'
const path = 'x.json'
export const text = readFileSync(path, 'utf8')
const unused = 1
`

async function messages(filePath: string, source = SOURCE) {
  const [result] = await eslint.lintText(source, { filePath })
  return result!.messages.filter((m) => /unused-vars/.test(m.ruleId ?? ''))
}

describe('no-unused-vars on plain JavaScript (#1727)', () => {
  it.each(['scripts/validate.mjs', 'scripts/validate.js'])(
    'runs the core rule, not the typescript-eslint one, on %s',
    async (filePath) => {
      const found = await messages(filePath)
      expect(found.map((m) => m.ruleId)).toEqual(['no-unused-vars'])
      expect(found[0]!.message).toContain("'unused'")
      expect(found.some((m) => /only used as a type/.test(m.message))).toBe(false)
    },
  )

  it('keeps the typescript-eslint rule on TypeScript', async () => {
    const found = await messages('scripts/validate.ts')
    expect(found.map((m) => m.ruleId)).toEqual(['@typescript-eslint/no-unused-vars'])
  })

  it('keeps the underscore ignore pattern on plain JavaScript', async () => {
    expect(await messages('scripts/a.mjs', 'const _ignored = 1\nexport {}\n')).toEqual([])
  })
})
