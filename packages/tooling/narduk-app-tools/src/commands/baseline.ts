import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { readJsonc } from '../deploy.js'
import {
  assertBaselineState,
  migrationBaselineSql,
  readMigrationBaseline,
} from '../migration-baseline.js'
import {
  captureMigrationBaseline,
  proveMigrationBaseline,
  registerMigrationBaseline,
  type MigrationExecutor,
} from '../migrations.js'

const valueFlags = new Set([
  '--persist-to',
  '--artifact',
  '--output',
  '--database',
  '--wrangler-config',
  '--revision',
  '--config',
  '--source',
  '--filename',
  '--expect-digest',
  '--review-ref',
  '--expect-database-id',
])
const flagsByCommand: Record<string, readonly string[]> = {
  capture: [
    '--persist-to',
    '--database',
    '--wrangler-config',
    '--revision',
    '--output',
    '--local',
    '--remote',
  ],
  sql: ['--artifact', '--output'],
  check: ['--persist-to', '--artifact', '--database', '--wrangler-config', '--local', '--remote'],
  register: [
    '--persist-to',
    '--artifact',
    '--database',
    '--wrangler-config',
    '--local',
    '--remote',
    '--config',
    '--source',
    '--filename',
    '--expect-digest',
    '--review-ref',
    '--expect-database-id',
  ],
  prove: ['--artifact', '--config', '--source', '--filename'],
}

export function runBaselineCommand(
  args: string[],
  cwd = process.cwd(),
  executor?: MigrationExecutor,
): unknown {
  const [command, ...rest] = args
  if (!command || !Object.hasOwn(flagsByCommand, command))
    throw new Error('Usage: narduk-app db baseline capture|sql|check|register|prove ...')
  const values = new Map<string, string>()
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!
    if (!flagsByCommand[command]!.includes(flag) || values.has(flag))
      throw new Error(`Unexpected or duplicate baseline argument: ${flag}`)
    if (valueFlags.has(flag)) {
      const value = rest[++i]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
      values.set(flag, value)
    } else values.set(flag, 'true')
  }
  const required = (flag: string) => {
    const value = values.get(flag)
    if (!value?.trim()) throw new Error(`Missing ${flag}`)
    return value
  }
  const artifact =
    command === 'capture' ? undefined : readMigrationBaseline(resolve(cwd, required('--artifact')))
  if (command === 'sql') {
    const output = resolve(cwd, required('--output'))
    writeFileSync(output, migrationBaselineSql(artifact!), { flag: 'wx', mode: 0o600 })
    return { output, digest: artifact!.digest }
  }
  if (command === 'prove') {
    const plan = proveMigrationBaseline(
      artifact!,
      {
        cwd,
        configFile: required('--config'),
        source: values.get('--source'),
        filename: values.get('--filename'),
      },
      executor,
    )
    return { digest: artifact!.digest, proof: 'schema-only; no application data', plan }
  }
  if (values.has('--local') === values.has('--remote'))
    throw new Error('Choose exactly one of --local or --remote')
  const location = values.has('--remote') ? '--remote' : '--local'
  if (location === '--remote' && !process.env.CLOUDFLARE_API_TOKEN?.trim())
    throw new Error('Remote baseline operations require an explicit scoped CLOUDFLARE_API_TOKEN')
  const configPath = resolve(cwd, required('--wrangler-config'))
  const wrangler = z
    .object({
      account_id: z.string().regex(/^[a-f0-9]{32}$/u),
      d1_databases: z.array(
        z.object({
          binding: z.string().min(1),
          database_name: z.string().min(1),
          database_id: z.uuid().refine((id) => !/^0{8}-/u.test(id)),
        }),
      ),
    })
    .parse(readJsonc(configPath))
  const database = required('--database')
  const matches = wrangler.d1_databases.filter((entry) => entry.binding === database)
  if (matches.length !== 1)
    throw new Error('Baseline target must identify exactly one explicit D1 binding')
  const binding = matches[0]!
  const target = { accountId: wrangler.account_id, databaseId: binding.database_id }
  const directory = mkdtempSync(join(tmpdir(), 'narduk-baseline-target-'))
  try {
    const explicitConfig = join(directory, 'wrangler.json')
    writeFileSync(
      explicitConfig,
      JSON.stringify({ account_id: target.accountId, d1_databases: [binding] }),
    )
    if (location === '--remote' && values.has('--persist-to'))
      throw new Error('--persist-to is local-only')
    const options = {
      cwd: dirname(configPath),
      database,
      location,
      wranglerConfig: explicitConfig,
      target,
      ...(location === '--local' ? { persistTo: resolve(cwd, required('--persist-to')) } : {}),
    } as const
    if (command === 'register') {
      if (required('--expect-database-id') !== target.databaseId)
        throw new Error('Explicit database ID does not match the selected binding')
      return registerMigrationBaseline(
        {
          ...options,
          configFile: resolve(cwd, required('--config')),
          source: required('--source'),
          filename: required('--filename'),
          expectedDigest: required('--expect-digest'),
          reviewRef: required('--review-ref'),
        },
        artifact!,
        executor,
      )
    }
    const captured = captureMigrationBaseline(
      { ...options, revision: artifact?.revision ?? required('--revision') },
      executor,
    )
    if (command === 'check') {
      assertBaselineState(artifact!, captured)
      return { digest: artifact!.digest, target, matches: true }
    }
    const output = resolve(cwd, required('--output'))
    writeFileSync(output, `${JSON.stringify(captured, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    return { output, digest: captured.digest, target }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
