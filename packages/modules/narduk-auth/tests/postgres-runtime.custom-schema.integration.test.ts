/**
 * The whole PostgreSQL runtime suite again, with core and auth in the `narduk`
 * schema beside an app that owns `public.users`, `public.sessions` and
 * `public.api_keys` in other shapes (narduk-libs#1953). The suite is the one in
 * `postgres-runtime.integration.test.ts`; only the schema it runs against
 * differs. `vi.hoisted` runs before the imported suite reads the variable.
 */
import { vi } from 'vitest'

vi.hoisted(() => {
  process.env.NARDUK_TEST_PG_SCHEMA = 'narduk'
})

await import('./postgres-runtime.integration.test')
