export type NotifyErrorCode =
  | 'invalid_credentials'
  | 'invalid_device_token'
  | 'invalid_notification'
  | 'invalid_email'
  | 'payload_too_large'
  | 'unknown_category'
  | 'unknown_channel'
  | 'mandatory_channel'

/** A caller error: bad input or configuration. Provider rejections are results, never throws. */
export class NotifyError extends Error {
  readonly code: NotifyErrorCode

  constructor(code: NotifyErrorCode, message: string) {
    super(message)
    this.name = 'NotifyError'
    this.code = code
  }
}
