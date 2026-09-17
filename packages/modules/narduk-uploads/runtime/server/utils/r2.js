/**
 * Cloudflare R2 object storage helpers.
 */
import { createError } from 'h3'

import { readWorkerRuntimeEnv } from '#layer/server/utils/worker-env'

export function useR2(event, bindingName = 'BUCKET') {
  const env = readWorkerRuntimeEnv(event)
  if (!env[bindingName]) {
    throw createError({
      statusCode: 500,
      message: `R2 binding "${bindingName}" not found. Add it to wrangler.json.`,
    })
  }
  return env[bindingName]
}

/**
 * Write an object to R2. Signature and accept/reject behavior are unchanged:
 * this helper does not validate `contentType`.
 *
 * Public `GET /images/**` only streams keys under `uploads/` whose stored
 * content type is in `ALLOWED_TYPES` (see `./upload.js`). Writes of other
 * types to that prefix succeed here but are not served (415). Prefer
 * `validateUploadFiles` for public image uploads. Other prefixes stay
 * unrestricted so non-public objects can keep arbitrary types.
 */
export async function uploadToR2(event, key, data, contentType, bindingName = 'BUCKET') {
  const r2 = useR2(event, bindingName)
  await r2.put(key, data, contentType ? { httpMetadata: { contentType } } : undefined)
  return key
}

export async function deleteFromR2(event, key, bindingName = 'BUCKET') {
  const r2 = useR2(event, bindingName)
  await r2.delete(key)
}

export async function readR2AsBase64(event, key, bindingName = 'BUCKET') {
  const r2 = useR2(event, bindingName)
  const obj = await r2.get(key)
  if (!obj) return null

  const buf = await obj.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export async function uploadBase64ToR2(
  event,
  key,
  base64Data,
  contentType,
  bindingName = 'BUCKET',
) {
  const binary = atob(base64Data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return uploadToR2(event, key, bytes.buffer, contentType, bindingName)
}
