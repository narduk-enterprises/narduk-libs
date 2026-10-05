/**
 * Generic R2 image upload endpoint.
 */
import { uploadToR2 } from '@narduk-enterprises/narduk-uploads/runtime/server/utils/r2'
import {
  capIncomingMessageBytes,
  enforceUploadBodyByteCap,
  getUploadPerformanceWarnings,
  isAllowedUploadContentType,
  MAX_FILE_SIZE,
  MAX_UPLOAD_REQUEST_SIZE,
  normalizeExtension,
  normalizeUploadContentType,
  sniffUploadImageType,
  validateUploadFiles,
} from '@narduk-enterprises/narduk-uploads/runtime/server/utils/upload'
import { createError, getHeader, readMultipartFormData } from 'h3'

import { useLogger } from '#layer/server/utils/logger'
import { defineUserMutation } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'

const TOO_LARGE_MESSAGE = `Upload request exceeds ${MAX_UPLOAD_REQUEST_SIZE / 1024 / 1024}MB limit`

/**
 * Every refusal writes one `Upload rejected` warn with a stable `reason`, so a
 * client stuck on 4xx is visible without the request body. Records carry
 * sizes, counts and normalized types only: never the file name (client text
 * that can name a person) or the bytes.
 */
function rejected(log, statusCode, reason, fields = {}) {
  log.warn('Upload rejected', { statusCode, reason, ...fields })
}

function refuse(log, statusCode, message, reason, fields) {
  rejected(log, statusCode, reason, fields)
  return createError({ statusCode, message })
}

function rejectOversizedUploadRequest(event, log) {
  const contentLengthHeader = getHeader(event, 'content-length')
  if (!contentLengthHeader) {
    throw refuse(log, 411, 'Content-Length is required', 'content_length_missing')
  }

  const contentLength = Number.parseInt(contentLengthHeader, 10)
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    throw refuse(log, 411, 'Content-Length is required', 'content_length_invalid')
  }

  if (contentLength > MAX_UPLOAD_REQUEST_SIZE) {
    throw refuse(log, 413, TOO_LARGE_MESSAGE, 'request_too_large', { contentLength })
  }
}

async function readBoundedFormData(event, log) {
  capIncomingMessageBytes(event?.node?.req, MAX_UPLOAD_REQUEST_SIZE)
  try {
    await enforceUploadBodyByteCap(event, MAX_UPLOAD_REQUEST_SIZE)
    return await readMultipartFormData(event)
  } catch (cause) {
    if (cause?.statusCode === 413) {
      throw refuse(log, 413, TOO_LARGE_MESSAGE, 'body_too_large')
    }
    throw cause
  }
}

function validateFiles(files, log) {
  try {
    validateUploadFiles(files)
  } catch (error) {
    const unsupported = files.find((file) => !isAllowedUploadContentType(file.type))
    rejected(log, error?.statusCode ?? 400, unsupported ? 'unsupported_type' : 'file_too_large', {
      fileCount: files.length,
      ...(unsupported
        ? { declaredType: normalizeUploadContentType(unsupported.type).slice(0, 100) }
        : { maxFileBytes: MAX_FILE_SIZE }),
    })
    throw error
  }
}

export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.upload,
    parseBody: async (event) => {
      const log = useLogger(event).child('Upload')
      rejectOversizedUploadRequest(event, log)
      const formData = await readBoundedFormData(event, log)
      if (!formData || formData.length === 0) {
        throw refuse(log, 400, 'No file uploaded', 'no_file')
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
      throw refuse(log, 400, 'No valid files in upload', 'no_valid_file', {
        partCount: formData.length,
      })
    }

    validateFiles(files, log)

    // The declared type is a client header. Identify every file from its
    // bytes before anything is written, so one bad part stores nothing.
    const contentTypes = files.map((file) => {
      const sniffed = sniffUploadImageType(file.data)
      if (!sniffed) {
        throw refuse(log, 415, 'File content is not a supported image', 'content_not_image', {
          fileCount: files.length,
          declaredType: normalizeUploadContentType(file.type).slice(0, 100),
        })
      }
      return sniffed
    })

    const results = []

    for (const [index, file] of files.entries()) {
      const contentType = contentTypes[index]
      const ext = normalizeExtension(contentType)
      const key = `uploads/${crypto.randomUUID()}.${ext}`
      const payload = new ArrayBuffer(file.data.byteLength)
      const performanceWarnings = getUploadPerformanceWarnings({ ...file, type: contentType })
      new Uint8Array(payload).set(file.data)

      try {
        await uploadToR2(event, key, payload, contentType)
      } catch (error) {
        log.error('Upload storage write failed', {
          key,
          contentType,
          sizeBytes: file.data.byteLength,
          storedCount: results.length,
          error,
        })
        throw error
      }

      if (performanceWarnings.length > 0) {
        log.warn('Uploaded image exceeds public performance budget', {
          key,
          sizeBytes: file.data.byteLength,
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
