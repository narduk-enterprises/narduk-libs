/**
 * RFC 9116 security.txt. Registered by `src/module.ts` with `addServerHandler`
 * at `/.well-known/security.txt` and `/security.txt`, which is why it lives in
 * `handlers/` rather than `routes/` — `addServerScanDir` would otherwise bind
 * a third, filesystem-derived path.
 */
import { resolveSecurityTxtHttpResult } from '../../shared/securityTxt'

export default defineEventHandler((event) => {
  const result = resolveSecurityTxtHttpResult(useRuntimeConfig(event).nardukSeoSecurityTxt)
  if (!result.ok) {
    throw createError({
      statusCode: result.statusCode,
      statusMessage: 'Not Found',
    })
  }

  setResponseHeader(event, 'content-type', result.contentType)
  return result.body
})
