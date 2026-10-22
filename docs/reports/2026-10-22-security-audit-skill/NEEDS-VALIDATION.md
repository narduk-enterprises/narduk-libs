# Needs validation

Source commit `212392aa61537e5fd7ccce842e5a17f2e832e3d6`. Profile `deep`,
partial. Local execution blocked. These leads have no severity. They are not
confirmed vulnerabilities. Do not send traffic at a deployment to resolve them.

Open leads: 2.

## Layer session Secure flag follows the request protocol header

Fingerprint: `narduk-core.session.secure-follows-request-protocol`

setLayerUserSession, replaceLayerUserSession, clearLayerUserSession, and
getLayerUserSession pass resolveSessionConfig to h3 useSession, which seals the
layer session and sets its cookie. resolveSessionConfig sets cookie.secure only
when getRequestProtocol(event) returns https, and sets sameSite to lax. That
object does not set httpOnly. Locked h3 1.15.11 spreads a default cookie of path
/, secure true, and httpOnly true, then overlays this config, so the protocol
bit replaces the default Secure flag while HttpOnly remains unless a caller
override removes it. That HttpOnly default is calibration, not a second defect.
createSession writes a different cookie and sets httpOnly plus secure from a
localhost or 127.0.0.1 Host prefix; it does not close this flag. A caller cookie
override can force secure false, but that caller is the app, the same principal
as the helper. Locked h3 returns https when x-forwarded-proto is exactly the
string https, and otherwise only when node.req.connection.encrypted is truthy. A
header of http does not by itself force http on an encrypted socket. The
unit-test stub uses an empty connection, so a missing header yields secure false
and an exact https header yields secure true. The helper does not read Host. On
the Nitro Cloudflare handlers locked in this workspace, node-mock-http 1.0.4
sets connection.encrypted only when its protocol option is exactly https, while
those handlers pass URL.protocol (https: or http:). That comparison fails, so
the socket bit stays unset and an exact https header is the only input that
makes the flag true. Whether the deployed edge replaces X-Forwarded-Proto with
the scheme it terminated is not in this repository. This session did not mint a
cookie.

Claimed root cause:

cookie.secure is bound to getRequestProtocol(event) === 'https'. On the
unencrypted stub the in-repo test builds, x-forwarded-proto of exactly https
selects secure true and its absence selects secure false. Locked h3 does not
treat any other header value as https, and the locked Nitro Cloudflare adapter
does not mark the socket encrypted from URL.protocol.

Trace:

- `entrypoint`
  `packages/modules/narduk-core/runtime/server/utils/user-session.ts:163` (layer
  session write). setLayerUserSession takes the request event and writes the
  layer session. The untrusted input is the event protocol, not the session
  data. getLayerUserSession at line 160 uses the same config and can mint a
  cookie when the request has none.
- `propagation`
  `packages/modules/narduk-core/runtime/server/utils/user-session.ts:66` (cookie
  flags). secure is true only when getRequestProtocol(event) returns https.
  sameSite is lax. This object does not set httpOnly. A caller cookie override
  spread after secure can replace it.
- `sink` `packages/modules/narduk-core/runtime/server/utils/user-session.ts:168`
  (h3 useSession). useSession receives that config. h3's default cookie sets
  httpOnly and secure true, then this config's secure value replaces the
  default, so the Set-Cookie Secure option is the protocol-derived boolean.

Evidence:

- `packages/modules/narduk-core/runtime/server/utils/user-session.ts:66`. The
  Secure flag is the equality of getRequestProtocol(event) with https. Host is
  not consulted.
- `packages/modules/narduk-core/tests/user-session.test.ts:95`. A stub whose
  headers are only host 127.0.0.1:3011, with an empty connection, expects secure
  false. The assertion does not show a Host special case.
- `packages/modules/narduk-core/tests/user-session.test.ts:101`. The test named
  for HTTPS behind Cloudflare expects secure true when x-forwarded-proto is
  https. It does not cover a missing or non-https header on a public host.
