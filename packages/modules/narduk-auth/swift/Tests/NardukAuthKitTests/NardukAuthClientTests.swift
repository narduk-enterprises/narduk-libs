import CryptoKit
import Foundation
import NardukAuthKit
import Testing

private let instant = Date(timeIntervalSince1970: 2_000_000_000)
private let access = String(repeating: "a", count: 43)
private let refresh = String(repeating: "b", count: 43)
private let nextRefresh = String(repeating: "c", count: 43)

private func config() throws -> AuthConfiguration {
  try AuthConfiguration(
    serverURL: URL(string: "https://auth.example.com")!, clientID: "mac-test",
    redirectURI: URL(string: "com.example.test:/callback")!)
}
private func challenge(for verifier: String) -> String {
  Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
    .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}
private func stored() -> AuthCredentials {
  AuthCredentials(
    accessToken: access, refreshToken: refresh, sessionID: "session",
    accessExpiresAt: instant.addingTimeInterval(-1),
    refreshExpiresAt: instant.addingTimeInterval(86400))
}

private final class MemoryStore: CredentialStore, @unchecked Sendable {
  private let lock = NSLock()
  private var value: AuthCredentials?
  private var waiters: [CheckedContinuation<Void, Never>] = []
  init(_ value: AuthCredentials? = nil) { self.value = value }
  func read() -> AuthCredentials? { lock.withLock { value } }
  func write(_ credentials: AuthCredentials) { lock.withLock { value = credentials } }
  func remove() {
    let pending = lock.withLock {
      value = nil
      let result = waiters
      waiters = []
      return result
    }
    for continuation in pending { continuation.resume() }
  }
  func waitForRemoval() async {
    await withCheckedContinuation { continuation in
      lock.withLock {
        if value == nil { continuation.resume() } else { waiters.append(continuation) }
      }
    }
  }
}

private actor MockTransport: AuthTransport {
  var requests: [URLRequest] = []
  var status: Int
  let holdsRefresh: Bool
  private var didStart = false
  private var started: CheckedContinuation<Void, Never>?
  private var release: CheckedContinuation<Void, Never>?
  init(status: Int = 200, holdsRefresh: Bool = false) {
    self.status = status
    self.holdsRefresh = holdsRefresh
  }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    if request.url!.path.hasSuffix("/refresh") {
      didStart = true
      started?.resume()
      started = nil
      if holdsRefresh {
        await withCheckedContinuation { release = $0 }
      } else {
        try await Task.sleep(for: .milliseconds(10))
      }
    }
    let body: [String: Any] = [
      "accessToken": access, "refreshToken": nextRefresh, "sessionId": "session",
      "tokenType": "Bearer", "expiresIn": 300,
      "refreshExpiresAt": instant.addingTimeInterval(86400).timeIntervalSince1970,
    ]
    return (
      try JSONSerialization.data(withJSONObject: body),
      HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    )
  }
  func waitForRefresh() async { if !didStart { await withCheckedContinuation { started = $0 } } }
  func finishRefresh() {
    release?.resume()
    release = nil
  }
}

/// Serves the three legs of a credential sign-in: login, authorize, token.
private struct UnwritableStore: CredentialStore {
  func read() throws -> AuthCredentials? { nil }
  func write(_ credentials: AuthCredentials) throws { throw AuthError.keychain(-34018) }
  func remove() throws {}
}

