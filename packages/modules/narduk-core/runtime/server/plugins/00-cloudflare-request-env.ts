import { defineNitroPlugin } from 'nitropack/runtime'

import { preserveCloudflareRequestContext } from '../utils/cloudflare-request-env'

/**
 * Copy the outer Worker Cloudflare context onto Nitro internal SSR requests
 * (narduk-libs#49). `addServerScanDir` picks this up; it is not registered
 * from `src/module.ts`.
 */
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('request', (event) => {
    preserveCloudflareRequestContext(event)
  })
})
