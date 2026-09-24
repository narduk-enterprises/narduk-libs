import CryptoKit
import Foundation
import Security

/// A local-auth client for narduk-auth's opt-in native PKCE contract.
/// Organization and resource authorization remain the consuming app’s concern.
public actor NardukAuthClient {
  public nonisolated let configuration: AuthConfiguration
  private let store: any CredentialStore
  private let transport: any AuthTransport
  private let clock: @Sendable () -> Date
  private var credentials: AuthCredentials?
  private var loaded = false
  private var generation = 0
  private var refreshAttempt: RefreshAttempt?
  private var pending: PendingSignIn?

  private struct PendingSignIn {
    let verifier: String
    let state: String
    let createdAt: Date
  }
  private struct RefreshAttempt {
    let id = UUID()
    let token: String
    let task: Task<AuthCredentials, Error>
  }
  private struct TokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
    let refreshExpiresAt: Double
    let sessionId: String
    let tokenType: String
  }
  private struct AuthorizeResponse: Decodable {
    let redirectTo: String
  }
  private struct ServerMessage: Decodable {
    let statusMessage: String?
  }

  public init(
    configuration: AuthConfiguration, store: (any CredentialStore)? = nil,
    transport: any AuthTransport = URLSessionAuthTransport(),
    clock: @escaping @Sendable () -> Date = Date.init
  ) {
    self.configuration = configuration
    self.store =
      store
      ?? KeychainCredentialStore(
        service: configuration.clientID, account: configuration.serverURL.absoluteString)
    self.transport = transport
    self.clock = clock
  }

  public func hasCredentials() throws -> Bool {
    try load()
    return credentials.map { $0.refreshExpiresAt > clock() } ?? false
  }

  /// Signs in with an email and password without opening a browser.
  ///
  /// Three requests share one throwaway web session: `/api/auth/login` proves the
  /// password and returns a session cookie, `/api/auth/native/authorize` mints a
  /// PKCE code for this client, and `/api/auth/native/token` exchanges that code
  /// for native credentials. The cookie is attached to exactly one request and is
  /// never retained; the transport deliberately keeps no cookie jar.
  public func signIn(email: String, password: String) async throws {
    let request = PendingSignIn(
      verifier: try Self.secret(), state: try Self.secret(), createdAt: clock())
    let origin = try self.origin()
    let login = try await post(
      "/api/auth/login", body: ["email": email, "password": password],
      headers: ["Origin": origin])
    let authorize = try await post(
      "/api/auth/native/authorize",
      body: [
        "clientId": configuration.clientID,
        "redirectUri": configuration.redirectURI.absoluteString,
        "codeChallenge": Self.base64URL(Data(SHA256.hash(data: Data(request.verifier.utf8)))),
        "codeChallengeMethod": "S256",
        "state": request.state,
      ],
      headers: ["Origin": origin, "Cookie": try Self.sessionCookie(from: login.response)])
    let redirect = try JSONDecoder().decode(AuthorizeResponse.self, from: authorize.data).redirectTo
    guard let callback = URL(string: redirect) else { throw AuthError.invalidResponse }
    try await finishSignIn(callbackURL: callback, request: request)
  }

  public func beginSignIn() throws -> SignInRequest {
    let verifier = try Self.secret()
    let state = try Self.secret()
    pending = PendingSignIn(verifier: verifier, state: state, createdAt: clock())
    guard var url = URLComponents(url: endpoint("/auth/native"), resolvingAgainstBaseURL: false)
    else { throw AuthError.invalidConfiguration }
    url.queryItems = [
      URLQueryItem(name: "clientId", value: configuration.clientID),
      URLQueryItem(name: "redirectUri", value: configuration.redirectURI.absoluteString),
      URLQueryItem(
        name: "codeChallenge", value: Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))),
      URLQueryItem(name: "codeChallengeMethod", value: "S256"),
      URLQueryItem(name: "state", value: state),
    ]
    guard let authorizationURL = url.url else { throw AuthError.invalidConfiguration }
    return SignInRequest(authorizationURL: authorizationURL)
  }

  public func cancelSignIn() { pending = nil }

  public func completeSignIn(callbackURL: URL) async throws {
    guard let request = pending else { throw AuthError.invalidCallback }
    pending = nil
    try await finishSignIn(callbackURL: callbackURL, request: request)
  }

  private func finishSignIn(callbackURL: URL, request: PendingSignIn) async throws {
    guard clock().timeIntervalSince(request.createdAt) < 600 else { throw AuthError.signInExpired }
    guard var callback = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
      throw AuthError.invalidCallback
    }
    let query = callback.queryItems ?? []
    callback.query = nil
    guard callback.url == configuration.redirectURI,
      query.filter({ $0.name == "state" }).count == 1,
      query.first(where: { $0.name == "state" })?.value == request.state,
      query.filter({ $0.name == "code" }).count == 1,
      let code = query.first(where: { $0.name == "code" })?.value,
      Self.isToken(code)
    else { throw AuthError.invalidCallback }
    let revision = generation
    let result = try await exchange(
      "/api/auth/native/token",
      body: [
        "clientId": configuration.clientID, "redirectUri": configuration.redirectURI.absoluteString,
        "code": code, "codeVerifier": request.verifier,
      ])
    guard generation == revision else {
      try await revoke(result.refreshToken)
      throw AuthError.signedOut
    }
    do {
      try store.write(result)
    } catch {
      try? await revoke(result.refreshToken)
      throw error
    }
    credentials = result
    loaded = true
    generation += 1
  }

  /// Concurrent API calls share one refresh. A transient network failure does
  /// not erase stored credentials; a rejected credential does.
  public func accessToken(forceRefresh: Bool = false) async throws -> String {
    try load()
    guard let current = credentials, current.refreshExpiresAt > clock() else {
      throw AuthError.signedOut
    }
    if !forceRefresh && current.accessExpiresAt.timeIntervalSince(clock()) > 30 {
      return current.accessToken
    }
    let revision = generation
    let attempt: RefreshAttempt
    if let existing = refreshAttempt {
      attempt = existing
    } else {
      let task = Task {
        try await self.exchange(
          "/api/auth/native/refresh",
          body: ["clientId": self.configuration.clientID, "refreshToken": current.refreshToken])
      }
      attempt = RefreshAttempt(token: current.refreshToken, task: task)
      refreshAttempt = attempt
    }
    do {
      let updated = try await attempt.task.value
      guard generation == revision else { throw AuthError.signedOut }
      if credentials?.refreshToken == attempt.token {
        try store.write(updated)
        credentials = updated
      }
      if refreshAttempt?.id == attempt.id { refreshAttempt = nil }
      guard let active = credentials else { throw AuthError.signedOut }
      return active.accessToken
    } catch {
      if generation == revision {
        if refreshAttempt?.id == attempt.id { refreshAttempt = nil }
        if (error as? AuthError)?.statusCode == 401, credentials?.refreshToken == attempt.token {
          credentials = nil
          try store.remove()
        }
      }
      throw error
    }
  }

  /// Clears this device immediately, then revokes the newest refresh token.
  /// If refresh was already in flight, wait for its rotation before revoking.
  public func signOut() async throws {
    try load()
    let current = credentials
    let inFlight = refreshAttempt?.task
    generation += 1
    credentials = nil
    pending = nil
    refreshAttempt = nil
    try store.remove()
    var refreshError: Error?
    var rotated: AuthCredentials?
    if let inFlight {
      do { rotated = try await inFlight.value } catch { refreshError = error }
    }
    if let token = rotated?.refreshToken ?? current?.refreshToken { try await revoke(token) }
    if let refreshError { throw refreshError }
  }

  private func load() throws {
    if !loaded {
      credentials = try store.read()
      loaded = true
    }
  }
  private func endpoint(_ path: String) -> URL {
    configuration.serverURL.appendingPathComponent(path)
  }
  private func origin() throws -> String {
    guard
      let parts = URLComponents(url: configuration.serverURL, resolvingAgainstBaseURL: false),
      let scheme = parts.scheme, let host = parts.host
    else { throw AuthError.invalidConfiguration }
    return parts.port.map { "\(scheme)://\(host):\($0)" } ?? "\(scheme)://\(host)"
  }
  private func post(
    _ path: String, body: [String: String], headers: [String: String] = [:]
  ) async throws -> (data: Data, response: HTTPURLResponse) {
    var request = URLRequest(url: endpoint(path))
    request.httpMethod = "POST"
    // The manual Cookie header below must survive; nothing else may attach one.
    request.httpShouldHandleCookies = false
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("XMLHttpRequest", forHTTPHeaderField: "X-Requested-With")
    for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
    request.httpBody = try JSONEncoder().encode(body)
    let (data, response) = try await transport.send(request)
    guard response.url == request.url else { throw AuthError.invalidResponse }
    guard (200..<300).contains(response.statusCode) else {
      throw Self.failure(status: response.statusCode, body: data)
    }
    return (data, response)
  }
  private func exchange(_ path: String, body: [String: String]) async throws -> AuthCredentials {
    let payload = try JSONDecoder().decode(
      TokenResponse.self, from: await post(path, body: body).data)
    guard payload.tokenType == "Bearer", payload.expiresIn > 0, payload.expiresIn <= 3600,
      payload.refreshExpiresAt > clock().timeIntervalSince1970,
      !payload.sessionId.isEmpty, Self.isToken(payload.accessToken),
      Self.isToken(payload.refreshToken)
    else { throw AuthError.invalidResponse }
    return AuthCredentials(
      accessToken: payload.accessToken, refreshToken: payload.refreshToken,
      sessionID: payload.sessionId,
      accessExpiresAt: clock().addingTimeInterval(Double(payload.expiresIn)),
      refreshExpiresAt: Date(timeIntervalSince1970: payload.refreshExpiresAt))
  }
  private func revoke(_ refreshToken: String) async throws {
    _ = try await post(
      "/api/auth/native/revoke",
      body: ["clientId": configuration.clientID, "refreshToken": refreshToken])
  }
  /// The web session cookie is read straight off the login response and passed
  /// to exactly one request, so it cannot leak into any other call.
  private static func sessionCookie(from response: HTTPURLResponse) throws -> String {
    guard let url = response.url, let header = response.value(forHTTPHeaderField: "Set-Cookie")
    else { throw AuthError.invalidResponse }
    let cookies = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: url)
    guard !cookies.isEmpty, let cookie = HTTPCookie.requestHeaderFields(with: cookies)["Cookie"]
    else { throw AuthError.invalidResponse }
    return cookie
  }
  private static func failure(status: Int, body: Data) -> AuthError {
    guard let message = message(from: body) else { return .server(status) }
    return .rejected(status: status, message: message)
  }
  /// Only a short, single-line explanation from the auth service reaches the UI.
  private static func message(from body: Data) -> String? {
    guard body.count <= 4096,
      let decoded = try? JSONDecoder().decode(ServerMessage.self, from: body),
      let message = decoded.statusMessage?.trimmingCharacters(in: .whitespacesAndNewlines),
      (1...200).contains(message.count),
      message.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
    else { return nil }
    return message
  }
  private static func isToken(_ value: String) -> Bool {
    value.utf8.count == 43
      && value.utf8.allSatisfy {
        (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45
          || $0 == 95
      }
  }
  private static func secret() throws -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    guard status == errSecSuccess else { throw AuthError.keychain(status) }
    return base64URL(Data(bytes))
  }
  private static func base64URL(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(
      of: "/", with: "_"
    ).replacingOccurrences(of: "=", with: "")
  }
}
