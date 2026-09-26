import { writeFileSync } from 'node:fs'

import { parseGhPackagesRunArgs, runGhPackagesCommand } from './gh-packages-run.js'
import { configureRegistryAuth } from './registry-auth.js'
import { generateFavicons, parseFaviconArgs } from './assets.js'
import { parseDevArgs, runDev } from './dev.js'
import { formatDevSeedPlan, parseDevSeedArgs, runDevSeed } from './dev-seed.js'
import { parseDeployLocalArgs, runDeployLocal } from './deploy-local.js'
import { parseHotfixArgs, runHotfix } from './deploy-hotfix.js'
import { DEVELOPMENT_USAGE, runDevelopmentCommand } from './development-cli.js'
import { parseAdoptionReportArgs, runAdoptionReportCommand } from './commands/adoption-report.js'
import { parseAuditArgs, runAuditCommand } from './commands/audit.js'
import { parseDoctorAllArgs, runDoctorAllCommand } from './commands/doctor-all.js'
import { parseBareDoctorArgs, runBareDoctorCommand } from './commands/doctor-bare.js'
import { isWorkersBuildDeployAllowed, readWranglerScriptName, runDeploy } from './deploy.js'
import {
  formatPromoteResult,
  parseRollbackArgs,
  parseVersionsPromoteArgs,
  PROMOTE_EXIT,
  readWranglerAccountId,
  runRollback,
  runVersionsPromote,
} from './promote.js'
import { formatVerifyReport, parseVerifyArgs, runVerifyLive } from './verify-live.js'
import { inspectMigrations, runMigrations, type MigrationLocation } from './migrations.js'
import { formatD1CreateResult, parseD1CreateArgs, runD1Create } from './d1-create.js'
import {
  parseDeploymentMigrationArgs,
  runDeploymentMigrations,
  writeDeploymentMigrationBundle,
} from './deployment-migrations.js'
import {
  emitPerformanceBudgetReport,
  parsePerformanceBudgetArgs,
  runPerformanceBudgetCheck,
} from './performance.js'
import { withAppCheckout } from './commands/checkout-root.js'
import { parseFoundationCheckArgs, runFoundationCheckCommand } from './commands/foundation-check.js'
import { runSharedUiPinnedCheckCommand } from './commands/shared-ui-pinned-check.js'
import {
  runListRoutesCheckCommand,
  runNoLocalCopyCheckCommand,
} from './commands/component-suite-check.js'
import { runCapabilityCoverageCheckCommand } from './commands/capability-coverage-check.js'
import {
  parseSecurityHeadersCheckArgs,
  runSecurityHeadersCheckCommand,
} from './commands/security-headers-check.js'
import { parseToolchainCheckArgs, runToolchainCheckCommand } from './commands/toolchain-check.js'
import { parseDeploymentCheckArgs, runDeploymentCheckCommand } from './commands/deployment-check.js'
import { runBaselineCommand } from './commands/baseline.js'
import { runOgCommand } from './commands/og.js'
import { parseE2eServeArgs, runE2eServe } from './e2e-serve/e2e-serve.js'
import {
  AGENT_KEY_USAGE,
  formatAgentKeyCreateResult,
  parseAgentKeyCreateArgs,
  runAgentKeyCreate,
} from './auth-agent-key.js'
import { parseManifestsValidateArgs, runManifestsValidateCommand } from './manifests-validate.js'
import {
  parseEnsureGeneratedArgs,
  parseStarterIdentityArgs,
  runEnsureGenerated,
  runStarterIdentityCheck,
} from './app-scripts.js'

