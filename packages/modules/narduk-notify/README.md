# @narduk-enterprises/narduk-notify

Notification delivery for Narduk products: APNs with token auth (alert,
background and Live Activity pushes), Web Push (VAPID, encrypted payloads),
email through Resend, per-user preferences, and a delivery audit log on D1.

It has no runtime dependencies. It uses the host's `fetch`, Web Crypto and D1
binding, so the root entry runs in Workers and in Node. SMS is not in it yet;
SMS is mybo.at Phase 7.

## Install

```bash
pnpm add @narduk-enterprises/narduk-notify
```

## Exports

| Subpath          | What it holds                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `.`              | APNs signer, request builder and client; Web Push; Resend client; preferences; audit; `createNotifier` |
| `./node`         | `createNodeHttp2Transport`, the HTTP/2 transport APNs needs in Node                                    |
| `./migrations/*` | `0001_notify.sql`, for the app's D1 migration runner                                                   |

`node:http2` is only imported by `./node`, so a Worker bundle never pulls it in.

## Credentials: by name, never a file

| Value          | Where it comes from                                          |
| -------------- | ------------------------------------------------------------ |
| APNs `.p8` key | A secret binding filled from nvault, e.g. `APNS_KEY_P8`      |
| APNs key id    | `APNS_KEY_ID`                                                |
| Apple team id  | `APNS_TEAM_ID`                                               |
| Resend API key | `RESEND_API_KEY`, the name narduk-auth's sender already uses |

The library takes the key's **contents**. A value that looks like a file path
(`/…`, `./…`, `~/…`, `*.p8`) is refused with `invalid_credentials`, so a `.p8`
on disk can never become the source. In a Worker, bind the secret. In Node, run
under `nvault run -- <command>`. Keys stored with escaped `\n` or as a bare
base64 body are accepted. The APNs key is a team-wide Apple key. Minting one
goes through the approvals route; this package never mints it.

## APNs

```ts
import {
  createApnsClient,
  createFetchApnsTransport,
} from '@narduk-enterprises/narduk-notify'
import { createNodeHttp2Transport } from '@narduk-enterprises/narduk-notify/node'

const transport = createNodeHttp2Transport() // Node; call transport.close() when done
const apns = createApnsClient({
  bundleId: 'at.mybo.app',
  environment: 'production', // TestFlight and App Store tokens are production
  credentials: {
    teamId: env.APNS_TEAM_ID,
    keyId: env.APNS_KEY_ID,
    privateKey: env.APNS_KEY_P8,
  },
  transport: transport.send,
})

await apns.send(
  {
    pushType: 'alert',
    alert: { title: 'Shore power lost', body: 'Tideye is on inverter' },
  },
  { deviceToken },
)

// Live Activity: the token is the activity's push token, not the device token.
await apns.send(
  {
    pushType: 'liveactivity',
    event: 'update',
    contentState: { distanceMeters: 42 },
  },
  { deviceToken: activityPushToken },
)
```

- **Provider token.** ES256 with a `kid` header and `iss`/`iat` claims, signed
  once and reused for 40 minutes. Apple rejects tokens over an hour old and
  throttles refreshes faster than every 20 minutes. On `ExpiredProviderToken`
  the client re-signs and retries once, with the same `apns-id`.
- **Push types.** `alert` (priority 10), `background` (`content-available`,
  priority 5 only), and `liveactivity`. A Live Activity uses topic
  `<bundleId>.push-type.liveactivity`, always carries `timestamp` and `event`
  (`update`, `end`, or `start` for push-to-start with `attributes-type` and
  `attributes`), and runs at priority 5 unless it carries an alert, which raises
  it to 10. Apple budgets priority-10 Live Activity updates, so keep routine
  updates at 5.
- **Limits.** Payloads over 4096 bytes, malformed tokens (64–200 hex digits),
  `collapseId` over 64 bytes and invalid priorities throw `NotifyError` before
  any request.
- **Results, not throws.** `send` resolves to
  `{ ok, status, apnsId, reason, retryable, tokenInvalid }`. `tokenInvalid` is
  true only for `410 Unregistered`: drop that token. `BadDeviceToken` and
  `DeviceTokenNotForTopic` stay in `reason` and do not set it, because a sandbox
  token sent to production, or a wrong bundle id, produces them for every valid
  token. `retryable` covers `429`, `5xx` and transport errors, including a
  stream reset before any response.
- **`buildApnsRequest`** returns the exact request (URL, lowercase headers,
  body) without sending it, for fixtures and custom transports. `origin`
  overrides Apple's host for a local fixture or an egress proxy.

### Transport

