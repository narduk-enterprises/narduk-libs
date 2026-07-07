import { defineEventHandler } from 'h3'

import { handleIndexNowKeyVerification } from '#narduk-analytics-server/utils/indexNowKeyVerification'

/**
 * IndexNow key verification endpoint.
 *
 * IndexNow requires the API key to be accessible at `/{key}.txt`. This
 * Nitro middleware serves it directly so apps do not need a static file
 * in `public/`.
 *
 * See `./utils/indexNowKeyVerification.ts` for the resolution priority
 * (private runtime config → public runtime config → Worker runtime env
 * `INDEXNOW_KEY` / `NUXT_PUBLIC_INDEXNOW_KEY`) and the strict `/<key>.txt`
 * regex. The middleware returns `undefined` when it does not handle the
 * request so the normal Nuxt page renderer stays in charge of `/`,
 * `/about`, `/robots.txt`, etc.
 */
export default defineEventHandler((event) => {
  return handleIndexNowKeyVerification(event)
})
