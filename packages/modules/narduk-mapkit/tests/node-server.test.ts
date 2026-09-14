import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mapKitTokenResponse } from '../src/server/node.js'

function unsignedTokenWithExp(exp: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode({ exp })}.fixture-signature`
}

describe('Node-only MapKit server entry point', () => {
  it('retains the opt-in Doppler CLI fallback outside the Worker graph', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mapkit-node-doppler-'))
    const command = join(directory, 'fake-doppler')
    const token = unsignedTokenWithExp(Math.floor(Date.now() / 1000) + 3600)
    await writeFile(
      command,
      `#!/bin/sh\nif [ "$3" = "MAPKIT_TOKEN" ]; then printf '%s\\n' '${token}'; fi\n`,
    )
    await chmod(command, 0o700)

    const response = await mapKitTokenResponse(
      new Request('https://node.example/api/mapkit-token'),
      { doppler: { command } },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      configured: true,
      origin: 'https://node.example',
      token,
    })
  })
})
