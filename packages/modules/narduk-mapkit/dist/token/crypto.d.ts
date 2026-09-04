/**
 * Web Crypto helpers for Apple Maps JWT signing (PEM import, base64url, DER→raw).
 */
/**
 * Import a PEM-encoded ES256 private key for use with Web Crypto API.
 */
export declare function importPrivateKeyForAppleMaps(pemKey: string): Promise<CryptoKey>;
export declare function base64urlEncode(input: ArrayBuffer | string): string;
/**
 * Convert a DER-encoded ECDSA signature to raw (r||s) format.
 * Web Crypto may return DER format on some platforms.
 */
export declare function derEcdsaSignatureToRaw(der: Uint8Array): Uint8Array;
//# sourceMappingURL=crypto.d.ts.map