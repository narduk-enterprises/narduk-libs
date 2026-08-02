import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/cloudflare/no-supabase-client-in-global-scope'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

ruleTester.run('no-supabase-client-in-global-scope', rule, {
  valid: [
    {
      name: 'client created inside the handler',
      filename: 'server/api/things.get.ts',
      code: `import { createClient } from '@supabase/supabase-js'
        export default defineEventHandler(async (event) => {
          const supabase = createClient(url, key)
          return supabase.from('things').select()
        })`,
    },
    {
      name: 'client created inside a lazily invoked factory',
      filename: 'server/utils/supabase.ts',
      code: `import { createClient } from '@supabase/supabase-js'
        export function getSupabase(event) { return createClient(url, keyFor(event)) }`,
    },
    {
      name: 'a locally shadowed createClient is not the Supabase import',
      filename: 'server/utils/other.ts',
      code: `import { createClient } from '../lib/http'
        export const client = createClient()`,
    },
    {
      name: 'a differently-sourced createClient with the same name',
      filename: 'server/utils/other.ts',
      code: `import { createClient } from '@libsql/client'
        export const client = createClient({ url })`,
    },
    {
      name: 'deferred callback',
      filename: 'server/plugins/warmup.ts',
      code: `import { createClient } from '@supabase/supabase-js'
        setTimeout(() => createClient(url, key), 0)`,
    },
    {
      name: 'test file',
      filename: 'tests/supabase.test.ts',
      code: `import { createClient } from '@supabase/supabase-js'
        export const supabase = createClient(url, key)`,
    },
  ],

  invalid: [
    {
      name: 'module-scope createClient',
      filename: 'server/utils/supabase.ts',
      code: `import { createClient } from '@supabase/supabase-js'
        export const supabase = createClient(url, key)`,
      errors: [
        {
          messageId: 'noGlobalScopeSupabaseClient',
          data: { source: '@supabase/supabase-js', factory: 'createClient' },
        },
      ],
    },
    {
      name: 'REVIEW REGRESSION — callback-invoked module scope',
      filename: 'server/utils/supabase.ts',
      code: `import { createClient } from '@supabase/supabase-js'
        export const clients = regions.map((region) => createClient(urlFor(region), key))`,
      errors: [{ messageId: 'noGlobalScopeSupabaseClient' }],
    },
    {
      name: 'REVIEW REGRESSION — @supabase/ssr createServerClient',
      filename: 'server/utils/supabase.ts',
      code: `import { createServerClient } from '@supabase/ssr'
        export const supabase = createServerClient(url, key, { cookies })`,
      errors: [{ messageId: 'noGlobalScopeSupabaseClient' }],
    },
    {
      name: 'REVIEW REGRESSION — @supabase/ssr createBrowserClient',
      filename: 'app/utils/supabase.ts',
      code: `import { createBrowserClient } from '@supabase/ssr'
        export const supabase = createBrowserClient(url, key)`,
      errors: [{ messageId: 'noGlobalScopeSupabaseClient' }],
    },
    {
      name: 'aliased import',
      filename: 'server/utils/supabase.ts',
      code: `import { createClient as makeClient } from '@supabase/supabase-js'
        export const supabase = makeClient(url, key)`,
      errors: [{ messageId: 'noGlobalScopeSupabaseClient' }],
    },
    {
      name: 'namespace import',
      filename: 'server/utils/supabase.ts',
      code: `import * as supabaseJs from '@supabase/supabase-js'
        export const supabase = supabaseJs.createClient(url, key)`,
      errors: [{ messageId: 'noGlobalScopeSupabaseClient' }],
    },
    {
      name: 'IIFE at module scope',
      filename: 'server/utils/supabase.ts',
      code: `import { createClient } from '@supabase/supabase-js'
        export const supabase = (() => createClient(url, key))()`,
      errors: [{ messageId: 'noGlobalScopeSupabaseClient' }],
    },
    {
      name: 'invoked local factory',
      filename: 'server/utils/supabase.ts',
      code: `import { createClient } from '@supabase/supabase-js'
        function build() { return createClient(url, key) }
        export const supabase = build()`,
      errors: [{ messageId: 'noGlobalScopeSupabaseClient' }],
    },
  ],
})
