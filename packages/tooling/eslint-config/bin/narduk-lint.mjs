#!/usr/bin/env node
// @ts-check
/** `narduk-lint` — see lint-budget.mjs for the contract and exit codes. */
import { runNardukLint } from '../lint-budget.mjs'

try {
  process.exitCode = await runNardukLint(process.argv.slice(2))
} catch (error) {
  process.stderr.write(
    `narduk-lint: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  process.exitCode = 2
}
