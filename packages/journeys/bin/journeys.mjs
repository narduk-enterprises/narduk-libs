#!/usr/bin/env node
import process from 'node:process'

const { main } = await import('../dist/cli/main.js')
process.exitCode = await main(process.argv.slice(2))
