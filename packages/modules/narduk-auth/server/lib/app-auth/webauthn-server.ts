import { createError } from 'h3'

import { reflectMetadataPolyfillInstalled } from './reflect-metadata-polyfill'

import type * as SimpleWebauthnServer from '@simplewebauthn/server'
import type * as SimpleWebauthnHelpers from '@simplewebauthn/server/helpers'

// Load-bearing: this module is the only import site for `@simplewebauthn/server`
// in the ceremony path. The polyfill must evaluate first so tsyringe does not
// throw on a Workers build (narduk-libs#786).
void reflectMetadataPolyfillInstalled

export type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'

export interface WebauthnServer {
  generateAuthenticationOptions: typeof SimpleWebauthnServer.generateAuthenticationOptions
  generateRegistrationOptions: typeof SimpleWebauthnServer.generateRegistrationOptions
  isoBase64URL: typeof SimpleWebauthnHelpers.isoBase64URL
  verifyAuthenticationResponse: typeof SimpleWebauthnServer.verifyAuthenticationResponse
  verifyRegistrationResponse: typeof SimpleWebauthnServer.verifyRegistrationResponse
}

export const PASSKEYS_UNAVAILABLE_MESSAGE = 'Passkeys unavailable: server misconfiguration'

let loading: Promise<WebauthnServer> | undefined

async function importWebauthnServer(): Promise<WebauthnServer> {
  // Both entries reach `@peculiar/x509` → `tsyringe`, so both load lazily:
  // a module-evaluation failure then rejects here, where it can be answered,
  // instead of failing every route that imports this file (narduk-libs#892).
  const [server, helpers] = await Promise.all([
    import('@simplewebauthn/server'),
    import('@simplewebauthn/server/helpers'),
  ])
  return {
    generateAuthenticationOptions: server.generateAuthenticationOptions,
    generateRegistrationOptions: server.generateRegistrationOptions,
    isoBase64URL: helpers.isoBase64URL,
    verifyAuthenticationResponse: server.verifyAuthenticationResponse,
    verifyRegistrationResponse: server.verifyRegistrationResponse,
  }
}

/**
 * Loads `@simplewebauthn/server` on first use.
 *
 * When the library cannot load or initialize, `onLoadFailure` receives the
 * cause (for the log) and the caller gets a 503 with a fixed message rather
 * than an opaque 500 (narduk-libs#892). The cause itself never reaches the
 * response. A failed load is not cached, so the next request retries and logs
 * again.
 */
export async function loadWebauthnServer(
  onLoadFailure: (error: unknown) => void,
): Promise<WebauthnServer> {
  loading ??= importWebauthnServer()
  try {
    return await loading
  } catch (error) {
    loading = undefined
    onLoadFailure(error)
    throw createError({
      statusCode: 503,
      statusMessage: PASSKEYS_UNAVAILABLE_MESSAGE,
    })
  }
}
