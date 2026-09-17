/**
 * RFC 9116 security.txt. Registered by `src/module.ts` with `addServerHandler`
 * at `/.well-known/security.txt` and `/security.txt`, which is why it lives in
 * `handlers/` rather than `routes/` — `addServerScanDir` would otherwise bind
 * a third, filesystem-derived path.
 */
import {
  isSecurityTxtNearOrPastExpiry,
  resolveSecurityTxtExpiresAt,
  resolveSecurityTxtHttpResult,
  SECURITY_TXT_EXPIRY_WARNING_WINDOW_DAYS,
} from '../../shared/securityTxt'

// `Expires` is baked in at build time (module.ts setup). An app that goes
// this long without a redeploy would silently serve an expired security.txt
// with no other signal, so warn once per isolate rather than on every
// request.
let hasWarnedExpiry = false

export default defineEventHandler((event) => {
  const result = resolveSecurityTxtHttpResult(useRuntimeConfig(event).nardukSeoSecurityTxt)
  if (!result.ok) {
    throw createError({
      statusCode: result.statusCode,
      statusMessage: 'Not Found',
    })
  }

  if (!hasWarnedExpiry) {
    const expiresAt = resolveSecurityTxtExpiresAt(result.body)
    if (expiresAt && isSecurityTxtNearOrPastExpiry(expiresAt)) {
      hasWarnedExpiry = true
      console.warn(
        `[@narduk-enterprises/narduk-seo] security.txt Expires (${expiresAt.toISOString()}) is ` +
          `at or within ${SECURITY_TXT_EXPIRY_WARNING_WINDOW_DAYS} days of expiry. Redeploy the ` +
          'app to refresh it.',
      )
    }
  }

  setResponseHeader(event, 'content-type', result.contentType)
  return result.body
})
