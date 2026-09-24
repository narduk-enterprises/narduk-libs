import Foundation
import Security

public protocol CredentialStore: Sendable {
  func read() throws -> AuthCredentials?
  func write(_ credentials: AuthCredentials) throws
  func remove() throws
}

public struct KeychainCredentialStore: CredentialStore {
  private let service: String
  private let account: String

  public init(service: String, account: String) {
    self.service = service
    self.account = account
  }

  /// Deliberately not the data protection keychain. On macOS that one needs an
  /// application-identifier or keychain-access-group entitlement, which comes
  /// from a provisioning profile -- a Developer ID app has neither, so every
  /// write returned errSecMissingEntitlement (-34018). iOS has only the data
  /// protection keychain, so omitting the flag is correct on both platforms.
  private var query: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrSynchronizable as String: false,
    ]
  }

  public func read() throws -> AuthCredentials? {
    var request = query
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw AuthError.keychain(status) }
    guard let data = result as? Data else { throw AuthError.invalidResponse }
    return try JSONDecoder().decode(AuthCredentials.self, from: data)
  }

  public func write(_ credentials: AuthCredentials) throws {
    let data = try JSONEncoder().encode(credentials)
    let changes = [kSecValueData as String: data]
    let status = SecItemUpdate(query as CFDictionary, changes as CFDictionary)
    if status == errSecSuccess { return }
    guard status == errSecItemNotFound else { throw AuthError.keychain(status) }
    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let created = SecItemAdd(item as CFDictionary, nil)
    guard created == errSecSuccess else { throw AuthError.keychain(created) }
  }

  public func remove() throws {
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw AuthError.keychain(status)
    }
  }
}
