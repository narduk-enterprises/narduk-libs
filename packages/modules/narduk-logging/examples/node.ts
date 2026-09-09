import { createNodeLogger } from '@narduk-enterprises/narduk-logging/node'

const log = createNodeLogger({ service: 'example-node', environment: 'production' })
await log.operation('example-job', async (job) => {
  job.info('Synthetic logging check', { check: 'node', count: 1 })
  return 42
})
await log.close()
