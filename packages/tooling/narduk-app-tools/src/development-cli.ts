import {
  describeOutcome,
  parseDevelopmentDeployArgs,
  runDevelopmentDeploy,
} from './development-deploy.js'
import {
  formatStatus,
  runDevelopmentAccept,
  runDevelopmentEnter,
  runDevelopmentExec,
  runDevelopmentExitComplete,
  runDevelopmentExitPrepare,
  runDevelopmentHandoff,
  runDevelopmentPin,
  runDevelopmentResolve,
  runDevelopmentStatus,
  runDevelopmentUnpin,
  runDevelopmentRollback,
  runDevelopmentValidate,
  runDevelopmentValidationWorker,
  type ExecFlags,
} from './development-lifecycle.js'

export const DEVELOPMENT_USAGE = [
  '  development deploy [--handoff <what to try>] [--gated] [--red-main-fix <issue>] [--dry-run] [--json]',
  '                                       deploy:dev: capture the checkout (dirty edits included),',
  '                                       gate, build, upload, promote and prove the enrolled target,',
  '                                       then queue full validation of it in the background.',
  '                                       --gated deploys protected-path changes; --red-main-fix',
  '                                       names the red-main issue a deploy fixes after 24 h red',
  '  development rollback --to <known-good build id> [--dry-run]',
  '                                       Serve and prove a known-good build again; refuses across',
  '                                       a Durable Object, binding or non-expand-only migration change',
  '  development status [--remote] [--json]',
  '  development enter --approval-ref <ref> --publisher <id> [--target-set <id>] [--refresh] [--dry-run] [--accept-prior-state]',
  '  development pin --scenario <file> | development unpin --feedback-ref <ref>',
  '  development exec --operation <migration|secret-stage|recovery> --approval-ref <ref>',
  '      [--commit <sha>] -- <command...>  Authorized operation under the same target lock',
  '  development validate --ref <branch> --sha <full sha> --reason <text>',
  '  development validation-worker        (internal) push queued deployed commits for validation',
  '  development handoff --to <publisher> | handoff --accept <bundle> --publisher <id>',
  '  development resolve [--release-stale-lock]',
  '  development exit --prepare | exit --release-sha <sha> --validation-run <id> [--owner-proof-ref <ref>]',
]

function options(
  args: string[],
  values: string[],
  booleans: string[] = [],
): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`)
    const name = arg.slice(2)
    if (name in result) throw new Error(`Duplicate option: ${arg}`)
    if (booleans.includes(name)) result[name] = true
    else if (values.includes(name)) {
      const value = args[++index]
      if (!value?.trim() || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      result[name] = value
    } else throw new Error(`Unknown option: ${arg}`)
  }
  return result
}

function required(values: Record<string, string | boolean>, name: string): string {
  const value = values[name]
  if (typeof value !== 'string') throw new Error(`--${name} is required`)
  return value
}

export async function runDevelopmentCommand(args: string[]): Promise<number> {
  const [action, ...rest] = args
  if (action === 'deploy') {
    const flags = parseDevelopmentDeployArgs(rest)
    const receipt = await runDevelopmentDeploy(flags)
    if (flags.json) console.log(JSON.stringify(receipt, null, 2))
    else console.log(`${describeOutcome(receipt.outcome)}: ${receipt.buildId}`)
    if (flags.dryRun) return 0
    return receipt.outcome === 'verified' || receipt.outcome === 'awaiting-owner' ? 0 : 1
  }
  if (action === 'status') {
    const values = options(rest, [], ['remote', 'json'])
    const report = await runDevelopmentStatus({ remote: Boolean(values.remote) })
    console.log(values.json ? JSON.stringify(report, null, 2) : formatStatus(report))
    return 0
  }
  if (action === 'enter') {
    const values = options(
      rest,
      ['approval-ref', 'publisher', 'target-set'],
      ['refresh', 'dry-run', 'accept-prior-state'],
    )
    await runDevelopmentEnter({
      approvalRef: required(values, 'approval-ref'),
      publisher: required(values, 'publisher'),
      targetSet: values['target-set'] as string | undefined,
      refresh: Boolean(values.refresh),
      dryRun: Boolean(values['dry-run']),
      acceptPriorState: Boolean(values['accept-prior-state']),
    })
    return 0
  }
  if (action === 'pin') {
    await runDevelopmentPin({ scenario: required(options(rest, ['scenario']), 'scenario') })
    return 0
  }
  if (action === 'unpin') {
    runDevelopmentUnpin({ feedbackRef: required(options(rest, ['feedback-ref']), 'feedback-ref') })
    return 0
  }
  if (action === 'exec') {
    const separator = rest.indexOf('--')
    if (separator < 0) throw new Error('Pass the operation command after --')
    const values = options(rest.slice(0, separator), ['operation', 'approval-ref', 'commit'])
    const operation = required(values, 'operation')
    if (!['migration', 'secret-stage', 'recovery'].includes(operation))
      throw new Error('--operation must be migration, secret-stage or recovery')
    const { exitCode } = await runDevelopmentExec({
      operation: operation as ExecFlags['operation'],
      approvalRef: required(values, 'approval-ref'),
      commit: values.commit as string | undefined,
      argv: rest.slice(separator + 1),
    })
    return exitCode
  }
  if (action === 'validate') {
    const values = options(rest, ['ref', 'sha', 'reason'])
    runDevelopmentValidate({
      ref: required(values, 'ref'),
      sha: required(values, 'sha'),
      reason: required(values, 'reason'),
    })
    return 0
  }
  if (action === 'validation-worker') {
    options(rest, [])
    runDevelopmentValidationWorker()
    return 0
  }
  if (action === 'rollback') {
    const values = options(rest, ['to'], ['dry-run'])
    await runDevelopmentRollback({
      to: required(values, 'to'),
      dryRun: Boolean(values['dry-run']),
    })
    return 0
  }
  if (action === 'handoff') {
    const values = options(rest, ['to', 'accept', 'publisher'])
    if (values.accept)
      await runDevelopmentAccept({
        bundle: required(values, 'accept'),
        publisher: required(values, 'publisher'),
      })
    else runDevelopmentHandoff({ to: required(values, 'to') })
    return 0
  }
  if (action === 'resolve') {
    const values = options(rest, [], ['release-stale-lock'])
    await runDevelopmentResolve({ releaseStaleLock: Boolean(values['release-stale-lock']) })
    return 0
  }
  if (action === 'exit') {
    const values = options(rest, ['release-sha', 'validation-run', 'owner-proof-ref'], ['prepare'])
    if (values.prepare) {
      if (Object.keys(values).length !== 1) throw new Error('exit --prepare takes no other options')
      runDevelopmentExitPrepare()
      return 0
    }
    await runDevelopmentExitComplete({
      releaseSha: required(values, 'release-sha'),
      validationRun: required(values, 'validation-run'),
      ownerProofRef: values['owner-proof-ref'] as string | undefined,
    })
    return 0
  }
  throw new Error(`Usage:\n${DEVELOPMENT_USAGE.join('\n')}`)
}
