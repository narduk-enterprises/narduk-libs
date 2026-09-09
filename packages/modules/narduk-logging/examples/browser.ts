import {
  createBrowserLogger,
  createRemoteSink,
  installErrorHandlers,
} from '@narduk-enterprises/narduk-logging/browser'

/** Call only after your app has enabled diagnostics and installed its protected endpoint. */
export function enableDiagnostics(service: string, environment: string): () => Promise<void> {
  const sink = createRemoteSink({ endpoint: '/api/_narduk/logs' })
  const log = createBrowserLogger({ service, environment, sinks: [sink] })
  const removeListeners = installErrorHandlers(log)
  log.info('Synthetic logging check', { check: 'browser' })
  return async () => {
    removeListeners()
    await log.close()
  }
}
