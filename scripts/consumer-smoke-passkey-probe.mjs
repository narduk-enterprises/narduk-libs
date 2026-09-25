import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

// narduk-libs#786: on a `cloudflare_module` build, narduk-auth's passkey
// routes answered 500 because tsyringe (via @simplewebauthn/server ->
// @peculiar/x509) threw at module load without a Reflect polyfill. Unit tests
// cannot see that: only the bundled Worker, run on workerd, drops the
// polyfill. This probe serves the generated app's built Worker locally and
// asks for a sign-in challenge, so the release proof fails if that regresses.

const HOST = '127.0.0.1'
const OPTIONS_PATH = '/api/auth/passkeys/authentication/options'

// Worker vars that turn passkeys on. Passkeys are off in a generated app by
// default, and the route answers 501 until a complete RP configuration exists.
// `localhost` is the one RP ID `isValidRpId` accepts that needs no DNS.
export function passkeyProbeVars(port) {
  return {
    AUTH_BACKEND: 'local',
    AUTH_LOCAL_PROVIDERS: 'email,passkey',
    AUTH_WEBAUTHN_RP_ID: 'localhost',
    AUTH_WEBAUTHN_ORIGIN: `http://localhost:${port}`,
    NUXT_SESSION_PASSWORD: 'narduk-test-only-session-password-000000',
  }
}

export function passkeyProbeWranglerArgs(port) {
  return [
    'exec',
    'wrangler',
    'dev',
    '--ip',
    HOST,
    '--port',
    String(port),
    '--show-interactive-dev-session=false',
    ...Object.entries(passkeyProbeVars(port)).flatMap(([key, value]) => [
      '--var',
      `${key}:${value}`,
    ]),
  ]
}

/** Throw unless the options route answered 200 with a WebAuthn challenge. */
export function assertPasskeyOptionsResponse(status, bodyText) {
  let body
  try {
    body = JSON.parse(bodyText)
  } catch {
    body = undefined
  }
  const challenge = body && typeof body === 'object' ? body.challenge : undefined
  if (status === 200 && typeof challenge === 'string' && challenge.length > 0) return
  throw new Error(
    `POST ${OPTIONS_PATH} on the generated Worker answered ${status}, not 200 with a challenge ` +
      `(narduk-libs#786): ${bodyText.slice(0, 500)}`,
  )
}

/**
 * Serve the built Worker with `wrangler dev`, POST the passkey options route,
 * and stop the server. `appDirectory` holds the generated app's
 * `wrangler.jsonc`; its local D1 must already be migrated.
 */
export async function probeWorkerPasskeyOptions({
  appDirectory,
  env,
  port,
  readyTimeoutMs = 120_000,
  writeLine = console.log,
  // Tests substitute a stand-in server for `pnpm exec wrangler dev`.
  command = ['pnpm', passkeyProbeWranglerArgs(port)],
}) {
  const child = spawn(command[0], command[1], {
    cwd: appDirectory,
    env: { ...env, WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group, so the stop below also reaches workerd.
    detached: true,
  })
  let output = ''
  const collect = (chunk) => {
    output += chunk
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  let exited = false
  child.once('exit', () => {
    exited = true
  })

  const base = `http://${HOST}:${port}`
  try {
    const deadline = Date.now() + readyTimeoutMs
    for (;;) {
      if (exited) {
        throw new Error(`wrangler dev exited before serving the generated Worker:\n${output}`)
      }
      if (Date.now() > deadline) {
        throw new Error(
          `wrangler dev did not serve ${base} within ${readyTimeoutMs / 1000}s:\n${output}`,
        )
      }
      try {
        await fetch(`${base}/`, { signal: AbortSignal.timeout(5_000) })
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }

    const response = await fetch(`${base}${OPTIONS_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: '{}',
      signal: AbortSignal.timeout(30_000),
    })
    const bodyText = await response.text()
    try {
      assertPasskeyOptionsResponse(response.status, bodyText)
    } catch (error) {
      throw new Error(`${error.message}\nwrangler dev output:\n${output}`, { cause: error })
    }
    writeLine(`[consumer-smoke] Passkey options on the built Worker answered 200 with a challenge.`)
  } finally {
    await stopProcessGroup(child, () => exited)
  }
}

/** A port the OS just handed out, so parallel runners do not collide. */
export function freeLocalPort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, HOST, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function stopProcessGroup(child, hasExited) {
  if (hasExited()) return
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal)
    } catch {
      // Already gone.
    }
  }
  signalGroup('SIGTERM')
  const deadline = Date.now() + 5_000
  while (!hasExited() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!hasExited()) signalGroup('SIGKILL')
}
