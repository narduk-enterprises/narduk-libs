import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { decodeJwt } from '../src/token/index.js'
import { clearMapKitTokenCacheForTests, mapKitTokenResponse } from '../src/server/node.js'
import { createTestPrivateKeyPem } from './test-keys.js'

describe('Node-only MapKit server entry point', () => {
  afterEach(() => {
    clearMapKitTokenCacheForTests()
  })

  it('retains the opt-in Doppler CLI fallback outside the Worker graph', async () => {
    // The fallback now supplies SIGNING material. 2.1.0's route has no static
    // token path at all (narduk-libs#421 §e.2): without a signer it answers
    // 503 unconfigured rather than serving a token nobody can scope.
    const directory = await mkdtemp(join(tmpdir(), 'mapkit-node-doppler-'))
    const command = join(directory, 'fake-doppler')
    // A throwaway ES256 key generated in-process; never a real credential.
    const privateKey = (await createTestPrivateKeyPem()).replaceAll('\n', '\\n')
    await writeFile(
      command,
      [
        '#!/bin/sh',
        'case "$3" in',
        '  APPLE_TEAM_ID) printf "%s\\n" "TEAM123456" ;;',
        '  APPLE_KEY_ID) printf "%s\\n" "KEY1234567" ;;',
        `  APPLE_PRIVATE_KEY) printf '%s\\n' '${privateKey}' ;;`,
        'esac',
        '',
      ].join('\n'),
    )
    await chmod(command, 0o700)

    const response = await mapKitTokenResponse(
      new Request('https://node.example/api/mapkit-token', {
        headers: { 'sec-fetch-site': 'same-origin' },
      }),
      { doppler: { command } },
    )
    const body = (await response.json()) as { expiresAt: number; token: string }

    expect(response.status).toBe(200)
    expect(decodeJwt(body.token).payload).toMatchObject({
      iss: 'TEAM123456',
      origin: 'https://node.example',
      scope: 'mapkit_js',
    })
    expect(typeof body.expiresAt).toBe('number')
  })

  it('answers 503 unconfigured when no signing material resolves', async () => {
    const response = await mapKitTokenResponse(
      new Request('https://node.example/api/mapkit-token', {
        headers: { 'sec-fetch-site': 'same-origin' },
      }),
      { doppler: false },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: 'unconfigured' })
  })
})
