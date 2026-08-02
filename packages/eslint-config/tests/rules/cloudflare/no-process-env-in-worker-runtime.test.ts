import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/cloudflare/no-process-env-in-worker-runtime'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

ruleTester.run('no-process-env-in-worker-runtime', rule, {
  valid: [
    {
      name: 'useRuntimeConfig is the supported path',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(() => useRuntimeConfig().apiKey)`,
    },
    {
      name: 'the declared env-helper boundary file is exempt',
      filename: 'server/utils/worker-env.ts',
      code: `export const apiKey = process.env.API_KEY`,
    },
    {
      name: 'REVIEW REGRESSION — a checkout under ~/workers/ is not Worker runtime',
      filename: '/Users/dev/workers/my-app/app/plugins/analytics.ts',
      code: `export const key = process.env.ANALYTICS_KEY`,
    },
    {
      name: 'app code is not Worker runtime',
      filename: 'app/plugins/analytics.ts',
      code: `export const key = process.env.ANALYTICS_KEY`,
    },
    {
      name: 'test file is not Worker runtime',
      filename: 'server/api/things.test.ts',
      code: `export const key = process.env.API_KEY`,
    },
    {
      name: 'an unrelated object named process',
      filename: 'server/utils/jobs.ts',
      code: `const process = { env: {} }
        export const key = process.env.API_KEY`,
    },
    {
      name: 'a process alias never touching .env',
      filename: 'server/utils/jobs.ts',
      code: `const p = process
        export const version = p.version`,
    },
  ],

  invalid: [
    {
      name: 'plain process.env',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(() => process.env.API_KEY)`,
      errors: [{ messageId: 'noProcessEnv' }],
    },
    {
      name: 'REVIEW REGRESSION — globalThis.process.env',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(() => globalThis.process.env.API_KEY)`,
      errors: [{ messageId: 'noProcessEnv' }],
    },
    {
      name: 'REVIEW REGRESSION — self.process.env',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(() => self.process.env.API_KEY)`,
      errors: [{ messageId: 'noProcessEnv' }],
    },
    {
      name: 'REVIEW REGRESSION — one-hop alias: const p = process; p.env.X',
      filename: 'server/utils/config.ts',
      code: `const p = process
        export const key = p.env.API_KEY`,
      errors: [{ messageId: 'noProcessEnv' }],
    },
    {
      name: 'REVIEW REGRESSION — destructuring env out of process',
      filename: 'server/utils/config.ts',
      code: `const { env } = process
        export const key = env.API_KEY`,
      errors: [{ messageId: 'noProcessEnv' }],
    },
    {
      name: 'REVIEW REGRESSION — destructuring env out of globalThis.process',
      filename: 'server/utils/config.ts',
      code: `const { env } = globalThis.process
        export const key = env.API_KEY`,
      errors: [{ messageId: 'noProcessEnv' }],
    },
    {
      name: 'destructuring a value out of process.env',
      filename: 'server/utils/config.ts',
      code: `const { API_KEY } = process.env
        export const key = API_KEY`,
      errors: [{ messageId: 'noProcessEnv' }],
    },
    {
      name: 'aliasing process.env itself',
      filename: 'server/utils/config.ts',
      code: `const env = process.env
        export const key = env.API_KEY`,
      errors: [{ messageId: 'noProcessEnv' }],
    },
    {
      name: 'reported once per materialization, not once per key read',
      filename: 'server/utils/config.ts',
      code: `const env = process.env
        export const a = env.A
        export const b = env.B`,
      errors: [{ messageId: 'noProcessEnv' }],
    },
    {
      name: 'computed access',
      filename: 'server/utils/config.ts',
      code: `export const key = process.env['API_KEY']`,
      errors: [{ messageId: 'noProcessEnv' }],
    },
    {
      name: 'a *.worker.ts file marker is enough',
      filename: 'lib/queue.worker.ts',
      code: `export const key = process.env.API_KEY`,
      errors: [{ messageId: 'noProcessEnv' }],
    },
    {
      name: 'an in-project functions/ directory (Pages Functions)',
      filename: 'functions/api/[[path]].ts',
      code: `export const key = process.env.API_KEY`,
      errors: [{ messageId: 'noProcessEnv' }],
    },
    {
      name: 'a differently-named helper file is not exempt',
      filename: 'server/utils/env.ts',
      code: `export const key = process.env.API_KEY`,
      errors: [{ messageId: 'noProcessEnv' }],
    },
  ],
})