function usage(): string {
  return [
    'Usage: narduk-app <command> [options]',
    '',
    '  --help, -h                       Print this help and exit 0. Accepted on every',
    '                                   command. A --help after -- is left for the child.',
    '',
    'Commands:',
    '  dev [--credentials <none|nvault>] [--project <name>] [--environment <name>]',
    '      [--config <name>] [--dry-run] -- <command...>',
    '                                       Run local development directly, or under the',
    '                                       registered nvault credential route',
    '  auth agent-key create --database <name> --local|--remote --name <label>',
    '      --scopes <a,b> --expires-days <n> [--admin] [--email <address>]',
    '      (--app-url <origin> | --no-proof) -- <secret sink command...>',
    '                                       Create a non-login user and API key; the key goes',
    '                                       only to the sink stdin, D1 gets its hash',
    '  ensure-generated <file...> -- <command...>',
    '                                       Run the command only when a generated file is',
    '                                       missing or imports a pnpm store path that is gone',
    '  check-starter-identity [--cwd <dir>]',
    '                                       Fail when generator placeholders such as',
    '                                       __APP_NAME__ remain on identity surfaces',
    '  dev:seed [--cwd <app dir>] [--config <wrangler config>] [--fixtures <dir>]',
    '      [--persist-to <dir>] [--reset] [--dry-run] [--json]',
    '                                       Seed local D1/KV/R2 (Wrangler --local) from',
    '                                       seed/{d1,kv,r2}/<BINDING>/ fixtures. Cloudflare',
    '                                       credentials are removed from the child environment.',
    '  db migrate --config <file> --database <name> --local|--remote [--reset] [--wrangler-config <file>]',
    '  db status --config <file> --database <name> --local|--remote [--wrangler-config <file>]',
    '  db migrate-deployment --target production|preview|staging [--check | --sha <verified commit>]',
    '  db baseline capture|sql|check|register|prove ...  Reviewed schema cutover process',
    '  db bundle --output <file>          Package SQL/data for the trusted preview migration job',
    '  db create [--checkout <dir>] [--binding <NAME>] [--dry-run] [--json]',
    '                                       Create the D1 database a placeholder binding stands',
    '                                       for (database_id 00000000-...) and write its id into the',
    '                                       wrangler config Config/cloudflare-app.json names. The',
    '                                       name comes from that manifest, never an argument; the',
    '                                       account from account_id or CLOUDFLARE_ACCOUNT_ID.',
    '                                       Refuses a binding that already has a real id; never',
    '                                       deletes.',
    '  deploy <deploy|versions-upload|triggers-deploy> ... Deploy the built app with Wrangler safeguards',
    '  deploy versions-promote [--sha <commit>|--version-id <id>] [--name <worker>]',
    '      [--account-id <id>] [--production-branch <name>] [--any-branch] [--force]',
    '      [--percentage <1-100>] [--message <text>] [--max-versions <n>]',
    '      [--wait-for-version <seconds> [--wait-interval <seconds>]]',
    '      [--gate-verified "<check>@<40-hex sha>"] [--dry-run] [--json]',
    '                                       Deploy the already-uploaded version for a commit at',
    '                                       100%. GitHub Actions only (NARDUK_ALLOW_MANUAL_PROMOTE=1',
    '                                       for recovery). The --sha lookup walks the Versions API',
    '                                       up to --max-versions (default 500) rather than the ten',
    '                                       `wrangler versions list` shows. Under workflow_run pass',
    '                                       --sha ${{ github.event.workflow_run.head_sha }}: there',
    '                                       GITHUB_SHA is the branch head, not the verified commit.',
    '                                       --wait-for-version re-lists (every --wait-interval,',
    '                                       default 30) while the SHA is absent, for a build that',
    '                                       finishes after CI; default 0 looks once.',
    '                                       --gate-verified "ci / Required@<sha>" binds the gate',
    '                                       result the workflow observed to the promoted commit',
    '                                       (split on the last @; full 40-hex SHA); without it the',
    '                                       promote warns that no gate attestation was passed.',
    '                                       Exit 1 guard refused (nothing attempted),',
    '                                       2 usage, 3 version not found, 4 ambiguous, 5 wrangler',
    '                                       failed (traffic state may be unknown), 7 the target is',
    '                                       older than the live version, 8 not a production-branch',
    '                                       build, 9 --gate-verified names a different commit.',
    '  deploy rollback [--to <version-id>] [--name <worker>] [--account-id <id>]',
    '      [--message <text>] [--dry-run] [--json]',
    '                                       Roll back to the previous deployed version, or a named',
    '                                       one. Refuses a no-op, and refuses to guess "previous"',
    '                                       when the live deployment may itself be a rollback',
    '                                       (exit 6).',
    '  verify --live <url> [--expect-sha <sha> | --expect-build-id <id>] [--deadline-ms <ms>]',
    '      [--expect-content-type <t>] [--attempts <n>] [--interval-seconds <n>]',
    '      [--allow-degraded] [--no-cache-bust] [--edge-cache-path <p>]...',
    '      [--edge-uncached-path <p>]... [--access-client-id-env <NAME>',
    '      --access-client-secret-env <NAME>] [--resolver system|public] [--json [path]]',
    '                                       Live proof of a deployment: x-build-version, health,',
    '                                       and one smoke route, read no-cache and refused if a',
    '                                       redirect leaves the origin. --edge-cache-path GETs a',
    '                                       route twice and needs Cf-Cache-Status HIT on the',
    '                                       second; --edge-uncached-path needs no HIT. Exit 2',
    '                                       unreachable, 3 build version mismatch, 4 health,',
    '                                       5 smoke, 6 wrong origin, 7 edge cache. A host the',
    '                                       local resolver cannot find but 1.1.1.1/8.8.8.8 can is',
    '                                       a "dns" UNKNOWN (stale negative cache; exit 2);',
    '                                       --resolver public dials that answer, SNI/Host kept.',
    '  e2e-serve <port> [--entrypoint <file>] [--config <file>] [--assets <dir>] [--cwd <dir>]',
    '      [--keep-service-bindings]',
    '                                       Serve a prebuilt Worker for Playwright',
    '                                       (E2E_PREBUILT_ARTIFACT=1). 127.0.0.1 only;',
    '                                       refuses to build when the artifact is missing.',
    '                                       Drops (and names) service bindings to other',
    '                                       Workers; --keep-service-bindings keeps them.',
    '  deploy-local [options]              Build, migrate, deploy, and probe a recovery release',
    '  deploy-hotfix --incident <id> --reason <text> --operator <name> --sha <full HEAD>',
    '      --confirm-worker <name> --base-url <https origin> [--dry-run | --yes --automation-paused]',
    '      [--access-client-id-env <name> --access-client-secret-env <name>]',
    '                                       Local incident patch with checks, receipt and live proof',
    ...DEVELOPMENT_USAGE,
    '  registry-auth                       Write scoped GitHub Packages auth',
    '  gh-packages-run -- <command...>     Run a command with process-scoped',
    '                                       GitHub Packages auth (temp userconfig)',
    '  doctor [--json] [--no-cache]        Prerequisites + audit, one verdict line (DOCTOR PASS|WARN|FAIL)',
    '  doctor --adoption [--checkout <dir>] [--live <url>] [--expect-sha <sha>]',
    '                    [--path <p>]... [--json [path]]',
    '                                      Report the 15 narduk-app adoption requirements',
    '  doctor --audit [--checkout <dir>] [--json] [--no-cache]',
    '                                      Fail on undeclared high/critical advisories',
    '  doctor --all [--checkout <dir>] [--live <url>] [--expect-sha <sha>] [--path <p>]...',
    '               [--json] [--no-cache]',
    '                                      One verdict line (DOCTOR PASS|WARN|FAIL) over the',
    '                                      prerequisites, --adoption and --audit legs',
    '  performance-budget [--json [path]] [options]',
    '                                       Check built asset budgets',
    '  assets favicons [options]            Generate ordinary favicon assets',
    '  og:generate [--if-missing|--force]    Render the app-owned default share image',
    '  og:check [--live] [--base-url URL] [--json [path]]',
    '                                       Verify route coverage and crawler images.',
    '                                       A missing social-previews file is a failed',
    '                                       check (exit 1), not an ENOENT throw.',
    '  foundation:check [--checkout <dir>] [--json [path]]',
    '                                       Web foundation conformance (D-WEBFOUND-2 Q9 (a))',
    '  foundation:check:shared-ui-pinned [--checkout <dir>] [--json [path]]',
    '                                       Item 8: UI apps must exact-pin published shared-UI packages',
    '  foundation:check:no-local-copy [--checkout <dir>] [--json [path]]',
    '                                       Item 13: no app-local copy of a shared package component',
    '  foundation:check:list-routes [--checkout <dir>] [--json [path]]',
    '                                       Item 14: list routes parse their query with parseListQuery',
    '  foundation:check:coverage [--checkout <dir>] [--json [path]]',
    '                                       Item 9: estate package inventory and app-local reimplementations',
    '  foundation:check:security-headers --base-url <url> [--path <p>]... [--json [path]]',
    "                                       Item 10: live probe of a deployment's security response headers",
    '  foundation:check:toolchain [--checkout <dir>] [--fix] [--json [path]]',
    '                                       Item 11: one declared Node/pnpm source, every other site reads or matches it',
    '  manifests validate [--checkout <dir>] [--wrangler <path>]... [--json [path]]',
    '                                       Compare the wrangler config(s) with Config/cloudflare-app.json:',
    '                                       bindings and crons as sorted sets, deployment.accountId, and',
    '                                       worker.workersDev/previewUrls. Exit 1 on any disagreement.',
    '  foundation:check:deployment [--checkout <dir>] [--strict] [--json [path]]',
    '                                       Item 12: the Config/cloudflare-app.json deployment block.',
    '                                       Refuses non-production branch builds that would bind',
    '                                       production D1/KV/R2. An app with no block is reported,',
    '                                       not failed, until --strict.',
  ].join('\n')
}