APNs accepts **HTTP/2 only**. In Node, use `createNodeHttp2Transport`. It holds
one session per origin, as Apple recommends, and replaces it after close, GOAWAY
or a request timeout (a silent peer is treated as half-open). `timeoutMs` is an
idle timeout per request. Node's global `fetch` does not negotiate HTTP/2 by
default. `createFetchApnsTransport(fetch)` adapts any `fetch` that does.

## Web Push

Standards Web Push for Home Screen web apps on iPhone and iPad (iOS and iPadOS
16.4+), Safari, Chrome and Firefox on Mac, and any other browser. VAPID
(RFC 8292) authenticates the sender and the payload is encrypted with
`aes128gcm` (RFC 8291). Web Crypto only: no `web-push` package, no Node-only
API.

```ts
import {
  generateVapidKeys,
  sendWebPush,
  type WebPushSubscription,
} from '@narduk-enterprises/narduk-notify'

// Once, offline. Keep privateKey in a secret binding; ship publicKey to the client.
const keys = await generateVapidKeys() // { publicKey, privateKey }, both base64url

// In the browser: registration.pushManager.subscribe({
//   userVisibleOnly: true,
//   applicationServerKey: publicKey,
// }), then store subscription.toJSON() server-side.
const subscription: WebPushSubscription = {
  endpoint: 'https://web.push.apple.com/…',
  keys: { p256dh: '…', auth: '…' },
}

const result = await sendWebPush(
  subscription,
  {
    payload: JSON.stringify({
      title: 'Booster bundle in stock',
      url: '/drops/42',
    }),
    ttlSeconds: 3600, // required: how long the push service may hold it
    urgency: 'high', // optional: very-low | low | normal | high
    topic: 'drop-42', // optional: replaces a queued message with the same topic
  },
  {
    subject: 'mailto:ops@example.com', // or an https: URL
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  },
)
```

- **Results, not throws.** `sendWebPush` resolves to
  `{ ok: true, status, location }` or
  `{ ok: false, status, reason, retryAfterSeconds }`. It throws `NotifyError`
  only for caller mistakes: a bad TTL, topic or urgency, a malformed
  subscription key, or a malformed VAPID key or subject.
- **Result handling.**
  - `gone` (404, 410): the subscription is dead. **Delete it.**
  - `rate_limited` (429) and `server_error` (5xx): retry after
    `retryAfterSeconds` (from `Retry-After`, seconds or an HTTP date; `null`
    when absent).
  - `unauthorized` (401, 403): the VAPID key or subject was refused. Check the
    key pair, and that the subscription was created with this public key as its
    `applicationServerKey`.
  - `payload_too_large`: over 3993 bytes of plaintext (a push service takes at
    most 4096 bytes of body), or a 413. Nothing is sent for the local check.
  - `bad_request` (400 and any other unexpected status, including a redirect,
    which is never followed), `network_error` (fetch threw, `status` is `null`).
  - `endpoint_not_allowed`: refused locally; see below.
- **Endpoint allowlist.** A subscription endpoint comes from a client, so
  `sendWebPush` refuses, without a request, any endpoint that is not `https:`,
  has a port or credentials, is an IP literal, or whose host is not on the list.
  `DEFAULT_WEB_PUSH_HOSTS` holds `fcm.googleapis.com`,
  `updates.push.services.mozilla.com`, `web.push.apple.com`,
  `*.notify.windows.com` and `*.push.apple.com`. An entry is an exact host or
  `*.` plus a suffix (which matches subdomains, not the bare domain). Pass
  `allowedHosts` to replace the list. `isAllowedPushEndpoint` checks a
  subscription at save time with the same rules.
- **VAPID token.** ES256 JWT with `aud` (the endpoint's origin), `exp` (12 hours
  out; RFC 8292 caps it at 24) and `sub`, sent as
  `Authorization: vapid t=<jwt>, k=<public key>`. It is signed once per origin
  and reused until an hour before it expires. `createVapidAuthorization` builds
  the header on its own.
- **Encryption.** `encryptWebPushPayload` returns the RFC 8188 header and one
  record, with a fresh salt and sender key per message. No padding is added. An
  empty `payload` sends a bare wake-up (`Content-Length: 0`, no
  `Content-Encoding`); your service worker then fetches what to show.
- **iOS and iPadOS.** Push works only for a web app **added to the Home Screen**
  (with a web app manifest, `display: standalone`), and
  `Notification.requestPermission()` must run from a user gesture inside that
  installed app. Safari tabs on iOS cannot subscribe. Every push must show a
  notification (`userVisibleOnly: true`); Apple revokes a subscription that
  pushes silently.

## Email (Resend)

