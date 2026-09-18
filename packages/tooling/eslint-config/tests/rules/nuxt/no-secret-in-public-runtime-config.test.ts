import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/nuxt/no-secret-in-public-runtime-config'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

const FILE = 'nuxt.config.ts'
const config = (runtimeConfig: string) =>
  `export default defineNuxtConfig({ runtimeConfig: ${runtimeConfig} })`

ruleTester.run('no-secret-in-public-runtime-config', rule, {
  valid: [
    {
      name: 'server-only secret with empty default',
      filename: FILE,
      code: config("{ stripeSecretKey: '' }"),
    },
    {
      name: 'secret from the environment',
      filename: FILE,
      code: config('{ apiKey: process.env.API_KEY }'),
    },
    {
      name: 'public non-credential key',
      filename: FILE,
      code: config("{ public: { siteUrl: 'https://example.com', posthogHost: '' } }"),
    },
    {
      name: 'nested server-only object',
      filename: FILE,
      code: config("{ auth: { sessionPassword: '' } }"),
    },
    {
      name: 'not a nuxt config',
      filename: 'app.config.ts',
      code: config("{ public: { apiToken: 'x' } }"),
    },
    {
      name: 'non-credential literal default',
      filename: FILE,
      code: config("{ region: 'us-east-1' }"),
    },
  ],
  invalid: [
    {
      name: 'secret under public',
      filename: FILE,
      code: config("{ public: { stripeSecretKey: '' } }"),
      errors: [{ messageId: 'publicSecret', data: { path: 'stripeSecretKey' } }],
    },
    {
      name: 'nested token under public',
      filename: 'apps/web/nuxt.config.mts',
      code: config("{ public: { auth: { apiToken: '' } } }"),
      errors: [{ messageId: 'publicSecret', data: { path: 'auth.apiToken' } }],
    },
    {
      name: 'api_key spelling under public',
      filename: FILE,
      code: config("{ public: { mapbox_api_key: '' } }"),
      errors: [{ messageId: 'publicSecret' }],
    },
    {
      name: 'literal password default',
      filename: FILE,
      code: config("{ sessionPassword: 'hunter2-but-longer' }"),
      errors: [{ messageId: 'literalDefault', data: { path: 'sessionPassword' } }],
    },
    {
      name: 'literal fallback after env',
      filename: FILE,
      code: config("{ githubToken: process.env.GH_TOKEN || 'ghp_x' }"),
      errors: [{ messageId: 'literalDefault' }],
    },
    {
      name: 'template literal default',
      filename: FILE,
      code: config('{ privateKey: `abc` }'),
      errors: [{ messageId: 'literalDefault' }],
    },
  ],
})
