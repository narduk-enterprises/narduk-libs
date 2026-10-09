import Foundation

/// The signed result of a passkey assertion, in the shape the WebAuthn
/// authentication ceremony returns, as raw bytes.
public struct PasskeyAssertion: Sendable, Equatable {
  public let credentialID: Data
  public let clientDataJSON: Data
  public let authenticatorData: Data
  public let signature: Data
  /// The account handle stored with the credential; empty when absent.
  public let userHandle: Data

  public init(
    credentialID: Data, clientDataJSON: Data, authenticatorData: Data, signature: Data,
    userHandle: Data
  ) {
    self.credentialID = credentialID
    self.clientDataJSON = clientDataJSON
    self.authenticatorData = authenticatorData
    self.signature = signature
    self.userHandle = userHandle
  }
}

/// Produces a passkey assertion for a relying party and challenge. Production
/// uses the system's platform authenticator; tests inject a fake.
public protocol PasskeyAssertionProvider: Sendable {
  /// Throws `PasskeySignInError.cancelled` when the person dismisses the prompt
  /// and `PasskeySignInError.noCredential` when no passkey is available.
  func assertion(relyingPartyID: String, challenge: Data) async throws -> PasskeyAssertion
}

/// Why a passkey sign-in did not complete. Each case is one an app should
/// answer by falling back to password sign-in; network and credential-exchange
/// failures after the passkey was accepted stay `AuthError`.
public enum PasskeySignInError: Error, LocalizedError, Sendable, Equatable {
  /// The person dismissed the system prompt.
  case cancelled
  /// The system had no usable passkey for this relying party, or could not
  /// present the prompt.
  case noCredential
  /// The service is not configured for passkeys.
  case unavailable
  /// The service refused the assertion.
  case refused
  /// The system reported a failure; check the app's Associated Domains.
  case failed(code: Int)

  public var errorDescription: String? {
    switch self {
    case .cancelled: "Passkey sign-in was cancelled."
    case .noCredential: "No passkey is available for this account on this device."
    case .unavailable: "Passkey sign-in is not available for this service."
    case .refused: "The passkey was not accepted. Sign in with your password instead."
    case .failed(let code):
      "Passkey sign-in failed (code \(code)). Check that the app is associated with the service."
    }
  }
}
