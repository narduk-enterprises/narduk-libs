/**
 * The consumer-shaped completion proof (narduk-libs#237).
 *
 * `CanonicalCompletionRequest` binds `installationId`, which the cloud mints
 * and the device therefore cannot know when it signs, and carries no domain
 * separator. A consumer whose device signs its own ratified handoff body can
 * instead hand the library that body as it was signed: a domain-separation
 * context, the canonical JSON the device serialised, and the signature over
 * `context + "\n" + canonicalRequest`. This is the byte layout of mybo.at's
 * `mybo/claim-handoff/v1` (`claimHandoffSigningBytes` in `@mybo/contracts`).
 *
 * The library never takes the context from the proof on trust: the service is
 * configured with the one context it accepts (`completionProofContext`), so a
 * signature the same device key made for a different protocol cannot be
 * replayed here as a completion proof.
 */
import { canonicalJson, sha256Hex, timingSafeEqualHex } from './devices-signing'

/**
 * A well-formed signing context: lowercase segments joined by `/` or `-`,
 * ending in a `/v<n>` version, such as `mybo/claim-handoff/v1`. The same rule
 * mybo's `SIGNING_CONTEXT_PATTERN` states.
 */
export const DEVICE_PROOF_CONTEXT_PATTERN = /^[a-z0-9]+(?:[/-][a-z0-9]+)*\/v\d+$/u

/** Separates the context from the canonical JSON in the signed bytes. */
export const DEVICE_PROOF_CONTEXT_SEPARATOR = '\n'

/**
 * The fields a context-bound proof signs, and the only ones it may carry. No
 * `installationId`: the device cannot know it (narduk-libs#237).
 */
export const CONTEXT_BOUND_COMPLETION_KEYS = [
  'claimSessionId',
  'devicePublicKey',
  'hardwareFingerprint',
  'idempotencyKey',
  'nonce',
  'signedAt',
] as const

/** The value a context-bound proof's `canonicalRequest` must serialise. */
export interface ContextBoundCompletionRequest {
  claimSessionId: string
  /** Base64url raw Ed25519 key; must equal the key the claim session recorded. */
  devicePublicKey: string
  hardwareFingerprint: string
  idempotencyKey: string
  /** Single use, per claim session. Any unguessable value the device picks. */
  nonce: string
  /** Millisecond epoch; must be inside `timestampSkewSeconds` of server time. */
  signedAt: number
}

/**
 * A device's Ed25519 signature over its own domain-separated handoff body.
 *
 * - `context` must equal the service's `completionProofContext` exactly.
 * - `canonicalRequest` is the canonical JSON the device signed, as a string:
 *   exactly the six `CONTEXT_BOUND_COMPLETION_KEYS`, keys sorted, no
 *   whitespace. It is checked to be canonical rather than re-serialised, so
 *   the bytes verified are the bytes the device signed.
 * - `signature` is base64url, over the UTF-8 of
 *   `context + "\n" + canonicalRequest`.
 */
export interface ContextBoundCompletionProof {
  canonicalRequest: string
  context: string
  signature: string
}

/**
 * Parse a context-bound `canonicalRequest`, or `null` for anything that is not
 * exactly the canonical serialisation of the six signed keys. Never throws:
 * a malformed proof is an authentication failure, not a 500.
 */
export function parseContextBoundRequest(
  canonicalRequest: unknown,
): ContextBoundCompletionRequest | null {
  if (typeof canonicalRequest !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(canonicalRequest)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length !== CONTEXT_BOUND_COMPLETION_KEYS.length ||
    !CONTEXT_BOUND_COMPLETION_KEYS.every((key) => Object.hasOwn(record, key))
  ) {
    return null
  }
  const { claimSessionId, devicePublicKey, hardwareFingerprint, idempotencyKey, nonce, signedAt } =
    record
  const texts = [claimSessionId, devicePublicKey, hardwareFingerprint, idempotencyKey, nonce]
  if (!texts.every((value) => typeof value === 'string' && value.trim().length > 0)) return null
  if (typeof signedAt !== 'number' || !Number.isSafeInteger(signedAt)) return null
  const request = record as unknown as ContextBoundCompletionRequest
  // One encoding per value: a reordered, spaced or duplicate-keyed body is not
  // the canonical form, so it is refused rather than normalised.
  if (canonicalJson({ ...request }) !== canonicalRequest) return null
  return request
}

/** The exact bytes a context-bound proof's signature covers. */
export function contextBoundSigningBytes(context: string, canonicalRequest: string): Uint8Array {
  return new TextEncoder().encode(context + DEVICE_PROOF_CONTEXT_SEPARATOR + canonicalRequest)
}

/**
 * Constant-time equality for arbitrary text: both sides are hashed to a
 * fixed-width digest first, so neither the position of the first difference
 * nor either length is observable from the comparison.
 */
export async function timingSafeEqualText(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256Hex(a), sha256Hex(b)])
  return timingSafeEqualHex(left, right)
}

/** Is `proof` the context-bound shape rather than `DeviceCompletionProof`? */
export function isContextBoundProof(proof: unknown): proof is ContextBoundCompletionProof {
  return typeof proof === 'object' && proof !== null && 'context' in proof
}
