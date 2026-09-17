// Narrow filter for workerd's client-abort EPIPE block. The launcher hooks
// process.stderr.write (that is the stream Playwright copies from webServer).
//
// workerd does not print onto our stderr itself. Installed wrangler 4.133.0:
// miniflare handleStructuredLogsFromStream reads the workerd child stdout/stderr,
// wrangler handleStructuredLogs calls logger.error, Logger.doLog calls
// console.error, and Node writes that string to process.stderr.
//
// Lifted from narduk-enterprises/buoys `apps/web/scripts/filter-workerd-client-abort.mjs`
// (fix/e2e-workerd-epipe-filter, buoys#124). Do not write a second filter.

const ANSI_ESCAPE = new RegExp(`${String.fromCodePoint(0x1b)}\\[[\\d;]*m`, 'g')
const WEBSERVER_PREFIX = /^\[WebServer\] ?/

export type WorkerdClientAbortFilterPhase =
  'idle' | 'after-start' | 'after-stack-header' | 'complete'

export interface WorkerdClientAbortFilterState {
  carry: string
  ended: boolean
  pending: string[]
  phase: WorkerdClientAbortFilterPhase
}

export function createWorkerdClientAbortFilterState(): WorkerdClientAbortFilterState {
  return {
    carry: '',
    ended: false,
    pending: [],
    phase: 'idle',
  }
}

export function filterWorkerdClientAbort(
  chunk: string,
  state: WorkerdClientAbortFilterState,
): string {
  if (state.ended) {
    return chunk
  }

  const data = state.carry + chunk
  const parts = data.split(/(\r?\n)/)
  let out = ''
  state.carry = ''

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index]
    const newline = parts[index + 1]
    if (newline === undefined) {
      state.carry = line
      break
    }
    out += handleCompleteLine(line, newline, state)
  }

  return out
}

export function flushWorkerdClientAbortFilter(state: WorkerdClientAbortFilterState): string {
  if (state.ended) {
    return ''
  }

  state.ended = true
  const out = `${state.pending.join('')}${state.carry}`
  state.carry = ''
  state.pending = []
  state.phase = 'idle'
  return out
}

function classify(line: string): {
  blank: boolean
  clientAbort: boolean
  stackHeader: boolean
  workerdFrame: boolean
} {
  const visible = line.replaceAll(ANSI_ESCAPE, '').replace(WEBSERVER_PREFIX, '')
  return {
    blank: visible.trim() === '',
    clientAbort:
      visible.includes('kj::getCaughtExceptionAsKj()') &&
      visible.includes('disconnected:') &&
      visible.includes('::write(') &&
      visible.includes('Broken pipe'),
    stackHeader: /^\s*stack:/.test(visible),
    workerdFrame: visible.includes('workerd@'),
  }
}

function handleCompleteLine(
  line: string,
  newline: string,
  state: WorkerdClientAbortFilterState,
): string {
  let out = ''
  let reprocess = true

  while (reprocess) {
    reprocess = false
    const piece = `${line}${newline}`
    const kind = classify(line)

    if (state.phase === 'complete') {
      if (kind.blank || kind.stackHeader || kind.workerdFrame) {
        return out
      }
      state.phase = 'idle'
      reprocess = true
      continue
    }

    if (state.phase === 'idle') {
      if (kind.clientAbort) {
        state.pending.push(piece)
        state.phase = 'after-start'
        return out
      }
      return `${out}${piece}`
    }

    if (state.phase === 'after-start') {
      if (kind.blank) {
        state.pending.push(piece)
        return out
      }
      if (kind.stackHeader && kind.workerdFrame) {
        state.pending = []
        state.phase = 'complete'
        return out
      }
      if (kind.stackHeader) {
        state.pending.push(piece)
        state.phase = 'after-stack-header'
        return out
      }
      out += state.pending.join('')
      state.pending = []
      state.phase = 'idle'
      reprocess = true
      continue
    }

    if (kind.blank) {
      state.pending.push(piece)
      return out
    }
    if (kind.workerdFrame) {
      state.pending = []
      state.phase = 'complete'
      return out
    }
    out += state.pending.join('')
    state.pending = []
    state.phase = 'idle'
    reprocess = true
  }

  return out
}
