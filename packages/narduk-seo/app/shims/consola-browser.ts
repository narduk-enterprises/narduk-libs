type LogMethod = (...args: unknown[]) => void
type Formatter = (value: unknown) => string

function consoleMethod(name: 'debug' | 'error' | 'info' | 'log' | 'trace' | 'warn'): LogMethod {
  const method = globalThis.console[name]
  return typeof method === 'function' ? method.bind(globalThis.console) : () => {}
}

export interface ConsolaBrowserShim {
  debug: LogMethod
  error: LogMethod
  fail: LogMethod
  fatal: LogMethod
  info: LogMethod
  log: LogMethod
  ready: LogMethod
  silent: LogMethod
  start: LogMethod
  success: LogMethod
  trace: LogMethod
  verbose: LogMethod
  warn: LogMethod
  withDefaults: () => ConsolaBrowserShim
  withTag: () => ConsolaBrowserShim
}

const noop: LogMethod = () => {}

export const consola: ConsolaBrowserShim = {
  debug: consoleMethod('debug'),
  error: consoleMethod('error'),
  fail: consoleMethod('error'),
  fatal: consoleMethod('error'),
  info: consoleMethod('info'),
  log: consoleMethod('log'),
  ready: consoleMethod('info'),
  silent: noop,
  start: consoleMethod('info'),
  success: consoleMethod('info'),
  trace: consoleMethod('trace'),
  verbose: consoleMethod('debug'),
  warn: consoleMethod('warn'),
  withDefaults: () => consola,
  withTag: () => consola,
}

export function createConsola(): ConsolaBrowserShim {
  return consola
}

export function useConsola(): ConsolaBrowserShim {
  return consola
}

export function createLogger(): ConsolaBrowserShim {
  return consola
}

export function useLogger(): ConsolaBrowserShim {
  return consola
}

export function colorize(_color: string, value: unknown): string {
  return String(value ?? '')
}

export function getColor(): Formatter {
  return (value: unknown) => String(value ?? '')
}

export default consola
