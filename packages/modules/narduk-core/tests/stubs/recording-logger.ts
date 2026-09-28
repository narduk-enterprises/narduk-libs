import type { Logger } from '../../runtime/server/utils/logger'

/** One call a test made through the core request logger. */
export interface LoggedRecord {
  data?: Record<string, unknown>
  level: 'debug' | 'error' | 'info' | 'warn'
  message: string
  /** `child()` scopes joined with `.`, empty for the root logger. */
  scope: string
}

/** Every record since the last {@link resetLogged}. */
export const logged: LoggedRecord[] = []

export function resetLogged(): void {
  logged.length = 0
}

function recordingLogger(scope: string): Logger {
  const at =
    (level: LoggedRecord['level']) => (message: string, data?: Record<string, unknown>) => {
      logged.push({ data, level, message, scope })
    }
  return {
    child: (next) => recordingLogger(scope ? `${scope}.${next}` : next),
    debug: at('debug'),
    error: at('error'),
    info: at('info'),
    warn: at('warn'),
  }
}

/**
 * Stand-in for `useLogger` from `runtime/server/utils/logger`. Use it from a
 * `vi.mock` factory so the code under test runs its real logging calls and the
 * test asserts on what reached the logger:
 *
 * ```ts
 * vi.mock('../runtime/server/utils/logger', async (importOriginal) => ({
 *   ...(await importOriginal<object>()),
 *   useLogger: (await import('./stubs/recording-logger')).useRecordingLogger,
 * }))
 * ```
 */
export function useRecordingLogger(): Logger {
  return recordingLogger('')
}
