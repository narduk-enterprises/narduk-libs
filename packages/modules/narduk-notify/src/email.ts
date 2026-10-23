import { NotifyError } from './errors.js'

export const RESEND_API_ORIGIN = 'https://api.resend.com'

export interface ResendClientOptions {
  /** The Resend API key, from a secret binding (nvault); never logged. */
  apiKey: string
  fetch?: typeof fetch
  origin?: string
  timeoutMs?: number
}

export interface EmailMessage {
  bcc?: string[]
  cc?: string[]
  from: string
  /** App-defined headers, e.g. `List-Unsubscribe`. */
  headers?: Record<string, string>
  html?: string
  /** Resend keeps a key for 24 hours; a repeat send with it is not delivered twice. */
  idempotencyKey?: string
  replyTo?: string | string[]
  subject: string
  tags?: Array<{ name: string; value: string }>
  text?: string
  to: string | string[]
}

export interface EmailSendResult {
  /** Resend's email id when accepted. */
  id: string | null
  ok: boolean
  /** Resend's error `name`, or `TransportError` when the request never got an answer. */
  reason: string | null
  retryable: boolean
  status: number
}

export interface ResendClient {
  send: (message: EmailMessage) => Promise<EmailSendResult>
}

function list(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return (Array.isArray(value) ? value : [value]).map((entry) => entry.trim()).filter(Boolean)
}

function parseJson(body: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(body)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Send email through Resend's REST API with `fetch` (Workers and Node). Input
 * errors throw `NotifyError`; a provider rejection or network failure is a
 * result, so the caller can audit it.
 */
export function createResendClient(options: ResendClientOptions): ResendClient {
  const apiKey = options.apiKey.trim()
  if (!apiKey) throw new NotifyError('invalid_credentials', 'Resend API key is required')
  const fetcher = options.fetch ?? globalThis.fetch
  const origin = options.origin ?? RESEND_API_ORIGIN
  const timeoutMs = options.timeoutMs ?? 10_000

  return {
    send: async (message) => {
      const to = list(message.to)
      if (to.length === 0) throw new NotifyError('invalid_email', 'email needs a recipient')
      if (!message.from.trim()) throw new NotifyError('invalid_email', 'email needs a from address')
      if (!message.subject.trim()) throw new NotifyError('invalid_email', 'email needs a subject')
      if (!message.text && !message.html) {
        throw new NotifyError('invalid_email', 'email needs text or html')
      }

      const headers: Record<string, string> = {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      }
      if (message.idempotencyKey) headers['idempotency-key'] = message.idempotencyKey

      const body: Record<string, unknown> = { from: message.from, to, subject: message.subject }
      if (message.text) body.text = message.text
      if (message.html) body.html = message.html
      if (message.cc?.length) body.cc = list(message.cc)
      if (message.bcc?.length) body.bcc = list(message.bcc)
      if (message.replyTo !== undefined) body.reply_to = list(message.replyTo)
      if (message.headers) body.headers = message.headers
      if (message.tags?.length) body.tags = message.tags

      let response: Response
      let parsed: Record<string, unknown>
      try {
        response = await fetcher(`${origin}/emails`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        })
        parsed = parseJson(await response.text())
      } catch {
        return { ok: false, status: 0, id: null, reason: 'TransportError', retryable: true }
      }
      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          id: typeof parsed.id === 'string' ? parsed.id : null,
          reason: null,
          retryable: false,
        }
      }
      return {
        ok: false,
        status: response.status,
        id: null,
        reason: typeof parsed.name === 'string' ? parsed.name : `http_${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
      }
    },
  }
}
