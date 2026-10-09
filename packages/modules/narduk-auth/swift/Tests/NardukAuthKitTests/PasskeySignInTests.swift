import Foundation
import NardukAuthKit
import Testing

private let instant = Date(timeIntervalSince1970: 2_000_000_000)
private let accessToken = String(repeating: "a", count: 43)
private let refreshToken = String(repeating: "b", count: 43)
private let challengeBytes = Data([0xfb, 0xff, 0x00, 0x10, 0x20, 0x7e, 0x3f, 0xfe])
private let credentialBytes = Data([0x01, 0x02, 0xfb, 0xff])

private func b64url(_ data: Data) -> String {
  data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}

private func config() throws -> AuthConfiguration {
  try AuthConfiguration(
    serverURL: URL(string: "https://ops.example.com")!, clientID: "mac-test",
    redirectURI: URL(string: "com.example.test:/callback")!)
}

private final class MemoryStore: CredentialStore, @unchecked Sendable {
  private let lock = NSLock()
  private var value: AuthCredentials?
  func read() -> AuthCredentials? { lock.withLock { value } }
  func write(_ credentials: AuthCredentials) { lock.withLock { value = credentials } }
  func remove() { lock.withLock { value = nil } }
}

/// Records what the client asks of the authenticator and answers with a fixed result.
private actor FakeProvider: PasskeyAssertionProvider {
  private(set) var asked: [(relyingPartyID: String, challenge: Data)] = []
  private let outcome: Result<PasskeyAssertion, PasskeySignInError>
  init(_ outcome: Result<PasskeyAssertion, PasskeySignInError> = .success(FakeProvider.signed)) {
    self.outcome = outcome
  }
  static let signed = PasskeyAssertion(
    credentialID: credentialBytes, clientDataJSON: Data(#"{"type":"webauthn.get"}"#.utf8),
    authenticatorData: Data([9, 8, 7]), signature: Data([6, 5, 4]), userHandle: Data("user-1".utf8))
  func assertion(relyingPartyID: String, challenge: Data) async throws -> PasskeyAssertion {
    asked.append((relyingPartyID, challenge))
    return try outcome.get()
  }
}

/// Serves options, verify, authorize and token for a passkey sign-in.
private actor PasskeyTransport: AuthTransport {
  var requests: [URLRequest] = []
  private let optionsStatus: Int
  private let verifyStatus: Int
  private let rpID: String
  init(optionsStatus: Int = 200, verifyStatus: Int = 200, rpID: String = "example.com") {
    self.optionsStatus = optionsStatus
    self.verifyStatus = verifyStatus
    self.rpID = rpID
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    switch request.url!.path {
    case "/api/auth/passkeys/authentication/options":
      guard optionsStatus == 200 else {
        return (message("not enabled"), reply(request, optionsStatus))
      }
      let body = [
        "challenge": b64url(challengeBytes), "rpId": rpID, "userVerification": "required",
      ]
      return (try JSONSerialization.data(withJSONObject: body), reply(request, 200))
    case "/api/auth/passkeys/authentication/verify":
      guard verifyStatus == 200 else {
        return (message("Passkey sign-in failed."), reply(request, verifyStatus))
      }
      let cookie = ["Set-Cookie": "nuxt-session=passkey; Path=/; HttpOnly"]
      return (Data(#"{"user":{"id":"u"}}"#.utf8), reply(request, 200, cookie))
    case "/api/auth/native/authorize":
      let body = try JSONDecoder().decode([String: String].self, from: request.httpBody!)
      let redirect =
        "com.example.test:/callback?code=\(String(repeating: "d", count: 43))&state=\(body["state"]!)"
      return (
        try JSONSerialization.data(withJSONObject: ["redirectTo": redirect]), reply(request, 200)
      )
    default:
      let body: [String: Any] = [
        "accessToken": accessToken, "refreshToken": refreshToken, "sessionId": "session",
        "tokenType": "Bearer", "expiresIn": 300,
        "refreshExpiresAt": instant.addingTimeInterval(86400).timeIntervalSince1970,
      ]
      return (try JSONSerialization.data(withJSONObject: body), reply(request, 200))
    }
  }

  private func message(_ text: String) -> Data { Data(#"{"statusMessage":"\#(text)"}"#.utf8) }
  private func reply(
    _ request: URLRequest, _ status: Int, _ headers: [String: String] = [:]
  ) -> HTTPURLResponse {
    HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!
  }
}

@Suite("Passkey sign-in")
struct PasskeySignInTests {
  private func client(_ transport: PasskeyTransport, _ store: MemoryStore) throws
    -> NardukAuthClient
  {
    NardukAuthClient(
      configuration: try config(), store: store, transport: transport, clock: { instant })
  }

  @Test func runsOptionsAssertVerifyAuthorizeTokenAndKeepsTheCookieToOneRequest() async throws {
    let transport = PasskeyTransport()
    let store = MemoryStore()
    let provider = FakeProvider()
    try await client(transport, store).signIn(using: provider)

    // The authenticator is asked for the server's RP ID and the exact challenge bytes.
    let asked = try #require(await provider.asked.first)
    #expect(asked.relyingPartyID == "example.com")
    #expect(asked.challenge == challengeBytes)

    let sent = await transport.requests
    #expect(
      sent.map { $0.url!.path } == [
        "/api/auth/passkeys/authentication/options", "/api/auth/passkeys/authentication/verify",
        "/api/auth/native/authorize", "/api/auth/native/token",
      ])
    for request in sent {
      #expect(request.value(forHTTPHeaderField: "X-Requested-With") == "XMLHttpRequest")
    }
    // Same-origin proof on every leg that browsers send it on, as password sign-in does.
    for request in sent.prefix(3) {
      #expect(request.value(forHTTPHeaderField: "Origin") == "https://ops.example.com")
    }

    // The assertion reaches verify in the shape the server's schema demands.
    let verify = try #require(
      JSONSerialization.jsonObject(with: sent[1].httpBody!) as? [String: Any])
    let credential = try #require(verify["response"] as? [String: Any])
    #expect(credential["id"] as? String == b64url(credentialBytes))
    #expect(credential["rawId"] as? String == b64url(credentialBytes))
    #expect(credential["type"] as? String == "public-key")
    let inner = try #require(credential["response"] as? [String: String])
    #expect(inner["authenticatorData"] == b64url(Data([9, 8, 7])))
    #expect(inner["signature"] == b64url(Data([6, 5, 4])))
    #expect(inner["userHandle"] == b64url(Data("user-1".utf8)))
    #expect(inner["clientDataJSON"] == b64url(Data(#"{"type":"webauthn.get"}"#.utf8)))

    // The web session cookie goes to authorize only: never options, verify or token.
    #expect(sent[0].value(forHTTPHeaderField: "Cookie") == nil)
    #expect(sent[1].value(forHTTPHeaderField: "Cookie") == nil)
    #expect(sent[2].value(forHTTPHeaderField: "Cookie") == "nuxt-session=passkey")
    #expect(sent[3].value(forHTTPHeaderField: "Cookie") == nil)

    #expect(store.read()?.refreshToken == refreshToken)
    #expect(try await client(transport, store).hasCredentials())
  }

  @Test func omitsAnEmptyUserHandle() async throws {
    let provider = FakeProvider(
      .success(
        PasskeyAssertion(
          credentialID: credentialBytes, clientDataJSON: Data([1]), authenticatorData: Data([2]),
          signature: Data([3]), userHandle: Data())))
    let transport = PasskeyTransport()
    try await client(transport, MemoryStore()).signIn(using: provider)
    let verify = try #require(
      JSONSerialization.jsonObject(with: await transport.requests[1].httpBody!) as? [String: Any])
    let inner = try #require(
      (verify["response"] as? [String: Any])?["response"] as? [String: String])
    #expect(inner["userHandle"] == nil)
  }

  @Test func cancellationSendsNothingMoreAndStoresNothing() async throws {
    let transport = PasskeyTransport()
    let store = MemoryStore()
    await #expect(throws: PasskeySignInError.cancelled) {
      try await client(transport, store).signIn(using: FakeProvider(.failure(.cancelled)))
    }
    #expect(
      await transport.requests.map { $0.url!.path } == [
        "/api/auth/passkeys/authentication/options"
      ])
    #expect(store.read() == nil)
  }

  @Test func noCredentialIsTypedForPasswordFallback() async throws {
    let transport = PasskeyTransport()
    await #expect(throws: PasskeySignInError.noCredential) {
      try await client(transport, MemoryStore()).signIn(
        using: FakeProvider(.failure(.noCredential)))
    }
    #expect(await transport.requests.count == 1)
  }

  @Test func serverRefusalStopsBeforeAuthorize() async throws {
    let transport = PasskeyTransport(verifyStatus: 401)
    let store = MemoryStore()
    await #expect(throws: PasskeySignInError.refused) {
      try await client(transport, store).signIn(using: FakeProvider())
    }
    let paths = await transport.requests.map { $0.url!.path }
    #expect(paths.last == "/api/auth/passkeys/authentication/verify")
    #expect(!paths.contains("/api/auth/native/authorize"))
    #expect(store.read() == nil)
  }

  @Test func passkeysNotEnabledIsTypedAndNeverReachesTheAuthenticator() async throws {
    let transport = PasskeyTransport(optionsStatus: 501)
    let provider = FakeProvider()
    await #expect(throws: PasskeySignInError.unavailable) {
      try await client(transport, MemoryStore()).signIn(using: provider)
    }
    #expect(await provider.asked.isEmpty)
  }

  @Test func refusesARelyingPartyThatIsNotTheServersOwnDomain() async throws {
    let transport = PasskeyTransport(rpID: "attacker.example")
    let provider = FakeProvider()
    await #expect(throws: AuthError.invalidResponse) {
      try await client(transport, MemoryStore()).signIn(using: provider)
    }
    #expect(await provider.asked.isEmpty)
  }

  @Test func acceptsTheServersExactHostAsRelyingParty() async throws {
    let transport = PasskeyTransport(rpID: "ops.example.com")
    let provider = FakeProvider()
    try await client(transport, MemoryStore()).signIn(using: provider)
    #expect(await provider.asked.first?.relyingPartyID == "ops.example.com")
  }

  @Test func typedErrorsDescribeThemselvesForTheSignInForm() {
    for error in [
      PasskeySignInError.cancelled, .noCredential, .unavailable, .refused, .failed(code: 1004),
    ] {
      #expect(!(error.errorDescription ?? "").isEmpty)
    }
  }
}
