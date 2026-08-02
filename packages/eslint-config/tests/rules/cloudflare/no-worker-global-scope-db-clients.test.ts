import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/cloudflare/no-worker-global-scope-db-clients'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

ruleTester.run('no-worker-global-scope-db-clients', rule, {
  valid: [
    {
      name: 'client created inside the handler',
      filename: 'server/api/things.get.ts',
      code: `import { Pool } from 'pg'
        export default defineEventHandler(async () => { const pool = new Pool({ connectionString }); return pool.query('select 1') })`,
    },
    {
      name: 'client created inside a lazily invoked helper',
      filename: 'server/utils/db.ts',
      code: `import { Pool } from 'pg'
        export function getPool() { return new Pool({ connectionString }) }`,
    },
    {
      name: 'deferred callback is not module evaluation',
      filename: 'server/plugins/warmup.ts',
      code: `import { Pool } from 'pg'
        setTimeout(() => new Pool(), 0)`,
    },
    {
      name: 'REVIEW REGRESSION — a checkout under ~/workers/ is not Worker runtime',
      filename: '/Users/dev/workers/my-app/app/composables/useDb.ts',
      code: `import { Pool } from 'pg'
        export const pool = new Pool({ connectionString })`,
    },
    {
      name: 'app code is not Worker runtime',
      filename: 'app/composables/useDb.ts',
      code: `import { Pool } from 'pg'
        export const pool = new Pool({ connectionString })`,
    },
    {
      name: 'test file is not Worker runtime',
      filename: 'server/api/things.test.ts',
      code: `import { Pool } from 'pg'
        export const pool = new Pool({ connectionString })`,
    },
    {
      name: 'an unrelated Pool import is not a driver',
      filename: 'server/utils/pool.ts',
      code: `import { Pool } from '../lib/worker-pool'
        export const pool = new Pool()`,
    },
  ],

  invalid: [
    {
      name: 'pg Pool at module scope',
      filename: 'server/utils/db.ts',
      code: `import { Pool } from 'pg'
        export const pool = new Pool({ connectionString })`,
      errors: [{ messageId: 'noGlobalScopeDbClient' }],
    },
    {
      name: 'REVIEW REGRESSION — callback-invoked module scope: shards.map(() => new Pool())',
      filename: 'server/utils/db.ts',
      code: `import { Pool } from 'pg'
        export const pools = shards.map(() => new Pool({ connectionString: shardUrl }))`,
      errors: [{ messageId: 'noGlobalScopeDbClient' }],
    },
    {
      name: 'REVIEW REGRESSION — driver map extended: @neondatabase/serverless neon()',
      filename: 'server/utils/db.ts',
      code: `import { neon } from '@neondatabase/serverless'
        export const sql = neon(process.env.DATABASE_URL)`,
      errors: [{ messageId: 'noGlobalScopeDbClient' }],
    },
    {
      name: 'REVIEW REGRESSION — driver map extended: @neondatabase/serverless Pool',
      filename: 'server/utils/db.ts',
      code: `import { Pool } from '@neondatabase/serverless'
        export const pool = new Pool({ connectionString })`,
      errors: [{ messageId: 'noGlobalScopeDbClient' }],
    },
    {
      name: 'REVIEW REGRESSION — driver map extended: @libsql/client createClient()',
      filename: 'server/utils/db.ts',
      code: `import { createClient } from '@libsql/client'
        export const turso = createClient({ url })`,
      errors: [{ messageId: 'noGlobalScopeDbClient' }],
    },
    {
      name: 'REVIEW REGRESSION — driver map extended: mongodb MongoClient',
      filename: 'server/utils/db.ts',
      code: `import { MongoClient } from 'mongodb'
        export const mongo = new MongoClient(uri)`,
      errors: [{ messageId: 'noGlobalScopeDbClient' }],
    },
    {
      name: 'REVIEW REGRESSION — driver map extended: ioredis default constructor',
      filename: 'server/utils/cache.ts',
      code: `import Redis from 'ioredis'
        export const redis = new Redis(url)`,
      errors: [{ messageId: 'noGlobalScopeDbClient' }],
    },
    {
      name: 'REVIEW REGRESSION — driver map extended: ioredis named constructor',
      filename: 'server/utils/cache.ts',
      code: `import { Cluster } from 'ioredis'
        export const redis = new Cluster(nodes)`,
      errors: [{ messageId: 'noGlobalScopeDbClient' }],
    },
    {
      name: 'postgres default factory',
      filename: 'server/utils/db.ts',
      code: `import postgres from 'postgres'
        export const sql = postgres(connectionString)`,
      errors: [{ messageId: 'noGlobalScopeDbClient' }],
    },
    {
      name: 'mysql2 createPool',
      filename: 'server/utils/db.ts',
      code: `import { createPool } from 'mysql2/promise'
        export const pool = createPool(config)`,
      errors: [{ messageId: 'noGlobalScopeDbClient' }],
    },
    {
      name: 'namespace import',
      filename: 'server/utils/db.ts',
      code: `import * as pg from 'pg'
        export const pool = new pg.Pool({ connectionString })`,
      errors: [{ messageId: 'noGlobalScopeDbClient' }],
    },
    {
      name: 'IIFE at module scope',
      filename: 'server/utils/db.ts',
      code: `import { Pool } from 'pg'
        export const pool = (() => new Pool())()`,
      errors: [{ messageId: 'noGlobalScopeDbClient' }],
    },
    {
      name: 'a *.worker.ts file marker is enough',
      filename: 'lib/queue.worker.ts',
      code: `import { Pool } from 'pg'
        export const pool = new Pool()`,
      errors: [{ messageId: 'noGlobalScopeDbClient' }],
    },
    {
      name: 'an in-project workers/ directory still counts',
      filename: 'workers/consumer.ts',
      code: `import { Pool } from 'pg'
        export const pool = new Pool()`,
      errors: [{ messageId: 'noGlobalScopeDbClient' }],
    },
  ],
})
