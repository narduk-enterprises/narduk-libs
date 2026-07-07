#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const binDir = join(repoRoot, 'node_modules', '.bin')

const [command, ...extraArgs] = process.argv.slice(2)

function collectShellScripts(dir, files = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return files
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      collectShellScripts(fullPath, files)
      continue
    }
    if (entry.endsWith('.sh')) {
      files.push(fullPath)
    }
  }

  return files
}

function runTool(toolName, args) {
  const executable = process.platform === 'win32' ? `${toolName}.cmd` : toolName
  const result = spawnSync(join(binDir, executable), args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.error) {
    console.error(`${toolName} failed to start: ${result.error.message}`)
  }

  return result.status ?? 1
}

function runSystemTool(toolName, args) {
  const result = spawnSync(toolName, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(`${toolName} failed to start: ${result.error.message}`)
  }

  return result.status ?? 1
}

function hasSystemTool(toolName) {
  const result = spawnSync(toolName, ['--version'], {
    cwd: process.cwd(),
    stdio: 'ignore',
  })

  return !result.error && result.status === 0
}

const commands = {
  'format:check': [
    'prettier',
    '--check',
    '--log-level',
    'warn',
    '**/*.{ts,mts,js,mjs,json,md,yaml,yml}',
    '--ignore-path',
    '../../.gitignore',
    '--ignore-path',
    '../../.prettierignore',
  ],
  lint: ['eslint', ...(extraArgs.length > 0 ? extraArgs : ['src/**/*.ts']), '--max-warnings', '0'],
  typecheck: ['tsc', '--noEmit', '--project', extraArgs[0] || 'tsconfig.json'],
}

const args = commands[command]

if (!args) {
  console.error(`Unknown package quality command: ${command || '<missing>'}`)
  process.exit(1)
}

if (command === 'lint') {
  const eslintStatus = runTool(args[0], args.slice(1))
  if (eslintStatus !== 0) {
    process.exit(eslintStatus)
  }

  if (hasSystemTool('bash')) {
    for (const shellScript of collectShellScripts(join(process.cwd(), 'src'))) {
      const shellStatus = runSystemTool('bash', ['-n', shellScript])
      if (shellStatus !== 0) {
        process.exit(shellStatus)
      }
    }
  }

  process.exit(0)
}

const resultStatus = runTool(args[0], args.slice(1))

process.exit(resultStatus)
