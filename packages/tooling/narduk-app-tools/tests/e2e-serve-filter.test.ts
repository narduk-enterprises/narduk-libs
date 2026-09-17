import { describe, expect, it } from 'vitest'

import {
  createWorkerdClientAbortFilterState,
  filterWorkerdClientAbort,
  flushWorkerdClientAbortFilter,
} from '../src/e2e-serve/filter-workerd-client-abort.js'

const ISSUE_BLOCK = [
  '[WebServer] ✘ [ERROR] kj::getCaughtExceptionAsKj() = kj/async-io-unix.c++:186: disconnected: ::write(fd, buffer.begin(), buffer.size()): Broken pipe',
  '  stack: .../node_modules/@cloudflare/workerd-linux-64/bin/workerd@...',
].join('\n')

const STARTUP_NOTES = [
  '[serve-e2e-build] cwd=/Users/narduk/code-worktrees/buoys/e2e-epipe-filter/apps/web',
  '[serve-e2e-build] ready on http://127.0.0.1:4401',
].join('\n')

function apply(chunks: string[], end = true): string {
  const state = createWorkerdClientAbortFilterState()
  let out = ''
  for (const chunk of chunks) {
    out += filterWorkerdClientAbort(chunk, state)
  }
  if (end) {
    out += flushWorkerdClientAbortFilter(state)
  }
  return out
}

describe('filterWorkerdClientAbort', () => {
  it('removes the issue signature, including when it is split across chunks', () => {
    const complete = `${ISSUE_BLOCK}\n`
    expect(apply([complete])).toBe('')

    const splitAt = 64
    expect(apply([complete.slice(0, splitAt), complete.slice(splitAt)])).toBe('')
  })

  it('removes the Connection reset by peer form of the same aborted write', () => {
    // CI run 35264335486: esbuild puts a blank line between the header and the stack.
    const reset = [
      '\u001B[31m✘ \u001B[41;31m[\u001B[41;97mERROR\u001B[41;31m]\u001B[0m kj::getCaughtExceptionAsKj() = kj/async-io-unix.c++:186: disconnected: ::write(fd, buffer.begin(), buffer.size()): Connection reset by peer',
      '',
      '  stack: .../workerd-linux-64/bin/workerd@586691a .../workerd-linux-64/bin/workerd@5867801',
      '',
      '',
    ].join('\n')
    expect(apply([reset])).toBe('')

    const readReset =
      '✘ [ERROR] kj/async-io-unix.c++:120: disconnected: ::read(fd): Connection reset by peer\n'
    expect(apply([readReset])).toBe(readReset)
  })

  it('removes a burst of four client-abort blocks', () => {
    expect(apply([Array.from({ length: 4 }, () => `${ISSUE_BLOCK}\n`).join('')])).toBe('')
  })

  it('passes [serve-e2e-build] cwd= and ready-on startup notes through unchanged', () => {
    const notes = `${STARTUP_NOTES}\n`
    expect(apply([notes])).toBe(notes)
  })

  it('passes a different workerd ERROR and a non-::write Broken pipe through unchanged', () => {
    const otherKj = [
      '✘ [ERROR] kj::getCaughtExceptionAsKj() = kj/async-io-unix.c++:186: failed: heap space',
      '  stack: .../node_modules/@cloudflare/workerd-linux-64/bin/workerd@...',
    ].join('\n')
    const otherBrokenPipe = '✘ [ERROR] log write failed: Broken pipe\n'

    expect(apply([`${otherKj}\n`])).toBe(`${otherKj}\n`)
    expect(apply([otherBrokenPipe])).toBe(otherBrokenPipe)
  })

  it('flushes partial trailing data on stream end and never swallows it', () => {
    const partial =
      '✘ [ERROR] kj::getCaughtExceptionAsKj() = kj/async-io-unix.c++:186: disconnected: ::write(fd, buffer.begin(), buffer.size()): Broken pi'
    expect(apply([partial])).toBe(partial)

    const startOnly = `${ISSUE_BLOCK.split('\n')[0]}\n`
    expect(apply([startOnly])).toBe(startOnly)
  })

  it('passes [e2e-serve] startup notes through unchanged', () => {
    const notes = '[e2e-serve] cwd=/tmp/app\n[e2e-serve] ready on http://127.0.0.1:4401\n'
    expect(apply([notes])).toBe(notes)
  })
})
