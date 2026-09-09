import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = mkdtempSync(join(tmpdir(), 'narduk-logging-npm-'))
const run = (command, args, cwd = temporary) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${command} failed\n${result.stdout}\n${result.stderr}`)
  return result
}
try {
  run('pnpm', ['pack', '--pack-destination', temporary], root)
  const archive = readdirSync(temporary).find((name) => name.endsWith('.tgz'))
  assert.ok(archive, 'pnpm must create an archive')
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    join(temporary, archive),
    'typescript@5.9.3',
    '@types/node@22',
    'esbuild@0.25.12',
    'h3@1.15.11',
  ])
  writeFileSync(
    join(temporary, 'check.ts'),
    `
import { createLogger } from '@narduk-enterprises/narduk-logging'
import { createMemorySink } from '@narduk-enterprises/narduk-logging/testing'
import { createBrowserLogger } from '@narduk-enterprises/narduk-logging/browser'
import { createWorkerLogger } from '@narduk-enterprises/narduk-logging/worker'
import { createNodeLogger } from '@narduk-enterprises/narduk-logging/node'
const sink = createMemorySink()
for (const create of [createLogger, createBrowserLogger, createWorkerLogger, createNodeLogger]) {
  const log = create({service: 'packed-npm', environment: 'test', sinks: [sink]})
  log.info('Synthetic logging check', {token: 'must-redact'})
  await log.close()
}
if (sink.records.length !== 4 || JSON.stringify(sink.records).includes('must-redact')) throw Error('Unsafe artifact')
console.log(JSON.stringify(sink.records))
`,
  )
  run('node', [
    'node_modules/typescript/bin/tsc',
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--module',
    'NodeNext',
    '--target',
    'ES2022',
    'check.ts',
  ])
  const check = run('node', ['--experimental-strip-types', 'check.ts'])
  assert.equal(JSON.parse(check.stdout).length, 4)
  for (const example of ['node.ts', 'worker.ts', 'browser.ts'])
    cpSync(join(root, 'examples', example), join(temporary, example))
  const node = run('node', ['--experimental-strip-types', 'node.ts'])
  assert.equal(node.stdout, '', 'CLI diagnostics must leave stdout untouched')
  assert.ok(node.stderr.includes('Synthetic logging check'))
  writeFileSync(
    join(temporary, 'worker-check.mjs'),
    `
import app from './worker.ts'
const env = {APP_ENVIRONMENT: 'test'}
const response = await app.fetch(new Request('https://example.test/'), env)
if (!response.ok || !response.headers.get('x-request-id')) throw Error('Worker failed')
await app.scheduled({}, env)
let count = 0
await app.queue({messages: [{ack(){count++}, retry(){throw Error('Unexpected retry')}}]}, env)
if (count !== 1) throw Error('Queue acknowledgement changed')
`,
  )
  run('node', ['--experimental-strip-types', 'worker-check.mjs'])
  // The SEO module aliases bare consola; subpath isolation must survive browser bundling.
  writeFileSync(
    join(temporary, 'browser-build.mjs'),
    `
import {build} from 'esbuild'
await build({entryPoints:['browser.ts'], bundle:true, platform:'browser', outfile:'browser.js',
  plugins:[{name:'seo-consola-alias',setup(builder){builder.onResolve({filter:/^consola$/},()=>{throw Error('Bare consola import would hit SEO alias')})}}]})
`,
  )
  run('node', ['browser-build.mjs'])
  console.log(
    'Verified packed npm declarations, root/runtime imports, Node/Worker examples and browser bundle',
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
