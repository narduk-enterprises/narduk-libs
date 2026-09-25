import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertPasskeyOptionsResponse,
  freeLocalPort,
  passkeyProbeVars,
  passkeyProbeWranglerArgs,
  probeWorkerPasskeyOptions,
} from './consumer-smoke-passkey-probe.mjs'

// A stand-in for `wrangler dev`: serves `/` after a short delay, then answers
// the options route with the given status and body.
function standInServer(port, status, body, { delayMs = 200 } = {}) {
  const program = `
    const http = require('node:http')
    setTimeout(() => {
      http.createServer((req, res) => {
        if (req.url === '/api/auth/passkeys/authentication/options' && req.method === 'POST') {
          if (req.headers['x-requested-with'] !== 'XMLHttpRequest') { res.statusCode = 403; return res.end('csrf') }
          res.statusCode = ${status}
          return res.end(${JSON.stringify(body)})
        }
        res.end('ok')
      }).listen(${port}, '127.0.0.1')
    }, ${delayMs})
  `
  return [process.execPath, ['-e', program]]
}

test('enables passkeys with a localhost RP ID bound to the probe port', () => {
  assert.deepEqual(passkeyProbeVars(4321), {
    AUTH_BACKEND: 'local',
    AUTH_LOCAL_PROVIDERS: 'email,passkey',
    AUTH_WEBAUTHN_RP_ID: 'localhost',
    AUTH_WEBAUTHN_ORIGIN: 'http://localhost:4321',
    NUXT_SESSION_PASSWORD: 'narduk-test-only-session-password-000000',
  })
  const args = passkeyProbeWranglerArgs(4321)
  assert.deepEqual(args.slice(0, 7), [
    'exec',
    'wrangler',
    'dev',
    '--ip',
    '127.0.0.1',
    '--port',
    '4321',
  ])
  assert.ok(args.includes('AUTH_WEBAUTHN_RP_ID:localhost'))
})

test('accepts only 200 with a non-empty challenge', () => {
  assert.doesNotThrow(() =>
    assertPasskeyOptionsResponse(200, '{"challenge":"abc","rpId":"localhost"}'),
  )
  assert.throws(
    () => assertPasskeyOptionsResponse(500, '{"message":"Server Error"}'),
    /answered 500/u,
  )
  assert.throws(() => assertPasskeyOptionsResponse(501, '{}'), /answered 501/u)
  assert.throws(
    () => assertPasskeyOptionsResponse(200, '{"challenge":""}'),
    /not 200 with a challenge/u,
  )
  assert.throws(() => assertPasskeyOptionsResponse(200, 'not json'), /not 200 with a challenge/u)
})

test('passes once the served Worker answers with a challenge, and stops it', async () => {
  const port = await freeLocalPort()
  const lines = []
  await probeWorkerPasskeyOptions({
    appDirectory: process.cwd(),
    env: process.env,
    port,
    writeLine: (line) => lines.push(line),
    command: standInServer(port, 200, '{"challenge":"abc"}'),
  })
  assert.match(lines.join('\n'), /answered 200 with a challenge/u)
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`), 'the stand-in server was stopped')
})

test('fails on the #786 symptom, an opaque 500', async () => {
  const port = await freeLocalPort()
  await assert.rejects(
    probeWorkerPasskeyOptions({
      appDirectory: process.cwd(),
      env: process.env,
      port,
      writeLine: () => {},
      command: standInServer(port, 500, '{"message":"Server Error"}'),
    }),
    /answered 500, not 200 with a challenge \(narduk-libs#786\)/u,
  )
})

test('fails with the server output when it exits before serving', async () => {
  const port = await freeLocalPort()
  await assert.rejects(
    probeWorkerPasskeyOptions({
      appDirectory: process.cwd(),
      env: process.env,
      port,
      writeLine: () => {},
      command: [process.execPath, ['-e', 'console.error("boom from workerd"); process.exit(1)']],
    }),
    /exited before serving the generated Worker:\n[\s\S]*boom from workerd/u,
  )
})

test('fails when the server never becomes ready', async () => {
  const port = await freeLocalPort()
  await assert.rejects(
    probeWorkerPasskeyOptions({
      appDirectory: process.cwd(),
      env: process.env,
      port,
      readyTimeoutMs: 1_000,
      writeLine: () => {},
      command: [process.execPath, ['-e', 'setInterval(() => {}, 1000)']],
    }),
    /did not serve .* within 1s/u,
  )
})
