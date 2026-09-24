import { reflectMetadataPolyfillInstalled } from './reflect-metadata-polyfill'

// Load-bearing: this module is the only import site for `@simplewebauthn/server`
// in the ceremony path. The polyfill must evaluate first so tsyringe does not
// throw on a Workers build (narduk-libs#786).
void reflectMetadataPolyfillInstalled

export {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
export { isoBase64URL } from '@simplewebauthn/server/helpers'
export type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
