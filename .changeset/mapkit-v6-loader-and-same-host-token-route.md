---
'@narduk-enterprises/narduk-mapkit': minor
---

Load MapKit JS through Apple's own `@apple/mapkit-loader`, type the client
against Apple's v6 types, and make the token route same-host and fail-closed
(narduk-libs#421 §d, §e).

**The token never goes to `load()`.** 2.0.x passed the JWT as `load({ token })`,
which lands in `data-token` on the injected script and wires MapKit's static,
non-refreshable path: the map dies when that token expires and nothing re-asks.
2.1.0 calls `load()` with no token at all and delivers it only through
`mapkit.init({ authorizationCallback })`, which is the path MapKit refreshes on
its own (measured: an accessKey good for ~1800 s, renewed without a second
`authorizationCallback` call).

**`libraries` is required.** MapKit JS 6 loads `mapkit.core.js`, a stub with no
map, annotations, or overlays until libraries are named. Making it optional
would only move the failure to the first `new mapkit.Map(...)`, so
`initializeMapKit()` refuses an empty list up front. `loadMapKitLibraries()`,
`MAPKIT_JS_V6_SCRIPT_URL`, and the `scriptUrl` option are gone from the option
surface: Apple's loader owns the script URL and throws on any `5*` version.

**A failure clears the singleton.** Measured against real MapKit on 2026-09-17:
on a rejected token it retried `/ma/bootstrap` three times with the _same_
token, invoked `authorizationCallback` exactly once, and gave up. So the `error`
listener clears the cached initialization on every error — including one that
arrives long after init resolved — and recovery belongs to the caller's
`retry()`. The authorization callback never answers `done('')` on a failed
fetch; an empty token is just a second bootstrap attempt that fails with a less
useful status than the real cause. `MapKitErrorStatus` is Apple's
`ConfigurationErrorStatus` verbatim, pinned to
`MapKitConfigurationErrorEvent['status']` by a compile-time conformance check
rather than restated by hand and left to drift.

**The token route mints for the origin that routed the request, and nothing
else.** `self` comes from the routed request URL — never `Origin`, `Referer`, or
an `X-Forwarded-*` header, any of which a caller controls. A missing `Origin` is
legitimate (a same-origin `GET` from `fetch` sends none), so `Sec-Fetch-Site`
carries the signal and the route fails closed when neither is conclusive. The
`origin` claim is built from `URL.origin`, so it carries scheme, host, and a
non-default port exactly as Apple compares them. `allowedOrigins` and the static
`MAPKIT_TOKEN`/`APPLE_MAPKIT_TOKEN` path are accepted and ignored, reported as
deprecated through the log hook: an allowlist cannot make a token work on a host
Apple itself will reject, and a portal token that works everywhere is one with
no origin restriction at all.

The default JWT TTL drops from 24 hours to 1800 seconds. `exp` bounds the
_minting_ window, not the session — MapKit spends the JWT once at bootstrap and
runs on the accessKey afterwards. `expiresAt` in the route's 200 body is epoch
**milliseconds** (`exp * 1000`), as `MapKitTokenResult` has always documented;
the README said seconds and was wrong.

**A 500 says one constant sentence.** The handler's catch used to put
`error.message` on the wire, so a throwing rate-limit hook sent whatever that
hook had put in its own error — a DSN, a host, an internal path — to the
browser. Diagnostics now reach the app through its `log` hook only. Every
response also carries `X-Content-Type-Options: nosniff`, and `Origin: null` (an
opaque origin, which is by definition not this origin) now refuses instead of
falling through to `Sec-Fetch-Site`.

**New: `mapKitRoutedOrigin`**, and `self` accepts `null`. h3 documents
`getRequestURL().origin` as spoofable, and it is: Node's server accepts an
absolute-form request line (`GET https://evil.example/... HTTP/1.1`), and
`new URL(absolute, base)` ignores the base — so the request line, not the routed
host, named the `origin` claim. `mapKitRoutedOrigin` prefers the routed Fetch
`Request` where the adapter has one (always, on Cloudflare Workers) and answers
`null` for a request target that is not origin-form; `self: null` is refused
with 403 before the limiter and before signing, never guessed at. A forged
`Host:` on an ordinary target remains a Node deployment's own responsibility and
is called out in the README. The `./node` entry now spreads the caller's options
into the handler rather than forwarding three of them by name, so `self` and
`log` stop being silently dropped there.

**`tokenEndpoint` must be relative, and is now checked.** §b.1 always called an
absolute URL a config error; `initializeMapKit` and `fetchMapKitToken` now throw
one instead of making a cross-origin fetch for a token Apple would refuse on
this page anyway.

**The rate-limit hook is part of the handler, not a path-matched middleware.** A
limiter mounted by path is bypassable by URL spelling — a trailing slash,
different case, a doubled slash, an added query string — so the hook is
consulted inside the handler, before any signing work, and the variants are
tested (folded in from the buoys PR #122 F1 review finding).

`@apple/mapkit-loader` moves from a devDependency to a dependency; it is
imported dynamically so the `./server`, `./node`, `./worker`, and `./token`
entry points never reach it.