```ts
import { createResendClient } from '@narduk-enterprises/narduk-notify'

const resend = createResendClient({ apiKey: env.RESEND_API_KEY })
const result = await resend.send({
  from: 'MyBoat <alerts@mybo.at>',
  to: 'owner@example.com',
  subject: 'Shore power lost',
  text: 'Tideye switched to inverter at 14:02.',
  idempotencyKey: `alert-${alertId}`, // Resend drops a repeat within 24 h
})
// { ok, status, id, reason, retryable }
```

Input errors throw `NotifyError('invalid_email')`. A provider rejection or a
network failure is a result. The API key never appears in a result.

## Preferences

The app declares its categories. A row is stored only where a user changed a
default.

```ts
const categories = {
  'anchor-alarm': {
    defaults: { push: true, email: true },
    mandatory: ['push'],
  },
  'shore-power': { defaults: { push: true, email: false } },
} as const

const preferences = createNotifyPreferences({ db: env.DB, categories })
await preferences.set({
  userId,
  category: 'shore-power',
  channel: 'email',
  enabled: true,
})
await preferences.get(userId) // every category × channel with source: default | user | mandatory
```

Turning off a `mandatory` channel throws `mandatory_channel`. An unknown
category throws `unknown_category`. `get` is one query.

## Notifier and audit

```ts
const notifier = createNotifier({
  db: env.DB,
  categories,
  apns,
  email: { client: resend, from: 'MyBoat <alerts@mybo.at>' },
})

const { deliveries, auditError, preferencesError } = await notifier.send({
  userId,
  category: 'anchor-alarm',
  push: {
    notification,
    targets: [
      { deviceToken },
      { deviceToken: other, environment: 'development' },
    ],
  },
  email: { to: ownerEmail, subject: 'Anchor alarm', text: '…' },
})
```

One preference read, every allowed target sent in parallel, then **every**
attempt written to `notify_deliveries` in one D1 batch. That covers `sent`,
`failed`, `suppressed` (`preference_off`) and `skipped`
(`channel_not_configured`). A malformed target fails its own row and does not
fail the event. If the audit batch fails, the sends still happened and
`auditError` says so. If the preference read fails, the event still goes out on
the category's defaults and mandatory channels, and `preferencesError` says so.
An alarm never waits on D1.

Audit rows hold a SHA-256 `target_ref` of the token or the lowercased address,
never the value. One email is one row, and its ref covers the `to` list joined.
Rows also record the provider id (`apns-id` or Resend id), the status code, the
reason and `token_invalid`. `listDeliveries` pages a user's rows newest first by
index. To page back, pass the previous page's last row as `before`. The cursor
is `(createdAt, id)` because all rows of one event share a timestamp.
`pruneDeliveries({ olderThan, limit })` deletes in bounded chunks; the retention
window is the app's choice.

## Migrations

`migrations/0001_notify.sql` creates `notify_preferences` and
`notify_deliveries`. It is expand-only, so apply it with the app's D1 migration
runner in its deploy pipeline.

## Proof

- `tests/apns-token.test.ts` signs with a P-256 key generated in the test and
  verifies the JWT the way APNs does.
- `tests/fixture-apns-server.test.ts` is a fixture app sending an alert and a
  Live Activity update over real HTTP/2 to a local APNs fixture. The fixture
  checks the provider token, path, topic, push type, priority, size and `aps`
  shape.
- `tests/store.test.ts` runs preferences, audit and the notifier against the
  real D1 driver (miniflare), including the index plan for the audit read.
- On 2026-10-23, the built package sent both push types to
  `api.sandbox.push.apple.com` with a throwaway key. APNs answered
  `403 InvalidProviderToken` with an `apns-id` for each, which means it parsed
  the HTTP/2 request and rejected only the unknown key.
- `scripts/send-test-push.mjs` sends one real push to a device:

  ```bash
  pnpm --filter @narduk-enterprises/narduk-notify run build
  nvault run -- node packages/modules/narduk-notify/scripts/send-test-push.mjs \
    --bundle <bundle id> --token <hex token> --type alert --env production
  ```

## Open items

- **Workers to APNs.** Whether a Cloudflare Worker's outbound `fetch` reaches
  APNs over HTTP/2 has not been measured. Until it has, a Worker can send
  through a Node or container sender using `./node`. The probe is
  `createFetchApnsTransport()` from a deployed Worker against the sandbox host.
  `403 InvalidProviderToken` means HTTP/2 works. A protocol error means it does
  not.
- **No real device push yet.** That needs the team APNs key in nvault and a
  device token from the app.
- **Push-token registry.** The caller passes tokens. Storing device and activity
  tokens per user is left to the app until a second product needs it.
