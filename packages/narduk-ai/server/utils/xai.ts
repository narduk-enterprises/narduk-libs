import { createError } from 'h3'

export interface GrokChatMessage {
  content: string
  role: 'system' | 'user' | 'assistant'
}

export interface XaiModel {
  created?: number
  id: string
  object: string
  owned_by?: string
}

export function parseXaiError(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: string | { message?: string }
      message?: string
    }
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return parsed.error
    }
    if (parsed.error && typeof parsed.error === 'object' && parsed.error.message?.trim()) {
      return parsed.error.message
    }
    if (parsed.message?.trim()) {
      return parsed.message
    }
    return null
  } catch {
    return null
  }
}

function createXaiRequest(
  apiKey: string,
  messages: GrokChatMessage[],
  model: string,
  stream = false,
): RequestInit {
  return {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      store: false,
      ...(stream ? { stream: true } : {}),
    }),
  }
}

async function throwXaiResponseError(response: Response): Promise<never> {
  const body = await response.text()
  throw createError({
    statusCode: response.status,
    message: parseXaiError(body) ?? 'Failed to reach xAI.',
  })
}

export async function grokChat(
  apiKey: string,
  messages: GrokChatMessage[],
  model: string,
): Promise<string> {
  const response = await fetch(
    'https://api.x.ai/v1/chat/completions',
    createXaiRequest(apiKey, messages, model),
  )

  if (!response.ok) {
    await throwXaiResponseError(response)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const content = payload.choices?.[0]?.message?.content
  return typeof content === 'string' ? content.trim() : ''
}

export async function grokChatStream(
  apiKey: string,
  messages: GrokChatMessage[],
  model: string,
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(
    'https://api.x.ai/v1/chat/completions',
    createXaiRequest(apiKey, messages, model, true),
  )

  if (!response.ok) {
    await throwXaiResponseError(response)
  }
  if (!response.body) {
    throw createError({ statusCode: 502, message: 'xAI returned an empty stream.' })
  }

  return response.body.pipeThrough(createXaiSseStreamParser())
}

export function createXaiSseStreamParser(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  function enqueueContent(line: string, controller: TransformStreamDefaultController<Uint8Array>) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return

    const payload = trimmed.slice('data:'.length).trim()
    if (!payload || payload === '[DONE]') return

    try {
      const data = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: unknown } }>
      }
      const content = data.choices?.[0]?.delta?.content
      if (typeof content === 'string' && content.length > 0) {
        controller.enqueue(encoder.encode(content))
      }
    } catch {
      // Ignore malformed SSE records and continue the stream.
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        enqueueContent(line, controller)
      }
    },
    flush(controller) {
      buffer += decoder.decode()
      if (buffer) {
        enqueueContent(buffer, controller)
      }
    },
  })
}

export async function grokListModels(apiKey: string): Promise<XaiModel[]> {
  const response = await fetch('https://api.x.ai/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!response.ok) {
    await response.text()
    throw createError({ statusCode: response.status, message: 'Failed to list xAI models.' })
  }

  const data = (await response.json()) as { data?: XaiModel[] }
  return Array.isArray(data.data) ? data.data : []
}