private actor CredentialTransport: AuthTransport {
  var requests: [URLRequest] = []
  private let loginStatus: Int
  private let authorizeStatus: Int
  private let setsCookie: Bool
  private let substitutedState: String?

  init(
    loginStatus: Int = 200, authorizeStatus: Int = 200, setsCookie: Bool = true,
    substitutedState: String? = nil
  ) {
    self.loginStatus = loginStatus
    self.authorizeStatus = authorizeStatus
    self.setsCookie = setsCookie
    self.substitutedState = substitutedState
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    switch request.url!.path {
    case "/api/auth/login":
      guard loginStatus == 200 else {
        return (Self.explanation("Invalid email or password"), reply(request, loginStatus))
      }
      let cookies = setsCookie ? ["Set-Cookie": "nuxt-session=opaque; Path=/; HttpOnly"] : [:]
      return (Data(#"{"nextStep":"signed_in"}"#.utf8), reply(request, 200, cookies))
    case "/api/auth/native/authorize":
      guard authorizeStatus == 200 else {
        return (
          Self.explanation("Sign in before connecting your app."), reply(request, authorizeStatus)
        )
      }
      let body = try JSONDecoder().decode([String: String].self, from: request.httpBody!)
      let redirect =
        "com.example.test:/callback?code=\(String(repeating: "d", count: 43))"
        + "&state=\(substitutedState ?? body["state"]!)"
      return (
        try JSONSerialization.data(withJSONObject: ["redirectTo": redirect]), reply(request, 200)
      )
    default:
      let body: [String: Any] = [
        "accessToken": access, "refreshToken": nextRefresh, "sessionId": "session",
        "tokenType": "Bearer", "expiresIn": 300,
        "refreshExpiresAt": instant.addingTimeInterval(86400).timeIntervalSince1970,
      ]
      return (try JSONSerialization.data(withJSONObject: body), reply(request, 200))
    }
  }

  private func reply(
    _ request: URLRequest, _ status: Int, _ headers: [String: String] = [:]
  ) -> HTTPURLResponse {
    HTTPURLResponse(
      url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!
  }
  private static func explanation(_ message: String) -> Data {
    Data(#"{"error":true,"statusMessage":"\#(message)"}"#.utf8)
  }
}

@Suite("Native authentication client")
struct NardukAuthClientTests {
  @Test func pkceAndCallbackBinding() async throws {
    let transport = MockTransport()
    let store = MemoryStore()
    let client = NardukAuthClient(
      configuration: try config(), store: store, transport: transport, clock: { instant })
    let request = try await client.beginSignIn()
    let query = URLComponents(url: request.authorizationURL, resolvingAgainstBaseURL: false)!
      .queryItems!
    #expect(!query.contains { $0.name == "codeVerifier" })
    #expect(query.first { $0.name == "codeChallengeMethod" }?.value == "S256")
    let state = query.first { $0.name == "state" }!.value!
    let callback = URL(
      string: "com.example.test:/callback?code=\(String(repeating: "d", count: 43))&state=\(state)")!
    try await client.completeSignIn(callbackURL: callback)
    let sent = try #require(await transport.requests.first)
    let body = try #require(JSONSerialization.jsonObject(with: sent.httpBody!) as? [String: String])
    let verifier = try #require(body["codeVerifier"])
    #expect(challenge(for: verifier) == query.first { $0.name == "codeChallenge" }?.value)
    #expect(sent.value(forHTTPHeaderField: "X-Requested-With") == "XMLHttpRequest")
    #expect(store.read()?.refreshToken == nextRefresh)
    #expect(try await client.hasCredentials())
    await #expect(throws: AuthError.invalidCallback) {
      try await client.completeSignIn(callbackURL: callback)
    }
  }

  @Test func rejectsSubstitutedCallbackBeforeSendingCredentials() async throws {
    for callback in [
      "com.attacker:/callback?state=wrong", "com.example.test:/other?state=wrong",
      "com.example.test:/callback?state=wrong",
    ] {
      let transport = MockTransport()
      let client = NardukAuthClient(
        configuration: try config(), store: MemoryStore(), transport: transport, clock: { instant })
      _ = try await client.beginSignIn()
      await #expect(throws: AuthError.invalidCallback) {
        try await client.completeSignIn(callbackURL: URL(string: callback)!)
      }
      #expect(await transport.requests.isEmpty)
    }
  }

  @Test func concurrentRequestsShareOneRefresh() async throws {
    let transport = MockTransport()
    let store = MemoryStore(stored())
    let client = NardukAuthClient(
      configuration: try config(), store: store, transport: transport, clock: { instant })
    let tokens = try await withThrowingTaskGroup(of: String.self) { group in
      for _ in 0..<20 { group.addTask { try await client.accessToken() } }
      var result: [String] = []
      for try await token in group { result.append(token) }
      return result
    }
    #expect(tokens.count == 20)
    #expect(tokens.allSatisfy { $0 == access })
    #expect(await transport.requests.count == 1)
    #expect(store.read()?.refreshToken == nextRefresh)
  }

  @Test func logoutRevokesTheTokenRotatedWhileItWasInFlight() async throws {
    let transport = MockTransport(holdsRefresh: true)
    let store = MemoryStore(stored())
    let client = NardukAuthClient(
      configuration: try config(), store: store, transport: transport, clock: { instant })
    let refreshing = Task { try await client.accessToken() }
    await transport.waitForRefresh()
    let logout = Task { try await client.signOut() }
    await store.waitForRemoval()
    await transport.finishRefresh()
    try await logout.value
    await #expect(throws: AuthError.signedOut) { try await refreshing.value }
    #expect(store.read() == nil)
    #expect(try await !client.hasCredentials())
    let requests = await transport.requests
    #expect(requests.count == 2)
    let body = try #require(
      JSONSerialization.jsonObject(with: requests[1].httpBody!) as? [String: String])
    #expect(body["refreshToken"] == nextRefresh)
    #expect(requests[1].url?.path == "/api/auth/native/revoke")
  }

  @Test func rejectedRefreshClearsCredentialsButServiceFailuresDoNot() async throws {
    for status in [401, 503] {
      let store = MemoryStore(stored())
      let client = NardukAuthClient(
        configuration: try config(), store: store, transport: MockTransport(status: status),
        clock: { instant })
      await #expect(throws: AuthError.server(status)) { try await client.accessToken() }
      #expect((store.read() == nil) == (status == 401))
    }
  }

  @Test func credentialSignInCompletesWithoutABrowser() async throws {
    let transport = CredentialTransport()
    let store = MemoryStore()
    let client = NardukAuthClient(
      configuration: try config(), store: store, transport: transport, clock: { instant })
    try await client.signIn(email: "operator@example.com", password: "correct horse")
    let sent = await transport.requests
    #expect(
      sent.map { $0.url!.path } == [
        "/api/auth/login", "/api/auth/native/authorize", "/api/auth/native/token",
      ])
    #expect(
      sent.allSatisfy { $0.value(forHTTPHeaderField: "X-Requested-With") == "XMLHttpRequest" })

    let login = try #require(
      JSONSerialization.jsonObject(with: sent[0].httpBody!) as? [String: String])
    #expect(login == ["email": "operator@example.com", "password": "correct horse"])

    // Code minting is same-origin and needs the cookie the login leg just returned.
    #expect(sent[1].value(forHTTPHeaderField: "Origin") == "https://auth.example.com")
    #expect(sent[1].value(forHTTPHeaderField: "Cookie") == "nuxt-session=opaque")
    let authorize = try #require(
      JSONSerialization.jsonObject(with: sent[1].httpBody!) as? [String: String])
    #expect(authorize["codeChallengeMethod"] == "S256")
    #expect(authorize["codeVerifier"] == nil)
    #expect(authorize["password"] == nil)

    // The verifier reaches only the token endpoint, and it matches the challenge.
    let exchange = try #require(
      JSONSerialization.jsonObject(with: sent[2].httpBody!) as? [String: String])
    let verifier = try #require(exchange["codeVerifier"])
    #expect(challenge(for: verifier) == authorize["codeChallenge"])
    #expect(store.read()?.refreshToken == nextRefresh)
    #expect(try await client.hasCredentials())
  }

  @Test func rejectedPasswordSurfacesTheServiceExplanation() async throws {
    let transport = CredentialTransport(loginStatus: 401)
    let store = MemoryStore()
    let client = NardukAuthClient(
      configuration: try config(), store: store, transport: transport, clock: { instant })
    await #expect(throws: AuthError.rejected(status: 401, message: "Invalid email or password")) {
      try await client.signIn(email: "operator@example.com", password: "wrong")
    }
    #expect(await transport.requests.count == 1)
    #expect(store.read() == nil)
  }

  @Test func credentialSignInStopsWhenALegBreaksItsContract() async throws {
    // No session cookie, and an authorize redirect that substitutes the state.
    let cases: [(CredentialTransport, AuthError, Int)] = [
      (CredentialTransport(setsCookie: false), .invalidResponse, 1),
      (
        CredentialTransport(substitutedState: String(repeating: "e", count: 43)), .invalidCallback,
        2
      ),
    ]
    for (transport, expected, requests) in cases {
      let store = MemoryStore()
      let client = NardukAuthClient(
        configuration: try config(), store: store, transport: transport, clock: { instant })
      await #expect(throws: expected) {
        try await client.signIn(email: "operator@example.com", password: "correct horse")
      }
      #expect(await transport.requests.count == requests)
      #expect(store.read() == nil)
    }
  }

  @Test func credentialThatCannotBePersistedIsRevokedRatherThanStranded() async throws {
    let transport = CredentialTransport()
    let client = NardukAuthClient(
      configuration: try config(), store: UnwritableStore(), transport: transport,
      clock: { instant })
    await #expect(throws: AuthError.keychain(-34018)) {
      try await client.signIn(email: "operator@example.com", password: "correct horse")
    }
    let sent = await transport.requests
    #expect(sent.map { $0.url!.path }.last == "/api/auth/native/revoke")
    let body = try JSONDecoder().decode(
      [String: String].self, from: try #require(sent.last?.httpBody))
    #expect(body["refreshToken"] == nextRefresh)
  }

  @Test func keychainFailuresNameTheirStatus() {
    // "could not be accessed in Keychain" alone cost an afternoon of guessing.
    let described = AuthError.keychain(-34018).errorDescription ?? ""
    #expect(described.contains("-34018"))
    #expect(described.count > "Your credentials could not be accessed in Keychain.".count)
  }

  @Test func permitsOnlyConfiguredSecureOriginsAndExplicitLoopbackDevelopment() throws {
    #expect(throws: AuthError.invalidConfiguration) {
      try AuthConfiguration(
        serverURL: URL(string: "http://auth.example.com")!, clientID: "mac",
        redirectURI: URL(string: "com.example:/callback")!)
    }
    #expect(throws: AuthError.invalidConfiguration) {
      try AuthConfiguration(
        serverURL: URL(string: "https://user:password@auth.example.com")!, clientID: "mac",
        redirectURI: URL(string: "com.example:/callback")!)
    }
    _ = try AuthConfiguration(
      serverURL: URL(string: "http://127.0.0.1:3017")!, clientID: "mac",
      redirectURI: URL(string: "com.example:/callback")!, allowInsecureLoopback: true)
  }
}
