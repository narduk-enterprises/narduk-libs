#!/usr/bin/env node
import { runNardukStylelint } from '../stylelint-budget.mjs'

const code = await runNardukStylelint(process.argv.slice(2))
process.exit(code)
