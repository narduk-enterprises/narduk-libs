# NardukAuthKit

Moved from narduk-enterprises/narduk-auth-kit at
`a65296ff8e7cf5a1afafa6b534c88919139fc6bb`, 2026-09-24. Sources and tests are
that commit (tag `0.2.1`) unchanged, imported without history; the standalone
repository keeps the `0.1.0`–`0.2.1` tags.

A Swift 6 client for `narduk-auth`'s opt-in native authentication flow. It is
the Apple client half of the native PKCE flow that
[`@narduk-enterprises/narduk-auth`](../README.md) serves. Narduk NVR is the
first consumer; any NE Apple client using local `narduk-auth` can use the same
sign-in and credential lifecycle. Sign-in is fully in-app: no browser, no web
view.

Supports macOS 15+ and iOS 18+, the floor of this repository's shared SwiftPM
manifest (the standalone package supported macOS 14 and iOS 17). The server must
enable a client with an exact redirect URI in `authNativeClients` and apply the
shipped authentication migrations. The initial contract supports the local
authentication backend.

```swift
.package(url: "https://github.com/narduk-enterprises/narduk-libs", exact: "0.2.0")
```

Add `.product(name: "NardukAuthKit", package: "narduk-libs")` to the target's
dependencies. The repository is public, so resolving it needs no credential. The
manifest also declares `NardukLogging`, so a consumer's `Package.resolved`
records `swift-log`; nothing from it is linked unless the consumer selects
`NardukLogging`. Then collect an email and password in the app's own UI and hand
them to the client:

```swift
let configuration = try AuthConfiguration(
    serverURL: URL(string: "https://nvr.nardukenterprises.com")!,
    clientID: "narduk-nvr-macos",
    redirectURI: URL(string: "com.narduk.nvr:/auth/callback")!
)
let client = NardukAuthClient(configuration: configuration)
try await client.signIn(email: email, password: password)
let token = try await client.accessToken()
// Attach token as Authorization: Bearer to the configured service's API.
try await client.signOut()
```

`signIn(email:password:)` runs the whole PKCE handshake over three JSON requests
— `/api/auth/login`, `/api/auth/native/authorize`, `/api/auth/native/token` — so
no browser, web view, or registered URL scheme is involved. The redirect URI is
still required: the server validates the authorization against the client's
registered value, and the code comes back inside the JSON response rather than
through the OS.

The password is sent to the login endpoint and nowhere else; only the PKCE
verifier reaches the token endpoint. The web session cookie the login returns is
attached to the single authorize request and then discarded, because the
transport keeps no cookie jar.

`beginSignIn()` and `completeSignIn(callbackURL:)` remain available for a
consumer that wants to drive the browser-redirect variant itself. This package
no longer ships an `ASWebAuthenticationSession` wrapper.

Use the same `NardukAuthClient` actor across requests. It coalesces concurrent
refreshes and rotates the stored credential once.

Default credential storage is a device-only, non-synchronizing Keychain item
scoped by client ID and server URL, in the file-based keychain. The data
protection keychain is not used: on macOS it requires an application-identifier
or keychain-access-group entitlement that only a provisioning profile grants, so
a Developer ID app gets `errSecMissingEntitlement` (-34018) on every write. iOS
has only the data protection keychain, so the same code is correct there. Web
session cookies and native credentials stay separate. The credential exchange
rejects redirects, requires HTTPS, and only permits explicitly enabled loopback
HTTP for local tests. No API keys or passwords are stored by this package.

A refused sign-in throws `AuthError.rejected(status:message:)` carrying the
service's own short explanation — a wrong password, or a lockout after repeated
failures — so the form can show it verbatim. `statusCode` distinguishes a
refused credential from a service that is merely unavailable.

`accessToken()` refreshes shortly before expiry. A rejected refresh clears the
credential; transient network errors preserve it. Sign-out clears local storage
immediately, waits for an in-flight rotation, and revokes the newest refresh
token. Handle a sign-out error to report incomplete remote revocation. Remote
sessions also have an absolute expiry.

Organization selection, membership checks, and resource permissions belong to
the consumer and its server. A bearer token identifies a session; it does not
grant an organization role.

## Changing it

Generic native authentication lives here; organization and product behavior live
in consumers. Preserve the public-interface test boundary. Do not log tokens or
callback query strings.

## Verification and release

From the repository root, run
`python3 packages/modules/narduk-auth/swift/scripts/swift-quality.py`. It lints
with this directory's `.swift-format` (the imported two-space style) and
`.swiftlint.yml`, runs `swift test --filter NardukAuthKitTests`, builds the
product for an iOS device, and proves a clean SwiftPM consumer resolves a
version tag of an isolated repository fixture. Tests use only the public API
with injected `CredentialStore`, `AuthTransport`, and clock implementations.
They cover the three-leg credential sign-in and the headers and cookie it
depends on, PKCE callback binding and replay, a rejected password, a broken leg
mid-handshake, refresh contention, sign-out during rotation, credential
rejection, transient failure, and secure configuration.

The package needs Security and CryptoKit, so the root `Package.swift` declares
its targets only on an Apple host, and CI runs the script on GitHub-hosted macOS
(`.github/workflows/auth-kit-swift.yml`). The Linux Swift job builds
`NardukLogging` alone.

Repository `vX.Y.Z` tags are the SwiftPM versions of every Swift product here
([`docs/architecture/narduk-logging.md`](../../../../docs/architecture/narduk-logging.md)).
Create one on the exact validated main commit, prove a clean consumer resolves
the remote tag, and publish release notes. Never move an existing tag; consumers
recover by pinning an earlier compatible version or by a fix-forward release.
