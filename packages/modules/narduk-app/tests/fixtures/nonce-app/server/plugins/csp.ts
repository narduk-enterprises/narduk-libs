import { getCspNonce, installCspNonce } from '../../../../../src/server/csp-nonce'
import { applySecurityHeaders } from '../../../../../src/server/security-headers'

export default defineNitroPlugin((nitroApp) => {
  installCspNonce(nitroApp)
  nitroApp.hooks.hook('request', (event) => {
    applySecurityHeaders(
      event,
      {
        csp: {
          'default-src': ["'self'"],
          'script-src': ["'self'", "'wasm-unsafe-eval'"],
          'frame-ancestors': ["'none'"],
        },
      },
      { nonce: getCspNonce(event) },
    )
  })
})
