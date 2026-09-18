---
'@narduk-enterprises/narduk-devices': minor
---

`completeClaimWithRecordedApproval` accepts a consumer-shaped device proof, so a
device whose completion response was lost can be re-issued its credentials
(narduk-libs#237). `deviceProof` may now be a `ContextBoundCompletionProof`,
`{ context, canonicalRequest, signature }`, in mybo.at's `mybo/claim-handoff/v1`
layout: an Ed25519 signature over `context + "\n" + canonicalRequest`, where
`canonicalRequest` is the canonical JSON of `claimSessionId`, `devicePublicKey`,
`hardwareFingerprint`, `idempotencyKey`, `nonce` and `signedAt`. It carries no
`installationId`, which the cloud mints and the device cannot sign.

The library fails closed. The accepted context is configured with the new
`createDevices({ completionProofContext })` option; without it a context-bound
proof throws `invalid`. A proof under any other context, a `canonicalRequest`
that is not exactly the canonical form of the six keys, a field that does not
match the claim session and the call, a `signedAt` outside the skew window, a
bad signature, or a nonce already spent is refused like any other failed proof.
The binding compares are constant-time. A served re-issue now also returns the
device's recorded `installationId`, for a consumer that mints a fresh one per
attempt.

The library's own `DeviceCompletionProof` is unchanged.
