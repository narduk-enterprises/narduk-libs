#!/usr/bin/env node
// Fixture app: send one real push to a device through narduk-notify's built dist.
//
//   pnpm --filter @narduk-enterprises/narduk-notify run build
//   nvault run -- node packages/modules/narduk-notify/scripts/send-test-push.mjs \
//     --bundle <bundle id> --token <hex token> [--type alert|liveactivity] [--env production|development]
//
// The key is read from APNS_KEY_P8, APNS_KEY_ID and APNS_TEAM_ID, which the
// nvault route fills; it never touches a file. Exit 0 sent, 1 rejected, 2 usage.
import { parseArgs } from 'node:util'

import { createApnsClient } from '../dist/index.js'
import { createNodeHttp2Transport } from '../dist/node.js'

const { values } = parseArgs({
  options: {
    bundle: { type: 'string' },
    env: { type: 'string', default: 'production' },
    token: { type: 'string' },
    type: { type: 'string', default: 'alert' },
  },
})

const missing = ['APNS_KEY_P8', 'APNS_KEY_ID', 'APNS_TEAM_ID'].filter((name) => !process.env[name])
if (!values.bundle || !values.token || missing.length > 0) {
  console.error(
    `usage: send-test-push.mjs --bundle <id> --token <hex> [--type alert|liveactivity] [--env production|development]${
      missing.length > 0 ? `\nmissing env: ${missing.join(', ')}` : ''
    }`,
  )
  process.exit(2)
}
if (
  !['alert', 'liveactivity'].includes(values.type) ||
  !['production', 'development'].includes(values.env)
) {
  console.error('--type must be alert or liveactivity; --env production or development')
  process.exit(2)
}

const notification =
  values.type === 'alert'
    ? {
        pushType: 'alert',
        alert: { title: 'narduk-notify test', body: new Date().toISOString() },
        sound: 'default',
      }
    : {
        pushType: 'liveactivity',
        event: 'update',
        contentState: { sentAt: new Date().toISOString() },
      }

const transport = createNodeHttp2Transport()
try {
  const client = createApnsClient({
    bundleId: values.bundle,
    environment: values.env,
    credentials: {
      keyId: process.env.APNS_KEY_ID,
      privateKey: process.env.APNS_KEY_P8,
      teamId: process.env.APNS_TEAM_ID,
    },
    transport: transport.send,
  })
  const result = await client.send(notification, { deviceToken: values.token })
  console.log(JSON.stringify(result))
  process.exitCode = result.ok ? 0 : 1
} finally {
  transport.close()
}