- `packages/modules/narduk-core/runtime/server/utils/auth.ts:164`. createSession
  sets secure from a localhost or 127.0.0.1 Host prefix and sets httpOnly on the
  previous line. That is a different cookie.
- `node_modules/.pnpm/h3@1.15.11/node_modules/h3/dist/index.mjs:320`.
  getRequestProtocol returns https only when x-forwarded-proto is exactly https,
  otherwise only when connection.encrypted is truthy.
- `node_modules/.pnpm/h3@1.15.11/node_modules/h3/dist/index.mjs:1427`.
  useSession passes setCookie a default of secure true and httpOnly true, then
  overlays config.cookie, so the protocol bit replaces Secure and HttpOnly
  remains.
- `node_modules/.pnpm/node-mock-http@1.0.4/node_modules/node-mock-http/dist/index.mjs:1`.
  callNodeRequestHandler sets connection.encrypted from an existing bit or
  protocol === 'https'. The mock socket does not start encrypted.
- `node_modules/.pnpm/nitropack@2.13.4_better-sqlite3@12.11.1_drizzle-orm@0.45.2_@cloudflare+workers-types@4._206b69838a909de6c9d0970648a8f2cd/node_modules/nitropack/dist/presets/cloudflare/runtime/_module-handler.mjs:107`.
  The Cloudflare module handler passes protocol: url.protocol into localFetch.
  URL.protocol includes the colon, so it does not satisfy the mock's exact https
  check. The legacy worker handler passes the same field.

Blockers:

- No bounded observation of a Set-Cookie was made. Local execution cannot
  provide an OS sandbox that denies external network, starts from an empty
  allowlisted environment, mounts the target read-only, and enforces CPU,
  memory, process, file, disk, and wall-clock limits.
- Whether the deployed edge replaces X-Forwarded-Proto with the scheme it
  terminated, before the Worker reads it, is not in this repository. On the
  locked adapter a value other than exactly https leaves Secure false because
  the socket bit is not set from URL.protocol.

Bounded local check:

Offline, call resolveSessionConfig with the existing unencrypted stub and with
in-process fixtures that set connection.encrypted true or leave it unset, and
set x-forwarded-proto to absent, http, or https. Record cookie.secure.
Separately, compare the locked node-mock-http protocol check with the Cloudflare
handler's protocol argument and record whether a URL protocol of https: sets
connection.encrypted. Do not send traffic.

Owner observation:

The owner inspects an already-accepted Worker request that writes a session, or
the route's platform header policy, and records whether X-Forwarded-Proto equals
the scheme the edge terminated. Do not send a new or modified request.

## Validated URL fetch skips IP pinning outside Node

Fingerprint: `narduk-core.ssrf.unpinned-non-node-fetch`

fetchWithValidatedRedirects, also exported as fetchUrlSafely, is the helper this
file documents as the SSRF-protected outbound fetch. No production or test
caller in this repository passes a URL into it. After validateUrl accepts the
URL, resolveAndAssertPublicHost must accept a public address before any dial,
except the test-mode localhost skip. On that public path createPinnedDispatcher
returns undefined when process.versions.node is not a string. Undefined is not
the unavailable result, so the fetch is not refused. The call uses the
normalized hostname URL and omits dispatcher. The 429 fallback fetch reuses that
same optional dispatcher. An empty address list also returns undefined, but only
because validation was skipped, which on this path is the test-mode localhost
bypass. Private-literal checks, the pre-fetch DNS classification, and manual
redirect revalidation still run. None of them binds the later dial to an address
already accepted. The comment that non-Node platform fetch has no rebinding
window is not a control.

Claimed root cause:

IP pinning is omitted whenever isNodeRuntime is false, including after a public
address was accepted, and the following fetch uses the hostname. An undefined
pin result is not the fail-closed unavailable result. The comment that platform
fetch has no rebinding window is not an in-repo control.

Trace:

- `entrypoint`
  `packages/modules/narduk-core/runtime/server/utils/urlValidator.ts:541`
  (validated fetch). fetchWithValidatedRedirects accepts a URL string and is the
  exported SSRF fetch. fetchUrlSafely aliases it. No route in this repository
  calls either name.
