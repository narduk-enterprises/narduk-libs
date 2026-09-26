import { setAppResponseHeader } from '@narduk-enterprises/narduk-app/server/http'
import { defineEventHandler } from 'h3'

import {
  readAuthRuntimeEnv,
  resolveAuthEnvironmentForEvent,
} from '#narduk-auth-server/utils/auth-runtime-env'

import { resolveAppleSignInConfig } from '../../../shared/utils/apple-sign-in-config'
import { resolveWebauthnConfig } from '../../../shared/utils/webauthn-config'

/**
 * Auth flags derived from **runtime** Worker env (Cloudflare bindings + local
 * process.env), not from values frozen at `nuxt build`. Client components use
 * this so OAuth and passkey affordances match production secrets without
 * requiring those vars during Workers Builds / `cf:build`.
 *
 * `passkeysEnabled` is deliberately narrower than `authProviders.includes('passkey')`:
 * the provider list is only an advertisement flag, while this reports whether
 * the server would actually accept a ceremony — backend, provider opt-in, and a
 * valid Relying Party binding all resolved. A passkey button that appears when
 * the RP ID is unset would fail at the first click.
 */
export default defineEventHandler((event) => {
  const resolved = resolveAuthEnvironmentForEvent(event)
  const env = readAuthRuntimeEnv(event)
  const webauthn = resolveWebauthnConfig({
    authBackend: resolved.authBackend,
    authProviders: resolved.authProviders,
    env,
  })
  const apple = resolveAppleSignInConfig({
    authBackend: resolved.authBackend,
    authProviders: resolved.authProviders,
    env,
  })
  setAppResponseHeader(event, 'Cache-Control', 'private, no-store')
  return {
    authBackend: resolved.authBackend,
    authProviders: resolved.authProviders,
    appleEnabled: apple.webEnabled,
    passkeysEnabled: webauthn.enabled,
  }
})
