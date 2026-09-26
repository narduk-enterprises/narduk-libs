import { useRuntimeConfig } from 'nitropack/runtime'

import type { H3Event } from 'h3'

/**
 * Optional session-grant validator seam.
 *
 * narduk-core must not import narduk-auth. Apps that install narduk-auth attach
 * a validator on `event.context` (nitro `request` hook) and set
 * `runtimeConfig.nardukSessionGrantRequired`. `requireAuth` consults the
 * seam so a sealed cookie is only a pointer to server-side session state.
 *
 * No validator and the flag unset (core-only apps): sealed-cookie identity
 * is unchanged. Flag set but no validator: fail closed — do not treat the
 * cookie as a grant.
 */

let missingRequiredValidatorWarned = false

export type SessionGrantValidation =
  | {
      status: 'valid'
      user?: unknown
    }
  | {
      status: 'invalid'
    }

export type SessionGrantValidator = (
  event: H3Event,
  sessionUser: unknown,
) => Promise<SessionGrantValidation>

export type SealedSessionGrantResult = SessionGrantValidation | { status: 'unvalidated' }

const SESSION_GRANT_VALIDATOR_KEY = '_nardukSessionGrantValidator'
const SESSION_GRANT_RESULT_KEY = '_nardukSessionGrantResult'

interface SessionGrantContext {
  [SESSION_GRANT_RESULT_KEY]?: Promise<SealedSessionGrantResult>
  [SESSION_GRANT_VALIDATOR_KEY]?: SessionGrantValidator
}

function grantContext(event: H3Event): SessionGrantContext {
  return event.context as H3Event['context'] & SessionGrantContext
}

export function setSessionGrantValidator(event: H3Event, validator: SessionGrantValidator): void {
  grantContext(event)[SESSION_GRANT_VALIDATOR_KEY] = validator
}

/**
 * @deprecated Unused inside narduk-libs: `validateSealedSessionGrant` reads the
 * validator itself. Kept because server utils are auto-imported into apps, so
 * removing it is a breaking change (narduk-libs#1037).
 */
export function getSessionGrantValidator(event: H3Event): SessionGrantValidator | undefined {
  return grantContext(event)[SESSION_GRANT_VALIDATOR_KEY]
}

function isSessionGrantRequired(event: H3Event): boolean {
  try {
    const config = useRuntimeConfig(event) as { nardukSessionGrantRequired?: unknown }
    return config.nardukSessionGrantRequired === true
  } catch {
    return false
  }
}

function warnMissingRequiredValidator(): void {
  if (missingRequiredValidatorWarned) return
  missingRequiredValidatorWarned = true
  globalThis.console.warn(
    '[narduk-core] nardukSessionGrantRequired is set but no session-grant validator is registered on this request; the sealed cookie is not a grant.',
  )
}

/**
 * Validate a sealed-cookie principal against a registered grant validator.
 *
 * `unvalidated` means no validator is registered and none is required —
 * callers must keep legacy cookie-as-grant behavior. When narduk-auth has
 * marked a validator as required, a missing validator is `invalid` (fail
 * closed). Validator results are memoized on the event so the same session
 * is not re-checked more than once per request.
 */
export async function validateSealedSessionGrant(
  event: H3Event,
  sessionUser: unknown,
): Promise<SealedSessionGrantResult> {
  const context = grantContext(event)
  const validator = context[SESSION_GRANT_VALIDATOR_KEY]
  if (!validator) {
    if (isSessionGrantRequired(event)) {
      warnMissingRequiredValidator()
      return { status: 'invalid' }
    }
    return { status: 'unvalidated' }
  }

  const cached = context[SESSION_GRANT_RESULT_KEY]
  if (cached) {
    return cached
  }

  const pending = validator(event, sessionUser)
  context[SESSION_GRANT_RESULT_KEY] = pending
  return pending
}
