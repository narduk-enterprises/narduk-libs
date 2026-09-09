import { createWorkerLogger, logJob, logRequest } from '@narduk-enterprises/narduk-logging/worker'

interface Environment {
  APP_ENVIRONMENT: string
}
interface QueueMessage {
  ack(): void
  retry(): void
}

const logger = (env: Environment) =>
  createWorkerLogger({ service: 'example-worker', environment: env.APP_ENVIRONMENT })

export default {
  fetch(request: Request, env: Environment) {
    return logRequest(
      request,
      logger(env),
      (log) => {
        log.info('Synthetic logging check', { check: 'worker' })
        return Response.json({ ok: true })
      },
      { route: '/' },
    )
  },
  scheduled(_controller: unknown, env: Environment) {
    return logJob(logger(env), 'scheduled-refresh', (log) => {
      log.info('Synthetic logging check', { check: 'scheduled' })
    })
  },
  queue(batch: { messages: QueueMessage[] }, env: Environment) {
    return logJob(logger(env), 'queue-batch', (log) => {
      for (const message of batch.messages) message.ack()
      log.info('Batch processed', { count: batch.messages.length })
    })
  },
}

// A Durable Object can use the same explicit helpers in fetch() and alarm().
// Put acknowledgment/retry and application work inside the callback; the helper never changes them.
