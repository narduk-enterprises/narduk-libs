/**
 * Generic R2 image upload endpoint.
 */
import { uploadToR2 } from '@narduk-enterprises/narduk-uploads/runtime/server/utils/r2'
import {
  getUploadPerformanceWarnings,
  MAX_UPLOAD_REQUEST_SIZE,
  normalizeExtension,
  validateUploadFiles,
} from '@narduk-enterprises/narduk-uploads/runtime/server/utils/upload'
import { createError, getHeader, readMultipartFormData } from 'h3'

import { useLogger } from '#layer/server/utils/logger'
import { defineUserMutation } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'

function rejectOversizedUploadRequest(event) {
  const contentLengthHeader = getHeader(event, 'content-length')
  if (!contentLengthHeader) return

  const contentLength = Number.parseInt(contentLengthHeader, 10)
  if (!Number.isFinite(contentLength)) return

  if (contentLength > MAX_UPLOAD_REQUEST_SIZE) {
    throw createError({
      statusCode: 413,
      message: `Upload request exceeds ${MAX_UPLOAD_REQUEST_SIZE / 1024 / 1024}MB limit`,
    })
  }
}

export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.upload,
    parseBody: async (event) => {
      rejectOversizedUploadRequest(event)
      const formData = await readMultipartFormData(event)
      if (!formData || formData.length === 0) {
        throw createError({ statusCode: 400, message: 'No file uploaded' })
      }

      return formData
    },
  },
  async ({ event, body: formData }) => {
    const log = useLogger(event).child('Upload')

    const files = formData.filter(
      (part) => part.data.byteLength > 0 && part.filename != null && part.type != null,
    )

    if (files.length === 0) {
      throw createError({ statusCode: 400, message: 'No valid files in upload' })
    }

    validateUploadFiles(files)

    const results = []

    for (const file of files) {
      const ext = normalizeExtension(file.type)
      const key = `uploads/${crypto.randomUUID()}.${ext}`
      const payload = new ArrayBuffer(file.data.byteLength)
      const performanceWarnings = getUploadPerformanceWarnings(file)
      new Uint8Array(payload).set(file.data)

      await uploadToR2(event, key, payload, file.type)

      if (performanceWarnings.length > 0) {
        log.warn('Uploaded image exceeds public performance budget', {
          filename: file.filename,
          key,
          performanceWarnings,
        })
      }

      results.push({
        key,
        url: `/images/${key}`,
        ...(performanceWarnings.length > 0 ? { performanceWarnings } : {}),
      })
    }

    log.info('File(s) uploaded', { count: results.length, keys: results.map((r) => r.key) })
    if (results.length === 1) {
      return results[0]
    }
    return results
  },
)
