#if os(macOS) || os(iOS) || os(visionOS)
  import AuthenticationServices
  import Foundation

  extension NardukAuthClient {
    /// Signs in with a platform passkey (Touch ID or the system passkey sheet)
    /// and ends in a native session, with no browser.
    ///
    /// The app needs the `webcredentials:<host>` Associated Domains entitlement
    /// for the server's Relying Party ID, and the host must serve an
    /// `apple-app-site-association` file naming the app. Throws
    /// `PasskeySignInError` for outcomes an app should answer with a password
    /// sign-in. See the README, "Passkey sign-in".
    @MainActor
    public func signInWithPasskey(anchor: ASPresentationAnchor) async throws {
      try await signIn(using: PlatformPasskeyAssertionProvider(anchor: anchor))
    }
  }

  /// `ASPresentationAnchor` is main-actor isolated, which makes it Sendable.
  struct PlatformPasskeyAssertionProvider: PasskeyAssertionProvider {
    let anchor: ASPresentationAnchor

    func assertion(relyingPartyID: String, challenge: Data) async throws -> PasskeyAssertion {
      try await PasskeyCeremony.run(
        anchor: anchor, relyingPartyID: relyingPartyID, challenge: challenge)
    }
  }

  @MainActor
  private final class PasskeyCeremony: NSObject {
    private let anchor: ASPresentationAnchor
    private var controller: ASAuthorizationController?
    private var continuation: CheckedContinuation<PasskeyAssertion, any Error>?

    private init(anchor: ASPresentationAnchor) { self.anchor = anchor }

    static func run(
      anchor: ASPresentationAnchor, relyingPartyID: String, challenge: Data
    ) async throws -> PasskeyAssertion {
      let ceremony = PasskeyCeremony(anchor: anchor)
      return try await withTaskCancellationHandler {
        try await ceremony.perform(relyingPartyID: relyingPartyID, challenge: challenge)
      } onCancel: {
        Task { @MainActor in ceremony.controller?.cancel() }
      }
    }

    private func perform(relyingPartyID: String, challenge: Data) async throws -> PasskeyAssertion {
      try await withCheckedThrowingContinuation { continuation in
        self.continuation = continuation
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
          relyingPartyIdentifier: relyingPartyID)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        request.userVerificationPreference = .required
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        controller.performRequests()
      }
    }

    private func finish(_ result: Result<PasskeyAssertion, any Error>) {
      let pending = continuation
      continuation = nil
      controller = nil
      pending?.resume(with: result)
    }

    static func map(_ error: any Error) -> any Error {
      guard let failure = error as? ASAuthorizationError else { return error }
      switch failure.code {
      case .canceled: return PasskeySignInError.cancelled
      case .notHandled, .notInteractive: return PasskeySignInError.noCredential
      default: return PasskeySignInError.failed(code: failure.errorCode)
      }
    }
  }

  extension PasskeyCeremony: ASAuthorizationControllerDelegate {
    func authorizationController(
      controller: ASAuthorizationController,
      didCompleteWithAuthorization authorization: ASAuthorization
    ) {
      guard
        let credential = authorization.credential
          as? ASAuthorizationPlatformPublicKeyCredentialAssertion
      else {
        finish(.failure(AuthError.invalidResponse))
        return
      }
      finish(
        .success(
          PasskeyAssertion(
            credentialID: credential.credentialID, clientDataJSON: credential.rawClientDataJSON,
            authenticatorData: credential.rawAuthenticatorData, signature: credential.signature,
            userHandle: credential.userID)))
    }

    func authorizationController(
      controller: ASAuthorizationController, didCompleteWithError error: any Error
    ) {
      finish(.failure(Self.map(error)))
    }
  }

  extension PasskeyCeremony: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
      anchor
    }
  }
#endif
