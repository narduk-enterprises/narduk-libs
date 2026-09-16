import { configureRegistryAuth } from './registry-auth.js'
import { generateFavicons, parseFaviconArgs } from './assets.js'
import { parseDevArgs, runDev } from './dev.js'
import { parseDeployLocalArgs, runDeployLocal } from './deploy-local.js'
import { runDoctor, formatDoctorReport } from './doctor.js'
import { isWorkersBuildDeployAllowed, runDeploy } from './deploy.js'
import { runMigrations, type MigrationLocation } from './migrations.js'
import {
  formatPerformanceBudgetReport,
  parsePerformanceBudgetArgs,
  runPerformanceBudgetCheck,
} from './performance.js'
import { parseFoundationCheckArgs, runFoundationCheckCommand } from './commands/foundation-check.js'
import { runSharedUiPinnedCheckCommand } from './commands/shared-ui-pinned-check.js'
import { runOgCommand } from './commands/og.js'

function usage(): string {
  return [
    'Usage: narduk-app <command> [options]',
    '',
    'Commands:',
    '  dev [--credentials <none|nvault>] [--project <name>] [--environment <name>]',
    '      [--config <name>] [--dry-run] -- <command...>',
    '                                       Run local development directly, or under the',
    '                                       registered nvault credential route',
    '  db migrate --config <file> --database <name> --local|--remote [--reset]',
    '  deploy <deploy|versions-upload> ... Deploy the built app with Wrangler safeguards',
    '  deploy-local [options]              Build, migrate, deploy, and probe a recovery release',
    '  registry-auth                       Write scoped GitHub Packages auth',
    '  doctor                              Check app-local prerequisites',
    '  performance-budget [options]        Check built asset budgets',
    '  assets favicons [options]            Generate ordinary favicon assets',
    '  og:generate [--if-missing|--force]    Render the app-owned default share image',
    '  og:check [--live] [--base-url URL] [--json]  Verify route coverage and crawler images',
    '  foundation:check [--checkout <dir>] [--json [path]]',
    '                                       Web foundation conformance (D-WEBFOUND-2 Q9 (a))',
    '  foundation:check:shared-ui-pinned [--checkout <dir>] [--json [path]]',
    '                                       Item 8: UI apps must exact-pin published shared-UI packages',
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
    if (command === 'og:check' || command === 'og:generate')
      return await runOgCommand(command, rest)
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
    if (command === 'foundation:check') {
      const { exitCode } = await runFoundationCheckCommand(parseFoundationCheckArgs(rest))
      return exitCode
    }
    if (command === 'foundation:check:shared-ui-pinned') {
      const { exitCode } = await runSharedUiPinnedCheckCommand(
        parseFoundationCheckArgs(rest, 'foundation:check:shared-ui-pinned'),
      )
      return exitCode
    }
    throw new Error(`Unknown command: ${command}\n\n${usage()}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}