export function parseMigrationArgs(args: string[]): {
  configFile: string
  database: string
  location: MigrationLocation
  reset: boolean
  workersBuildOnly: boolean
  wranglerConfig?: string
} {
  let configFile = ''
  let database = ''
  let location: MigrationLocation | undefined
  let reset = false
  let workersBuildOnly = false
  let wranglerConfig: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--config') configFile = args[++index] ?? ''
    else if (arg === '--database') database = args[++index] ?? ''
    else if (arg === '--wrangler-config') {
      wranglerConfig = args[++index]
      if (!wranglerConfig || wranglerConfig.startsWith('--'))
        throw new Error('--wrangler-config requires a file')
    } else if (arg === '--local') {
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
  return {
    configFile,
    database,
    location,
    reset,
    workersBuildOnly,
    ...(wranglerConfig ? { wranglerConfig } : {}),
  }
}

/** `--help` / `-h` before a `--` separator asks for help and must not run the command. */
export function argsRequestHelp(args: readonly string[]): boolean {
  for (const arg of args) {
    if (arg === '--') return false
    if (arg === '--help' || arg === '-h') return true
  }
  return false
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = args
  try {
    if (!command || argsRequestHelp(args)) {
      console.log(usage())
      return 0
    }
    if (command === 'dev') return runDev(parseDevArgs(rest))
    if (command === 'ensure-generated') return runEnsureGenerated(parseEnsureGeneratedArgs(rest))
    if (command === 'check-starter-identity') {
      return runStarterIdentityCheck(parseStarterIdentityArgs(rest))
    }
    if (command === 'dev:seed') {
      const flags = parseDevSeedArgs(rest)
      const plan = runDevSeed(flags)
      console.log(
        flags.json ? JSON.stringify(plan, null, 2) : formatDevSeedPlan(plan, flags.dryRun),
      )
      return 0
    }
    if (command === 'e2e-serve') return await runE2eServe(parseE2eServeArgs(rest))
    if (command === 'og:check' || command === 'og:generate')
      return await runOgCommand(command, rest)
    if (command === 'auth') {
      const [group, action, ...keyArgs] = rest
      if (group !== 'agent-key' || action !== 'create') throw new Error(AGENT_KEY_USAGE)
      const result = await runAgentKeyCreate(parseAgentKeyCreateArgs(keyArgs))
      console.log(formatAgentKeyCreateResult(result))
      return 0
    }
    if (command === 'db') {
      const [subcommand, ...migrateArgs] = rest
      if (subcommand === 'baseline') {
        console.log(JSON.stringify(runBaselineCommand(migrateArgs), null, 2))
        return 0
      }
      if (subcommand === 'bundle') {
        if (
          migrateArgs.length !== 2 ||
          migrateArgs[0] !== '--output' ||
          !migrateArgs[1] ||
          migrateArgs[1].startsWith('--')
        )
          throw new Error('Usage: narduk-app db bundle --output <file>')
        writeDeploymentMigrationBundle(migrateArgs[1])
        return 0
      }
      if (subcommand === 'create') {
        const flags = withAppCheckout(parseD1CreateArgs(migrateArgs), 'db create')
        const result = runD1Create(flags)
        console.log(flags.json ? JSON.stringify(result, null, 2) : formatD1CreateResult(result))
        return 0
      }
      if (subcommand === 'migrate-deployment') {
        const options = parseDeploymentMigrationArgs(migrateArgs)
        const plans = runDeploymentMigrations(options)
        console.log(
          JSON.stringify(
            { target: options.target, check: options.check, databases: plans },
            null,
            2,
          ),
        )
        return options.check && plans.some((plan) => plan.apply + plan.adopt > 0) ? 2 : 0
      }
      if (subcommand !== 'migrate' && subcommand !== 'status')
        throw new Error('Usage: narduk-app db migrate|status|migrate-deployment|create ...')
      const options = parseMigrationArgs(migrateArgs)
      if (subcommand === 'status') {
        const plan = inspectMigrations(options)
        console.log(JSON.stringify(plan, null, 2))
        return plan.apply + plan.adopt > 0 ? 2 : 0
      }
      if (options.workersBuildOnly && !isWorkersBuildDeployAllowed()) {
        throw new Error('Remote migration requires an attested Cloudflare Workers Build')
      }
      const plan = runMigrations(options)
      if (plan.recoveryPath) console.log(`[db] recovery snapshot ${plan.recoveryPath}`)
      console.log(`[db] ${plan.apply} applied, ${plan.adopt} adopted, ${plan.skip} skipped`)
      return 0
    }
    if (command === 'deploy') {
      // `versions-promote` and `rollback` are sibling deploy actions with their
      // own GitHub Actions guard; they never reach `runDeploy`, whose
      // Workers-Builds guard would refuse them. See `./promote.ts`.
      const [action, ...actionArgs] = rest
      if (action === 'versions-promote' || action === 'rollback') {
        const context = {
          resolveWorkerName: readWranglerScriptName,
          resolveAccountId: readWranglerAccountId,
        }
        // A usage error carries PROMOTE_EXIT.usage (2), never the generic 1: a
        // promote workflow branches on the code, and 1 must keep meaning
        // "the guard refused, production is untouched" rather than doubling as
        // "you mistyped a flag".
        let result
        try {
          result =
            action === 'versions-promote'
              ? await runVersionsPromote(parseVersionsPromoteArgs(actionArgs), context)
              : await runRollback(parseRollbackArgs(actionArgs), context)
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error))
          return PROMOTE_EXIT.usage
        }
        const json = actionArgs.includes('--json')
        console.log(json ? JSON.stringify(result, null, 2) : formatPromoteResult(result))
        return result.exitCode
      }
      return runDeploy(rest)
    }
    if (command === 'verify') {
      const flags = parseVerifyArgs(rest)
      const report = await runVerifyLive(flags)
      if (flags.jsonPath)
        writeFileSync(flags.jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
      console.log(flags.json ? JSON.stringify(report, null, 2) : formatVerifyReport(report))
      return report.exitCode
    }
    if (command === 'deploy-local') {
      return await runDeployLocal({ flags: parseDeployLocalArgs(rest) })
    }
    if (command === 'development') {
      return await runDevelopmentCommand(rest)
    }
    if (command === 'deploy-hotfix') {
      return await runHotfix(parseHotfixArgs(rest))
    }
    if (command === 'registry-auth') {
      console.log(`[registry-auth] configured ${configureRegistryAuth()}`)
      return 0
    }
    if (command === 'gh-packages-run') {
      return runGhPackagesCommand(parseGhPackagesRunArgs(rest))
    }
    if (command === 'doctor') {
      // Bare `doctor` is prerequisites plus the audit, one verdict line first
      // (narduk-libs#376); `--adoption`, `--audit` and `--all` replace it.
      if (rest.includes('--adoption')) {
        const { exitCode } = await runAdoptionReportCommand(parseAdoptionReportArgs(rest))
        return exitCode
      }
      if (rest.includes('--all')) {
        return (await runDoctorAllCommand(parseDoctorAllArgs(rest))).exitCode
      }
      if (rest.includes('--audit')) return runAuditCommand(parseAuditArgs(rest)).exitCode
      return runBareDoctorCommand(parseBareDoctorArgs(rest)).exitCode
    }
    if (command === 'performance-budget') {
      const options = parsePerformanceBudgetArgs(rest)
      const report = runPerformanceBudgetCheck(options)
      emitPerformanceBudgetReport(options, report)
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
      const { exitCode } = await runFoundationCheckCommand(
        withAppCheckout(parseFoundationCheckArgs(rest), command),
      )
      return exitCode
    }
    if (command === 'foundation:check:security-headers') {
      const { exitCode } = await runSecurityHeadersCheckCommand(parseSecurityHeadersCheckArgs(rest))
      return exitCode
    }
    if (command === 'foundation:check:shared-ui-pinned') {
      const { exitCode } = await runSharedUiPinnedCheckCommand(
        withAppCheckout(parseFoundationCheckArgs(rest, command), command),
      )
      return exitCode
    }
    if (command === 'foundation:check:no-local-copy') {
      return runNoLocalCopyCheckCommand(
        withAppCheckout(parseFoundationCheckArgs(rest, command), command),
      ).exitCode
    }
    if (command === 'foundation:check:list-routes') {
      return runListRoutesCheckCommand(
        withAppCheckout(parseFoundationCheckArgs(rest, command), command),
      ).exitCode
    }
    if (command === 'foundation:check:toolchain') {
      const { exitCode } = runToolchainCheckCommand(
        withAppCheckout(parseToolchainCheckArgs(rest), command),
      )
      return exitCode
    }
    if (command === 'foundation:check:deployment') {
      const { exitCode } = runDeploymentCheckCommand(
        withAppCheckout(parseDeploymentCheckArgs(rest), command),
      )
      return exitCode
    }
    if (command === 'manifests') {
      const [subcommand, ...manifestArgs] = rest
      if (subcommand !== 'validate') {
        throw new Error('Usage: narduk-app manifests validate [--checkout <dir>] ...')
      }
      return runManifestsValidateCommand(
        withAppCheckout(parseManifestsValidateArgs(manifestArgs), 'manifests validate'),
      ).exitCode
    }
    if (command === 'foundation:check:coverage') {
      const { exitCode } = runCapabilityCoverageCheckCommand(
        withAppCheckout(parseFoundationCheckArgs(rest, command), command),
      )
      return exitCode
    }
    throw new Error(`Unknown command: ${command}\n\n${usage()}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}
