import Foundation
import Security

public struct AuthConfiguration: Sendable {
  public let serverURL: URL
  public let clientID: String
  public let redirectURI: URL

  public init(
    serverURL: URL, clientID: String, redirectURI: URL, allowInsecureLoopback: Bool = false
  ) throws {
    let loopback =
      allowInsecureLoopback && serverURL.scheme == "http"
      && ["localhost", "127.0.0.1", "[::1]"].contains(serverURL.host ?? "")
    guard serverURL.scheme == "https" || loopback, serverURL.host != nil,
      serverURL.user == nil, serverURL.password == nil,
      serverURL.query == nil, serverURL.fragment == nil,
      ["", "/"].contains(serverURL.path), !clientID.isEmpty,
      let scheme = redirectURI.scheme,
      !["http", "file", "javascript", "data"].contains(scheme),
      redirectURI.user == nil, redirectURI.password == nil,
      redirectURI.query == nil, redirectURI.fragment == nil
    else {
      throw AuthError.invalidConfiguration
    }
    self.serverURL = serverURL
    self.clientID = clientID
    self.redirectURI = redirectURI
  }
}

public enum AuthError: Error, LocalizedError, Sendable, Equatable {
  case invalidConfiguration
  case invalidCallback
  case invalidResponse
  case signedOut
  case signInExpired
  case keychain(Int32)
  case server(Int)
  case rejected(status: Int, message: String)

  public var errorDescription: String? {
    switch self {
    case .invalidConfiguration: "The sign-in service is not configured correctly."
    case .invalidCallback: "The sign-in response did not match this app’s request."
    case .invalidResponse: "The sign-in service returned an invalid response."
    case .signedOut: "Sign in to continue."
    case .signInExpired: "This sign-in request expired. Please start again."
    case .keychain(let status):
      "Your credentials could not be accessed in Keychain: "
        + ((SecCopyErrorMessageString(status, nil) as String?) ?? "unknown error")
        + " (\(status))."
    case .server(let status):
      status == 401
        ? "Your session expired. Please sign in again." : "The sign-in service is unavailable."
    case .rejected(_, let message): message
    }
  }

  /// The HTTP status behind a rejection, so callers can tell a refused
  /// credential from a service that is merely unavailable.
  public var statusCode: Int? {
    switch self {
    case .server(let status): status
    case .rejected(let status, _): status
    default: nil
    }
  }
}

public struct AuthCredentials: Codable, Sendable, Equatable {
  public let accessToken: String
  public let refreshToken: String
  public let sessionID: String
  public let accessExpiresAt: Date
  public let refreshExpiresAt: Date

  public init(
    accessToken: String, refreshToken: String, sessionID: String, accessExpiresAt: Date,
    refreshExpiresAt: Date
  ) {
    self.accessToken = accessToken
    self.refreshToken = refreshToken
    self.sessionID = sessionID
    self.accessExpiresAt = accessExpiresAt
    self.refreshExpiresAt = refreshExpiresAt
  }
}

public struct SignInRequest: Sendable {
  public let authorizationURL: URL
}

/// A transport can be replaced for deterministic tests. Production uses an
/// ephemeral URLSession; cookies and HTTP caches never hold native credentials.
public protocol AuthTransport: Sendable {
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionAuthTransport: AuthTransport {
  private let session: URLSession

  public init() {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.urlCache = nil
    configuration.timeoutIntervalForRequest = 20
    configuration.timeoutIntervalForResource = 30
    self.session = URLSession(
      configuration: configuration, delegate: RejectRedirects(), delegateQueue: nil)
  }

  public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await session.data(for: request)
    guard let response = response as? HTTPURLResponse else { throw AuthError.invalidResponse }
    // Never accept a redirected credential exchange, even a successful one.
    guard response.url == request.url else { throw AuthError.invalidResponse }
    return (data, response)
  }
}

private final class RejectRedirects: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}
