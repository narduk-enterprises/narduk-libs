import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('packed smoke heap survives pnpm lifecycle and nested consumer commands', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const job = workflow.split('\n  packed-consumer-smoke:\n')[1].split(/^  [\w-]+:\s*$/m)[0]
  assert.match(job, /^      NARDUK_BUILD_MAX_OLD_SPACE_SIZE: "2048"$/m)
  assert.match(
    job,
    /node scripts\/prepare-packed-consumer\.mjs \\\n\s+--build-concurrency=4 \\\n\s+--packages "\$\{CONSUMER_SCOPE\}"/u,
  )
  const turbo = JSON.parse(readFileSync(new URL('../turbo.json', import.meta.url), 'utf8'))
  assert.ok(turbo.tasks.build.dependsOn.includes('^build'))
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^(node_options|npm_config_node_options)$/i.test(key)) delete env[key]
  }
  for (const key of ['NODE_OPTIONS', 'npm_config_node_options']) {
    const value = job.match(new RegExp(`^      ${key}: (.+)$`, 'm'))?.[1]
    if (value) env[key] = value
  }
  const directory = mkdtempSync(join(tmpdir(), 'consumer-smoke-heap-'))
  try {
    mkdirSync(join(directory, 'consumer'))
    writeFileSync(join(directory, '.npmrc'), readFileSync(new URL('../.npmrc', import.meta.url)))
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ scripts: { probe: 'pnpm --dir consumer --silent run probe' } }),
    )
    writeFileSync(
      join(directory, 'consumer', 'package.json'),
      JSON.stringify({ scripts: { probe: 'node probe.mjs' } }),
    )
    writeFileSync(
      join(directory, 'consumer', 'probe.mjs'),
      `import { getHeapStatistics } from 'node:v8';
console.log(JSON.stringify({ options: process.env.NODE_OPTIONS, limit: getHeapStatistics().heap_size_limit }));\n`,
    )
    const result = JSON.parse(
      execFileSync('pnpm', ['--silent', 'run', 'probe'], {
        cwd: directory,
        env,
        encoding: 'utf8',
        timeout: 30_000,
      }),
    )
    assert.equal(result.options, '--max-old-space-size=2048')
    assert.ok(result.limit < 3 * 1024 ** 3, `effective heap was ${result.limit} bytes`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
