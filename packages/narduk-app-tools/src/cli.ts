import { configureRegistryAuth } from './registry-auth'
import { generateFavicons, parseFaviconArgs } from './assets'
import { parseDevArgs, runDev } from './dev'
import { parseDeployLocalArgs, runDeployLocal } from './deploy-local'
import { runDoctor, formatDoctorReport } from './doctor'
import { isWorkersBuildDeployAllowed, runDeploy } from './deploy'
import { runMigrations, type MigrationLocation } from './migrations'
import {
  formatPerformanceBudgetReport,
  parsePerformanceBudgetArgs,
  runPerformanceBudgetCheck,
} from './performance'

function usage(): string {
  return [
    'Usage: narduk-app <command> [options]',
    '',
    'Commands:',
    '  dev -- <command...>                 Run a child with Doppler env in memory',
    '  db migrate --config <file> --database <name> --local|--remote [--reset]',
    '  deploy <deploy|versions-upload> ... Deploy the built app with Wrangler safeguards',
    '  deploy-local [options]              Build, migrate, deploy, and probe a recovery release',
    '  registry-auth                       Write scoped GitHub Packages auth',
    '  doctor                              Check app-local prerequisites',
    '  performance-budget [options]        Check built asset budgets',
    '  assets favicons [options]            Generate ordinary favicon assets',
  ].join('\n')
}

export function parseMigrationArgs(args: string[]): {
  configFile: string
  database: string
  location: MigrationLocation
  reset: boolean
  workersBuildOnly: boolean
} {
  let configFile = ''
  let database = ''
  let location: MigrationLocation | undefined
  let reset = false
  let workersBuildOnly = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--config') configFile = args[++index] ?? ''
    else if (arg === '--database') database = args[++index] ?? ''
    else if (arg === '--local') {
      if (location) throw new Error('Choose exactly one of --local or --remote')
      location = '--local'
    } else if (arg === '--remote') {
      if (location) throw new Error('Choose exactly one of --local or --remote')
      location = '--remote'
    } else if (arg === '--reset') reset = true
    else if (arg === '--workers-build-only') workersBuildOnly = true
    else throw new Error(`Unknown migrate option: ${arg}`)
  }
  if (!configFile) throw new Error('--config requires a file')
  if (!database) throw new Error('--database requires a name')
  if (!location) throw new Error('Choose exactly one of --local or --remote')
  if (location === '--remote' && reset) throw new Error('Remote migration reset is refused')
  if (workersBuildOnly && location !== '--remote') {
    throw new Error('--workers-build-only is valid only with --remote')
  }
  return { configFile, database, location, reset, workersBuildOnly }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = args
  try {
    if (!command || command === '--help' || command === '-h') {
      console.log(usage())
      return 0
    }
    if (command === 'dev') return runDev(parseDevArgs(rest))
    if (command === 'db') {
      const [subcommand, ...migrateArgs] = rest
      if (subcommand !== 'migrate') throw new Error('Usage: narduk-app db migrate ...')
      const options = parseMigrationArgs(migrateArgs)
      if (options.workersBuildOnly && !isWorkersBuildDeployAllowed()) {
        throw new Error('Remote migration requires an attested Cloudflare Workers Build')
      }
      const plan = runMigrations(options)
      if (plan.recoveryPath) console.log(`[db] recovery snapshot ${plan.recoveryPath}`)
      console.log(`[db] ${plan.apply} applied, ${plan.adopt} adopted, ${plan.skip} skipped`)
      return 0
    }
    if (command === 'deploy') return runDeploy(rest)
    if (command === 'deploy-local') {
      return await runDeployLocal({ flags: parseDeployLocalArgs(rest) })
    }
    if (command === 'registry-auth') {
      console.log(`[registry-auth] configured ${configureRegistryAuth()}`)
      return 0
    }
    if (command === 'doctor') {
      const json = rest.includes('--json')
      const report = runDoctor()
      console.log(json ? JSON.stringify(report, null, 2) : formatDoctorReport(report))
      return report.clean ? 0 : 1
    }
    if (command === 'performance-budget') {
      const options = parsePerformanceBudgetArgs(rest)
      const report = runPerformanceBudgetCheck(options)
      console.log(
        options.json ? JSON.stringify(report, null, 2) : formatPerformanceBudgetReport(report),
      )
      return report.violations.length > 0 && !options.reportOnly ? 1 : 0
    }
    if (command === 'assets') {
      const [assetCommand, ...assetArgs] = rest
      if (assetCommand !== 'favicons') throw new Error('Usage: narduk-app assets favicons ...')
      const outputs = await generateFavicons(parseFaviconArgs(assetArgs))
      console.log(`[assets] wrote ${outputs.length} favicon assets`)
      return 0
    }
    if (command === 'favicons') {
      const outputs = await generateFavicons(parseFaviconArgs(rest))
      console.log(`[assets] wrote ${outputs.length} favicon assets`)
      return 0
    }
    throw new Error(`Unknown command: ${command}\n\n${usage()}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().then((status) => {
    process.exitCode = status
    return status
  })
}