- `propagation`
  `packages/modules/narduk-core/runtime/server/utils/urlValidator.ts:603` (dns
  check). resolveAndAssertPublicHost must accept the hostname before any dial,
  except the test-mode localhost bypass that leaves the address list empty.
- `propagation`
  `packages/modules/narduk-core/runtime/server/utils/urlValidator.ts:231` (pin
  gate). createPinnedDispatcher returns undefined when isNodeRuntime is false,
  even if the address list is non-empty. That skips the pinned lookup and is not
  the unavailable result.
- `sink` `packages/modules/narduk-core/runtime/server/utils/urlValidator.ts:699`
  (outbound fetch). fetch is called with the normalized hostname URL. A
  dispatcher is added only when one was built. A skipped pin sends no
  dispatcher.

Evidence:

- `packages/modules/narduk-core/runtime/server/utils/urlValidator.ts:27`. The
  file requires the nodejs_compat flag before the DNS and fetch helpers can
  bundle on Workers.
- `packages/modules/narduk-core/runtime/server/utils/urlValidator.ts:203`.
  isNodeRuntime is true only when process.versions.node is a string. The
  adjacent comment says Workers do not expose it.
- `packages/modules/narduk-core/runtime/server/utils/urlValidator.ts:229`. An
  empty address list returns undefined before the runtime check. That is the
  intentional test-mode skip, distinct from the non-Node return.
- `packages/modules/narduk-core/runtime/server/utils/urlValidator.ts:684`. The
  fetch is refused only when pin construction returns unavailable. An undefined
  pin result is not refused.
- `packages/modules/narduk-core/runtime/server/utils/urlValidator.ts:703`. The
  fetch call comments that a dispatcher is undici-specific and that other
  runtimes ignore the unknown key.
- `packages/modules/narduk-core/runtime/server/utils/urlValidator.ts:804`. The
  429 fallback fetch uses the same normalized URL and the same optional
  dispatcher, so a skipped pin is skipped there too.
- `packages/modules/narduk-core/package.json:79`. The package maps ./server/*
  onto ./runtime/server/*.ts. The helper sits in that published server tree and
  is a named export.

Blockers:

- No production or test caller in this repository passes a URL into
  fetchWithValidatedRedirects or fetchUrlSafely. A cross-principal effect
  requires an app outside this repository to supply an attacker-influenced URL.
- Whether nodejs_compat sets process.versions.node is not in this repository. If
  it does, the UndiciAgent branch runs; a throw there fails closed, and a
  constructed dispatcher is still subject to the comment that non-Node fetch
  ignores it. Neither outcome is proven here.
- Whether workerd re-resolves the hostname after resolveAndAssertPublicHost, or
  dials only addresses the platform already treats as public, is not in this
  repository. The log line claiming no rebinding window is a comment, not a
  control.
- Local execution is blocked. This session has no OS sandbox that denies
  external network, starts from an empty allowlisted environment, mounts the
  target and toolchain read-only, confines writes to scratch, and enforces
  explicit CPU, memory, process, file, disk, and wall-clock limits. A stubbed
  fetch would show only the URL and dispatcher arguments, not a platform dial.

Bounded local check:

Offline source check, with no network I/O: when process.versions.node is not a
string and the address list is non-empty, createPinnedDispatcher returns
undefined, and fetchWithValidatedRedirects does not take the unavailable branch
before calling fetch with the normalized URL and no dispatcher. A fixture may
replace the DNS resolver and global fetch with in-process recorders that perform
no I/O and use one public fixture address. The source-level gap holds if the
helper does not return the SSRF_BLOCKED error and the recorder receives the
original URL with no dispatcher. That fixture does not observe a platform dial.

Owner observation:

Owner records the deployed worker compatibility_flags, whether nodejs_compat
makes process.versions.node a string in that workerd, and the workerd fetch DNS
contract for that flag: whether the dial is bound to addresses the isolate
already resolved or the hostname is resolved again at connect time. Do not issue
a fetch from production.
