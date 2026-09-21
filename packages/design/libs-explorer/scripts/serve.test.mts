import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { createExplorerServer, HOST, resolveRequestFile } from './serve.mts'

// An isolated fixture: a served root, a sibling directory beside it, and a
// file outside both. Nothing here touches a real build or another server.
const base = mkdtempSync(join(tmpdir(), 'explorer-serve-'))
const root = join(base, 'public')
const sibling = join(base, 'public-sibling')
mkdirSync(join(root, 'docs'), { recursive: true })
mkdirSync(sibling)
writeFileSync(join(root, 'index.html'), '<h1>home</h1>')
writeFileSync(join(root, '404.html'), '<h1>missing</h1>')
writeFileSync(join(root, 'docs', 'index.html'), '<h1>docs</h1>')
writeFileSync(join(root, 'app.js'), 'export {}')
writeFileSync(join(sibling, 'probe.txt'), 'SIBLING SECRET')
writeFileSync(join(base, 'outside.txt'), 'OUTSIDE SECRET')
symlinkSync(join(base, 'outside.txt'), join(root, 'escape.txt'))
symlinkSync(sibling, join(root, 'escape-dir'))
symlinkSync(join(root, 'app.js'), join(root, 'alias.js'))

let origin = ''
const server = createExplorerServer(root)
before(async () => {
  await new Promise<void>((done) => server.listen(0, HOST, done))
  origin = `http://${HOST}:${(server.address() as AddressInfo).port}`
})
after(() => {
  server.close()
  rmSync(base, { recursive: true, force: true })
})

async function get(path: string) {
  // fetch() would normalise `..` away; a raw path must reach the server as sent.
  const { request } = await import('node:http')
  return new Promise<{ status: number; body: string }>((done, fail) => {
    const url = new URL(origin)
    request({ host: url.hostname, port: url.port, path, method: 'GET' }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => (body += chunk))
      response.on('end', () => done({ status: response.statusCode ?? 0, body }))
    })
      .on('error', fail)
      .end()
  })
}

test('binds loopback only', () => {
  assert.equal((server.address() as AddressInfo).address, '127.0.0.1')
})

test('ordinary routes, assets and 404', async () => {
  assert.deepEqual(await get('/'), { status: 200, body: '<h1>home</h1>' })
  assert.deepEqual(await get('/docs'), { status: 200, body: '<h1>docs</h1>' })
  assert.deepEqual(await get('/app.js'), { status: 200, body: 'export {}' })
  assert.deepEqual(await get('/nope'), { status: 404, body: '<h1>missing</h1>' })
})

test('a malformed encoding is a 400, and the server keeps serving', async () => {
  assert.equal((await get('/%')).status, 400)
  assert.equal((await get('/%E0%A4%A')).status, 400)
  assert.equal((await get('/a%00b')).status, 400)
  assert.equal((await get('/')).status, 200)
})

test('encoded traversal to a sibling directory with a shared prefix is refused', async () => {
  for (const path of [
    '/..%2fpublic-sibling/probe.txt',
    '/%2e%2e/public-sibling/probe.txt',
    '/..%2f..%2foutside.txt',
    '/%2e%2e%2foutside.txt',
  ]) {
    const response = await get(path)
    assert.equal(response.status, 404, path)
    assert.doesNotMatch(response.body, /SECRET/, path)
  }
  assert.equal(resolveRequestFile(root, '/..%2fpublic-sibling/probe.txt'), null)
})

test('a symlink out of the root is refused; one inside it is served', async () => {
  assert.equal((await get('/escape.txt')).status, 404)
  assert.equal((await get('/escape-dir/probe.txt')).status, 404)
  assert.deepEqual(await get('/alias.js'), { status: 200, body: 'export {}' })
  assert.equal((await get('/')).status, 200)
})
