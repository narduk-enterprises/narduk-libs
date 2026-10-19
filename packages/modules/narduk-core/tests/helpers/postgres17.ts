/**
 * A real PostgreSQL 17 server for tests, with no Docker and no shared service.
 *
 * `embedded-postgres` ships the genuine PostgreSQL 17 server binaries, so a
 * migration or query that passes here runs the same parser, planner and catalog
 * production does. Nothing here emulates Postgres.
 *
 * Set `NARDUK_PG17_TEST_URL` (an admin-capable connection string to an existing
 * PostgreSQL 17, for example a `postgres:17` container) to use that server
 * instead of spawning one. Either way every caller gets its own empty database.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import EmbeddedPostgres from 'embedded-postgres'
import postgres from 'postgres'

export interface TestDatabase {
  drop: () => Promise<void>
  sql: ReturnType<typeof postgres>
  url: string
}

export interface TestPostgres {
  /** A new, empty database with its own connection. */
  createDatabase: () => Promise<TestDatabase>
  stop: () => Promise<void>
  /** `SHOW server_version` of the server under test, e.g. `17.10`. */
  version: string
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

/**
 * pnpm skips the platform package's postinstall (it re-creates the versioned
 * shared-library symlinks the server binary loads), so run it once ourselves.
 */
function hydrateSymlinks(): void {
  const require = createRequire(import.meta.url)
  // The platform package is a sibling of embedded-postgres in pnpm's store, so
  // resolve it from where the real embedded-postgres file lives.
  const fromServer = createRequire(realpathSync(require.resolve('embedded-postgres')))
  const entry = fromServer.resolve(`@embedded-postgres/${process.platform}-${process.arch}`)
  const packageDir = dirname(dirname(entry))
  const script = join(packageDir, 'scripts', 'hydrate-symlinks.js')
  if (existsSync(script))
    spawnSync(process.execPath, [script], { cwd: packageDir, stdio: 'ignore' })
}

export async function startPostgres17(): Promise<TestPostgres> {
  const external = process.env.NARDUK_PG17_TEST_URL
  let stopServer = async () => {}
  let adminUrl = external ?? ''

  if (!external) {
    hydrateSymlinks()
    const dataDir = mkdtempSync(join(tmpdir(), 'narduk-pg17-'))
    const port = await freePort()
    const server = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port,
      persistent: false,
      onLog: () => {},
      onError: () => {},
    })
    await server.initialise()
    await server.start()
    adminUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`
    stopServer = async () => {
      await server.stop()
      rmSync(dataDir, { force: true, recursive: true })
    }
  }

  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} })
  const [{ server_version: version }] = await admin<Array<{ server_version: string }>>`
    SELECT current_setting('server_version') AS server_version`
  if (!version.startsWith('17.')) {
    await admin.end()
    await stopServer()
    throw new Error(`Expected PostgreSQL 17, the test server is ${version}.`)
  }

  const databases: TestDatabase[] = []
  let counter = 0
  return {
    version,
    async createDatabase() {
      const name = `t_${process.pid}_${Date.now().toString(36)}_${counter++}`
      // Not the cluster default (C here): the stock postgres:17 image is
      // en_US.utf8, where text range comparisons do not order by bytes. A test
      // database in C would hide every collation bug, so ask for a linguistic
      // collation, ICU first because its data ships inside the server binary.
      const linguistic = [
        `LOCALE_PROVIDER icu ICU_LOCALE 'en-US'`,
        `LC_COLLATE 'en_US.utf8' LC_CTYPE 'en_US.utf8'`,
      ]
      let created = false
      for (const clause of linguistic) {
        try {
          await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' ${clause}`)
          created = true
          break
        } catch {
          // Try the next provider.
        }
      }
      if (!created) throw new Error('The test server has neither ICU nor en_US.utf8 collation.')
      const url = new URL(adminUrl)
      url.pathname = `/${name}`
      const sql = postgres(url.toString(), { max: 4, onnotice: () => {} })
      const database: TestDatabase = {
        url: url.toString(),
        sql,
        async drop() {
          await sql.end({ timeout: 1 })
          await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
        },
      }
      databases.push(database)
      return database
    },
    async stop() {
      for (const database of databases) await database.drop().catch(() => {})
      await admin.end({ timeout: 1 })
      await stopServer()
    },
  }
}
