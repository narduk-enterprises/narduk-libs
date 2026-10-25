// ponytail-5 regression tests for mapkit-src #2 (MAPKIT_ALLOWED_ORIGINS on the token route)
import { createServer } from 'node:http'
import { connect } from 'node:net'

import { createApp, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import tokenRoute from '../src/runtime/server/mapkit-token.get'

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

async function testPrivateKeyPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  const body = Buffer.from(pkcs8)
    .toString('base64')
    .match(/.{1,64}/g)!
    .join('\n')
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`
}

async function rawRequest(port: number, host: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(
        [
          'GET /api/mapkit-token HTTP/1.1',
          `Host: ${host}`,
          'Sec-Fetch-Site: same-origin',
          'Connection: close',
          '',
          '',
        ].join('\r\n'),
      )
    })
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('error', reject)
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

let server: Server
let port: number
const saved: Record<string, string | undefined> = {}
const ENV_KEYS = ['APPLE_KEY_ID', 'APPLE_TEAM_ID', 'APPLE_PRIVATE_KEY', 'MAPKIT_ALLOWED_ORIGINS']

beforeAll(async () => {
  for (const key of ENV_KEYS) saved[key] = process.env[key]
  process.env.APPLE_KEY_ID = 'KEY1234567'
  process.env.APPLE_TEAM_ID = 'TEAM123456'
  process.env.APPLE_PRIVATE_KEY = await testPrivateKeyPem()
  // The README documents this variable as the host/origin allow-list.
  process.env.MAPKIT_ALLOWED_ORIGINS = 'https://app.example'
  const app = createApp()
  app.use('/api/mapkit-token', tokenRoute)
  server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('mapkit-src #2: adapter token route ignores MAPKIT_ALLOWED_ORIGINS', () => {
  it('refuses to mint for a forged Host that is not on the configured allow-list', async () => {
    const raw = await rawRequest(port, 'evil.example')
    expect(raw).toContain('403 ')
    expect(raw).not.toContain('"token"')
  })

  it('treats a bare host:port entry as a host, not as an empty (allow-all) list', async () => {
    process.env.MAPKIT_ALLOWED_ORIGINS = 'app.example:8443'
    try {
      expect(await rawRequest(port, 'evil.example')).toContain('403 ')
      expect(await rawRequest(port, 'app.example:8443')).toContain('200 ')
    } finally {
      process.env.MAPKIT_ALLOWED_ORIGINS = 'https://app.example'
    }
  })

  it('still mints for a Host on the allow-list', async () => {
    const raw = await rawRequest(port, 'app.example')
    expect(raw).toContain('200 ')
    expect(raw).toContain('"token"')
  })
})
